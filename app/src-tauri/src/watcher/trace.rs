use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

const TAIL_BYTES: u64 = 256 * 1024;
const FRESH_MS: i64 = 120_000;

#[derive(Debug, Default)]
pub struct TraceScan {
    /// (工具名, 已耗时 ms)——未闭合的 span 就是"正在执行"
    pub running: Option<(String, u64)>,
    pub last_event_age_ms: Option<u64>,
    pub fresh: bool,
    /// 各工具的历史 P90 耗时，用于自适应阈值
    pub p90: HashMap<String, u64>,
}

fn parse_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn newest_trace(dir: &Path) -> Option<(std::path::PathBuf, i64)> {
    let mut best: Option<(std::path::PathBuf, i64, u128)> = None;
    for entry in std::fs::read_dir(dir).ok()? {
        let path = entry.ok()?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let modified = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let mtime_ms = modified as i64;
        if best.as_ref().map(|(_, _, m)| modified > *m).unwrap_or(true) {
            best = Some((path, mtime_ms, modified));
        }
    }
    best.map(|(p, m, _)| (p, m))
}

/// 只读 trace 尾部：全量解析会拖垮每秒轮询（实测单文件可达数 MB）
pub fn scan(home: &Path, pid: u32, now_ms: i64) -> Option<TraceScan> {
    let dir = home.join("traces").join(pid.to_string());
    if !dir.is_dir() {
        return None;
    }
    let (file, mtime_ms) = newest_trace(&dir)?;

    let mut fh = File::open(&file).ok()?;
    let len = fh.metadata().ok()?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    fh.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    fh.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);

    let mut open: HashMap<String, (String, i64)> = HashMap::new();
    let mut durations: HashMap<String, Vec<i64>> = HashMap::new();
    let mut ended = false;
    let mut last_event: Option<i64> = None;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "span_start" => {
                if let Some(span) = v.get("span") {
                    let id = span.get("spanId").and_then(|s| s.as_str()).unwrap_or("");
                    let name = span.get("name").and_then(|s| s.as_str()).unwrap_or("?");
                    if let Some(at) = span.get("startedAt").and_then(|s| s.as_str()).and_then(parse_ts) {
                        open.insert(id.to_string(), (name.to_string(), at));
                        last_event = Some(last_event.map_or(at, |p| p.max(at)));
                    }
                }
            }
            "span_end" => {
                if let Some(span) = v.get("span") {
                    let id = span.get("spanId").and_then(|s| s.as_str()).unwrap_or("");
                    let ended_at = span.get("endedAt").and_then(|s| s.as_str()).and_then(parse_ts);
                    if let Some(at) = ended_at {
                        if let Some((name, started)) = open.remove(id) {
                            durations.entry(name).or_default().push((at - started).max(0));
                        }
                        last_event = Some(last_event.map_or(at, |p| p.max(at)));
                    } else {
                        open.remove(id);
                    }
                }
            }
            "trace_end" => {
                ended = true;
                if let Some(at) = v
                    .get("trace")
                    .and_then(|t| t.get("endedAt"))
                    .and_then(|s| s.as_str())
                    .and_then(parse_ts)
                {
                    last_event = Some(last_event.map_or(at, |p| p.max(at)));
                }
            }
            _ => {}
        }
    }

    // 取最近开始的那个未闭合 span（子 span 天然比父 span 晚）；
    // 超过 30 分钟的一律不认，避免尾部截断造成假阳性
    let running = open
        .values()
        .filter_map(|(name, at)| {
            let elapsed = now_ms - at;
            if elapsed >= 0 && elapsed < 30 * 60_000 {
                Some((name.clone(), elapsed as u64))
            } else {
                None
            }
        })
        .max_by_key(|(_, e)| *e);

    let mut p90 = HashMap::new();
    for (name, mut list) in durations {
        if list.is_empty() {
            continue;
        }
        list.sort_unstable();
        let idx = ((list.len() as f64) * 0.9).floor() as usize;
        p90.insert(name, list[idx.min(list.len() - 1)].max(0) as u64);
    }

    Some(TraceScan {
        running,
        last_event_age_ms: last_event.map(|t| (now_ms - t).max(0) as u64),
        fresh: !ended && (now_ms - mtime_ms).abs() < FRESH_MS,
        p90,
    })
}
