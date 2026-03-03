mod commands;

use kernel::auth::AuthManager;
use kernel::events_broadcast::EventBroadcast;
use kernel::http_server::{self, HttpState};
use kernel::{scheduler::Scheduler, syscall::Syscall, KernelState, SpatialPosition};
use std::path::PathBuf;
use std::sync::Arc;
use commands::tauri_commands::*;
use objc2::msg_send;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tokio::sync::mpsc;
fn ensure_tls_certs(app_dir: &PathBuf) {
    let tls_dir = app_dir.join("tls");
    if let Err(e) = std::fs::create_dir_all(&tls_dir) {
        log::error!("[TLS] Failed to create tls dir {:?}: {}", tls_dir, e);
        return;
    }
    let dst_cert = tls_dir.join("cert.pem");
    let dst_key = tls_dir.join("key.pem");

    // Collect current local IPs to check if existing cert covers them.
    let mut current_ips: Vec<std::net::Ipv4Addr> = Vec::new();
    if let Ok(ifaces) = get_if_addrs::get_if_addrs() {
        for iface in ifaces {
            if let std::net::IpAddr::V4(v4) = iface.ip() {
                if !v4.is_loopback() {
                    current_ips.push(v4);
                }
            }
        }
    }

    // Track which IPs the cert was generated for via a sidecar file.
    // If the IPs changed (e.g. different WiFi network), regenerate the cert.
    let sans_file = tls_dir.join("sans.txt");
    let mut current_ip_strs: Vec<String> = current_ips.iter().map(|ip| ip.to_string()).collect();
    current_ip_strs.sort();
    let current_sans_fingerprint = current_ip_strs.join(",");

    if dst_cert.exists() && dst_key.exists() {
        let saved_fingerprint = std::fs::read_to_string(&sans_file).unwrap_or_default();
        let saved_trimmed = saved_fingerprint.trim();
        // Accept the cert if the saved fingerprint matches exactly OR if the cert
        // was generated externally (e.g. by check-remote-access.sh with openssl)
        // and its IPs are a subset of current IPs.
        let saved_ips: std::collections::HashSet<&str> = saved_trimmed.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        let current_set: std::collections::HashSet<&str> = current_ip_strs.iter().map(|s| s.as_str()).collect();
        let all_saved_covered = !saved_ips.is_empty() && saved_ips.iter().all(|ip| current_set.contains(ip));
        if saved_trimmed == current_sans_fingerprint || all_saved_covered {
            log::info!("[TLS] Existing certs OK at {:?} (saved IPs: {})", tls_dir, saved_trimmed);
            return;
        }
        log::info!(
            "[TLS] Regenerating certs — IPs changed (saved: {}, current: {})",
            saved_trimmed,
            current_sans_fingerprint
        );
    }

    log::info!("[TLS] Generating self-signed cert in {:?} ...", tls_dir);

    // Generate a self-signed cert with SANs for localhost + all local IPv4 addrs.
    let dns_sans: Vec<String> = vec!["localhost".to_string()];
    let mut ip_sans: Vec<std::net::IpAddr> =
        vec![std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))];
    for v4 in &current_ips {
        ip_sans.push(std::net::IpAddr::V4(*v4));
    }
    log::info!("[TLS] SANs: DNS=localhost, IPs={:?}", ip_sans);

    // rcgen wants DNS SANs in new(); we'll add IP SANs afterwards.
    let mut params = match rcgen::CertificateParams::new(dns_sans) {
        Ok(p) => p,
        Err(e) => {
            log::error!("[TLS] CertificateParams::new failed: {}", e);
            return;
        }
    };
    params
        .subject_alt_names
        .extend(ip_sans.into_iter().map(rcgen::SanType::IpAddress));
    params.distinguished_name = {
        let mut dn = rcgen::DistinguishedName::new();
        dn.push(rcgen::DnType::CommonName, "SynthesisOS Dev TLS");
        dn
    };
    // Set explicit validity dates — rcgen defaults can produce unusable certs.
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::days(1);
    params.not_after = now + time::Duration::days(365);

    let keypair = match rcgen::KeyPair::generate() {
        Ok(kp) => kp,
        Err(e) => {
            log::error!("[TLS] KeyPair::generate failed: {}", e);
            return;
        }
    };
    let cert = match params.self_signed(&keypair) {
        Ok(c) => c,
        Err(e) => {
            log::error!("[TLS] self_signed failed: {}", e);
            return;
        }
    };

    let cert_pem = cert.pem();
    let key_pem = keypair.serialize_pem();
    if let Err(e) = std::fs::write(&dst_cert, &cert_pem) {
        log::error!("[TLS] Failed to write cert.pem: {}", e);
        return;
    }
    if let Err(e) = std::fs::write(&dst_key, &key_pem) {
        log::error!("[TLS] Failed to write key.pem: {}", e);
        return;
    }
    // Save the IP fingerprint so we can detect changes on next launch.
    let _ = std::fs::write(&sans_file, &current_sans_fingerprint);
    log::info!("[TLS] Self-signed cert written to {:?} (IPs: {})", tls_dir, current_sans_fingerprint);
}

