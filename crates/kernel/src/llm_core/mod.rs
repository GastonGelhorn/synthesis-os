pub mod adapter;
pub mod backend;
pub mod types;

pub use adapter::LlmAdapter;

use async_openai::{
    config::OpenAIConfig,
    types::chat::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs, ChatCompletionTool, ChatCompletionTools,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Debug, Clone)]
pub struct LlmInferenceRequest {
    pub prompt: String,
    pub system_prompt: String,
    pub tool_definitions: Vec<Value>,
    pub model: Option<String>,
    pub max_tokens: Option<usize>,
    pub max_completion_tokens: Option<usize>,
}

#[derive(Clone)]
pub struct LlmCore {
    app_handle: AppHandle,
}

impl LlmCore {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub async fn infer(&self, req: LlmInferenceRequest) -> Result<Value, String> {
        let (provider, model_id) = crate::settings::parse_agent_model(req.model.as_ref());

        match provider.as_str() {
            "ollama" => {
                self.run_ollama_llm(
                    &model_id,
                    &req.system_prompt,
                    &req.prompt,
                    &req.tool_definitions,
                    req.max_tokens,
                    req.max_completion_tokens,
                )
                .await
            }
            "openai" => {
                Self::run_openai_llm(
                    &self.app_handle,
                    &req.system_prompt,
                    &req.prompt,
                    &req.tool_definitions,
                    req.model.as_ref(), // Pass the original model string if available
                    req.max_tokens,
                    req.max_completion_tokens,
                )
                .await
            }
            "groq" => {
                self.run_groq_llm(
                    &self.app_handle,
                    &req.system_prompt,
                    &req.prompt,
                    req.model.as_ref(),
                    req.max_tokens,
                )
                .await
            }
            "anthropic" => {
                self.run_anthropic_llm(
                    &model_id,
                    &req.system_prompt,
                    &req.prompt,
                    &req.tool_definitions,
                    req.max_tokens,
                )
                .await
            }
            "gemini" | "google" => {
                self.run_gemini_llm(
                    &model_id,
                    &req.system_prompt,
                    &req.prompt,
                    &req.tool_definitions,
                    req.max_tokens,
                )
                .await
            }
            _ => {
                // Backward-compatible default for legacy model strings.
                Self::run_openai_llm(
                    &self.app_handle,
                    &req.system_prompt,
                    &req.prompt,
                    &req.tool_definitions,
                    req.model.as_ref(),
                    req.max_tokens,
                    req.max_completion_tokens,
                )
                .await
            }
        }
    }

