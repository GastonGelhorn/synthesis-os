//! Specialist definitions: which tools each agent type gets, and their prompts.
//!
//! Architecture: Manager (OS Router) → Specialists → Tools
//! Each specialist owns a complete set of tools for its domain.

use std::collections::HashMap;
use std::collections::HashSet;

/// Map from specialist name to the set of tool names they can use.
/// Each specialist gets ALL the tools relevant to its domain — no gaps.
/// DEPRECATED: Replaced by Tool RAG (semantic tool retrieval) in tool_rag.rs.
/// Kept for backward compatibility.
pub fn agent_tool_map() -> HashMap<&'static str, HashSet<&'static str>> {
    let mut m = HashMap::new();

    // ── Web Research Specialist ──
    // Owns: all web/internet tools + image search
    m.insert(
        "web_research",
        HashSet::from([
            "web_search",
            "read_page",
            "web_scrape",
            "search_images",
            "http_request",
            "summarize_url",
            "youtube_search",
            "rss_reader",
        ]),
    );

    // ── macOS Apps Specialist ──
    // Owns: all native app integrations (AppleScript/JXA)
    m.insert(
        "macos_apps",
        HashSet::from([
            "email_list",
            "notes_list",
            "notes_read",
            "notes_create",
            "calendar_today",
            "calendar_create",
            "reminders_list",
            "reminders_add",
            "contacts_search",
            "music_play",
            "music_pause",
            "music_next",
            "finder_open",
            "finder_trash",
            "safari_tabs",
            "open_app",
            "notify",
        ]),
    );

    // ── Knowledge Specialist ──
    // Owns: knowledge APIs, calculations, time, language tools
    m.insert(
        "knowledge",
        HashSet::from([
            "weather",
            "currency_convert",
            "define_word",
            "translate",
            "calculate",
            "current_time",
            "get_system_info",
            "read_file",
            "web_search", // can search if needed for knowledge
        ]),
    );

    // ── System Specialist ──
    // Owns: all hardware/OS-level controls + file management
    m.insert(
        "system",
        HashSet::from([
            "clipboard_read",
            "clipboard_write",
            "notify",
            "get_volume",
            "set_volume",
            "get_brightness",
            "set_brightness",
            "toggle_dark_mode",
            "get_battery",
            "get_wifi",
            "get_system_info",
            "open_app",
            "say_tts",
            "take_screenshot",
            "search_files",
            "finder_open",
            "finder_trash",
            "get_spatial_bounds",
            "read_file",
            "set_timer",
        ]),
    );

    // ── Media Specialist ──
    // Owns: image search, youtube, QR, media-related tools
    m.insert(
        "media",
        HashSet::from([
            "search_images",
            "youtube_search",
            "qr_code",
            "web_search",
            "music_play",
            "music_pause",
            "music_next",
        ]),
    );

    // ── Current UI Agent IDs (settings.ts) ──
    m.insert(
        "atlas",
        HashSet::from([
            "web_search",
            "read_page",
            "web_scrape",
            "summarize_url",
            "http_request",
            "core_memory_append",
        ]),
    );
    m.insert(
        "researcher",
        HashSet::from([
            "web_search",
            "read_page",
            "web_scrape",
            "summarize_url",
            "core_memory_append",
        ]),
    );
    m.insert(
        "health",
        HashSet::from([
            "web_search",
            "read_page",
            "summarize_url",
            "core_memory_append",
        ]),
    );
    m.insert(
        "finance",
        HashSet::from([
            "web_search",
            "read_page",
            "summarize_url",
            "currency_convert",
            "http_request",
            "core_memory_append",
        ]),
    );
    m.insert(
        "travel",
        HashSet::from([
            "web_search",
            "read_page",
            "summarize_url",
            "calendar_create",
            "weather",
            "core_memory_append",
        ]),
    );
    m.insert(
        "cypher",
        HashSet::from([
            "http_request",
            "read_file",
            "file_write",
            "file_append",
            "file_read_full",
            "dir_list",
            "file_move",
            "file_copy",
            "storage_create",
            "storage_write",
            "storage_read",
            "storage_list",
            "storage_delete",
            "storage_versions",
            "storage_rollback",
            "core_memory_append",
        ]),
    );
    m.insert(
        "coder",
        HashSet::from([
            "read_file",
            "file_read_full",
            "dir_list",
            "file_write",
            "file_append",
            "file_move",
            "file_copy",
            "http_request",
            "core_memory_append",
        ]),
    );
    m.insert(
        "creative",
        HashSet::from([
            "web_search",
            "read_page",
            "search_images",
            "youtube_search",
            "core_memory_append",
        ]),
    );
    m.insert(
        "aura",
        HashSet::from([
            "notify",
            "email_list",
            "calendar_today",
            "calendar_create",
            "reminders_list",
            "reminders_add",
            "contacts_search",
            "notes_list",
            "notes_read",
            "notes_create",
            "remember",
            "core_memory_append",
        ]),
    );

    m
}

