use crate::llm_core::types::{
    is_reasoning_model, LlmError, LlmRequest, LlmResponse, ToolCallResult,
};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

/// Trait that all LLM backends must implement
pub trait LlmBackend: Send + Sync {
    /// Execute an LLM request and return the response
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>>;

    /// Get the provider name (for logging/debugging)
    fn provider_name(&self) -> &str;
}

/// OpenAI backend (including compatible services like OpenAI-compatible Ollama)
pub struct OpenAiBackend {
    client: Arc<reqwest::Client>,
    api_key: String,
    base_url: Option<String>,
}

impl OpenAiBackend {
    pub fn new(client: Arc<reqwest::Client>, api_key: String, base_url: Option<String>) -> Self {
        Self {
            client,
            api_key,
            base_url,
        }
    }
}

impl LlmBackend for OpenAiBackend {
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        Box::pin(async move {
            let base_url = base_url.as_deref().unwrap_or("https://api.openai.com/v1");
            let url = format!("{}/chat/completions", base_url);

            // Build messages array
            let mut messages = Vec::new();

            // Add system message if provided
            if let Some(system) = &request.system {
                messages.push(serde_json::json!({
                    "role": "system",
                    "content": system
                }));
            }

            // Add request messages (simplified for JSON serialization)
            for msg in &request.messages {
                messages.push(serde_json::json!({
                    "role": msg.role(),
                    "content": msg.content_text()
                }));
            }

            // Build request body
            let mut body = serde_json::json!({
                "model": &request.model,
                "messages": messages,
            });

            // Add reasoning parameters if available
            if request.reasoning_effort.is_some() || request.reasoning_summary.is_some() {
                let mut reasoning = serde_json::json!({});
                if let Some(effort) = &request.reasoning_effort {
                    reasoning["effort"] = serde_json::json!(effort);
                }
                if let Some(summary) = &request.reasoning_summary {
                    reasoning["summary"] = serde_json::json!(summary);
                }
                body["reasoning"] = reasoning;
            }

            // Add include fields if available
            if let Some(include) = &request.include {
                body["include"] = serde_json::json!(include);
            }

            // Add tool controls (only when tools are present - API rejects parallel_tool_calls without tools)
            if !request.tools.is_empty() {
                if let Some(parallel) = request.parallel_tool_calls {
                    body["parallel_tool_calls"] = serde_json::json!(parallel);
                }
                if let Some(choice) = &request.tool_choice {
                    body["tool_choice"] = serde_json::json!(choice);
                }
            }

            // Handle temperature and max_tokens
            if let Some(temp) = request.temperature {
                body["temperature"] = serde_json::json!(temp);
            }

            // Reasoning models use max_completion_tokens instead of max_tokens
            if is_reasoning_model(&request.model) {
                if let Some(max_tokens) = request.max_completion_tokens.or(request.max_tokens) {
                    body["max_completion_tokens"] = serde_json::json!(max_tokens);
                }
            } else {
                if let Some(max_tokens) = request.max_tokens.or(request.max_completion_tokens) {
                    body["max_tokens"] = serde_json::json!(max_tokens);
                }
            }

            // Add tools if provided
            if !request.tools.is_empty() {
                let functions: Vec<serde_json::Value> = request
                    .tools
                    .iter()
                    .map(|tool| {
                        serde_json::json!({
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema
                        })
                    })
                    .collect();
                body["functions"] = serde_json::Value::Array(functions);
                body["function_call"] = serde_json::json!("auto");
            }

            let response = client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| LlmError::RequestFailed {
                    provider: "openai".to_string(),
                    status: e.to_string(),
                })?;

            if !response.status().is_success() {
                let status = response.status().to_string();
                let text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                return Err(LlmError::ProviderError {
                    provider: "openai".to_string(),
                    message: format!("{}: {}", status, text),
                });
            }

            let json: serde_json::Value =
                response.json().await.map_err(|e| LlmError::ParseError {
                    reason: e.to_string(),
                })?;

            let choice = json
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.as_object())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No choices in response".to_string(),
                })?;

            let message = choice
                .get("message")
                .and_then(|m| m.as_object())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No message in choice".to_string(),
                })?;

            // Check for function call
            if let Some(fc) = message.get("function_call") {
                if let (Some(name), Some(args)) = (
                    fc.get("name").and_then(|n| n.as_str()),
                    fc.get("arguments").and_then(|a| a.as_str()),
                ) {
                    return Ok(LlmResponse {
                        content: String::new(),
                        tool_call: Some(ToolCallResult {
                            tool_name: name.to_string(),
                            tool_arguments: args.to_string(),
                        }),
                        metadata: Default::default(),
                    });
                }
            }

            let content = message
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Ok(LlmResponse {
                content,
                tool_call: None,
                metadata: Default::default(),
            })
        })
    }

    fn provider_name(&self) -> &str {
        "openai"
    }
}

/// Anthropic backend
pub struct AnthropicBackend {
    client: Arc<reqwest::Client>,
    api_key: String,
}

