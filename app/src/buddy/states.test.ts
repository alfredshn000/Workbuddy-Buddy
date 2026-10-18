import { describe, it, expect } from 'vitest';
import type { BuddyState, TaskState } from '../events';
import {
  STATE_ASSET,
  STATE_COLOR,
  STATE_GLOW,
  MATERIAL_ASSET,
  MATERIALS,
  CREDIT_TIMING,
  fmtCredit,
} from './states';

const ALL_STATES: Array<BuddyState | TaskState> = [
  'idle',
  'working',
  'attention',
  'stalled',
  'completed',
  'offline',
];

describe('fmtCredit 积分格式化', () => {
  it.each([
    [0.05, '0.1'],
    [9.94, '9.9'],
    [99.9, '99.9'],
    [100, '100'],
    [1234.56, '1235'],
  ])('%s -> %s', (input, expected) => {
    expect(fmtCredit(input)).toBe(expected);
  });
});

describe('状态表完整性', () => {
  it('STATE_ASSET / STATE_COLOR / STATE_GLOW 的 key 集合完全一致', () => {
    const expected = [...ALL_STATES].sort();
    expect(Object.keys(STATE_ASSET).sort()).toEqual(expected);
    expect(Object.keys(STATE_COLOR).sort()).toEqual(expected);
    expect(Object.keys(STATE_GLOW).sort()).toEqual(expected);
  });
});

describe('材质表完整性', () => {
  it('MATERIAL_ASSET 的 key 数量等于 MATERIALS 长度', () => {
    expect(Object.keys(MATERIAL_ASSET)).toHaveLength(MATERIALS.length);
  });

  it('每个材质都有对应资源路径', () => {
    for (const material of MATERIALS) {
      expect(MATERIAL_ASSET[material], `${material} 缺少资源路径`).toBeTruthy();
    }
  });

  it('MATERIAL_ASSET 与 MATERIALS 集合一致', () => {
    expect(Object.keys(MATERIAL_ASSET).sort()).toEqual([...MATERIALS].sort());
  });
});

describe('CREDIT_TIMING 时长自洽', () => {
  it('enter + hold + exit 等于 total（1740）', () => {
    expect(CREDIT_TIMING.enter + CREDIT_TIMING.hold + CREDIT_TIMING.exit).toBe(
      CREDIT_TIMING.total,
    );
    expect(CREDIT_TIMING.total).toBe(1740);
  });
});
