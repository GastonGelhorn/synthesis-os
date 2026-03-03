//! Conversation context: token-bounded message windows (e.g. "session" for recent turns).
//! - Prune: drop oldest non-system messages when over budget.
//! - Compact: drop or (future) summarize old messages.
//! For long-term persistent memory and semantic search use kernel::memory::MemoryManager instead.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Token budget structure for managing context window size
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenBudget {
    pub max_tokens: usize,
    pub used_tokens: usize,
    pub reserved_tokens: usize, // Reserved for system prompt
}

impl TokenBudget {
    pub fn new(max_tokens: usize, reserved_tokens: usize) -> Self {
        Self {
            max_tokens,
            used_tokens: 0,
            reserved_tokens,
        }
    }

    /// Get remaining tokens available for user messages
    pub fn remaining(&self) -> usize {
        let available = self.max_tokens.saturating_sub(self.reserved_tokens);
        available.saturating_sub(self.used_tokens)
    }

    /// Check if adding tokens would exceed budget
    pub fn can_fit(&self, tokens: usize) -> bool {
        self.used_tokens + tokens <= (self.max_tokens - self.reserved_tokens)
    }
}

/// A single message in the context window
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMessage {
    pub role: String, // "user", "assistant", "system"
    pub content: String,
    pub token_count: usize,
    pub timestamp: u64, // Unix timestamp in milliseconds
}

impl ContextMessage {
    fn new(role: String, content: String, token_count: usize) -> Self {
        Self {
            role,
            content,
            token_count,
            timestamp: Utc::now().timestamp_millis() as u64,
        }
    }
}

/// Checkpoint for saving/restoring context state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextCheckpoint {
    pub agent_id: String,
    pub messages: Vec<ContextMessage>,
    pub budget: TokenBudget,
    pub created_at: u64,
}

/// Per-agent context window
#[derive(Debug, Clone)]
struct ContextWindow {
    messages: Vec<ContextMessage>,
    budget: TokenBudget,
    metadata: HashMap<String, String>, // For backward compatibility
}

impl ContextWindow {
    fn new(budget: TokenBudget) -> Self {
        Self {
            messages: Vec::new(),
            budget,
            metadata: HashMap::new(),
        }
    }

    /// Add a message with optional auto-prune if over budget.
    /// Returns any messages that were pruned.
    fn add_message(
        &mut self,
        role: String,
        content: String,
        should_auto_prune: bool,
    ) -> Result<Vec<ContextMessage>, String> {
        let token_count = estimate_tokens(&content);

        if token_count > self.budget.remaining() {
            if !should_auto_prune {
                return Err(format!(
                    "Message too large: {} tokens, but only {} remaining (auto-prune disabled)",
                    token_count,
                    self.budget.remaining()
                ));
            }
            // Auto-prune will make room below
        }

        self.messages
            .push(ContextMessage::new(role, content, token_count));
        self.budget.used_tokens += token_count;

        let pruned = if should_auto_prune {
            self.auto_prune()
        } else {
            Vec::new()
        };

        Ok(pruned)
    }

    /// Prune oldest non-system messages until under budget
    fn auto_prune(&mut self) -> Vec<ContextMessage> {
        let mut pruned_messages = Vec::new();
        while self.budget.used_tokens > (self.budget.max_tokens - self.budget.reserved_tokens) {
            // Find the oldest non-system message
            let oldest_idx = self
                .messages
                .iter()
                .enumerate()
                .filter(|(_, msg)| msg.role != "system")
                .min_by_key(|(_, msg)| msg.timestamp)
                .map(|(idx, _)| idx);

            if let Some(idx) = oldest_idx {
                let removed = self.messages.remove(idx);
                self.budget.used_tokens =
                    self.budget.used_tokens.saturating_sub(removed.token_count);
                pruned_messages.push(removed);
            } else {
                // No non-system messages, break to avoid infinite loop
                break;
            }
        }
        pruned_messages
    }

    /// Get all messages within budget
    fn get_messages(&self) -> Vec<ContextMessage> {
        self.messages.clone()
    }

    /// Get remaining tokens
    fn remaining_tokens(&self) -> usize {
        self.budget.remaining()
    }

    /// Compact messages by summarizing old ones (placeholder for LLM call)
    fn compact(&mut self) -> Result<(), String> {
        if self.messages.len() < 3 {
            return Ok(());
        }

        // Keep the last 2 messages, summarize the rest
        let to_compact = self.messages.len().saturating_sub(2);

        if to_compact > 0 {
            let older_msgs: Vec<_> = self.messages.drain(0..to_compact).collect();

            // Simple compaction: count tokens to estimate savings
            let freed_tokens: usize = older_msgs.iter().map(|m| m.token_count).sum();
            self.budget.used_tokens = self.budget.used_tokens.saturating_sub(freed_tokens);

            // In a real implementation, we would call the LLM to summarize:
            // let summary = llm_summarize(&older_msgs).await?;
            // let summary_tokens = estimate_tokens(&summary);
            // self.messages.insert(0, ContextMessage::new("system".to_string(), format!("Previous context summary: {}", summary), summary_tokens));
            // self.budget.used_tokens += summary_tokens;
        }

        Ok(())
    }

