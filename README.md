# workbuddy-buddy

WorkBuddy 的桌面助手 — 一个常驻屏幕角落的光泽小球，替你盯住正在跑的任务。

它在本地只读地观察 WorkBuddy（`~/.workbuddy`）：有几个任务在跑、正在调什么工具、积分怎么掉、哪个卡住了、哪个跑完了。
**不联网、不写你的任何数据、不上传任何内容。**

形态：光泽球体，六种状态靠光环颜色区分 —— 待命（灰）/ 工作中（青）/ 待确认（琥珀）/ 卡住（红）/ 完成（绿）/ 断开（灰暗）。
积分变动以浮动数字出现在球体正上方：**新增绿色 `+xxx`，消耗蓝色 `-xxx`**，1.7 秒后上浮渐隐。

## 现在是什么状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 本地数据探针 + 数据契约冻结 | ✅ 可运行（`probe/`） |
| M2 | Tauri 2 悬浮窗 + 球体渲染 + 真实事件 | ✅ 可运行（`app/`） |
| M3 | 卡住判定 + 完成提醒 | ✅ 判定已实现（Rust `judge.rs`，8 个单测） |
| M4 | 托盘 / 设置 / 开机自启 | 部分（设置面板已做，托盘待做） |
| M5 | 双平台打包发布 | 待开发 |

## 跑起来

```bash
# 只跑前端（mock 数据，浏览器里看效果）
cd app && npm install && npm run dev      # http://localhost:5273

# 跑成桌面应用（真数据，透明置顶窗）
cd app && npm run tauri dev
```

`npm run tauri dev` 会启动 Rust 采集线程，只读 `~/.workbuddy`，把真实会话与积分变动推给球体。

## 打包与分发

两种产物，对应两种使用习惯：

| 方式 | 产物 | 安装 | 适合 |
|---|---|---|---|
| **安装包** | `Buddy_0.1.0_x64-setup.exe`（约 2.8MB） | 双击装到 `%LOCALAPPDATA%\Programs\Buddy`，**不需要管理员**，自动建开始菜单快捷方式与卸载项 | 普通用户 |
| **便携包** | `buddy-windows-portable.zip`（约 5.3MB） | 解压后双击 `install.cmd`，同样装到 LOCALAPPDATA 并建快捷方式；删目录即卸载 | 想看清装了什么、或放 U 盘 |

```bash
npm run build:app         # 出 NSIS 安装包（release + LTO，约 5~6 分钟）
npm run package:portable  # 组装便携包到 release/buddy-windows-portable
```

产物位置：
- 安装包 `app/src-tauri/target/release/bundle/nsis/`
- 便携包 `release/buddy-windows-portable/`（打 zip：`tar -a -c -f release/buddy-windows-portable.zip -C release buddy-windows-portable`）

**没有代码签名**：首次运行会有 SmartScreen「未知发布者」提示，点「更多信息 → 仍要运行」。这与 CrossPet 等情况一致——签名证书是付费项。

**退出后怎么再打开**：开始菜单搜「Buddy」、双击安装目录里的 `Buddy.exe`，或在托盘菜单里勾选「开机自启」让它随系统启动。设置里的「隐藏」只是藏窗口（进程还在），「退出」才是结束进程。

M1 只做一件事：**证明数据拿得到、语义没猜错**。在契约没冻结前写 UI 是给自己挖坑。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 外壳 | Tauri 2（Rust + 系统 WebView） | 安装包 8–12MB，常驻 50–70MB |
| 采集 | Rust：`rusqlite`(bundled) + `notify` + 文件轮询 | 采集独立于渲染线程，前端卡死不丢数据 |
| 渲染 | React 19 + Vite + TS + 位图精灵（@2x/@3x PNG）+ CSS 合成 | 球体/光晕分层，状态只换颜色与精灵 |
| 存储 | 仅一个 `settings.json` | 无数据库、无后台服务 |
| 探针 | Node 22 内置 `node:sqlite`，零依赖 | 只用于 M1 验证，不进产物 |

## 数据来源（全部只读）

| 源 | 作用 |
|---|---|
| `sessions/<pid>.json` | 进程存活 / 心跳 |
| `<uid>/sidebar-list-snapshot.json` | 任务列表主状态 `working/idle/terminated` |
| `workbuddy.db`（WAL） | `sessions` 状态 + `session_usage.credit_json` 积分流水 |
| `traces/<pid>/*.jsonl` | 工具级 span，用于卡住判定与气泡文案 |
| `tasks/<sessionId>/*.json` | todo 完成度 n/m |

字段语义与已知坑：[`docs/02-data-contract.md`](docs/02-data-contract.md)
设计决策记录：[`docs/01-decisions.md`](docs/01-decisions.md)

## 快速开始（M1 探针）

需要 Node ≥ 22.5（用内置 `node:sqlite`，**零依赖，不用 npm install**）。

```bash
npm run probe                    # 打一张快照表
npm run probe:json               # 机器可读
node probe/probe.mjs --watch=1000   # 持续观察，只输出事件
node probe/probe.mjs --since=60      # 只看最近 60 分钟活跃的会话
```

事件长这样（真实抓取）：

```
[11:10:21] + 积分 +0.18  本轮 21.9  累计 456.2  检查单页构建版本未更新
[11:10:23] ~ 确认DeepSeek版本与视频…  空闲 → generation
[11:12:04] * 检查单页构建版本未更新  slow → stuck  (静默 3m08)
```

## M1 验收清单

- [x] 只读打开 `workbuddy.db`（WAL）不触发写锁，单次查询 < 1ms（实测 0.02ms）
- [x] 四源合并出「会话 → 状态 → 当前工具 → 进度 → 积分」一条链路
- [x] 积分按 `Σ` 差分，能算出增量与本轮花费（实测事件流 3~10s 一跳）
- [x] 未闭合 span 可定位到具体工具名与持续时长（实测抓到 `Bash 4s` / `mcp_tools → 空闲`）
- [x] 存活判定改为 pid 级探测（心跳不定期，30s 阈值会误判全量 offline）
- [x] 状态源优先级纠正（sidebar 快照滞后 5~15 分钟，不能当实时源）
- [x] 超时基线分工具（统一 60s 会把自己的 55s 命令误判成卡住）
- [x] `SQLITE_BUSY` 时保留旧基线（否则积分增量永久失效）
- [ ] 连续跑 24h，确认无 schema 漂移、无文件句柄泄漏
- [ ] 覆盖空状态（WorkBuddy 未启动 / 无任何会话）

已踩到的坑与修正过程：[`docs/02-data-contract.md`](docs/02-data-contract.md#实测修正记录m1-首跑踩到的两个坑)

## 边界

- **只读**：不写 `~/.workbuddy` 下任何文件，不 checkpoint WAL，不建表。
- **单机**：不做多机聚合，不接云端。
- **余额不是本地数据**：本地只有已消耗量，没有剩余额度。UI 展示「本次消耗 / 今日累计 / 燃速」，余额需可插拔 provider（M4 之后再谈）。

## 许可

MIT。像素素材将全部自绘并以 CC0 发布，不使用任何第三方版权精灵图。
