use crate::context::{ContextManager, TokenBudget};
use crate::llm_core::LlmAdapter;
use crate::memory::MemoryManager;
use crate::prompts;
use crate::syscall::{Priority, Syscall, SyscallMetrics, SyscallResponse};
use crate::tool_rag::ToolRag;
use crate::tools::{
    Calculate,
    CalendarCreate,
    CalendarToday,
    ClipboardRead,
    ClipboardWrite,
    ContactsSearch,
    CurrencyConvert,
    CurrentTime,
    DefineWord,
    DirList,
    EmailList,
    EmailRead,
    FileAppend,
    FileCopy,
    // Remember, CoreMemoryTool, CoreMemoryReplace — removed, memory is handled by extract_and_store_facts
    FileMove,
    FileReadFull,
    FileWrite,
    FinderOpen,
    FinderTrash,
    GetBattery,
    GetBrightness,
    GetNodeContent,
    GetSpatialBounds,
    GetSystemInfo,
    GetVolume,
    GetWifi,
    HttpRequest,
    MusicNext,
    MusicPause,
    MusicPlay,
    NotesCreate,
    NotesList,
    NotesRead,
    Notify,
    OpenApp,
    QrCode,
    ReadPage,
    RemindersAdd,
    RemindersList,
    RssReader,
    SafariTabs,
    SayTts,
    SearchFiles,
    SearchImages,
    SetBrightness,
    SetTimer,
    SetVolume,
    StorageCreateTool,
    StorageDeleteTool,
    StorageListTool,
    StorageReadTool,
    StorageRollbackTool,
    StorageVersionsTool,
    StorageWriteTool,
    SummarizeUrl,
    TakeScreenshot,
    ToggleDarkMode,
    ToolManager,
    Translate,
    VirtualFileSystem,
    Weather,
    WebScraper,
    WebSearch,
    YoutubeSearch,
};
use futures_util::future::join_all;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::sync::Mutex;

// Lazy-initialized global ContextManager (mutable via Mutex for runtime config updates)
use crate::settings;
use crate::tool_cache::ToolResponseCache;
use once_cell::sync::Lazy;
pub static CONTEXT_MANAGER: Lazy<std::sync::Mutex<ContextManager>> =
    Lazy::new(|| std::sync::Mutex::new(ContextManager::new(8192)));

pub enum SchedulingPolicy {
    FIFO,
    RoundRobin,
}

/// The Central Scheduler Loop.
/// Receives Syscalls from all agents and routes them to the appropriate subsystem manager.
pub struct Scheduler {
    rx: mpsc::Receiver<Syscall>,
    tx: mpsc::Sender<Syscall>,
    policy: SchedulingPolicy,
    stats: Arc<Mutex<crate::syscall::KernelStats>>,
}

impl Scheduler {
    pub fn new(
        rx: mpsc::Receiver<Syscall>,
        tx: mpsc::Sender<Syscall>,
        stats: Arc<Mutex<crate::syscall::KernelStats>>,
    ) -> Self {
        Self {
            rx,
            tx,
            policy: SchedulingPolicy::FIFO,
            stats,
        }
    }

    /// Starts the background listening loop and spawns the subsystem workers.
    pub async fn start(mut self, app_handle: tauri::AppHandle) {
        println!("[Kernel:Scheduler] Booting up Syscall dispatcher...");

        let _ = dotenvy::dotenv();
        let app_dir = app_handle
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| PathBuf::from("/tmp/synthesis-os"));
        // Ensure the app directory exists for our databases
        let _ = std::fs::create_dir_all(&app_dir);

        // Create subchannels for each subsystem worker
        let (llm_tx, mut llm_rx) = mpsc::channel::<Syscall>(50);
        let (tool_tx, mut tool_rx) = mpsc::channel::<Syscall>(50);
        let (mem_tx, mut mem_rx) = mpsc::channel::<Syscall>(50);

        // Initialize Shared ToolManager
        let tool_app_dir = app_dir.clone();
        let tool_app_handle = app_handle.clone();
        let mut tool_manager = ToolManager::new(tool_app_handle.clone());

        // Register tools
        let vfs = VirtualFileSystem::new(tool_app_dir);
        tool_manager.register(Box::new(vfs));

        let spatial_bounds = GetSpatialBounds::new(tool_app_handle.clone());
        tool_manager.register(Box::new(spatial_bounds));

        let get_node_content = GetNodeContent::new(tool_app_handle.clone());
        tool_manager.register(Box::new(get_node_content));

        let scraper = WebScraper::new();
        tool_manager.register(Box::new(scraper));

        let weather = Weather::new();
        tool_manager.register(Box::new(weather));

        tool_manager.register(Box::new(Calculate::new()));
        tool_manager.register(Box::new(CurrencyConvert::new()));
        tool_manager.register(Box::new(DefineWord::new()));
        tool_manager.register(Box::new(Translate::new()));
        tool_manager.register(Box::new(CurrentTime::new()));
        tool_manager.register(Box::new(WebSearch::new()));
        tool_manager.register(Box::new(ReadPage::new()));
        tool_manager.register(Box::new(SearchImages::new()));
        tool_manager.register(Box::new(HttpRequest::new()));
        tool_manager.register(Box::new(SummarizeUrl::new()));
        tool_manager.register(Box::new(YoutubeSearch::new()));
        tool_manager.register(Box::new(RssReader::new()));
        tool_manager.register(Box::new(QrCode::new()));
        tool_manager.register(Box::new(SetTimer::new()));

