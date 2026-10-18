# app/ — M2 应用（前端已可独立运行）

当前状态：**前端骨架已可跑**（用 mock 事件驱动，不依赖 Rust）；Tauri 外壳待工具链装好后补 `src-tauri/`。

## 已实现

```
app/
├── index.html
├── vite.config.ts          # 端口 5273（5173 留给 HR 招聘系统）
├── tsconfig.json
├── public/buddy/           # Blender 渲染的六态球 + 11 种卫星材质 + ring-path.json
└── src/
    ├── main.tsx
    ├── App.tsx             # mock 驱动 + 调试控件
    ├── styles.css
    ├── events.ts           # 事件协议（Rust → 前端），含合法状态迁移表
    ├── events.test.ts      # 协议单测（迁移表 / 自反性 / 非法跳变）
    ├── buddy/
    │   ├── Buddy.tsx       # 球体 / 光点 / 卫星 / 积分浮动
    │   ├── states.ts       # 状态→素材/颜色/光晕，材质→素材，积分配色与时长
    │   └── states.test.ts  # 表一致性 / fmtCredit / 动画时长自洽
    └── ui/
        ├── Bubble.tsx      # 球顶气泡（当前工具 / 待确认 / 卡住）
        ├── Hud.tsx         # 累计 / 今日 / 燃速 / 任务数
        ├── bubble-hud.css
        ├── TaskPanel.tsx   # 任务面板：按 待确认→卡住→进行中→已完成 分组
        └── TaskPanel.css
```

## 测试

```bash
npm test        # vitest，20 个用例（协议迁移 10 + 状态表 10）
```

## 跑起来

```bash
cd app
npm install
npm run dev        # http://localhost:5273
```

页面底部是调试控件：状态切换、加/减任务、消耗/新增积分、自动演示开关。
**自动演示默认开启**，每 1.8s 随机做一件事，用来观察各种组合。

## 事件协议要点

- 后端只推增量事件：`main:state` / `task:upsert` / `task:remove` / `credit` / `heartbeat`
- `credit` 带 `taskId`：有归属画在卫星上，无归属（新增积分、或当前没有任务）画在主球上方
- 所有事件带 `at`（ms epoch），前端据此去重
- `isLegalTransition()` 用于自检非法状态跳变（当前只告警，不阻断）

## 待补（需 Rust 工具链）

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json     # transparent + alwaysOnTop + skipTaskbar
└── src/
    ├── main.rs
    ├── watcher/        # 从 ../probe/probe.mjs 一比一移植
    └── judge.rs        # working/slow/stuck/done/idle/offline 判定
```

移植时保持不变的三条：**只读** / 活动时间取全部源的 `max` / 状态以 `db.sessions.status` 为准。

## 环境要求

| 依赖 | 状态 |
|---|---|
| Node 22 | ✅ |
| Windows WebView2 | ✅ 已装（154 / 155） |
| Rust toolchain | 安装中 |
| VS Build Tools（MSVC） | 安装中 |
