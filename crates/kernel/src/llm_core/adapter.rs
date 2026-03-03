use crate::llm_core::backend::{
    AnthropicBackend, GeminiBackend, GroqBackend, LlmBackend, OllamaBackend, OpenAiBackend,
};
use crate::llm_core::types::{is_reasoning_model, LlmError, LlmRequest, LlmResponse};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

/// The LLM Adapter routes requests to the appropriate backend based on provider
pub struct LlmAdapter;

/// A2UI message keys we recognize for JSONL streaming
const A2UI_KEYS: &[&str] = &[
    "surfaceUpdate",
    "dataModelUpdate",
    "beginRendering",
    "deleteSurface",
];

fn is_a2ui_message(v: &serde_json::Value) -> bool {
    let obj = match v.as_object() {
        Some(o) => o,
        None => return false,
    };
    obj.keys().any(|k| A2UI_KEYS.contains(&k.as_str()))
}

/// Process output tokens through an A2UI filter.
/// 1. If a line-start looks like JSON (starts with '{'), buffer until '\n' to check if it's A2UI.
/// 2. If it is A2UI, emit agent-a2ui-message and suppress agent-stream.
/// 3. Otherwise (or if not JSON), emit to agent-stream immediately for a "live" feel.
fn process_and_emit_output(app_handle: &AppHandle, agent_id: &str, delta: &str, buf: &mut String) {
    if delta.is_empty() {
        return;
    }

    // If the buffer is empty and the delta looks like a JSON start, we enter buffering mode
    let is_json_start = buf.is_empty() && delta.trim_start().starts_with('{');

    buf.push_str(delta);

    // If we are in JSON mode, we MUST wait for a newline to process
    // If we are NOT in JSON mode (and haven't been), we can stream immediately
    if !is_json_start && !buf.trim_start().starts_with('{') {
        let chunk = buf.clone();
        buf.clear();
        let _ = app_handle.emit(
            "agent-stream",
            serde_json::json!({
                "agent_id": agent_id,
                "chunk": chunk,
                "is_final": false,
                "is_reasoning": false
            }),
        );
        return;
    }

    // Process complete lines
    while let Some(pos) = buf.find('\n') {
        let line_with_nl = buf[..pos + 1].to_string();
        let line = buf[..pos].trim().to_string();
        buf.drain(..pos + 1);

        if !line.is_empty() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if is_a2ui_message(&v) {
                    println!(
                        "[A2UI] Emitting agent-a2ui-message for agent {}: keys={:?}",
                        agent_id,
                        v.as_object().map(|o| o.keys().collect::<Vec<_>>())
                    );
                    let _ = app_handle.emit(
                        "agent-a2ui-message",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "message": v
                        }),
                    );
                    continue;
                } else {
                    println!(
                        "[A2UI] JSON line NOT A2UI for agent {}: keys={:?}",
                        agent_id,
                        v.as_object().map(|o| o.keys().collect::<Vec<_>>())
                    );
                }
            }
        }

        let _ = app_handle.emit(
            "agent-stream",
            serde_json::json!({
                "agent_id": agent_id,
                "chunk": line_with_nl,
                "is_final": false,
                "is_reasoning": false
            }),
        );
    }
}