        tool_manager.register(Box::new(ClipboardRead));
        tool_manager.register(Box::new(ClipboardWrite));
        tool_manager.register(Box::new(Notify));
        tool_manager.register(Box::new(GetVolume));
        tool_manager.register(Box::new(SetVolume));
        tool_manager.register(Box::new(GetBrightness));
        tool_manager.register(Box::new(SetBrightness));
        tool_manager.register(Box::new(ToggleDarkMode));
        tool_manager.register(Box::new(GetBattery));
        tool_manager.register(Box::new(GetWifi));
        tool_manager.register(Box::new(GetSystemInfo));
        tool_manager.register(Box::new(OpenApp));
        tool_manager.register(Box::new(SayTts));
        tool_manager.register(Box::new(TakeScreenshot));
        tool_manager.register(Box::new(SearchFiles));

        tool_manager.register(Box::new(NotesList));
        tool_manager.register(Box::new(NotesRead));
        tool_manager.register(Box::new(NotesCreate));
        // NOTE: Remember, CoreMemoryTool, CoreMemoryReplace are NO LONGER registered.
        // Memory storage is handled automatically by extract_and_store_facts() (post-response)
        // and the Reflection Worker (background consolidation). This eliminates:
        //   1. Agent wasting ReAct steps on memory storage instead of answering
        //   2. Duplicate LLM calls (agent + extractor + reflection for same facts)
        //   3. LLM concatenating multiple facts into one tool call
        tool_manager.register(Box::new(EmailList));
        tool_manager.register(Box::new(EmailRead));
        tool_manager.register(Box::new(CalendarToday));
        tool_manager.register(Box::new(CalendarCreate));
        tool_manager.register(Box::new(RemindersList));
        tool_manager.register(Box::new(RemindersAdd));
        tool_manager.register(Box::new(ContactsSearch));
        tool_manager.register(Box::new(MusicPlay));
        tool_manager.register(Box::new(MusicPause));
        tool_manager.register(Box::new(MusicNext));
        tool_manager.register(Box::new(FinderOpen));
        tool_manager.register(Box::new(FinderTrash));
        tool_manager.register(Box::new(SafariTabs));
        // CoreMemoryTool and CoreMemoryReplace removed — see note above

        // LSFS Storage Tools (agent access to versioned file system via syscalls)
        let storage_handle = app_handle.clone();
        tool_manager.register(Box::new(StorageReadTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageWriteTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageCreateTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageListTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageDeleteTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageRollbackTool::new(storage_handle.clone())));
        tool_manager.register(Box::new(StorageVersionsTool::new(storage_handle)));

        // Real macOS filesystem tools (sensitive — approval required via agent pipeline)
        tool_manager.register(Box::new(FileWrite));
        tool_manager.register(Box::new(FileAppend));
        tool_manager.register(Box::new(FileReadFull));
        tool_manager.register(Box::new(DirList));
        tool_manager.register(Box::new(FileMove));
        tool_manager.register(Box::new(FileCopy));

        let shared_tool_manager = Arc::new(tokio::sync::Mutex::new(tool_manager));

        // Collect tool definitions for Tool RAG initialization (snapshot before moving tool_manager)
        let tool_defs_for_rag: Vec<serde_json::Value> = {
            let tm = shared_tool_manager.lock().await;
            tm.get_tool_definitions()
        };

        // 1. LLM Worker Loop — Routes to any provider via LlmAdapter (OpenAI, Anthropic, Groq, Gemini, Ollama)
        let llm_tool_manager = shared_tool_manager.clone();
        let llm_app_handle = app_handle.clone();
        let llm_stats = self.stats.clone();
        tokio::spawn(async move {
            println!("[Kernel:Worker:LLM] Online and awaiting inference requests (multi-provider via LlmAdapter).");

            while let Some(syscall) = llm_rx.recv().await {
                // Handle batch LLM requests (parallel execution)
                if let Syscall::LlmBatchRequest {
                    agent_id,
                    priority,
                    requests,
                    response_tx,
                } = syscall
                {
                    println!("[Kernel:Worker:LLM] Processing batch request ({} items) for {} in parallel (Priority: {:?})", requests.len(), agent_id, priority);
                    let start_time = Instant::now();
                    let app = llm_app_handle.clone();

                    let futures: Vec<_> = requests
                        .into_iter()
                        .map(|item| {
                            let app_clone = app.clone();
                            let batch_start = start_time;
                            async move {
                                let system_content = item.system_prompt.unwrap_or_default();
                                let tool_defs = item.tool_definitions.unwrap_or_default();
                                let result = LlmAdapter::call_legacy(
                                    &app_clone,
                                    &system_content,
                                    &item.prompt,
                                    &tool_defs,
                                    item.model.as_ref(),
                                    item.max_tokens,
                                    item.max_completion_tokens,
                                )
                                .await;
                                SyscallResponse::new(
                                    result,
                                    SyscallMetrics {
                                        created_at: 0,
                                        started_at: None,
                                        finished_at: None,
                                        waiting_ms: 0,
                                        execution_ms: batch_start.elapsed().as_millis() as u64,
                                    },
                                )
                            }
                        })
                        .collect();

                    let results = join_all(futures).await;
                    let _ = response_tx.send(results);
                    continue;
                }

                if let Syscall::LlmRequest {
                    agent_id,
                    priority,
                    prompt,
                    response_tx,
                    system_prompt,
                    tool_definitions,
                    model,
                    stream,
                    max_tokens,
                    max_completion_tokens,
                } = syscall
                {
                    println!("[Kernel:Worker:LLM] Processing request for {} (Priority: {:?}, Prompt len: {})", agent_id, priority, prompt.len());
                    let start_time = Instant::now();
                    let created_at = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    // Resolve tool definitions: None = get from manager; Some(v) = use v (empty = Manager mode)
                    let tool_defs: Vec<serde_json::Value> = match tool_definitions {
                        None => {
                            let tm = llm_tool_manager.lock().await;
                            tm.get_tool_definitions()
                        }
                        Some(v) => v,
                    };

                    let system_content = match &system_prompt {
                        Some(s) => s.clone(),
                        None => prompts::build_system_prompt(&prompts::format_tool_categories(
                            &tool_defs,
                        )),
                    };

                    // Route through the LlmAdapter — supports OpenAI, Anthropic, Groq, Gemini, Ollama
                    let result = if stream {
                        LlmAdapter::call_stream(
                            &llm_app_handle,
                            &agent_id,
                            &system_content,
                            &prompt,
                            &tool_defs,
                            model.as_ref(),
                            max_tokens,
                            max_completion_tokens,
                        )
                        .await
                    } else {
                        LlmAdapter::call_legacy(
                            &llm_app_handle,
                            &system_content,
                            &prompt,
                            &tool_defs,
                            model.as_ref(),
                            max_tokens,
                            max_completion_tokens,
                        )
                        .await
                    };

                    let execution_ms = start_time.elapsed().as_millis() as u64;
                    let finished_at = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;
                    let metrics = SyscallMetrics {
                        created_at,
                        started_at: Some(created_at),
                        finished_at: Some(finished_at),
                        waiting_ms: 0,
                        execution_ms,
                    };
                    let _ = response_tx.send(SyscallResponse::new(result, metrics));

                    // Update global kernel latency stats (EMA)
                    if let Ok(mut s) = llm_stats.try_lock() {
                        if s.llm_avg_latency_ms == 0.0 {
                            s.llm_avg_latency_ms = execution_ms as f64;
                        } else {
                            s.llm_avg_latency_ms =
                                s.llm_avg_latency_ms * 0.8 + (execution_ms as f64) * 0.2;
                        }
                    }
                }
            }
        });

