use std::collections::HashSet;
use tauri::AppHandle;
use tauri_plugin_store::StoreBuilder;

fn load_settings_object(
    app_handle: &AppHandle,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    let store = StoreBuilder::new(app_handle, "settings.json")
        .build()
        .ok()?;
    let _ = store.reload();
    let settings_val = store.get("settings")?;
    settings_val.as_object().cloned()
}

/// Clears the settings store (API keys, etc.). Used when resetting to setup.
pub fn clear_settings_store(app_handle: &AppHandle) -> Result<(), String> {
    let store = StoreBuilder::new(app_handle, "settings.json")
        .build()
        .map_err(|e| e.to_string())?;
    store.delete("settings");
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn get_string_setting(app_handle: &AppHandle, key: &str) -> Option<String> {
    let obj = load_settings_object(app_handle)?;
    let val = obj.get(key)?;
    let s = val.as_str()?.trim();
    if s.is_empty() {
        return None;
    }
    Some(s.to_string())
}

/// Retrieves the OpenAI API Key from the 'settings.json' store.
/// Returns None if not found or if the store cannot be loaded.
pub fn get_openai_api_key(app_handle: &AppHandle) -> Option<String> {
    let key = get_string_setting(app_handle, "openaiApiKey")
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())?;
    if key.contains("dummy") {
        return None;
    }
    Some(key)
}

/// Retrieves Anthropic API key from settings/env.
pub fn get_anthropic_api_key(app_handle: &AppHandle) -> Option<String> {
    get_string_setting(app_handle, "anthropicApiKey")
        .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
}

/// Retrieves Groq API key from settings/env.
pub fn get_groq_api_key(app_handle: &AppHandle) -> Option<String> {
    get_string_setting(app_handle, "groqApiKey").or_else(|| std::env::var("GROQ_API_KEY").ok())
}

/// Retrieves Gemini API key from settings/env.
pub fn get_gemini_api_key(app_handle: &AppHandle) -> Option<String> {
    get_string_setting(app_handle, "geminiApiKey").or_else(|| std::env::var("GEMINI_API_KEY").ok())
}

/// Retrieves API key by provider name.
pub fn get_provider_api_key(app_handle: &AppHandle, provider: &str) -> Option<String> {
    match provider {
        "openai" => get_openai_api_key(app_handle),
        "anthropic" => get_anthropic_api_key(app_handle),
        "groq" => get_groq_api_key(app_handle),
        "gemini" | "google" => get_gemini_api_key(app_handle),
        _ => None,
    }
}

/// Retrieves the Ollama endpoint from settings (e.g. http://127.0.0.1:11434).
pub fn get_ollama_endpoint(app_handle: &AppHandle) -> Option<String> {
    get_string_setting(app_handle, "ollamaEndpoint")
        .or_else(|| std::env::var("OLLAMA_ENDPOINT").ok())
}

/// Parses agent model string "provider:modelId" into (provider, model_id). Legacy "modelId" is treated as openai.
pub fn parse_agent_model(model: Option<&String>) -> (String, String) {
    let raw = model.map(|s| s.as_str()).unwrap_or("gpt-4o");
    if let Some((provider, id)) = raw.split_once(':') {
        (provider.to_string(), id.to_string())
    } else {
        ("openai".to_string(), raw.to_string())
    }
}

fn default_tools_for_agent(agent_id: &str) -> Vec<String> {
    let tools: &[&str] = match agent_id {
        "manager" => &[],
        "atlas" | "researcher" | "health" => {
            &["web_search", "read_page", "summarize_url", "web_scrape"]
        }
        "cypher" => &[
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
        ],
        "aura" => &[
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
        ],
        "system" => &[
            "get_volume",
            "set_volume",
            "get_brightness",
            "set_brightness",
            "toggle_dark_mode",
            "clipboard_read",
            "clipboard_write",
            "notify",
            "open_app",
            "say_tts",
            "take_screenshot",
            "search_files",
            "set_timer",
            "get_system_info",
            "get_battery",
            "get_wifi",
            "get_spatial_bounds",
            "read_file",
        ],
        "creative" => &["web_search", "read_page", "search_images", "youtube_search"],
        "coder" => &[
            "read_file",
            "file_read_full",
            "dir_list",
            "file_write",
            "file_append",
            "file_move",
            "file_copy",
            "http_request",
        ],
        "travel" => &[
            "web_search",
            "read_page",
            "summarize_url",
            "calendar_create",
            "weather",
        ],
        "finance" => &[
            "web_search",
            "read_page",
            "summarize_url",
            "currency_convert",
            "http_request",
        ],
        "media" => &[
            "web_search",
            "youtube_search",
            "search_images",
            "music_play",
            "music_pause",
            "music_next",
            "qr_code",
        ],
        _ => &[],
    };
    tools.iter().map(|s| s.to_string()).collect()
}

