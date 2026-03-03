//! HTTP/HTTPS server for remote access. Serves static assets and API routes.
//! - Always serves HTTP on 0.0.0.0:3939 (desktop app talks to localhost).
//! - Optionally serves HTTPS on 0.0.0.0:3940 when cert/key PEMs are available
//!   (Safari/iOS cross-device requires HTTPS when the page origin is HTTPS).

use axum::{
    extract::{Query, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum::response::sse::{Event, Sse};
use std::path::PathBuf;
use std::sync::Arc;
use axum_server::tls_rustls::RustlsConfig;
use tokio::sync::broadcast;
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use crate::auth::{AuthManager, Claims, User, UserRole};
use crate::events_broadcast::KernelEvent;
use tauri::Manager;

const HTTP_PORT: u16 = 3939;
const HTTPS_PORT: u16 = 3940;

/// Shared state for HTTP handlers.
#[derive(Clone)]
pub struct HttpState {
    pub auth: Arc<AuthManager>,
    pub kernel: crate::KernelState,
    pub app_handle: tauri::AppHandle,
    pub dist_path: PathBuf,
    pub event_tx: broadcast::Sender<KernelEvent>,
}

/// Extract effective user from JWT + optional X-Impersonate-User (super_admin only).
#[derive(Clone)]
pub struct AuthUser {
    pub claims: Claims,
    pub effective_user: User,
}

impl HttpState {
    pub fn new(
        auth: Arc<AuthManager>,
        kernel: crate::KernelState,
        app_handle: tauri::AppHandle,
        dist_path: PathBuf,
        event_tx: broadcast::Sender<KernelEvent>,
    ) -> Self {
        Self {
            auth,
            kernel,
            app_handle,
            dist_path,
            event_tx,
        }
    }
}

/// Middleware: extract and validate JWT, resolve effective user (with impersonation).
async fn auth_layer(State(state): State<HttpState>, request: Request, next: axum::middleware::Next) -> Response {
    let path = request.uri().path();
    if path.starts_with("/api/auth/login")
        || path.starts_with("/api/health")
        || path.starts_with("/api/auth/setup-status")
        || path.starts_with("/api/auth/setup")
        || path.starts_with("/api/cert.pem")
    {
        return next.run(request).await;
    }

    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    // EventSource cannot send headers; allow token in query for /api/kernel/events
    let query_token: Option<String> = if path.starts_with("/api/kernel/events") {
        request.uri().query().and_then(|q| {
            q.split('&')
                .find(|s| s.starts_with("token="))
                .and_then(|s| urlencoding::decode(s.trim_start_matches("token=")).ok())
                .map(|s| s.into_owned())
        })
    } else {
        None
    };
    let bearer_opt = query_token
        .as_deref()
        .or_else(|| auth_header.and_then(|h| h.strip_prefix("Bearer ")));
    let bearer = match bearer_opt {
        Some(b) => b,
        None => {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Missing or invalid Authorization"}))).into_response();
        }
    };

    let claims = match state.auth.validate_token(bearer) {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": e}))).into_response();
        }
    };

    let mut effective_user = match state.auth.get_user(&claims.sub) {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "User not found"}))).into_response();
        }
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e}))).into_response();
        }
    };

    if let Some(impersonate_header) = request.headers().get("X-Impersonate-User") {
        if let Ok(imp_id) = impersonate_header.to_str() {
            if effective_user.role.can_impersonate() {
                if let Ok(Some(imp_user)) = state.auth.get_user(imp_id.trim()) {
                    effective_user = imp_user;
                }
            }
        }
    }

    // Store effective user in request extensions for handlers
    let mut req = request;
    req.extensions_mut().insert(AuthUser {
        claims,
        effective_user,
    });
    next.run(req).await
}

/// POST /api/auth/login
#[derive(serde::Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn auth_login(State(state): State<HttpState>, Json(body): Json<LoginRequest>) -> impl IntoResponse {
    match state.auth.login(&body.username, &body.password) {
        Ok((user, token)) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "token": token,
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "role": user.role.as_str(),
                    "display_name": user.display_name,
                }
            })),
        ),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// GET /api/auth/me - returns current (or impersonated) user
async fn auth_me(
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    let u = &auth_user.effective_user;
    Json(serde_json::json!({
        "id": u.id,
        "username": u.username,
        "role": u.role.as_str(),
        "display_name": u.display_name,
    }))
}

