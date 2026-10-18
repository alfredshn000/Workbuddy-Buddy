//! 从 WorkBuddy 的 daemon 日志里识别「等待用户确认」。
//!
//! 唯一的本地信号是这一行（kind=permission 表示命中写入/命令询问规则）：
//!   [TaskStatusNotifier] upsert received: session=<id> prev=working new=pending kind=permission
//!
//! 它**没有对应的"已恢复"日志**，所以结束判定用两条：
//!   1) 同一会话出现新的状态迁移（new != pending）
//!   2) 会话的 last_activity_at 晚于进入 pending 的时刻（用户点了按钮，会话重新有活动）

use chrono::DateTime;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const SEED_BYTES: u64 = 2 * 1024 * 1024; // 首次只回看 2MB，够覆盖最近几十次交互

#[derive(Debug, Clone)]
pub struct PendingInfo {
    pub kind: String,
    pub since_ms: i64,
}

#[derive(Default)]
pub struct PendingWatcher {
    offset: u64,
    seeded: bool,
    map: HashMap<String, PendingInfo>,
}

impl PendingWatcher {
    pub fn poll(&mut self, home: &Path) -> &HashMap<String, PendingInfo> {
        let path = home.join("logs").join("daemon.log");
        let Ok(mut fh) = File::open(&path) else {
            return &self.map;
        };
        let Ok(meta) = fh.metadata() else {
            return &self.map;
        };
        let len = meta.len();

        if !self.seeded {
            self.offset = len.saturating_sub(SEED_BYTES);
            self.seeded = true;
        }
        if len < self.offset {
            // 日志被轮转/截断，从头再来
            self.offset = 0;
        }
        if len <= self.offset {
            return &self.map;
        }

        if fh.seek(SeekFrom::Start(self.offset)).is_err() {
            return &self.map;
        }
        let mut buf = Vec::new();
        if fh.read_to_end(&mut buf).is_err() {
            return &self.map;
        }
        self.offset = len;

        let text = String::from_utf8_lossy(&buf);
        for line in text.lines() {
            let Some((session, status, kind, ts)) = parse_line(line) else {
                continue;
            };
            if status == "pending" {
                self.map.insert(
                    session,
                    PendingInfo { kind, since_ms: ts },
                );
            } else {
                // completed / working / terminated：一律视为已离开 pending
                self.map.remove(&session);
            }
        }

        &self.map
    }

    pub fn kind_of(&self, session_id: &str) -> Option<String> {
        self.map.get(session_id).map(|i| i.kind.clone())
    }

    /// 用户点了按钮之后会话会重新产生活动，用活动时间兜底清除
    pub fn reconcile(&mut self, session_id: &str, last_activity_at: i64) {
        if let Some(info) = self.map.get(session_id) {
            if last_activity_at > info.since_ms + 500 {
                self.map.remove(session_id);
            }
        }
    }
}

/// 解析一行 daemon.log，返回 (session, new_status, kind, timestamp_ms)
fn parse_line(line: &str) -> Option<(String, String, String, i64)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let ts = v
        .get("timestamp")
        .and_then(|t| t.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0);

    // message 可能是字符串，也可能是字符串数组
    let msg = match v.get("message") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => arr
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => return None,
    };

    if !msg.contains("TaskStatusNotifier") || !msg.contains("upsert received") {
        return None;
    }

    let mut session = None;
    let mut status = None;
    let mut kind = String::from("permission");
    for part in msg.split_whitespace() {
        if let Some(v) = part.strip_prefix("session=") {
            session = Some(v.trim_end_matches(',').to_string());
        } else if let Some(v) = part.strip_prefix("new=") {
            status = Some(v.trim_end_matches(',').to_string());
        } else if let Some(v) = part.strip_prefix("kind=") {
            kind = v.trim_end_matches(',').to_string();
        }
    }

    Some((session?, status?, kind, ts))
}

#[cfg(test)]
mod tests {
    use super::{parse_line, PendingWatcher};

    #[test]
    fn parses_pending_line() {
        let line = r#"{"timestamp":"2026-10-18T08:00:00.000Z","level":"info","scope":"daemon","message":["[TaskStatusNotifier] upsert received: session=d5b995b4-5816-45fc-a450-487970463872 prev=working new=pending kind=permission"]}"#;
        let (sid, status, kind, ts) = parse_line(line).unwrap();
        assert_eq!(sid, "d5b995b4-5816-45fc-a450-487970463872");
        assert_eq!(status, "pending");
        assert_eq!(kind, "permission");
        assert!(ts > 0);
    }

    #[test]
    fn parses_completed_line() {
        let line = r#"{"timestamp":"2026-10-18T08:00:00.000Z","message":"[TaskStatusNotifier] upsert received: session=abc prev=working new=completed kind=<none>"}"#;
        let (sid, status, _, _) = parse_line(line).unwrap();
        assert_eq!(sid, "abc");
        assert_eq!(status, "completed");
    }

    /// 手工验收：cargo test --lib -- --ignored --nocapture
    /// 用本机真实 daemon.log 跑一遍，确认能解析出 pending 记录
    #[test]
    #[ignore]
    fn reads_real_daemon_log() {
        let home = crate::watcher::workbuddy_home();
        let mut w = PendingWatcher::default();
        let map = w.poll(&home).clone();
        println!("pending 记录数：{}", map.len());
        for (sid, info) in map.iter().take(5) {
            println!("  {sid} kind={} since={}", info.kind, info.since_ms);
        }
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert!(parse_line(r#"{"timestamp":"x","message":"[TaskNotify] pending: session=abc kind=permission sent=true"}"#).is_none());
    }
}
