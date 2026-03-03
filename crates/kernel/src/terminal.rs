use crate::syscall::{Priority, Syscall};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

/// Output from a semantic terminal command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub success: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

/// Parsed terminal command
#[derive(Debug, Clone)]
pub enum TerminalCommand {
    CreateFile { path: String, content: String },
    ReadFile { path: String },
    ListFiles { path: String },
    DeleteFile { path: String },
    SearchFiles { query: String },
    ShowVersions { path: String },
    Rollback { path: String, version: usize },
    ShareFile { path: String, agent_id: String },
    Help,
    Unknown { raw_input: String },
}

/// Semantic Terminal: Translates natural language commands to storage/system operations
pub struct SemanticTerminal {
    syscall_tx: mpsc::Sender<Syscall>,
}

impl SemanticTerminal {
    /// Create a new semantic terminal
    pub fn new(syscall_tx: mpsc::Sender<Syscall>) -> Self {
        Self { syscall_tx }
    }

    /// Execute a semantic command
    pub async fn execute(&self, agent_id: &str, command: &str) -> Result<TerminalOutput, String> {
        let parsed = Self::parse_command(command);

        match parsed {
            TerminalCommand::CreateFile { path, content } => {
                self.handle_create_file(agent_id, &path, &content).await
            }
            TerminalCommand::ReadFile { path } => self.handle_read_file(agent_id, &path).await,
            TerminalCommand::ListFiles { path } => self.handle_list_files(agent_id, &path).await,
            TerminalCommand::DeleteFile { path } => self.handle_delete_file(agent_id, &path).await,
            TerminalCommand::SearchFiles { query } => {
                self.handle_search_files(agent_id, &query).await
            }
            TerminalCommand::ShowVersions { path } => {
                self.handle_show_versions(agent_id, &path).await
            }
            TerminalCommand::Rollback { path, version } => {
                self.handle_rollback(agent_id, &path, version).await
            }
            TerminalCommand::ShareFile {
                path,
                agent_id: target_agent,
            } => self.handle_share_file(agent_id, &path, &target_agent).await,
            TerminalCommand::Help => Ok(Self::help()),
            TerminalCommand::Unknown { raw_input } => {
                // For unknown commands, use LLM to interpret
                self.interpret_with_llm(agent_id, &raw_input).await
            }
        }
    }

