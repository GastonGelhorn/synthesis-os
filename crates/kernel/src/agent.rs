use crate::events_broadcast::{EventBroadcast, KernelEvent};
use crate::personas;
use crate::prompts;
use crate::scheduler;
use crate::settings;
use crate::status_labels;
use crate::syscall::Syscall;
use futures_util::future::join_all;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

/// Session context key: one global conversation window for "what did I ask before?" and continuity.
const SESSION_AGENT_ID: &str = "session";
const SESSION_SUMMARY_MAX_LEN: usize = 400;

/// Represents an active Agent process running within the SynthesisOS Kernel.
pub struct BaseAgent {
    pub process_id: String,
    syscall_tx: mpsc::Sender<Syscall>,
    app_handle: AppHandle,
}

impl BaseAgent {
    /// Spawns a new Agent as an isolated Tokio task.
    /// The agent runs continuously until its goal is achieved or it errors out.
    /// If task_id is provided, it is used for frontend correlation; otherwise a new UUID is generated.
    /// When mode == Some("os"), the agent responds conversationally without creating cards.
    pub fn spawn(
        goal: String,
        task_id: Option<String>,
        conversation_history: Option<String>,
        node_summaries: Option<Vec<serde_json::Value>>,
        mode: Option<String>,
        user_context: Option<String>,
        syscall_tx: mpsc::Sender<Syscall>,
        app_handle: AppHandle,
    ) -> String {
        let process_id = task_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let pid_clone = process_id.clone();

        let agent = Self {
            process_id: pid_clone.clone(),
            syscall_tx,
            app_handle,
        };

        // Spawn the agent's main thinking loop in the background
        tokio::spawn(async move {
            agent
                .run(goal, conversation_history, node_summaries, mode, user_context)
                .await;
        });

        pid_clone
    }

