//! Manager: Routes user goals to specialists or responds directly.
//! Single LLM call with no tools. Returns JSON: { agent, query_for_agent, response_type, proactive_offer }

use crate::context::ContextMessage;
use serde::{Deserialize, Serialize};

/// Decision schema returned by the Manager LLM.
/// DEPRECATED: The Manager routing pattern has been replaced by a single-agent loop
/// with Tool RAG (semantic tool retrieval) and dynamic persona injection.
/// Kept for backward compatibility and rollback safety.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerDecision {
    /// Target: direct_answer | [Agent ID]
    pub agent: String,
    /// For direct_answer: the response text. For specialists: the refined query.
    pub query_for_agent: String,
    /// Optional: "final_answer" | "tool_call" | "ask_user"
    #[serde(default)]
    pub response_type: String,
    /// Optional proactive suggestion to show the user.
    #[serde(default)]
    pub proactive_offer: Option<String>,
}

/// Agent Configuration from settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    pub avatar: Option<String>,
    pub tools: Vec<String>,
    pub system_prompt: Option<String>,
}

/// Max recent messages to include in the Manager prompt (last N messages = sliding window).
const RECENT_CONVERSATION_CAP: usize = 20;
/// Max chars per message in the recent-conversation block to keep prompt size bounded.
const RECENT_MESSAGE_TRUNCATE: usize = 280;

