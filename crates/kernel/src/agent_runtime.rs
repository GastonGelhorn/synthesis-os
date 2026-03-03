use crate::syscall::{Priority, Syscall};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::sync::oneshot;

/// Execution strategy for agent loops
#[derive(Debug, Clone, Copy)]
pub enum AgentStrategy {
    ReAct,          // Reason → Act → Observe → Repeat
    PlanAndExecute, // Plan all steps first, then execute sequentially
    MultiAgent,     // Coordinator delegates to sub-agents
}

/// Result of a single agent step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub action: String, // "continue", "tool_call", "ask_user", "final_answer", or error message
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub final_answer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub args: String,
}

/// Shared agent state across strategies
#[derive(Debug, Clone)]
pub struct AgentState {
    pub agent_id: String,
    pub goal: String,
    pub observations: Vec<Observation>,
    pub step: usize,
    pub max_steps: usize,
    pub model: Option<String>,
    pub system_prompt: String,
    pub allowed_tools: Option<Vec<String>>,
    pub plan: Option<Vec<PlanStep>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub tool: String,
    pub input: String,
    pub result: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct PlanStep {
    pub description: String,
    pub tool: Option<String>,
    pub status: PlanStepStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanStepStatus {
    Pending,
    InProgress,
    Completed,
}

/// Final result of agent execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResult {
    pub final_answer: String,
    pub steps: Vec<(String, String, String)>, // (tool, input, result)
    pub total_steps: usize,
}

/// Trait for pluggable agent execution strategies
pub trait AgentExecutor: Send + Sync {
    /// Execute one step of the agent loop (returns a boxed future)
    fn execute_step<'a>(
        &'a self,
        state: &'a mut AgentState,
        syscall_tx: &'a mpsc::Sender<Syscall>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<StepResult, String>> + Send + 'a>>;

    /// Whether the agent should continue after this step
    fn should_continue(&self, state: &AgentState, step_result: &StepResult) -> bool;

    /// Strategy name for logging
    fn name(&self) -> &'static str;
}

/// ReAct executor: Reason → Act → Observe → Repeat
pub struct ReActExecutor;

impl AgentExecutor for ReActExecutor {
    fn execute_step<'a>(
        &'a self,
        state: &'a mut AgentState,
        syscall_tx: &'a mpsc::Sender<Syscall>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<StepResult, String>> + Send + 'a>>
    {
        Box::pin(async move {
            // Build prompt from current observations
            let observations_text = if state.observations.is_empty() {
                "No observations yet.".to_string()
            } else {
                state
                    .observations
                    .iter()
                    .map(|o| format!("Tool: {}, Args: {}, Result: {}", o.tool, o.input, o.result))
                    .collect::<Vec<_>>()
                    .join("\n")
            };

            let prompt = format!(
            "You are an AI agent solving: {}\n\nCurrent observations:\n{}\n\nStep {}/{}.\n\
            Decide what to do next:\n1. Call a tool with TOOL_CALL:[{{...}}] format\n2. Provide final answer with FINAL_ANSWER:...\n3. Ask user with ASK_USER:...",
            state.goal, observations_text, state.step, state.max_steps
        );

            // Call LLM
            let (llm_tx, llm_rx) = oneshot::channel();
            syscall_tx
                .send(Syscall::LlmRequest {
                    agent_id: state.agent_id.clone(),
                    priority: Priority::Normal,
                    prompt,
                    response_tx: llm_tx,
                    system_prompt: Some(state.system_prompt.clone()),
                    tool_definitions: None,
                    model: state.model.clone(),
                    stream: false,
                    max_tokens: None,
                    max_completion_tokens: None,
                })
                .await
                .map_err(|e| format!("Failed to send LLM syscall: {}", e))?;

            let response = llm_rx
                .await
                .map_err(|e| format!("LLM channel error: {}", e))?;

            let llm_text = match response.data {
                Ok(val) => val
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| Some(val.to_string()))
                    .unwrap_or_default(),
                Err(e) => return Err(format!("LLM error: {}", e)),
            };

            // Parse response
            if llm_text.starts_with("TOOL_CALL:") {
                match serde_json::from_str::<Vec<serde_json::Value>>(&llm_text[10..]) {
                    Ok(calls) => {
                        let mut tool_calls = Vec::new();
                        for call in calls {
                            if let (Some(name), Some(args)) = (
                                call.get("function")
                                    .and_then(|f| f.get("name"))
                                    .and_then(|n| n.as_str()),
                                call.get("function")
                                    .and_then(|f| f.get("arguments"))
                                    .and_then(|a| a.as_str()),
                            ) {
                                tool_calls.push(ToolCall {
                                    name: name.to_string(),
                                    args: args.to_string(),
                                });
                            }
                        }

                        Ok(StepResult {
                            action: "tool_call".to_string(),
                            reasoning: llm_text.clone(),
                            tool_calls,
                            final_answer: None,
                        })
                    }
                    Err(_) => Err("Failed to parse tool calls".to_string()),
                }
            } else if llm_text.starts_with("FINAL_ANSWER:") {
                let answer = llm_text[13..].to_string();
                Ok(StepResult {
                    action: "final_answer".to_string(),
                    reasoning: answer.clone(),
                    tool_calls: vec![],
                    final_answer: Some(answer),
                })
            } else if llm_text.starts_with("ASK_USER:") {
                Ok(StepResult {
                    action: "ask_user".to_string(),
                    reasoning: llm_text.clone(),
                    tool_calls: vec![],
                    final_answer: None,
                })
            } else {
                // Default to final answer if unclear
                Ok(StepResult {
                    action: "final_answer".to_string(),
                    reasoning: llm_text.clone(),
                    tool_calls: vec![],
                    final_answer: Some(llm_text),
                })
            }
        })
    }

