#!/usr/bin/env node
// WorkBuddy 本地数据探针 (M1)
// 只读观察 ~/.workbuddy：任务状态 / 当前工具 / 积分增量 / 卡住判定。
// 不写被测目录的任何文件；自身状态落在 probe/state/。

import { existsSync, readdirSync, readFileSync, statSync, openSync, readSync, closeSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const WB_HOME = process.env.WORKBUDDY_HOME || join(homedir(), '.workbuddy');
const STATE_DIR = join(HERE, 'state');
const STATE_FILE = join(STATE_DIR, 'state.json');

const TH = {
  // 心跳不定期（实测 19s / 272s 两档），只作展示，不参与存活判定
  staleHeartbeatMs: 900_000,
  slowSilentMs: 90_000,
  stuckSilentMs: 180_000,
  doubleSilentMs: 120_000,
  sleepAfterMs: 300_000,
  traceFreshMs: 120_000,
  processLostMs: 900_000,
  traceTailBytes: 256 * 1024,
};

// 工具超时基线：按工具类型给默认值，再与自身历史 P90 取大
// 一刀切 60s 会把长命令/构建误判成卡住（实测：55s 的 Bash 直接触发误报）
const TOOL_BASE_MS = {
  Bash: 300_000,
  mcp_tools: 300_000,
  generation: 120_000,
  Read: 60_000,
  Write: 60_000,
  Edit: 60_000,
};
const TOOL_BASE_DEFAULT_MS = 120_000;

function toolTimeoutMs(name, p90) {
  const base = TOOL_BASE_MS[name] ?? TOOL_BASE_DEFAULT_MS;
  return Math.max(base, Math.round((p90 || 0) * 3));
}

const ARGS = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { json: false, watch: 0, all: false, since: 1440 };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (a.startsWith('--watch')) out.watch = Number(a.split('=')[1] || 1000);
    else if (a.startsWith('--since')) out.since = Number(a.split('=')[1] || 1440);
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`workbuddy-buddy probe (M1)

  --json             输出完整快照 JSON
  --watch[=ms]       持续观察，只打印事件（默认 1000ms）
  --all              包含已结束/已删除会话
  --since=<min>      只显示最近 N 分钟内活跃的会话（默认 1440）

环境变量 WORKBUDDY_HOME 可指定数据目录，默认 ~/.workbuddy
`);
}

// ---------- 基础工具 ----------

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function ageFromMs(ms) {
  if (!ms) return null;
  return Date.now() - ms;
}

// pid 存活是唯一可靠的"进程还在不在"判据（心跳周期不定期，不可用）
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readTail(path, bytes) {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    return text;
  } finally {
    closeSync(fd);
  }
}

function widthOf(str) {
  let w = 0;
  for (const ch of str) w += /[\u1100-\uFFDC]/.test(ch) ? 2 : 1;
  return w;
}

function pad(str, n, align = 'left') {
  const s = String(str ?? '');
  const space = ' '.repeat(Math.max(0, n - widthOf(s)));
  return align === 'right' ? space + s : s + space;
}

function clip(str, n) {
  const s = String(str ?? '');
  if (widthOf(s) <= n) return s;
  let out = '', w = 0;
  for (const ch of s) {
    const cw = /[\u1100-\uFFDC]/.test(ch) ? 2 : 1;
    if (w + cw > n - 1) break;
    out += ch; w += cw;
  }
  return out + '…';
}

