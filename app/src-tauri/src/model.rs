use serde::Serialize;

/// 与前端 `app/src/events.ts` 一一对应，改这里必须同步改那边。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuddyState {
    Idle,
    Working,
    Attention,
    Stalled,
    Completed,
    Offline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Working,
    Attention,
    Stalled,
    Completed,
}

#[derive(Clone, Debug, Serialize)]
pub struct TaskSnapshot {
    pub id: String,
    pub title: String,
    pub state: TaskState,
    pub material: String,
    pub size: f32,
    pub tool: Option<String>,
    /// 最近 60 分钟内有活动的会话才算活跃（不活跃的只留在面板里，不出卫星）
    pub active: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "main:state")]
    MainState { at: u64, to: BuddyState },

    #[serde(rename = "task:upsert")]
    TaskUpsert { at: u64, task: TaskSnapshot },

    #[serde(rename = "task:remove")]
    TaskRemove {
        at: u64,
        #[serde(rename = "taskId")]
        task_id: String,
    },

    #[serde(rename = "credit")]
    Credit {
        at: u64,
        kind: &'static str,
        amount: f64,
        #[serde(rename = "taskId")]
        task_id: Option<String>,
    },

    #[serde(rename = "heartbeat")]
    Heartbeat { at: u64 },
}

/// 素材表要与前端 `states.ts` 的 MATERIALS 顺序一致
pub const MATERIALS: [&str; 11] = [
    "pearl", "chrome", "frosted", "ceramic", "carbon", "amber", "copper", "water", "brushed",
    "marble", "stone",
];

/// 稳定哈希：同一个 sessionId 每次启动拿到的材质和大小都一样
pub fn stable_hash(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

pub fn material_for(session_id: &str) -> &'static str {
    MATERIALS[(stable_hash(session_id) as usize) % MATERIALS.len()]
}

pub fn size_for(session_id: &str) -> f32 {
    0.86 + ((stable_hash(session_id) % 30) as f32) / 100.0
}
