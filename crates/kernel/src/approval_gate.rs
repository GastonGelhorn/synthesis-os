use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex};

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);

/// Tools that require explicit user approval before execution (Alpha phase).
/// Covers destructive filesystem ops, external side-effects, and sensitive data access.
pub const DESTRUCTIVE_TOOLS: &[&str] = &[
    // Filesystem mutations
    "finder_trash",
    "file_write",
    "file_append",
    "file_move",
    "file_copy",
    // LSFS storage mutations
    "storage_delete",
    "storage_write",
    "storage_create",
    "storage_rollback",
    // External side-effects
    "http_request",
    "notes_create",
    "calendar_create",
    "reminders_add",
    // System mutations
    "open_app",
    "clipboard_write",
    "set_volume",
    "set_brightness",
    "toggle_dark_mode",
    "say_tts",
    // Music controls
    "music_play",
    "music_pause",
    "music_next",
];

pub fn is_destructive(tool_name: &str) -> bool {
    DESTRUCTIVE_TOOLS.contains(&tool_name)
}

struct PendingApproval {
    tx: oneshot::Sender<bool>,
    created_at: Instant,
}

/// Thread-safe store for pending approval requests.
/// Agents insert a oneshot sender keyed by `{agent_id}:{request_id}`,
/// then await the receiver. The Tauri command resolves it.
pub struct ApprovalGate {
    pending: Mutex<HashMap<String, PendingApproval>>,
}

impl ApprovalGate {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Register a pending approval and return a receiver the agent can await.
    pub async fn request(&self, key: String) -> oneshot::Receiver<bool> {
        let mut map = self.pending.lock().await;
        Self::cleanup_stale_inner(&mut map);
        let (tx, rx) = oneshot::channel();
        map.insert(key, PendingApproval { tx, created_at: Instant::now() });
        rx
    }

    /// Resolve a pending approval (called from Tauri command).
    /// Returns true if the approval was found and resolved.
    pub async fn resolve(&self, key: &str, approved: bool) -> bool {
        let mut map = self.pending.lock().await;
        if let Some(pending) = map.remove(key) {
            let _ = pending.tx.send(approved);
            true
        } else {
            false
        }
    }

    fn cleanup_stale_inner(map: &mut HashMap<String, PendingApproval>) {
        let now = Instant::now();
        map.retain(|_, v| now.duration_since(v.created_at) < APPROVAL_TIMEOUT);
    }
}

impl Default for ApprovalGate {
    fn default() -> Self {
        Self::new()
    }
}