impl AnthropicBackend {
    pub fn new(client: Arc<reqwest::Client>, api_key: String) -> Self {
        Self { client, api_key }
    }
}

impl LlmBackend for AnthropicBackend {
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        Box::pin(async move {
            let url = "https://api.anthropic.com/v1/messages";

            // Build messages array
            let mut messages = Vec::new();
            for msg in &request.messages {
                messages.push(serde_json::json!({
                    "role": msg.role(),
                    "content": msg.content_text()
                }));
            }

            let mut body = serde_json::json!({
                "model": &request.model,
                "messages": messages,
                "max_tokens": request.max_tokens.or(request.max_completion_tokens).unwrap_or(16384),
            });

            if let Some(system) = &request.system {
                body["system"] = serde_json::json!(system);
            }

            if let Some(temp) = request.temperature {
                body["temperature"] = serde_json::json!(temp);
            }

            // Anthropic uses tools differently than OpenAI
            if !request.tools.is_empty() {
                let tools: Vec<serde_json::Value> = request
                    .tools
                    .iter()
                    .map(|tool| {
                        serde_json::json!({
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.input_schema
                        })
                    })
                    .collect();
                body["tools"] = serde_json::Value::Array(tools);
            }

            let response = client
                .post(url)
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| LlmError::RequestFailed {
                    provider: "anthropic".to_string(),
                    status: e.to_string(),
                })?;

            if !response.status().is_success() {
                let status = response.status().to_string();
                let text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                return Err(LlmError::ProviderError {
                    provider: "anthropic".to_string(),
                    message: format!("{}: {}", status, text),
                });
            }

            let json: serde_json::Value =
                response.json().await.map_err(|e| LlmError::ParseError {
                    reason: e.to_string(),
                })?;

            // Parse Anthropic response
            let content = json
                .get("content")
                .and_then(|c| c.as_array())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No content array in Anthropic response".to_string(),
                })?;

            // Check for tool use
            for item in content {
                if let Some(tool_use) = item.as_object() {
                    if tool_use.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                        if let (Some(name), Some(input)) = (
                            tool_use.get("name").and_then(|n| n.as_str()),
                            tool_use.get("input"),
                        ) {
                            return Ok(LlmResponse {
                                content: String::new(),
                                tool_call: Some(ToolCallResult {
                                    tool_name: name.to_string(),
                                    tool_arguments: serde_json::to_string(&input)
                                        .unwrap_or_else(|_| "{}".to_string()),
                                }),
                                metadata: Default::default(),
                            });
                        }
                    }
                }
            }

            // Extract text content
            let mut text_content = String::new();
            for item in content {
                if let Some(text_item) = item.as_object() {
                    if text_item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = text_item.get("text").and_then(|t| t.as_str()) {
                            text_content.push_str(text);
                        }
                    }
                }
            }

            Ok(LlmResponse {
                content: text_content,
                tool_call: None,
                metadata: Default::default(),
            })
        })
    }

    fn provider_name(&self) -> &str {
        "anthropic"
    }
}

/// Groq backend (OpenAI-compatible endpoint)
pub struct GroqBackend {
    client: Arc<reqwest::Client>,
    api_key: String,
}

impl GroqBackend {
    pub fn new(client: Arc<reqwest::Client>, api_key: String) -> Self {
        Self { client, api_key }
    }
}

impl LlmBackend for GroqBackend {
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        Box::pin(async move {
            let url = "https://api.groq.com/openai/v1/chat/completions";

            // Groq uses OpenAI-compatible format
            let mut messages = Vec::new();

            if let Some(system) = &request.system {
                messages.push(serde_json::json!({
                    "role": "system",
                    "content": system
                }));
            }

            for msg in &request.messages {
                messages.push(serde_json::json!({
                    "role": msg.role(),
                    "content": msg.content_text()
                }));
            }

            let mut body = serde_json::json!({
                "model": &request.model,
                "messages": messages,
            });

            if let Some(temp) = request.temperature {
                body["temperature"] = serde_json::json!(temp);
            }

            if let Some(max_tokens) = request.max_tokens.or(request.max_completion_tokens) {
                body["max_tokens"] = serde_json::json!(max_tokens);
            }

            let response = client
                .post(url)
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| LlmError::RequestFailed {
                    provider: "groq".to_string(),
                    status: e.to_string(),
                })?;

            if !response.status().is_success() {
                let status = response.status().to_string();
                let text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                return Err(LlmError::ProviderError {
                    provider: "groq".to_string(),
                    message: format!("{}: {}", status, text),
                });
            }

            let json: serde_json::Value =
                response.json().await.map_err(|e| LlmError::ParseError {
                    reason: e.to_string(),
                })?;

            let choice = json
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|c| c.as_object())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No choices in Groq response".to_string(),
                })?;

            let message = choice
                .get("message")
                .and_then(|m| m.as_object())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No message in Groq choice".to_string(),
                })?;

            let content = message
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Ok(LlmResponse {
                content,
                tool_call: None,
                metadata: Default::default(),
            })
        })
    }

    fn provider_name(&self) -> &str {
        "groq"
    }
}

