pub mod agent;
pub mod agent_runtime;
pub mod approval_gate;
pub mod auth;
pub mod commands;
pub mod context;
pub mod events_broadcast;
pub mod http_server;
pub mod intent_cache;
pub mod llm_core;
pub mod local_embeddings;
pub mod manager;
pub mod memory;
pub mod memory_ext;
pub mod personas;
pub mod prompts;
pub mod scheduler;
pub mod scheduler_qos;
pub mod settings;
pub mod specialists;
pub mod status_labels;
pub mod storage;
pub mod syscall;
pub mod terminal;
pub mod tool_cache;
pub mod tool_rag;
pub mod tools;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::{Mutex, RwLock};

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub struct SpatialPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Default)]
pub struct NodeSummary {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub node_type: String,
    pub space_id: Option<String>,
}

#[derive(Clone)]
pub struct KernelState {
    pub syscall_tx: mpsc::Sender<syscall::Syscall>,
    pub spatial_positions: Arc<Mutex<HashMap<String, SpatialPosition>>>,
    pub stats: Arc<Mutex<syscall::KernelStats>>,
    pub http_client: Arc<reqwest::Client>,
    pub node_registry: Arc<RwLock<HashMap<String, NodeSummary>>>,
    pub approval_gate: Arc<approval_gate::ApprovalGate>,
}
