//! 状态判定：纯函数，不碰文件与网络，便于单测。
//! 规则来源：docs/02-data-contract.md 的「状态映射」与「实测修正记录」。

use crate::model::{BuddyState, TaskState};

pub const SLOW_MS: u64 = 90_000;
pub const STUCK_MS: u64 = 180_000;
pub const DOUBLE_SILENT_MS: u64 = 120_000;
pub const TRACE_FRESH_MS: u64 = 120_000;

/// 工具超时基线：分类型给，再与自身历史 P90×3 取大。
/// 一刀切 60s 会把长命令误判成卡住（实测踩过）。
pub fn tool_timeout_ms(tool: &str, p90: Option<u64>) -> u64 {
    let base = match tool {
        "Bash" | "mcp_tools" => 300_000,
        "generation" => 120_000,
        "Read" | "Write" | "Edit" => 60_000,
        _ => 120_000,
    };
    base.max(p90.map(|p| p.saturating_mul(3)).unwrap_or(0))
}

#[derive(Debug, Clone)]
pub struct RunningTool {
    pub name: String,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone)]
pub struct Signals {
    /// db 里的 status，已转小写：working / completed / terminated / pending
    pub status: String,
    /// 最近一次可见活动距今（取所有源的 max 推算）
    pub silent_ms: Option<u64>,
    pub running: Option<RunningTool>,
    /// trace 文件是否新鲜（mtime < 120s 且未 trace_end）
    pub trace_fresh: bool,
    pub p90_ms: Option<u64>,
    /// 距最后一个 span 事件
    pub span_event_age_ms: Option<u64>,
    /// 本次轮询的积分增量（用于「双静默」判定）
    pub credit_delta: f64,
    /// 会话是否在等用户点确认（WorkBuddy 的询问规则）
    pub pending_kind: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Verdict {
    pub state: BuddyState,
    pub signals: Vec<String>,
}

pub fn classify(s: &Signals) -> Verdict {
    let mut signals = Vec::new();

    if s.status != "working" {
        let state = match s.status.as_str() {
            "terminated" => BuddyState::Offline,
            "completed" => BuddyState::Completed,
            _ => BuddyState::Idle,
        };
        return Verdict { state, signals };
    }

    // 0) 等待用户确认：优先级最高，既不是卡住也不是迟缓
    if let Some(kind) = &s.pending_kind {
        let label = if kind == "permission" {
            "等你确认（权限询问）"
        } else {
            "等你确认"
        };
        signals.push(label.to_string());
        return Verdict { state: BuddyState::Attention, signals };
    }

    // 1) 工具超时
    if s.trace_fresh {
        if let Some(run) = &s.running {
            let limit = tool_timeout_ms(&run.name, s.p90_ms);
            if run.elapsed_ms > limit {
                signals.push(format!(
                    "{} 超时 {:?} > {:?}",
                    run.name,
                    std::time::Duration::from_millis(run.elapsed_ms),
                    std::time::Duration::from_millis(limit)
                ));
                return Verdict { state: BuddyState::Stalled, signals };
            }
        }
    }

    // 2) 长时间静默
    if let Some(silent) = s.silent_ms {
        if silent > STUCK_MS {
            signals.push(format!("静默 {}s", silent / 1000));
            return Verdict { state: BuddyState::Stalled, signals };
        }

        // 3) 积分与 trace 双静默
        let no_credit = s.credit_delta <= 0.0;
        let no_span = s.span_event_age_ms.map(|a| a > DOUBLE_SILENT_MS).unwrap_or(true);
        if no_credit && no_span && silent > DOUBLE_SILENT_MS {
            signals.push("积分与 trace 双静默".into());
            return Verdict { state: BuddyState::Stalled, signals };
        }

        // 4) 迟缓 → 前端没有 slow 态，归入 attention（最接近「需要留意」的桶）
        if silent > SLOW_MS {
            signals.push(format!("迟缓 {}s", silent / 1000));
            return Verdict { state: BuddyState::Attention, signals };
        }
    }

    Verdict { state: BuddyState::Working, signals }
}

/// 主球状态由所有任务里最严重的一个决定：stalled > attention > working > idle
pub fn main_state_of(tasks: &[(TaskState, BuddyState)]) -> BuddyState {
    if tasks.is_empty() {
        return BuddyState::Idle;
    }
    let mut worst = BuddyState::Idle;
    let rank = |s: BuddyState| match s {
        BuddyState::Stalled => 4,
        BuddyState::Attention => 3,
        BuddyState::Working => 2,
        BuddyState::Completed => 1,
        BuddyState::Idle => 0,
        BuddyState::Offline => return -1,
    };
    for (_, s) in tasks {
        if rank(*s) > rank(worst) {
            worst = *s;
        }
    }
    worst
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Signals {
        Signals {
            status: "working".into(),
            silent_ms: Some(1_000),
            running: None,
            trace_fresh: false,
            p90_ms: None,
            span_event_age_ms: Some(1_000),
            credit_delta: 0.0,
            pending_kind: None,
        }
    }

    #[test]
    fn non_working_status_maps_directly() {
        let mut s = base();
        s.status = "completed".into();
        assert_eq!(classify(&s).state, BuddyState::Completed);
        s.status = "terminated".into();
        assert_eq!(classify(&s).state, BuddyState::Offline);
        s.status = "pending".into();
        assert_eq!(classify(&s).state, BuddyState::Idle);
    }

    #[test]
    fn bash_timeout_is_not_60s() {
        // 关键回归：60s 的 Bash 不能被判卡住
        assert!(tool_timeout_ms("Bash", None) >= 300_000);
        let mut s = base();
        s.trace_fresh = true;
        s.running = Some(RunningTool { name: "Bash".into(), elapsed_ms: 61_000 });
        assert_eq!(classify(&s).state, BuddyState::Working);
    }

    #[test]
    fn long_bash_eventually_stalls() {
        let mut s = base();
        s.trace_fresh = true;
        s.running = Some(RunningTool { name: "Bash".into(), elapsed_ms: 301_000 });
        assert_eq!(classify(&s).state, BuddyState::Stalled);
    }

    #[test]
    fn p90_scales_timeout_up() {
        assert_eq!(tool_timeout_ms("Read", Some(100_000)), 300_000);
    }

    #[test]
    fn silence_becomes_attention_then_stalled() {
        let mut s = base();
        s.silent_ms = Some(SLOW_MS + 1_000);
        assert_eq!(classify(&s).state, BuddyState::Attention);
        s.silent_ms = Some(STUCK_MS + 1_000);
        assert_eq!(classify(&s).state, BuddyState::Stalled);
    }

    #[test]
    fn double_silence_escalates() {
        let mut s = base();
        s.silent_ms = Some(DOUBLE_SILENT_MS + 1_000);
        s.credit_delta = 0.0;
        s.span_event_age_ms = Some(DOUBLE_SILENT_MS + 5_000);
        assert_eq!(classify(&s).state, BuddyState::Stalled);

        // 有积分在动就不算卡住
        let mut s2 = base();
        s2.silent_ms = Some(DOUBLE_SILENT_MS + 1_000);
        s2.credit_delta = 0.5;
        s2.span_event_age_ms = Some(DOUBLE_SILENT_MS + 5_000);
        assert_eq!(classify(&s2).state, BuddyState::Attention);
    }

    #[test]
    fn pending_beats_silence_and_marks_attention() {
        let mut s = base();
        s.pending_kind = Some("permission".into());
        s.silent_ms = Some(STUCK_MS * 3);
        s.trace_fresh = true;
        s.running = Some(RunningTool { name: "Bash".into(), elapsed_ms: 900_000 });
        let v = classify(&s);
        assert_eq!(v.state, BuddyState::Attention);
        assert!(v.signals.iter().any(|x| x.contains("等你确认")));
    }

    #[test]
    fn main_state_takes_worst() {
        let list = vec![
            (TaskState::Working, BuddyState::Working),
            (TaskState::Stalled, BuddyState::Stalled),
            (TaskState::Completed, BuddyState::Completed),
        ];
        assert_eq!(main_state_of(&list), BuddyState::Stalled);
        assert_eq!(
            main_state_of(&[(TaskState::Working, BuddyState::Working)]),
            BuddyState::Working
        );
        assert_eq!(main_state_of(&[]), BuddyState::Idle);
    }

    #[test]
    fn material_and_size_are_stable() {
        let a = crate::model::material_for("680a4c6b-6a2b-4956-b94b-e446f2839195");
        let b = crate::model::material_for("680a4c6b-6a2b-4956-b94b-e446f2839195");
        assert_eq!(a, b);
        let sz = crate::model::size_for("680a4c6b-6a2b-4956-b94b-e446f2839195");
        assert!((0.86..=1.16).contains(&sz));
    }
}
