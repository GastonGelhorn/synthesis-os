//! Broadcast of kernel events for HTTP SSE so remote clients (e.g. iPad) can receive
//! agent/synthesis progress without Tauri IPC.

use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Clone, Debug, Serialize)]
pub struct KernelEvent {
    pub event: String,
    pub task_id: String,
    pub payload: serde_json::Value,
}

/// Held in Tauri app state so agents can send events; HTTP server subscribes for SSE.
pub struct EventBroadcast(pub broadcast::Sender<KernelEvent>);

impl EventBroadcast {
    pub fn send(&self, evt: KernelEvent) {
        let _ = self.0.send(evt);
    }
}
