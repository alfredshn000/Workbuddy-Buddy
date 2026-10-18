import { useEffect, useRef, type ReactNode } from 'react';
import type { BuddyState, TaskSnapshot } from '../events';
import { MATERIAL_ASSET, STATE_ASSET, STATE_COLOR, STATE_GLOW } from './states';

export interface CreditFloat {
  id: number;
  kind: 'plus' | 'minus';
  text: string;
  taskId: string | null;
}

interface Props {
  state: BuddyState;
  tasks: TaskSnapshot[];
  floats: CreditFloat[];
  onSatClick?: (id: string) => void;
  children?: ReactNode;
}

const IMG = 200;
const SRC = 512;
const SCALE = IMG / SRC;
const ORIGIN = { x: 30, y: 25 };
const SPIN_MS = 14000;
const ORBIT = { cx: 130, cy: 125, r: 96, squash: 0.3 };
const MAX_SHOWN = 3;

type RingPoint = [number, number, number];

export default function Buddy({ state, tasks, floats, onSatClick, children }: Props) {

  const orbRef = useRef<HTMLImageElement | null>(null);
  const bloomRef = useRef<HTMLDivElement | null>(null);
  const beadRefs = useRef<(HTMLDivElement | null)[]>([]);
  const satRefs = useRef(new Map<string, HTMLDivElement>());
  const ringRef = useRef<RingPoint[] | null>(null);
  // 轨道只启动一次：用 ref 读最新数据，避免 tasks 变化重启动画导致卫星跳回起点
  const tasksRef = useRef<TaskSnapshot[]>(tasks);
  const stateRef = useRef<BuddyState>(state);
  const orbitRef = useRef(new Map<string, { phase: number; radius: number }>());
  const nextSlot = useRef(0);

  tasksRef.current = tasks;
  stateRef.current = state;

  // 新卫星分配固定相位（黄金角散开）；已有卫星的相位与半径永不变动
  for (const t of tasks) {
    if (!orbitRef.current.has(t.id)) {
      const i = nextSlot.current++;
      orbitRef.current.set(t.id, { phase: i * 2.399963, radius: 92 + (i % 3) * 7 });
    }
  }
  for (const id of [...orbitRef.current.keys()]) {
    if (!tasks.some((t) => t.id === id)) orbitRef.current.delete(id);
  }

  // 载入 Blender 导出的环投影轨迹（512 空间 + near 标记）
  useEffect(() => {
    let alive = true;
    fetch('/buddy/ring-path.json')
      .then((r) => r.json())
      .then((j: { points: { x: number; y: number; near: boolean }[] }) => {
        if (!alive) return;
        ringRef.current = j.points.map((p) => [p.x, p.y, p.near ? 1 : 0]);
      })
      .catch(() => { /* 轨迹缺失时只是没有光点，不阻塞渲染 */ });
    return () => { alive = false; };
  }, []);

  // 主球换图：用两次 opacity 过渡避免闪
  useEffect(() => {
    const el = orbRef.current;
    if (!el) return;
    el.style.opacity = '0';
    const t = window.setTimeout(() => {
      el.src = STATE_ASSET[state];
      el.style.opacity = '1';
    }, 140);
    return () => window.clearTimeout(t);
  }, [state]);

  // 光晕跟随状态
  useEffect(() => {
    if (bloomRef.current) {
      bloomRef.current.style.background =
        `radial-gradient(circle at 50% 50%, ${STATE_GLOW[state]} 0%, rgba(0,0,0,0) 62%)`;
    }
  }, [state]);

  // 轨道动画：光点沿环走，卫星椭圆公转，越远越小越暗
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      const ang = ((now - t0) / SPIN_MS) * Math.PI * 2;
      const ring = ringRef.current;
      if (ring) {
        const n = ring.length;
        beadRefs.current.forEach((el, i) => {
          if (!el) return;
          const f = ((((i / 3) + ang / (Math.PI * 2)) % 1) + 1) % 1 * n;
          const i0 = Math.floor(f);
          const i1 = (i0 + 1) % n;
          const k = f - i0;
          const a = ring[i0];
          const b = ring[i1];
          const x = ORIGIN.x + (a[0] + (b[0] - a[0]) * k) * SCALE;
          const y = ORIGIN.y + (a[1] + (b[1] - a[1]) * k) * SCALE;
          const near = (k < 0.5 ? a[2] : b[2]) === 1;
          el.style.transform = `translate(${x}px, ${y}px)`;
          el.style.opacity = near ? '1' : '0';
          el.style.zIndex = near ? '3' : '1';
        });
        beadRefs.current.forEach((el) => {
          if (el) el.style.setProperty('--bead', STATE_COLOR[stateRef.current]);
        });
      }

      const visible = tasksRef.current.slice(0, MAX_SHOWN);
      visible.forEach((t) => {
        const el = satRefs.current.get(t.id);
        const slot = orbitRef.current.get(t.id);
        if (!el || !slot) return;
        const th = ang * 0.55 + slot.phase;
        const x = Math.cos(th) * slot.radius;
        const y = Math.sin(th) * slot.radius * ORBIT.squash;
        const near = y > 0;
        el.style.left = `${ORBIT.cx + x}px`;
        el.style.top = `${ORBIT.cy + y}px`;
        el.style.zIndex = near ? '3' : '1';
        const body = el.firstElementChild as HTMLElement | null;
        if (body) body.style.transform = `scale(${((near ? 1 : 0.86) * t.size).toFixed(3)})`;
        el.style.opacity = near ? '1' : '0.72';
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const mainFloats = floats.filter((f) => !f.taskId);
  const extra = Math.max(0, tasks.length - MAX_SHOWN);

  return (
    <div className="stage">
      <div className="bloom" ref={bloomRef} />
      <div className="ground" />
      <div className="ground near" />

      {children}

      <img className="buddy" ref={orbRef} src={STATE_ASSET[state]} alt="" />

      <div className="beads">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bead" ref={(el) => { beadRefs.current[i] = el; }} />
        ))}
      </div>

      <div className="sats">
        {tasks.map((t) => (
          <div
            key={t.id}
            className="sat"
            ref={(el) => {
              if (el) satRefs.current.set(t.id, el);
              else satRefs.current.delete(t.id);
            }}
            style={{ display: tasks.indexOf(t) < MAX_SHOWN ? 'block' : 'none' }}
          >
            <div
              className="body"
              onClick={(e) => { e.stopPropagation(); onSatClick?.(t.id); }}
              title={t.title}
            >
              <img src={MATERIAL_ASSET[t.material]} alt="" />
              <div className="halo" style={{ ['--sg' as string]: STATE_GLOW[t.state] }} />
              <div className="dot" style={{ ['--sc' as string]: STATE_COLOR[t.state] }} />
            </div>
            {floats.filter((f) => f.taskId === t.id).map((f) => (
              <div key={f.id} className={`sat-float ${f.kind}`}>{f.text}</div>
            ))}
          </div>
        ))}
      </div>

      {extra > 0 && <div className="badge">+{extra}</div>}

      <div className="floats">
        {mainFloats.slice(-3).map((f, i, arr) => (
          <div key={f.id} className="slot" style={{ transform: `translateX(-50%) translateY(${(arr.length - 1 - i) * -18}px)` }}>
            <span className={`num ${f.kind}`}>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