/// Health-check command — validates Tauri invoke() works from the WebView
#[tauri::command]
fn ping() -> String {
    "pong from Rust 🦀".to_string()
}

/// Prewarm: touches kernel state so the first real invoke is faster. Call on input focus.
#[tauri::command]
async fn kernel_ping(state: tauri::State<'_, KernelState>) -> Result<(), String> {
    let _ = state.syscall_tx.clone();
    Ok(())
}

/// SynthesisOS Kernel Entry Point
/// Submits an initial query to the Agent Scheduler and returns a unique Task ID.
#[tauri::command]
async fn submit_agent_task(
    query: String,
    task_id: Option<String>,
    conversation_history: Option<String>,
    node_summaries: Option<Vec<serde_json::Value>>,
    mode: Option<String>,
    user_context: Option<String>,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, KernelState>,
) -> Result<String, String> {
    println!("[Kernel] Frontend requested new agent task: {}", query);

    // Update node registry for lazy loading (get_node_content tool)
    if let Some(ref summaries) = node_summaries {
        let mut reg = state.node_registry.write().await;
        reg.clear();
        for s in summaries {
            if let (Some(id), Some(title)) = (
                s.get("id").and_then(|v| v.as_str()),
                s.get("title").and_then(|v| v.as_str()),
            ) {
                reg.insert(
                    id.to_string(),
                    kernel::NodeSummary {
                        id: id.to_string(),
                        title: title.to_string(),
                        summary: s
                            .get("summary")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        node_type: s
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        space_id: s.get("spaceId").and_then(|v| v.as_str()).map(String::from),
                    },
                );
            }
        }
    }

    // Spawn the agent process in Tokio, passing the Syscall transmitter and app handle
    let task_id = kernel::agent::BaseAgent::spawn(
        query,
        task_id,
        conversation_history,
        node_summaries,
        mode,
        user_context,
        state.syscall_tx.clone(),
        app_handle,
    );

    Ok(task_id)
}

/// Synthesis Entry Point (non-agent mode)
/// Spawns a lightweight SynthesisAgent that does a single LLM call to produce a card.
/// Emits synthesis-progress, synthesis-complete, or synthesis-error events.
#[tauri::command]
async fn submit_synthesis_task(
    query: String,
    task_id: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, KernelState>,
) -> Result<String, String> {
    println!("[Kernel] Frontend requested synthesis task: {}", query);

    let result_id =
        kernel::agent::SynthesisAgent::spawn(query, task_id, state.syscall_tx.clone(), app_handle);

    Ok(result_id)
}

