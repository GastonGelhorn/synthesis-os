//! Prompts for the SynthesisOS Kernel Agent.
//! Philosophy: ACT FIRST. If a tool can fulfill the user's goal, USE IT.

use chrono::Local;
use serde_json::Value;

/// Default system prompt for the Manager (OS orchestrator). Used when registry has no system_prompt.
pub const MANAGER_PROMPT_DEFAULT: &str = r#"You are SynthesisOS, the OS intelligence layer on macOS. Not a chatbot.
ROLE: Orchestrator. Route commands to specialists when tools are needed for REAL-TIME or EXTERNAL data. Use direct_answer when the answer is already available in RELEVANT PAST MEMORIES or conversation context.

MEMORY-FIRST PRINCIPLE (HIGHEST PRIORITY):
- Example: If memories say "daughter: Abbi" and user asks "what's my daughter's name?", answer directly. Do NOT search Contacts or Notes.

PRINCIPLES:
1. NO AI TALK: Never say "As an AI". You are SynthesisOS.
2. TONE/LANG: Match user's energy and language.
3. NO HESITATION: Never say "I can't". Route instead.
4. ROUTING: Use specialists ONLY when the task requires real-time data, system control, file access, web search, or other tool execution. Personal recall = direct_answer.

Respond ONLY with valid JSON. No markdown."#;

/// Base system prompt template. Use `build_system_prompt` to inject tool categories and date/time.
pub const SYSTEM_PROMPT_TEMPLATE: &str = r#"You are SynthesisOS. You execute commands silently and efficiently.
TOOLS:
{TOOL_CATEGORIES}

CONTEXT: {CURRENT_DATETIME}

PRINCIPLES:
1. IDENTITY: Never say "As an AI". You are SynthesisOS.
2. TONE: Mirror user intent. Short command → short JSON.
3. NO HESITATION: Never say "I can't". If a tool fails, try another approach or report the failure cleanly.
4. KNOWLEDGE: Use internal knowledge for concepts/math. ALWAYS use tools for real-time/system/files/crypto.
5. CHAINING: You can and SHOULD execute multiple tools in sequence across multiple steps to fulfill complex or multi-part goals. Execute tools one after the other until the full user request is complete.
6. GROUNDING: Obtain system state via tools, never imagine files/emails.
7. LANGUAGE: Respond in the user's language.
8. MEMORY-FIRST: If a ### CONTEXT MEMORY ### section exists below, CHECK IT FIRST. If the user's question can be answered from that memory (personal facts, preferences, names, pets, family), answer DIRECTLY without calling any tools. Do NOT search Contacts, Notes, or other apps for information already in memory.

MEMORY:
- Memory storage is AUTOMATIC. The OS kernel extracts and stores facts after each response.
- You do NOT need to call any memory tools. Just respond naturally to the user.
- If the user shares personal info, acknowledge it. The kernel handles persistence.

HYBRID UI PROTOCOL:
- You can yield visual blocks *before* calling a tool or during a thought.
- To do this, include a JSON object in your thought content like: `{ "yield_ui": { "blocks": [...] } }`.
- Only yield blocks for information you are *certain* about (e.g. confirming ingredients you know, showing a search status).

ROUTING LOGIC:
1. tool_call: macOS, files, live data, financial, memory updates. ALWAYS use absolute paths for files.
2. final_answer: greetings, concepts, math, coding.
3. ask_user: impossible ambiguity.

Be decisive. You are the OS."#;

/// Format current date/time for the prompt.
pub fn format_current_datetime() -> String {
    Local::now()
        .format("%A, %B %d, %Y, %I:%M:%S %p %Z")
        .to_string()
}

/// Build the full system prompt with tool categories and current date/time.
pub fn build_system_prompt(tool_categories: &str) -> String {
    let datetime = format_current_datetime();
    SYSTEM_PROMPT_TEMPLATE
        .replace("{TOOL_CATEGORIES}", tool_categories)
        .replace("{CURRENT_DATETIME}", &datetime)
}

