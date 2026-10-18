use rusqlite::{Connection, OpenFlags};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct SessionRow {
    pub id: String,
    pub title: String,
    pub status: String,
    pub last_activity_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct UsageRow {
    pub session_id: String,
    pub total: f64,
    pub updated_at: i64,
}

/// 只读句柄。绝不 checkpoint、不建表、不写 `~/.workbuddy`。
pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(home: &Path) -> Option<Db> {
        let path = home.join("workbuddy.db");
        if !path.exists() {
            return None;
        }
        let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        let _ = conn.busy_timeout(std::time::Duration::from_millis(250));
        Some(Db { conn })
    }

    pub fn sessions(&self) -> rusqlite::Result<Vec<SessionRow>> {
        let mut stmt = self.conn.prepare(
            "select id, title, custom_title, status, last_activity_at, updated_at
             from sessions where deleted_at is null",
        )?;
        let rows = stmt.query_map([], |r| {
            let custom: Option<String> = r.get(2)?;
            let title: Option<String> = r.get(1)?;
            Ok(SessionRow {
                id: r.get(0)?,
                title: custom.or(title).unwrap_or_else(|| "(无标题)".into()),
                status: r.get::<_, String>(3)?.to_lowercase(),
                last_activity_at: r.get(4).ok(),
                updated_at: r.get(5).unwrap_or(0),
            })
        })?;
        rows.collect()
    }

    /// credit_json 是 `{turnId: 积分}`；值在回合进行中会被反复累加，
    /// 所以「本轮花费」要读 maxTurn 那条，累计要读全部之和。
    pub fn usage(&self) -> rusqlite::Result<Vec<UsageRow>> {
        let mut stmt = self
            .conn
            .prepare("select session_id, credit_json, updated_at from session_usage")?;
        let rows = stmt.query_map([], |r| {
            let sid: String = r.get(0)?;
            let raw: Option<String> = r.get(1)?;
            let updated_at: i64 = r.get(2).unwrap_or(0);
            let map: serde_json::Map<String, serde_json::Value> = raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            let mut total = 0.0f64;
            for v in map.values() {
                total += v.as_f64().unwrap_or(0.0);
            }
            Ok(UsageRow {
                session_id: sid,
                total,
                updated_at,
            })
        })?;
        rows.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 手工验收：`cargo test --lib -- --ignored --nocapture`
    /// 读本机真实 ~/.workbuddy（只读），验证字段语义没跑偏。
    #[test]
    #[ignore]
    fn reads_real_workbuddy_db() {
        let home = crate::watcher::workbuddy_home();
        let db = Db::open(&home).expect("打不开 workbuddy.db");
        let sessions = db.sessions().expect("sessions 查询失败");
        let usage = db.usage().expect("usage 查询失败");
        println!("home = {}", home.display());
        println!("sessions = {}", sessions.len());
        for s in sessions.iter().take(5) {
            println!("  [{}] {} last_activity={:?}", s.status, s.title, s.last_activity_at);
        }
        println!("usage = {}", usage.len());
        for u in usage.iter().take(5) {
            println!("  {} total={:.2}", &u.session_id[..8.min(u.session_id.len())], u.total);
        }
        assert!(!sessions.is_empty(), "本机应有会话数据");
        assert!(usage.iter().all(|u| u.total >= 0.0), "积分不应为负");
    }
}
