use crate::commands::applescript;
use crate::commands::traits::*;

/// macOS implementation of SystemBridge — uses AppleScript and CLI tools.
pub struct MacOSSystem;

impl SystemBridge for MacOSSystem {
    async fn clipboard_read(&self) -> Result<String, String> {
        let output = tokio::process::Command::new("pbpaste")
            .output()
            .await
            .map_err(|e| format!("pbpaste failed: {}", e))?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    async fn clipboard_write(&self, text: &str) -> Result<(), String> {
        let mut child = tokio::process::Command::new("pbcopy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("pbcopy failed: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            stdin
                .write_all(text.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
        }
        child.wait().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn notify(&self, title: &str, body: &str) -> Result<(), String> {
        let script = format!(
            r#"display notification "{}" with title "{}""#,
            escape_as(body),
            escape_as(title)
        );
        applescript::run(&script).await?;
        Ok(())
    }

    async fn get_volume(&self) -> Result<f32, String> {
        let result = applescript::run("output volume of (get volume settings)").await?;
        result
            .trim()
            .parse::<f32>()
            .map_err(|e| format!("Parse error: {}", e))
    }

    async fn set_volume(&self, level: f32) -> Result<(), String> {
        let clamped = level.clamp(0.0, 100.0) as u32;
        applescript::run(&format!("set volume output volume {}", clamped)).await?;
        Ok(())
    }

    async fn get_brightness(&self) -> Result<f32, String> {
        let result = applescript::run(
            r#"do shell script "brightness -l 2>/dev/null | grep 'display' | head -1 | awk '{print $NF}' || echo 0.5""#
        ).await?;
        result
            .trim()
            .parse::<f32>()
            .map_err(|e| format!("Parse error: {}", e))
    }

    async fn set_brightness(&self, level: f32) -> Result<(), String> {
        let clamped = level.clamp(0.0, 1.0);
        applescript::run(&format!(r#"do shell script "brightness {}""#, clamped))
            .await
            .map_err(|e| {
                let msg = e.to_string();
                if msg.contains("command not found") || msg.contains("No such file") {
                    format!(
                        "{} Install the brightness CLI: brew install brightness",
                        msg
                    )
                } else {
                    msg
                }
            })?;
        Ok(())
    }

    async fn toggle_dark_mode(&self) -> Result<bool, String> {
        let result = applescript::run(
            r#"tell application "System Events" to tell appearance preferences to set dark mode to not dark mode
tell application "System Events" to tell appearance preferences to get dark mode"#
        ).await?;
        Ok(result.trim() == "true")
    }

    async fn get_battery(&self) -> Result<BatteryInfo, String> {
        let output = tokio::process::Command::new("pmset")
            .args(["-g", "batt"])
            .output()
            .await
            .map_err(|e| format!("pmset failed: {}", e))?;
        let text = String::from_utf8_lossy(&output.stdout).to_string();

        // Parse "Now drawing from 'Battery Power'" or "'AC Power'"
        let source = if text.contains("AC Power") {
            "AC"
        } else {
            "Battery"
        }
        .to_string();
        let charging = text.contains("charging") && !text.contains("not charging");

        // Parse percentage like "Internal Battery: 85%"
        let percentage = text
            .split('%')
            .next()
            .and_then(|s| s.split_whitespace().last())
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(0.0);

        Ok(BatteryInfo {
            percentage,
            charging,
            source,
        })
    }

    async fn get_wifi(&self) -> Result<WifiInfo, String> {
        let output = tokio::process::Command::new("networksetup")
            .args(["-getairportnetwork", "en0"])
            .output()
            .await
            .map_err(|e| format!("networksetup failed: {}", e))?;
        let text = String::from_utf8_lossy(&output.stdout).to_string();

        if text.contains("not associated") {
            return Ok(WifiInfo {
                ssid: String::new(),
                signal: String::new(),
                connected: false,
            });
        }

        let ssid = text.split(':').nth(1).unwrap_or("").trim().to_string();
        Ok(WifiInfo {
            ssid,
            signal: "connected".to_string(),
            connected: true,
        })
    }

    async fn get_system_info(&self) -> Result<SystemInfo, String> {
        let sw_vers = tokio::process::Command::new("sw_vers")
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let sw_text = String::from_utf8_lossy(&sw_vers.stdout);

        let hostname = tokio::process::Command::new("hostname")
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let sysctl = tokio::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let mem = tokio::process::Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let arch = tokio::process::Command::new("uname")
            .arg("-m")
            .output()
            .await
            .map_err(|e| e.to_string())?;

        let os_version = sw_text
            .lines()
            .find(|l| l.contains("ProductVersion"))
            .and_then(|l| l.split(':').nth(1))
            .unwrap_or("unknown")
            .trim()
            .to_string();

        let memory_bytes: f32 = String::from_utf8_lossy(&mem.stdout)
            .trim()
            .parse()
            .unwrap_or(0.0);

        // Disk space: df -k / reports 1024-byte blocks (total, used, available)
        let (disk_total_gb, disk_free_gb) = match tokio::process::Command::new("df")
            .args(["-k", "/"])
            .output()
            .await
        {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut lines = text.lines().skip(1); // skip header
                if let Some(data) = lines.next() {
                    let parts: Vec<&str> = data.split_whitespace().collect();
                    // Columns: Filesystem, 1024-blocks, Used, Available, Capacity%, Mounted
                    if parts.len() >= 4 {
                        let total_k = parts
                            .get(1)
                            .and_then(|s| s.parse::<f32>().ok())
                            .unwrap_or(0.0);
                        let avail_k = parts
                            .get(3)
                            .and_then(|s| s.parse::<f32>().ok())
                            .unwrap_or(0.0);
                        let total_gb = total_k / 1_048_576.0;
                        let free_gb = avail_k / 1_048_576.0;
                        (Some(total_gb), Some(free_gb))
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                }
            }
            Err(_) => (None, None),
        };

        Ok(SystemInfo {
            os_name: "macOS".to_string(),
            os_version,
            hostname: String::from_utf8_lossy(&hostname.stdout).trim().to_string(),
            cpu: String::from_utf8_lossy(&sysctl.stdout).trim().to_string(),
            memory_gb: memory_bytes / 1_073_741_824.0,
            arch: String::from_utf8_lossy(&arch.stdout).trim().to_string(),
            disk_total_gb,
            disk_free_gb,
        })
    }

    async fn open_app(&self, name: &str) -> Result<(), String> {
        tokio::process::Command::new("open")
            .args(["-a", name])
            .output()
            .await
            .map_err(|e| format!("Failed to open {}: {}", name, e))?;
        Ok(())
    }

    async fn say_tts(
        &self,
        text: &str,
        voice: Option<&str>,
        rate: Option<u32>,
    ) -> Result<(), String> {
        let mut cmd = tokio::process::Command::new("say");
        cmd.arg(text);
        if let Some(v) = voice {
            cmd.args(["-v", v]);
        }
        if let Some(r) = rate {
            cmd.args(["-r", &r.to_string()]);
        }
        cmd.output()
            .await
            .map_err(|e| format!("say failed: {}", e))?;
        Ok(())
    }

    async fn take_screenshot(&self) -> Result<String, String> {
        let path = format!(
            "/tmp/synthesis_screenshot_{}.png",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        tokio::process::Command::new("screencapture")
            .args(["-x", &path])
            .output()
            .await
            .map_err(|e| format!("screencapture failed: {}", e))?;
        Ok(path)
    }

    async fn search_files(&self, query: &str) -> Result<Vec<String>, String> {
        let output = tokio::process::Command::new("mdfind")
            .arg(query)
            .output()
            .await
            .map_err(|e| format!("mdfind failed: {}", e))?;
        let text = String::from_utf8_lossy(&output.stdout);
        Ok(text.lines().take(20).map(|s| s.to_string()).collect())
    }
}

/// Escape a string for safe inclusion in AppleScript double-quoted strings.
fn escape_as(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\n")
        .replace('\t', "\\t")
}
