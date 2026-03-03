//! Dynamic Personas: injectable context fragments that replace hardcoded specialist agents.
//!
//! Instead of routing to separate "specialists" (web_research, macos_apps, system, etc.),
//! we dynamically inject relevant persona fragments into a single agent's system prompt.
//! This gives the LLM domain-specific guidance without the overhead of a Manager routing step.

use std::collections::HashSet;

/// A persona fragment: domain-specific instructions injected into the system prompt.
pub struct Persona {
    pub id: &'static str,
    /// Keywords that trigger this persona (matched against the user query, case-insensitive).
    pub trigger_keywords: &'static [&'static str],
    /// Tool names associated with this persona — if Tool RAG selects any of these,
    /// this persona is also injected.
    pub associated_tools: &'static [&'static str],
    /// The actual instruction text injected into the system prompt.
    pub context_fragment: &'static str,
}

/// All available persona fragments.
/// Derived from the original specialist prompts in specialists.rs.
pub const PERSONAS: &[Persona] = &[
    Persona {
        id: "macos_apps",
        trigger_keywords: &[
            "email", "mail", "notes", "calendar", "reminder", "contact", "music",
            "finder", "safari", "tab", "app",
        ],
        associated_tools: &[
            "email_list", "notes_list", "notes_read", "notes_create", "calendar_today",
            "calendar_create", "reminders_list", "reminders_add", "contacts_search",
            "music_play", "music_pause", "music_next", "finder_open", "finder_trash",
            "safari_tabs", "open_app",
        ],
        context_fragment: concat!(
            "[macOS APPS CONTEXT]\n",
            "Available apps: Notes, Mail, Calendar, Reminders, Contacts, Music, Finder, Safari.\n",
            "CRITICAL: Consult local apps only for system data. DO NOT search apps for personal user facts already defined in the CONTEXT MEMORY.",
        ),
    },
    Persona {
        id: "system_control",
        trigger_keywords: &[
            "volume", "brightness", "battery", "wifi",
            "dark mode", "screenshot", "clipboard",
            "tts", "speak", "timer", "system",
        ],
        associated_tools: &[
            "clipboard_read", "clipboard_write", "get_volume", "set_volume",
            "get_brightness", "set_brightness", "toggle_dark_mode", "get_battery",
            "get_wifi", "get_system_info", "open_app", "say_tts", "take_screenshot",
            "search_files", "set_timer",
        ],
        context_fragment: concat!(
            "[SYSTEM CONTROL CONTEXT]\n",
            "For volume/brightness with a percentage relative change (e.g. 'increase 20%', 'decrease 10%'): call the 'get_' tool first, multiply the current value (e.g. current * 1.20 or * 0.90), then call the 'set_' tool.\n",
            "Execute actions immediately without asking for intermediate confirmations.",
        ),
    },
    Persona {
        id: "web_research",
        trigger_keywords: &[
            "search", "web", "internet", "google", "url", "link",
            "page", "website", "article", "news",
            "image", "photo", "video", "youtube", "rss",
        ],
        associated_tools: &[
            "web_search", "read_page", "web_scrape", "search_images", "http_request",
            "summarize_url", "youtube_search", "rss_reader",
        ],
        context_fragment: concat!(
            "[WEB RESEARCH CONTEXT]\n",
            "- Images/Photos: use search_images\n",
            "- Videos: use youtube_search\n",
            "- RSS feeds: use rss_reader\n",
            "- Reading standard pages: use read_page or summarize_url\n",
            "- API calls/Raw HTTP: use http_request\n",
            "When data is missing, execute a tool immediately without apologizing or asking permission.",
        ),
    },
    Persona {
        id: "identity",
        trigger_keywords: &[
            "name", "profile", "remember", "who am i",
            "preference", "pet", "family",
            "hobby", "hobbies", "age", "know me", "question",
        ],
        associated_tools: &[],  // No tools needed — memory is automatic
        context_fragment: concat!(
            "[IDENTITY & CONVERSATION CONTEXT]\n",
            "PING-PONG RULE: When having a casual conversation or getting to know the user, ask ONLY ONE question at a time to maintain a natural flow.",
        ),
    },
    Persona {
        id: "file_ops",
        trigger_keywords: &[
            "file", "folder", "write", "create",
            "move", "copy", "delete", "storage",
            "save", "code", "script",
        ],
        associated_tools: &[
            "read_file", "file_write", "file_append", "file_read_full", "dir_list",
            "file_move", "file_copy", "storage_create", "storage_write", "storage_read",
            "storage_list", "storage_delete", "storage_versions", "storage_rollback",
        ],
        context_fragment: concat!(
            "[FILE OPERATIONS CONTEXT]\n",
            "- Real File System: Use file_write, file_append, file_move, file_copy only when the user explicitly requests interacting with macOS files.\n",
            "- LSFS (Versioned Storage): Use storage_* tools for any agent-managed data, internal notes, or persisting contextual state.",
        ),
    },
    Persona {
        id: "knowledge",
        trigger_keywords: &[
            "weather", "currency", "convert",
            "define", "definition", "translate",
            "calculate", "math", "time", "qr",
        ],
        associated_tools: &[
            "weather", "currency_convert", "define_word", "translate",
            "calculate", "current_time", "qr_code",
        ],
        context_fragment: concat!(
            "[KNOWLEDGE & UTILITIES CONTEXT]\n",
            "- Specialized Utilities: Use weather, currency_convert, define_word, translate, calculate, current_time, or qr_code for precise requests.\n",
            "Provide the tool result directly to the user seamlessly.",
        ),
    },
];

/// Select the most relevant persona fragments for a given query and set of selected tools.
/// Returns up to `max_personas` fragments.
pub fn select_personas(
    query: &str,
    selected_tool_names: &[String],
    max_personas: usize,
) -> Vec<&'static Persona> {
    let query_lower = query.to_lowercase();
    let tool_set: HashSet<&str> = selected_tool_names.iter().map(|s| s.as_str()).collect();

    let mut scored: Vec<(&Persona, usize)> = PERSONAS
        .iter()
        .map(|p| {
            let mut score = 0usize;

            // Score based on keyword matches in the query
            for &kw in p.trigger_keywords {
                if query_lower.contains(kw) {
                    score += 2;
                }
            }

            // Score based on overlap with Tool RAG-selected tools
            for &tool in p.associated_tools {
                if tool_set.contains(tool) {
                    score += 1;
                }
            }

            (p, score)
        })
        .filter(|(_, score)| *score > 0)
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.1.cmp(&a.1));

    scored
        .into_iter()
        .take(max_personas)
        .map(|(p, _)| p)
        .collect()
}

/// Format selected personas into a string for system prompt injection.
pub fn format_persona_fragments(personas: &[&Persona]) -> String {
    if personas.is_empty() {
        return String::new();
    }
    personas
        .iter()
        .map(|p| p.context_fragment)
        .collect::<Vec<_>>()
        .join("\n\n")
}