fn expand_legacy_tool_alias(tool: &str) -> Option<Vec<&'static str>> {
    match tool {
        "file_manager" => Some(vec![
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
        ]),
        "email_reader" => Some(vec!["email_list"]),
        "calendar" => Some(vec!["calendar_today", "calendar_create"]),
        "reminders" => Some(vec!["reminders_list", "reminders_add"]),
        "contacts" => Some(vec!["contacts_search"]),
        "system_info" => Some(vec!["get_system_info"]),
        "clipboard" => Some(vec!["clipboard_read", "clipboard_write"]),
        "spotlight_search" => Some(vec!["search_files"]),
        "desktop_screenshot" => Some(vec!["take_screenshot"]),
        "volume_brightness" => Some(vec![
            "get_volume",
            "set_volume",
            "get_brightness",
            "set_brightness",
        ]),
        "battery_info" => Some(vec!["get_battery"]),
        "wifi_info" => Some(vec!["get_wifi"]),
        "dark_mode" => Some(vec!["toggle_dark_mode"]),
        "finder" => Some(vec!["finder_open", "finder_trash"]),
        "music" => Some(vec!["music_play", "music_pause", "music_next"]),
        "notes" => Some(vec!["notes_list", "notes_read", "notes_create"]),
        _ => None,
    }
}

fn normalize_agent_tools(agent_id: &str, tools: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for t in tools {
        if t == "generate_code" {
            // Legacy non-kernel tool; skip in Rust runtime.
            continue;
        }

        if let Some(expanded) = expand_legacy_tool_alias(t) {
            for mapped in expanded {
                let mapped_s = mapped.to_string();
                if seen.insert(mapped_s.clone()) {
                    out.push(mapped_s);
                }
            }
            continue;
        }

        if seen.insert(t.clone()) {
            out.push(t.clone());
        }
    }

    if out.is_empty() && agent_id != "manager" {
        let defaults = default_tools_for_agent(agent_id);
        if !defaults.is_empty() {
            return defaults;
        }
    }

    out
}

/// Retrieves the list of user-configured agents from the 'settings.json' store.
pub fn get_agents(app_handle: &AppHandle) -> Vec<crate::manager::AgentConfig> {
    if let Some(obj) = load_settings_object(app_handle) {
        if let Some(agents_val) = obj.get("agents") {
            if let Ok(mut agents) = serde_json::from_value::<Vec<crate::manager::AgentConfig>>(
                agents_val.clone(),
            ) {
                for agent in agents.iter_mut() {
                    agent.tools = normalize_agent_tools(&agent.id, &agent.tools);
                }
                return agents;
            }
        }
    }

    vec![]
}

/// Retrieves disabled tool IDs from settings.
pub fn get_disabled_tools(app_handle: &AppHandle) -> HashSet<String> {
    if let Some(obj) = load_settings_object(app_handle) {
        if let Some(disabled) = obj.get("disabledTools").and_then(|v| v.as_array()) {
            return disabled
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
        }
    }
    HashSet::new()
}

/// Kernel configuration struct populated from Tauri Store settings.
#[derive(Debug, Clone)]
pub struct KernelConfig {
    pub main_model: String,
    pub extractor_model: String,
    pub scheduling_policy: String,
    pub max_queue_size: usize,
    pub priority_aging_threshold: u64,
    pub priority_aging_boost: u8,
    pub drr_quantum: u64,
    pub wfq_default_weight: f64,
    pub default_max_tokens: usize,
    pub reserved_token_pct: u8,
    pub auto_prune: bool,
    pub auto_compact: bool,
    pub default_agent_strategy: String,
    pub auto_versioning: bool,
    pub max_versions_per_file: u32,
    pub auto_tagging: bool,
    pub compaction_threshold: u8,
    pub max_memories_per_agent: u32,
    pub reflection_enabled: bool,
    pub reflection_interval_mins: u64,
    pub reflection_model: Option<String>,
    // ── Tool RAG (Single-Agent Loop) ──
    pub tool_rag_enabled: bool,
    pub tool_rag_top_k: usize,
    // ── Intent Cache (Semantic Tool Shortcuts) ──
    pub enable_intent_cache: bool,
    pub intent_cache_threshold: f32,
}

