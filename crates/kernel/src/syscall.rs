use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

/// Metrics for a system call.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyscallMetrics {
    pub created_at: u64,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub waiting_ms: u64,
    pub execution_ms: u64,
}

/// Global statistics for the SynthesisOS kernel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelStats {
    pub uptime_secs: u64,
    pub total_syscalls: u64,
    pub active_agents: usize,
    pub llm_avg_latency_ms: f64,
    pub queue_size: usize,
    pub policy: String,
}

impl Default for KernelStats {
    fn default() -> Self {
        Self {
            uptime_secs: 0,
            total_syscalls: 0,
            active_agents: 0,
            llm_avg_latency_ms: 0.0,
            queue_size: 0,
            policy: "FIFO".to_string(),
        }
    }
}

/// The result returned by a syscall.
#[derive(Debug)]
pub struct SyscallResponse {
    pub data: Result<serde_json::Value, String>,
    pub metrics: SyscallMetrics,
}

impl SyscallResponse {
    pub fn new(data: Result<serde_json::Value, String>, metrics: SyscallMetrics) -> Self {
        Self { data, metrics }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Priority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// The core operations an agent can request.
/// Agents never execute these directly; they send a Syscall to the Kernel Scheduler.
///
/// Syscall v2: Extended with storage LSFS operations, context management, and batch LLM.
#[derive(Debug)]
pub enum Syscall {
    // ═══════════════════════════════════════════════════════════════════════
    // LLM Syscalls
    // ═══════════════════════════════════════════════════════════════════════
    /// Request the LLM to process a prompt. May return text or JSON tool calls.
    /// Routes through LlmAdapter to any provider (OpenAI, Anthropic, Groq, Gemini, Ollama).
    LlmRequest {
        agent_id: String,
        priority: Priority,
        prompt: String,
        response_tx: oneshot::Sender<SyscallResponse>,
        system_prompt: Option<String>,
        tool_definitions: Option<Vec<serde_json::Value>>,
        model: Option<String>,
        stream: bool,
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    },

    /// Batch LLM request — submit multiple prompts for parallel processing.
    /// Returns results in order. Used for plan-and-execute and multi-agent strategies.
    LlmBatchRequest {
        agent_id: String,
        priority: Priority,
        requests: Vec<LlmBatchItem>,
        response_tx: oneshot::Sender<Vec<SyscallResponse>>,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Tool Syscalls
    // ═══════════════════════════════════════════════════════════════════════
    /// Request the list of available tool definitions for LLM context.
    GetToolDefinitions {
        agent_id: String,
        response_tx: oneshot::Sender<Vec<serde_json::Value>>,
    },

    /// Request execution of a specific tool by name with JSON arguments.
    ToolRequest {
        agent_id: String,
        priority: Priority,
        tool_name: String,
        args: String, // JSON payload
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Retrieve the top-K most relevant tools for a query via Tool RAG (semantic search).
    /// Returns Vec<String> of tool names as JSON in SyscallResponse.
    ToolRetrieve {
        query: String,
        top_k: usize,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Memory Syscalls
    // ═══════════════════════════════════════════════════════════════════════
    /// Read short-term context (RAM) or semantic search in long-term (LanceDB).
    MemoryRead {
        agent_id: String,
        key: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Write to short-term context (RAM) + long-term (LanceDB embeddings).
    MemoryWrite {
        agent_id: String,
        key: String,
        data: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Append to a memory block (Conscious Memory tool).
    MemoryAppend {
        agent_id: String,
        key: String,
        data: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Retrieve memories by semantic similarity with optional filters.
    /// Returns Vec<MemoryEntry> as JSON in SyscallResponse.
    MemoryRetrieve {
        agent_id: String,
        query: String,
        tags: Option<Vec<String>>,
        limit: usize,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Evolve/merge agentic memory based on new content.
    MemoryEvolve {
        agent_id: String,
        content: String,
        context: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Archive conversation turns (bulk write for context paging).
    MemoryArchive {
        agent_id: String,
        turns: Vec<(String, String)>, // role, content
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Storage Syscalls (LSFS — versioned file system)
    // ═══════════════════════════════════════════════════════════════════════
    /// Read file from versioned storage.
    StorageRead {
        agent_id: String,
        path: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Write file to versioned storage (creates new version).
    StorageWrite {
        agent_id: String,
        path: String,
        data: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Create a new file or directory in storage.
    StorageCreate {
        agent_id: String,
        path: String,
        content: Option<String>, // None = directory, Some = file with content
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// List directory contents with metadata.
    StorageList {
        agent_id: String,
        path: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Delete a file or directory from storage.
    StorageDelete {
        agent_id: String,
        path: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Rollback a file to a specific version.
    StorageRollback {
        agent_id: String,
        path: String,
        version: u64,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Share a file with another agent.
    StorageShare {
        agent_id: String,
        path: String,
        target_agent_id: String,
        permission: String, // "read" | "write" | "readwrite"
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Get version history for a file.
    StorageVersions {
        agent_id: String,
        path: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Context Syscalls (token-aware conversation management)
    // ═══════════════════════════════════════════════════════════════════════
    /// Create a new context window for an agent with a token budget.
    ContextCreate {
        agent_id: String,
        max_tokens: usize,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Compact an agent's context by summarizing old messages.
    ContextCompact {
        agent_id: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Save a context checkpoint for later recovery.
    ContextCheckpoint {
        agent_id: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Get all messages in an agent's context window (e.g. for Settings UI).
    ContextGetMessages {
        agent_id: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Update an existing memory entry (content, tags, context).
    MemoryUpdate {
        agent_id: String,
        entry_id: String,
        content: Option<String>,
        tags: Option<Vec<String>>,
        context: Option<String>,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Delete a memory entry by id.
    MemoryDelete {
        agent_id: String,
        entry_id: String,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Delete all memory entries, optionally filtered by agent_id.
    MemoryDeleteAll {
        agent_id: Option<String>,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Runtime Configuration Syscalls (hot-reload from UI)
    // ═══════════════════════════════════════════════════════════════════════
    /// Update storage subsystem configuration at runtime.
    UpdateStorageConfig {
        auto_versioning: bool,
        max_versions: u32,
        response_tx: oneshot::Sender<SyscallResponse>,
    },

    /// Update memory subsystem configuration at runtime.
    UpdateMemoryConfig {
        auto_tagging: bool,
        compaction_threshold: u8,
        max_per_agent: u32,
        reflection_enabled: bool,
        reflection_interval_mins: u64,
        reflection_model: Option<String>,
        response_tx: oneshot::Sender<SyscallResponse>,
    },
}

/// A single item in a batch LLM request.
#[derive(Debug)]
pub struct LlmBatchItem {
    pub prompt: String,
    pub system_prompt: Option<String>,
    pub tool_definitions: Option<Vec<serde_json::Value>>,
    pub model: Option<String>,
    pub max_tokens: Option<usize>,
    pub max_completion_tokens: Option<usize>,
}