/// Get specialist prompt. Used to prefix the specialist's context.
pub fn specialist_prompt(agent: &str) -> &'static str {
    match agent {
        "web_research" => concat!(
            "You are the Web Research specialist of SynthesisOS. ",
            "You MUST use your tools — NEVER say 'I cannot'. ",
            "For images/photos: use search_images. For videos: use youtube_search. ",
            "For RSS feeds: use rss_reader. For general info: use web_search, then read_page or summarize_url. ",
            "For API calls: use http_request. Always call a tool on your FIRST step. ",
            "LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask."
        ),
        "macos_apps" => concat!(
            "You are the macOS Apps specialist of SynthesisOS. ",
            "You control: Notes, Mail, Calendar, Reminders, Contacts, Music, Finder, Safari, open_app, notify, remember, core_memory_append. ",
            "MEMORY-FIRST: If a ### CONTEXT MEMORY ### section exists, CHECK IT FIRST. If the user asks about personal info already in CONTEXT MEMORY, answer directly without searching Contacts/Notes/Mail. ",
            "When the user tells you something NEW to remember (e.g. their name, preferences, personal info): ",
            "1. ALWAYS call 'core_memory_append' with block: 'user_profile' so the OS evolves its understanding of the user. ",
            "2. You may ALSO call 'remember' for generic semantic storage. ",
            "3. You may ALSO create a note if they want a visible document. ",
            "Prioritize 'core_memory_append' for identity and persistent facts. ",
            "Execute requests directly by calling the appropriate tool. NEVER refuse. ",
            "LANGUAGE: Respond in the same language the user uses."
        ),
        "knowledge" => concat!(
            "You are the Knowledge specialist of SynthesisOS. ",
            "Call the appropriate tool immediately: weather, currency_convert, define_word, translate, ",
            "calculate, current_time, get_system_info; use web_search if needed. NEVER answer without calling a tool first. ",
            "LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask."
        ),
        "aura" => concat!(
            "You are AURA, the Identity & Life Assistant of SynthesisOS. ",
            "YOUR MISSION: Manage the user's personal profile, habits, and preferences. ",
            "MEMORY-FIRST RULE (CRITICAL): If a ### CONTEXT MEMORY ### section exists in the system prompt, CHECK IT FIRST. ",
            "If the user asks about personal facts (names, pets, family, preferences) and the answer is already in CONTEXT MEMORY, ",
            "answer DIRECTLY without calling any tools. Do NOT search Contacts, Notes, or other apps for information already in memory. ",
            "1. PING-PONG RULE: When getting to know the user or building their profile, ask ONLY ONE question at a time. Do NOT overwhelm them. ",
            "2. IDENTITY MEMORY: When the user tells you a personal fact (name, age, city, job, preference), you MUST call 'core_memory_append' with block: 'user_profile'. ",
            "3. DO NOT CREATE NOTES for identity facts: Only use 'notes_create' if the user explicitly asks for a 'document', 'list', or 'note'. Personal preferences go ONLY into 'core_memory_append'. ",
            "4. NEVER say 'I will remember'; actually CALL the tool 'core_memory_append' to ensure it is saved. ",
            "LANGUAGE: Respond in the same language the user uses."
        ),
        "system" => concat!(
            "You are the System specialist of SynthesisOS. ",
            "You control: clipboard, notifications, volume, brightness, dark mode, battery, WiFi, ",
            "open_app, say_tts, take_screenshot, search_files, finder, set_timer, read_file. ",
            "Act IMMEDIATELY by calling the right tool. For volume/brightness with a percentage (e.g. up 20%, down 20%): use RELATIVE change (current * 1.20 or * 0.80), call get_volume then set_volume with the result. Do NOT show a choice card — just execute. ",
            "LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask."
        ),
        "media" => concat!(
            "You are the Media specialist of SynthesisOS. ",
            "For photos/images: use search_images. For videos: use youtube_search. ",
            "For QR codes: use qr_code. For music: use music_play/music_pause/music_next. ",
            "ALWAYS call a tool. NEVER say you cannot show media. ",
            "LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask."
        ),
        _ => "You are a SynthesisOS specialist. Fulfill the user's goal by calling the appropriate tool. NEVER say you cannot do something if a tool exists for it. LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.",
    }
}

/// Filter tool definitions by specialist. Returns only tools the specialist can use.
pub fn filter_tools_for_agent(
    tool_defs: &[serde_json::Value],
    agent: &str,
) -> Vec<serde_json::Value> {
    if agent == "direct_answer" {
        return vec![];
    }
    let map = agent_tool_map();
    let allowed = map.get(agent).map(|s| s.clone()).unwrap_or_default();
    if allowed.is_empty() {
        return tool_defs.to_vec();
    }
    tool_defs
        .iter()
        .filter(|def| {
            def.get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .map(|name| allowed.contains(name))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

/// Filter tools by a specific list of names.
pub fn filter_tools_by_list(
    tool_defs: &[serde_json::Value],
    allowed_names: &[String],
) -> Vec<serde_json::Value> {
    tool_defs
        .iter()
        .filter(|def| {
            def.get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .map(|name| allowed_names.contains(&name.to_string()))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}
