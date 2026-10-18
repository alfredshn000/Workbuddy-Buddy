pub mod judge;
pub mod model;
pub mod watcher;

use std::sync::atomic::{AtomicBool, Ordering};

/// 启动时带 BUDDY_RESET_HIDDEN=1 则置位，前端挂载后主动来取一次
static RESET_PENDING: AtomicBool = AtomicBool::new(false);
use std::sync::Mutex;
use std::time::Duration;
use std::sync::OnceLock;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};
use tauri_plugin_autostart::MacosLauncher;

/// 前端上报的可交互区域：一个圆（球体）+ 若干矩形（气泡、面板等）。
/// None 表示还没上报，此时不开启穿透，避免点不到。
#[derive(Clone, Default)]
pub struct HitArea {
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
    /// [x, y, w, h]，窗口内逻辑坐标
    pub rects: Vec<[f64; 4]>,
}

#[derive(Default)]
pub struct HitRegion(pub Mutex<Option<HitArea>>);

#[tauri::command]
fn set_hit_region(
    state: tauri::State<'_, HitRegion>,
    cx: f64,
    cy: f64,
    r: f64,
    rects: Option<Vec<[f64; 4]>>,
) {
    if let Ok(mut g) = state.0.lock() {
        *g = Some(HitArea { cx, cy, r, rects: rects.unwrap_or_default() });
    }
}

/// 全屏自动隐藏开关（前端设置项同步过来）
static AUTOHIDE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn set_fullscreen_autohide(enabled: bool) {
    AUTOHIDE.store(enabled, Ordering::Relaxed);
}

static AUTOSTART_ITEM: OnceLock<CheckMenuItem<tauri::Wry>> = OnceLock::new();

/// 前端把「几个任务在进行」推给托盘 tooltip
#[tauri::command]
fn set_tray_tooltip(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(text));
    }
}

/// 前端挂载后调用：一次性读取并清除「待重置」标记
#[tauri::command]
fn take_reset_hidden() -> bool {
    RESET_PENDING.swap(false, Ordering::Relaxed)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) {
    apply_autostart(&app, enabled, true);
}

/// 写系统自启状态；from_frontend=false 表示来自托盘点击（要回传前端刷新设置）
fn apply_autostart(app: &AppHandle, enabled: bool, from_frontend: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current != enabled {
        let _ = if enabled { manager.enable() } else { manager.disable() };
    }
    if let Some(item) = AUTOSTART_ITEM.get() {
        let _ = item.set_checked(enabled);
    }
    if !from_frontend {
        let _ = app.emit("buddy://autostart", enabled);
    }
}

/// 打开 Windows「任务栏设置」，方便把托盘图标从溢出区固定出来
#[tauri::command]
fn open_taskbar_settings() {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:taskbar"])
            .spawn();
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 前台窗口是否占满它所在的显示器（游戏 / 视频 / PPT / 网页全屏都会满足）
#[cfg(windows)]
fn foreground_is_fullscreen() -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }

        // 桌面/任务栏也"铺满屏幕"，必须排除，否则点一下桌面球就被判成全屏隐藏
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let class = String::from_utf16_lossy(&buf[..len.max(0) as usize]);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Windows.UI.Core.CoreWindow"
        ) {
            return false;
        }

        let mut rect = std::mem::zeroed::<RECT>();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return false;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return false;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left + 1
            && rect.top <= m.top + 1
            && rect.right >= m.right - 1
            && rect.bottom >= m.bottom - 1
    }
}

#[cfg(not(windows))]
fn foreground_is_fullscreen() -> bool {
    false
}

/// 全屏时隐藏、退出全屏后恢复。轮询周期放慢，避免无谓占用。
fn spawn_fullscreen_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut hidden_by_us = false;
        loop {
            if AUTOHIDE.load(Ordering::Relaxed) {
                if let Some(win) = app.get_webview_window("main") {
                    let full = foreground_is_fullscreen();
                    if full && !hidden_by_us {
                        let _ = win.hide();
                        hidden_by_us = true;
                    } else if !full && hidden_by_us {
                        let _ = win.show();
                        hidden_by_us = false;
                    }
                }
            } else if hidden_by_us {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
                hidden_by_us = false;
            }
            std::thread::sleep(Duration::from_millis(450));
        }
    });
}