    /// Parse natural language into a TerminalCommand
    pub fn parse_command(input: &str) -> TerminalCommand {
        let lower = input.to_lowercase();

        // Create file pattern: "create file X with content Y"
        if let Ok(re) = Regex::new(r#"create\s+file\s+['"]?([^'"]+)['"]?\s+with\s+content\s+(.+)"#)
        {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                let content = caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() {
                    return TerminalCommand::CreateFile { path, content };
                }
            }
        }

        // Read file pattern: "read file X"
        if let Ok(re) = Regex::new(r#"read\s+file\s+['"]?([^'"]+)['"]?"#) {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() {
                    return TerminalCommand::ReadFile { path };
                }
            }
        }

        // List files pattern: "list files in X"
        if let Ok(re) = Regex::new(r#"list\s+files\s+in\s+['"]?([^'"]+)['"]?"#) {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() {
                    return TerminalCommand::ListFiles { path };
                }
            }
        }

        // Delete file pattern: "delete file X"
        if let Ok(re) = Regex::new(r#"delete\s+file\s+['"]?([^'"]+)['"]?"#) {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() {
                    return TerminalCommand::DeleteFile { path };
                }
            }
        }

        // Search pattern: "search for X" or "find X"
        if let Ok(re) = Regex::new(r#"(?:search\s+for|find)\s+['"]?([^'"]+)['"]?"#) {
            if let Some(caps) = re.captures(&lower) {
                let query = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !query.is_empty() {
                    return TerminalCommand::SearchFiles { query };
                }
            }
        }

        // Version history pattern: "show version history of X" or "versions of X"
        if let Ok(re) =
            Regex::new(r#"(?:show\s+)?version\s+(?:history\s+)?of\s+['"]?([^'"]+)['"]?"#)
        {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() {
                    return TerminalCommand::ShowVersions { path };
                }
            }
        }

        // Rollback pattern: "rollback X to version N"
        if let Ok(re) = Regex::new(r#"rollback\s+['"]?([^'"]+)['"]?\s+to\s+version\s+(\d+)"#) {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                let version = caps
                    .get(2)
                    .and_then(|m| m.as_str().parse::<usize>().ok())
                    .unwrap_or(0);
                if !path.is_empty() && version > 0 {
                    return TerminalCommand::Rollback { path, version };
                }
            }
        }

        // Share pattern: "share X with agent Y"
        if let Ok(re) =
            Regex::new(r#"share\s+['"]?([^'"]+)['"]?\s+with\s+agent\s+['"]?([^'"]+)['"]?"#)
        {
            if let Some(caps) = re.captures(&lower) {
                let path = caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
                let agent_id = caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                if !path.is_empty() && !agent_id.is_empty() {
                    return TerminalCommand::ShareFile { path, agent_id };
                }
            }
        }

        // Help pattern
        if lower.contains("help") || lower == "?" {
            return TerminalCommand::Help;
        }

        // Unknown command
        TerminalCommand::Unknown {
            raw_input: input.to_string(),
        }
    }

    /// Handle: create file X with content Y
    async fn handle_create_file(
        &self,
        agent_id: &str,
        path: &str,
        content: &str,
    ) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageWrite {
                agent_id: agent_id.to_string(),
                path: path.to_string(),
                data: content.to_string(),
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send storage write syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(_) => Ok(TerminalOutput {
                    success: true,
                    message: format!("File created at {}", path),
                    data: Some(json!({"path": path})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Failed to create file: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Storage syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: read file X
    async fn handle_read_file(&self, agent_id: &str, path: &str) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageRead {
                agent_id: agent_id.to_string(),
                path: path.to_string(),
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send storage read syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(content) => Ok(TerminalOutput {
                    success: true,
                    message: format!("File read from {}", path),
                    data: Some(json!({"path": path, "content": content})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Failed to read file: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Storage syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: list files in X
    async fn handle_list_files(
        &self,
        agent_id: &str,
        path: &str,
    ) -> Result<TerminalOutput, String> {
        // For listing, we can use a read syscall on the directory
        let list_path = format!("{}/.listing", path);
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageRead {
                agent_id: agent_id.to_string(),
                path: list_path,
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send list syscall: {}", e))?;

        match rx.await {
            Ok(resp) => {
                match resp.data {
                    Ok(listing) => Ok(TerminalOutput {
                        success: true,
                        message: format!("Files listed from {}", path),
                        data: Some(json!({"path": path, "files": listing})),
                    }),
                    Err(_e) => {
                        // Directory might not exist, return empty list
                        Ok(TerminalOutput {
                            success: true,
                            message: format!("Directory {} is empty or does not exist", path),
                            data: Some(json!({"path": path, "files": []})),
                        })
                    }
                }
            }
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Storage syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: delete file X
    async fn handle_delete_file(
        &self,
        agent_id: &str,
        path: &str,
    ) -> Result<TerminalOutput, String> {
        // Delete is typically handled by writing empty content or a delete marker
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageWrite {
                agent_id: agent_id.to_string(),
                path: format!("{}/.deleted", path),
                data: "1".to_string(),
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send delete syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(_) => Ok(TerminalOutput {
                    success: true,
                    message: format!("File deleted: {}", path),
                    data: Some(json!({"path": path, "deleted": true})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Failed to delete file: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Storage syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: search for X
    async fn handle_search_files(
        &self,
        agent_id: &str,
        query: &str,
    ) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageRead {
                agent_id: agent_id.to_string(),
                path: format!("/search?q={}", query),
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send search syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(results) => Ok(TerminalOutput {
                    success: true,
                    message: format!("Search results for '{}'", query),
                    data: Some(json!({"query": query, "results": results})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Search failed: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Search syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: show version history of X
    async fn handle_show_versions(
        &self,
        agent_id: &str,
        path: &str,
    ) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::StorageRead {
                agent_id: agent_id.to_string(),
                path: format!("{}/.versions", path),
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send versions syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(versions) => Ok(TerminalOutput {
                    success: true,
                    message: format!("Version history for {}", path),
                    data: Some(json!({"path": path, "versions": versions})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("No version history found: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Versions syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: rollback X to version N
    async fn handle_rollback(
        &self,
        agent_id: &str,
        path: &str,
        version: usize,
    ) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        let rollback_data = serde_json::json!({
            "action": "rollback",
            "version": version
        })
        .to_string();

        self.syscall_tx
            .send(Syscall::StorageWrite {
                agent_id: agent_id.to_string(),
                path: format!("{}/.rollback", path),
                data: rollback_data,
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send rollback syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(_) => Ok(TerminalOutput {
                    success: true,
                    message: format!("Rolled back {} to version {}", path, version),
                    data: Some(json!({"path": path, "version": version})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Rollback failed: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Rollback syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Handle: share X with agent Y
    async fn handle_share_file(
        &self,
        agent_id: &str,
        path: &str,
        target_agent: &str,
    ) -> Result<TerminalOutput, String> {
        let (tx, rx) = oneshot::channel();
        let share_data = serde_json::json!({
            "action": "share",
            "target_agent": target_agent
        })
        .to_string();

        self.syscall_tx
            .send(Syscall::StorageWrite {
                agent_id: agent_id.to_string(),
                path: format!("{}/.share", path),
                data: share_data,
                response_tx: tx,
            })
            .await
            .map_err(|e| format!("Failed to send share syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(_) => Ok(TerminalOutput {
                    success: true,
                    message: format!("Shared {} with agent {}", path, target_agent),
                    data: Some(json!({"path": path, "shared_with": target_agent})),
                }),
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("Share failed: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "Share syscall timeout".to_string(),
                data: None,
            }),
        }
    }

    /// For unknown commands, use LLM to interpret the intent
    async fn interpret_with_llm(
        &self,
        agent_id: &str,
        raw_input: &str,
    ) -> Result<TerminalOutput, String> {
        let interpretation_prompt = format!(
            "Interpret this natural language command and determine which file operation it represents:\n\n\
            Command: {}\n\n\
            Respond with one of:\n\
            - 'read <path>'\n\
            - 'create <path> with <content>'\n\
            - 'delete <path>'\n\
            - 'list <path>'\n\
            - 'search <query>'\n\
            - 'version <path>'\n\
            - 'unknown' if you can't determine",
            raw_input
        );

        let (tx, rx) = oneshot::channel();
        self.syscall_tx
            .send(Syscall::LlmRequest {
                agent_id: agent_id.to_string(),
                priority: Priority::Normal,
                prompt: interpretation_prompt,
                response_tx: tx,
                system_prompt: Some(
                    "You are a command interpreter. Respond concisely with the interpreted command."
                        .to_string(),
                ),
                tool_definitions: None,
                model: None,
                stream: false,
                max_tokens: None,
                max_completion_tokens: None,
            })
            .await
            .map_err(|e| format!("Failed to send LLM syscall: {}", e))?;

        match rx.await {
            Ok(resp) => match resp.data {
                Ok(val) => {
                    let interpretation = val
                        .as_str()
                        .map(|s| s.to_string())
                        .or_else(|| Some(val.to_string()))
                        .unwrap_or_else(|| "unknown".to_string());
                    Ok(TerminalOutput {
                        success: true,
                        message: format!("Interpreted command: {}", interpretation),
                        data: Some(json!({
                            "original": raw_input,
                            "interpreted": interpretation
                        })),
                    })
                }
                Err(e) => Ok(TerminalOutput {
                    success: false,
                    message: format!("LLM interpretation failed: {}", e),
                    data: None,
                }),
            },
            Err(_) => Ok(TerminalOutput {
                success: false,
                message: "LLM interpretation timeout".to_string(),
                data: None,
            }),
        }
    }

    /// Return help text
    fn help() -> TerminalOutput {
        TerminalOutput {
            success: true,
            message: "Semantic Terminal Help".to_string(),
            data: Some(json!({
                "commands": [
                    {
                        "pattern": "create file <path> with content <text>",
                        "description": "Create or overwrite a file with the given content",
                        "example": "create file /data/config.json with content {\"mode\": \"production\"}"
                    },
                    {
                        "pattern": "read file <path>",
                        "description": "Read and display the contents of a file",
                        "example": "read file /data/config.json"
                    },
                    {
                        "pattern": "list files in <path>",
                        "description": "List all files in a directory",
                        "example": "list files in /data"
                    },
                    {
                        "pattern": "delete file <path>",
                        "description": "Delete a file",
                        "example": "delete file /data/old.txt"
                    },
                    {
                        "pattern": "search for <query>",
                        "description": "Search for files matching a query",
                        "example": "search for *.log"
                    },
                    {
                        "pattern": "show version history of <path>",
                        "description": "Display version history of a file",
                        "example": "show version history of /data/config.json"
                    },
                    {
                        "pattern": "rollback <path> to version <n>",
                        "description": "Restore a file to a previous version",
                        "example": "rollback /data/config.json to version 3"
                    },
                    {
                        "pattern": "share <path> with agent <agent_id>",
                        "description": "Grant another agent access to a file",
                        "example": "share /data/results.txt with agent worker-1"
                    }
                ]
            })),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_create_file_command() {
        let cmd =
            SemanticTerminal::parse_command("create file /tmp/test.txt with content hello world");
        match cmd {
            TerminalCommand::CreateFile { path, content } => {
                assert!(path.contains("test.txt"));
                assert!(content.contains("hello"));
            }
            _ => panic!("Failed to parse create file command"),
        }
    }

    #[test]
    fn test_parse_read_file_command() {
        let cmd = SemanticTerminal::parse_command("read file /tmp/test.txt");
        match cmd {
            TerminalCommand::ReadFile { path } => {
                assert!(path.contains("test.txt"));
            }
            _ => panic!("Failed to parse read file command"),
        }
    }

    #[test]
    fn test_parse_list_files_command() {
        let cmd = SemanticTerminal::parse_command("list files in /tmp");
        match cmd {
            TerminalCommand::ListFiles { path } => {
                assert_eq!(path, "/tmp");
            }
            _ => panic!("Failed to parse list files command"),
        }
    }

    #[test]
    fn test_parse_delete_file_command() {
        let cmd = SemanticTerminal::parse_command("delete file /tmp/old.txt");
        match cmd {
            TerminalCommand::DeleteFile { path } => {
                assert!(path.contains("old.txt"));
            }
            _ => panic!("Failed to parse delete file command"),
        }
    }

    #[test]
    fn test_parse_search_command() {
        let cmd = SemanticTerminal::parse_command("search for *.log");
        match cmd {
            TerminalCommand::SearchFiles { query } => {
                assert!(query.contains(".log"));
            }
            _ => panic!("Failed to parse search command"),
        }
    }

    #[test]
    fn test_parse_versions_command() {
        let cmd = SemanticTerminal::parse_command("show version history of /tmp/test.txt");
        match cmd {
            TerminalCommand::ShowVersions { path } => {
                assert!(path.contains("test.txt"));
            }
            _ => panic!("Failed to parse versions command"),
        }
    }

    #[test]
    fn test_parse_rollback_command() {
        let cmd = SemanticTerminal::parse_command("rollback /tmp/test.txt to version 5");
        match cmd {
            TerminalCommand::Rollback { path, version } => {
                assert!(path.contains("test.txt"));
                assert_eq!(version, 5);
            }
            _ => panic!("Failed to parse rollback command"),
        }
    }

    #[test]
    fn test_parse_share_command() {
        let cmd = SemanticTerminal::parse_command("share /tmp/file.txt with agent worker-1");
        match cmd {
            TerminalCommand::ShareFile { path, agent_id } => {
                assert!(path.contains("file.txt"));
                assert!(agent_id.contains("worker"));
            }
            _ => panic!("Failed to parse share command"),
        }
    }

    #[test]
    fn test_parse_help_command() {
        let cmd = SemanticTerminal::parse_command("help");
        match cmd {
            TerminalCommand::Help => {}
            _ => panic!("Failed to parse help command"),
        }
    }

    #[test]
    fn test_parse_unknown_command() {
        let cmd = SemanticTerminal::parse_command("do something unusual");
        match cmd {
            TerminalCommand::Unknown { raw_input } => {
                assert!(raw_input.contains("unusual"));
            }
            _ => panic!("Failed to parse unknown command"),
        }
    }

    #[test]
    fn test_terminal_output_serialization() {
        let output = TerminalOutput {
            success: true,
            message: "Test message".to_string(),
            data: Some(json!({"test": "data"})),
        };

        let serialized = serde_json::to_string(&output).unwrap();
        assert!(serialized.contains("Test message"));
    }
}