impl Default for KernelConfig {
    fn default() -> Self {
        Self {
            main_model: "openai:gpt-5-mini".to_string(),
            extractor_model: "openai:gpt-4o-mini".to_string(),
            scheduling_policy: "FIFO".to_string(),
            max_queue_size: 100,
            priority_aging_threshold: 500,
            priority_aging_boost: 2,
            drr_quantum: 1000,
            wfq_default_weight: 1.0,
            default_max_tokens: 16384,
            reserved_token_pct: 10,
            auto_prune: true,
            auto_compact: false,
            default_agent_strategy: "ReAct".to_string(),
            auto_versioning: true,
            max_versions_per_file: 5,
            auto_tagging: true,
            compaction_threshold: 80,
            max_memories_per_agent: 500,
            reflection_enabled: true,
            reflection_interval_mins: 60,
            reflection_model: Some("gpt-5-mini".to_string()),
            tool_rag_enabled: true,
            tool_rag_top_k: 12,
            enable_intent_cache: true,
            intent_cache_threshold: 0.93,
        }
    }
}

/// Reads all kernel-related settings from the Tauri Store.
/// Falls back to defaults for any missing or malformed values.
pub fn get_kernel_config(app_handle: &AppHandle) -> KernelConfig {
    let obj = match load_settings_object(app_handle) {
        Some(o) => o,
        None => return KernelConfig::default(),
    };

    KernelConfig {
        main_model: obj
            .get("kernelMainModel")
            .and_then(|v| v.as_str())
            .unwrap_or("openai:gpt-5-mini")
            .to_string(),
        extractor_model: obj
            .get("kernelExtractorModel")
            .and_then(|v| v.as_str())
            .unwrap_or("openai:gpt-4o-mini")
            .to_string(),
        scheduling_policy: obj
            .get("kernelSchedulingPolicy")
            .and_then(|v| v.as_str())
            .unwrap_or("FIFO")
            .to_string(),
        max_queue_size: obj
            .get("kernelMaxQueueSize")
            .and_then(|v| v.as_u64())
            .unwrap_or(100) as usize,
        priority_aging_threshold: obj
            .get("kernelPriorityAgingThreshold")
            .and_then(|v| v.as_u64())
            .unwrap_or(500),
        priority_aging_boost: obj
            .get("kernelPriorityAgingBoost")
            .and_then(|v| v.as_u64())
            .unwrap_or(2) as u8,
        drr_quantum: obj
            .get("kernelDrrQuantum")
            .and_then(|v| v.as_u64())
            .unwrap_or(1000),
        wfq_default_weight: obj
            .get("kernelWfqDefaultWeight")
            .and_then(|v| v.as_f64())
            .unwrap_or(1.0),
        default_max_tokens: obj
            .get("kernelDefaultMaxTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(8192) as usize,
        reserved_token_pct: obj
            .get("kernelReservedTokenPct")
            .and_then(|v| v.as_u64())
            .unwrap_or(10) as u8,
        auto_prune: obj
            .get("kernelAutoPrune")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        auto_compact: obj
            .get("kernelAutoCompact")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        default_agent_strategy: obj
            .get("kernelDefaultAgentStrategy")
            .and_then(|v| v.as_str())
            .unwrap_or("ReAct")
            .to_string(),
        auto_versioning: obj
            .get("kernelAutoVersioning")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        max_versions_per_file: obj
            .get("kernelMaxVersionsPerFile")
            .and_then(|v| v.as_u64())
            .unwrap_or(5) as u32,
        auto_tagging: obj
            .get("kernelAutoTagging")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        compaction_threshold: obj
            .get("kernelCompactionThreshold")
            .and_then(|v| v.as_u64())
            .unwrap_or(80) as u8,
        max_memories_per_agent: obj
            .get("kernelMaxMemoriesPerAgent")
            .and_then(|v| v.as_u64())
            .unwrap_or(500) as u32,
        reflection_enabled: obj
            .get("kernelReflectionEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        reflection_interval_mins: obj
            .get("kernelReflectionIntervalMins")
            .and_then(|v| v.as_u64())
            .unwrap_or(60),
        reflection_model: obj
            .get("kernelReflectionModel")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tool_rag_enabled: obj
            .get("toolRagEnabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        tool_rag_top_k: obj
            .get("toolRagTopK")
            .and_then(|v| v.as_u64())
            .unwrap_or(12) as usize,
        enable_intent_cache: obj
            .get("enableIntentCache")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        intent_cache_threshold: obj
            .get("intentCacheThreshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.90) as f32,
    }
}

/// A2UI JSONL format per https://a2ui.org/specification/v0.8-a2ui/
/// STRICT: One complete JSON object per line. No pretty-printing. No newlines inside JSON.
const A2UI_RESPONSE_FORMAT: &str = r##"RESPONSE FORMAT: A2UI v0.8 JSONL stream. https://a2ui.org

RULES (mandatory):
- Output ONLY valid JSON Lines: one complete JSON object per line.
- Each line MUST be a single, compact JSON object (no newlines inside, no indentation).
- NO markdown, NO code fences, NO explanatory text. Output ONLY the JSONL stream.
- Messages: surfaceUpdate, dataModelUpdate, beginRendering, summary, design.

ARCHITECTURE (follow strictly):
1. STRUCTURE FIRST: Use "beginRendering" + "surfaceUpdate" to define the component SKELETON (layout, types, children).
2. DATA SECOND: Use "dataModelUpdate" to fill components with content. Bind component props to data paths.
3. UPSERT SEMANTICS: surfaceUpdate with an existing "id" UPDATES that component. NEVER create a duplicate ID.
4. If you see "[A2UI STATE]" in your context, those components ALREADY EXIST. Do NOT re-create them. Use dataModelUpdate to update their content, or surfaceUpdate to modify their properties.

SHORTHAND SYNTAX:
- {"surfaceUpdate": {"id": "comp-1", "Text": "content"}} to upsert a SINGLE component.
- {"surfaceUpdate": {"surfaceId": "card-1", "components": [{"id": "c1", "Text": "..."}]}} for MULTIPLE.

FLOW:
1. "beginRendering" FIRST with surfaceId and root ID.
2. "surfaceUpdate" for root ("Column") defining children IDs in "explicitList".
3. "surfaceUpdate" for each child component (creation or update).
4. "dataModelUpdate" to inject dynamic data after tool calls.

Example:
{"beginRendering":{"surfaceId":"card-1","root":"root"}}
{"surfaceUpdate":{"surfaceId":"card-1","components":[{"id":"root","Column":{"children":{"explicitList":["h1","b1"]}}}]}}
{"surfaceUpdate":{"id":"h1","Text":"Loading...","usageHint":"h1"}}
{"surfaceUpdate":{"id":"b1","Callout":{"content":"Searching...", "variant": "info"}}}

After tool results, UPDATE existing components:
{"surfaceUpdate":{"id":"h1","Text":"Results Found","usageHint":"h1"}}
{"surfaceUpdate":{"id":"b1","Callout":{"content":"Here is what I found.", "variant": "success"}}}

Components: Text(text,style/variant), Image(url,caption), ListBlock(items:[{text,icon}],ordered), Callout(content,variant,title), CodeBlock(code,language), DataGrid(items:[{label,value,icon}]), ActionRow(actions:[{label,intent,primary}]), ImageGallery(images:[{url,caption}]), Column(children.explicitList).
Layout/Content: Tabs(tabs:[{id,title,icon}],activeTabId), Accordion(title,icon,defaultExpanded), Carousel(autoPlay), Timeline(events:[{title,timestamp,description,status:done|active|pending}]), BadgeSet(badges:[{label,color,icon}]), Separator(label).
Interactive: Input(label,value,placeholder), Select(label,value,options:[{value,label}]), Toggle(label,checked), Slider(label,value,min,max,step), DatePicker(label,date).
Media/Data: Map(latitude,longitude,zoom), AudioPlayer(url,title,artist), VideoPlayer(url,title), Markdown(content), ProgressBar(items:[{label,value,color}]), StatsRow(stats:[{label,value,trend}]), LinkPreview(url,title,description), TableBlock(headers[],rows[][]), CanvasBlock(title,canvas_type:bar|line,items:[{label,value,color}]).

Output ONLY JSONL."##;

/// Returns the A2UI v0.8 JSONL response format instruction.
/// A2UI is the only supported rendering protocol — always active for task/card mode.
pub fn get_agent_response_format_instruction(_app_handle: &AppHandle) -> String {
    A2UI_RESPONSE_FORMAT.to_string()
}

/// Format instruction for OS chat mode. Plain text, no JSON, no A2UI.
pub const OS_CHAT_RESPONSE_FORMAT: &str = r##"RESPONSE FORMAT: Plain text only.
- Output ONLY natural language. No JSON, no A2UI, no code fences.
- You may use simple markdown for structure: **bold**, *italic*, lists (- item), headers (## Title), or links [text](url).
- Keep replies concise and conversational. Do NOT output JSONL or structured data."##;

/// Resolves the maximum token limit for a specific model based on kernel settings.
pub fn get_model_max_tokens(model: &str, default_limit: usize) -> usize {
    let lower = model.to_lowercase();

    // GPT-5 Mini and other high-context reasoning models
    if lower.contains("gpt-5-mini") || lower.contains("o1") || lower.contains("o3") {
        return 400_000;
    }

    // Default to kernel setting
    default_limit
}