#[cfg(windows)]
fn cursor_pos() -> Option<(f64, f64)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut p) };
    if ok != 0 {
        Some((p.x as f64, p.y as f64))
    } else {
        None
    }
}

#[cfg(not(windows))]
fn cursor_pos() -> Option<(f64, f64)> {
    None
}

/// 逐像素点击穿透：光标不在球上时让窗口"透明"，不挡桌面图标。
fn spawn_hit_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_ignore: Option<bool> = None;
        loop {
            if let Some(win) = app.get_webview_window("main") {
                let region = app
                    .state::<HitRegion>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|g| g.clone());

                if let Some(area) = region {
                    if let (Ok(pos), Ok(sf), Some((mx, my))) =
                        (win.outer_position(), win.scale_factor(), cursor_pos())
                    {
                        let ox = pos.x as f64;
                        let oy = pos.y as f64;
                        let dx = mx - (ox + area.cx * sf);
                        let dy = my - (oy + area.cy * sf);
                        let limit = area.r * sf + 3.0;
                        let mut inside = dx * dx + dy * dy <= limit * limit;

                        if !inside {
                            for rect in &area.rects {
                                let x0 = ox + rect[0] * sf;
                                let y0 = oy + rect[1] * sf;
                                let x1 = x0 + rect[2] * sf;
                                let y1 = y0 + rect[3] * sf;
                                if mx >= x0 && mx <= x1 && my >= y0 && my <= y1 {
                                    inside = true;
                                    break;
                                }
                            }
                        }

                        let ignore = !inside;
                        if last_ignore != Some(ignore) {
                            let _ = win.set_ignore_cursor_events(ignore);
                            last_ignore = Some(ignore);
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(45));
        }
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart_on = {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().unwrap_or(false)
    };

    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let auto = CheckMenuItem::with_id(app, "autostart", "开机自启", true, autostart_on, None::<&str>)?;
    let version = MenuItem::with_id(
        app,
        "version",
        format!("Buddy {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &settings,
            &auto,
            &PredefinedMenuItem::separator(app)?,
            &version,
            &quit,
        ],
    )?;
    let _ = AUTOSTART_ITEM.set(auto.clone());

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Buddy")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                    }
                }
            }
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("buddy://open-settings", ());
            }
            "autostart" => {
                use tauri_plugin_autostart::ManagerExt;
                let on = app.autolaunch().is_enabled().unwrap_or(false);
                apply_autostart(app, !on, false);
            }
            "quit" => app.exit(0),
            _ => {}
        });

    let has_icon = app.default_window_icon().is_some();
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    let _ = has_icon;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(HitRegion::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_region,
            set_fullscreen_autohide,
            quit_app,
            take_reset_hidden,
            set_autostart,
            set_tray_tooltip,
            open_taskbar_settings
        ])
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                // 贴右下角，避让任务栏
                if let Ok(Some(monitor)) = win.current_monitor() {
                    let size = monitor.size();
                    let sf = monitor.scale_factor();
                    let w = win.outer_size().map(|s| s.width).unwrap_or(640) as i32;
                    let h = win.outer_size().map(|s| s.height).unwrap_or(640) as i32;
                    let margin_x = (16.0 * sf) as i32;
                    let margin_y = (56.0 * sf) as i32;
                    let _ = win.set_position(PhysicalPosition::new(
                        size.width as i32 - w - margin_x,
                        size.height as i32 - h - margin_y,
                    ));
                }
                let _ = win.show();
            }

            // 排障入口：BUDDY_RESET_HIDDEN=1 启动时清空「已删除任务」列表
            if std::env::var("BUDDY_RESET_HIDDEN").is_ok() {
                RESET_PENDING.store(true, Ordering::Relaxed);
            }

            build_tray(app.handle())?;
            spawn_hit_loop(app.handle().clone());
            spawn_fullscreen_loop(app.handle().clone());
            watcher::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Buddy");
}
