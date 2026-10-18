import type { BuddyEvent } from './events';

/** 是否运行在 Tauri 壳里（浏览器里跑 dev 时为 false，走 mock） */
export function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type Unlisten = () => void;

/**
 * 订阅 Rust 采集层推来的事件。
 * 事件名固定为 `buddy://event`，payload 与 `events.ts` 的 BuddyEvent 一致。
 */
export async function listenBuddy(handler: (e: BuddyEvent) => void): Promise<Unlisten> {
  if (!inTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<BuddyEvent>('buddy://event', (ev) => handler(ev.payload));
}

/** 面板展开时把窗口横向撑开，并保持右下角锚定（避让任务栏） */
export async function setPanelExpanded(expanded: boolean): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const width = expanded ? 620 : 320;
    const height = expanded ? 380 : 320;
    await win.setSize(new LogicalSize(width, height));

    const monitor = await currentMonitor();
    if (!monitor) return;
    const sf = monitor.scaleFactor;
    const size = monitor.size.toLogical(sf);
    const pos = monitor.position.toLogical(sf);
    const marginRight = 16;
    const marginBottom = 56; // 任务栏高度留白
    await win.setPosition(
      new LogicalPosition(
        Math.round(pos.x + size.width - width - marginRight),
        Math.round(pos.y + size.height - height - marginBottom),
      ),
    );
  } catch (err) {
    console.warn('[bridge] 调整窗口尺寸失败', err);
  }
}

/** 拖动窗口（在球体上按下时调用） */
export async function startDrag(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch (err) {
    console.warn('[bridge] 拖动失败', err);
  }
}

/**
 * 上报「可交互区域」（逻辑像素的圆）：Rust 侧据此做逐像素点击穿透。
 * 传 null 表示整个窗口都可交互（面板展开时）。
 */
export async function setHitRegion(
  region: { cx: number; cy: number; r: number; rects?: number[][] } | null,
): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (!region) {
      await invoke('set_hit_region', { cx: 0, cy: 0, r: 100000, rects: [] });
      return;
    }
    await invoke('set_hit_region', {
      cx: region.cx,
      cy: region.cy,
      r: region.r,
      rects: region.rects ?? [],
    });
  } catch (err) {
    console.warn('[bridge] 上报命中区域失败', err);
  }
}

/** 隐藏窗口（进程与托盘继续存在） */
export async function hideWindow(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  } catch (err) {
    console.warn('[bridge] 隐藏失败', err);
  }
}

/** 退出应用 */
export async function quitApp(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('quit_app');
  } catch (err) {
    console.warn('[bridge] 退出失败', err);
  }
}

/** 全屏自动隐藏开关同步给 Rust（前端只管偏好，检测在 Rust 侧做） */
export async function setFullscreenAutohide(enabled: boolean): Promise<void> {
  if (!inTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_fullscreen_autohide', { enabled });
  } catch (err) {
    console.warn('[bridge] 同步全屏策略失败', err);
  }
}