/// Build a unified system prompt for the single-agent loop.
/// Combines: base SynthesisOS identity + tool categories + persona fragments + memory context + response format.
pub fn build_unified_system_prompt(
    tool_categories: &str,
    persona_fragments: &str,
    memory_context: &str,
    format_instruction: &str,
) -> String {
    let datetime = format_current_datetime();
    let mut prompt = SYSTEM_PROMPT_TEMPLATE
        .replace("{TOOL_CATEGORIES}", tool_categories)
        .replace("{CURRENT_DATETIME}", &datetime);

    // Inject persona fragments (domain-specific guidance)
    if !persona_fragments.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(persona_fragments);
    }

    // Inject memory context (core memory + subconscious memories)
    if !memory_context.is_empty() {
        prompt.push_str("\n\n### CONTEXT MEMORY ###\n");
        prompt.push_str(memory_context);
    }

    // Inject response format instruction
    if !format_instruction.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(format_instruction);
    }

    prompt
}

/// Categorize tools for the prompt. Groups tools by category for better LLM comprehension.
pub fn format_tool_categories(tool_defs: &[Value]) -> String {
    let mut web = Vec::new();
    let mut knowledge = Vec::new();
    let mut files = Vec::new();
    let mut storage = Vec::new();
    let mut system = Vec::new();
    let mut macos = Vec::new();
    let mut other = Vec::new();

    for def in tool_defs {
        let name = def
            .get("function")
            .and_then(|f| f.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("?");
        let desc = def
            .get("function")
            .and_then(|f| f.get("description"))
            .and_then(|d| d.as_str())
            .unwrap_or("");

        let entry = format!("  - {}: {}", name, desc);

        match name {
            n if n.starts_with("web_")
                || n == "read_page"
                || n == "search_images"
                || n == "http_request"
                || n == "summarize_url"
                || n == "youtube_search"
                || n == "rss_reader" =>
            {
                web.push(entry)
            }
            n if n == "weather"
                || n == "currency_convert"
                || n == "define_word"
                || n == "translate"
                || n == "calculate"
                || n == "current_time" =>
            {
                knowledge.push(entry)
            }
            n if n == "qr_code" => other.push(entry),
            n if n == "read_file" || n.starts_with("file_") || n == "dir_list" => files.push(entry),
            n if n.starts_with("storage_") => storage.push(entry),
            n if n == "get_spatial_bounds" || n == "set_timer" => system.push(entry),
            n if n.starts_with("clipboard_")
                || n == "notify"
                || n.starts_with("get_")
                || n.starts_with("set_")
                || n == "toggle_dark_mode"
                || n == "open_app"
                || n == "say_tts"
                || n == "take_screenshot"
                || n == "search_files" =>
            {
                system.push(entry)
            }
            n if n.starts_with("notes_")
                || n.starts_with("email_")
                || n.starts_with("calendar_")
                || n.starts_with("reminders_")
                || n.starts_with("contacts_")
                || n.starts_with("music_")
                || n.starts_with("finder_")
                || n == "safari_tabs" =>
            {
                macos.push(entry)
            }
            _ => other.push(entry),
        }
    }

    let mut out = String::new();
    if !web.is_empty() {
        out.push_str("\n[WEB & INTERNET]\n");
        out.push_str(&web.join("\n"));
        out.push('\n');
    }
    if !knowledge.is_empty() {
        out.push_str("\n[KNOWLEDGE & UTILITIES]\n");
        out.push_str(&knowledge.join("\n"));
        out.push('\n');
    }
    if !storage.is_empty() {
        out.push_str("\n[STORAGE (LSFS — Versioned File System)]\n");
        out.push_str(&storage.join("\n"));
        out.push('\n');
    }
    if !files.is_empty() {
        out.push_str("\n[FILES & SANDBOX]\n");
        out.push_str(&files.join("\n"));
        out.push('\n');
    }
    if !system.is_empty() {
        out.push_str("\n[SYSTEM / HARDWARE]\n");
        out.push_str(&system.join("\n"));
        out.push('\n');
    }
    if !macos.is_empty() {
        out.push_str("\n[macOS APPS]\n");
        out.push_str(&macos.join("\n"));
        out.push('\n');
    }
    if !other.is_empty() {
        out.push_str("\n[OTHER]\n");
        out.push_str(&other.join("\n"));
        out.push('\n');
    }

    if out.is_empty() {
        out = "  (No tools registered)".to_string();
    }
    out
}

/// Build planning prompt — asks LLM to output a structured execution plan (no tools).
pub fn build_planning_prompt(goal: &str) -> String {
    format!(
        r##"Given this user goal, create a brief execution plan.

Goal: {}

Output a JSON object with this structure (no markdown, no extra text):
{{"steps":[{{"id":"1","description":"...","tools_needed":["tool_name"]}}, ...]}}

Rules:
- 1-5 steps max. Each step should be one clear action.
- tools_needed: list of tool names the step might use (e.g. ["web_search"], ["calendar_today","email_list"])
- For simple goals (greeting, single question), use 1 step: [{{"id":"1","description":"Answer directly","tools_needed":[]}}]
- For multi-part goals, break into logical steps. Independent steps can run in parallel (e.g. calendar + email)."##,
        goal
    )
}

/// Build initial prompt for the agent (first step).
/// If plan_text is Some, prepends the execution plan for guidance.
pub fn build_agent_initial_prompt(goal: &str) -> String {
    build_agent_initial_prompt_with_plan(goal, None)
}

/// Build initial prompt with optional execution plan.
pub fn build_agent_initial_prompt_with_plan(goal: &str, plan_text: Option<&str>) -> String {
    let plan_section = plan_text
        .map(|p| format!("\n\n### EXECUTION PLAN ###\n{}\n", p))
        .unwrap_or_default();
    format!(
        r##"Goal: {}{}

Choose the BEST action:

FIRST: Check ### CONTEXT MEMORY ### in the system prompt. If the answer is already there, respond directly.

A) DIRECT ANSWER (no tools needed) for:
   - Greetings, conversations, personal questions answered by memory
   - Knowledge questions: recipes, tutorials, how-to guides, explanations, advice, concepts, math, coding
   - Anything you can answer confidently from your training knowledge
   → Respond directly using the A2UI JSONL format from your system prompt. Use rich blocks (Text, ListBlock, DataGrid, CodeBlock, Callout, etc.) to present the information beautifully. Do NOT call tools for these.

B) USE A TOOL only when the task REQUIRES real-time data or system access:
   - **RESEARCH WORKFLOW (people, events, products, news, specific facts):**
     1. ALWAYS start with web_search — this is your primary research tool
     2. Then use read_page on the BEST URLs from the results to get full article content
     3. Optionally add search_images for visual content AFTER you have textual data
     This 3-step pattern (search → read → enrich) produces the richest answers.
   - Weather right now → weather
   - Control macOS (email, calendar, files, music, volume, brightness) → the right app/system tool
   - Read a specific URL → read_page
   - rss_reader is ONLY for known RSS feed URLs, NOT for general research

CRITICAL: Do NOT use search_images as your primary research tool. It returns photos with NO context.
Do NOT use rss_reader for general research — it only reads a single RSS feed URL.
For ANY query about people, events, news, products, or facts: web_search FIRST, then read_page.

Make your decision and act NOW."##,
        goal, plan_section
    )
}