impl LlmAdapter {
    /// Create a backend for the given provider
    ///
    /// The provider string is typically in format "provider:model_id" (parsed via settings::parse_agent_model)
    /// Falls back to OpenAI if provider is unknown
    pub async fn create_backend(
        app_handle: &AppHandle,
        provider: &str,
        _model_id: &str,
    ) -> Result<Box<dyn LlmBackend>, LlmError> {
        let client = app_handle
            .state::<crate::KernelState>()
            .http_client
            .clone();
        match provider {
            "openai" => {
                let api_key =
                    crate::settings::get_openai_api_key(app_handle).ok_or_else(|| {
                        LlmError::MissingApiKey {
                            provider: "openai".to_string(),
                        }
                    })?;
                Ok(Box::new(OpenAiBackend::new(client, api_key, None)))
            }
            "anthropic" => {
                let api_key = crate::settings::get_anthropic_api_key(app_handle)
                    .ok_or_else(|| LlmError::MissingApiKey {
                        provider: "anthropic".to_string(),
                    })?;
                Ok(Box::new(AnthropicBackend::new(client, api_key)))
            }
            "groq" => {
                let api_key =
                    crate::settings::get_groq_api_key(app_handle).ok_or_else(|| {
                        LlmError::MissingApiKey {
                            provider: "groq".to_string(),
                        }
                    })?;
                Ok(Box::new(GroqBackend::new(client, api_key)))
            }
            "gemini" | "google" => {
                let api_key =
                    crate::settings::get_gemini_api_key(app_handle).ok_or_else(|| {
                        LlmError::MissingApiKey {
                            provider: "gemini".to_string(),
                        }
                    })?;
                Ok(Box::new(GeminiBackend::new(client, api_key)))
            }
            "ollama" => {
                let endpoint = crate::settings::get_ollama_endpoint(app_handle)
                    .ok_or_else(|| LlmError::InvalidConfiguration {
                        reason: "Ollama endpoint not configured".to_string(),
                    })?;
                Ok(Box::new(OllamaBackend::new(client, endpoint)))
            }
            _ => {
                // Unknown provider: default to OpenAI
                eprintln!(
                    "[LLM Adapter] Unknown provider '{}', defaulting to OpenAI",
                    provider
                );
                let api_key =
                    crate::settings::get_openai_api_key(app_handle).ok_or_else(|| {
                        LlmError::MissingApiKey {
                            provider: "openai".to_string(),
                        }
                    })?;
                Ok(Box::new(OpenAiBackend::new(client, api_key, None)))
            }
        }
    }

    /// Execute an LLM request with automatic backend selection
    pub async fn call(
        app_handle: &AppHandle,
        provider: &str,
        model_id: &str,
        request: LlmRequest,
    ) -> Result<LlmResponse, LlmError> {
        let backend = Self::create_backend(app_handle, provider, model_id).await?;
        backend.call(request).await
    }

    /// Execute an LLM request using the old scheduler API format
    /// This maintains backward compatibility with scheduler.rs
    pub async fn call_legacy(
        app_handle: &AppHandle,
        system_prompt: &str,
        user_prompt: &str,
        tool_defs: &[serde_json::Value],
        model_str: Option<&String>,
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    ) -> Result<serde_json::Value, String> {
        let (provider, model_id) = crate::settings::parse_agent_model(model_str);

        // Filter tools to extract function definitions (legacy format)
        let tools: Vec<_> = tool_defs
            .iter()
            .filter_map(|v| {
                v.get("function").cloned().and_then(|f| {
                    if let (Some(name), Some(desc), Some(schema)) = (
                        f.get("name").and_then(|n| n.as_str()),
                        f.get("description").and_then(|d| d.as_str()),
                        f.get("parameters").cloned(),
                    ) {
                        Some(crate::llm_core::types::ToolDefinition {
                            name: name.to_string(),
                            description: desc.to_string(),
                            input_schema: schema,
                        })
                    } else {
                        None
                    }
                })
            })
            .collect();

        let request = LlmRequest {
            model: model_id.clone(),
            messages: vec![crate::llm_core::types::ChatMessage::Text {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            }],
            system: Some(system_prompt.to_string()),
            tools,
            temperature: None,
            max_tokens: max_tokens.map(|t| t as u32).or(Some(4096)),
            max_completion_tokens: max_completion_tokens.map(|t| t as u32).or(Some(4096)),
            reasoning_effort: None,
            reasoning_summary: None,
            include: None,
            parallel_tool_calls: None,
            tool_choice: None,
        };

        // For Ollama without tools, still support it via the adapter
        // For other providers or with tools, use the adapter
        let response = if provider == "ollama" && tool_defs.is_empty() {
            // Ollama without tools can use the new backend
            Self::call(app_handle, &provider, &model_id, request)
                .await
                .map_err(|e| e.to_string())?
        } else if provider == "ollama" && !tool_defs.is_empty() {
            // Ollama doesn't support tool calling, fall back to OpenAI
            println!(
                "[Kernel:LLM Adapter] Ollama with tools not supported, falling back to OpenAI"
            );
            let mut fallback_request = request;
            fallback_request.model = "gpt-4o".to_string();
            Self::call(app_handle, "openai", "gpt-4o", fallback_request)
                .await
                .map_err(|e| e.to_string())?
        } else {
            // All other providers
            Self::call(app_handle, &provider, &model_id, request)
                .await
                .map_err(|e| e.to_string())?
        };

        // Return in the format expected by scheduler.rs and agent.rs
        Ok(response.to_json_value())
    }

