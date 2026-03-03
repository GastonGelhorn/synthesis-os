use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Shared error type for LLM operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LlmError {
    MissingApiKey { provider: String },
    RequestFailed { provider: String, status: String },
    ParseError { reason: String },
    ProviderError { provider: String, message: String },
    InvalidConfiguration { reason: String },
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::MissingApiKey { provider } => {
                write!(f, "{} API key not set", provider)
            }
            LlmError::RequestFailed { provider, status } => {
                write!(f, "{} request failed: {}", provider, status)
            }
            LlmError::ParseError { reason } => {
                write!(f, "Failed to parse response: {}", reason)
            }
            LlmError::ProviderError { provider, message } => {
                write!(f, "{} error: {}", provider, message)
            }
            LlmError::InvalidConfiguration { reason } => {
                write!(f, "Invalid configuration: {}", reason)
            }
        }
    }
}

impl From<LlmError> for String {
    fn from(err: LlmError) -> Self {
        err.to_string()
    }
}

/// Represents a single chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatMessage {
    Text {
        role: String,
        content: String,
    },
    WithToolUse {
        role: String,
        content: serde_json::Value,
    },
}

/// Tool definition for function calling / tool use
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Request to send to an LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub system: Option<String>,
    pub tools: Vec<ToolDefinition>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    /// Some models (o1, o3, gpt-5) use max_completion_tokens instead
    pub max_completion_tokens: Option<u32>,
    /// Reasoning effort (low, medium, high)
    pub reasoning_effort: Option<String>,
    /// Reasoning summary detail (detailed)
    pub reasoning_summary: Option<String>,
    /// Fields to include in the response (e.g. reasoning.encrypted_content)
    pub include: Option<Vec<String>>,
    /// Whether to allow parallel tool calls
    pub parallel_tool_calls: Option<bool>,
    /// Tool choice strategy
    pub tool_choice: Option<String>,
}

/// Response from an LLM provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    /// The text content from the LLM (or empty if tool was called)
    pub content: String,
    /// If a tool was invoked, this contains the tool call information
    pub tool_call: Option<ToolCallResult>,
    /// Provider-specific metadata
    #[serde(skip)]
    pub metadata: HashMap<String, String>,
}

/// Represents a tool call made by the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub tool_name: String,
    pub tool_arguments: String, // JSON string
}

impl LlmResponse {
    /// Returns true if this response contains a tool call
    pub fn has_tool_call(&self) -> bool {
        self.tool_call.is_some()
    }

    /// Converts response to the format used by the agent:
    /// - If tool was called: "TOOL_CALL:<json>"
    /// - Otherwise: plain text content
    pub fn to_agent_format(&self) -> String {
        if let Some(tool_call) = &self.tool_call {
            let tool_json = serde_json::json!([{
                "function": {
                    "name": tool_call.tool_name,
                    "arguments": tool_call.tool_arguments
                }
            }]);
            format!("TOOL_CALL:{}", tool_json)
        } else {
            self.content.clone()
        }
    }

    /// Returns as serde_json::Value for compatibility with existing code
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::json!(self.to_agent_format())
    }
}

/// Detects if a model is a reasoning model that requires special handling
pub fn is_reasoning_model(model_id: &str) -> bool {
    let lower = model_id.to_lowercase();
    lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
        || lower.starts_with("gpt-5")
        || lower.contains("deepseek-r1")
        || lower.contains("deepseek-v3")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_reasoning_model() {
        assert!(is_reasoning_model("o1"));
        assert!(is_reasoning_model("o1-mini"));
        assert!(is_reasoning_model("o3-mini"));
        assert!(is_reasoning_model("gpt-5"));
        assert!(is_reasoning_model("deepseek-r1"));
        assert!(!is_reasoning_model("gpt-4"));
        assert!(!is_reasoning_model("gpt-4o"));
    }

    #[test]
    fn test_response_to_agent_format() {
        let resp = LlmResponse {
            content: "Hello world".to_string(),
            tool_call: None,
            metadata: Default::default(),
        };
        assert_eq!(resp.to_agent_format(), "Hello world");

        let resp_with_tool = LlmResponse {
            content: String::new(),
            tool_call: Some(ToolCallResult {
                tool_name: "test_tool".to_string(),
                tool_arguments: r#"{"key": "value"}"#.to_string(),
            }),
            metadata: Default::default(),
        };
        assert!(resp_with_tool.to_agent_format().starts_with("TOOL_CALL:"));
    }
}