/// POST /api/auth/reset-to-setup - clear all users, memory, and settings. super_admin only.
async fn auth_reset_to_setup(
    State(state): State<HttpState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    if auth_user.effective_user.role != UserRole::SuperAdmin {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "super_admin only"})),
        );
    }
    if let Err(e) = state.auth.clear_all_users() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        );
    }
    // Clear kernel memory
    let (tx, rx) = tokio::sync::oneshot::channel();
    if state
        .kernel
        .syscall_tx
        .send(crate::syscall::Syscall::MemoryDeleteAll {
            agent_id: None,
            response_tx: tx,
        })
        .await
        .is_err()
    {
        // Non-fatal: memory clear failed, continue
    } else {
        let _ = rx.await;
    }
    // Clear settings store (API keys, etc.)
    if let Err(e) = crate::settings::clear_settings_store(&state.app_handle) {
        // Log but don't fail — settings clear is best-effort
        eprintln!("[auth_reset_to_setup] Failed to clear settings store: {}", e);
    }
    (
        StatusCode::OK,
        Json(serde_json::json!({ "message": "Reset to setup complete" })),
    )
}

/// GET /api/user/sync-state - return settings and workspace JSON for the authenticated user (cross-device sync).
async fn user_sync_state_get(
    State(state): State<HttpState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    let user_id = &auth_user.effective_user.id;
    let settings = state.auth.get_client_state(user_id, "settings").ok().flatten();
    let workspace = state.auth.get_client_state(user_id, "workspace").ok().flatten();
    let settings_json = settings.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
    let workspace_json = workspace.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "settings": settings_json,
            "workspace": workspace_json,
        })),
    )
}

#[derive(serde::Deserialize)]
struct SyncStatePutBody {
    settings: Option<serde_json::Value>,
    workspace: Option<serde_json::Value>,
}

/// PUT /api/user/sync-state - persist settings and/or workspace for the authenticated user.
async fn user_sync_state_put(
    State(state): State<HttpState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
    Json(body): Json<SyncStatePutBody>,
) -> impl IntoResponse {
    let user_id = &auth_user.effective_user.id;
    if let Some(ref s) = body.settings {
        if let Err(e) = state.auth.set_client_state(user_id, "settings", &s.to_string()) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response();
        }
    }
    if let Some(ref w) = body.workspace {
        if let Err(e) = state.auth.set_client_state(user_id, "workspace", &w.to_string()) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            )
                .into_response();
        }
    }
    (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response()
}

/// GET /api/health
async fn health() -> &'static str {
    "ok"
}

/// GET /api/cert.pem — serve the self-signed TLS certificate so iPad/iOS can download
/// and install it as a trusted profile (Settings → General → Profiles).
async fn serve_tls_cert(State(state): State<HttpState>) -> Response {
    let cert_path = state
        .app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("tls").join("cert.pem"));

    if let Some(path) = cert_path {
        if let Ok(pem) = std::fs::read(&path) {
            return (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, "application/x-pem-file"),
                    (
                        header::CONTENT_DISPOSITION,
                        "attachment; filename=\"SynthesisOS-CA.pem\"",
                    ),
                ],
                pem,
            )
                .into_response();
        }
    }
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"error": "TLS certificate not found"})),
    )
        .into_response()
}

/// Query for SSE kernel events endpoint.
#[derive(serde::Deserialize)]
struct KernelEventsQuery {
    task_id: String,
}