    async fn run_openai_llm_completion_tokens(
        &self,
        model_id: &str,
        system_content: &str,
        prompt: &str,
        tool_defs: &[Value],
        max_tokens: Option<usize>,
    ) -> Result<Value, String> {
        let api_key = crate::settings::get_openai_api_key(&self.app_handle)
            .ok_or_else(|| "OpenAI API key not set".to_string())?;

        let messages = vec![
            json!({"role": "system", "content": system_content}),
            json!({"role": "user", "content": prompt}),
        ];

        let mut body = json!({
            "model": model_id,
            "messages": messages,
            "max_completion_tokens": max_tokens.unwrap_or(4096) as u32,
        });

        if !tool_defs.is_empty() {
            body["tools"] = Value::Array(tool_defs.to_vec());
            body["tool_choice"] = json!("auto");
        }

        let resp = reqwest::Client::new()
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("OpenAI API error {}: {}", status, text));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        Self::parse_openai_like_response(&json)
    }

    pub async fn run_openai_llm(
        app_handle: &AppHandle,
        system: &str,
        prompt: &str,
        tool_definitions: &[serde_json::Value],
        model: Option<&String>,
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    ) -> Result<serde_json::Value, String> {
        let api_key = crate::settings::get_openai_api_key(app_handle);
        let client = if let Some(key) = api_key {
            Client::with_config(OpenAIConfig::default().with_api_key(key))
        } else {
            Client::new()
        };

        let model_id = model
            .map(|s| s.to_string())
            .unwrap_or_else(|| "gpt-4o".to_string());

        let build_messages = || -> Result<Vec<ChatCompletionRequestMessage>, String> {
            Ok(vec![
                ChatCompletionRequestMessage::System(
                    ChatCompletionRequestSystemMessageArgs::default()
                        .content(system)
                        .build()
                        .map_err(|e: async_openai::error::OpenAIError| e.to_string())?,
                ),
                ChatCompletionRequestMessage::User(
                    ChatCompletionRequestUserMessageArgs::default()
                        .content(prompt)
                        .build()
                        .map_err(|e: async_openai::error::OpenAIError| e.to_string())?,
                ),
            ])
        };

        let model_lower = model_id.to_lowercase();
        let use_completion_tokens = model_lower.starts_with("o1")
            || model_lower.starts_with("o3")
            || model_lower.starts_with("gpt-5");

        // If max_completion_tokens is specified, use the old endpoint.
        // This is a temporary workaround for models that don't support max_tokens directly.
        if use_completion_tokens {
            return LlmCore {
                app_handle: app_handle.clone(),
            } // Create a temporary LlmCore instance
            .run_openai_llm_completion_tokens(
                &model_id,
                system,
                prompt,
                tool_definitions,
                max_tokens.or(max_completion_tokens),
            )
            .await;
        }

        let messages = build_messages()?;

        let final_max_tokens = max_tokens.or(max_completion_tokens).unwrap_or(4096) as u16;

        let request = if tool_definitions.is_empty() {
            CreateChatCompletionRequestArgs::default()
                .model(&model_id)
                .messages(messages)
                .max_tokens(final_max_tokens)
                .build()
        } else {
            let tools_parsed: Vec<ChatCompletionTools> = tool_definitions
                .iter()
                .filter_map(|def| {
                    if let Ok(t) = serde_json::from_value::<ChatCompletionTool>(def.clone()) {
                        Some(ChatCompletionTools::Function(t))
                    } else {
                        let mut tc_def = def.clone();
                        if tc_def.get("type").is_none() && tc_def.get("function").is_some() {
                            tc_def["type"] = serde_json::json!("function");
                            if let Ok(t) = serde_json::from_value::<ChatCompletionTool>(tc_def) {
                                return Some(ChatCompletionTools::Function(t));
                            }
                        }
                        None
                    }
                })
                .collect();

            CreateChatCompletionRequestArgs::default()
                .model(&model_id)
                .messages(messages)
                .max_tokens(final_max_tokens)
                .tools(tools_parsed)
                .build()
        };

        let req = request.map_err(|e: async_openai::error::OpenAIError| e.to_string())?;
        let response = client
            .chat()
            .create(req)
            .await
            .map_err(|e: async_openai::error::OpenAIError| e.to_string())?;

        if let Some(choice) = response.choices.first() {
            if let Some(tool_calls) = &choice.message.tool_calls {
                if let Some(async_openai::types::chat::ChatCompletionMessageToolCalls::Function(
                    first_call,
                )) = tool_calls.first()
                {
                    let json_call = json!([{
                        "function": {
                            "name": first_call.function.name,
                            "arguments": first_call.function.arguments
                        }
                    }]);
                    return Ok(json!(format!("TOOL_CALL:{}", json_call)));
                }
            }
            Ok(json!(choice.message.content.clone().unwrap_or_default()))
        } else {
            Err("No choices returned".to_string())
        }
    }

    async fn run_openai_compatible_llm(
        &self,
        endpoint: &str,
        api_key: Option<String>,
        model_id: &str,
        system_content: &str,
        prompt: &str,
        tool_defs: &[Value],
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    ) -> Result<Value, String> {
        let mut body = json!({
            "model": model_id,
            "messages": [
                { "role": "system", "content": system_content },
                { "role": "user", "content": prompt }
            ],
            "stream": false
        });

        let final_max_tokens = max_tokens.or(max_completion_tokens).unwrap_or(4096) as u32;
        if crate::llm_core::types::is_reasoning_model(model_id) {
            body["max_completion_tokens"] = json!(final_max_tokens);
        } else {
            body["max_tokens"] = json!(final_max_tokens);
        }

        if !tool_defs.is_empty() {
            body["tools"] = Value::Array(tool_defs.to_vec());
            body["tool_choice"] = json!("auto");
        }

        let mut req = reqwest::Client::new()
            .post(endpoint)
            .header("Content-Type", "application/json");
        if let Some(key) = api_key {
            req = req.header("Authorization", format!("Bearer {}", key));
        }

        let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("LLM API error {}: {}", status, text));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        Self::parse_openai_like_response(&json)
    }

    async fn run_ollama_llm(
        &self,
        model_id: &str,
        system_content: &str,
        prompt: &str,
        tool_defs: &[Value],
        max_tokens: Option<usize>,
        max_completion_tokens: Option<usize>,
    ) -> Result<Value, String> {
        let endpoint = crate::settings::get_ollama_endpoint(&self.app_handle)
            .ok_or_else(|| "Ollama endpoint not configured".to_string())?;

        if !tool_defs.is_empty() {
            // Prefer OpenAI-compatible Ollama endpoint when tools are available.
            let compat = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));
            if let Ok(v) = self
                .run_openai_compatible_llm(
                    &compat,
                    None,
                    model_id,
                    system_content,
                    prompt,
                    tool_defs,
                    max_tokens,
                    max_completion_tokens,
                )
                .await
            {
                return Ok(v);
            }

            // Fallback to OpenAI when Ollama tool calling is not available.
            if crate::settings::get_openai_api_key(&self.app_handle).is_some() {
                return Self::run_openai_llm(
                    &self.app_handle,
                    system_content,
                    prompt,
                    tool_defs,
                    Some(&"gpt-4o".to_string()),
                    None,
                    None,
                )
                .await;
            }

            return Err(
                "Ollama tool calling is not available and OpenAI fallback is not configured"
                    .to_string(),
            );
        }

        let body = json!({
            "model": model_id,
            "stream": false,
            "messages": [
                { "role": "system", "content": system_content },
                { "role": "user", "content": prompt }
            ]
        });

        let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));
        let resp = reqwest::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Ollama API error: {}", resp.status()));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        let content = json
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        Ok(json!(content))
    }

    async fn run_anthropic_llm(
        &self,
        model_id: &str,
        system_content: &str,
        prompt: &str,
        tool_defs: &[Value],
        max_tokens: Option<usize>,
    ) -> Result<Value, String> {
        let api_key = crate::settings::get_anthropic_api_key(&self.app_handle)
            .ok_or_else(|| "Anthropic API key not set".to_string())?;

        let anthropic_tools: Vec<Value> = tool_defs
            .iter()
            .filter_map(|t| {
                let f = t.get("function")?;
                let name = f.get("name")?.as_str()?;
                Some(json!({
                    "name": name,
                    "description": f.get("description").and_then(Value::as_str).unwrap_or(""),
                    "input_schema": f
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({"type":"object","properties":{}})),
                }))
            })
            .collect();

        let mut body = json!({
            "model": model_id,
            "max_tokens": max_tokens.unwrap_or(4096) as u32,
            "system": system_content,
            "messages": [
                { "role": "user", "content": prompt }
            ]
        });

        if !anthropic_tools.is_empty() {
            body["tools"] = Value::Array(anthropic_tools);
            body["tool_choice"] = json!({"type": "auto"});
        }

        let resp = reqwest::Client::new()
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {}: {}", status, text));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        Self::parse_anthropic_response(&json)
    }

    async fn run_gemini_llm(
        &self,
        model_id: &str,
        system_content: &str,
        prompt: &str,
        tool_defs: &[Value],
        _max_tokens: Option<usize>,
    ) -> Result<Value, String> {
        let api_key = crate::settings::get_gemini_api_key(&self.app_handle)
            .ok_or_else(|| "Gemini API key not set".to_string())?;

        let mut body = json!({
            "systemInstruction": {
                "parts": [{"text": system_content}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}]
                }
            ]
        });

        let function_declarations: Vec<Value> = tool_defs
            .iter()
            .filter_map(|t| {
                let f = t.get("function")?;
                Some(json!({
                    "name": f.get("name").and_then(Value::as_str).unwrap_or(""),
                    "description": f.get("description").and_then(Value::as_str).unwrap_or(""),
                    "parameters": f
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({"type":"object","properties":{}})),
                }))
            })
            .filter(|v| {
                v.get("name")
                    .and_then(Value::as_str)
                    .map(|s| !s.is_empty())
                    .unwrap_or(false)
            })
            .collect();

        if !function_declarations.is_empty() {
            body["tools"] = json!([{
                "functionDeclarations": function_declarations
            }]);
            body["toolConfig"] = json!({
                "functionCallingConfig": {
                    "mode": "AUTO"
                }
            });
        }

        let endpoint = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model_id, api_key
        );

        let resp = reqwest::Client::new()
            .post(endpoint)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Gemini API error {}: {}", status, text));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        Self::parse_gemini_response(&json)
    }

    fn parse_openai_like_response(json: &Value) -> Result<Value, String> {
        let message = json
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .ok_or_else(|| "No message in response".to_string())?;

        if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
            let calls: Vec<Value> = tool_calls
                .iter()
                .filter_map(|call| {
                    let function = call.get("function")?;
                    let name = function.get("name").and_then(Value::as_str)?;
                    let args_val = function
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let args = if let Some(s) = args_val.as_str() {
                        s.to_string()
                    } else {
                        args_val.to_string()
                    };
                    Some(json!({
                        "function": { "name": name, "arguments": args }
                    }))
                })
                .collect();

            if !calls.is_empty() {
                return Ok(json!(format!("TOOL_CALL:{}", Value::Array(calls))));
            }
        }

        if let Some(fc) = message.get("function_call") {
            let name = fc.get("name").and_then(Value::as_str).unwrap_or("");
            let args = fc
                .get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}")
                .to_string();
            if !name.is_empty() {
                let json_call = json!([{
                    "function": { "name": name, "arguments": args }
                }]);
                return Ok(json!(format!("TOOL_CALL:{}", json_call)));
            }
        }

        let content = message.get("content").and_then(Value::as_str).unwrap_or("");
        Ok(json!(content))
    }

    fn parse_anthropic_response(json: &Value) -> Result<Value, String> {
        let content = json
            .get("content")
            .and_then(Value::as_array)
            .ok_or_else(|| "Invalid Anthropic response".to_string())?;

        let mut calls = Vec::new();
        let mut texts = Vec::new();

        for part in content {
            match part.get("type").and_then(Value::as_str).unwrap_or("") {
                "tool_use" => {
                    if let Some(name) = part.get("name").and_then(Value::as_str) {
                        let args_val = part.get("input").cloned().unwrap_or_else(|| json!({}));
                        let args = if let Some(s) = args_val.as_str() {
                            s.to_string()
                        } else {
                            args_val.to_string()
                        };
                        calls.push(json!({
                            "function": { "name": name, "arguments": args }
                        }));
                    }
                }
                "text" => {
                    if let Some(t) = part.get("text").and_then(Value::as_str) {
                        if !t.trim().is_empty() {
                            texts.push(t.trim().to_string());
                        }
                    }
                }
                _ => {}
            }
        }

        if !calls.is_empty() {
            return Ok(json!(format!("TOOL_CALL:{}", Value::Array(calls))));
        }

        Ok(json!(texts.join("\n")))
    }

    fn parse_gemini_response(json: &Value) -> Result<Value, String> {
        let parts = json
            .get("candidates")
            .and_then(|v| v.get(0))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.get("parts"))
            .and_then(Value::as_array)
            .ok_or_else(|| "Invalid Gemini response".to_string())?;

        let mut calls = Vec::new();
        let mut texts = Vec::new();

        for part in parts {
            if let Some(fc) = part.get("functionCall") {
                let name = fc.get("name").and_then(Value::as_str).unwrap_or("");
                if !name.is_empty() {
                    let args_val = fc.get("args").cloned().unwrap_or_else(|| json!({}));
                    let args = if let Some(s) = args_val.as_str() {
                        s.to_string()
                    } else {
                        args_val.to_string()
                    };
                    calls.push(json!({
                        "function": { "name": name, "arguments": args }
                    }));
                }
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    texts.push(text.trim().to_string());
                }
            }
        }

        if !calls.is_empty() {
            return Ok(json!(format!("TOOL_CALL:{}", Value::Array(calls))));
        }

        Ok(json!(texts.join("\n")))
    }

    pub async fn run_groq_llm(
        &self,
        app_handle: &AppHandle,
        system: &str,
        prompt: &str,
        model: Option<&String>,
        max_tokens: Option<usize>,
    ) -> Result<serde_json::Value, String> {
        let api_key = crate::settings::get_groq_api_key(app_handle)
            .ok_or_else(|| "Groq API key not set".to_string())?;

        let model_id = model
            .map(|s| s.to_string())
            .unwrap_or_else(|| "llama3-70b-8192".to_string());
        let messages = vec![
            json!({"role": "system", "content": system}),
            json!({"role": "user", "content": prompt}),
        ];

        let mut body = json!({
            "model": model_id,
            "messages": messages,
        });

        let final_max_tokens = max_tokens.unwrap_or(4096) as u32;
        if crate::llm_core::types::is_reasoning_model(&model_id) {
            body["max_completion_tokens"] = json!(final_max_tokens);
        } else {
            body["max_tokens"] = json!(final_max_tokens);
        }

        let resp = reqwest::Client::new()
            .post("https://api.groq.com/openai/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Groq API error {}: {}", status, text));
        }

        let json: Value = resp.json().await.map_err(|e| e.to_string())?;
        Self::parse_openai_like_response(&json)
    }
}
