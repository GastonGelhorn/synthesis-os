//! Cache for tool responses to avoid redundant executions within the same agent turn.
//! Only read-only tools are cached; mutation tools are excluded.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// Tools that modify state — never cached.
const MUTATION_TOOLS: &[&str] = &[
    "file_write",
    "file_append",
    "file_move",
    "file_copy",
    "storage_write",
    "storage_create",
    "storage_delete",
    "storage_rollback",
    "notify",
    "set_volume",
    "set_brightness",
    "toggle_dark_mode",
    "open_app",
    "say_tts",
    "take_screenshot",
    "notes_create",
    "calendar_create",
    "reminders_add",
    "clipboard_write",
    "set_timer",
    "music_play",
    "music_pause",
    "music_next",
    "finder_open",
    "finder_trash",
];

fn is_mutation_tool(name: &str) -> bool {
    MUTATION_TOOLS.contains(&name)
}

#[derive(Clone)]
struct CachedEntry {
    result: Result<serde_json::Value, String>,
    expires_at: Instant,
}

#[derive(Default)]
struct CacheInner {
    map: HashMap<CacheKey, CachedEntry>,
}

#[derive(Clone, Hash, Eq, PartialEq)]
struct CacheKey {
    agent_id: String,
    tool_name: String,
    args_hash: u64,
}

fn hash_args(args: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    let mut hasher = DefaultHasher::new();
    args.hash(&mut hasher);
    hasher.finish()
}

/// Thread-safe cache for tool responses with TTL.
pub struct ToolResponseCache {
    inner: Arc<RwLock<CacheInner>>,
    ttl_secs: u64,
}

impl ToolResponseCache {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            inner: Arc::new(RwLock::new(CacheInner::default())),
            ttl_secs,
        }
    }

    /// Default TTL: 45 seconds.
    pub fn with_default_ttl() -> Self {
        Self::new(45)
    }

    pub async fn get(
        &self,
        agent_id: &str,
        tool_name: &str,
        args: &str,
    ) -> Option<Result<serde_json::Value, String>> {
        if is_mutation_tool(tool_name) {
            return None;
        }

        let key = CacheKey {
            agent_id: agent_id.to_string(),
            tool_name: tool_name.to_string(),
            args_hash: hash_args(args),
        };

        let guard = self.inner.read().await;
        let entry = guard.map.get(&key)?;
        if entry.expires_at > Instant::now() {
            Some(entry.result.clone())
        } else {
            None
        }
    }

    pub async fn set(
        &self,
        agent_id: &str,
        tool_name: &str,
        args: &str,
        result: Result<serde_json::Value, String>,
    ) {
        if is_mutation_tool(tool_name) {
            return;
        }

        let key = CacheKey {
            agent_id: agent_id.to_string(),
            tool_name: tool_name.to_string(),
            args_hash: hash_args(args),
        };

        let expires_at = Instant::now() + Duration::from_secs(self.ttl_secs);
        let entry = CachedEntry { result, expires_at };

        let mut guard = self.inner.write().await;
        // Limit cache size: if > 500 entries, remove expired first, then oldest
        if guard.map.len() >= 500 {
            let now = Instant::now();
            guard.map.retain(|_, e| e.expires_at > now);
            if guard.map.len() >= 500 {
                // Remove ~20% of entries (arbitrary eviction)
                let to_remove = guard.map.len() / 5;
                let keys: Vec<_> = guard.map.keys().cloned().take(to_remove).collect();
                for k in keys {
                    guard.map.remove(&k);
                }
            }
        }
        guard.map.insert(key, entry);
    }
}