    /// Clear all messages
    fn clear(&mut self) {
        self.messages.clear();
        self.budget.used_tokens = 0;
    }

    /// Save checkpoint
    fn checkpoint(&self, agent_id: String) -> ContextCheckpoint {
        ContextCheckpoint {
            agent_id,
            messages: self.messages.clone(),
            budget: self.budget.clone(),
            created_at: Utc::now().timestamp_millis() as u64,
        }
    }

    /// Restore from checkpoint
    fn restore(&mut self, checkpoint: ContextCheckpoint) -> Result<(), String> {
        self.messages = checkpoint.messages;
        self.budget = checkpoint.budget;
        Ok(())
    }

    /// Backward compatibility: get/set key-value pairs
    fn get(&self, key: &str) -> Option<String> {
        self.metadata.get(key).cloned()
    }

    fn set(&mut self, key: String, value: String) {
        self.metadata.insert(key, value);
    }
}

/// Token-aware context manager
pub struct ContextManager {
    windows: Arc<Mutex<HashMap<String, ContextWindow>>>,
    default_budget: usize,
    reserved_pct: u8,
    auto_prune_enabled: bool,
    auto_compact_enabled: bool,
}

impl ContextManager {
    pub fn new(default_budget: usize) -> Self {
        Self {
            windows: Arc::new(Mutex::new(HashMap::new())),
            default_budget,
            reserved_pct: 10,
            auto_prune_enabled: true,
            auto_compact_enabled: false,
        }
    }

    /// Update configuration at runtime (called from Tauri commands)
    pub fn update_config(
        &mut self,
        default_budget: usize,
        reserved_pct: u8,
        auto_prune: bool,
        auto_compact: bool,
    ) {
        println!(
            "[ContextManager] Config updated: budget={}, reserved={}%, prune={}, compact={}",
            default_budget, reserved_pct, auto_prune, auto_compact
        );
        self.default_budget = default_budget;
        self.reserved_pct = reserved_pct.min(50); // Cap at 50% to prevent unusable contexts
        self.auto_prune_enabled = auto_prune;
        self.auto_compact_enabled = auto_compact;
    }

    /// Create a new context for an agent
    pub fn create_context(&self, agent_id: &str, budget: TokenBudget) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if windows.contains_key(agent_id) {
            return Err(format!("Context already exists for agent: {}", agent_id));
        }

