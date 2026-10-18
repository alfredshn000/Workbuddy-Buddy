import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Buddy, { type CreditFloat } from './buddy/Buddy';
import TaskPanel from './ui/TaskPanel';
import Toast, { type ToastItem, type ToastKind } from './ui/Toast';
import SettingsPanel from './ui/Settings';
import Bubble from './ui/Bubble';
import Hud from './ui/Hud';
import { MATERIALS, fmtCredit, STATE_ASSET } from './buddy/states';
import type { BuddyEvent, BuddyState, TaskState, TaskSnapshot } from './events';
import { isLegalTransition } from './events';
import { loadSettings, saveSettings, type Settings } from './settings';
import { loadHidden, saveHidden } from './hidden';
import {
  inTauri,
  listenBuddy,
  setPanelExpanded,
  setHitRegion,
  startDrag,
  hideWindow,
  quitApp,
  setFullscreenAutohide,
  takeResetHidden,
  setAutostart,
  setTrayTooltip,
  onOpenSettings,
  onAutostartChanged,
} from './bridge';

const TASK_POOL: TaskState[] = ['working', 'working', 'working', 'attention', 'stalled', 'completed'];
const TITLES = [
  '检查单页构建版本未更新',
  '设计桌面助手形象',
  '迁移探针到 Rust',
  '生成六态渲染图',
  '排查心跳判定误报',
];
const TOOLS = ['Bash', 'Read', 'Write', 'generation', 'mcp_tools'];
const TOAST_TTL = 6000;

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rand = (a: number, b: number) => +(a + Math.random() * (b - a)).toFixed(1);

let seq = 1;

interface CreditSample {
  at: number;
  amount: number;
}

