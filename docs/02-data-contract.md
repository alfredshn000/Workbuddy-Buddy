# 02 本地数据契约（M1 实测冻结）

所有字段均在 Windows / WorkBuddy 2.161.0 上实测确认。**加粗的"坑"是踩过的，别想当然。**

根目录：`$WORKBUDDY_HOME`，默认 `~/.workbuddy`。

```
~/.workbuddy/
├── sessions/<pid>.json                       # 每个存活进程一个
├── <uid>/sidebar-list-snapshot.json          # uid = 32 位 hex
├── workbuddy.db (+ -wal / -shm)              # journal_mode = WAL
├── traces/<pid>/trace_<id>.jsonl             # 每个 agent 回合一个文件
└── tasks/<sessionId>/<n>.json                # 以及 tasks/_auto_<sessionId>/
```

## S1 · `sessions/<pid>.json` — 进程心跳

| 字段 | 类型 | 说明 |
|---|---|---|
| `pid` | int | 进程号，与文件名一致 |
| `sessionId` | string(uuid) | 关联 db.sessions.id |
| `lastHeartbeat` | int(ms epoch) | 心跳 |
| `startedAt` | int(ms epoch) | 进程启动 |
| `cwd` | string | 工作目录（Windows 含反斜杠） |
| `kind` | `interactive` / … | 进程类型 |
| `url` / `endpoint` | string | 该会话的本地 ACP 端口，本项目**不使用** |
| `version` | string | WorkBuddy 版本 |

**坑（实测）**：文件按 pid 命名，进程退出后**文件会长期留存**（实测存在 45+ 个历史 pid 目录/文件）。因此"文件存在"不等于存活。
**坑（实测修正）**：`lastHeartbeat` **不是秒级心跳**——同一时刻实测到 `19s` 与 `272s` 两档，没有稳定周期。用 30s 阈值判存活会把所有会话误判为断连。

→ **存活判定改用操作系统级 pid 探测**：`process.kill(pid, 0)`（Rust 侧 `sysinfo` 或 `OpenProcess` / `kill(pid,0)`）。心跳值只作展示，阈值放宽到 15 分钟。

## S2 · `<uid>/sidebar-list-snapshot.json` — 任务列表主状态

| 字段 | 类型 | 说明 |
|---|---|---|
| `items[].id` | string | sessionId |
| `items[].title` | string | 会话标题（用户可见，直接用作 UI 标题） |
| `items[].state` | `working` / `idle` / `terminated` | **UI 侧主状态源** |
| `items[].lastActivityAt` | int(ms) | 最近活动 |
| `items[].kind` | `task` / … | |
| `items[].space.name` | string | 归属目录 |

**坑 1**：`state` 与 db 的 `status` 大小写/取值不同（`working` vs `Working`）。读取时统一 `toLowerCase()`。
**坑 2（实测修正，重要）**：**这个快照不是实时源**。实测 `savedAt` 停在 5~15 分钟前，正在跑我这个会话（trace 文件 1s 前还在写）却被它写成 `idle / 静默 382s`。如果拿它当状态主源，宠物会在你干活时睡觉。

→ **状态以 `db.sessions.status` 为准**（实测实时），快照只用于取 `title`、`kind`、`space` 这类静态字段和 `terminated` 兜底。

## S3 · `workbuddy.db` — 状态与积分

只读打开：`new DatabaseSync(path, { readOnly: true })`，Rust 侧用 `file:...?mode=ro` + `SQLITE_OPEN_READONLY`。

### sessions（取子集）

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `title` / `custom_title` | `custom_title` 非空时优先展示 |
| `status` | `Pending` / `working` / `completed` / `terminated`（**首字母大写**） |
| `model` | 如 `deepseek-v4.1-flash` |
| `mode` | 如 `craft` |
| `last_activity_at` | int(ms)，卡住判定的主依据 |
| `deleted_at` | 非空即已删除，需过滤 |
| `cwd` | 同 S1 |

### session_usage

| 字段 | 说明 |
|---|---|
| `session_id` | 关联 sessions.id |
| `used` / `size` | **上下文 token 占用 / 窗口上限**，例如 `400218 / 1000000`。**这两个不是积分** |
| `credit_json` | `{"<turnId>": 积分}` 的 map，**每轮追加一个 key** |
| `updated_at` | int(ms)，每次消耗后刷新 |