function fmtDur(ms) {
  if (ms == null) return '-';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function fmtAt(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// ---------- 数据源 ----------

function loadHeartbeats() {
  const dir = join(WB_HOME, 'sessions');
  if (!existsSync(dir)) return { status: 'missing', byId: new Map(), list: [] };
  const list = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = readJson(join(dir, f));
    if (!j || !j.sessionId) continue;
    list.push({
      pid: j.pid,
      sessionId: j.sessionId,
      heartbeat: j.lastHeartbeat || null,
      startedAt: j.startedAt || null,
      cwd: j.cwd || null,
      kind: j.kind || null,
      version: j.version || null,
    });
  }
  const byId = new Map(list.map((h) => [h.sessionId, h]));
  return { status: 'ok', byId, list };
}

function loadSidebar() {
  if (!existsSync(WB_HOME)) return { status: 'missing', byId: new Map() };
  for (const d of readdirSync(WB_HOME)) {
    const p = join(WB_HOME, d, 'sidebar-list-snapshot.json');
    if (!existsSync(p)) continue;
    const j = readJson(p);
    if (!j || !Array.isArray(j.items)) continue;
    const byId = new Map();
    for (const it of j.items) {
      byId.set(it.id, {
        title: it.title || null,
        state: String(it.state || '').toLowerCase() || null,
        lastActivityAt: it.lastActivityAt || null,
        kind: it.kind || null,
        space: it.space?.name || null,
      });
    }
    return { status: 'ok', byId, savedAt: j.savedAt || null, path: p };
  }
  return { status: 'missing', byId: new Map() };
}

async function loadDb() {
  const p = join(WB_HOME, 'workbuddy.db');
  if (!existsSync(p)) return { status: 'missing', sessions: [], usage: new Map() };
  let lastErr = null;
  // WorkBuddy 在写库时可能拿到 SQLITE_BUSY，重试几次再决定降级
  for (let attempt = 0; attempt < 3; attempt++) {
    let db = null;
    try {
      process.emitWarning = () => {};
      const { DatabaseSync } = await import('node:sqlite');
      db = new DatabaseSync(p, { readOnly: true });
      const sessions = db
        .prepare(`select id, title, custom_title, status, model, mode, cwd, last_activity_at, updated_at, deleted_at from sessions`)
        .all();
      const usage = new Map();
      for (const u of db.prepare(`select session_id, used, size, updated_at, credit_json from session_usage`).all()) {
        let turns = {};
        try { turns = JSON.parse(u.credit_json || '{}'); } catch { turns = {}; }
        const keys = Object.keys(turns);
        const maxTurn = keys.length ? keys.slice().sort().at(-1) : null;
        usage.set(u.session_id, {
          used: u.used,
          size: u.size,
          updatedAt: u.updated_at,
          turns,
          count: keys.length,
          total: Object.values(turns).reduce((a, b) => a + Number(b || 0), 0),
          maxTurn,
          // 回合进行中同一 key 的值会被反复累加，所以"本轮花费"要读最后一条的值
          lastTurnCredit: maxTurn ? Number(turns[maxTurn] || 0) : 0,
        });
      }
      return { status: 'ok', sessions, usage };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    } finally {
      try { db?.close(); } catch {}
    }
  }
  return { status: 'error', error: String(lastErr?.message || lastErr), sessions: [], usage: new Map() };
}

function scanTrace(pid) {
  const dir = join(WB_HOME, 'traces', String(pid));
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => { const p = join(dir, f); return { p, mtime: statSync(p).mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) return null;

  const tail = readTail(files[0].p, TH.traceTailBytes);
  const open = new Map();
  const durations = [];
  let lastEventAt = null;
  let ended = false;

  for (const line of tail.split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const sp = o.span;
    if (o.type === 'span_start' && sp) {
      open.set(sp.spanId, { name: sp.name, startedAt: sp.startedAt, parentId: sp.parentId ?? null });
    } else if (o.type === 'span_end' && sp) {
      const s = open.get(sp.spanId);
      if (s && sp.endedAt) durations.push({ name: s.name, ms: Date.parse(sp.endedAt) - Date.parse(s.startedAt) });
      open.delete(sp.spanId);
      if (sp.endedAt) lastEventAt = Math.max(lastEventAt || 0, Date.parse(sp.endedAt));
    } else if (o.type === 'trace_end') {
      ended = true;
      const t = o.trace?.endedAt;
      if (t) lastEventAt = Math.max(lastEventAt || 0, Date.parse(t));
    }
  }

  const now = Date.now();
  const running = [...open.values()]
    .map((s) => ({ name: s.name, runningMs: now - Date.parse(s.startedAt) }))
    .filter((s) => Number.isFinite(s.runningMs) && s.runningMs < 30 * 60_000)
    .sort((a, b) => a.runningMs - b.runningMs);

  const p90 = new Map();
  const grouped = new Map();
  for (const d of durations) {
    if (!grouped.has(d.name)) grouped.set(d.name, []);
    grouped.get(d.name).push(d.ms);
  }
  for (const [name, arr] of grouped) {
    arr.sort((a, b) => a - b);
    p90.set(name, arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.9))]);
  }

  return {
    file: files[0].p,
    fileMtime: files[0].mtime,
    ended,
    running: running[0] || null,
    runningAll: running,
    p90,
    lastEventAt,
    spanEventAgeMs: lastEventAt ? now - lastEventAt : null,
  };
}

