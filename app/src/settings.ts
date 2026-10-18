/**
 * M2 前端设置：本地偏好，持久化在 localStorage。
 * 读取时逐字段校验，任何单字段非法只回落该字段的默认值。
 */

export interface Settings {
  scale: 1 | 2 | 3;
  slowSec: number;
  stuckSec: number;
  bubbleEnabled: boolean;
  /** 球体尺寸倍数（0.6~1.6），与 scale 相乘 */
  size: number;
  /** 亮度（0.6~1.4） */
  brightness: number;
  /** 不透明度（0.3~1） */
  opacity: number;
  /** 气泡相对球顶的偏移（像素，用户拖动产生） */
  bubbleOffsetX: number;
  bubbleOffsetY: number;
  notifyDone: boolean;
  notifyAttention: boolean;
  launchAtLogin: boolean;
  autoHideFullscreen: boolean;
}

export const SETTINGS_STORAGE_KEY = 'buddy.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  scale: 1,
  slowSec: 90,
  stuckSec: 180,
  bubbleEnabled: true,
  size: 1,
  brightness: 1,
  opacity: 1,
  bubbleOffsetX: 0,
  bubbleOffsetY: 0,
  notifyDone: true,
  notifyAttention: true,
  launchAtLogin: true,
  autoHideFullscreen: true,
};

const SCALES: ReadonlyArray<Settings['scale']> = [1, 2, 3];

function isScale(v: unknown): v is Settings['scale'] {
  return SCALES.includes(v as Settings['scale']);
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

/** 阈值：正整数（不含 0、负数、小数、NaN） */
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** 区间内的有限数；非法时回落到默认值 */
function clampOr(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function readStoredObject(): Record<string, unknown> | null {
  if (typeof localStorage === 'undefined') return null;

  let text: string | null = null;
  try {
    text = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    // 隐私模式等场景下存储不可访问，视为未保存过
    return null;
  }
  if (!text) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 非 JSON：整条记录丢弃，全部使用默认值
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

export function loadSettings(): Settings {
  const raw = readStoredObject();
  const next: Settings = { ...DEFAULT_SETTINGS };
  if (raw === null) return next;

  if (isScale(raw.scale)) next.scale = raw.scale;
  if (isBool(raw.bubbleEnabled)) next.bubbleEnabled = raw.bubbleEnabled;
  if (isBool(raw.notifyDone)) next.notifyDone = raw.notifyDone;
  if (isBool(raw.notifyAttention)) next.notifyAttention = raw.notifyAttention;
  if (isBool(raw.launchAtLogin)) next.launchAtLogin = raw.launchAtLogin;
  if (isBool(raw.autoHideFullscreen)) next.autoHideFullscreen = raw.autoHideFullscreen;
  next.size = clampOr(raw.size, 0.6, 1.6, DEFAULT_SETTINGS.size);
  next.brightness = clampOr(raw.brightness, 0.6, 1.4, DEFAULT_SETTINGS.brightness);
  next.opacity = clampOr(raw.opacity, 0.3, 1, DEFAULT_SETTINGS.opacity);
  next.bubbleOffsetX = clampOr(raw.bubbleOffsetX, -600, 600, 0);
  next.bubbleOffsetY = clampOr(raw.bubbleOffsetY, -600, 600, 0);

  // 两个阈值必须成对成立：任一非法或 stuckSec <= slowSec，则这一对都回落默认
  const slow = isPositiveInt(raw.slowSec) ? raw.slowSec : DEFAULT_SETTINGS.slowSec;
  const stuck = isPositiveInt(raw.stuckSec) ? raw.stuckSec : DEFAULT_SETTINGS.stuckSec;
  if (stuck > slow) {
    next.slowSec = slow;
    next.stuckSec = stuck;
  }

  return next;
}

export function saveSettings(s: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
  } catch (err) {
    // 配额用尽 / 存储被禁用：不打断 UI，仅告警
    console.warn('[settings] 保存设置失败', err);
  }
}