#[deprecated(note = "Use single-agent loop with Tool RAG instead. See agent.rs.")]
/// Manager prompt: instructs the LLM to route the goal.
/// - `recent_messages`: RECENT CONVERSATION for meta-questions (e.g. "what did I ask before?").
/// - `relevant_memories`: Long-term memories (from MemoryRetrieve) so the OS can recall facts from weeks/months ago (e.g. user's name).
pub fn manager_prompt(
    goal: &str,
    available_agents: &[AgentConfig],
    recent_messages: Option<&[ContextMessage]>,
    relevant_memories: Option<&str>,
) -> String {
    let mut routing_rules = String::from(
        "- direct_answer: MUST be used for (1) ANY question answerable from RELEVANT PAST MEMORIES (names, pets, family, preferences, personal facts — e.g. \"what's my name?\", \"what's my dog's name?\", \"my daughter\"), (2) greetings (\"hola\", \"hi\"), (3) simple math, pure knowledge, translations, definitions, (4) listing what you can do (use the roster below), (5) meta-questions about the conversation. CRITICAL: Do NOT route to aura/contacts/notes/email if the personal fact is already in RELEVANT PAST MEMORIES.\n"
    );

    for agent in available_agents {
        let tools = if agent.tools.is_empty() {
            "(no tools)".to_string()
        } else {
            agent.tools.join(", ")
        };
        routing_rules.push_str(&format!(
            "- {}: {} | tools: {}\n",
            agent.id, agent.description, tools
        ));
    }

    // Roster for "what can you do" answers: specialists only (exclude manager)
    let capability_roster: String = available_agents
        .iter()
        .filter(|a| a.id != "manager")
        .map(|a| format!("- {}: {}\n", a.name, a.description))
        .collect();

    let agent_list = available_agents
        .iter()
        .map(|a| format!("\"{}\"", a.id))
        .collect::<Vec<_>>()
        .join(" | ");
    let final_agent_list = if agent_list.is_empty() {
        "\"direct_answer\"".to_string()
    } else {
        format!("\"direct_answer\" | {}", agent_list)
    };

    let recent_block = recent_messages.map(|msgs| {
        let take = msgs.len().min(RECENT_CONVERSATION_CAP);
        let start = msgs.len().saturating_sub(take);
        let slice = &msgs[start..];
        let lines: Vec<String> = slice
            .iter()
            .map(|m| {
                let role = if m.role == "user" { "User" } else { "Assistant" };
                let content = if m.content.len() > RECENT_MESSAGE_TRUNCATE {
                    format!("{}...", &m.content[..RECENT_MESSAGE_TRUNCATE])
                } else {
                    m.content.clone()
                };
                format!("{}: {}", role, content.replace('\n', " "))
            })
            .collect();
        if lines.is_empty() {
            String::new()
        } else {
            format!("RECENT CONVERSATION (use this to answer meta-questions like \"what did I ask before?\"):\n{}\n\n", lines.join("\n"))
        }
    }).unwrap_or_default();

    let memories_block = relevant_memories
        .filter(|s| !s.is_empty())
        .map(|s| format!("RELEVANT PAST MEMORIES (long-term; use for \"what's my name?\", \"what did I tell you?\", recall from past sessions):\n{}\n\n", s))
        .unwrap_or_default();

    format!(
        r#"You are the SynthesisOS Memory-Aware Router. Your job is to personalize interactions using CORE MEMORY and decide who handles the goal.

{memories_block}{recent_block}Current user goal: {goal}
 
MEMORY-FIRST RULE: If the user's goal (e.g. "what's my name?", "my interests") can be answered using the RELEVANT PAST MEMORIES above, you MUST use agent "direct_answer". Do NOT route to a specialist (like contacts or email) if the fact is already known in memory.

PROFILE-BUILDING RULE: If the user asks to create a profile, "ask me questions", "create a profile for me", or similar personal identity setup, you MUST route to agent "aura". Instruct it to ask ONE question at a time (ping-pong style) to get to know the user. Do NOT use direct_answer for these, as identity management requires specialized memory tool usage which aura possesses.

SPECIAL CASE — If the user asks what you can do, list your capabilities, "what can you do", "list of things you can do", or similar: use agent "direct_answer" and set query_for_agent to a clear list in the user's language. Copy the YOUR SPECIALIST ROSTER below (it already has name and description per line). Do NOT say you lack access or information.

Respond with a JSON object (no markdown, no extra text) with exactly these fields:
- agent: One of {final_agent_list}
- query_for_agent: write a refined, actionable query or task description based on the user's goal. Even for "direct_answer", do NOT answer the question here; just pass the goal to the direct_answer agent.
- response_type: "final_answer" | "tool_call" | "ask_user" (optional, default "final_answer")
- proactive_offer: Optional string with a follow-up suggestion (e.g. "Want me to add this to your calendar?")

YOUR SPECIALIST ROSTER (for "what can you do" questions — output this list in query_for_agent):
{capability_roster}
CRITICAL ROUTING CONSTRAINTS:
- If the user requests creating/writing/appending/moving/copying/deleting files or storage content, route to an agent that has file/storage write tools in its tools list (e.g., file_write/file_append/file_move/file_copy/storage_create/storage_write/storage_delete). Never route those requests to an agent that only has system read/control tools.
- If the request is about Calendar/Reminders/Email/Contacts/Notes actions, route to an agent that has the corresponding app tools in its tools list.
- If the request is about system controls (volume, brightness, dark mode, battery, wifi, clipboard, screenshot, open_app), route to an agent that has those system tools.
- Before deciding, verify the selected agent's tools list can actually execute the request.

ROUTING RULES (for routing and capability matching):
{routing_rules}
ABSOLUTE RULE: If the answer is in RELEVANT PAST MEMORIES or RECENT CONVERSATION, you MUST use direct_answer. NEVER route personal fact questions to specialists when the answer is already in memory. Only route to a specialist when the task genuinely requires tool execution (web search, app control, file access, system commands)."#,
        memories_block = memories_block,
        recent_block = recent_block,
        goal = goal,
        final_agent_list = final_agent_list,
        capability_roster = capability_roster,
        routing_rules = routing_rules
    )
}

#[deprecated(note = "Use single-agent loop with Tool RAG instead. See agent.rs.")]
/// Parse Manager response. Expects raw JSON or JSON inside markdown code block.
pub fn parse_manager_response(response: &str) -> Option<ManagerDecision> {
    let trimmed = response.trim();
    let json_str = if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            trimmed
        }
    } else {
        trimmed
    };
    serde_json::from_str(json_str).ok()
}