    /// The core ReAct (Reason + Act) loop of the Agent.
    /// Single-agent architecture: no Manager routing. Instead, uses Tool RAG for dynamic
    /// tool selection and persona fragments for domain-specific guidance.
    async fn run(
        &self,
        initial_goal: String,
        conversation_history: Option<String>,
        node_summaries: Option<Vec<serde_json::Value>>,
        mode: Option<String>,
        user_context: Option<String>,
    ) {
        println!(
            "[Agent:{}] Booting up. Goal: {}",
            self.process_id, initial_goal
        );
        let _ = self.emit_status(
            "STARTING",
            &format!("Booting agent for goal: {}", initial_goal),
        );

        // Context loading and tool RAG execution performed in parallel. 
        // Concurrent execution mitigates syscall round-trip latency (~2ms each).
        let _ = self.emit_status("THINKING", "Loading context & tools...");

        let memory_future = self.fetch_relevant_memories(&initial_goal);

        let rag_tx_clone = self.syscall_tx.clone();
        let rag_goal = initial_goal.clone();
        let tool_rag_future = async move {
            let (rag_tx, rag_rx) = oneshot::channel();
            let _ = rag_tx_clone
                .send(Syscall::ToolRetrieve {
                    query: rag_goal,
                    top_k: crate::tool_rag::DEFAULT_TOP_K,
                    response_tx: rag_tx,
                })
                .await;
            match rag_rx.await {
                Ok(resp) => match resp.data {
                    Ok(val) => serde_json::from_value::<Vec<String>>(val).unwrap_or_default(),
                    Err(e) => {
                        println!("[Agent] Tool RAG error: {}, using all tools", e);
                        Vec::new()
                    }
                },
                Err(_) => Vec::new(),
            }
        };

        // Run both concurrently — saves ~2-5s compared to sequential
        let (relevant_memories, rag_tool_names) = tokio::join!(memory_future, tool_rag_future);
        let mut memory_context = relevant_memories.unwrap_or_default();

        if let Some(ref ctx) = user_context {
            if !ctx.trim().is_empty() {
                if !memory_context.is_empty() {
                    memory_context.push_str("\n\n");
                }
                memory_context.push_str("### USER CONTEXT ###\n");
                memory_context.push_str(ctx.trim());
            }
        }

        if let Some(history) = conversation_history {
            if !history.is_empty() {
                if !memory_context.is_empty() {
                    memory_context.push_str("\n\n");
                }
                let label = if mode.as_deref() == Some("os") {
                    "### RECENT OS CONVERSATION ###"
                } else {
                    "### RECENT CONVERSATION (Active Card Context) ###"
                };
                memory_context.push_str(label);
                memory_context.push_str("\n");
                memory_context.push_str(&history);
            }
        }

        if let Some(summaries) = node_summaries {
            if !summaries.is_empty() {
                if !memory_context.is_empty() {
                    memory_context.push_str("\n\n");
                }
                memory_context.push_str("### OTHER ACTIVE SPATIAL NODES (lazy loading) ###\n");
                memory_context.push_str("Active nodes (title, space, createdAt, id). Use get_node_content(node_id) to fetch full summary when needed.\n");
                for s in summaries {
                    let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("?");
                    let title = s
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("(no title)");
                    let space = s.get("spaceId").and_then(|v| v.as_str()).unwrap_or("—");
                    let created = s
                        .get("createdAt")
                        .and_then(|v| v.as_i64())
                        .map(|ts| {
                            use chrono::{TimeZone, Utc};
                            Utc.timestamp_millis_opt(ts)
                                .single()
                                .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                                .unwrap_or_else(|| "—".to_string())
                        })
                        .unwrap_or_else(|| "—".to_string());
                    memory_context.push_str(&format!(
                        "  - {} | space: {} | created: {} | id: {}\n",
                        title, space, created, id
                    ));
                }
            }
        }

        // OS chat mode: user talks to the system owner; respond conversationally, do NOT create cards
        if mode.as_deref() == Some("os") {
            if !memory_context.is_empty() {
                memory_context.push_str("\n\n");
            }
            memory_context.push_str("### OS CHAT MODE ###\n");
            memory_context.push_str("You are in OS chat mode. The user talks to you as the system owner. Respond conversationally or with brief ephemeral answers. Do NOT create cards or use creative/informative card-generating responses. Use direct_answer or conversational replies. Use the node summaries above only when the question is about the workspace (e.g. 'what did we work on', 'summarize my tasks').\n");
        }

        // ── Step 3: Fetch full tool definitions and filter by RAG results ──
        let (tool_tx, tool_rx) = oneshot::channel();
        let _ = self
            .syscall_tx
            .send(Syscall::GetToolDefinitions {
                agent_id: self.process_id.clone(),
                response_tx: tool_tx,
            })
            .await;
        let raw_tools = tool_rx.await.unwrap_or_default();
        let disabled_tools = settings::get_disabled_tools(&self.app_handle);

        let rag_filtered_tools: Vec<serde_json::Value> = if rag_tool_names.is_empty() {
            // Fallback: use all tools (RAG not available or failed)
            raw_tools
                .iter()
                .filter(|def| {
                    let name = def
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    !disabled_tools.contains(name)
                })
                .cloned()
                .collect()
        } else {
            raw_tools
                .iter()
                .filter(|def| {
                    let name = def
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    rag_tool_names.contains(&name.to_string()) && !disabled_tools.contains(name)
                })
                .cloned()
                .collect()
        };

        // ── Step 4: Select dynamic persona fragments ──
        let selected_personas = personas::select_personas(&initial_goal, &rag_tool_names, 3);
        let persona_text = personas::format_persona_fragments(&selected_personas);

        // ── Step 5: Build unified system prompt ──
        let format_instruction = if mode.as_deref() == Some("os") {
            settings::OS_CHAT_RESPONSE_FORMAT.to_string()
        } else {
            settings::get_agent_response_format_instruction(&self.app_handle)
        };
        let tool_categories = prompts::format_tool_categories(&rag_filtered_tools);
        let system_prompt = prompts::build_unified_system_prompt(
            &tool_categories,
            &persona_text,
            &memory_context,
            &format_instruction,
        );

        // Model: use global routing settings
        let kernel_config = settings::get_kernel_config(&self.app_handle);
        let agent_model = Some(kernel_config.main_model);

        // ── Step 5b: Optional Planning (explicit plan before ReAct) ──
        let plan_text = {
            let _ = self.emit_status("PLANNING", "Creating execution plan...");
            let planning_prompt = prompts::build_planning_prompt(&initial_goal);
            let (plan_tx, plan_rx) = oneshot::channel();
            let _ = self
                .syscall_tx
                .send(Syscall::LlmRequest {
                    agent_id: self.process_id.clone(),
                    priority: crate::syscall::Priority::Normal,
                    prompt: planning_prompt,
                    response_tx: plan_tx,
                    system_prompt: Some(
                        "You are a planning assistant. Output only valid JSON. No markdown."
                            .to_string(),
                    ),
                    tool_definitions: Some(vec![]),
                    model: agent_model.clone(),
                    stream: false,
                    max_tokens: Some(512),
                    max_completion_tokens: Some(512),
                })
                .await;

            match plan_rx.await {
                Ok(resp) => match resp.data {
                    Ok(val) => {
                        let text = val.as_str().unwrap_or_default().trim();
                        let parsed: Option<serde_json::Value> = serde_json::from_str(text).ok();
                        parsed.and_then(|p| {
                            let steps = p.get("steps")?.as_array()?;
                            let step_count = steps.len();
                            if step_count == 0 { return None; }
                            let text = steps.iter().enumerate().map(|(i, s)| {
                                let desc = s.get("description").and_then(|d| d.as_str()).unwrap_or("?");
                                let tools: Vec<&str> = s.get("tools_needed")
                                    .and_then(|t| t.as_array())
                                    .map(|a| a.iter().filter_map(|x| x.as_str()).collect())
                                    .unwrap_or_default();
                                let tools_str = if tools.is_empty() { String::new() } else { format!(" [tools: {}]", tools.join(", ")) };
                                format!("{}. {}{}", i + 1, desc, tools_str)
                            }).collect::<Vec<_>>().join("\n");
                            let parallel_hint = if step_count >= 2 {
                                "\nTIP: If steps are independent (e.g. calendar + emails), call multiple tools in ONE response to execute in parallel."
                            } else {
                                ""
                            };
                            Some(format!("{}{}", text, parallel_hint))
                        })
                    }
                    Err(_) => None,
                },
                Err(_) => None,
            }
        };

        // ── Step 6: Single-Agent ReAct Loop ──
        let mut tool_steps: Vec<(String, String, String)> = Vec::new();
        let max_steps = 10;
        let mut step = 1;
        let mut observations = String::new();
        let mut obs_list: Vec<String> = Vec::new();
        let mut step_counter = 0;

        // A2UI State Tracking
        let mut a2ui_surface_id: Option<String> = None;
        let mut a2ui_active_ids: Vec<String> = Vec::new();
        let mut a2ui_data_model: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        // LLM handles tool selection dynamically. 
        // Automatic execution of system tools (e.g. volume/brightness) based on RAG 
        // has been disabled to prevent irrelevant tool calls.

        let _ = self.emit_status("THINKING", "Reasoning...");

        loop {
            // Use RAG-filtered tools (already computed above; no re-fetching per step)
            let tools_to_use = rag_filtered_tools.clone();

            // Inject A2UI state into observations for Prompt Caching context retention
            let a2ui_context = if !a2ui_active_ids.is_empty() {
                let sid = a2ui_surface_id.as_deref().unwrap_or("main");
                let ids_str = a2ui_active_ids.join(", ");
                let dm_str = if a2ui_data_model.is_empty() {
                    "(empty)".to_string()
                } else {
                    a2ui_data_model
                        .iter()
                        .map(|(k, v)| format!("  {}: {}", k, v))
                        .collect::<Vec<_>>()
                        .join("\n")
                };
                format!(
                    "\n\n[A2UI STATE — DO NOT DUPLICATE]\nSurface: '{}'\nActive Components: [{}]\nData Model:\n{}\nRULE: Use surfaceUpdate ONLY to UPDATE existing components or ADD new ones. Use dataModelUpdate to change data. NEVER re-create components that already exist.",
                    sid, ids_str, dm_str
                )
            } else {
                String::new()
            };

            let effective_observations = if a2ui_context.is_empty() {
                observations.clone()
            } else {
                format!("{}{}", observations, a2ui_context)
            };

            let prompt_for_step = if step == 1 && observations.trim().is_empty() {
                prompts::build_agent_initial_prompt_with_plan(&initial_goal, plan_text.as_deref())
            } else {
                prompts::build_agent_continuation_prompt(
                    &effective_observations,
                    &initial_goal,
                    step,
                    10,
                )
            };

            let _ = self.emit_status(
                "THINKING",
                &format!("Reasoning about next steps (Step {})...", step),
            );

            let (llm_tx, llm_rx) = oneshot::channel();
            let _ = self
                .syscall_tx
                .send(Syscall::LlmRequest {
                    agent_id: self.process_id.clone(),
                    priority: crate::syscall::Priority::Normal,
                    prompt: prompt_for_step,
                    response_tx: llm_tx,
                    system_prompt: Some(system_prompt.clone()),
                    tool_definitions: Some(tools_to_use),
                    model: agent_model.clone(),
                    stream: true,
                    max_tokens: None,
                    max_completion_tokens: None,
                })
                .await;

            let llm_response = match llm_rx.await {
                Ok(resp) => {
                    println!(
                        "[Agent:{}] LLM step finished in {}ms",
                        self.process_id, resp.metrics.execution_ms
                    );
                    match resp.data {
                        Ok(val) => val.as_str().unwrap_or_default().to_string(),
                        Err(e) => {
                            let _ = self.emit_status("ERROR", &format!("Agent LLM Error: {}", e));
                            break; // Changed from return to break to allow cleanup/final status
                        }
                    }
                }
                Err(e) => {
                    println!("[Agent:{}] Syscall Channel Error: {}", self.process_id, e);
                    let _ = self.emit_status("ERROR", "Failed to reach LLM worker.");
                    break;
                }
            };

            let mut final_content = llm_response.clone();
            let mut tool_json = String::new();

            if llm_response.starts_with("CONTENT:") {
                if let Some(tool_idx) = llm_response.find("TOOL_CALL:") {
                    final_content = llm_response[8..tool_idx].to_string();
                    tool_json = llm_response[tool_idx + 10..].to_string();
                } else {
                    final_content = llm_response[8..].to_string();
                }
            } else if llm_response.starts_with("TOOL_CALL:") {
                tool_json = llm_response[10..].to_string();
                final_content = String::new();
            }

            // ── A2UI State Extraction ──
            // Parse A2UI JSONL lines from the LLM response to track what was rendered.
            for line in final_content.lines() {
                let trimmed = line.trim();
                if !trimmed.starts_with('{') {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    // beginRendering: set the active surface
                    if let Some(br) = v.get("beginRendering") {
                        if let Some(sid) = br.get("surfaceId").and_then(|s| s.as_str()) {
                            a2ui_surface_id = Some(sid.to_string());
                        }
                        if let Some(root) = br.get("root").and_then(|r| r.as_str()) {
                            if !a2ui_active_ids.contains(&root.to_string()) {
                                a2ui_active_ids.push(root.to_string());
                            }
                        }
                    }
                    // surfaceUpdate: track component IDs
                    if let Some(su) = v.get("surfaceUpdate") {
                        // Shorthand: single component with "id"
                        if let Some(id) = su.get("id").and_then(|i| i.as_str()) {
                            if !a2ui_active_ids.contains(&id.to_string()) {
                                a2ui_active_ids.push(id.to_string());
                            }
                        }
                        // Full form: array of components
                        if let Some(components) = su.get("components").and_then(|c| c.as_array()) {
                            for comp in components {
                                if let Some(id) = comp.get("id").and_then(|i| i.as_str()) {
                                    if !a2ui_active_ids.contains(&id.to_string()) {
                                        a2ui_active_ids.push(id.to_string());
                                    }
                                }
                            }
                        }
                    }
                    // dataModelUpdate: track data paths
                    if let Some(dm) = v.get("dataModelUpdate") {
                        if let Some(contents) = dm.get("contents").and_then(|c| c.as_array()) {
                            let path_prefix = dm.get("path").and_then(|p| p.as_str()).unwrap_or("");
                            for entry in contents {
                                if let Some(key) = entry.get("key").and_then(|k| k.as_str()) {
                                    let full_path = if path_prefix.is_empty() {
                                        format!("/{}", key)
                                    } else {
                                        format!("{}/{}", path_prefix, key)
                                    };
                                    let val = entry
                                        .get("valueString")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("<set>")
                                        .to_string();
                                    // Truncate long values to save tokens
                                    let truncated = if val.len() > 80 {
                                        format!("{}...", &val[..77])
                                    } else {
                                        val
                                    };
                                    a2ui_data_model.insert(full_path, truncated);
                                }
                            }
                        }
                    }
                }
            }

            // Yield intermediate UI if any JSON with "yield_ui" is found in final_content
            if let Some(start) = final_content.find('{') {
                if let Some(end) = final_content.rfind('}') {
                    let potential_json = &final_content[start..=end];
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(potential_json) {
                        if let Some(yielded) = val.get("yield_ui") {
                            println!(
                                "[Agent:{}] Yielding intermediate UI blocks",
                                self.process_id
                            );
                            let _ = self.app_handle.emit(
                                "agent-ui-patch",
                                serde_json::json!({
                                    "agent_id": self.process_id,
                                    "patch": yielded
                                }),
                            );
                        }
                    }
                }
            }

            let preview_end = final_content
                .char_indices()
                .nth(100)
                .map(|(i, _)| i)
                .unwrap_or(final_content.len());
            println!(
                "[Agent:{}] Thought: {}",
                self.process_id,
                &final_content[..preview_end]
            );

            // Emit thought preview for real-time UI (semantic labels)
            let tool_names_for_status: Vec<String> =
                if let Ok(calls) = serde_json::from_str::<Vec<serde_json::Value>>(&tool_json) {
                    calls
                        .iter()
                        .filter_map(|c| c["function"]["name"].as_str().map(String::from))
                        .collect()
                } else {
                    Vec::new()
                };
            let tool_names_refs: Vec<&str> =
                tool_names_for_status.iter().map(String::as_str).collect();
            if !tool_names_refs.is_empty() {
                let _ = self.emit_status(
                    "THINKING",
                    &status_labels::tool_status_label(&tool_names_refs),
                );
            }

            if !tool_json.is_empty() {
                let tool_calls: Vec<serde_json::Value> =
                    serde_json::from_str(&tool_json).unwrap_or_default();

                let mut all_calls: Vec<(String, String)> = Vec::new();
                for call in &tool_calls {
                    let name = call["function"]["name"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let args = call["function"]["arguments"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    all_calls.push((name, args));
                }

                // ACTING: must include tool name for agentRunner parsing (format "Executing tool: {name}...")
                let first_tool = tool_names_for_status
                    .first()
                    .map(String::as_str)
                    .unwrap_or("unknown");
                let _ = self.emit_status("ACTING", &format!("Executing tool: {}...", first_tool));

                // ── Human-in-the-loop: gate destructive tools through approval ──
                // Partition into safe (parallel) and destructive (sequential, gated).
                if !all_calls.is_empty() {
                    use crate::approval_gate::is_destructive;

                    let mut safe_calls: Vec<(String, String)> = Vec::new();
                    let mut destructive_calls: Vec<(String, String)> = Vec::new();

                    for (name, args) in &all_calls {
                        if is_destructive(name) {
                            destructive_calls.push((name.clone(), args.clone()));
                        } else {
                            safe_calls.push((name.clone(), args.clone()));
                        }
                    }

                    // 1. Execute safe (non-destructive) tools in parallel
                    if !safe_calls.is_empty() {
                        let mut futures = Vec::new();
                        for (name, args) in &safe_calls {
                            let tx = self.syscall_tx.clone();
                            let pid = self.process_id.clone();
                            let tool_name = name.clone();
                            let tool_args = args.clone();

                            futures.push(tokio::spawn(async move {
                                let (tool_tx, tool_rx) = oneshot::channel();
                                let _ = tx
                                    .send(Syscall::ToolRequest {
                                        agent_id: pid,
                                        priority: crate::syscall::Priority::Normal,
                                        tool_name: tool_name.clone(),
                                        args: tool_args.clone(),
                                        response_tx: tool_tx,
                                    })
                                    .await;
                                let result = match tool_rx.await {
                                    Ok(resp) => match resp.data {
                                        Ok(val) => val.as_str().unwrap_or_default().to_string(),
                                        Err(e) => format!("Tool Error: {}", e),
                                    },
                                    _ => "System Fallback: Tool execution timeout or failure."
                                        .to_string(),
                                };
                                (tool_name, tool_args, result)
                            }));
                        }

                        let results = join_all(futures).await;
                        for join_result in results {
                            match join_result {
                                Ok((name, args, result)) => {
                                    let success = !result.contains("Tool Error")
                                        && !result.contains("timeout")
                                        && !result.contains("failure");
                                    let obs =
                                        format!("Tool: {}, Args: {}, Result: {}", name, args, result);
                                    obs_list.push(obs);
                                    tool_steps.push((name.clone(), args.clone(), result.clone()));
                                    let _ = self.emit_tool_result(
                                        &name,
                                        &args,
                                        &result,
                                        success,
                                        step_counter,
                                    );
                                    step_counter += 1;
                                }
                                Err(e) => {
                                    println!("[Agent:{}] Tool join error: {}", self.process_id, e);
                                }
                            }
                        }
                    }

                    // 2. Execute destructive tools sequentially with approval gate
                    for (name, args) in &destructive_calls {
                        let approved = self.gate_destructive_tool(name, args, step_counter).await;

                        if !approved {
                            let result = format!("Tool '{}' was rejected by the user.", name);
                            let obs = format!("Tool: {}, Args: {}, Result: {}", name, args, result);
                            obs_list.push(obs);
                            tool_steps.push((name.clone(), args.clone(), result.clone()));
                            let _ = self.emit_tool_result(name, args, &result, false, step_counter);
                            step_counter += 1;
                            continue;
                        }

                        let _ = self.emit_status("ACTING", &format!("Executing tool: {}...", name));

                        let tx = self.syscall_tx.clone();
                        let pid = self.process_id.clone();
                        let tool_name = name.clone();
                        let tool_args = args.clone();

                        let (tool_tx, tool_rx) = oneshot::channel();
                        let _ = tx
                            .send(Syscall::ToolRequest {
                                agent_id: pid,
                                priority: crate::syscall::Priority::Normal,
                                tool_name: tool_name.clone(),
                                args: tool_args.clone(),
                                response_tx: tool_tx,
                            })
                            .await;
                        let result = match tool_rx.await {
                            Ok(resp) => match resp.data {
                                Ok(val) => val.as_str().unwrap_or_default().to_string(),
                                Err(e) => format!("Tool Error: {}", e),
                            },
                            _ => "System Fallback: Tool execution timeout or failure.".to_string(),
                        };

                        let success = !result.contains("Tool Error")
                            && !result.contains("timeout")
                            && !result.contains("failure");
                        let obs = format!("Tool: {}, Args: {}, Result: {}", tool_name, tool_args, result);
                        obs_list.push(obs);
                        tool_steps.push((tool_name.clone(), tool_args.clone(), result.clone()));
                        let _ = self.emit_tool_result(&tool_name, &tool_args, &result, success, step_counter);
                        step_counter += 1;
                    }
                }

                observations = obs_list.join("\n");
                let _ = self.emit_status("THINKING", "Processing results...");

                // Safeguard: if we've seen this exact tool+args before, force text-only to break loop
                let last_call = tool_calls.first().and_then(|c| {
                    let n = c["function"]["name"].as_str().unwrap_or("");
                    let a = c["function"]["arguments"].as_str().unwrap_or("");
                    if n.is_empty() {
                        None
                    } else {
                        Some(format!("Tool: {}, Args: {}", n, a))
                    }
                });
                let force_final = last_call
                    .map(|prefix| obs_list.iter().filter(|o| o.starts_with(&prefix)).count() > 1)
                    .unwrap_or(false);

                if force_final {
                    println!(
                        "[Agent:{}] Detected repeated tool call, forcing final answer (no tools)",
                        self.process_id
                    );
                    let summary = if final_content.trim().is_empty() {
                        // Never expose raw tool observations to the user. Synthesize or use generic fallback.
                        let synthesis_prompt = format!(
                            "You MUST give a final answer NOW. Here is the data collected:\n\n{}\n\nGoal: {}\n\nSummarize the most relevant information into a brief, natural reply. Do NOT include raw tool output, Args, or Result in your response. Do NOT ask for more information.",
                            observations, initial_goal
                        );
                        let _ = self.emit_status("THINKING", "Synthesizing final answer...");
                        let (synth_tx, synth_rx) = oneshot::channel();
                        let _ = self
                            .syscall_tx
                            .send(Syscall::LlmRequest {
                                agent_id: self.process_id.clone(),
                                priority: crate::syscall::Priority::Normal,
                                prompt: synthesis_prompt,
                                response_tx: synth_tx,
                                system_prompt: Some(system_prompt.clone()),
                                tool_definitions: Some(vec![]),
                                model: agent_model.clone(),
                                stream: true,
                                max_tokens: None,
                                max_completion_tokens: None,
                            })
                            .await;
                        match synth_rx.await {
                            Ok(resp) => resp
                                .data
                                .ok()
                                .and_then(|v| v.as_str().map(String::from))
                                .filter(|s| !s.trim().is_empty())
                                .unwrap_or_else(|| "He recopilado la información solicitada.".to_string()),
                            Err(_) => "He recopilado la información solicitada.".to_string(),
                        }
                    } else {
                        final_content.clone()
                    };
                    let _ = self.emit_status("COMPLETE", &summary);
                    let _ = self.emit_agent_response(&initial_goal, &summary, &tool_steps);
                    self.push_session_turn(&initial_goal, &summary);
                    break;
                }
            } else {
                // Guardrail: first step must execute at least one tool call.
                // Prevents "I can do it, run this command..." responses without actual execution.
                // BUT: if the LLM returned a substantial response OR has structure/A2UI, accept it.
                let content_len = final_content.trim().len();
                let has_a2ui = final_content.contains("beginRendering")
                    || final_content.contains("surfaceUpdate");
                let has_structure = final_content.contains("\n- ")
                    || final_content.contains("\n1.")
                    || final_content.contains("\n2.")
                    || final_content.matches("\n\n").count() >= 1;
                let threshold = if has_structure { 80 } else { 150 };
                let is_sufficient = content_len >= threshold || has_a2ui;
                if step == 1 && obs_list.is_empty() && !is_sufficient {
                    println!("[Agent:{}] Agent returned short text ({} chars) on step 1 without tool call; forcing tool usage.", self.process_id, content_len);
                    let _ = self.emit_status(
                        "THINKING",
                        "No tool was called yet. Forcing tool execution...",
                    );
                    obs_list.push(
                        "SYSTEM: You did not call any tool in step 1. You MUST call exactly one relevant tool now before giving a final answer."
                            .to_string(),
                    );
                    observations = obs_list.join("\n");
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    step += 1;
                    continue;
                }

                // No tool call means the LLM is providing a final response or thought
                println!(
                    "[Agent:{}] Final Response: {}",
                    self.process_id, final_content
                );
                let _ = self.emit_status("COMPLETE", &final_content);
                let _ = self.emit_agent_response(&initial_goal, &final_content, &tool_steps);
                self.push_session_turn(&initial_goal, &final_content);
                break;
            }

            // Small delay to prevent tight-looping and allow UI updates
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            step += 1;
        }

        if step >= max_steps {
            // Instead of a generic "max steps" message, try to synthesize from accumulated data
            if !observations.is_empty() {
                let obs_str = observations.clone();
                println!(
                    "[Agent:{}] Max steps reached, forcing final synthesis from {} observations",
                    self.process_id,
                    obs_list.len()
                );

                // One final LLM call with NO tools to force a text response
                let synthesis_prompt = format!(
                    "You MUST give a final answer NOW. Here is all the data collected:\n\n{}\n\nGoal: {}\n\nSummarize the most relevant information from the tool results above into a clear, helpful answer. Include any URLs, links, or key data points. Do NOT ask for more information.",
                    obs_str, initial_goal
                );

                let _ = self.emit_status("THINKING", "Synthesizing final answer...");

                let (synth_tx, synth_rx) = oneshot::channel();
                let _ = self
                    .syscall_tx
                    .send(Syscall::LlmRequest {
                        agent_id: self.process_id.clone(),
                        priority: crate::syscall::Priority::Normal,
                        prompt: synthesis_prompt,
                        response_tx: synth_tx,
                        system_prompt: Some(system_prompt.clone()),
                        tool_definitions: Some(vec![]), // No tools — must produce text
                        model: agent_model.clone(),
                        stream: true,
                        max_tokens: None,
                        max_completion_tokens: None,
                    })
                    .await;

                match synth_rx.await {
                    Ok(resp) => {
                        if let Ok(val) = resp.data {
                            let final_text =
                                val.as_str().unwrap_or("No data collected.").to_string();
                            let _ = self.emit_status("COMPLETE", &final_text);
                            let _ =
                                self.emit_agent_response(&initial_goal, &final_text, &tool_steps);
                            self.push_session_turn(&initial_goal, &final_text);
                        } else {
                            // LLM failed — never expose raw observations to the user
                            let fallback = "No pude completar la síntesis. Intenta reformular tu consulta.";
                            let _ = self.emit_status("COMPLETE", fallback);
                            let _ = self.emit_agent_response(&initial_goal, fallback, &tool_steps);
                            self.push_session_turn(&initial_goal, fallback);
                        }
                    }
                    Err(_) => {
                        let fallback = "No pude completar la síntesis. Intenta reformular tu consulta.";
                        let _ = self.emit_status("COMPLETE", fallback);
                        let _ = self.emit_agent_response(&initial_goal, fallback, &tool_steps);
                        self.push_session_turn(&initial_goal, fallback);
                    }
                }
            } else {
                let msg = "No se pudo completar la tarea. Intenta reformular tu consulta.";
                let _ = self.emit_status("COMPLETE", msg);
                let _ = self.emit_agent_response(&initial_goal, msg, &tool_steps);
                self.push_session_turn(&initial_goal, msg);
            }
        }

        println!(
            "[Agent:{}] Execution finished in {} steps.",
            self.process_id, step
        );

        // ── Post-response fact extraction (background, no latency impact) ──
        // The agent's ReAct loop may store 0-1 facts per step (it's optimized for speed).
        // This catches ALL facts from the user message and stores them atomically.
        // Duplicates are prevented by store_fact() dedup (L2 distance < 0.3).
        self.extract_and_store_facts(&initial_goal).await;
    }

    /// Asynchronously analyzes the user's message for personal facts and stores them.
    /// Runs with low priority after the main response is sent.
    ///
    /// v4 Hybrid KV+Semantic: The LLM generates canonical keys (e.g. "user.name", "pref.language")
    /// for natural dedup via upsert, while embeddings provide semantic retrieval.
    /// Transient commands (category "action") are filtered out and not stored.
    async fn extract_and_store_facts(&self, user_msg: &str) {
        // Skip very short messages or system commands
        if user_msg.len() < 10 {
            return;
        }

        let extract_prompt = format!(
            "Analyze this user message and extract PERSISTENT facts only. Classify each into ONE category:\n\
            - \"user_fact\": Personal facts ABOUT THE USER (name, pets, location, job, family, hobbies, age).\n\
            - \"os_insight\": Facts about the AI/OS ITSELF (its identity, its role, its relationship to the user).\n\
            - \"preference\": User interaction preferences (language, tone, format, style).\n\
            - \"action\": Transient commands or requests (change brightness, search something, play music, show news). These are NOT stored.\n\n\
            For each fact, provide a CANONICAL KEY that uniquely identifies it. The key should be stable: \
            if the user says the same thing differently, it should produce the SAME key.\n\n\
            Respond as JSON: {{\"facts\": [{{\"key\": \"<canonical_key>\", \"value\": \"<fact_value>\", \"category\": \"<category>\"}}]}}\n\n\
            Rules:\n\
            - Each entry MUST be a SINGLE, ATOMIC fact.\n\
            - The \"key\" must be a short, dot-separated identifier (e.g. \"user.name\", \"pref.language\", \"user.pet.name\").\n\
            - The \"value\" should be the CONCISE fact content (not a sentence — just the data).\n\
            - Commands like \"sube el brillo\", \"busca noticias\", \"pon música\" are ALWAYS \"action\" — do NOT store them.\n\
            - If NO persistent facts found, respond with: {{\"facts\": []}}\n\n\
            Key naming convention:\n\
            - user.name, user.age, user.location, user.job, user.pet.name, user.pet.type\n\
            - pref.language, pref.tone, pref.format, pref.style\n\
            - os.identity, os.role, os.behavior\n\n\
            Examples:\n\
            - \"Me llamo Gastón\" → {{\"key\": \"user.name\", \"value\": \"Gastón\", \"category\": \"user_fact\"}}\n\
            - \"Eres mi OS y vives en mi Mac\" → {{\"key\": \"os.identity\", \"value\": \"OS basado en IA que vive en el Mac del usuario\", \"category\": \"os_insight\"}}\n\
            - \"Prefiero respuestas en español\" → {{\"key\": \"pref.language\", \"value\": \"español\", \"category\": \"preference\"}}\n\
            - \"Sube el brillo al 80%\" → {{\"key\": \"action.brightness\", \"value\": \"80%\", \"category\": \"action\"}}\n\
            - \"Busca noticias de IA\" → {{\"key\": \"action.search\", \"value\": \"noticias de IA\", \"category\": \"action\"}}\n\n\
            USER MESSAGE: {}",
            user_msg
        );

        let (llm_tx, llm_rx) = oneshot::channel();
        let _ = self.syscall_tx.send(Syscall::LlmRequest {
            agent_id: "fact_extractor".to_string(),
            priority: crate::syscall::Priority::Low,
            prompt: extract_prompt,
            response_tx: llm_tx,
            system_prompt: Some("You are a fact extraction kernel. For each fact, output a canonical key, concise value, and category. Output valid JSON only.".to_string()),
            tool_definitions: Some(vec![]),
            model: Some(settings::get_kernel_config(&self.app_handle).extractor_model),
            stream: false,
            max_tokens: None,
            max_completion_tokens: None,
        }).await;

        if let Ok(resp) = llm_rx.await {
            if let Ok(val) = resp.data {
                let text = val.as_str().unwrap_or_default();
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
                    if let Some(facts) = parsed["facts"].as_array() {
                        for fact in facts {
                            let obj = match fact.as_object() {
                                Some(o) => o,
                                None => continue,
                            };

                            let category = obj
                                .get("category")
                                .and_then(|v| v.as_str())
                                .unwrap_or("user_fact");

                            // Filter out transient actions — these are commands, not facts
                            if category == "action" {
                                let action_key =
                                    obj.get("key").and_then(|v| v.as_str()).unwrap_or("?");
                                println!(
                                    "[Agent:{}] ⏭ Skipping transient action: {} ({})",
                                    self.process_id,
                                    action_key,
                                    obj.get("value").and_then(|v| v.as_str()).unwrap_or("")
                                );
                                continue;
                            }

                            // Extract canonical key and value
                            let canonical_key =
                                obj.get("key").and_then(|v| v.as_str()).unwrap_or("");
                            let value = obj
                                .get("value")
                                .and_then(|v| v.as_str())
                                // Fallback to "content" for backwards compat with old format
                                .or_else(|| obj.get("content").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            if value.is_empty() {
                                continue;
                            }

                            // Route to the correct core block based on category
                            let block = match category {
                                "os_insight" => "core:persona",
                                "preference" => "core:preferences",
                                _ => "core:user_profile",
                            };

                            // Build the storage key: block prefix + canonical key
                            // e.g. "core:user_profile:user.name" or "core:preferences:pref.language"
                            let storage_key = if !canonical_key.is_empty() {
                                format!("{}:{}", block, canonical_key)
                            } else {
                                block.to_string() // Fallback — derive_fact_key will handle it
                            };

                            println!(
                                "[Agent:{}] Extracted fact [{}] key={}: {}",
                                self.process_id, category, storage_key, value
                            );

                            // v4: Each fact → MemoryAppend with canonical key → store_fact (upsert by key)
                            let (mem_tx, mem_rx) = oneshot::channel();
                            if let Err(e) = self
                                .syscall_tx
                                .send(Syscall::MemoryAppend {
                                    agent_id: "user".to_string(),
                                    key: storage_key.clone(),
                                    data: value.to_string(),
                                    response_tx: mem_tx,
                                })
                                .await
                            {
                                println!(
                                    "[Agent:{}] MemoryAppend send failed: {}",
                                    self.process_id, e
                                );
                                continue;
                            }
                            match mem_rx.await {
                                Ok(resp) => match resp.data {
                                    Ok(_) => println!(
                                        "[Agent:{}] ✓ Fact stored [{}]: {}",
                                        self.process_id,
                                        storage_key,
                                        &value[..value.len().min(60)]
                                    ),
                                    Err(e) => println!(
                                        "[Agent:{}] ✗ Fact storage FAILED: {} | key: {}",
                                        self.process_id, e, storage_key
                                    ),
                                },
                                Err(_) => println!(
                                    "[Agent:{}] ✗ MemoryAppend channel closed (scheduler down?)",
                                    self.process_id
                                ),
                            }
                        }
                    }
                }
            }
        }
    }

    /// Fetches relevant long-term memories (user facts, name, etc.) and Core Memory blocks.
    async fn fetch_relevant_memories(&self, query: &str) -> Option<String> {
        let mut final_memories = Vec::new();

        // 1. Fetch Core Memory (Persona & User Profile) - Always included
        for core_key in ["core:persona", "core:user_profile"] {
            let (tx, rx) = oneshot::channel();
            let _ = self
                .syscall_tx
                .send(Syscall::MemoryRead {
                    agent_id: "user".to_string(), // Core memory is stored in the "user" context for cross-agent access
                    key: core_key.to_string(),
                    response_tx: tx,
                })
                .await;

            if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(1), rx).await
            {
                if let Ok(data) = resp.data {
                    if let Some(content) = data.as_str() {
                        if !content.is_empty() {
                            let label = if core_key.contains("persona") {
                                "CORE MEMORY: PERSONA (My Identity)"
                            } else {
                                "CORE MEMORY: USER PROFILE (About the User)"
                            };
                            final_memories.push(format!("### {} ###\n{}\n", label, content));
                        }
                    }
                }
            }
        }

        // 2. Fetch Semantically Relevant Memories (Subconscious)
        let (tx, rx) = oneshot::channel();
        let _ = self
            .syscall_tx
            .send(Syscall::MemoryRetrieve {
                agent_id: "user".to_string(),
                query: query.to_string(),
                tags: None,
                limit: 5,
                response_tx: tx,
            })
            .await;

        if let Ok(Ok(resp)) = tokio::time::timeout(std::time::Duration::from_secs(4), rx).await {
            if let Ok(data) = resp.data {
                if let Some(entries) = data.get("entries").and_then(|x| x.as_array()) {
                    let sem_lines: Vec<String> = entries
                        .iter()
                        .filter_map(|e| e.get("content").and_then(|c| c.as_str()).map(String::from))
                        .collect();

                    if !sem_lines.is_empty() {
                        final_memories.push(format!(
                            "### SUBCONSCIOUS MEMORIES (Relevant Background) ###\n{}",
                            sem_lines.join("\n")
                        ));
                    }
                }
            }
        }

        if final_memories.is_empty() {
            None
        } else {
            Some(final_memories.join("\n\n"))
        }
    }

    /// Appends one user/assistant turn to the session context (for next query's "recent conversation").
    /// Archives to memory only when context auto-prunes (old messages evicted); fact extraction
    /// is handled by extract_and_store_facts() post-response, not by archival.
    fn push_session_turn(&self, user_msg: &str, assistant_summary: &str) {
        let summary = Self::response_to_summary(assistant_summary);

        let pruned_msgs = if let Ok(guard) = scheduler::CONTEXT_MANAGER.lock() {
            let mut all_pruned = Vec::new();
            if let Ok(p1) = guard.add_message(SESSION_AGENT_ID, "user", user_msg) {
                all_pruned.extend(p1);
            }
            if let Ok(p2) = guard.add_message(SESSION_AGENT_ID, "assistant", &summary) {
                all_pruned.extend(p2);
            }
            all_pruned
        } else {
            Vec::new()
        };

        if !pruned_msgs.is_empty() {
            let tx = self.syscall_tx.clone();
            let turns: Vec<(String, String)> = pruned_msgs
                .into_iter()
                .map(|m| (m.role, m.content))
                .collect();
            tokio::spawn(async move {
                let (res_tx, res_rx) = oneshot::channel();
                if let Err(e) = tx
                    .send(Syscall::MemoryArchive {
                        agent_id: "user".to_string(),
                        turns,
                        response_tx: res_tx,
                    })
                    .await
                {
                    println!("[Agent] MemoryArchive send failed: {}", e);
                    return;
                }
                match res_rx.await {
                    Ok(resp) => match resp.data {
                        Ok(_) => println!("[Agent] ✓ Pruned turns archived to memory"),
                        Err(e) => println!("[Agent] ✗ Session archive FAILED: {}", e),
                    },
                    Err(_) => println!("[Agent] ✗ MemoryArchive channel closed"),
                }
            });
        }
    }

    /// Extracts a short summary from a response (JSON "summary"/"title" or truncation) for session context.
    fn response_to_summary(response: &str) -> String {
        let trimmed = response.trim();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(s) = v.get("summary").and_then(|x| x.as_str()) {
                return s.to_string();
            }
            if let Some(s) = v.get("title").and_then(|x| x.as_str()) {
                return s.to_string();
            }
        }
        if trimmed.len() > SESSION_SUMMARY_MAX_LEN {
            format!("{}...", &trimmed[..SESSION_SUMMARY_MAX_LEN])
        } else {
            trimmed.to_string()
        }
    }