        windows.insert(agent_id.to_string(), ContextWindow::new(budget));
        Ok(())
    }

    /// Create context with default budget if it doesn't exist
    fn ensure_context(&self, agent_id: &str) -> Result<(), String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if !windows.contains_key(agent_id) {
            drop(windows);
            let reserved = self.default_budget * self.reserved_pct as usize / 100;
            let budget = TokenBudget::new(self.default_budget, reserved);
            self.create_context(agent_id, budget)?;
        }

        Ok(())
    }

    /// Add a message to context (respects auto_prune_enabled setting).
    /// Returns any messages that were pruned during the addition.
    pub fn add_message(
        &self,
        agent_id: &str,
        role: &str,
        content: &str,
    ) -> Result<Vec<ContextMessage>, String> {
        self.ensure_context(agent_id)?;

        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if let Some(window) = windows.get_mut(agent_id) {
            window.add_message(
                role.to_string(),
                content.to_string(),
                self.auto_prune_enabled,
            )
        } else {
            Err(format!("Context not found for agent: {}", agent_id))
        }
    }

    /// Get all messages for an agent
    pub fn get_messages(&self, agent_id: &str) -> Result<Vec<ContextMessage>, String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        windows
            .get(agent_id)
            .map(|w| w.get_messages())
            .ok_or_else(|| format!("Context not found for agent: {}", agent_id))
    }

    /// Get remaining tokens for an agent
    pub fn get_remaining_tokens(&self, agent_id: &str) -> Result<usize, String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        windows
            .get(agent_id)
            .map(|w| w.remaining_tokens())
            .ok_or_else(|| format!("Context not found for agent: {}", agent_id))
    }

    /// Compact context by summarizing old messages
    pub fn compact(&self, agent_id: &str) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if let Some(window) = windows.get_mut(agent_id) {
            window.compact()
        } else {
            Err(format!("Context not found for agent: {}", agent_id))
        }
    }

    /// Clear all messages for an agent
    pub fn clear(&self, agent_id: &str) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if let Some(window) = windows.get_mut(agent_id) {
            window.clear();
            Ok(())
        } else {
            Err(format!("Context not found for agent: {}", agent_id))
        }
    }

    /// Save a checkpoint of current context
    pub fn save_checkpoint(&self, agent_id: &str) -> Result<ContextCheckpoint, String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        windows
            .get(agent_id)
            .map(|w| w.checkpoint(agent_id.to_string()))
            .ok_or_else(|| format!("Context not found for agent: {}", agent_id))
    }

    /// Restore context from a checkpoint
    pub fn restore_checkpoint(
        &self,
        agent_id: &str,
        checkpoint: ContextCheckpoint,
    ) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if let Some(window) = windows.get_mut(agent_id) {
            window.restore(checkpoint)
        } else {
            Err(format!("Context not found for agent: {}", agent_id))
        }
    }

    /// Backward compatibility: get key-value pair
    pub fn get(&self, agent_id: &str, key: &str) -> Result<Option<String>, String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        Ok(windows.get(agent_id).and_then(|w| w.get(key)))
    }

    /// Backward compatibility: set key-value pair
    pub fn set(&self, agent_id: &str, key: &str, value: &str) -> Result<(), String> {
        self.ensure_context(agent_id)?;

        let mut windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        if let Some(window) = windows.get_mut(agent_id) {
            window.set(key.to_string(), value.to_string());
            Ok(())
        } else {
            Err(format!("Context not found for agent: {}", agent_id))
        }
    }

    /// Get context statistics
    pub fn get_stats(&self, agent_id: &str) -> Result<ContextStats, String> {
        let windows = self
            .windows
            .lock()
            .map_err(|e| format!("Mutex lock failed: {}", e))?;

        windows
            .get(agent_id)
            .map(|w| ContextStats {
                message_count: w.messages.len(),
                used_tokens: w.budget.used_tokens,
                remaining_tokens: w.budget.remaining(),
                max_tokens: w.budget.max_tokens,
            })
            .ok_or_else(|| format!("Context not found for agent: {}", agent_id))
    }
}

/// Statistics about a context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextStats {
    pub message_count: usize,
    pub used_tokens: usize,
    pub remaining_tokens: usize,
    pub max_tokens: usize,
}

/// Estimate token count based on character count
/// Uses a simple approximation: average 4 characters per token
pub fn estimate_tokens(text: &str) -> usize {
    // Count words as a more accurate heuristic
    let word_count = text.split_whitespace().count();
    // Average ~1.3 tokens per word in English
    ((word_count as f64) * 1.3).ceil() as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_estimation() {
        let text = "Hello world";
        let tokens = estimate_tokens(text);
        assert!(tokens > 0 && tokens <= 5);
    }

    #[test]
    fn test_context_manager_creation() {
        let mgr = ContextManager::new(4096);
        let budget = TokenBudget::new(4096, 512);
        assert!(mgr.create_context("agent1", budget).is_ok());
    }

    #[test]
    fn test_add_message() {
        let mgr = ContextManager::new(4096);
        let budget = TokenBudget::new(4096, 512);
        mgr.create_context("agent1", budget).unwrap();

        assert!(mgr.add_message("agent1", "user", "Hello").is_ok());

        let messages = mgr.get_messages("agent1").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Hello");
    }

    #[test]
    fn test_auto_prune() {
        let mgr = ContextManager::new(100); // Small budget for testing
        let budget = TokenBudget::new(100, 10);
        mgr.create_context("agent1", budget).unwrap();

        // Add messages until budget is exceeded
        for i in 0..15 {
            let _ = mgr.add_message("agent1", "user", &format!("Message {}", i));
        }

        let stats = mgr.get_stats("agent1").unwrap();
        assert!(
            stats.used_tokens <= (100 - 10),
            "Used tokens should not exceed budget after auto-prune"
        );
    }

    #[test]
    fn test_checkpoint_restore() {
        let mgr = ContextManager::new(4096);
        let budget = TokenBudget::new(4096, 512);
        mgr.create_context("agent1", budget).unwrap();

        mgr.add_message("agent1", "user", "Test message").unwrap();

        let checkpoint = mgr.save_checkpoint("agent1").unwrap();

        mgr.clear("agent1").unwrap();
        assert_eq!(mgr.get_messages("agent1").unwrap().len(), 0);

        mgr.restore_checkpoint("agent1", checkpoint).unwrap();
        assert_eq!(mgr.get_messages("agent1").unwrap().len(), 1);
    }

    #[test]
    fn test_backward_compat() {
        let mgr = ContextManager::new(4096);

        assert!(mgr.set("agent1", "key1", "value1").is_ok());
        assert_eq!(
            mgr.get("agent1", "key1").unwrap(),
            Some("value1".to_string())
        );
    }
}