    fn should_continue(&self, state: &AgentState, step_result: &StepResult) -> bool {
        step_result.action != "final_answer" && state.step < state.max_steps
    }

    fn name(&self) -> &'static str {
        "ReAct"
    }
}

/// Plan-and-Execute executor: Create plan first, then execute steps
pub struct PlanAndExecuteExecutor;

impl AgentExecutor for PlanAndExecuteExecutor {
    fn execute_step<'a>(
        &'a self,
        state: &'a mut AgentState,
        syscall_tx: &'a mpsc::Sender<Syscall>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<StepResult, String>> + Send + 'a>>
    {
        Box::pin(async move {
            // First step: generate plan
            if state.plan.is_none() {
                let plan_prompt = format!(
                "Create a detailed step-by-step plan to solve: {}\n\nRespond with PLAN:[step1|step2|step3|...]",
                state.goal
            );

                let (llm_tx, llm_rx) = oneshot::channel();
                syscall_tx
                    .send(Syscall::LlmRequest {
                        agent_id: state.agent_id.clone(),
                        priority: Priority::Normal,
                        prompt: plan_prompt,
                        response_tx: llm_tx,
                        system_prompt: Some(state.system_prompt.clone()),
                        tool_definitions: None,
                        model: state.model.clone(),
                        stream: false,
                        max_tokens: None,
                        max_completion_tokens: None,
                    })
                    .await
                    .map_err(|e| format!("Failed to send plan LLM syscall: {}", e))?;

                let response = llm_rx
                    .await
                    .map_err(|e| format!("Plan LLM channel error: {}", e))?;

                let llm_text = match response.data {
                    Ok(val) => val
                        .as_str()
                        .map(|s| s.to_string())
                        .or_else(|| Some(val.to_string()))
                        .unwrap_or_default(),
                    Err(e) => return Err(format!("Plan LLM error: {}", e)),
                };

                // Parse plan
                if llm_text.starts_with("PLAN:") {
                    let plan_text = &llm_text[5..];
                    let steps: Vec<PlanStep> = plan_text
                        .split('|')
                        .map(|desc| PlanStep {
                            description: desc.trim().to_string(),
                            tool: None,
                            status: PlanStepStatus::Pending,
                        })
                        .collect();

                    state.plan = Some(steps);
                }

                return Ok(StepResult {
                    action: "continue".to_string(),
                    reasoning: llm_text,
                    tool_calls: vec![],
                    final_answer: None,
                });
            }

            // Subsequent steps: execute next pending plan step
            if let Some(ref mut plan) = state.plan {
                if let Some(step) = plan
                    .iter_mut()
                    .find(|s| s.status == PlanStepStatus::Pending)
                {
                    step.status = PlanStepStatus::InProgress;

                    let exec_prompt = format!(
                    "Execute this step: {}\n\nGoal: {}\n\nRespond with TOOL_CALL:[...] or FINAL_ANSWER:...",
                    step.description, state.goal
                );

                    let (llm_tx, llm_rx) = oneshot::channel();
                    syscall_tx
                        .send(Syscall::LlmRequest {
                            agent_id: state.agent_id.clone(),
                            priority: Priority::Normal,
                            prompt: exec_prompt,
                            response_tx: llm_tx,
                            system_prompt: Some(state.system_prompt.clone()),
                            tool_definitions: None,
                            model: state.model.clone(),
                            stream: false,
                            max_tokens: None,
                            max_completion_tokens: None,
                        })
                        .await
                        .map_err(|e| format!("Failed to send step LLM syscall: {}", e))?;

                    let response = llm_rx
                        .await
                        .map_err(|e| format!("Step LLM channel error: {}", e))?;

                    let llm_text = match response.data {
                        Ok(val) => val
                            .as_str()
                            .map(|s| s.to_string())
                            .or_else(|| Some(val.to_string()))
                            .unwrap_or_default(),
                        Err(e) => return Err(format!("Step LLM error: {}", e)),
                    };

                    step.status = PlanStepStatus::Completed;

                    if llm_text.starts_with("TOOL_CALL:") {
                        match serde_json::from_str::<Vec<serde_json::Value>>(&llm_text[10..]) {
                            Ok(calls) => {
                                let mut tool_calls = Vec::new();
                                for call in calls {
                                    if let (Some(name), Some(args)) = (
                                        call.get("function")
                                            .and_then(|f| f.get("name"))
                                            .and_then(|n| n.as_str()),
                                        call.get("function")
                                            .and_then(|f| f.get("arguments"))
                                            .and_then(|a| a.as_str()),
                                    ) {
                                        tool_calls.push(ToolCall {
                                            name: name.to_string(),
                                            args: args.to_string(),
                                        });
                                    }
                                }

                                return Ok(StepResult {
                                    action: "tool_call".to_string(),
                                    reasoning: llm_text,
                                    tool_calls,
                                    final_answer: None,
                                });
                            }
                            Err(_) => return Err("Failed to parse tool calls".to_string()),
                        }
                    } else if llm_text.starts_with("FINAL_ANSWER:") {
                        let answer = llm_text[13..].to_string();
                        return Ok(StepResult {
                            action: "final_answer".to_string(),
                            reasoning: answer.clone(),
                            tool_calls: vec![],
                            final_answer: Some(answer),
                        });
                    }

                    return Ok(StepResult {
                        action: "continue".to_string(),
                        reasoning: llm_text,
                        tool_calls: vec![],
                        final_answer: None,
                    });
                } else {
                    // All steps completed
                    return Ok(StepResult {
                        action: "final_answer".to_string(),
                        reasoning: "Plan completed".to_string(),
                        tool_calls: vec![],
                        final_answer: Some("Plan execution completed.".to_string()),
                    });
                }
            }

            Err("Plan not initialized".to_string())
        })
    }

