# GitHub 仓库文案

## About（一句话，中文）

> WorkBuddy 的桌面伙伴：一颗会呼吸的光泽球，只读监视本机任务与积分，用颜色和浮字告诉你谁在跑、谁卡住了、谁在等你确认。

## About（一句话，英文，开国际源时用这句）

> A glossy desktop orb for WorkBuddy — watches your local agent sessions, shows running/completed/stuck states in real time, and floats credit changes above the ball. Read-only, local-only, no account.

## 短版（About 字数受限时用）

- 中文：桌面上的一颗球，替你看住 WorkBuddy 正在跑的任务。
- 英文：A tiny orb that watches your WorkBuddy tasks so you don't have to.

## Topics

```
tauri  tauri-v2  rust  react  typescript  desktop-app  desktop-pet
workbuddy  windows  macos  blender  local-first  privacy-first
```

## README 开头（长描述，可直接贴）

**它会一直在你屏幕右下角。**

一颗带光环的光泽球，六种状态六种颜色：待命是灰，干活是青，等你确认是琥珀，卡住是红，做完是绿，断了是暗。有任务在跑时，小球旁边会多出几颗小卫星——每颗卫星是一个并行会话，材质各不相同，环色就是它自己的状态。积分一消耗，数字就从对应那颗卫星上浮起来，两秒后散掉。

它不催你，也不打扰你。全屏放视频、打游戏、讲 PPT 的时候，它会自己藏起来，退出全屏再回来。

**它知道的，都是本机的。**
只读 `~/.workbuddy` 下的数据，不写、不联网、不登录、不上传。没有账号体系，没有遥测。你关掉它，电脑上不会留下除设置以外的东西。

**它怎么知道"卡住了"。**
不是靠猜。它读会话状态、会话里正在执行的工具、工具跑了多久、积分还在不在动，四路信号一起判断；同一类工具还会用历史耗时做自适应阈值——编译这种本来就慢的活，不会被误报成卡死。

> 一个会话一种材质，多个任务同时跑的时候，你会看到一颗小行星带。

## 备用：技术向描述

Tauri 2 桌面应用（Rust + React 19 + TypeScript）。Rust 侧 1 秒轮询只读 SQLite（WAL）与 JSONL trace，前端只负责把状态画成一颗球。安装包 2.8MB，常驻内存 ~60MB，空闲 CPU 接近 0。