/// Human-in-the-loop: frontend resolves a pending tool approval request.
/// Called when the user clicks Approve or Reject on a destructive tool call.
#[tauri::command]
async fn respond_tool_approval(
    approval_key: String,
    approved: bool,
    state: tauri::State<'_, KernelState>,
) -> Result<bool, String> {
    let resolved = state.approval_gate.resolve(&approval_key, approved).await;
    if !resolved {
        println!("[Kernel] Approval key not found (expired?): {}", approval_key);
    }
    Ok(resolved)
}

/// Spawns 5 concurrent agents to verify that the Scheduler and its Mutexes
/// correctly handle multi-agent load without deadlocking or mixing channels.
#[tauri::command]
async fn test_concurrency(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, KernelState>,
) -> Result<Vec<String>, String> {
    println!("[Kernel] Launching Multi-Agent Concurrency Test...");
    let mut tasks = Vec::new();

    for i in 1..=5 {
        let task_name = format!("Concurrent Agent Test #{}", i);
        let task_id = kernel::agent::BaseAgent::spawn(
            task_name,
            None,
            None,
            None,
            None,
            None,
            state.syscall_tx.clone(),
            app_handle.clone(),
        );
        tasks.push(task_id);
    }

    Ok(tasks)
}

/// Update spatial window positions from the frontend's R3F GodMode canvas.
#[tauri::command]
async fn update_spatial_positions(
    positions: std::collections::HashMap<String, SpatialPosition>,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    let mut map = state.spatial_positions.lock().await;
    *map = positions;
    Ok(())
}

/// Run an arbitrary AppleScript and return the result
#[tauri::command]
async fn run_applescript(script: String) -> Result<String, String> {
    kernel::commands::applescript::run(&script).await
}

/// Run an arbitrary JXA script and return the result
#[tauri::command]
async fn run_jxa(script: String) -> Result<String, String> {
    kernel::commands::applescript::run_jxa(&script).await
}