**积分口径**：某会话累计积分 = `Σ credit_json.values()`（实测 90 轮 ≈ 443.04，133 轮 ≈ 419.33）。
增量 = 与上次快照相比 `Σ` 的增长量；`turnId` 为 ULID，字典序即时间序，因此只需记录 `maxTurnId + 上次 sum`，不必存全量 key 集合。

**坑 1（实测修正，重要）**：**同一个 key 的值在回合进行中会被反复累加**。实测事件流每 3~10 秒跳一次（`+0.05 / +0.04 / +0.14`），而"新增 key 数"始终为 0。
→ 所以"数新增 key = 算轮次"的写法永远得 0；**增量必须用 `Σ` 差值算**，"本轮花费"要读 `maxTurn` 对应的那个值。
→ 好消息：这意味着**积分可以做到秒级跳动**，UI 不必等回合结束。

**坑 2**：单轮极端值会拉开量级（实测出现过单轮 171.88，其余 0.1–6），燃速均值会失真，UI 上要区分"本轮"与"均值"，不要用一个数字讲两件事。

**坑 3（工程实现，必须做）**：`SQLITE_BUSY` 会偶发——实测在 WorkBuddy 正在写库时只读查询会失败。**读失败时绝不能把空 usage 写成新基线**，否则积分基线被冲成空，之后每次都是 `base` 且增量永远算不出来（这个 bug 在 M1 里真踩到过）。正确做法：重试 3 次 → 仍失败则本次跳过写基线，只标记 `db=error` 降级显示。

## S4 · `traces/<pid>/*.jsonl` — 工具级事件

每行一个 JSON：`{type, span|trace}`，`type ∈ {trace_start, span_start, span_end, trace_end}`。

| 字段 | 说明 |
|---|---|
| `span.spanId` / `parentId` | 层级：顶层 `mcp_tools` 包住具体工具 |
| `span.name` | **即工具名**：`Bash` / `Write` / `Read` / `generation` / `mcp_tools` / `present_files` … |
| `span.startedAt` / `endedAt` | ISO8601 UTC 字符串（**不是 ms epoch**） |
| `span.status` | `running` / 其他 |
| `trace.traceId` | 一次 agent 回合一个文件，`trace_end` 表示回合结束 |

**卡住判定的核心信号**：`span_start` 之后没有对应 `span_end` ⇒ 该工具**正在执行**，`now - startedAt` 即已耗时。实测能抓到「正在跑 Bash，已 3.2s」。

**坑 1**：时间戳是 ISO 字符串，与其他源的 ms 整数不同，解析必须分开处理。
**坑 2**：文件可达数百 KB～数 MB（实测单文件 587KB / 422KB）。**必须只读尾部**（建议 256KB 并丢弃首行残行），全量 parse 会拖垮每秒轮询。
**坑 3**：尾部截断可能导致"看起来未闭合"的假 span。缓解：只信任 `startedAt` 落在读取窗口内、且 `age < 30min` 的未闭合 span。
**坑 4**：trace 文件 mtime 是判断"这一秒它是否真的在动"的最佳信号（实测 1s 级），比任何状态字段都新鲜。

### 工具超时基线（分类型，实测校准过）

| 工具 | 基线 | 理由 |
|---|---|---|
| `Bash` / `mcp_tools` | 300s | 构建、`npm install`、长命令属于正常 |
| `generation` | 120s | 模型生成 |
| `Read` / `Write` / `Edit` | 60s | 近乎瞬时 |
| 其他 | 120s | |

最终阈值 = `max(基线, 该工具历史 P90 × 3)`。

**为什么必须分类型**：M1 首版用统一 60s，实测把自己一个 55 秒的 `Bash` 命令判成了"卡住"——这类误报会直接毁掉产品的可信度（用户会关掉提醒）。

## S5 · `tasks/<sessionId>/<n>.json` — todo 进度

| 字段 | 说明 |
|---|---|
| `subject` | 任务名（可直接作为气泡文案） |
| `activeForm` | 进行中文案 |
| `status` | `completed` / `in_progress` / `pending` |
| `id` | 序号字符串 |

进度 = `completed / total`。`_auto_<sessionId>` 为自动化会话的同一结构。

## 状态映射（UI 只用这 6 个会话级枚举）

