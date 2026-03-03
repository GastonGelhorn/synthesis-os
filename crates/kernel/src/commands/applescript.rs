use tokio::process::Command;

/// Execute an AppleScript string and return stdout.
/// Uses tokio async to avoid blocking the main thread.
pub async fn run(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("Failed to execute osascript: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("AppleScript error: {}", stderr))
    }
}

/// Execute a JXA (JavaScript for Automation) string and return stdout.
pub async fn run_jxa(script: &str) -> Result<String, String> {
    let output = Command::new("osascript")
        .arg("-l")
        .arg("JavaScript")
        .arg("-e")
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("Failed to execute osascript (JXA): {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("JXA error: {}", stderr))
    }
}
