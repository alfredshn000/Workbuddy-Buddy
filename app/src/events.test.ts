import { describe, it, expect } from 'vitest';
import { LEGAL_TRANSITIONS, isLegalTransition, type BuddyState } from './events';

const ALL_STATES: BuddyState[] = ['idle', 'working', 'attention', 'stalled', 'completed', 'offline'];

describe('isLegalTransition 自反性', () => {
  it('任意状态迁移到自身都合法', () => {
    for (const state of ALL_STATES) {
      expect(isLegalTransition(state, state), `${state} -> ${state}`).toBe(true);
    }
  });
});

describe('isLegalTransition 非法迁移', () => {
  const illegal: Array<[BuddyState, BuddyState]> = [
    ['idle', 'stalled'],
    ['completed', 'attention'],
    ['offline', 'completed'],
  ];

  it.each(illegal)('%s -> %s 必须为 false', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(false);
  });
});

describe('isLegalTransition 合法迁移', () => {
  const legal: Array<[BuddyState, BuddyState]> = [
    ['working', 'stalled'],
    ['working', 'completed'],
    ['stalled', 'working'],
    ['attention', 'working'],
  ];

  it.each(legal)('%s -> %s 必须为 true', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
  });
});

describe('LEGAL_TRANSITIONS 表结构', () => {
  it('每个 BuddyState 都在表中配置（防漏配）', () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it('表中每个目标状态都是合法状态', () => {
    for (const [from, targets] of Object.entries(LEGAL_TRANSITIONS)) {
      expect(targets.length, `${from} 的目标列表不应为空`).toBeGreaterThan(0);
      for (const to of targets) {
        expect(ALL_STATES, `${from} -> ${to}`).toContain(to);
      }
    }
  });
});