| UI 状态 | 判定 |
|---|---|
| `working` | `db.status = working`，且存在新鲜 trace（文件 mtime < 120s）或静默 < 90s |
| `slow` | working 且静默 > 90s |
| `stuck` | 未闭合 span 耗时 > 该工具超时基线；或静默 > 180s；或"积分零增量 + trace 零事件"同时 > 120s |
| `done` | `status = completed`（由 working 迁移而来时播一次庆祝） |
| `idle` | `status = Pending` 或其他非 working 非 terminated 值 |
| `offline` | pid 探测不到（`kill(pid,0)` 失败），或 `status = terminated` |

宠物级状态另算：所有会话都不在 working → `sleeping`（打盹）；有任一 working → 跟随最"严重"的那个（stuck > slow > working）。

**关键区分**：`offline` 是"进程没了"，`stuck` 是"活着但不动"。前者对应灰色的断电动画，后者对应冒汗抖动，不能混用。

## 实测修正记录（M1 首跑踩到的两个坑）

| # | 原以为 | 实测 | 影响 |
|---|---|---|---|
| 1 | `lastHeartbeat` 是 30s 级心跳，可用于判活 | 实测 19s / 272s 两档，不定期 | 全部会话被误判 `offline`，改 pid 探测后修复 |
| 2 | `sidebar-list-snapshot.json` 是实时状态源 | 落后 5~15 分钟，正在跑的会话显示 idle | 宠物会"该干活时睡觉"，改以 db.status 为主 |
| 3 | 活动时间取 sidebar 的 `lastActivityAt` | 该字段陈旧 | 改为 `max(全部源)`，天然抗陈旧 |
| 4 | 不同回合在 `credit_json` 里各占一个新 key | 同一 key 的值被持续累加，3~10s 一跳 | "按新 key 数轮次"永远为 0，改按 `Σ` 差值；顺带获得秒级积分跳动能力 |
| 5 | 工具超时统一 60s | 自己一个 55s 的 `Bash` 就被判卡住 | 改分工具基线（Bash/mcp 300s），误报会毁掉功能可信度 |
| 6 | db 读失败返回空 usage 即可 | 空 usage 会冲掉积分基线，之后永久 `base` | 读失败必须跳过写基线，只降级显示 |

这三条不实测根本发现不了——它们是 M1 存在的全部理由。

## 演化与降级

1. 启动时逐源校验必需字段，缺字段即把该源标记 `degraded`，UI 降级为只显示会话列表，**绝不崩**。
2. `sessions` / `session_usage` 表结构变化是最可能的破坏点（当前 WorkBuddy 2.161.0）；用 `PRAGMA table_info` 做列存在性检查，而不是 `SELECT *`。
3. 全部源都不可用时，宠物进入 `offline` 态并提示"找不到 WorkBuddy 数据目录"，允许用户手动指定 `WORKBUDDY_HOME`。

## 尚未确证（M1 的 24h 观察项）

- `session_usage` 是否对已删除会话保留行（影响"今日累计"的统计口径）。
- `sidebar-list-snapshot.json` 的写入周期到底由什么触发（关窗？切 tab？），决定它能否作兜底。
- `traces/<pid>/` 目录只增不减（实测已 45+ 个），是否有自动清理，没有的话探针自己要限制扫描范围。
- 一个 session 换 pid 后（重启）如何关联，是否需要按 sessionId 聚合多个 pid 目录。
- 多显示器 / 虚拟桌面切换时 `db.status` 的更新延迟（影响"完成"提醒的及时性）。
- 极端情况：同机并行 > 5 个会话时，1s 轮询是否会与 WorkBuddy 写库产生明显竞争。
- ~~"等待用户确认"没有独立状态字段~~ → **已解决（走日志信号）**：`sessions.status` 里确实没有，但 `~/.workbuddy/logs/daemon.log` 里有明确的状态迁移：

  ```
  [TaskStatusNotifier] upsert received: session=<id> prev=working new=pending kind=permission
  ```

  这条**没有配套的"已恢复"日志**，因此结束判定用两条兜底：① 同一会话出现新的 `new=<非 pending>`；② 会话的 `last_activity_at` 晚于进入 pending 的时刻（用户点了按钮，会话重新产生活动）。
  实现见 `src-tauri/src/watcher/pending.rs`（增量 tail，首次回看 2MB），判定优先级最高——**pending 一定是 `attention`，不会被误判成 `stalled`**。
  风险：依赖日志文本格式，WorkBuddy 改版可能失效；日志轮转会触发重扫。
