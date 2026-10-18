import type { BuddyState, Material, TaskState } from '../events';

export const STATE_ASSET: Record<BuddyState, string> = {
  idle: '/buddy/buddy-idle.png',
  working: '/buddy/buddy-working.png',
  attention: '/buddy/buddy-attention.png',
  stalled: '/buddy/buddy-stalled.png',
  completed: '/buddy/buddy-completed.png',
  offline: '/buddy/buddy-offline.png',
};

export const STATE_COLOR: Record<BuddyState | TaskState, string> = {
  idle: '#9FB6C2',
  working: '#4FD8EE',
  attention: '#F0A93A',
  stalled: '#F2455C',
  completed: '#3FD68A',
  offline: '#8C949B',
};

export const STATE_GLOW: Record<BuddyState | TaskState, string> = {
  idle: 'rgba(47,168,191,.20)',
  working: 'rgba(79,216,238,.42)',
  attention: 'rgba(240,169,58,.45)',
  stalled: 'rgba(242,69,92,.50)',
  completed: 'rgba(63,214,138,.42)',
  offline: 'rgba(0,0,0,0)',
};

export const MATERIAL_ASSET: Record<Material, string> = {
  pearl: '/buddy/sat-pearl.png',
  chrome: '/buddy/sat-chrome.png',
  frosted: '/buddy/sat-frosted.png',
  ceramic: '/buddy/sat-ceramic.png',
  carbon: '/buddy/sat-carbon.png',
  amber: '/buddy/sat-amber.png',
  copper: '/buddy/sat-copper.png',
  water: '/buddy/sat-water.png',
  brushed: '/buddy/sat-brushed.png',
  marble: '/buddy/sat-marble.png',
  stone: '/buddy/sat-stone.png',
};

export const MATERIALS: Material[] = [
  'pearl', 'chrome', 'frosted', 'ceramic', 'carbon', 'amber',
  'copper', 'water', 'brushed', 'marble', 'stone',
];

/** 积分浮动配色：新增=绿（与完成同色），消耗=蓝（与工作同色） */
export const CREDIT_COLOR = { plus: '#3FD68A', minus: '#3FC8E8' } as const;

export const CREDIT_TIMING = { enter: 140, hold: 900, exit: 700, total: 1740 } as const;

export const fmtCredit = (v: number): string => (v >= 100 ? String(Math.round(v)) : v.toFixed(1));
