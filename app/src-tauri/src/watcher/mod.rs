mod db;
mod pending;
mod trace;

use crate::judge::{classify, main_state_of, RunningTool, Signals};
use crate::model::{stable_hash, BuddyState, Event, TaskSnapshot, TaskState, MATERIALS};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const POLL: Duration = Duration::from_millis(1000);

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn workbuddy_home() -> PathBuf {
    if let Ok(custom) = std::env::var("WORKBUDDY_HOME") {
        return PathBuf::from(custom);
    }
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".workbuddy")
}

/// pid 映射：sessions/<pid>.json 里的 sessionId
fn pid_map(home: &std::path::Path) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    let Ok(entries) = std::fs::read_dir(home.join("sessions")) else {
        return map;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let (Some(pid), Some(sid)) = (
            v.get("pid").and_then(|p| p.as_u64()),
            v.get("sessionId").and_then(|s| s.as_str()),
        ) else {
            continue;
        };
        if !sid.starts_with("prewarm") {
            map.insert(sid.to_string(), pid as u32);
        }
    }
    map
}

struct Prev {
    total: f64,
    state: BuddyState,
    tool: Option<String>,
}

/// 采集线程：1s 轮询，只读；所有判定交给 judge
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let home = workbuddy_home();
        let mut prev: HashMap<String, Prev> = HashMap::new();
        let mut last_main: Option<BuddyState> = None;
        let mut announced: HashSet<String> = HashSet::new();
        // 材质/大小：首次见到会话时随机分配，进程内保持不变，重启会重新分配
        let mut looks: HashMap<String, (usize, f32)> = HashMap::new();
        let mut pending_watch = pending::PendingWatcher::default();
        let mut tick: u64 = 0;

        loop {
            let now = now_ms();
            let _ = pending_watch.poll(&home);
            tick += 1;
            // 每 10 个周期重播一次全量任务：前端晚于采集层启动时不至于永远空着
            if tick % 10 == 1 {
                announced.clear();
            }
            if let Some(db) = db::Db::open(&home) {
                // 读失败（SQLITE_BUSY）时整轮跳过，绝不把空结果当成"任务都没了"
                if let (Ok(sessions), Ok(usage)) = (db.sessions(), db.usage()) {
                    let pids = pid_map(&home);
                    let usage_map: HashMap<&str, &db::UsageRow> =
                        usage.iter().map(|u| (u.session_id.as_str(), u)).collect();

                    let mut alive: HashSet<String> = HashSet::new();
                    let mut pairs: Vec<(TaskState, BuddyState)> = Vec::new();

                    for s in &sessions {
                        alive.insert(s.id.clone());

                        let scan = pids
                            .get(&s.id)
                            .and_then(|pid| trace::scan(&home, *pid, now));

                        let u = usage_map.get(s.id.as_str());
                        let prev_entry = prev.get(&s.id);
                        let delta = u
                            .map(|u| (u.total - prev_entry.map(|p| p.total).unwrap_or(u.total)).max(0.0))
                            .unwrap_or(0.0);

                        // 活动时间取所有源的 max：sidebar 快照可能滞后数分钟
                        let last_activity = s
                            .last_activity_at
                            .unwrap_or(s.updated_at)
                            .max(u.map(|u| u.updated_at).unwrap_or(0));
                        let silent_ms = if last_activity > 0 {
                            Some((now - last_activity).max(0) as u64)
                        } else {
                            None
                        };

                        // 用户点完按钮后会话会重新产生活动 → 先清掉过期的 pending
                        if let Some(act) = s.last_activity_at {
                            pending_watch.reconcile(&s.id, act);
                        }
                        let pending_kind = pending_watch.kind_of(&s.id);

                        let signals = Signals {
                            status: s.status.clone(),
                            silent_ms,
                            running: scan.as_ref().and_then(|t| {
                                t.running.as_ref().map(|(name, elapsed)| RunningTool {
                                    name: name.clone(),
                                    elapsed_ms: *elapsed,
                                })
                            }),
                            trace_fresh: scan.as_ref().map(|t| t.fresh).unwrap_or(false),
                            p90_ms: scan.as_ref().and_then(|t| {
                                t.running
                                    .as_ref()
                                    .and_then(|(name, _)| t.p90.get(name).copied())
                            }),
                            span_event_age_ms: scan.as_ref().and_then(|t| t.last_event_age_ms),
                            credit_delta: delta,
                            pending_kind,
                        };

                        let verdict = classify(&signals);
                        let tool = scan.as_ref().and_then(|t| t.running.as_ref().map(|(n, _)| n.clone()));

                        let changed = prev_entry
                            .map(|p| p.state != verdict.state || p.tool != tool)
                            .unwrap_or(true);

                        if changed || !announced.contains(&s.id) {
                            announced.insert(s.id.clone());
                            let (mat_idx, size) = *looks.entry(s.id.clone()).or_insert_with(|| {
                                let nanos = SystemTime::now()
                                    .duration_since(UNIX_EPOCH)
                                    .map(|d| d.subsec_nanos() as u64)
                                    .unwrap_or(0);
                                let mix = nanos ^ (stable_hash(&s.id) as u64).wrapping_mul(0x9E3779B9);
                                (
                                    (mix as usize) % MATERIALS.len(),
                                    0.86 + ((mix >> 8) % 30) as f32 / 100.0,
                                )
                            });

                            let active = signals.silent_ms.map(|ms| ms < 60 * 60 * 1000).unwrap_or(true);

                            let task = TaskSnapshot {
                                id: s.id.clone(),
                                title: s.title.clone(),
                                state: task_state_of(verdict.state),
                                material: MATERIALS[mat_idx].to_string(),
                                size,
                                tool: tool.clone(),
                                active,
                            };
                            let _ = app.emit("buddy://event", Event::TaskUpsert { at: now as u64, task });
                        }

                        if delta > 0.0 {
                            let _ = app.emit(
                                "buddy://event",
                                Event::Credit {
                                    at: now as u64,
                                    kind: "minus",
                                    amount: (delta * 100.0).round() / 100.0,
                                    task_id: Some(s.id.clone()),
                                },
                            );
                        }

                        pairs.push((task_state_of(verdict.state), verdict.state));

                        prev.insert(
                            s.id.clone(),
                            Prev {
                                total: u.map(|u| u.total).unwrap_or(0.0),
                                state: verdict.state,
                                tool,
                            },
                        );
                    }

                    // 消失的会话：只发一次 remove
                    let gone: Vec<String> = announced
                        .iter()
                        .filter(|id| !alive.contains(*id))
                        .cloned()
                        .collect();
                    for id in gone {
                        announced.remove(&id);
                        prev.remove(&id);
                        let _ = app.emit(
                            "buddy://event",
                            Event::TaskRemove { at: now as u64, task_id: id },
                        );
                    }

                    let main = main_state_of(&pairs);
                    if last_main != Some(main) {
                        last_main = Some(main);
                        let _ = app.emit("buddy://event", Event::MainState { at: now as u64, to: main });
                    }
                }
            } else {
                if last_main != Some(BuddyState::Offline) {
                    last_main = Some(BuddyState::Offline);
                    let _ = app.emit(
                        "buddy://event",
                        Event::MainState { at: now as u64, to: BuddyState::Offline },
                    );
                }
            }

            let _ = app.emit("buddy://event", Event::Heartbeat { at: now as u64 });
            std::thread::sleep(POLL);
        }
    });
}

fn task_state_of(s: BuddyState) -> TaskState {
    match s {
        BuddyState::Working => TaskState::Working,
        BuddyState::Attention => TaskState::Attention,
        BuddyState::Stalled => TaskState::Stalled,
        BuddyState::Completed => TaskState::Completed,
        BuddyState::Idle => TaskState::Completed,
        BuddyState::Offline => TaskState::Stalled,
    }
}