    fn should_continue(&self, state: &AgentState, step_result: &StepResult) -> bool {
        step_result.action != "final_answer" && state.step < state.max_steps
    }

    fn name(&self) -> &'static str {
        "PlanAndExecute"
    }
}

/// Multi-Agent executor: Delegates to sub-agents
pub struct MultiAgentExecutor;

impl AgentExecutor for MultiAgentExecutor {
    fn execute_step<'a>(
        &'a self,
        state: &'a mut AgentState,
        syscall_tx: &'a mpsc::Sender<Syscall>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<StepResult, String>> + Send + 'a>>
    {
        Box::pin(async move {
            // Multi-agent delegation logic
            let delegation_prompt = format!(
            "Break down the goal into sub-tasks: {}\n\nRespond with DELEGATE:[agent1:task1|agent2:task2|...]",
            state.goal
        );

            let (llm_tx, llm_rx) = oneshot::channel();
            syscall_tx
                .send(Syscall::LlmRequest {
                    agent_id: state.agent_id.clone(),
                    priority: Priority::Normal,
                    prompt: delegation_prompt,
                    response_tx: llm_tx,
                    system_prompt: Some(state.system_prompt.clone()),
                    tool_definitions: None,
                    model: state.model.clone(),
                    stream: false,
                    max_tokens: None,
                    max_completion_tokens: None,
                })
                .await
                .map_err(|e| format!("Failed to send delegation LLM syscall: {}", e))?;

            let response = llm_rx
                .await
                .map_err(|e| format!("Delegation LLM channel error: {}", e))?;

            let llm_text = match response.data {
                Ok(val) => val
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| Some(val.to_string()))
                    .unwrap_or_default(),
                Err(e) => return Err(format!("Delegation LLM error: {}", e)),
            };

            Ok(StepResult {
                action: "continue".to_string(),
                reasoning: llm_text,
                tool_calls: vec![],
                final_answer: None,
            })
        })
    }

    fn should_continue(&self, state: &AgentState, step_result: &StepResult) -> bool {
        step_result.action != "final_answer" && state.step < state.max_steps
    }

    fn name(&self) -> &'static str {
        "MultiAgent"
    }
}

/// Agent Runtime: Orchestrates agent execution with pluggable strategies
pub struct AgentRuntime {
    executor: Box<dyn AgentExecutor>,
    app_handle: AppHandle,
}