export default function App() {
  const [state, setState] = useState<BuddyState>('working');
  const [tasks, setTasks] = useState<TaskSnapshot[]>([]);
  const [floats, setFloats] = useState<CreditFloat[]>([]);
  const [samples, setSamples] = useState<CreditSample[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [auto, setAuto] = useState(true);
  const [live, setLive] = useState(false);

  /** 被删掉的任务（持久化，重启仍然隐藏） */
  const [hidden, setHidden] = useState<string[]>(() => loadHidden());
  /** 只忽略「这一条」气泡，不写设置、不影响后续提示 */
  const [dismissedBubble, setDismissedBubble] = useState<string | null>(null);
  const [bubbleOpen, setBubbleOpen] = useState(false);

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [bubbleAnchor, setBubbleAnchor] = useState<{ x: number; y: number } | null>(null);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const timers = useRef<number[]>([]);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({ x: 0, y: 0, armed: false, moved: false });
  const bubbleDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const prevStates = useRef(new Map<string, TaskState>());
  const lastHit = useRef('');

  /* ---------------- 积分浮动 ---------------- */
  const spawn = useCallback((kind: 'plus' | 'minus', amount: number, taskId: string | null) => {
    const id = seq++;
    const text = (kind === 'plus' ? '+' : '-') + fmtCredit(amount);
    setFloats((f) => [...f, { id, kind, text, taskId }]);
    if (kind === 'minus') setSamples((s) => [...s, { at: Date.now(), amount }].slice(-200));
    const t = window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1750);
    timers.current.push(t);
  }, []);

  /* ---------------- 通知 ---------------- */
  const pushToast = useCallback((kind: ToastKind, title: string, desc?: string) => {
    const id = `n${seq++}`;
    setToasts((list) => [...list.slice(-5), { id, kind, title, desc }]);
    const t = window.setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), TOAST_TTL);
    timers.current.push(t);
  }, []);

  /* ---------------- 任务（浏览器 mock 用） ---------------- */
  const addTask = useCallback(() => {
    setTasks((prev) => {
      if (prev.length >= 6) return prev;
      return [
        ...prev,
        {
          id: `t${seq++}`,
          title: pick(TITLES),
          state: pick(TASK_POOL),
          material: pick(MATERIALS),
          size: 0.86 + Math.random() * 0.3,
          tool: pick(TOOLS),
          active: true,
        },
      ];
    });
  }, []);

  const removeTask = useCallback(() => setTasks((prev) => prev.slice(0, -1)), []);

  const useCredit = useCallback(() => {
    const visible = tasks.slice(0, 3);
    const amount = rand(0.2, 6);
    if (visible.length) spawn('minus', amount, pick(visible).id);
    else spawn('minus', amount, null);
  }, [tasks, spawn]);

  const gainCredit = useCallback(() => spawn('plus', rand(1, 40), null), [spawn]);

  const changeState = useCallback((to: BuddyState) => {
    setState((from) => {
      if (!isLegalTransition(from, to)) {
        console.warn(`[buddy] 非法状态迁移 ${from} → ${to}（已放行，仅告警）`);
      }
      return to;
    });
  }, []);

  /* ---------------- 可见任务（排除被删掉的） ---------------- */
  const visibleTasks = useMemo(
    () => tasks.filter((t) => !hidden.includes(t.id)),
    [tasks, hidden],
  );

  /** 卫星/气泡/通知只看活跃任务（60 分钟内有过活动）；面板仍然显示全部 */
  const activeTasks = useMemo(
    () => visibleTasks.filter((t) => t.active !== false),
    [visibleTasks],
  );

  const hideTask = useCallback((id: string) => {
    setHidden((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      saveHidden(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  /* ---------------- 真实数据（Tauri） ---------------- */
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const apply = (e: BuddyEvent) => {
      switch (e.type) {
        case 'main:state':
          changeState(e.to);
          break;
        case 'task:upsert':
          setTasks((prev) => {
            const i = prev.findIndex((t) => t.id === e.task.id);
            if (i === -1) return [...prev, e.task];
            const next = prev.slice();
            next[i] = e.task;
            return next;
          });
          break;
        case 'task:remove':
          setTasks((prev) => prev.filter((t) => t.id !== e.taskId));
          break;
        case 'credit':
          spawn(e.kind, e.amount, e.taskId);
          break;
        default:
          break;
      }
    };

    listenBuddy(apply).then((un) => {
      if (disposed) un();
      else {
        unlisten = un;
        setLive(true);
        setAuto(false);
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [changeState, spawn]);

  // 排障：启动时若带 BUDDY_RESET_HIDDEN，清空删除列表
  useEffect(() => {
    if (!inTauri()) return;
    void takeResetHidden().then((pending) => {
      if (!pending) return;
      setHidden([]);
      saveHidden([]);
    });
  }, []);

  // 托盘 tooltip：同步活跃任务数
  useEffect(() => {
    if (!live) return;
    const n = activeTasks.length;
    void setTrayTooltip(n > 0 ? `Buddy · ${n} 个任务` : 'Buddy · 空闲');
  }, [live, activeTasks.length]);

  // 托盘：设置… / 开机自启回传
  useEffect(() => {
    if (!inTauri()) return;
    let undo: (() => void) | undefined;
    let undoAuto: (() => void) | undefined;
    onOpenSettings(() => {
      setPanelOpen(false);
      setSettingsOpen(true);
    }).then((u) => {
      undo = u;
    });
    onAutostartChanged((enabled) => {
      updateSettings({ ...settingsRef.current, launchAtLogin: enabled });
    }).then((u) => {
      undoAuto = u;
    });
    return () => {
      undo?.();
      undoAuto?.();
    };
  }, [updateSettings]);

  /* ---------------- 自动演示（仅浏览器） ---------------- */
  useEffect(() => {
    if (!auto || live) return;
    const iv = window.setInterval(() => {
      const r = Math.random();
      if (r < 0.34) addTask();
      else if (r < 0.72) useCredit();
      else if (r < 0.86) removeTask();
      else gainCredit();
    }, 1800);
    return () => window.clearInterval(iv);
  }, [auto, live, addTask, useCredit, removeTask, gainCredit]);

  /* ---------------- 状态跃迁 → 通知 ---------------- */
  useEffect(() => {
    const prev = prevStates.current;
    for (const t of activeTasks) {
      const before = prev.get(t.id);
      if (before && before !== t.state) {
        if (t.state === 'completed' && settings.notifyDone) {
          pushToast('done', `「${t.title}」已完成`, '点击回到对应会话');
        } else if (t.state === 'attention' && settings.notifyAttention) {
          pushToast('attention', `「${t.title}」等你确认`, '流程被阻塞，需要你点一下');
        } else if (t.state === 'stalled') {
          pushToast('stalled', `「${t.title}」卡住了`, '长时间没有进展');
        }
      }
      prev.set(t.id, t.state);
    }
    for (const id of [...prev.keys()]) {
      if (!activeTasks.some((t) => t.id === id)) prev.delete(id);
    }
  }, [activeTasks, settings.notifyDone, settings.notifyAttention, pushToast]);

  useEffect(() => () => { timers.current.forEach(window.clearTimeout); }, []);

  /* ---------------- 外观 / 窗口 ---------------- */
  useEffect(() => {
    const apply = () => {
      const logical = panelOpen || settingsOpen ? 620 : 320;
      const fit = Math.min(3, Math.max(1, window.innerWidth / logical));
      document.documentElement.style.setProperty('--fit', fit.toFixed(3));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [panelOpen, settingsOpen]);

  useEffect(() => {
    document.body.classList.toggle('live', live);
  }, [live]);

  useEffect(() => {
    if (!live) return;
    void setFullscreenAutohide(settings.autoHideFullscreen);
  }, [live, settings.autoHideFullscreen]);

  // 开机自启：设置里的开关直接写系统
  useEffect(() => {
    if (!live) return;
    void setAutostart(settings.launchAtLogin);
  }, [live, settings.launchAtLogin]);

  useEffect(() => {
    if (!live) return;
    const expanded = panelOpen || settingsOpen;
    document.body.classList.toggle('expanded', expanded);
    dragRef.current = { x: 0, y: 0, armed: false, moved: false };
    void setPanelExpanded(expanded);
  }, [live, panelOpen, settingsOpen]);

  /* ---------------- 可交互区域（球圆 + 气泡矩形） ---------------- */
  const reportHit = useCallback(() => {
    if (!live) return;
    if (panelOpen || settingsOpen) {
      if (lastHit.current !== 'all') {
        lastHit.current = 'all';
        void setHitRegion(null);
      }
      return;
    }
    const stage = stageWrapRef.current?.querySelector('.stage') as HTMLElement | null;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ballR = (r.width * (200 / 260)) / 2 + 8;

    const rects: number[][] = [];
    const bubbleEl = document.querySelector('.bubble-anchor .bubble-wrap') as HTMLElement | null;
    if (bubbleEl) {
      const b = bubbleEl.getBoundingClientRect();
      rects.push([b.left - 6, b.top - 6, b.width + 12, b.height + 12]);
    }

    const key = [
      Math.round(cx),
      Math.round(cy),
      Math.round(ballR),
      rects.map((v) => v.map(Math.round).join('.')).join('|'),
    ].join('/');
    if (key === lastHit.current) return;
    lastHit.current = key;
    void setHitRegion({ cx, cy, r: ballR, rects });
  }, [live, panelOpen, settingsOpen]);

  useEffect(() => {
    if (!live) return;
    const t = window.setTimeout(reportHit, 260);
    window.addEventListener('resize', reportHit);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', reportHit);
    };
  }, [live, reportHit, settings.size, settings.scale]);

  /* ---------------- 气泡锚点（屏幕坐标，不随球缩放） ---------------- */
  useEffect(() => {
    if (!live) return;
    const tick = () => {
      const stage = stageWrapRef.current?.querySelector('.stage') as HTMLElement | null;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const off = dragOffset ?? { x: settings.bubbleOffsetX, y: settings.bubbleOffsetY };
      const x = Math.round(r.left + r.width / 2 + off.x);
      // 0.235 ≈ 渲染图里球体的可见顶端（图有透明边距）
      const y = Math.round(r.top + r.height * 0.235 + off.y);
      setBubbleAnchor((prev) =>
        prev && Math.abs(prev.x - x) < 0.6 && Math.abs(prev.y - y) < 0.6 ? prev : { x, y },
      );
      reportHit();
    };
    tick();
    const iv = window.setInterval(tick, 180);
    return () => window.clearInterval(iv);
  }, [live, dragOffset, settings.bubbleOffsetX, settings.bubbleOffsetY, reportHit]);

  /* ---------------- 拖动气泡 ---------------- */
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = bubbleDrag.current;
      if (!d) return;
      setDragOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    };
    const up = () => {
      const d = bubbleDrag.current;
      if (!d) return;
      bubbleDrag.current = null;
      setDragOffset((cur) => {
        if (cur) updateSettings({ ...settings, bubbleOffsetX: cur.x, bubbleOffsetY: cur.y });
        return null;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [settings, updateSettings]);

  /* ---------------- 派生指标 ---------------- */
  const total = useMemo(() => samples.reduce((a, s) => a + s.amount, 0), [samples]);
  const burnPerMin = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return samples.filter((s) => s.at >= cutoff).reduce((a, s) => a + s.amount, 0);
  }, [samples]);

  const bubble = useMemo<{ text: string | null; tone: 'normal' | 'warn' }>(() => {
    if (!settings.bubbleEnabled) return { text: null, tone: 'normal' };
    const attention = activeTasks.find((t) => t.state === 'attention');
    if (attention) return { text: `「${attention.title}」等你确认`, tone: 'warn' };
    const stalled = activeTasks.find((t) => t.state === 'stalled');
    if (stalled) return { text: `「${stalled.title}」卡住了`, tone: 'warn' };
    const working = activeTasks.find((t) => t.state === 'working');
    if (working?.tool) return { text: `${working.tool} 执行中`, tone: 'normal' };
    if (state === 'offline') return { text: '找不到 WorkBuddy 数据', tone: 'warn' };
    return { text: null, tone: 'normal' };
  }, [activeTasks, state, settings.bubbleEnabled]);

  // 状态变化 → 重新弹气泡；6 秒后自动消失。× 只压制「这一轮」的状态
  const bubbleKey = useMemo(
    () => `${state}|${activeTasks.map((t) => `${t.id}:${t.state}`).join(',')}`,
    [state, activeTasks],
  );

  useEffect(() => {
    if (!bubble.text) return;
    setBubbleOpen(true);
    const t = window.setTimeout(() => setBubbleOpen(false), 6000);
    return () => window.clearTimeout(t);
  }, [bubbleKey, bubble.text]);

  const bubbleText = bubbleOpen && bubble.text && dismissedBubble !== bubbleKey ? bubble.text : null;


  return (
    <div
      className={`app${live ? ' live' : ''}`}
      onContextMenu={(e) => {
        if (!live) return;
        if ((e.target as HTMLElement).closest('.panel-slot')) return;
        e.preventDefault();
        dragRef.current = { x: 0, y: 0, armed: false, moved: false };
        setSettingsOpen((v) => !v);
        setPanelOpen(false);
      }}
      style={{
        ['--buddy-scale' as string]: settings.scale,
        ['--buddy-size' as string]: settings.size,
        ['--buddy-bright' as string]: settings.brightness,
        ['--buddy-alpha' as string]: settings.opacity,
      }}
    >
      <div
        className="stage-wrap"
        ref={stageWrapRef}
        onMouseDown={(e) => {
          if (!live) return;
          if ((e.target as HTMLElement).closest('.panel-slot')) return;
          if (e.button !== 0) return;
          dragRef.current = { x: e.clientX, y: e.clientY, armed: true, moved: false };
        }}
        onMouseMove={(e) => {
          const d = dragRef.current;
          if (!d.armed) return;
          if (Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6) {
            d.armed = false;
            d.moved = true;
            void startDrag();
          }
        }}
        onMouseUp={() => {
          dragRef.current.armed = false;
        }}
        onClick={(e) => {
          if (!live) return;
          if ((e.target as HTMLElement).closest('.panel-slot')) return;
          if (dragRef.current.moved) {
            dragRef.current.moved = false;
            return;
          }
          dragRef.current = { x: 0, y: 0, armed: false, moved: false };
          setPanelOpen((v) => !v);
          setSettingsOpen(false);
        }}
      >
        <Buddy state={state} tasks={activeTasks} floats={floats} />
      </div>

      {bubbleAnchor && bubbleText && (
        <div
          className="bubble-anchor"
          style={{ left: bubbleAnchor.x, top: bubbleAnchor.y }}
          onMouseDown={(e) => {
            if (!live) return;
            e.stopPropagation();
            e.preventDefault();
            bubbleDrag.current = {
              sx: e.clientX,
              sy: e.clientY,
              ox: settings.bubbleOffsetX,
              oy: settings.bubbleOffsetY,
            };
          }}
        >
          <Bubble
            text={bubbleText}
            tone={bubble.tone}
            onClose={() => setDismissedBubble(bubble.text)}
          />
        </div>
      )}

      {panelOpen && (
        <div className="panel-slot">
          <TaskPanel
            tasks={visibleTasks}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            onOpenSettings={() => {
              setPanelOpen(false);
              setSettingsOpen(true);
            }}
            onDelete={hideTask}
          />
        </div>
      )}

      {settingsOpen && (
        <div className="panel-slot">
          <SettingsPanel
            open={settingsOpen}
            value={settings}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
            onHide={() => { void hideWindow(); }}
            onQuit={() => { void quitApp(); }}
            hiddenCount={hidden.length}
            onRestoreHidden={() => {
              setHidden([]);
              saveHidden([]);
            }}
          />
        </div>
      )}

      {!live && <Hud total={total} today={total} burnPerMin={burnPerMin} tasks={activeTasks.length} />}

      {!live && (
        <>
          <div className="row">
            <button className="minus" onClick={useCredit}>消耗积分 −</button>
            <button className="plus" onClick={gainCredit}>新增积分 +</button>
            <button onClick={() => { setPanelOpen((v) => !v); setSettingsOpen(false); }}>任务面板</button>
            <button onClick={() => { setSettingsOpen((v) => !v); setPanelOpen(false); }}>设置</button>
          </div>

          <div className="row">
            {(['idle', 'working', 'attention', 'stalled', 'completed', 'offline'] as BuddyState[]).map((s) => (
              <button key={s} className={state === s ? 'on' : ''} onClick={() => changeState(s)} title={STATE_ASSET[s]}>
                {s}
              </button>
            ))}
          </div>

          <div className="row">
            <button onClick={addTask}>+ 开始任务</button>
            <button onClick={removeTask}>− 结束任务</button>
            <button onClick={() => setTasks([])}>清空</button>
            <button
              className={auto && !live ? 'on' : ''}
              disabled={live}
              onClick={() => setAuto((v) => !v)}
              title={live ? '真实数据模式下自动关闭' : ''}
            >
              {live ? '真实数据' : `自动演示 ${auto ? '开' : '关'}`}
            </button>
          </div>
        </>
      )}

      <Toast items={toasts} onDismiss={(id) => setToasts((l) => l.filter((x) => x.id !== id))} />
    </div>
  );
}
