/**
 * Buddy 事件协议（Rust 采集层 → 前端渲染层）
 *
 * 设计原则：
 * 1. 后端只推「增量事件」，不推整棵树 —— 前端状态可以从事件流重建；
 * 2. 每个事件带 at（ms epoch），前端据此做去重与迟到丢弃；
 * 3. 积分带 taskId：有归属就画在卫星上，无归属（新增/无任务时）画在主球上方。
 *
 * 与 docs/02-data-contract.md 的判定结果一一对应：Rust 侧的 judge.rs 产出这些事件。
 */

export type BuddyState = 'idle' | 'working' | 'attention' | 'stalled' | 'completed' | 'offline';

export type TaskState = 'working' | 'attention' | 'stalled' | 'completed';

export type Material =
  | 'pearl' | 'chrome' | 'frosted' | 'ceramic' | 'carbon' | 'amber'
  | 'copper' | 'water' | 'brushed' | 'marble' | 'stone';

export interface TaskSnapshot {
  id: string;
  title: string;
  state: TaskState;
  /** 材质由 Rust 侧随机分配后固定，保证同一任务刷新不变 */
  material: Material;
  /** 相对大小 0.86~1.16 */
  size: number;
  /** 当前正在执行的工具名，用于气泡 */
  tool?: string | null;
  /** 60 分钟内有过活动才算出卫星；缺省视为活跃 */
  active?: boolean;
}

export type BuddyEvent =
  | { type: 'main:state'; at: number; to: BuddyState }
  | { type: 'task:upsert'; at: number; task: TaskSnapshot }
  | { type: 'task:remove'; at: number; taskId: string }
  | { type: 'credit'; at: number; kind: 'plus' | 'minus'; amount: number; taskId: string | null }
  | { type: 'heartbeat'; at: number };

export type EventSource = (emit: (e: BuddyEvent) => void) => () => void;

/** 事件 → 会话状态的合法迁移（用于前端自检，避免非法跳变） */
export const LEGAL_TRANSITIONS: Record<BuddyState, BuddyState[]> = {
  idle: ['working', 'offline', 'idle'],
  working: ['idle', 'attention', 'stalled', 'completed', 'offline', 'working'],
  attention: ['working', 'idle', 'stalled', 'offline', 'attention'],
  stalled: ['working', 'attention', 'idle', 'offline', 'completed', 'stalled'],
  completed: ['idle', 'working', 'offline', 'completed'],
  offline: ['idle', 'working', 'offline'],
};

export function isLegalTransition(from: BuddyState, to: BuddyState): boolean {
  return from === to || (LEGAL_TRANSITIONS[from]?.includes(to) ?? false);
}