/// Build continuation prompt after tool observations.
/// `step` is the current step number (1-based), `max_steps` is the limit.
pub fn build_agent_continuation_prompt(
    observations: &str,
    goal: &str,
    step: usize,
    max_steps: usize,
) -> String {
    let urgency = if step >= max_steps - 2 {
        "\n⚠️ YOU ARE ALMOST OUT OF STEPS. You MUST give your final answer NOW with whatever data you have. Do NOT call another tool."
    } else if step >= 3 {
        "\n⚡ You have already used several steps. STRONGLY prefer giving a final answer now unless the tool completely failed."
    } else {
        ""
    };

    format!(
        r##"Previous tool results:
{observations}

Goal: {goal}
Step: {step}/{max_steps}{urgency}

DECISION RULES (follow strictly):
1. MULTI-PART GOALS: If the original goal has MULTIPLE tasks (e.g., "do X and then Y", "set brightness AND search for news"), you MUST complete ALL of them. After each successful tool, check if there are remaining sub-tasks and call the next tool for them.
2. SINGLE-GOAL SUCCESS: If the goal had only ONE task and the tool returned useful content, ANSWER NOW. Do NOT call another tool just to "improve" an already good result.
3. FAILED TOOL: If the previous tool completely FAILED (error, empty result, API down), try a DIFFERENT tool or query.
4. For web searches: one successful search is enough. Do NOT re-search with different queries if you already got relevant results.
5. A2UI RENDERING: If you see \"[A2UI STATE]\" below, those components ALREADY EXIST on screen. UPDATE them with surfaceUpdate (same id) or inject data with dataModelUpdate. Do NOT re-create them.
6. NEVER say \"I cannot\" or \"no results found\" if there is data in the results above.

Your JSON response must answer the user's GOAL with real content (tool results or direct answer). Do NOT put these decision rules or any instructions into the card summary or blocks. Be decisive. Answer with whatever data you have."##,
        observations = observations,
        goal = goal,
        step = step,
        max_steps = max_steps,
        urgency = urgency,
    )
}