/// GET /api/kernel/events?task_id=xxx — SSE stream of agent/synthesis events for remote clients (e.g. iPad).
async fn kernel_events_sse(
    State(state): State<HttpState>,
    Query(q): Query<KernelEventsQuery>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>> + Send + 'static> {
    let mut broadcast_rx = state.event_tx.subscribe();
    let task_id = q.task_id.clone();
    let (tx, rx) = tokio::sync::mpsc::channel::<KernelEvent>(16);
    tokio::spawn(async move {
        loop {
            match broadcast_rx.recv().await {
                Ok(evt) if evt.task_id == task_id => {
                    if tx.send(evt).await.is_err() {
                        break;
                    }
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    let stream = ReceiverStream::new(rx).map(|evt| {
        let data = serde_json::to_string(&evt.payload).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().event(evt.event).data(data))
    });
    Sse::new(stream)
}

/// GET /api/auth/setup-status - public, returns whether setup is needed and list of users for login
async fn auth_setup_status(State(state): State<HttpState>) -> impl IntoResponse {
    match state.auth.user_count() {
        Ok(0) => (
            StatusCode::OK,
            Json(serde_json::json!({ "hasUsers": false, "users": [] })),
        ),
        Ok(_) => {
            match state.auth.list_users() {
                Ok(users) => {
                    let list: Vec<serde_json::Value> = users
                        .iter()
                        .map(|u| {
                            serde_json::json!({
                                "id": u.id,
                                "username": u.username,
                                "display_name": u.display_name,
                            })
                        })
                        .collect();
                    (
                        StatusCode::OK,
                        Json(serde_json::json!({ "hasUsers": true, "users": list })),
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e})),
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// POST /api/auth/setup - create first user (super_admin), only when no users exist
#[derive(serde::Deserialize)]
struct SetupRequest {
    username: String,
    password: String,
    display_name: Option<String>,
}

async fn auth_setup(State(state): State<HttpState>, Json(body): Json<SetupRequest>) -> impl IntoResponse {
    let count = match state.auth.user_count() {
        Ok(n) => n,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e})),
            );
        }
    };
    if count > 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Setup already complete"})),
        );
    }
    match state.auth.create_user(
        body.username.trim(),
        &body.password,
        crate::auth::UserRole::SuperAdmin,
        body.display_name.as_deref(),
    ) {
        Ok(user) => {
            match state.auth.login(&user.username, &body.password) {
                Ok((u, token)) => (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "token": token,
                        "user": {
                            "id": u.id,
                            "username": u.username,
                            "role": u.role.as_str(),
                            "display_name": u.display_name,
                        }
                    })),
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": e})),
                ),
            }
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e})),
        ),
    }
}