    /// Emits a typed Tauri event to pass data to the frontend (reserved for future use)
    #[allow(dead_code)]
    fn emit_event<S: serde::Serialize + Clone>(
        &self,
        event_name: &str,
        payload: S,
    ) -> tauri::Result<()> {
        self.app_handle.emit(event_name, payload)
    }

    /// Emits agent-response event so the frontend can create a card and show the result.
    /// steps: (tool, input, result) for template matching.
    fn emit_agent_response(
        &self,
        query: &str,
        response: &str,
        steps: &[(String, String, String)],
    ) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct ToolStepPayload {
            tool: String,
            input: String,
            result: String,
        }
        #[derive(serde::Serialize, Clone)]
        struct AgentResponsePayload {
            task_id: String,
            query: String,
            response: String,
            steps: Vec<ToolStepPayload>,
        }

        let steps_payload: Vec<ToolStepPayload> = steps
            .iter()
            .map(|(tool, input, result)| ToolStepPayload {
                tool: tool.clone(),
                input: input.clone(),
                result: result.clone(),
            })
            .collect();

        let payload = AgentResponsePayload {
            task_id: self.process_id.clone(),
            query: query.to_string(),
            response: response.to_string(),
            steps: steps_payload,
        };
        self.app_handle.emit("agent-response", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "agent-response".to_string(),
                task_id: self.process_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Emits a state change event over Tauri's IPC to update the Next.js UI (and broadcast for HTTP SSE).
    fn emit_status(&self, state: &str, details: &str) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct AgentStatusPayload {
            process_id: String,
            state: String,
            details: String,
        }
        let payload = AgentStatusPayload {
            process_id: self.process_id.clone(),
            state: state.to_string(),
            details: details.to_string(),
        };
        self.app_handle.emit("agent-status-update", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "agent-status-update".to_string(),
                task_id: self.process_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Emits a tool result event after tool execution completes (for progressive UI building)
    fn emit_tool_result(
        &self,
        tool_name: &str,
        tool_input: &str,
        result_text: &str,
        success: bool,
        step_index: usize,
    ) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct AgentToolResultPayload {
            agent_id: String,
            tool_name: String,
            tool_input: String,
            result_text: String,
            success: bool,
            step_index: usize,
        }

        // Truncate result to ~2000 chars to avoid huge payloads
        let truncated_result = if result_text.len() > 2000 {
            format!("{}...[truncated]", &result_text[..2000])
        } else {
            result_text.to_string()
        };

        let payload = AgentToolResultPayload {
            agent_id: self.process_id.clone(),
            tool_name: tool_name.to_string(),
            tool_input: tool_input.to_string(),
            result_text: truncated_result,
            success,
            step_index,
        };
        self.app_handle.emit("agent-tool-result", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "agent-tool-result".to_string(),
                task_id: self.process_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Emits an approval request event so the frontend can show the HITL dialog.
    fn emit_approval_request(
        &self,
        approval_key: &str,
        tool_name: &str,
        tool_input: &str,
        step_index: usize,
    ) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct ApprovalRequestPayload {
            agent_id: String,
            approval_key: String,
            tool_name: String,
            tool_input: String,
            step_index: usize,
        }

        let payload = ApprovalRequestPayload {
            agent_id: self.process_id.clone(),
            approval_key: approval_key.to_string(),
            tool_name: tool_name.to_string(),
            tool_input: if tool_input.len() > 500 {
                format!("{}...", &tool_input[..500])
            } else {
                tool_input.to_string()
            },
            step_index,
        };
        self.app_handle.emit("agent-approval-request", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "agent-approval-request".to_string(),
                task_id: self.process_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Checks if a tool requires approval and, if so, gates on user response.
    /// Returns Ok(true) if approved or not needed, Ok(false) if rejected.
    async fn gate_destructive_tool(
        &self,
        tool_name: &str,
        tool_input: &str,
        step_index: usize,
    ) -> bool {
        use crate::approval_gate::is_destructive;
        use crate::KernelState;

        if !is_destructive(tool_name) {
            return true;
        }

        let gate = match self.app_handle.try_state::<KernelState>() {
            Some(ks) => ks.approval_gate.clone(),
            None => {
                println!("[Agent:{}] No KernelState for approval gate, allowing tool", self.process_id);
                return true;
            }
        };

        let approval_key = format!("{}:{}", self.process_id, uuid::Uuid::new_v4());

        let _ = self.emit_status("WAITING_APPROVAL", &format!(
            "Requires approval: {} ({})",
            tool_name,
            if tool_input.len() > 80 { &tool_input[..80] } else { tool_input }
        ));

        let _ = self.emit_approval_request(&approval_key, tool_name, tool_input, step_index);

        let rx = gate.request(approval_key.clone()).await;

        match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
            Ok(Ok(approved)) => {
                if approved {
                    println!("[Agent:{}] Tool '{}' APPROVED by user", self.process_id, tool_name);
                } else {
                    println!("[Agent:{}] Tool '{}' REJECTED by user", self.process_id, tool_name);
                }
                approved
            }
            _ => {
                println!("[Agent:{}] Tool '{}' approval TIMED OUT, rejecting", self.process_id, tool_name);
                false
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// SynthesisAgent: Lightweight, single-LLM-call card generation.
// Used when agentMode is OFF — no tools, no ReAct loop, just:
//   1. Classify intent
//   2. Optional web scrape for context
//   3. Generate structured card JSON
// ═══════════════════════════════════════════════════════════════════════

/// System prompt for the Synthesis card generator.
const SYNTHESIS_SYSTEM_PROMPT: &str = r##"You are SynthesisOS, an AI-native operating system.
You produce rich, structured UI cards as JSON. Do NOT use markdown. Respond ONLY with a valid JSON object.

The JSON must have this exact structure:
{
  "title": "Short descriptive title",
  "type": "agent_task",
  "summary": "2-3 sentence summary of the answer",
  "design": {
    "accent_color": "#HEX_COLOR",
    "vibe": "cosmic|minimal|nature|tech|warm",
    "text_style": "sans|mono|serif",
    "glass_opacity": 0.4
  },
  "blocks": [
    {
      "type": "text_block",
      "content": "The main content text here",
      "style": "body",
      "url": "", "caption": "", "items": [], "actions": [], "code": "", "language": "",
      "ordered": false, "variant": "none", "stats": [], "title": "", "description": "",
      "headers": [], "rows": []
    }
  ],
  "suggested_width": 400,
  "suggested_height": 500,
  "sources": [],
  "logs": ["Synthesized by Rust kernel"]
}

Available block types: 
- Base: text_block (h1/h2/body/caption/quote), data_grid (items with label/value/icon), list_block (items with text/icon), code_block (code/language), stats_row (stats with label/value/trend), table_block (headers/rows), callout (content/variant), hero_image (url/caption), action_row (actions with label/intent/primary), separator, link_preview (url/title/description), image_gallery (images with url/caption)
- Layout: tabs_block (tabs array with id/label/icon, activeTabId), accordion_block (title/icon/defaultExpanded), carousel_block (autoPlay), timeline_block (events array with title/timestamp/description/status), badge_set (badges array with label/color/icon)
- Interactive: input_block (value/placeholder/label/inputType), select_block (value/options array/label), toggle_block (checked/label), slider_block (value/min/max/step/label), datepicker_block (date/label)
- Data/Media: progress_bar (items with value 0-100), canvas_block (items with label/value/color + canvas_type bar|line), map_block (latitude/longitude/zoom), audio_player (url/title/artist), video_player (url/title), skeleton_block (skeletonType card|avatar|text|image, lines), markdown_block (content).

Use these blocks to craft beautiful, rich, dynamic cards.

RULES:
- Use multiple block types for rich content. Don't just use text_block for everything.
- For factual/data answers: use data_grid, stats_row, or table_block.
- For quick visual comparisons/trends: use canvas_block.
- For code: use code_block with the appropriate language.
- For lists: use list_block.
- accent_color should match the topic mood (e.g. #F7931A for Bitcoin, #1DA1F2 for Twitter topics).
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.
- Every field in a block must be present (use empty string, empty array, false, "none" as defaults).
- suggested_width: 340-500. suggested_height: 400-600."##;

pub struct SynthesisAgent {
    pub task_id: String,
    syscall_tx: mpsc::Sender<Syscall>,
    app_handle: AppHandle,
}

impl SynthesisAgent {
    /// Spawns the synthesis task as a background Tokio task.
    pub fn spawn(
        query: String,
        task_id: String,
        syscall_tx: mpsc::Sender<Syscall>,
        app_handle: AppHandle,
    ) -> String {
        let tid = task_id.clone();

        let agent = Self {
            task_id: tid.clone(),
            syscall_tx,
            app_handle,
        };

        tokio::spawn(async move {
            agent.run(query).await;
        });

        tid
    }

    async fn run(&self, query: String) {
        println!(
            "[Synthesis:{}] Starting synthesis for: {}",
            self.task_id, query
        );
        let _ = self.emit_progress("classifying", "Classifying intent...");

        // Step 1: Single LLM call to generate the card
        let _ = self.emit_progress("generating", "Generating card...");

        let prompt = format!(
            "User query: {}\n\nGenerate a structured UI card JSON response for this query. Be informative and thorough.",
            query
        );

        let (llm_tx, llm_rx) = oneshot::channel();
        let _ = self
            .syscall_tx
            .send(Syscall::LlmRequest {
                agent_id: self.task_id.clone(),
                priority: crate::syscall::Priority::High,
                prompt,
                response_tx: llm_tx,
                system_prompt: Some(SYNTHESIS_SYSTEM_PROMPT.to_string()),
                tool_definitions: Some(vec![]), // No tools for synthesis
                model: None,
                stream: false,
                max_tokens: None,
                max_completion_tokens: None,
            })
            .await;

        let llm_response = match llm_rx.await {
            Ok(resp) => {
                println!(
                    "[Synthesis:{}] LLM responded in {}ms",
                    self.task_id, resp.metrics.execution_ms
                );
                let _ = self.emit_progress(
                    "processing",
                    &format!("LLM responded in {}ms", resp.metrics.execution_ms),
                );
                match resp.data {
                    Ok(val) => val.as_str().unwrap_or_default().to_string(),
                    Err(e) => {
                        println!("[Synthesis:{}] LLM Error: {}", self.task_id, e);
                        let _ = self.emit_synthesis_error(&query, &format!("LLM Error: {}", e));
                        return;
                    }
                }
            }
            Err(e) => {
                println!("[Synthesis:{}] Channel Error: {}", self.task_id, e);
                let _ = self.emit_synthesis_error(&query, "Failed to reach LLM worker.");
                return;
            }
        };

        // Step 2: Parse the JSON card from LLM response
        let _ = self.emit_progress("finalizing", "Building card...");

        // Try to extract JSON from the response (handle markdown code blocks, etc.)
        let json_str = Self::extract_json(&llm_response);

        match serde_json::from_str::<serde_json::Value>(&json_str) {
            Ok(card) => {
                println!("[Synthesis:{}] Card generated successfully", self.task_id);
                let _ = self.emit_synthesis_complete(&query, card);
            }
            Err(e) => {
                println!(
                    "[Synthesis:{}] JSON parse failed: {} — raw: {}",
                    self.task_id,
                    e,
                    &llm_response[..std::cmp::min(llm_response.len(), 200)]
                );
                // Fallback: create a text card from the raw response
                let fallback_card = serde_json::json!({
                    "title": query.chars().take(200).collect::<String>(),
                    "type": "agent_task",
                    "summary": llm_response.chars().take(300).collect::<String>(),
                    "design": {
                        "accent_color": "#A78BFA",
                        "vibe": "cosmic",
                        "text_style": "sans",
                        "glass_opacity": 0.4
                    },
                    "blocks": [{
                        "type": "text_block",
                        "content": llm_response,
                        "style": "body",
                        "url": "", "caption": "", "items": [], "actions": [],
                        "code": "", "language": "", "ordered": false,
                        "variant": "none", "stats": [], "title": "", "description": "",
                        "headers": [], "rows": []
                    }],
                    "suggested_width": 400,
                    "suggested_height": 500,
                    "sources": [],
                    "logs": ["JSON parse failed, rendered as text", format!("Parse error: {}", e)]
                });
                let _ = self.emit_synthesis_complete(&query, fallback_card);
            }
        }
    }

    /// Extract JSON object from potentially markdown-wrapped LLM response.
    fn extract_json(raw: &str) -> String {
        let trimmed = raw.trim();

        // Try to find JSON inside markdown code block
        if let Some(start) = trimmed.find("```json") {
            let after_marker = &trimmed[start + 7..];
            if let Some(end) = after_marker.find("```") {
                return after_marker[..end].trim().to_string();
            }
        }
        if let Some(start) = trimmed.find("```") {
            let after_marker = &trimmed[start + 3..];
            if let Some(end) = after_marker.find("```") {
                let block = after_marker[..end].trim();
                if block.starts_with('{') {
                    return block.to_string();
                }
            }
        }

        // Find the outermost { ... }
        if let Some(start) = trimmed.find('{') {
            if let Some(end) = trimmed.rfind('}') {
                return trimmed[start..=end].to_string();
            }
        }

        trimmed.to_string()
    }

    /// Emit progress event for the thinking card (and broadcast for HTTP SSE).
    fn emit_progress(&self, phase: &str, message: &str) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct SynthesisProgressPayload {
            task_id: String,
            phase: String,
            message: String,
        }
        let payload = SynthesisProgressPayload {
            task_id: self.task_id.clone(),
            phase: phase.to_string(),
            message: message.to_string(),
        };
        self.app_handle.emit("synthesis-progress", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "synthesis-progress".to_string(),
                task_id: self.task_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Emit synthesis complete with card data (and broadcast for HTTP SSE).
    fn emit_synthesis_complete(&self, query: &str, card: serde_json::Value) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct SynthesisCompletePayload {
            task_id: String,
            query: String,
            card: serde_json::Value,
        }
        let payload = SynthesisCompletePayload {
            task_id: self.task_id.clone(),
            query: query.to_string(),
            card,
        };
        self.app_handle.emit("synthesis-complete", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "synthesis-complete".to_string(),
                task_id: self.task_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }

    /// Emit synthesis error (and broadcast for HTTP SSE).
    fn emit_synthesis_error(&self, query: &str, error: &str) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct SynthesisErrorPayload {
            task_id: String,
            query: String,
            error: String,
        }
        let payload = SynthesisErrorPayload {
            task_id: self.task_id.clone(),
            query: query.to_string(),
            error: error.to_string(),
        };
        self.app_handle.emit("synthesis-error", &payload)?;
        if let Some(tx) = self.app_handle.try_state::<EventBroadcast>() {
            let _ = tx.send(KernelEvent {
                event: "synthesis-error".to_string(),
                task_id: self.task_id.clone(),
                payload: serde_json::to_value(&payload).unwrap_or_default(),
            });
        }
        Ok(())
    }
}