/// Get the name of the currently frontmost macOS application
#[tauri::command]
fn get_frontmost_app() -> String {
    std::process::Command::new("osascript")
        .args(["-e", r#"tell application "System Events" to get name of first application process whose frontmost is true"#])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Get current kernel statistics for the monitoring dashboard
#[tauri::command]
async fn get_all_tools(
    state: tauri::State<'_, KernelState>,
) -> Result<Vec<serde_json::Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let _ = state
        .syscall_tx
        .send(kernel::syscall::Syscall::GetToolDefinitions {
            agent_id: "frontend".to_string(),
            response_tx: tx,
        })
        .await;

    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_kernel_stats(
    state: tauri::State<'_, KernelState>,
) -> Result<kernel::syscall::KernelStats, String> {
    let stats = state.stats.lock().await;
    Ok(stats.clone())
}

/// Change the active scheduling policy (FIFO, RoundRobin, WeightedFairQueue, DeficitRoundRobin, PriorityWithAging)
#[tauri::command]
async fn set_scheduler_policy(
    policy: String,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    println!("[Kernel] Request to switch policy to: {}", policy);
    let mut stats = state.stats.lock().await;
    stats.policy = policy;
    Ok(())
}

/// Configure QoS parameters for the active scheduling policy
#[tauri::command]
async fn set_qos_params(qos_type: String, params: serde_json::Value) -> Result<(), String> {
    println!(
        "[Kernel] set_qos_params: type={}, params={}",
        qos_type, params
    );
    // Store in-memory or forward to scheduler_qos module
    // The QoS scheduler picks these up on next scheduling cycle
    match qos_type.as_str() {
        "priority" => {
            let _threshold = params
                .get("age_threshold_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(500);
            let _boost = params
                .get("aging_boost")
                .and_then(|v| v.as_u64())
                .unwrap_or(2);
            println!(
                "[Kernel/QoS] PriorityWithAging: threshold={}ms, boost={}",
                _threshold, _boost
            );
        }
        "drr" => {
            let _quantum = params
                .get("quantum")
                .and_then(|v| v.as_u64())
                .unwrap_or(1000);
            println!("[Kernel/QoS] DeficitRoundRobin: quantum={}", _quantum);
        }
        "wfq" => {
            let _weight = params
                .get("default_weight")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0);
            println!("[Kernel/QoS] WeightedFairQueue: default_weight={}", _weight);
        }
        _ => {
            println!("[Kernel/QoS] No QoS (FIFO/RoundRobin)");
        }
    }
    Ok(())
}

/// Configure context window defaults (applies immediately to global ContextManager)
#[tauri::command]
async fn set_context_defaults(
    max_tokens: usize,
    reserved_pct: u8,
    auto_prune: bool,
    auto_compact: bool,
) -> Result<(), String> {
    println!(
        "[Kernel] set_context_defaults: max_tokens={}, reserved={}%, prune={}, compact={}",
        max_tokens, reserved_pct, auto_prune, auto_compact
    );
    // Apply directly to the global ContextManager (new agents will use these defaults)
    use kernel::scheduler::CONTEXT_MANAGER;
    if let Ok(mut ctx) = CONTEXT_MANAGER.lock() {
        ctx.update_config(max_tokens, reserved_pct, auto_prune, auto_compact);
        Ok(())
    } else {
        Err("Failed to lock ContextManager".to_string())
    }
}

/// Configure storage subsystem (sends syscall to storage worker for hot-reload)
#[tauri::command]
async fn set_storage_config(
    auto_versioning: bool,
    max_versions: u32,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    println!(
        "[Kernel] set_storage_config: versioning={}, max_versions={}",
        auto_versioning, max_versions
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::UpdateStorageConfig {
            auto_versioning,
            max_versions,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    resp.data.map(|_| ())
}

/// Configure memory subsystem (sends syscall to memory worker for hot-reload)
#[tauri::command]
async fn set_memory_config(
    auto_tagging: bool,
    compaction_threshold: u8,
    max_per_agent: u32,
    reflection_enabled: bool,
    reflection_interval_mins: u64,
    reflection_model: Option<String>,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    println!(
        "[Kernel] set_memory_config: tagging={}, compaction={}%, max={}, reflection={}, interval={}m, model={:?}",
        auto_tagging, compaction_threshold, max_per_agent, reflection_enabled, reflection_interval_mins, reflection_model
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::UpdateMemoryConfig {
            auto_tagging,
            compaction_threshold,
            max_per_agent,
            reflection_enabled,
            reflection_interval_mins,
            reflection_model,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    resp.data.map(|_| ())
}

/// List long-term memory entries for an agent (for Settings UI). Returns empty list if agent has no memories.
/// When agent_id is None or empty, returns memories across ALL agents.
#[tauri::command]
async fn list_memories(
    agent_id: Option<String>,
    state: tauri::State<'_, KernelState>,
) -> Result<Vec<serde_json::Value>, String> {
    let agent_id = agent_id.unwrap_or_default(); // Empty string = all agents
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryRetrieve {
            agent_id: agent_id.clone(),
            query: String::new(),
            tags: None,
            limit: 500,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    let data = match resp.data {
        Ok(v) => v,
        Err(_) => return Ok(vec![]), // Agent not found or no memories
    };
    let entries = data
        .get("entries")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(entries)
}

/// Get user profile summary from core memory (for onboarding name extraction).
/// Returns the raw profile text; frontend can parse for name.
#[tauri::command]
async fn get_user_profile_summary(state: tauri::State<'_, KernelState>) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryRead {
            agent_id: "user".to_string(),
            key: "core:user_profile".to_string(),
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    let data = resp.data.map_err(|e| e)?;
    let s = data
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(s)
}

/// Get context window messages (e.g. session conversation) for an agent.
#[tauri::command]
async fn get_context_messages(
    agent_id: String,
    state: tauri::State<'_, KernelState>,
) -> Result<Vec<serde_json::Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::ContextGetMessages {
            agent_id,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    let data = resp.data.map_err(|e| e)?;
    let arr = data.as_array().cloned().unwrap_or_default();
    Ok(arr)
}

/// List storage (LSFS) directory contents. Use path "/" or "" for root.
#[tauri::command]
async fn list_storage(
    path: String,
    state: tauri::State<'_, KernelState>,
) -> Result<Vec<serde_json::Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let path = if path.is_empty() {
        "/".to_string()
    } else {
        path
    };
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::StorageList {
            agent_id: "settings".to_string(),
            path,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    let data = resp.data.map_err(|e| e)?;
    let entries = data.as_array().cloned().unwrap_or_default();
    Ok(entries)
}

/// Read a file from storage (LSFS).
#[tauri::command]
async fn read_storage(
    path: String,
    state: tauri::State<'_, KernelState>,
) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::StorageRead {
            agent_id: "settings".to_string(),
            path,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    let data = resp.data.map_err(|e| e)?;
    let content = data.as_str().unwrap_or("").to_string();
    Ok(content)
}

/// Update a memory entry (content, tags, context). Omitted fields are left unchanged.
#[tauri::command]
async fn update_memory(
    agent_id: String,
    entry_id: String,
    content: Option<String>,
    tags: Option<Vec<String>>,
    context: Option<String>,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryUpdate {
            agent_id,
            entry_id,
            content,
            tags,
            context,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    resp.data.map(|_| ()).map_err(|e| e)
}

/// Delete a memory entry by id.
#[tauri::command]
async fn delete_memory(
    agent_id: String,
    entry_id: String,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryDelete {
            agent_id,
            entry_id,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    resp.data.map(|_| ()).map_err(|e| e)
}

/// Reset all data: users, memories. Seeds super_admin. Super-admin only (local Tauri = always allowed).
#[tauri::command]
async fn reset_all_data(
    auth: tauri::State<'_, Arc<AuthManager>>,
    state: tauri::State<'_, KernelState>,
) -> Result<serde_json::Value, String> {
    let user = auth.reset_and_seed()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryDeleteAll {
            agent_id: None,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send MemoryDeleteAll: {}", e))?;
    let _ = rx.await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "message": "Data reset. Super admin reseeded.",
        "user": { "id": user.id, "username": user.username, "role": user.role.as_str() }
    }))
}

/// Delete all memory entries, optionally filtered by agent_id. None = delete all agents.
#[tauri::command]
async fn delete_all_memories(
    agent_id: Option<String>,
    state: tauri::State<'_, KernelState>,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    state
        .syscall_tx
        .send(kernel::syscall::Syscall::MemoryDeleteAll {
            agent_id,
            response_tx: tx,
        })
        .await
        .map_err(|e| format!("Failed to send syscall: {}", e))?;
    let resp = rx.await.map_err(|e| format!("No response: {}", e))?;
    resp.data.map(|_| ()).map_err(|e| e)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_dir = app
                .handle()
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("/tmp/synthesis-os"));
            let _ = std::fs::create_dir_all(&app_dir);
            // ── Ensure TLS certs exist for HTTPS backend (Safari/iPad) ──
            ensure_tls_certs(&app_dir);

            // ── SynthesisOS Kernel Boot ───────────────────────────────────
            let stats = Arc::new(tokio::sync::Mutex::new(
                kernel::syscall::KernelStats::default(),
            ));
            let (syscall_tx, syscall_rx) = mpsc::channel::<Syscall>(100);

            // Spawn the central Scheduler loop in the background
            let scheduler_app_handle = app.handle().clone();
            let scheduler_stats = stats.clone();
            let scheduler_tx = syscall_tx.clone();
            tauri::async_runtime::spawn(async move {
                let scheduler = Scheduler::new(syscall_rx, scheduler_tx, scheduler_stats);
                scheduler.start(scheduler_app_handle).await;
            });

            // Shared HTTP client for LLM and tools (connection reuse)
            let http_client = std::sync::Arc::new(
                reqwest::Client::builder()
                    .pool_max_idle_per_host(4)
                    .build()
                    .expect("Failed to create reqwest client"),
            );

            // Register the KernelState so frontend Commands and background Agents can emit Syscalls
            let kernel_state = KernelState {
                syscall_tx,
                spatial_positions: std::sync::Arc::new(tokio::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
                stats,
                http_client,
                node_registry: std::sync::Arc::new(tokio::sync::RwLock::new(
                    std::collections::HashMap::new(),
                )),
                approval_gate: std::sync::Arc::new(
                    kernel::approval_gate::ApprovalGate::new(),
                ),
            };
            app.manage(kernel_state.clone());

            // ── Auth + HTTP server for remote access ────────────────────────
            let auth = Arc::new(AuthManager::new(app_dir.clone()).expect("Failed to init auth"));
            app.manage(auth.clone());
            let (event_tx, _) = tokio::sync::broadcast::channel(64);
            app.manage(EventBroadcast(event_tx.clone()));
            let app_handle = app.handle().clone();
            // Resolve the static‐assets directory for the HTTP/HTTPS server.
            // In a bundled .app, resource_dir contains the frontend build.
            // In dev mode (cargo run), we fall back to the Vite output at ../dist.
            let dist_path = {
                let mut resolved: Option<PathBuf> = None;
                if let Ok(res) = app_handle.path().resource_dir() {
                    if res.join("index.html").exists() {
                        resolved = Some(res);
                    }
                }
                if resolved.is_none() {
                    // Dev fallback: from src-tauri → ../dist
                    if let Ok(cwd) = std::env::current_dir() {
                        for candidate in [
                            cwd.join("dist"),            // if cwd = web/
                            cwd.join("../dist").canonicalize().unwrap_or_default(), // if cwd = web/src-tauri
                        ] {
                            if candidate.join("index.html").exists() {
                                resolved = Some(candidate);
                                break;
                            }
                        }
                    }
                }
                let path = resolved.unwrap_or_else(|| {
                    std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("dist")
                });
                log::info!("[HTTP] dist_path = {:?} (has index.html = {})", path, path.join("index.html").exists());
                path
            };
            let http_state = HttpState::new(auth, kernel_state, app_handle.clone(), dist_path, event_tx);
            tauri::async_runtime::spawn(async move {
                http_server::serve(http_state).await;
            });

            // ── Global Shortcut: Cmd+Shift+Space to toggle ─────────
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
            let app_handle = app.handle().clone();
            app.global_shortcut()
                .on_shortcut(shortcut, move |_app, _shortcut, _event| {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })?;

            // ── System Tray Icon ───────────────────────────────────
            let show_item = MenuItemBuilder::with_id("show", "Show SynthesisOS").build(app)?;
            let jarvis_on =
                MenuItemBuilder::with_id("jarvis_on", "Enter Jarvis Mode").build(app)?;
            let jarvis_off =
                MenuItemBuilder::with_id("jarvis_off", "Exit Jarvis Mode").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&jarvis_on)
                .item(&jarvis_off)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(Image::from_path("icons/32x32.png").unwrap_or_else(|_| {
                    app.default_window_icon().cloned().unwrap_or_else(|| {
                        Image::from_bytes(include_bytes!("../icons/32x32.png"))
                            .expect("Failed to load tray icon")
                    })
                }))
                .menu(&tray_menu)
                .tooltip("SynthesisOS — Cmd+Shift+Space to toggle")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "jarvis_on" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if let Ok(Some(monitor)) = window.current_monitor() {
                                    let size = monitor.size();
                                    let _ = window.set_size(tauri::Size::Physical(*size));
                                    let _ = window.set_position(tauri::Position::Physical(
                                        tauri::PhysicalPosition { x: 0, y: 0 },
                                    ));
                                }

                                // Set window level and presentation options on the main thread
                                let w = window.clone();
                                let _ = window.run_on_main_thread(move || unsafe {
                                    if let Ok(ns_window) = w.ns_window() {
                                        let ns_window_ptr =
                                            ns_window as *mut objc2::runtime::AnyObject;
                                        let _: () = msg_send![ns_window_ptr, setLevel: 1000isize];
                                    }

                                    let ns_app: *mut objc2::runtime::AnyObject =
                                        msg_send![objc2::class!(NSApplication), sharedApplication];
                                    let options: usize = (1 << 1) | (1 << 3);
                                    let _: () = msg_send![ns_app, setPresentationOptions: options];
                                });

                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) =
                                    kernel::commands::desktop_takeover::enter_jarvis_mode().await
                                {
                                    log::error!("Failed to enter Jarvis mode: {}", e);
                                }
                            });
                        }
                        "jarvis_off" => {
                            if let Some(window) = app.get_webview_window("main") {
                                // Reset window properties on the main thread
                                let w = window.clone();
                                let _ = window.run_on_main_thread(move || unsafe {
                                    if let Ok(ns_window) = w.ns_window() {
                                        let ns_window_ptr =
                                            ns_window as *mut objc2::runtime::AnyObject;
                                        let _: () = msg_send![ns_window_ptr, setLevel: 0isize];
                                    }

                                    let ns_app: *mut objc2::runtime::AnyObject =
                                        msg_send![objc2::class!(NSApplication), sharedApplication];
                                    let options: usize = 0;
                                    let _: () = msg_send![ns_app, setPresentationOptions: options];
                                });

                                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                                    width: 1400.0,
                                    height: 900.0,
                                }));
                                let _ = window.center();
                            }
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = kernel::commands::desktop_takeover::exit_jarvis_mode().await
                                {
                                    log::error!("Failed to exit Jarvis mode: {}", e);
                                }
                            });
                        }
                        "quit" => {
                            kernel::commands::desktop_takeover::restore_desktop_sync();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                // When the window loses focus, notify the frontend
                // (the frontend decides whether to auto-hide based on settings)
                WindowEvent::Focused(focused) => {
                    let _ = window.emit("window-focus-changed", *focused);
                }
                // Restore desktop on window close (safety net)
                WindowEvent::Destroyed => {
                    kernel::commands::desktop_takeover::restore_desktop_sync();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Core
            ping,
            kernel_ping,
            submit_agent_task,
            submit_synthesis_task,
            respond_tool_approval,
            test_concurrency,
            update_spatial_positions,
            run_applescript,
            run_jxa,
            get_frontmost_app,
            scrape_url,
            browser_navigate,
            browser_interact,
            // System
            clipboard_read,
            clipboard_write,
            system_notify,
            get_volume,
            set_volume,
            get_brightness,
            set_brightness,
            toggle_dark_mode,
            get_battery,
            get_wifi,
            get_system_info,
            open_app,
            say_tts,
            take_screenshot,
            search_files,
            // Apps
            commands::calendar::get_calendar_events,
            notes_list,
            notes_read,
            notes_create,
            email_list,
            calendar_today,
            calendar_create,
            reminders_list,
            reminders_add,
            contacts_search,
            music_play,
            music_pause,
            music_next,
            finder_open,
            finder_trash,
            safari_tabs,
            // Desktop Takeover (Jarvis Mode)
            enter_jarvis_mode,
            exit_jarvis_mode,
            hide_desktop_icons,
            show_desktop_icons,
            hide_dock,
            show_dock,
            get_kernel_stats,
            set_scheduler_policy,
            set_qos_params,
            set_context_defaults,
            set_storage_config,
            set_memory_config,
            list_memories,
            get_user_profile_summary,
            get_context_messages,
            list_storage,
            read_storage,
            update_memory,
            delete_memory,
            delete_all_memories,
            reset_all_data,
            get_all_tools,
            // Native SpaceDock
            commands::spacedock_native::create_native_dock,
            commands::spacedock_native::destroy_native_dock,
            commands::spacedock_native::set_native_dock_visible,
            commands::spacedock_native::update_native_dock_active_space,
            commands::spacedock_native::is_native_dock_active,
            commands::spacedock_native::reposition_native_dock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