        // 2. Tool Worker Loop (Phase 4: ToolRegistry and VFS execution)
        // Tool execution runs in spawn_blocking to avoid "Cannot drop a runtime in a context
        // where blocking is not allowed" — tools use block_on (macOS) or reqwest::blocking (HTTP).
        let tool_worker_manager = shared_tool_manager.clone();
        let tool_cache = Arc::new(ToolResponseCache::with_default_ttl());
        let tool_cache_clone = tool_cache.clone();
        tokio::spawn(async move {
            println!(
                "[Kernel:Worker:Tool] Online and awaiting native commands (with response cache)."
            );
            while let Some(syscall) = tool_rx.recv().await {
                let start_time = Instant::now();
                match syscall {
                    Syscall::ToolRequest {
                        agent_id,
                        tool_name,
                        args,
                        response_tx,
                        ..
                    } => {
                        // Check cache first for read-only tools
                        if let Some(cached) =
                            tool_cache_clone.get(&agent_id, &tool_name, &args).await
                        {
                            let metrics = SyscallMetrics {
                                created_at: 0,
                                started_at: None,
                                finished_at: None,
                                waiting_ms: 0,
                                execution_ms: 0, // Cache hit = 0ms
                            };
                            let _ = response_tx.send(SyscallResponse::new(cached, metrics));
                            continue;
                        }

                        let tm = tool_worker_manager.clone();
                        let tool_name_exec = tool_name.clone();
                        let args_exec = args.clone();
                        let result = tokio::task::spawn_blocking(move || {
                            let rt = tokio::runtime::Handle::current();
                            let guard = rt.block_on(tm.lock());
                            guard.execute(&tool_name_exec, &args_exec)
                        })
                        .await
                        .unwrap_or_else(|e| Err(format!("Tool spawn failed: {}", e)));

                        let result_json = result.map(|s| serde_json::json!(s));
                        let _ = tool_cache_clone
                            .set(&agent_id, &tool_name, &args, result_json.clone())
                            .await;

                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result_json, metrics));
                    }
                    Syscall::GetToolDefinitions {
                        agent_id,
                        response_tx,
                    } => {
                        println!(
                            "[Kernel:Worker:Tool] GetToolDefinitions for agent {}",
                            agent_id
                        );
                        let tm = tool_worker_manager.lock().await;
                        let defs = tm.get_tool_definitions();
                        let _ = response_tx.send(defs);
                    }
                    _ => {}
                }
            }
        });

        // ── Load kernel config from Tauri Store ──
        let initial_cfg = settings::get_kernel_config(&app_handle);
        let shared_cfg = Arc::new(tokio::sync::Mutex::new(initial_cfg.clone()));
        let cfg = {
            let guard = initial_cfg; // Use local clone for boot
            guard
        };
        println!(
            "[Kernel] Loaded config: policy={}, max_tokens={}, auto_versioning={}, auto_tagging={}",
            cfg.scheduling_policy, cfg.default_max_tokens, cfg.auto_versioning, cfg.auto_tagging
        );

        // Apply context defaults from config
        if let Ok(mut ctx) = CONTEXT_MANAGER.lock() {
            ctx.update_config(
                cfg.default_max_tokens,
                cfg.reserved_token_pct,
                cfg.auto_prune,
                cfg.auto_compact,
            );
            println!(
                "[Kernel] ContextManager configured: budget={}, reserved={}%, prune={}, compact={}",
                cfg.default_max_tokens, cfg.reserved_token_pct, cfg.auto_prune, cfg.auto_compact
            );
        }

        // 3. Memory + Storage Worker Loop
        // Memory v3: LanceDB atomic facts + RAM cache (no more metadata.json)
        // Storage: Dedicated LSFS-like subsystem with versioning (SQLite-backed)
        let mem_app_handle = app_handle.clone();
        let storage_app_dir = app_dir.clone();
        let mem_auto_tagging = cfg.auto_tagging;
        let mem_compaction = cfg.compaction_threshold;
        let mem_max = cfg.max_memories_per_agent;
        let storage_versioning = cfg.auto_versioning;
        let storage_max_versions = cfg.max_versions_per_file;
        let mem_worker_cfg = shared_cfg.clone();
        let rag_tool_defs = tool_defs_for_rag.clone();
        tokio::spawn(async move {
            println!(
                "[Kernel:Worker:Memory] Booting unified MemoryManager (LanceDB + Extended)..."
            );

            // ── Initialize Local Embeddings Engine (multilingual-e5-small via ONNX) ──
            // This MUST happen before MemoryManager and ToolRag init, as they depend on it.
            if let Err(e) = crate::local_embeddings::init(&app_dir) {
                eprintln!(
                    "[Kernel:Worker:Memory] WARNING: Local embeddings init failed: {}.",
                    e
                );
                eprintln!(
                    "[Kernel:Worker:Memory] Tool RAG and semantic memory search will NOT work."
                );
                eprintln!(
                    "[Kernel:Worker:Memory] Memory storage (extract_and_store_facts) will FAIL."
                );
                eprintln!(
                    "[Kernel:Worker:Memory] Ensure disk space is available and restart the app."
                );
            } else {
                println!(
                    "[Kernel:Worker:Memory] Local embeddings engine ready (multilingual-e5-small)."
                );
            }

            let mut memory_manager = MemoryManager::new_with_config(
                app_dir.clone(),
                mem_app_handle.clone(),
                mem_auto_tagging,
                mem_compaction,
                mem_max,
            )
            .await;

            // ── Initialize Tool RAG (now uses local embeddings, no OpenAI client needed) ──
            let tool_rag: Option<ToolRag> = {
                let db_path = app_dir.join("lancedb");
                match lancedb::connect(db_path.to_str().unwrap()).execute().await {
                    Ok(conn) => match ToolRag::init(&conn, &rag_tool_defs).await {
                        Ok(rag) => {
                            println!("[Kernel:Worker:Memory] Tool RAG initialized successfully (local embeddings).");
                            Some(rag)
                        }
                        Err(e) => {
                            eprintln!("[Kernel:Worker:Memory] Tool RAG init failed: {}. Falling back to all tools.", e);
                            None
                        }
                    },
                    Err(e) => {
                        eprintln!(
                            "[Kernel:Worker:Memory] LanceDB connect for ToolRAG failed: {}",
                            e
                        );
                        None
                    }
                }
            };

            // Boot dedicated storage subsystem with config
            println!(
                "[Kernel:Worker:Storage] Initializing LSFS with versioning={}, max_versions={}...",
                storage_versioning, storage_max_versions
            );
            let storage_manager = match crate::storage::StorageManager::new_with_config(
                storage_app_dir,
                storage_versioning,
                storage_max_versions,
            ) {
                Ok(sm) => {
                    println!("[Kernel:Worker:Storage] Online. SQLite + content-addressed filesystem ready.");
                    Some(sm)
                }
                Err(e) => {
                    eprintln!("[Kernel:Worker:Storage] Failed to initialize: {}. Storage syscalls will fall back to memory.", e);
                    None
                }
            };
            let mut storage_manager = storage_manager;

            println!("[Kernel:Worker:Memory] Online. Database ready.");

            while let Some(syscall) = mem_rx.recv().await {
                let start_time = Instant::now();
                match syscall {
                    Syscall::MemoryRead {
                        agent_id,
                        key,
                        response_tx,
                    } => {
                        let result = memory_manager.read(&agent_id, &key).await;
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx
                            .send(SyscallResponse::new(Ok(serde_json::json!(result)), metrics));
                    }
                    Syscall::MemoryWrite {
                        agent_id,
                        key,
                        data,
                        response_tx,
                    } => {
                        let result = memory_manager.write(&agent_id, &key, &data).await;
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(
                            result.map(|_| serde_json::json!(null)),
                            metrics,
                        ));
                    }
                    Syscall::StorageRead {
                        agent_id,
                        path,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.read(&agent_id, &path)
                                .map(|content| serde_json::json!(content))
                        } else {
                            // Fallback to memory
                            Ok(serde_json::json!(
                                memory_manager
                                    .read(&agent_id, &format!("file:{}", path))
                                    .await
                            ))
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageWrite {
                        agent_id,
                        path,
                        data,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.write(&agent_id, &path, &data)
                                .map(|ver| serde_json::json!({"version": ver}))
                        } else {
                            memory_manager
                                .write(&agent_id, &format!("file:{}", path), &data)
                                .await
                                .map(|_| serde_json::json!(null))
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    // ── Extended Storage LSFS Syscalls ──
                    Syscall::StorageCreate {
                        agent_id,
                        path,
                        content,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            if let Some(c) = content {
                                sm.create_file(&agent_id, &path, &c)
                                    .map(|id| serde_json::json!({"file_id": id}))
                            } else {
                                sm.create_dir(&agent_id, &path)
                                    .map(|_| serde_json::json!({"created": true}))
                            }
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageList {
                        agent_id,
                        path,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.list(&agent_id, &path)
                                .map(|entries| serde_json::json!(entries))
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageDelete {
                        agent_id,
                        path,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.delete(&agent_id, &path)
                                .map(|_| serde_json::json!({"deleted": true}))
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageRollback {
                        agent_id,
                        path,
                        version,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.rollback(&agent_id, &path, version as i64)
                                .map(|_| serde_json::json!({"rolled_back": true}))
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageShare {
                        agent_id,
                        path,
                        target_agent_id,
                        permission,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            let perm = match permission.as_str() {
                                "write" => crate::storage::Permission::Write,
                                "readwrite" => crate::storage::Permission::ReadWrite,
                                _ => crate::storage::Permission::Read,
                            };
                            sm.share(&agent_id, &path, &target_agent_id, perm)
                                .map(|_| serde_json::json!({"shared": true}))
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::StorageVersions {
                        agent_id,
                        path,
                        response_tx,
                    } => {
                        let result = if let Some(ref sm) = storage_manager {
                            sm.get_versions(&agent_id, &path)
                                .map(|versions| serde_json::json!(versions))
                        } else {
                            Err("Storage subsystem not initialized".to_string())
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    // ── Memory Extended Syscalls (now using unified pipeline) ──
                    Syscall::MemoryRetrieve {
                        agent_id,
                        query,
                        tags,
                        limit,
                        response_tx,
                    } => {
                        // v3: Semantic search in LanceDB (tags parameter is kept for compat but category is preferred)
                        // Empty agent_id means "search all agents" (used by Settings UI list_memories)
                        let search_query = crate::memory_ext::MemoryQuery {
                            agent_id: if agent_id.is_empty() {
                                None
                            } else {
                                Some(agent_id.clone())
                            },
                            query: if query.is_empty() {
                                None
                            } else {
                                Some(query.clone())
                            },
                            tags,
                            keywords: None,
                            limit,
                            offset: 0,
                            min_similarity: 0.0,
                        };
                        let result = memory_manager
                            .search_extended(search_query)
                            .await
                            .map(|resp| serde_json::json!(resp));
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::ToolRetrieve {
                        query,
                        top_k,
                        response_tx,
                    } => {
                        let result = if let Some(ref rag) = tool_rag {
                            match rag.retrieve(&query, top_k).await {
                                Ok(names) => Ok(serde_json::json!(names)),
                                Err(e) => Err(format!("ToolRAG retrieve error: {}", e)),
                            }
                        } else {
                            // Fallback: return all tool names
                            let all_names: Vec<String> = rag_tool_defs
                                .iter()
                                .filter_map(|d| {
                                    d.get("function")
                                        .and_then(|f| f.get("name"))
                                        .and_then(|n| n.as_str())
                                        .map(String::from)
                                })
                                .collect();
                            Ok(serde_json::json!(all_names))
                        };
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::MemoryEvolve {
                        agent_id,
                        content,
                        context,
                        response_tx,
                    } => {
                        // Full agentic pipeline: auto-tag → merge → embed → compact
                        let result = memory_manager
                            .write_agentic(&agent_id, &content, &context)
                            .await;
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(
                            result.map(|id| serde_json::json!({"evolved": true, "entry_id": id})),
                            metrics,
                        ));
                    }
                    Syscall::MemoryArchive {
                        agent_id,
                        turns,
                        response_tx,
                    } => {
                        let result = memory_manager
                            .archive_conversation_turns(&agent_id, turns)
                            .await;
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(
                            result.map(|_| serde_json::json!({"archived": true})),
                            metrics,
                        ));
                    }
                    // ── Context Syscalls (handled via ContextManager) ──
                    Syscall::ContextCreate {
                        agent_id,
                        max_tokens,
                        response_tx,
                    } => {
                        println!(
                            "[Kernel:Worker:Context] Creating context for {} with {} token budget",
                            agent_id, max_tokens
                        );

                        // Create the token budget with reserved tokens (10% of max)
                        let reserved = max_tokens / 10;
                        let budget = TokenBudget::new(max_tokens, reserved);

                        // Create context via the global ContextManager
                        let result = CONTEXT_MANAGER.lock().unwrap().create_context(&agent_id, budget)
                            .map(|_| serde_json::json!({"created": true, "max_tokens": max_tokens, "reserved_tokens": reserved}))
                            .map_err(|e| e);

                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::ContextCompact {
                        agent_id,
                        response_tx,
                    } => {
                        println!(
                            "[Kernel:Worker:Context] Compacting context for {}",
                            agent_id
                        );

                        // Compact context via ContextManager
                        let result = CONTEXT_MANAGER
                            .lock()
                            .unwrap()
                            .compact(&agent_id)
                            .map(|_| serde_json::json!({"compacted": true}))
                            .map_err(|e| e);

                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::ContextCheckpoint {
                        agent_id,
                        response_tx,
                    } => {
                        println!("[Kernel:Worker:Context] Saving checkpoint for {}", agent_id);

                        // Save checkpoint via ContextManager
                        let result = CONTEXT_MANAGER
                            .lock()
                            .unwrap()
                            .save_checkpoint(&agent_id)
                            .map(|checkpoint| {
                                serde_json::json!({
                                    "checkpointed": true,
                                    "agent_id": checkpoint.agent_id,
                                    "message_count": checkpoint.messages.len(),
                                    "created_at": checkpoint.created_at
                                })
                            })
                            .map_err(|e| e);

                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::ContextGetMessages {
                        agent_id,
                        response_tx,
                    } => {
                        let result = CONTEXT_MANAGER
                            .lock()
                            .unwrap()
                            .get_messages(&agent_id)
                            .map(|msgs| serde_json::json!(msgs))
                            .map_err(|e| e);
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::MemoryUpdate {
                        agent_id,
                        entry_id,
                        content,
                        tags,
                        context,
                        response_tx,
                    } => {
                        let result = memory_manager
                            .update_memory_entry(
                                &agent_id,
                                &entry_id,
                                content.as_deref(),
                                tags,
                                context.as_deref(),
                            )
                            .await
                            .map(|_| serde_json::json!({"updated": true}));
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::MemoryAppend {
                        agent_id,
                        key,
                        data,
                        response_tx,
                    } => {
                        let result = memory_manager
                            .append_memory(&agent_id, &key, &data)
                            .await
                            .map(serde_json::Value::String);
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::MemoryDelete {
                        agent_id,
                        entry_id,
                        response_tx,
                    } => {
                        let result = memory_manager
                            .delete_memory_entry(&agent_id, &entry_id)
                            .await
                            .map(|_| serde_json::json!({"deleted": true}));
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    Syscall::MemoryDeleteAll {
                        agent_id,
                        response_tx,
                    } => {
                        let result = memory_manager
                            .delete_all_memories(agent_id.as_deref())
                            .await
                            .map(|_| serde_json::json!({"deleted_all": true}));
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(result, metrics));
                    }
                    // ── Runtime Configuration Syscalls ──
                    Syscall::UpdateStorageConfig {
                        auto_versioning,
                        max_versions,
                        response_tx,
                    } => {
                        println!("[Kernel:Worker] Applying storage config: versioning={}, max_versions={}", auto_versioning, max_versions);
                        if let Some(ref mut sm) = storage_manager {
                            sm.update_config(auto_versioning, max_versions);
                        }
                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(
                            Ok(serde_json::json!({"updated": true})),
                            metrics,
                        ));
                    }
                    Syscall::UpdateMemoryConfig {
                        auto_tagging,
                        compaction_threshold,
                        max_per_agent,
                        reflection_enabled,
                        reflection_interval_mins,
                        reflection_model,
                        response_tx,
                    } => {
                        println!("[Kernel:Worker] Applying memory config: tagging={}, compaction={}%, max={}, reflection={}, interval={}m", 
                            auto_tagging, compaction_threshold, max_per_agent, reflection_enabled, reflection_interval_mins);

                        memory_manager.update_config(
                            auto_tagging,
                            compaction_threshold,
                            max_per_agent,
                        );

                        let mut guard = mem_worker_cfg.lock().await;
                        guard.auto_tagging = auto_tagging;
                        guard.compaction_threshold = compaction_threshold;
                        guard.max_memories_per_agent = max_per_agent;
                        guard.reflection_enabled = reflection_enabled;
                        guard.reflection_interval_mins = reflection_interval_mins;
                        guard.reflection_model = reflection_model.clone();

                        let metrics = SyscallMetrics {
                            created_at: 0,
                            started_at: None,
                            finished_at: None,
                            waiting_ms: 0,
                            execution_ms: start_time.elapsed().as_millis() as u64,
                        };
                        let _ = response_tx.send(SyscallResponse::new(
                            Ok(serde_json::json!({"updated": true})),
                            metrics,
                        ));
                    }
                    _ => {}
                }
            }
        });

        // 4. Sleep-time Reflection Worker (Background Consolidation)
        // v4: Uses canonical KV keys, filters transient actions, cleans processed turns,
        // and injects existing memories to avoid duplicates.
        let refl_settings = shared_cfg.clone();
        let refl_tx = self.tx.clone();
        tokio::spawn(async move {
            println!("[Kernel:Worker:Reflection] Worker started (v4 hybrid KV+semantic).");
            loop {
                // Hot-reload settings
                let (enabled, interval_mins, _model) = {
                    let cfg_guard = refl_settings.lock().await;
                    (
                        cfg_guard.reflection_enabled,
                        cfg_guard.reflection_interval_mins,
                        cfg_guard.reflection_model.clone(),
                    )
                };

                if !enabled {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }

                tokio::time::sleep(Duration::from_secs(interval_mins * 60)).await;
                println!("[Kernel:Worker:Reflection] Starting background consolidation pass...");

                // ── Phase 1: Fetch existing memories to provide as context ──
                let existing_context = {
                    let (tx, rx) = oneshot::channel();
                    let _ = refl_tx
                        .send(Syscall::MemoryRetrieve {
                            agent_id: "user".to_string(),
                            query: String::new(),
                            tags: None,
                            limit: 50,
                            response_tx: tx,
                        })
                        .await;

                    if let Ok(resp) = rx.await {
                        if let Ok(data) = resp.data {
                            if let Some(entries) = data.get("entries").and_then(|e| e.as_array()) {
                                entries
                                    .iter()
                                    .filter_map(|e| {
                                        let key =
                                            e.get("key").and_then(|k| k.as_str()).unwrap_or("");
                                        let content =
                                            e.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                        if !key.is_empty() && !content.is_empty() {
                                            Some(format!("  {} = {}", key, content))
                                        } else {
                                            None
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n")
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                };

                // ── Phase 2: Fetch archived conversation turns ──
                let (tx, rx) = oneshot::channel();
                let _ = refl_tx
                    .send(Syscall::MemoryRetrieve {
                        agent_id: "user".to_string(),
                        query: "recent archived conversation turns".to_string(),
                        tags: Some(vec!["context_paging".to_string()]),
                        limit: 20,
                        response_tx: tx,
                    })
                    .await;

                if let Ok(resp) = rx.await {
                    if let Ok(data) = resp.data {
                        if let Some(entries) = data.get("entries").and_then(|e| e.as_array()) {
                            if !entries.is_empty() {
                                let mut context_text = String::new();
                                let mut turn_ids: Vec<String> = Vec::new();
                                for entry in entries {
                                    if let Some(content) =
                                        entry.get("content").and_then(|c| c.as_str())
                                    {
                                        context_text.push_str(content);
                                        context_text.push_str("\n---\n");
                                    }
                                    // Collect IDs for cleanup later
                                    if let Some(id) = entry.get("id").and_then(|i| i.as_str()) {
                                        turn_ids.push(id.to_string());
                                    }
                                }

                                // ── Phase 3: LLM consolidation with canonical keys ──
                                let reflection_prompt = format!(
                                    "You are the SynthesisOS Background Reflection Kernel. \
                                    Below are recent conversation turns from the user's session. \
                                    Extract ONLY PERSISTENT insights (NOT transient actions like searches or brightness changes). \
                                    \n\nEXISTING MEMORIES (do NOT duplicate these):\n{}\
                                    \n\nFor each insight, provide a CANONICAL KEY and classify into ONE category: \
                                    - USER_FACT: personal info about the user (name, pets, job, location, family, age) \
                                    - PREFERENCE: how the user likes to interact (language, tone, topics, coding style) \
                                    - OS_INSIGHT: what the OS should learn about serving this user (response patterns, common workflows) \
                                    - PATTERN: behavioral patterns across sessions (recurring topics, time-based habits) \
                                    - ACTION: transient commands (search X, change brightness, play music) — do NOT store these \
                                    \n\nRespond ONLY with a JSON array: \
                                    [{{\"key\": \"user.name\", \"value\": \"Gastón\", \"category\": \"USER_FACT\"}}] \
                                    \n\nKey naming convention: \
                                    user.name, user.job, user.pet.name, pref.language, pref.tone, os.behavior, pattern.topic.X \
                                    \nIf nothing NEW to store, respond with: [] \
                                    \n\nCONTEXT:\n{}",
                                    if existing_context.is_empty() { "(none yet)".to_string() } else { existing_context.clone() },
                                    context_text
                                );

                                let (llm_tx, llm_rx) = oneshot::channel();
                                let _ = refl_tx.send(Syscall::LlmRequest {
                                    agent_id: "reflection_engine".to_string(),
                                    priority: Priority::Low,
                                    prompt: reflection_prompt,
                                    response_tx: llm_tx,
                                    system_prompt: Some("You are a reflection engine. Extract persistent facts with canonical keys. Filter out transient actions. Output valid JSON only.".to_string()),
                                    tool_definitions: None,
                                    model: None,
                                    stream: false,
                                    max_tokens: None,
                                    max_completion_tokens: None,
                                }).await;

                                if let Ok(llm_resp) = llm_rx.await {
                                    if let Ok(val) = llm_resp.data {
                                        if let Some(text) = val.as_str() {
                                            // Parse JSON array of categorized insights
                                            if let Ok(insights) =
                                                serde_json::from_str::<Vec<serde_json::Value>>(text)
                                            {
                                                println!("[Kernel:Worker:Reflection] Found {} classified insights", insights.len());
                                                for insight in &insights {
                                                    let category = insight["category"]
                                                        .as_str()
                                                        .unwrap_or("")
                                                        .to_uppercase();
                                                    let canonical_key = insight["key"]
                                                        .as_str()
                                                        .unwrap_or("")
                                                        .trim();
                                                    let value = insight["value"]
                                                        .as_str()
                                                        .unwrap_or("")
                                                        .trim();
                                                    if value.is_empty() {
                                                        continue;
                                                    }

                                                    // Filter transient actions
                                                    if category == "ACTION" {
                                                        println!("[Kernel:Worker:Reflection] ⏭ Skipping action: {} ({})", canonical_key, value);
                                                        continue;
                                                    }

                                                    // Route to correct block with canonical key
                                                    let block = match category.as_str() {
                                                        "USER_FACT" => "core:user_profile",
                                                        "PREFERENCE" => "core:preferences",
                                                        "OS_INSIGHT" => "core:persona",
                                                        _ => "core:user_profile",
                                                    };

                                                    // Build storage key with canonical key for upsert dedup
                                                    let storage_key = if !canonical_key.is_empty() {
                                                        format!("{}:{}", block, canonical_key)
                                                    } else {
                                                        block.to_string()
                                                    };

                                                    println!(
                                                        "[Kernel:Worker:Reflection] -> {} = {}",
                                                        storage_key, value
                                                    );
                                                    let (mem_tx, _) = oneshot::channel();
                                                    let _ = refl_tx
                                                        .send(Syscall::MemoryAppend {
                                                            agent_id: "user".to_string(),
                                                            key: storage_key,
                                                            data: value.to_string(),
                                                            response_tx: mem_tx,
                                                        })
                                                        .await;
                                                }
                                            } else if text != "nothing" && text != "[]" {
                                                println!("[Kernel:Worker:Reflection] Non-JSON response, skipping (v4 requires JSON)");
                                            }
                                        }
                                    }
                                }

                                // ── Phase 4: Cleanup processed turns ──
                                // Delete archived turns that have been processed to prevent re-processing
                                if !turn_ids.is_empty() {
                                    println!("[Kernel:Worker:Reflection] Cleaning up {} processed turns...", turn_ids.len());
                                    for turn_id in &turn_ids {
                                        let (del_tx, _) = oneshot::channel();
                                        let _ = refl_tx
                                            .send(Syscall::MemoryDelete {
                                                agent_id: "user".to_string(),
                                                entry_id: turn_id.clone(),
                                                response_tx: del_tx,
                                            })
                                            .await;
                                    }
                                    println!("[Kernel:Worker:Reflection] ✓ Cleaned up {} processed turns", turn_ids.len());
                                }
                            }
                        }
                    }
                }
            }
        });

        // Main Dispatcher Loop: Receives Syscalls from Agents & Next.js, and routes them.
        let mut llm_queues: std::collections::HashMap<String, VecDeque<Syscall>> =
            std::collections::HashMap::new();
        let mut agent_order: VecDeque<String> = VecDeque::new();
        let start_time = Instant::now();
        let stats = self.stats.clone();

        loop {
            // Periodic Stats Update (Every 100ms for more responsiveness in UI)
            {
                if let Ok(mut s) = stats.try_lock() {
                    s.uptime_secs = start_time.elapsed().as_secs();
                    s.queue_size = llm_queues
                        .values()
                        .map(|q: &VecDeque<Syscall>| q.len())
                        .sum::<usize>();
                    s.active_agents = llm_queues.len();

                    // Respond to Policy Change from UI
                    match s.policy.as_str() {
                        "FIFO" => self.policy = SchedulingPolicy::FIFO,
                        "RoundRobin" => self.policy = SchedulingPolicy::RoundRobin,
                        _ => {}
                    }
                }
            }

            tokio::select! {
                Some(syscall) = self.rx.recv() => {
                    // Global Syscall Count
                    if let Ok(mut s) = stats.try_lock() {
                        s.total_syscalls += 1;
                    }

                    match syscall {
                        Syscall::LlmRequest { ref agent_id, priority, .. } |
                        Syscall::LlmBatchRequest { ref agent_id, priority, .. } => {
                            println!("[Kernel:Scheduler] Enqueuing LLM request with priority {:?}", priority);
                            let queue = llm_queues.entry(agent_id.clone()).or_insert_with(|| {
                                agent_order.push_back(agent_id.clone());
                                VecDeque::new()
                            });
                            queue.push_back(syscall);

                            // Re-sort current agent's queue by priority
                            queue.make_contiguous().sort_by(|a, b| {
                                let p_a = match a {
                                    Syscall::LlmRequest { priority, .. } => priority,
                                    Syscall::LlmBatchRequest { priority, .. } => priority,
                                    _ => &Priority::Normal,
                                };
                                let p_b = match b {
                                    Syscall::LlmRequest { priority, .. } => priority,
                                    Syscall::LlmBatchRequest { priority, .. } => priority,
                                    _ => &Priority::Normal,
                                };
                                p_b.cmp(p_a)
                            });
                        }
                        Syscall::ToolRequest { agent_id, priority, tool_name, args, response_tx } => {
                            // Memory tools (remember, core_memory_append, core_memory_replace) are no longer
                            // registered as agent tools. Fact storage is handled by extract_and_store_facts().
                            // All tool requests go directly to the tool worker.
                            let _ = tool_tx.send(Syscall::ToolRequest {
                                agent_id,
                                priority,
                                tool_name,
                                args,
                                response_tx,
                            }).await;
                        }
                        Syscall::GetToolDefinitions { .. } => {
                            let _ = tool_tx.send(syscall).await;
                        }
                        Syscall::ToolRetrieve { .. } |
                        Syscall::MemoryRead { .. } | Syscall::MemoryWrite { .. } | Syscall::MemoryAppend { .. } |
                        Syscall::MemoryRetrieve { .. } | Syscall::MemoryEvolve { .. } | Syscall::MemoryArchive { .. } |
                        Syscall::StorageRead { .. } | Syscall::StorageWrite { .. } |
                        Syscall::StorageCreate { .. } | Syscall::StorageList { .. } |
                        Syscall::StorageDelete { .. } | Syscall::StorageRollback { .. } |
                        Syscall::StorageShare { .. } | Syscall::StorageVersions { .. } |
                        Syscall::ContextCreate { .. } | Syscall::ContextCompact { .. } |
                        Syscall::ContextCheckpoint { .. } | Syscall::ContextGetMessages { .. } |
                        Syscall::MemoryUpdate { .. } | Syscall::MemoryDelete { .. } | Syscall::MemoryDeleteAll { .. } |
                        Syscall::UpdateStorageConfig { .. } | Syscall::UpdateMemoryConfig { .. } => {
                            let _ = mem_tx.send(syscall).await;
                        }
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    // Task Processing based on Policy
                    match self.policy {
                        SchedulingPolicy::RoundRobin => {
                            if let Some(agent_id) = agent_order.pop_front() {
                                if let Some(queue) = llm_queues.get_mut(&agent_id) {
                                    if let Some(syscall) = queue.pop_front() {
                                        let _ = llm_tx.send(syscall).await;
                                        if !queue.is_empty() {
                                            agent_order.push_back(agent_id);
                                        } else {
                                            llm_queues.remove(&agent_id);
                                        }
                                    }
                                }
                            }
                        }
                        SchedulingPolicy::FIFO => {
                            // In FIFO, we just take from the first available agent in order
                            if let Some(agent_id) = agent_order.iter().next().cloned() {
                                if let Some(queue) = llm_queues.get_mut(&agent_id) {
                                    if let Some(syscall) = queue.pop_front() {
                                        let _ = llm_tx.send(syscall).await;
                                        if queue.is_empty() {
                                            llm_queues.remove(&agent_id);
                                            agent_order.retain(|id| id != &agent_id);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
