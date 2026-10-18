# WorkBuddy Buddy

> 桌面上的一颗球，替你看住 WorkBuddy 正在跑的任务。

一颗带光环的光泽球常驻屏幕：干活时是青的，等你确认时是琥珀的，卡住了变红，做完变绿。有任务在跑时，旁边会多出小卫星——每颗卫星是一个并行会话，环色就是它自己的状态。积分一消耗，数字就从对应那颗卫星上浮起来，1.7 秒后渐隐。

Tauri 2 · Rust + React 19 · 安装包 2.8MB · 常驻内存约 60MB

## 安装

| 方式 | 文件 | 说明 |
|---|---|---|
| 安装包 | `Buddy_0.1.0_x64-setup.exe` | 双击安装到 `%LOCALAPPDATA%\Programs\Buddy`，**不需要管理员** |
| 便携版 | `buddy-windows-portable.zip` | 解压后双击 `install.cmd`，同样装到 LOCALAPPDATA 并建快捷方式 |

首次运行 Windows 会提示「未知发布者」，点「更多信息 → 仍要运行」——本项目没有购买代码签名证书。

卸载：安装目录里的 `uninstall.cmd`，或在「设置 → 应用」里卸载。

## 使用

- **左键点球**：任务面板（按 待确认 / 卡住 / 进行中 / 已完成 分组）
- **按住拖动**：换位置
- **点球 → 面板右上 ⚙**：设置
- **进入全屏**（游戏 / 视频 / PPT）：自动隐藏，退出全屏自动回来
- **托盘图标**：左键切换显隐、右键菜单（设置 / 开机自启 / 退出）
  > Windows 11 会把新图标收进任务栏的 `^` 溢出区；设置里点「托盘图标 · 固定到任务栏」可直接打开系统设置。

面板里每行悬停有 `×`，删除后不再出卫星也不再提示。

## 隐私

只读 `~/.workbuddy` 下的本地数据（SQLite + trace + 日志），**不写、不联网、不登录、不上传**。没有账号体系，没有遥测。设置只存在本机。

## 判定规则

不是靠超时猜的。同时看四路信号：会话状态、当前执行的工具、工具跑了多久、积分还在不在动。工具超时按类型给基线，再用该工具的历史耗时自适应调整——编译这种本来就慢的活不会被误报成卡死。

WorkBuddy 弹出权限询问时，直接判定为「等你确认」，而不是「卡住」。

超过 60 分钟没有活动的会话不再出卫星（仍留在面板里）。

## 开发

```bash
npm --prefix app install
npm --prefix app run dev            # 浏览器里跑（mock 数据）
npm --prefix app run tauri dev      # 桌面端（读真实数据）
npm --prefix app run tauri build -- --bundles nsis   # 出安装包
npm --prefix app test               # 前端 20 项单测
cargo test --manifest-path app/src-tauri/Cargo.toml --lib   # Rust 12 项
```

目录：`app/`（前端 + Tauri）、`assets/`（Blender 渲染素材）、`docs/`（数据契约与设计）、`packaging/`（安装脚本）、`probe/`（数据探针，开发用）。

## 许可

MIT