/// Google Gemini backend
pub struct GeminiBackend {
    client: Arc<reqwest::Client>,
    api_key: String,
}

impl GeminiBackend {
    pub fn new(client: Arc<reqwest::Client>, api_key: String) -> Self {
        Self { client, api_key }
    }
}

impl LlmBackend for GeminiBackend {
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>> {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        Box::pin(async move {
            let model = &request.model;
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key
            );

            // Convert messages to Gemini format (user/model only; system goes in systemInstruction)
            let mut contents = Vec::new();
            for msg in &request.messages {
                let role = match msg.role().as_str() {
                    "user" => "user",
                    "assistant" => "model",
                    "system" => continue, // System goes in systemInstruction, not contents
                    _ => "user",
                };
                contents.push(serde_json::json!({
                    "role": role,
                    "parts": [{ "text": msg.content_text() }]
                }));
            }

            let mut body = serde_json::json!({
                "contents": contents,
            });

            // System prompt as systemInstruction (native Gemini field), not as user message
            if let Some(system) = &request.system {
                body["systemInstruction"] = serde_json::json!({
                    "parts": [{ "text": system }]
                });
            }

            let mut generation_config = serde_json::json!({});
            if let Some(temp) = request.temperature {
                generation_config["temperature"] = serde_json::json!(temp);
            }
            if let Some(max_tokens) = request.max_tokens.or(request.max_completion_tokens) {
                generation_config["maxOutputTokens"] = serde_json::json!(max_tokens);
            }
            if !generation_config.as_object().map_or(true, |m| m.is_empty()) {
                body["generationConfig"] = generation_config;
            }

            let response = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| LlmError::RequestFailed {
                    provider: "gemini".to_string(),
                    status: e.to_string(),
                })?;

            if !response.status().is_success() {
                let status = response.status().to_string();
                let text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                return Err(LlmError::ProviderError {
                    provider: "gemini".to_string(),
                    message: format!("{}: {}", status, text),
                });
            }

            let json: serde_json::Value =
                response.json().await.map_err(|e| LlmError::ParseError {
                    reason: e.to_string(),
                })?;

            // Parse Gemini response
            let candidates = json
                .get("candidates")
                .and_then(|c| c.as_array())
                .ok_or_else(|| LlmError::ParseError {
                    reason: "No candidates in Gemini response".to_string(),
                })?;

            if candidates.is_empty() {
                return Err(LlmError::ParseError {
                    reason: "Empty candidates array from Gemini".to_string(),
                });
            }

            let candidate = &candidates[0];
            let content = candidate
                .get("content")
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.get(0))
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();

            Ok(LlmResponse {
                content,
                tool_call: None,
                metadata: Default::default(),
            })
        })
    }

    fn provider_name(&self) -> &str {
        "gemini"
    }
}

/// Ollama backend (local LLM)
pub struct OllamaBackend {
    client: Arc<reqwest::Client>,
    endpoint: String,
}

impl OllamaBackend {
    pub fn new(client: Arc<reqwest::Client>, endpoint: String) -> Self {
        Self { client, endpoint }
    }
}

impl LlmBackend for OllamaBackend {
    fn call(
        &self,
        request: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LlmResponse, LlmError>> + Send + '_>> {
        let client = self.client.clone();
        let endpoint = self.endpoint.clone();
        Box::pin(async move {
            let url = format!("{}/api/chat", endpoint);

            let mut messages = Vec::new();

            if let Some(system) = &request.system {
                messages.push(serde_json::json!({
                    "role": "system",
                    "content": system
                }));
            }

            for msg in &request.messages {
                messages.push(serde_json::json!({
                    "role": msg.role(),
                    "content": msg.content_text()
                }));
            }

            let body = serde_json::json!({
                "model": &request.model,
                "stream": false,
                "messages": messages,
            });

            let response = client.post(&url).json(&body).send().await.map_err(|e| {
                LlmError::RequestFailed {
                    provider: "ollama".to_string(),
                    status: e.to_string(),
                }
            })?;

            if !response.status().is_success() {
                let status = response.status().to_string();
                let text = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Unknown error".to_string());
                return Err(LlmError::ProviderError {
                    provider: "ollama".to_string(),
                    message: format!("{}: {}", status, text),
                });
            }

            let json: serde_json::Value =
                response.json().await.map_err(|e| LlmError::ParseError {
                    reason: e.to_string(),
                })?;

            let content = json
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Ok(LlmResponse {
                content,
                tool_call: None,
                metadata: Default::default(),
            })
        })
    }

    fn provider_name(&self) -> &str {
        "ollama"
    }
}

// Helper trait methods for ChatMessage
impl crate::llm_core::types::ChatMessage {
    pub fn role(&self) -> String {
        match self {
            Self::Text { role, .. } => role.clone(),
            Self::WithToolUse { role, .. } => role.clone(),
        }
    }

    pub fn content_text(&self) -> String {
        match self {
            Self::Text { content, .. } => content.clone(),
            Self::WithToolUse { content, .. } => {
                serde_json::to_string(&content).unwrap_or_default()
            }
        }
    }
}
