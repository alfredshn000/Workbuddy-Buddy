/**
 * 被用户从面板里删掉的任务（会话 id）。
 * 删除是持久的：这些会话不再出小卫星、不再弹通知；重启后依然隐藏。
 */
const KEY = 'buddy.hiddenSessions.v1';

export function loadHidden(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, 500);
  } catch {
    return [];
  }
}

export function saveHidden(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, 500)));
  } catch (err) {
    console.warn('[hidden] 保存失败', err);
  }
}