impl AgentRuntime {
    /// Create a new agent runtime with the specified strategy
    pub fn new(strategy: AgentStrategy, app_handle: AppHandle) -> Self {
        let executor: Box<dyn AgentExecutor> = match strategy {
            AgentStrategy::ReAct => Box::new(ReActExecutor),
            AgentStrategy::PlanAndExecute => Box::new(PlanAndExecuteExecutor),
            AgentStrategy::MultiAgent => Box::new(MultiAgentExecutor),
        };

        Self {
            executor,
            app_handle,
        }
    }

    /// Run the agent loop with the configured executor
    pub async fn run(
        &self,
        mut state: AgentState,
        syscall_tx: mpsc::Sender<Syscall>,
    ) -> Result<AgentResult, String> {
        println!(
            "[AgentRuntime:{}] Starting execution with {} strategy",
            state.agent_id,
            self.executor.name()
        );

        let _ = self.emit_status(&state.agent_id, "STARTING", "Initializing agent runtime...");

        let mut tool_steps: Vec<(String, String, String)> = Vec::new();

        loop {
            state.step += 1;

            if state.step > state.max_steps {
                let _ = self.emit_status(&state.agent_id, "COMPLETE", "Max steps reached");
                break;
            }

            // Execute one step
            match self.executor.execute_step(&mut state, &syscall_tx).await {
                Ok(step_result) => {
                    let _ = self.emit_status(
                        &state.agent_id,
                        "THINKING",
                        &format!(
                            "Step {} reasoning: {}",
                            state.step,
                            &step_result.reasoning[..100.min(step_result.reasoning.len())]
                        ),
                    );

                    // Execute tool calls if any
                    for tool_call in &step_result.tool_calls {
                        let _ = self.emit_status(
                            &state.agent_id,
                            "ACTING",
                            &format!("Executing tool: {}...", tool_call.name),
                        );

                        let (tool_tx, tool_rx) = oneshot::channel();
                        let _ = syscall_tx
                            .send(Syscall::ToolRequest {
                                agent_id: state.agent_id.clone(),
                                priority: Priority::Normal,
                                tool_name: tool_call.name.clone(),
                                args: tool_call.args.clone(),
                                response_tx: tool_tx,
                            })
                            .await;

                        match tool_rx.await {
                            Ok(resp) => {
                                let result = match resp.data {
                                    Ok(val) => val
                                        .as_str()
                                        .map(|s| s.to_string())
                                        .or_else(|| Some(val.to_string()))
                                        .unwrap_or_default(),
                                    Err(e) => format!("Tool error: {}", e),
                                };

                                state.observations.push(Observation {
                                    tool: tool_call.name.clone(),
                                    input: tool_call.args.clone(),
                                    result: result.clone(),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs(),
                                });

                                tool_steps.push((
                                    tool_call.name.clone(),
                                    tool_call.args.clone(),
                                    result,
                                ));
                            }
                            Err(_) => {
                                let _ = self.emit_status(
                                    &state.agent_id,
                                    "ERROR",
                                    "Tool execution failed",
                                );
                            }
                        }
                    }

                    // Check if should continue
                    if !self.executor.should_continue(&state, &step_result) {
                        let final_answer = step_result
                            .final_answer
                            .clone()
                            .unwrap_or_else(|| "No answer provided".to_string());

                        let _ = self.emit_status(&state.agent_id, "COMPLETE", &final_answer);

                        return Ok(AgentResult {
                            final_answer,
                            steps: tool_steps,
                            total_steps: state.step,
                        });
                    }
                }
                Err(e) => {
                    let _ = self.emit_status(&state.agent_id, "ERROR", &e);
                    return Err(e);
                }
            }

            // Small delay to prevent tight-looping
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        let final_answer = "Agent completed max steps without final answer".to_string();
        let _ = self.emit_status(&state.agent_id, "COMPLETE", &final_answer);

        Ok(AgentResult {
            final_answer,
            steps: tool_steps,
            total_steps: state.step,
        })
    }

    /// Emit status update to frontend
    fn emit_status(&self, agent_id: &str, state: &str, details: &str) -> tauri::Result<()> {
        #[derive(serde::Serialize, Clone)]
        struct AgentStatusPayload {
            process_id: String,
            state: String,
            details: String,
        }

        self.app_handle.emit(
            "agent-status-update",
            AgentStatusPayload {
                process_id: agent_id.to_string(),
                state: state.to_string(),
                details: details.to_string(),
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plan_step_status() {
        let step = PlanStep {
            description: "Test step".to_string(),
            tool: None,
            status: PlanStepStatus::Pending,
        };

        assert_eq!(step.status, PlanStepStatus::Pending);
    }

    #[test]
    fn test_agent_strategy_variants() {
        let _react = AgentStrategy::ReAct;
        let _plan_exec = AgentStrategy::PlanAndExecute;
        let _multi = AgentStrategy::MultiAgent;
    }
}