/// GET /api/users - list all users (super_admin only)
async fn list_users(
    State(state): State<HttpState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
) -> impl IntoResponse {
    if !auth_user.effective_user.role.can_manage_users() {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Forbidden"})),
        )
            .into_response();
    }
    match state.auth.list_users() {
        Ok(users) => {
            let list: Vec<serde_json::Value> = users
                .iter()
                .map(|u| {
                    serde_json::json!({
                        "id": u.id,
                        "username": u.username,
                        "role": u.role.as_str(),
                        "display_name": u.display_name,
                    })
                })
                .collect();
            (StatusCode::OK, Json(serde_json::Value::Array(list))).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

/// POST /api/kernel/invoke - proxy kernel commands
#[derive(serde::Deserialize)]
struct InvokeRequest {
    cmd: String,
    args: Option<serde_json::Value>,
}

async fn kernel_invoke(
    State(state): State<HttpState>,
    axum::Extension(auth_user): axum::Extension<AuthUser>,
    Json(body): Json<InvokeRequest>,
) -> impl IntoResponse {
    let user = &auth_user.effective_user;
    let args = body.args.unwrap_or(serde_json::json!({}));

    if user.role == UserRole::Guest {
        let allowed = ["get_all_tools", "get_kernel_stats", "list_memories", "get_user_profile_summary", "list_storage", "read_storage", "submit_agent_task", "submit_synthesis_task"];
        if !allowed.contains(&body.cmd.as_str()) {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Guest cannot perform this action"})),
            )
                .into_response();
        }
    }
    let result = kernel_invoke_impl(state, user, &body.cmd, &args).await;

    match result {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response(),
    }
}

async fn kernel_invoke_impl(
    state: HttpState,
    user: &User,
    cmd: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let agent_id = format!("user_{}", user.id);
    match cmd {
        "get_all_tools" => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::GetToolDefinitions {
                    agent_id,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let defs = rx.await.map_err(|e| e.to_string())?;
            Ok(serde_json::Value::Array(defs))
        }
        "get_kernel_stats" => {
            let stats = state.kernel.stats.lock().await;
            Ok(serde_json::to_value(stats.clone()).unwrap_or_else(|_| serde_json::json!({})))
        }
        "list_memories" => {
            // agentId null/missing/empty → "" → kernel returns ALL agents' memories,
            // matching the behaviour of the direct Tauri invoke (lib.rs: unwrap_or_default()).
            let aid = args
                .get("agentId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::MemoryRetrieve {
                    agent_id: aid,
                    query: String::new(),
                    tags: None,
                    limit: 500,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            let data = resp.data.map_err(|e| e)?;
            let entries = data.get("entries").and_then(|e| e.as_array()).cloned().unwrap_or_default();
            Ok(serde_json::Value::Array(entries))
        }
        "get_user_profile_summary" => {
            // Must use "user" (hardcoded) to match the agent_id used by the Tauri
            // direct invoke (lib.rs). The profile is always stored under agent_id "user".
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::MemoryRead {
                    agent_id: "user".to_string(),
                    key: "core:user_profile".to_string(),
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            let data = resp.data.map_err(|e| e)?;
            Ok(serde_json::Value::String(data.as_str().unwrap_or("").to_string()))
        }
        "list_storage" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("/");
            // Must use "settings" to match the Tauri direct invoke (lib.rs).
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::StorageList {
                    agent_id: "settings".to_string(),
                    path: path.to_string(),
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            let data = resp.data.map_err(|e| e)?;
            Ok(data)
        }
        "read_storage" => {
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("path required")?;
            // Must use "settings" to match the Tauri direct invoke (lib.rs).
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::StorageRead {
                    agent_id: "settings".to_string(),
                    path: path.to_string(),
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            let data = resp.data.map_err(|e| e)?;
            Ok(serde_json::Value::String(data.as_str().unwrap_or("").to_string()))
        }
        "submit_agent_task" => {
            let query = args.get("query").and_then(|v| v.as_str()).ok_or("query required")?;
            let task_id = args.get("taskId").and_then(|v| v.as_str()).map(String::from);
            let conversation_history = args.get("conversationHistory").and_then(|v| v.as_str()).map(String::from);
            let node_summaries: Option<Vec<serde_json::Value>> = args
                .get("nodeSummaries")
                .and_then(|v| v.as_array())
                .map(|a| a.to_vec());
            let mode = args.get("mode").and_then(|v| v.as_str()).map(String::from);
            let user_context = args.get("userContext").and_then(|v| v.as_str()).map(String::from);
            let tid = crate::agent::BaseAgent::spawn(
                query.to_string(),
                task_id,
                conversation_history,
                node_summaries,
                mode,
                user_context,
                state.kernel.syscall_tx.clone(),
                state.app_handle.clone(),
            );
            Ok(serde_json::Value::String(tid))
        }
        "submit_synthesis_task" => {
            let query = args.get("query").and_then(|v| v.as_str()).ok_or("query required")?;
            let task_id = args.get("taskId").and_then(|v| v.as_str()).ok_or("taskId required")?;
            let result_id = crate::agent::SynthesisAgent::spawn(
                query.to_string(),
                task_id.to_string(),
                state.kernel.syscall_tx.clone(),
                state.app_handle.clone(),
            );
            Ok(serde_json::Value::String(result_id))
        }
        "delete_memory" => {
            let agent_id_arg = args.get("agentId").and_then(|v| v.as_str()).ok_or("agentId required")?;
            let entry_id = args.get("entryId").and_then(|v| v.as_str()).ok_or("entryId required")?;
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::MemoryDelete {
                    agent_id: agent_id_arg.to_string(),
                    entry_id: entry_id.to_string(),
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            resp.data.map(|_| serde_json::json!({})).map_err(|e| e)
        }
        "update_memory" => {
            let agent_id_arg = args.get("agentId").and_then(|v| v.as_str()).ok_or("agentId required")?;
            let entry_id = args.get("entryId").and_then(|v| v.as_str()).ok_or("entryId required")?;
            let content = args.get("content").and_then(|v| v.as_str()).map(String::from);
            let tags = args.get("tags").and_then(|v| v.as_array()).map(|a| {
                a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>()
            });
            let context = args.get("context").and_then(|v| v.as_str()).map(String::from);
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::MemoryUpdate {
                    agent_id: agent_id_arg.to_string(),
                    entry_id: entry_id.to_string(),
                    content,
                    tags,
                    context,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            resp.data.map(|_| serde_json::json!({})).map_err(|e| e)
        }
        "delete_all_memories" => {
            let agent_id_arg = args.get("agentId").and_then(|v| v.as_str()).map(String::from);
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::MemoryDeleteAll {
                    agent_id: agent_id_arg,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            resp.data.map(|_| serde_json::json!({})).map_err(|e| e)
        }
        "set_scheduler_policy" => {
            let policy = args.get("policy").and_then(|v| v.as_str()).unwrap_or("FIFO");
            let mut stats = state.kernel.stats.lock().await;
            stats.policy = policy.to_string();
            Ok(serde_json::json!({}))
        }
        "set_storage_config" => {
            let auto_versioning = args.get("autoVersioning").and_then(|v| v.as_bool()).unwrap_or(true);
            let max_versions = args.get("maxVersions").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::UpdateStorageConfig {
                    auto_versioning,
                    max_versions,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            resp.data.map(|_| serde_json::json!({})).map_err(|e| e)
        }
        "set_memory_config" => {
            let auto_tagging = args.get("autoTagging").and_then(|v| v.as_bool()).unwrap_or(true);
            let compaction_threshold = args.get("compactionThreshold").and_then(|v| v.as_u64()).unwrap_or(80) as u8;
            let max_per_agent = args.get("maxPerAgent").and_then(|v| v.as_u64()).unwrap_or(500) as u32;
            let reflection_enabled = args.get("reflectionEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
            let reflection_interval_mins = args.get("reflectionIntervalMins").and_then(|v| v.as_u64()).unwrap_or(60);
            let reflection_model = args.get("reflectionModel").and_then(|v| v.as_str()).map(String::from);
            let (tx, rx) = tokio::sync::oneshot::channel();
            state
                .kernel
                .syscall_tx
                .send(crate::syscall::Syscall::UpdateMemoryConfig {
                    auto_tagging,
                    compaction_threshold,
                    max_per_agent,
                    reflection_enabled,
                    reflection_interval_mins,
                    reflection_model,
                    response_tx: tx,
                })
                .await
                .map_err(|e| e.to_string())?;
            let resp = rx.await.map_err(|e| e.to_string())?;
            resp.data.map(|_| serde_json::json!({})).map_err(|e| e)
        }
        "set_context_defaults" => {
            use crate::scheduler::CONTEXT_MANAGER;
            let max_tokens = args.get("maxTokens").and_then(|v| v.as_u64()).unwrap_or(8192) as usize;
            let reserved_pct = args.get("reservedPct").and_then(|v| v.as_u64()).unwrap_or(10) as u8;
            let auto_prune = args.get("autoPrune").and_then(|v| v.as_bool()).unwrap_or(true);
            let auto_compact = args.get("autoCompact").and_then(|v| v.as_bool()).unwrap_or(true);
            if let Ok(mut ctx) = CONTEXT_MANAGER.lock() {
                ctx.update_config(max_tokens, reserved_pct, auto_prune, auto_compact);
                Ok(serde_json::json!({}))
            } else {
                Err("Failed to lock ContextManager".to_string())
            }
        }
        "set_qos_params" => {
            let _qos_type = args.get("qosType").and_then(|v| v.as_str()).unwrap_or("");
            let _params = args.get("params").cloned().unwrap_or(serde_json::json!({}));
            Ok(serde_json::json!({}))
        }
        _ => Err(format!("Unknown or disallowed command: {}", cmd)),
    }
}

/// Build the API router. Public routes: health, login. Protected: me, users, kernel/invoke.
fn api_router(state: HttpState) -> Router {
    let public = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/login", post(auth_login))
        .route("/api/auth/setup-status", get(auth_setup_status))
        .route("/api/auth/setup", post(auth_setup))
        .route("/api/cert.pem", get(serve_tls_cert))
        .with_state(state.clone());

    let protected = Router::new()
        .route("/api/auth/me", get(auth_me))
        .route("/api/auth/reset-to-setup", post(auth_reset_to_setup))
        .route("/api/users", get(list_users))
        .route("/api/user/sync-state", get(user_sync_state_get).put(user_sync_state_put))
        .route("/api/kernel/invoke", post(kernel_invoke))
        .route("/api/kernel/events", get(kernel_events_sse))
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth_layer))
        .with_state(state);

    public.merge(protected)
}

/// Serve the app. Call from setup after KernelState and AuthManager are ready.
/// Always serves HTTP on 3939; optionally serves HTTPS on 3940 if certs are found.
pub async fn serve(state: HttpState) {
    // Rustls 0.23+ requires an explicit CryptoProvider. Install `ring` before any TLS usage.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let dist_path = state.dist_path.clone();
    let app_http = Router::new()
        .nest_service("/", ServeDir::new(dist_path.clone()))
        .merge(api_router(state.clone()))
        .layer(cors.clone());

    let http_addr = std::net::SocketAddr::from(([0, 0, 0, 0], HTTP_PORT));
    let http_listener = tokio::net::TcpListener::bind(http_addr)
        .await
        .expect("bind HTTP server");
    log::info!("[HTTP] Listening on http://0.0.0.0:{}", HTTP_PORT);

    // Run HTTP server in background so we can also run HTTPS (if enabled).
    let http_task = tokio::spawn(async move {
        axum::serve(http_listener, app_http)
            .await
            .expect("serve HTTP");
    });

    let (cert_path, key_path) = find_tls_certs(state.app_handle.clone());
    if let (Some(cert), Some(key)) = (cert_path.clone(), key_path.clone()) {
        if cert.exists() && key.exists() {
            log::info!("[HTTP] TLS certs found: {:?}", cert);
            let app_https = Router::new()
                .nest_service("/", ServeDir::new(dist_path))
                .merge(api_router(state))
                .layer(cors);
            let https_addr = std::net::SocketAddr::from(([0, 0, 0, 0], HTTPS_PORT));
            let config = match RustlsConfig::from_pem_file(&cert, &key).await {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[HTTP] Failed to load TLS cert/key: {}. HTTPS disabled.", e);
                    let _ = http_task.await;
                    return;
                }
            };
            log::info!("[HTTP] Listening on https://0.0.0.0:{} (TLS)", HTTPS_PORT);

            // This will run forever; if it ends, also stop HTTP.
            let _ = tokio::join!(
                async move {
                    axum_server::bind_rustls(https_addr, config)
                        .serve(app_https.into_make_service())
                        .await
                        .expect("serve HTTPS");
                },
                async move {
                    let _ = http_task.await;
                }
            );
            return;
        } else {
            log::warn!(
                "[HTTP] TLS cert paths resolved but files missing: cert={:?} (exists={}), key={:?} (exists={}). HTTPS on port {} DISABLED.",
                cert, cert.exists(), key, key.exists(), HTTPS_PORT
            );
        }
    } else {
        log::warn!(
            "[HTTP] No TLS certs found (searched env, resource_dir, app_data_dir, cwd). HTTPS on port {} DISABLED. cert_path={:?}, key_path={:?}",
            HTTPS_PORT, cert_path, key_path
        );
    }

    // If HTTPS is not enabled, keep HTTP running.
    log::info!("[HTTP] Running HTTP-only on port {}", HTTP_PORT);
    let _ = http_task.await;
}

/// Resolve TLS cert and key paths: env vars, then resource_dir, then app_data_dir/tls, then dev paths.
fn find_tls_certs(app_handle: tauri::AppHandle) -> (Option<PathBuf>, Option<PathBuf>) {
    // 1. Environment variables
    if let (Ok(c), Ok(k)) = (
        std::env::var("SYNTHESIS_HTTPS_CERT"),
        std::env::var("SYNTHESIS_HTTPS_KEY"),
    ) {
        let cert = PathBuf::from(&c);
        let key = PathBuf::from(&k);
        if cert.exists() && key.exists() {
            log::info!("[TLS] Found certs via env vars: {:?}", cert);
            return (Some(cert), Some(key));
        }
        log::debug!("[TLS] Env vars set but files missing: cert={} key={}", c, k);
    }

    // 2. Resource dir (bundled app)
    if let Ok(res) = app_handle.path().resource_dir() {
        let cert: PathBuf = res.join("cert.pem");
        let key: PathBuf = res.join("key.pem");
        if cert.exists() && key.exists() {
            log::info!("[TLS] Found certs in resource_dir: {:?}", cert);
            return (Some(cert), Some(key));
        }
    }

    // 3. Preferred location: app_data_dir/tls/ (where ensure_tls_certs writes them)
    match app_handle.path().app_data_dir() {
        Ok(app_data) => {
            let cert = app_data.join("tls").join("cert.pem");
            let key = app_data.join("tls").join("key.pem");
            log::info!("[TLS] Checking app_data_dir: {:?} (exists={})", cert, cert.exists());
            if cert.exists() && key.exists() {
                log::info!("[TLS] Found certs in app_data_dir: {:?}", cert);
                return (Some(cert), Some(key));
            }
        }
        Err(e) => {
            log::warn!("[TLS] app_data_dir() failed: {}", e);
        }
    }

    // 4. Dev fallback: cwd-relative paths
    if let Ok(cwd) = std::env::current_dir() {
        for (cert, key) in [
            (
                cwd.join("web").join("src-tauri").join("cert.pem"),
                cwd.join("web").join("src-tauri").join("key.pem"),
            ),
            (
                cwd.join("src-tauri").join("cert.pem"),
                cwd.join("src-tauri").join("key.pem"),
            ),
            (cwd.join("cert.pem"), cwd.join("key.pem")),
        ] {
            if cert.exists() && key.exists() {
                log::info!("[TLS] Found certs in cwd: {:?}", cert);
                return (Some(cert), Some(key));
            }
        }
    }

    log::warn!("[TLS] No TLS certs found in any search path");
    (None, None)
}