function scanTasks(sessionId) {
  for (const name of [sessionId, `_auto_${sessionId}`]) {
    const dir = join(WB_HOME, 'tasks', name);
    if (!existsSync(dir)) continue;
    const items = readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => readJson(join(dir, f)))
      .filter(Boolean);
    if (!items.length) continue;
    const current = items.find((i) => i.status === 'in_progress');
    return {
      total: items.length,
      done: items.filter((i) => i.status === 'completed').length,
      current: current ? current.activeForm || current.subject : null,
    };
  }
  return null;
}

// ---------- 积分差分 ----------

function loadState() {
  const j = readJson(STATE_FILE);
  return j && j.sessions ? j : { version: 1, sessions: {} };
}

function saveState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: Date.now() }, null, 2));
    renameSync(tmp, STATE_FILE); // 原子替换：被信号杀掉也不会写出半个文件
  } catch { /* 状态文件不可写不影响观察 */ }
}

function diffCredits(usage, prevState) {
  const next = { version: 1, sessions: {} };
  const out = new Map();
  for (const [sid, u] of usage) {
    const prev = prevState.sessions[sid];
    const baseline = !prev;
    const delta = baseline ? 0 : Number((u.total - (prev.total || 0)).toFixed(4));
    out.set(sid, {
      total: Number(u.total.toFixed(2)),
      delta,
      baseline,
      turns: u.count,
      lastTurnCredit: Number(u.lastTurnCredit.toFixed(2)),
    });
    next.sessions[sid] = { maxTurn: u.maxTurn, total: u.total };
  }
  return { credits: out, next };
}
// ---------- 判定 ----------

// 判定顺序：进程死没死 → 工具超时 → 长时间静默 → 双静默 → 迟缓
function classify(s, pid, trace, credit) {
  const now = Date.now();
  const signals = [];
  const silentMs = s.lastActivityAt ? now - s.lastActivityAt : null;
  const traceFresh = !!trace && !trace.ended && now - trace.fileMtime < TH.traceFreshMs;

  if (s.status !== 'working') {
    if (s.status === 'terminated') return { state: 'offline', signals: ['会话已终止'] };
    if (s.status === 'completed') return { state: 'done', signals: [] };
    return { state: 'idle', signals: [] };
  }

  if (pid && !isPidAlive(pid)) {
    return { state: 'offline', signals: [`进程 ${pid} 已退出`] };
  }
  if (!pid && silentMs != null && silentMs > TH.processLostMs) {
    return { state: 'offline', signals: [`无进程记录，静默 ${fmtDur(silentMs)}`] };
  }

  if (traceFresh && trace.running) {
    const limit = toolTimeoutMs(trace.running.name, trace.p90.get(trace.running.name));
    if (trace.running.runningMs > limit) {
      return { state: 'stuck', signals: [`${trace.running.name} 超时 ${fmtDur(trace.running.runningMs)} > ${fmtDur(limit)}`] };
    }
  }
  if (silentMs != null && silentMs > TH.stuckSilentMs) {
    return { state: 'stuck', signals: [`静默 ${fmtDur(silentMs)}`] };
  }
  const noCredit = (credit?.delta ?? 0) === 0;
  const noSpanEvent = !trace?.lastEventAt || now - trace.lastEventAt > TH.doubleSilentMs;
  if (noCredit && noSpanEvent && silentMs != null && silentMs > TH.doubleSilentMs) {
    return { state: 'stuck', signals: ['积分与 trace 双静默'] };
  }
  if (silentMs != null && silentMs > TH.slowSilentMs) {
    return { state: 'slow', signals: [`迟缓 ${fmtDur(silentMs)}`] };
  }
  return { state: 'working', signals };
}

// ---------- 快照 ----------

