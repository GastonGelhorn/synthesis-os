use kernel::commands::desktop_takeover;
use kernel::commands::macos::apps::MacOSApps;
use kernel::commands::macos::system::MacOSSystem;
use kernel::commands::traits::*;
pub use crate::commands::scraper::*;
use objc2::msg_send;

// ── System Commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn clipboard_read() -> Result<String, String> {
    MacOSSystem.clipboard_read().await
}

#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<(), String> {
    MacOSSystem.clipboard_write(&text).await
}

#[tauri::command]
pub async fn system_notify(title: String, body: String) -> Result<(), String> {
    MacOSSystem.notify(&title, &body).await
}

#[tauri::command]
pub async fn get_volume() -> Result<f32, String> {
    MacOSSystem.get_volume().await
}

#[tauri::command]
pub async fn set_volume(level: f32) -> Result<(), String> {
    MacOSSystem.set_volume(level).await
}

#[tauri::command]
pub async fn get_brightness() -> Result<f32, String> {
    MacOSSystem.get_brightness().await
}

#[tauri::command]
pub async fn set_brightness(level: f32) -> Result<(), String> {
    MacOSSystem.set_brightness(level).await
}

#[tauri::command]
pub async fn toggle_dark_mode() -> Result<bool, String> {
    MacOSSystem.toggle_dark_mode().await
}

#[tauri::command]
pub async fn get_battery() -> Result<BatteryInfo, String> {
    MacOSSystem.get_battery().await
}

#[tauri::command]
pub async fn get_wifi() -> Result<WifiInfo, String> {
    MacOSSystem.get_wifi().await
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    MacOSSystem.get_system_info().await
}

#[tauri::command]
pub async fn open_app(name: String) -> Result<(), String> {
    MacOSSystem.open_app(&name).await
}

#[tauri::command]
pub async fn say_tts(text: String, voice: Option<String>, rate: Option<u32>) -> Result<(), String> {
    MacOSSystem.say_tts(&text, voice.as_deref(), rate).await
}

#[tauri::command]
pub async fn take_screenshot() -> Result<String, String> {
    MacOSSystem.take_screenshot().await
}

#[tauri::command]
pub async fn search_files(query: String) -> Result<Vec<String>, String> {
    MacOSSystem.search_files(&query).await
}

// ── App Commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn notes_list(query: Option<String>) -> Result<Vec<NoteItem>, String> {
    MacOSApps.notes_list(query.as_deref()).await
}

#[tauri::command]
pub async fn notes_read(title: String) -> Result<String, String> {
    MacOSApps.notes_read(&title).await
}

#[tauri::command]
pub async fn notes_create(title: String, body: String) -> Result<(), String> {
    MacOSApps.notes_create(&title, &body).await
}

#[tauri::command]
pub async fn email_list(
    mailbox: Option<String>,
    max: Option<u32>,
    unread_only: Option<bool>,
) -> Result<Vec<EmailMessage>, String> {
    MacOSApps
        .email_list(
            &mailbox.unwrap_or_else(|| "INBOX".to_string()),
            max.unwrap_or(10),
            unread_only.unwrap_or(false),
        )
        .await
}

#[tauri::command]
pub async fn calendar_today() -> Result<Vec<CalendarEvent>, String> {
    MacOSApps.calendar_today().await
}

#[tauri::command]
pub async fn calendar_create(
    title: String,
    start: String,
    end: String,
    notes: Option<String>,
) -> Result<(), String> {
    MacOSApps
        .calendar_create(&title, &start, &end, notes.as_deref())
        .await
}

#[tauri::command]
pub async fn reminders_list() -> Result<Vec<ReminderItem>, String> {
    MacOSApps.reminders_list().await
}

#[tauri::command]
pub async fn reminders_add(title: String, due: Option<String>) -> Result<(), String> {
    MacOSApps.reminders_add(&title, due.as_deref()).await
}

#[tauri::command]
pub async fn contacts_search(query: String) -> Result<Vec<ContactInfo>, String> {
    MacOSApps.contacts_search(&query).await
}

#[tauri::command]
pub async fn music_play(query: Option<String>) -> Result<String, String> {
    MacOSApps.music_play(query.as_deref()).await
}

#[tauri::command]
pub async fn music_pause() -> Result<(), String> {
    MacOSApps.music_pause().await
}

#[tauri::command]
pub async fn music_next() -> Result<(), String> {
    MacOSApps.music_next().await
}

#[tauri::command]
pub async fn finder_open(path: String) -> Result<(), String> {
    MacOSApps.finder_open(&path).await
}

#[tauri::command]
pub async fn finder_trash(path: String) -> Result<(), String> {
    MacOSApps.finder_trash(&path).await
}

#[tauri::command]
pub async fn safari_tabs() -> Result<Vec<String>, String> {
    MacOSApps.safari_tabs().await
}

// ── Desktop Takeover (Jarvis Mode) ─────────────────────────────────

#[tauri::command]
pub async fn enter_jarvis_mode(window: tauri::WebviewWindow) -> Result<(), String> {
    // Pseudo-fullscreen: manual sizing to avoid macOS Split View/Spaces transitions
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let _ = window.set_size(tauri::Size::Physical(*size));
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: 0,
            y: 0,
        }));
    }

    // Set window level and presentation options on the main thread to avoid crashes
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        unsafe {
            // Set window level to NSScreenSaverWindowLevel (1000) to ensure total coverage
            if let Ok(ns_window) = w.ns_window() {
                let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
                let _: () = msg_send![ns_window_ptr, setLevel: 1000isize];
            }

            // Aggressively Hide Menu Bar and Dock via NSApplicationPresentationOptions
            // NSApplicationPresentationHideDock = 1 << 1
            // NSApplicationPresentationHideMenuBar = 1 << 3
            let ns_app: *mut objc2::runtime::AnyObject =
                msg_send![objc2::class!(NSApplication), sharedApplication];
            let options: usize = (1 << 1) | (1 << 3);
            let _: () = msg_send![ns_app, setPresentationOptions: options];
        }
    });

    let _ = window.show();
    let _ = window.set_focus();

    // Then do the async desktop takeover
    desktop_takeover::enter_jarvis_mode().await?;
    Ok(())
}

#[tauri::command]
pub async fn exit_jarvis_mode(window: tauri::WebviewWindow) -> Result<(), String> {
    // Reset window level and presentation options on the main thread
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        unsafe {
            if let Ok(ns_window) = w.ns_window() {
                let ns_window_ptr = ns_window as *mut objc2::runtime::AnyObject;
                let _: () = msg_send![ns_window_ptr, setLevel: 0isize];
            }

            let ns_app: *mut objc2::runtime::AnyObject =
                msg_send![objc2::class!(NSApplication), sharedApplication];
            let options: usize = 0; // NSApplicationPresentationDefault
            let _: () = msg_send![ns_app, setPresentationOptions: options];
        }
    });

    // Restore reasonable default size
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: 1400.0,
        height: 900.0,
    }));
    let _ = window.center();
    let _ = window.set_focus();

    desktop_takeover::exit_jarvis_mode().await?;
    Ok(())
}

#[tauri::command]
pub async fn hide_desktop_icons() -> Result<(), String> {
    desktop_takeover::hide_desktop_icons().await
}

#[tauri::command]
pub async fn show_desktop_icons() -> Result<(), String> {
    desktop_takeover::show_desktop_icons().await
}

#[tauri::command]
pub async fn hide_dock() -> Result<(), String> {
    desktop_takeover::hide_dock().await
}

#[tauri::command]
pub async fn show_dock() -> Result<(), String> {
    desktop_takeover::show_dock().await
}