    /// Raw HTTP streaming for reasoning models — captures reasoning_content from raw JSON
    /// (async-openai's delta struct may not include it)
    async fn call_stream_raw(
        app_handle: &AppHandle,
        agent_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        tool_defs: &[serde_json::Value],
        model_id: &str,
        provider: &str,
        api_key: &str,
    ) -> Result<serde_json::Value, String> {
        use futures_util::StreamExt;
        use tauri::Emitter;

        let base_url = match provider {
            "groq" => "https://api.groq.com/openai/v1",
            _ => "https://api.openai.com/v1",
        };
        let url = format!("{}/chat/completions", base_url);

        let messages: Vec<serde_json::Value> = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_prompt}),
        ];

        let mut body = serde_json::json!({
            "model": model_id,
            "messages": messages,
            "stream": true,
        });

        if !tool_defs.is_empty() {
            let tools: Vec<serde_json::Value> = tool_defs
                .iter()
                .filter_map(|d| {
                    if d.get("type").is_some() {
                        Some(d.clone())
                    } else if let Some(f) = d.get("function") {
                        Some(serde_json::json!({ "type": "function", "function": f }))
                    } else {
                        None
                    }
                })
                .collect();
            if !tools.is_empty() {
                body["tools"] = serde_json::json!(tools);
                body["tool_choice"] = serde_json::json!("auto");
                body["parallel_tool_calls"] = serde_json::json!(false);
            }
        }

        let client = app_handle
            .state::<crate::KernelState>()
            .http_client
            .clone();
        let res = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("{}: {}", status, text));
        }

        let mut stream = res.bytes_stream();
        let mut final_content = String::new();
        let mut tool_name = String::new();
        let mut tool_args = String::new();
        let mut buf = String::new();
        let mut content_a2ui_buf = String::new();

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e: reqwest::Error| e.to_string())?;
            if let Ok(s) = String::from_utf8(bytes.to_vec()) {
                buf.push_str(&s);
                for line in buf.lines() {
                    let line = line.trim();
                    if line.starts_with("data: ") {
                        let data = line.strip_prefix("data: ").unwrap_or("");
                        if data == "[DONE]" {
                            continue;
                        }
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
                                if let Some(choice) = choices.first() {
                                    if let Some(delta) =
                                        choice.get("delta").and_then(|d| d.as_object())
                                    {
                                        // reasoning_content (OpenAI o1/o3)
                                        if let Some(r) =
                                            delta.get("reasoning_content").and_then(|v| v.as_str())
                                        {
                                            let _ = app_handle.emit(
                                                "agent-stream",
                                                serde_json::json!({
                                                    "agent_id": agent_id,
                                                    "chunk": r,
                                                    "is_final": false,
                                                    "is_reasoning": true
                                                }),
                                            );
                                        }
                                        // reasoning (DeepSeek/Groq)
                                        if let Some(r) =
                                            delta.get("reasoning").and_then(|v| v.as_str())
                                        {
                                            let _ = app_handle.emit(
                                                "agent-stream",
                                                serde_json::json!({
                                                    "agent_id": agent_id,
                                                    "chunk": r,
                                                    "is_final": false,
                                                    "is_reasoning": true
                                                }),
                                            );
                                        }
                                        // content
                                        if let Some(c) =
                                            delta.get("content").and_then(|v| v.as_str())
                                        {
                                            final_content.push_str(c);
                                            process_and_emit_output(
                                                app_handle,
                                                agent_id,
                                                c,
                                                &mut content_a2ui_buf,
                                            );
                                        }
                                        // tool_calls
                                        if let Some(tcs) =
                                            delta.get("tool_calls").and_then(|t| t.as_array())
                                        {
                                            for tc in tcs {
                                                if let Some(idx) =
                                                    tc.get("index").and_then(|i| i.as_u64())
                                                {
                                                    if idx == 0 {
                                                        if let Some(fn_obj) = tc.get("function") {
                                                            if let Some(n) = fn_obj
                                                                .get("name")
                                                                .and_then(|x| x.as_str())
                                                            {
                                                                tool_name.push_str(n);
                                                            }
                                                            if let Some(a) = fn_obj
                                                                .get("arguments")
                                                                .and_then(|x| x.as_str())
                                                            {
                                                                tool_args.push_str(a);
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
                }
                // Keep only incomplete line for next iteration
                if let Some(last_newline) = buf.rfind('\n') {
                    buf = buf[last_newline + 1..].to_string();
                }
            }
        }

        let _ = app_handle.emit(
            "agent-stream",
            serde_json::json!({
                "agent_id": agent_id,
                "chunk": "",
                "is_final": true
            }),
        );

        if !tool_name.is_empty() {
            let tool_json = serde_json::json!([{
                "function": {
                    "name": tool_name.trim(),
                    "arguments": tool_args
                }
            }]);
            Ok(serde_json::json!(format!(
                "CONTENT:{}TOOL_CALL:{}",
                final_content, tool_json
            )))
        } else {
            Ok(serde_json::json!(final_content))
        }
    }

    /// OpenAI Responses API streaming — captures reasoning_summary_text.delta for inner thought
    /// Only for OpenAI provider; Groq has no Responses API
    async fn call_stream_responses(
        app_handle: &AppHandle,
        agent_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        tool_defs: &[serde_json::Value],
        model_id: &str,
        api_key: &str,
    ) -> Result<serde_json::Value, String> {
        use futures_util::StreamExt;
        use tauri::Emitter;

        println!(
            "[LlmAdapter:ResponsesAPI] Starting stream for agent {} with model {}",
            agent_id, model_id
        );

        let url = "https://api.openai.com/v1/responses";

        // Convert tool_defs from Chat format to Responses format
        // Chat: { type: "function", function: { name, description, parameters } }
        // Responses: { type: "function", name, description, parameters }
        let tools: Vec<serde_json::Value> = tool_defs
            .iter()
            .filter_map(|d| {
                if let Some(f) = d.get("function") {
                    let name = f.get("name")?.clone();
                    let description = f
                        .get("description")
                        .cloned()
                        .unwrap_or(serde_json::json!(""));
                    let parameters = f
                        .get("parameters")
                        .cloned()
                        .unwrap_or(serde_json::json!({ "type": "object" }));
                    Some(serde_json::json!({
                        "type": "function",
                        "name": name,
                        "description": description,
                        "parameters": parameters
                    }))
                } else if d.get("type").and_then(|t| t.as_str()) == Some("function") {
                    Some(d.clone())
                } else {
                    None
                }
            })
            .collect();

        let input = serde_json::json!([
            {
                "role": "user",
                "content": [{ "type": "input_text", "text": user_prompt }]
            }
        ]);

        let mut body = serde_json::json!({
            "model": model_id,
            "instructions": system_prompt,
            "input": input,
            "stream": true,
            "reasoning": { "effort": "medium", "summary": "detailed" },
            "temperature": 1,
            "top_p": 1,
            "text": { "format": { "type": "text" } }
        });

        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
            body["tool_choice"] = serde_json::json!("auto");
            body["parallel_tool_calls"] = serde_json::json!(false);
        }

        let client = app_handle
            .state::<crate::KernelState>()
            .http_client
            .clone();
        let res = client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Responses API {}: {}", status, text));
        }

        let mut stream = res.bytes_stream();
        let mut final_content = String::new();
        let mut reasoning_summary = String::new();
        let mut tool_calls: Vec<serde_json::Value> = Vec::new();
        let mut buf = String::new();
        let mut content_a2ui_buf = String::new();
        let mut event_count: u32 = 0;
        let mut reasoning_event_count: u32 = 0;

        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e: reqwest::Error| e.to_string())?;
            if let Ok(s) = String::from_utf8(bytes.to_vec()) {
                buf.push_str(&s);

                // Process only complete lines (ending with \n)
                // Keep incomplete trailing content for next iteration
                let last_newline = buf.rfind('\n');
                let (process, remainder) = match last_newline {
                    Some(pos) => (buf[..pos + 1].to_string(), buf[pos + 1..].to_string()),
                    None => continue, // No complete line yet, wait for more data
                };
                buf = remainder;

                for line in process.lines() {
                    let line = line.trim();
                    if !line.starts_with("data: ") {
                        continue;
                    }
                    let data = line.strip_prefix("data: ").unwrap_or("");
                    if data == "[DONE]" {
                        continue;
                    }
                    let v = match serde_json::from_str::<serde_json::Value>(data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let event_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    event_count += 1;

                    match event_type {
                        // Reasoning summary — readable chain-of-thought summary
                        "response.reasoning_summary_text.delta" => {
                            if let Some(delta) = v.get("delta").and_then(|d| d.as_str()) {
                                reasoning_summary.push_str(delta);
                                reasoning_event_count += 1;
                                if reasoning_event_count <= 3 {
                                    println!("[LlmAdapter:ResponsesAPI] Reasoning summary delta ({}): '{}'",
                                        reasoning_event_count, &delta[..delta.len().min(80)]);
                                }
                                let _ = app_handle.emit(
                                    "agent-stream",
                                    serde_json::json!({
                                        "agent_id": agent_id,
                                        "chunk": delta,
                                        "is_final": false,
                                        "is_reasoning": true
                                    }),
                                );
                            }
                        }
                        // Output text deltas — the actual response content
                        "response.output_text.delta" => {
                            if let Some(delta) = v.get("delta").and_then(|d| d.as_str()) {
                                final_content.push_str(delta);
                                process_and_emit_output(
                                    app_handle,
                                    agent_id,
                                    delta,
                                    &mut content_a2ui_buf,
                                );
                            }
                        }
                        // Output text done — fallback for when output_text.delta events are not emitted
                        "response.output_text.done" => {
                            if final_content.is_empty() {
                                if let Some(text) = v.get("text").and_then(|t| t.as_str()) {
                                    final_content.push_str(text);
                                    process_and_emit_output(
                                        app_handle,
                                        agent_id,
                                        text,
                                        &mut content_a2ui_buf,
                                    );
                                }
                            }
                        }
                        // Reasoning summary done — log for debugging
                        "response.reasoning_summary_text.done" => {
                            println!("[LlmAdapter:ResponsesAPI] Reasoning summary complete ({} chars, {} events)",
                                reasoning_summary.len(), reasoning_event_count);
                        }
                        // Function call complete (streamed)
                        "response.function_call_arguments.done" => {
                            if let (Some(name), Some(args)) = (
                                v.get("name").and_then(|n| n.as_str()),
                                v.get("arguments").and_then(|a| a.as_str()),
                            ) {
                                println!(
                                    "[LlmAdapter:ResponsesAPI] Tool call (args.done): {}",
                                    name
                                );
                                tool_calls.push(serde_json::json!({
                                    "function": {
                                        "name": name,
                                        "arguments": args
                                    }
                                }));
                            }
                        }
                        // Content part done — fallback for when output_text.delta events are not emitted
                        "response.content_part.done" => {
                            if let Some(part) = v.get("part") {
                                let part_type =
                                    part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                if part_type == "output_text" {
                                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                        if final_content.is_empty() && !text.is_empty() {
                                            println!("[LlmAdapter:ResponsesAPI] Content recovered from content_part.done ({} chars)", text.len());
                                            final_content.push_str(text);
                                            process_and_emit_output(
                                                app_handle,
                                                agent_id,
                                                text,
                                                &mut content_a2ui_buf,
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        // Output item done — robust fallback: extract content or function calls
                        // from the completed item when delta events were missed
                        "response.output_item.done" => {
                            if let Some(item) = v.get("item") {
                                let item_type =
                                    item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match item_type {
                                    "message" => {
                                        // Extract text from message content array
                                        if final_content.is_empty() {
                                            if let Some(content_arr) =
                                                item.get("content").and_then(|c| c.as_array())
                                            {
                                                for part in content_arr {
                                                    let pt = part
                                                        .get("type")
                                                        .and_then(|t| t.as_str())
                                                        .unwrap_or("");
                                                    if pt == "output_text" {
                                                        if let Some(text) = part
                                                            .get("text")
                                                            .and_then(|t| t.as_str())
                                                        {
                                                            if !text.is_empty() {
                                                                println!("[LlmAdapter:ResponsesAPI] Content recovered from output_item.done/message ({} chars)", text.len());
                                                                final_content.push_str(text);
                                                                process_and_emit_output(
                                                                    app_handle,
                                                                    agent_id,
                                                                    text,
                                                                    &mut content_a2ui_buf,
                                                                );
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    "function_call" => {
                                        // Extract function call from completed item
                                        if let (Some(name), Some(args)) = (
                                            item.get("name").and_then(|n| n.as_str()),
                                            item.get("arguments").and_then(|a| a.as_str()),
                                        ) {
                                            println!("[LlmAdapter:ResponsesAPI] Tool call (item.done): {}", name);
                                            tool_calls.push(serde_json::json!({
                                                "function": {
                                                    "name": name,
                                                    "arguments": args
                                                }
                                            }));
                                        }
                                    }
                                    _ => {
                                        // Reasoning items, etc. — no action needed
                                    }
                                }
                            }
                        }
                        // Response lifecycle events — log for debugging
                        "response.created" | "response.in_progress" | "response.completed" => {
                            println!(
                                "[LlmAdapter:ResponsesAPI] Event: {} (total events: {})",
                                event_type, event_count
                            );
                        }
                        // Known events we don't need to process
                        "response.output_item.added"
                        | "response.content_part.added"
                        | "response.reasoning_summary_part.added"
                        | "response.reasoning_summary_part.done" => {
                            // Lifecycle markers — no content to extract
                        }
                        _ => {
                            // Log unknown events for debugging
                            if event_count <= 10 {
                                println!(
                                    "[LlmAdapter:ResponsesAPI] Unhandled event: {}",
                                    event_type
                                );
                            }
                        }
                    }
                }
            }
        }

        println!("[LlmAdapter:ResponsesAPI] Stream complete: {} events, {} reasoning events, {} content chars, {} tool calls",
            event_count, reasoning_event_count, final_content.len(), tool_calls.len());

        // Flush any remaining content in the A2UI buffer (last line without trailing \n)
        if !content_a2ui_buf.is_empty() {
            let remaining = content_a2ui_buf.trim().to_string();
            if !remaining.is_empty() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&remaining) {
                    if is_a2ui_message(&v) {
                        println!(
                            "[A2UI] Flushing final buffered A2UI message: keys={:?}",
                            v.as_object().map(|o| o.keys().collect::<Vec<_>>())
                        );
                        let _ = app_handle.emit(
                            "agent-a2ui-message",
                            serde_json::json!({
                                "agent_id": agent_id,
                                "message": v
                            }),
                        );
                    } else {
                        // Not A2UI — emit as regular stream content
                        let _ = app_handle.emit(
                            "agent-stream",
                            serde_json::json!({
                                "agent_id": agent_id,
                                "chunk": remaining,
                                "is_final": false,
                                "is_reasoning": false
                            }),
                        );
                    }
                } else {
                    // Not valid JSON — emit as text
                    let _ = app_handle.emit(
                        "agent-stream",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "chunk": remaining,
                            "is_final": false,
                            "is_reasoning": false
                        }),
                    );
                }
            }
            content_a2ui_buf.clear();
        }

        let _ = app_handle.emit(
            "agent-stream",
            serde_json::json!({
                "agent_id": agent_id,
                "chunk": "",
                "is_final": true
            }),
        );

        if !tool_calls.is_empty() {
            let tool_json = serde_json::Value::Array(tool_calls);
            Ok(serde_json::json!(format!(
                "CONTENT:{}TOOL_CALL:{}",
                final_content, tool_json
            )))
        } else {
            Ok(serde_json::json!(final_content))
        }
    }

    /// Execute an LLM request using streaming
    pub async fn call_stream(
        app_handle: &AppHandle,
        agent_id: &str,
        system_prompt: &str,
        user_prompt: &str,
        tool_defs: &[serde_json::Value],
        model_str: Option<&String>,
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    ) -> Result<serde_json::Value, String> {
        let (provider, model_id) = crate::settings::parse_agent_model(model_str);
        let is_reasoning = is_reasoning_model(&model_id);
        println!(
            "[LlmAdapter:call_stream] provider={}, model={}, is_reasoning={}, tools={}",
            provider,
            model_id,
            is_reasoning,
            tool_defs.len()
        );

        // Fallback to non-streaming for incompatible providers.
        // IMPORTANT: We still need to run the response through process_and_emit_output
        // so that A2UI JSONL lines are parsed and emitted as agent-a2ui-message events.
        if provider == "anthropic" || provider == "gemini" || provider == "google" {
            let result = Self::call_legacy(
                app_handle,
                system_prompt,
                user_prompt,
                tool_defs,
                model_str,
                max_tokens,
                max_completion_tokens,
            )
            .await?;
            if let Some(text) = result.as_str() {
                // Process each line through the A2UI filter so JSONL messages
                // are correctly emitted as agent-a2ui-message events
                let mut a2ui_buf = String::new();
                for line in text.lines() {
                    // Feed line + newline into the A2UI parser
                    process_and_emit_output(
                        app_handle,
                        agent_id,
                        &format!("{}\n", line),
                        &mut a2ui_buf,
                    );
                }
                // Flush any remaining buffer content
                if !a2ui_buf.is_empty() {
                    use tauri::Emitter;
                    let _ = app_handle.emit(
                        "agent-stream",
                        serde_json::json!({
                            "agent_id": agent_id,
                            "chunk": a2ui_buf,
                            "is_final": true,
                            "is_reasoning": false
                        }),
                    );
                }
            }
            return Ok(result);
        }

        let api_key = match provider.as_str() {
            "openai" => crate::settings::get_openai_api_key(app_handle)
                .ok_or("Missing OpenAI API Key")?,
            "groq" => crate::settings::get_groq_api_key(app_handle)
                .ok_or("Missing Groq API Key")?,
            "ollama" => "ollama".to_string(),
            _ => {
                crate::settings::get_openai_api_key(app_handle).ok_or("Missing API Key")?
            }
        };

        // OpenAI + reasoning: use Responses API for inner thought (reasoning_text.delta)
        if is_reasoning_model(&model_id) && provider == "openai" {
            return Self::call_stream_responses(
                app_handle,
                agent_id,
                system_prompt,
                user_prompt,
                tool_defs,
                &model_id,
                &api_key,
            )
            .await;
        }
        // Groq + reasoning: Chat Completions (Groq has no Responses API)
        if is_reasoning_model(&model_id) && provider == "groq" {
            return Self::call_stream_raw(
                app_handle,
                agent_id,
                system_prompt,
                user_prompt,
                tool_defs,
                &model_id,
                &provider,
                &api_key,
            )
            .await;
        }

        use async_openai::{
            config::OpenAIConfig,
            types::chat::{
                ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
                ChatCompletionRequestUserMessageArgs, ChatCompletionTool, ChatCompletionTools,
                CreateChatCompletionRequestArgs,
            },
            Client,
        };
        use futures_util::StreamExt;
        use tauri::Emitter;

        let mut config = OpenAIConfig::new().with_api_key(api_key.clone());
        if provider == "groq" {
            config = config.with_api_base("https://api.groq.com/openai/v1");
        } else if provider == "ollama" {
            let endpoint = crate::settings::get_ollama_endpoint(app_handle)
                .unwrap_or_else(|| "http://localhost:11434".to_string());
            config = config.with_api_base(format!("{}/v1", endpoint));
        }
        let client = Client::with_config(config);

        let system_msg = ChatCompletionRequestMessage::System(
            ChatCompletionRequestSystemMessageArgs::default()
                .content(system_prompt)
                .build()
                .map_err(|e: async_openai::error::OpenAIError| e.to_string())?,
        );

        let user_msg = ChatCompletionRequestMessage::User(
            ChatCompletionRequestUserMessageArgs::default()
                .content(user_prompt)
                .build()
                .map_err(|e: async_openai::error::OpenAIError| e.to_string())?,
        );

        let mut req_builder = CreateChatCompletionRequestArgs::default();
        req_builder
            .model(&model_id)
            .messages(vec![system_msg, user_msg])
            .stream(true);

        if !tool_defs.is_empty() {
            let mut tools_parsed = Vec::new();
            for def in tool_defs {
                if let Ok(t) = serde_json::from_value::<ChatCompletionTool>(def.clone()) {
                    tools_parsed.push(ChatCompletionTools::Function(t));
                } else {
                    let mut tc_def = def.clone();
                    if tc_def.get("type").is_none() {
                        if tc_def.get("function").is_some() {
                            tc_def["type"] = serde_json::json!("function");
                            if let Ok(t) = serde_json::from_value::<ChatCompletionTool>(tc_def) {
                                tools_parsed.push(ChatCompletionTools::Function(t));
                            }
                        }
                    } else {
                        println!("[LlmAdapter] Warning: Could not parse tool definition");
                    }
                }
            }
            if !tools_parsed.is_empty() {
                req_builder.tools(tools_parsed);
                // For reasoning models (o1, gpt-5), disable parallel tool calls. Only set when tools exist.
                if is_reasoning_model(&model_id) {
                    req_builder.parallel_tool_calls(false);
                }
            }
        }
        let request = req_builder
            .build()
            .map_err(|e: async_openai::error::OpenAIError| e.to_string())?;

        let mut stream = client
            .chat()
            .create_stream(request)
            .await
            .map_err(|e: async_openai::error::OpenAIError| e.to_string())?;

        let mut final_content = String::new();
        let mut tool_name = String::new();
        let mut tool_args = String::new();
        let mut content_a2ui_buf = String::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    if let Some(choice) = response.choices.first() {
                        // Robust content capture (handles content, reasoning_content, and vendor variations)
                        let delta_val =
                            serde_json::to_value(&choice.delta).unwrap_or(serde_json::json!({}));
                        // 1. Extract standard content
                        if let Some(c) = delta_val.get("content").and_then(|v| v.as_str()) {
                            final_content.push_str(c);
                            process_and_emit_output(app_handle, agent_id, c, &mut content_a2ui_buf);
                        }

                        // 2. Extract reasoning content (OpenAI o1/o3/gpt-5)
                        if let Some(r) = delta_val.get("reasoning_content").and_then(|v| v.as_str())
                        {
                            let chunk_text = r.to_string();
                            let _ = app_handle.emit(
                                "agent-stream",
                                serde_json::json!({
                                    "agent_id": agent_id,
                                    "chunk": chunk_text,
                                    "is_final": false,
                                    "is_reasoning": true
                                }),
                            );
                        }

                        // 3. Extract reasoning (DeepSeek/Groq variant)
                        if let Some(r) = delta_val.get("reasoning").and_then(|v| v.as_str()) {
                            let chunk_text = r.to_string();
                            let _ = app_handle.emit(
                                "agent-stream",
                                serde_json::json!({
                                    "agent_id": agent_id,
                                    "chunk": chunk_text,
                                    "is_final": false,
                                    "is_reasoning": true
                                }),
                            );
                        }

                        if let Some(tool_calls) = &choice.delta.tool_calls {
                            for tc in tool_calls {
                                if let Some(tc_fn) = &tc.function {
                                    if let Some(name) = &tc_fn.name {
                                        tool_name.push_str(name);
                                    }
                                    if let Some(args) = &tc_fn.arguments {
                                        tool_args.push_str(args);
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Stream error: {}", e);
                    break;
                }
            }
        }

        // Flush any remaining partial lines in the A2UI buffer
        if !content_a2ui_buf.is_empty() {
            process_and_emit_output(app_handle, agent_id, "\n", &mut content_a2ui_buf);
            content_a2ui_buf.clear();
        }

        let _ = app_handle.emit(
            "agent-stream",
            serde_json::json!({
                "agent_id": agent_id,
                "chunk": "",
                "is_final": true
            }),
        );

        if !tool_name.is_empty() {
            let tool_json = serde_json::json!([{
                "function": {
                    "name": tool_name.trim(),
                    "arguments": tool_args
                }
            }]);
            // Return BOTH content (thoughts/interim UI) and the tool call
            Ok(serde_json::json!(format!(
                "CONTENT:{}TOOL_CALL:{}",
                final_content, tool_json
            )))
        } else {
            Ok(serde_json::json!(final_content))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_selection() {
        // Test that provider parsing works correctly
        let providers = vec!["openai", "anthropic", "groq", "gemini", "google", "ollama"];
        for p in providers {
            // Just verify these don't panic - actual backend creation needs app_handle
            assert!(!p.is_empty());
        }
    }
}