async function buildSnapshot(prevState) {
  const hb = loadHeartbeats();
  const sidebar = loadSidebar();
  const db = await loadDb();
  const { credits, next } = diffCredits(db.usage, prevState);

  const now = Date.now();
  const rows = [];
  const seen = new Set();

  for (const s of db.sessions) {
    if (s.deleted_at) continue;
    const side = sidebar.byId.get(s.id);
    const h = hb.byId.get(s.id);
    const credit = credits.get(s.id) || null;
    const trace = h?.pid ? scanTrace(h.pid) : null;

    // 活动时间取全部源的 max：sidebar 快照可能滞后数分钟，取 max 天然抗陈旧
    const lastActivityAt = Math.max(
      s.last_activity_at || 0,
      s.updated_at || 0,
      side?.lastActivityAt || 0,
      trace?.fileMtime || 0,
      db.usage.get(s.id)?.updatedAt || 0,
    );
    if (!ARGS.all && ARGS.since > 0 && now - lastActivityAt > ARGS.since * 60_000) continue;

    // 状态以 db.sessions.status 为准：sidebar 快照不是实时源
    const status = String(s.status || '').toLowerCase();
    const progress = scanTasks(s.id);
    const verdict = classify({ status, lastActivityAt }, h?.pid, trace, credit);

    rows.push({
      id: s.id,
      title: s.custom_title || s.title || '(无标题)',
      cwd: s.cwd,
      model: s.model,
      mode: s.mode,
      pid: h?.pid ?? null,
      sideState: side?.state ?? null,
      alive: !!(h?.pid && isPidAlive(h.pid)),
      state: verdict.state,
      rawState: status,
      signals: verdict.signals,
      silentMs: lastActivityAt ? now - lastActivityAt : null,
      tool: trace?.running || null,
      traceFresh: !!trace && !trace.ended && now - trace.fileMtime < TH.traceFreshMs,
      traceEnded: trace?.ended ?? null,
      progress,
      credit,
      context: db.usage.get(s.id) ? { used: db.usage.get(s.id).used, size: db.usage.get(s.id).size } : null,
    });
    seen.add(s.id);
  }

  rows.sort((a, b) => {
    const rank = { working: 0, slow: 0, stuck: 1, done: 2, idle: 3, offline: 4 };
    const d = rank[a.state] - rank[b.state];
    return d !== 0 ? d : (b.silentMs ?? 0) - (a.silentMs ?? 0);
  });

  const totals = {
    sessions: rows.length,
    working: rows.filter((r) => ['working', 'slow', 'stuck'].includes(r.state)).length,
    stuck: rows.filter((r) => r.state === 'stuck').length,
    creditTotal: Number(rows.reduce((a, r) => a + (r.credit?.total || 0), 0).toFixed(2)),
    creditDelta: Number(rows.reduce((a, r) => a + Math.max(0, r.credit?.delta || 0), 0).toFixed(4)),
  };

  const sources = { heartbeat: hb.status, sidebar: sidebar.status, db: db.status, traces: 'ok' };
  if (db.status === 'error') sources.dbError = db.error;

  // db 读失败时不产出新基线：否则空 usage 会把积分基线冲掉，增量永远算不出来
  return { at: now, home: WB_HOME, sources, totals, sessions: rows, _nextState: db.status === 'ok' ? next : null };
}

// ---------- 输出 ----------

