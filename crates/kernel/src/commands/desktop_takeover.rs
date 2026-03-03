use std::sync::atomic::{AtomicBool, Ordering};

/// Track whether we've taken over the desktop so we can restore on quit.
static DESKTOP_HIDDEN: AtomicBool = AtomicBool::new(false);
static DOCK_HIDDEN: AtomicBool = AtomicBool::new(false);

/// Hide macOS desktop icons (Finder's CreateDesktop = false)
pub async fn hide_desktop_icons() -> Result<(), String> {
    tokio::process::Command::new("defaults")
        .args([
            "write",
            "com.apple.finder",
            "CreateDesktop",
            "-bool",
            "false",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to hide desktop icons: {}", e))?;

    // Restart Finder to apply
    tokio::process::Command::new("killall")
        .arg("Finder")
        .output()
        .await
        .map_err(|e| format!("Failed to restart Finder: {}", e))?;

    DESKTOP_HIDDEN.store(true, Ordering::SeqCst);
    log::info!("Desktop icons hidden");
    Ok(())
}

/// Show macOS desktop icons (restore Finder's CreateDesktop = true)
pub async fn show_desktop_icons() -> Result<(), String> {
    tokio::process::Command::new("defaults")
        .args([
            "write",
            "com.apple.finder",
            "CreateDesktop",
            "-bool",
            "true",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to show desktop icons: {}", e))?;

    tokio::process::Command::new("killall")
        .arg("Finder")
        .output()
        .await
        .map_err(|e| format!("Failed to restart Finder: {}", e))?;

    DESKTOP_HIDDEN.store(false, Ordering::SeqCst);
    log::info!("Desktop icons restored");
    Ok(())
}

/// Enable Dock auto-hide
pub async fn hide_dock() -> Result<(), String> {
    tokio::process::Command::new("defaults")
        .args(["write", "com.apple.dock", "autohide", "-bool", "true"])
        .output()
        .await
        .map_err(|e| format!("Failed to set dock autohide: {}", e))?;

    tokio::process::Command::new("killall")
        .arg("Dock")
        .output()
        .await
        .map_err(|e| format!("Failed to restart Dock: {}", e))?;

    DOCK_HIDDEN.store(true, Ordering::SeqCst);
    log::info!("Dock auto-hide enabled");
    Ok(())
}

/// Disable Dock auto-hide (restore)
pub async fn show_dock() -> Result<(), String> {
    tokio::process::Command::new("defaults")
        .args(["write", "com.apple.dock", "autohide", "-bool", "false"])
        .output()
        .await
        .map_err(|e| format!("Failed to restore dock: {}", e))?;

    tokio::process::Command::new("killall")
        .arg("Dock")
        .output()
        .await
        .map_err(|e| format!("Failed to restart Dock: {}", e))?;

    DOCK_HIDDEN.store(false, Ordering::SeqCst);
    log::info!("Dock auto-hide disabled");
    Ok(())
}

/// Activate Jarvis mode: hide desktop icons + auto-hide dock
pub async fn enter_jarvis_mode() -> Result<(), String> {
    hide_desktop_icons().await?;
    hide_dock().await?;
    log::info!("Jarvis mode activated");
    Ok(())
}

/// Exit Jarvis mode: restore desktop icons + dock
pub async fn exit_jarvis_mode() -> Result<(), String> {
    if DESKTOP_HIDDEN.load(Ordering::SeqCst) {
        show_desktop_icons().await?;
    }
    if DOCK_HIDDEN.load(Ordering::SeqCst) {
        show_dock().await?;
    }
    log::info!("Jarvis mode deactivated — desktop restored");
    Ok(())
}

/// Restore everything — called on app shutdown to ensure clean exit
pub fn restore_desktop_sync() {
    if DESKTOP_HIDDEN.load(Ordering::SeqCst) {
        let _ = std::process::Command::new("defaults")
            .args([
                "write",
                "com.apple.finder",
                "CreateDesktop",
                "-bool",
                "true",
            ])
            .output();
        let _ = std::process::Command::new("killall").arg("Finder").output();
    }
    if DOCK_HIDDEN.load(Ordering::SeqCst) {
        let _ = std::process::Command::new("defaults")
            .args(["write", "com.apple.dock", "autohide", "-bool", "false"])
            .output();
        let _ = std::process::Command::new("killall").arg("Dock").output();
    }
}