function renderTable(snap) {
  const L = [];
  const src = Object.entries(snap.sources)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  L.push(`workbuddy-buddy probe  ${new Date(snap.at).toLocaleString('zh-CN')}`);
  L.push(`home: ${snap.home}`);
  L.push(`sources: ${src}`);
  L.push('');

  const head = ['状态', '会话', '当前动作', '静默', '进度', '累计', 'Δ'];
  const widths = [8, 30, 26, 6, 7, 8, 7];
  L.push(head.map((h, i) => pad(h, widths[i])).join('  '));
  L.push(widths.map((w) => '-'.repeat(w)).join('  '));

  for (const r of snap.sessions) {
    const tool = r.traceFresh && r.tool
      ? `${r.tool.name} ${fmtDur(r.tool.runningMs)}`
      : (r.progress?.current || '-');
    const prog = r.progress ? `${r.progress.done}/${r.progress.total}` : '-';
    const delta = r.credit ? (r.credit.baseline ? 'base' : (r.credit.delta > 0 ? `+${r.credit.delta}` : '0')) : '-';
    L.push([
      pad(r.state, widths[0]),
      pad(clip(r.title, widths[1]), widths[1]),
      pad(clip(tool, widths[2]), widths[2]),
      pad(fmtDur(r.silentMs), widths[3], 'right'),
      pad(prog, widths[4], 'right'),
      pad(r.credit ? r.credit.total : '-', widths[5], 'right'),
      pad(delta, widths[6], 'right'),
    ].join('  '));
  }

  L.push('');
  L.push(`合计: ${snap.totals.sessions} 会话 / ${snap.totals.working} 进行中 / ${snap.totals.stuck} 卡住 | 积分累计 ${snap.totals.creditTotal} | 较上次 +${snap.totals.creditDelta}`);
  if (snap.sources.db !== 'ok') {
    L.push(`  ! 数据库不可用（${snap.sources.db}${snap.sources.dbError ? ': ' + snap.sources.dbError : ''}）—— 已降级，状态与积分可能缺失`);
  }
  const notes = snap.sessions.flatMap((r) => r.signals.map((s) => `  ! ${clip(r.title, 20)}: ${s}`));
  if (notes.length) { L.push(''); L.push(...notes); }
  process.stdout.write(L.join('\n') + '\n');
}

function diffEvents(prev, next) {
  const out = [];
  const prevById = new Map((prev?.sessions || []).map((s) => [s.id, s]));
  for (const s of next.sessions) {
    const p = prevById.get(s.id);
    if (!p) { out.push({ type: 'appear', sid: s.id, title: s.title, state: s.state }); continue; }
    if (p.state !== s.state) out.push({ type: 'state', sid: s.id, title: s.title, from: p.state, to: s.state, signals: s.signals });
    const d = (s.credit?.delta ?? 0);
    if (d > 0) out.push({ type: 'credit', sid: s.id, title: s.title, delta: d, total: s.credit.total, lastTurnCredit: s.credit.lastTurnCredit });
    if (p.tool?.name !== s.tool?.name) out.push({ type: 'tool', sid: s.id, title: s.title, from: p.tool?.name ?? null, to: s.tool?.name ?? null });
  }
  return out;
}

const MARK = { appear: '>', state: '*', credit: '+', tool: '~' };

function printEvent(e) {
  const t = fmtAt(Date.now());
  if (e.type === 'credit') {
    process.stdout.write(`[${t}] + 积分 +${e.delta}  本轮 ${e.lastTurnCredit}  累计 ${e.total}  ${clip(e.title, 24)}\n`);
  } else if (e.type === 'state') {
    process.stdout.write(`[${t}] * ${clip(e.title, 24)}  ${e.from} → ${e.to}${e.signals?.length ? '  (' + e.signals.join('; ') + ')' : ''}\n`);
  } else if (e.type === 'tool') {
    process.stdout.write(`[${t}] ~ ${clip(e.title, 24)}  ${e.from || '空闲'} → ${e.to || '空闲'}\n`);
  } else {
    process.stdout.write(`[${t}] > 新会话 ${clip(e.title, 24)} (${e.state})\n`);
  }
}

// ---------- 主流程 ----------

let prevState = loadState();
let snapshot = await buildSnapshot(prevState);
if (snapshot._nextState) { saveState(snapshot._nextState); prevState = snapshot._nextState; }
delete snapshot._nextState;

if (ARGS.watch) {
  if (!ARGS.json) renderTable(snapshot);
  let prev = snapshot;
  const tick = async () => {
    try {
      const s = await buildSnapshot(prevState);
      if (s._nextState) { prevState = s._nextState; saveState(prevState); }
      delete s._nextState;
      for (const e of diffEvents(prev, s)) printEvent(e);
      prev = s;
    } catch (err) {
      process.stdout.write(`[${fmtAt(Date.now())}] ! probe error: ${err?.message || err}\n`);
    }
    setTimeout(tick, Math.max(200, ARGS.watch));
  };
  setTimeout(tick, Math.max(200, ARGS.watch));
} else if (ARGS.json) {
  process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
} else {
  renderTable(snapshot);
}
