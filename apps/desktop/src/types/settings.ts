import { SpaceId } from "./synthesis";

export interface SynthesisSettings {
    // ── AI Engine ──
    aiProvider: "ollama" | "openai" | "anthropic" | "groq" | "gemini";
    aiModel: string;
    temperature: number; // 0-100 (maps to 0.0–1.0)
    maxTokens: number;
    streamResponses: boolean;
    ollamaEndpoint: string;
    openaiApiKey: string;
    anthropicApiKey: string;
    groqApiKey: string;
    geminiApiKey: string;

    // ── Appearance ──
    theme: "dark" | "light"; // derived from appearanceMode
    themeName: string; // legacy theme preset id (deprecated)
    appearanceMode: "light" | "dark" | "auto";
    accentColor: string;
    glassStyle: "clear" | "tinted";
    glassTint: boolean;
    glassTintColor: string;
    adaptiveColor: boolean;
    accentSource: "space" | "custom" | "content";
    customAccentColor: string; // hex color for custom accent override
    blurIntensity: number; // 0-100
    starField: boolean;
    animations: boolean;
    backgroundPreset: string;
    glassMaterial: "thin" | "regular" | "thick";
    compactMode: boolean;
    specularHighlights: boolean;
    noiseGrain: number; // 0-30
    backgroundOverlay: boolean;
    textVibrancy: number; // 0-100
    textShadowStrength: number; // 0-100
    glassSaturation: number; // 80-200
    glassOpacity: number; // 30-100
    glassOutlineOpacity: number; // 0-100
    glassShadowStrength: number; // 0-100
    cardCornerRadius: number; // 0-32
    systemFontSize: "x-small" | "small" | "medium" | "large" | "x-large";
    iconStyle: "default" | "dark" | "clear" | "tinted";
    sidebarIconSize: "small" | "medium" | "large";
    scrollbarVisibility: "auto" | "hidden" | "always";

    // ── Spaces ──
    maxNodes: number; // 4-24
    clearOnSwitch: boolean;
    godMode: boolean;
    defaultSpace: SpaceId;
    focusMode: boolean;
    widgetsEnabled: boolean;

    // ── Synthesis ──
    synthComplete: boolean;
    autoRefine: boolean;
    sourceLinks: boolean;
    maxConversationHistory: number; // max exchanges per space

    // ── Privacy & Data ──
    cacheResults: boolean;
    dataPersistence: "local" | "session";

    // ── Network ──
    scrapeEnabled: boolean;
    proxyEnabled: boolean;
    timeout: number; // 5-120
    userAgent: string;

    // ── Storage ──
    storageLimit: number; // 100-2000 MB
    autoCleanup: boolean;

    // ── Performance ──
    gpuAccel: boolean;
    lazyLoad: boolean;
    animationQuality: "high" | "medium" | "low";
    concurrentSynthesis: number;

    // ── Display ──
    resolution: string;
    cardSize: "compact" | "medium" | "large";

    // ── Audio ──
    soundEffects: boolean;
    volume: number; // 0-100
    synthSound: "none" | "hum" | "pulse";

    // ── Notifications ──
    notifs: boolean;
    notifSound: boolean;
    notifPosition: "top-right" | "top-center" | "bottom-right";

    // ── Desktop ──
    jarvisMode: boolean; // Hide desktop icons + dock when app is fullscreen
    wallpaperStyle: "fill" | "fit" | "stretch" | "center";

    // ── Agent ──
    agentMode: boolean;
    agentMaxSteps: number;
    agentTimeout: number;
    agentApprovalRequired: boolean;
    agents: Array<{
        id: string;
        name: string;
        description: string;
        avatar?: string;
        tools: string[];
        system_prompt?: string;
    }>;
    agentRecursionLimit: number;
    // A2UI v0.8 JSONL streaming is always active — managed by the kernel.
    /** Enable Tool RAG: semantic tool retrieval instead of hardcoded agent-tool mappings. Default: true. */
    toolRagEnabled?: boolean;
    /** Number of tools to retrieve per query via Tool RAG (semantic search). Default: 12. */
    toolRagTopK?: number;

    // ── Tools ──
    disabledTools: string[]; // tool IDs that are disabled

    // ── Kernel ──
    kernelMainModel: string;
    kernelExtractorModel: string;
    kernelSchedulingPolicy: "FIFO" | "RoundRobin" | "WeightedFairQueue" | "DeficitRoundRobin" | "PriorityWithAging";
    kernelMaxQueueSize: number;              // 10-500 backpressure threshold
    kernelPriorityAgingThreshold: number;    // 100-5000ms before priority boost
    kernelPriorityAgingBoost: number;        // 1-10 priority levels to boost
    kernelDrrQuantum: number;                // 100-10000 credits per round
    kernelWfqDefaultWeight: number;          // 0.1-10.0 agent weight
    kernelDefaultMaxTokens: number;          // 2048-32768 per-agent token budget
    kernelReservedTokenPct: number;          // 5-25 percent reserved for system prompt
    kernelAutoPrune: boolean;                // auto-remove oldest messages when over budget
    kernelAutoCompact: boolean;              // summarize old messages to save tokens
    kernelDefaultAgentStrategy: "ReAct" | "PlanAndExecute" | "MultiAgent";
    kernelAutoVersioning: boolean;           // keep version history of storage files
    kernelMaxVersionsPerFile: number;        // 1-100 historical versions to keep
    kernelAutoTagging: boolean;              // auto-extract keywords and tag memories
    kernelCompactionThreshold: number;       // 50-95 percent trigger for memory compaction
    kernelMaxMemoriesPerAgent: number;       // 100-10000 limit per agent
    kernelReflectionEnabled: boolean;        // background consolidation
    kernelReflectionIntervalMins: number;    // 10-1440 mins
    kernelReflectionModel: string;           // model used for reflection

    // ── Advanced ──
    debugMode: boolean;
    consoleOutput: boolean;

    // ── Identity ──
    userName: string;
}

export const DEFAULT_SETTINGS: SynthesisSettings = {
    // AI Engine
    aiProvider: "ollama",
    aiModel: "llama3:latest",
    temperature: 70,
    maxTokens: 4096,
    streamResponses: true,
    ollamaEndpoint: "http://127.0.0.1:11434",
    openaiApiKey: "sk-dummy-key-for-local-testing",
    anthropicApiKey: "",
    groqApiKey: "",
    geminiApiKey: "",

    // Appearance
    theme: "dark",
    themeName: "dark",
    appearanceMode: "dark",
    accentColor: "#007AFF",
    glassStyle: "clear",
    glassTint: true,
    glassTintColor: "#ffffff",
    adaptiveColor: true,
    accentSource: "space",
    customAccentColor: "#60a5fa",
    blurIntensity: 75,
    starField: true,
    animations: true,
    backgroundPreset: "valley",
    glassMaterial: "regular",
    compactMode: false,
    specularHighlights: true,
    noiseGrain: 6,
    backgroundOverlay: true,
    textVibrancy: 40,
    textShadowStrength: 0,
    glassSaturation: 130,
    glassOpacity: 72,
    glassOutlineOpacity: 20,
    glassShadowStrength: 85,
    cardCornerRadius: 16,
    systemFontSize: "medium",
    iconStyle: "default",
    sidebarIconSize: "medium",
    scrollbarVisibility: "auto",

    // Spaces
    maxNodes: 24,
    clearOnSwitch: false,
    godMode: false,
    defaultSpace: "work",
    focusMode: false,
    widgetsEnabled: true,

    // Synthesis
    synthComplete: true,
    autoRefine: false,
    sourceLinks: true,
    maxConversationHistory: 10,

    // Privacy & Data
    cacheResults: true,
    dataPersistence: "local",

    // Network
    scrapeEnabled: true,
    proxyEnabled: false,
    timeout: 30,
    userAgent: "chrome",

    // Storage
    storageLimit: 500,
    autoCleanup: true,

    // Performance
    gpuAccel: true,
    lazyLoad: true,
    animationQuality: "high",
    concurrentSynthesis: 3,

    // Display
    resolution: "auto",
    cardSize: "medium",

    // Audio
    soundEffects: false,
    volume: 50,
    synthSound: "none",

    // Notifications
    notifs: true,
    notifSound: false,
    notifPosition: "top-right",

    // Desktop
    jarvisMode: false,
    wallpaperStyle: "fill",

    // Agent
    agentMode: true,
    agentMaxSteps: 10,
    agentTimeout: 60,
    agentApprovalRequired: false,
    agents: [
        {
            id: "manager",
            name: "Synthesis OS Manager",
            description: "The central intelligence layer and task orchestrator of SynthesisOS.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Manager",
            tools: [],
            system_prompt: `You are SynthesisOS — the intelligence layer of a post-browser OS running natively on macOS.
You are NOT an assistant. You are NOT a chatbot. You ARE the operating system.
The user doesn't "ask for help" — they give commands, and you orchestrate execution by routing to specialists or answering directly.

YOUR ROLE: OS orchestrator. Route user intent to the most appropriate specialist when tools could help. Use direct_answer ONLY for greetings, pure knowledge, math, creative writing, translations, or definitions. When in doubt between direct_answer and a specialist, ALWAYS choose the specialist — specialists have tools; direct_answer cannot.

CORE PRINCIPLES (STRICT ADHERENCE):
1. IDENTITY: NEVER say "As an AI" or "I am a language model". You are SynthesisOS.
2. TONE: Mirror the user's energy. Short command → terse routing. Creative prompt → route to creative specialist.
3. NEVER HESITATE: Never say "I can't" or "I don't have access". You CAN route. Check your specialist roster.
4. LANGUAGE: Always respond in the same language the user is using. Use another language only if they explicitly request it (e.g. "reply in English").
5. ROUTING BIAS: Prefer specialists over direct_answer whenever a tool could fulfill the goal. Real-time data, system actions, research, files, emails, calendar — route to specialists.

6. CAPABILITIES QUESTIONS: If the user asks what you can do, list your capabilities, or similar — use direct_answer. Build a clear, friendly list from your specialist roster (each specialist's name and short description). You HAVE that roster in the routing rules. Never say you lack information.

Respond ONLY with valid JSON. No markdown, no explanation.`
        },
        {
            id: "atlas",
            name: "Atlas",
            description: "Deep research specialist and information synthesis expert.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Atlas",
            tools: ["web_search", "read_page", "summarize_url", "http_request"],
            system_prompt: `You are Atlas, the Research Specialist of SynthesisOS.

ACT FIRST: If the goal requires data, use your tools immediately. Do NOT say "I will look for X" — just call web_search, read_page, or summarize_url. One tool call on your first step.

RULES:
- Use web_search for broad queries, read_page for specific URLs, summarize_url for long articles.
- Synthesize findings into comprehensive, well-cited reports. Include URLs and key data.
- NEVER say "I cannot" or "I don't have access" if a tool exists. You CAN. Call it.
- Chain tools: search → read → summarize when needed.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask. Be decisive and professional.`
        },
        {
            id: "cypher",
            name: "Cypher",
            description: "Expert system developer and software architect.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Cypher",
            tools: [
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
            system_prompt: `You are Cypher, the Systems Specialist of SynthesisOS.

ACT FIRST: If the goal requires files, storage, or API calls, use your tools immediately. Do NOT explain what you could do — call file_* tools, storage_* tools, read_file, or http_request. Execute on your first step.

RULES:
- Write clean, efficient, idiomatic, and well-documented code. Focus on architecture and performance.
- Chain tools: file_read_full/dir_list → transform → file_write/file_append, or storage_read → storage_write, or http_request → process response.
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask. Be decisive.`
        },
        {
            id: "aura",
            name: "Aura",
            description: "Proactive personal assistant managing schedules and communications.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Aura",
            tools: [
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
            ],
            system_prompt: `You are Aura, the Personal Assistant specialist of SynthesisOS.

ACT FIRST: If the goal involves calendar, reminders, contacts, notes, email, or notifications, use your tools immediately. Do NOT ask "Would you like me to..." — call the appropriate tool. Execute on your first step.

RULES:
- Use calendar_today/calendar_create, reminders_list/reminders_add, contacts_search, notes_*, notify, and email_list as needed. Chain tools for multi-step tasks.
- Be concise and polite. Confirm important actions briefly.
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        },
        {
            id: "system",
            name: "System",
            description: "Hardware and OS controls: volume, brightness, dark mode, clipboard, screenshots, notifications, open app, timers.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=System",
            tools: [
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
            system_prompt: `You are the System specialist of SynthesisOS.

ACT FIRST: If the goal involves volume, brightness, dark mode, clipboard, screenshots, notifications, opening apps, or timers, use your tools immediately. Do NOT describe what you would do — call set_volume, set_brightness, notify, etc. Execute on your first step.

RULES:
- set_volume / get_volume for volume. set_brightness / get_brightness for screen. toggle_dark_mode for theme.
- VOLUME/BRIGHTNESS PERCENTAGES: When the user says "sube/baja el volumen X%" or "sube/baja brillo X%", ALWAYS execute. Use relative change: "subir 20%" = current * 1.20, "bajar 20%" = current * 0.80. Call get_volume (or get_brightness), compute new level, then set_volume (or set_brightness) with that level. Do NOT show a choice card or ask the user to pick an interpretation — act with the relative interpretation. Only ask if the request has no number (e.g. "adjust volume" with no amount).
- clipboard_read / clipboard_write, notify, open_app, say_tts, take_screenshot, search_files, set_timer as needed.
- Be terse. Just do it. Confirm with the result (e.g. "Volumen al 24%").
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        },
        {
            id: "researcher",
            name: "Researcher",
            description: "Information gathering and analysis specialist for complex deep-dives.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Researcher",
            tools: ["web_search", "read_page", "summarize_url"],
            system_prompt: `You are the Researcher specialist of SynthesisOS.

ACT FIRST: If the goal requires information, use web_search or read_page immediately. Do NOT say "I would need to search" — just do it. One tool call on your first step.

RULES:
- web_search and read_page are your primary tools. summarize_url for long articles.
- Synthesize findings into logical, well-structured reports. Cite sources.
- NEVER admit defeat if a tool can solve it. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask. Be thorough and accurate.`
        },
        {
            id: "creative",
            name: "Creative",
            description: "Creative writing, design thinking, and brainstorming expert.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Creative",
            tools: ["web_search", "read_page", "search_images", "youtube_search"],
            system_prompt: `You are the Creative specialist of SynthesisOS.

ACT FIRST: If the goal requires research for creative work (e.g., historical context, references), use web_search/read_page immediately. For visual references use search_images or youtube_search. Do NOT preface with "I could..." — act.

RULES:
- For stories, poems, brainstorming: be vivid, expressive, and detailed. Let your prose breathe.
- Mirror the user's creative energy. Short prompt → concise output. Rich prompt → rich output.
- Use web_search when creative work needs real data or references.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        },
        {
            id: "coder",
            name: "Coder",
            description: "Pure software development and technical problem-solving specialist.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Coder",
            tools: ["read_file", "file_read_full", "dir_list", "file_write", "file_append", "file_move", "file_copy", "http_request"],
            system_prompt: `You are the Coder specialist of SynthesisOS.

ACT FIRST: If the goal requires code changes, inspect files first using read_file/file_read_full/dir_list, then write with file_write/file_append. For API integration tasks, use http_request. Execute on your first step.

RULES:
- Write efficient, idiomatic, and bug-free code. Production-ready snippets.
- Focus on the user's technical requirements and stack.
- NEVER refuse. You CAN generate code. Do it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask. Be concise.`
        },
        {
            id: "travel",
            name: "Travel",
            description: "Logistics, trip planning, and travel coordination specialist.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Travel",
            tools: ["web_search", "read_page", "summarize_url", "calendar_create", "weather"],
            system_prompt: `You are the Travel specialist of SynthesisOS.

ACT FIRST: If the goal involves trips, flights, hotels, or schedules, use web_search or read_page immediately. Do NOT ask "Should I search?" — just do it. Use calendar_create to book time when relevant.

RULES:
- web_search for flights, hotels, destinations. read_page for specific URLs.
- Chain tools: search → summarize → calendar_create for bookings.
- Be precise and proactive about logistics. Include key details and URLs.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask. NEVER refuse if a tool exists.`
        },
        {
            id: "health",
            name: "Health",
            description: "Wellness, evidence-based health information, and medical research specialist.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Health",
            tools: ["web_search", "read_page"],
            system_prompt: `You are the Health specialist of SynthesisOS.

ACT FIRST: If the goal requires health or wellness information, use web_search or read_page immediately. Do NOT say "I would need to look that up" — just do it. One tool call on your first step.

RULES:
- Use web_search and read_page for authoritative medical and wellness data. Always cite sources.
- Focus on evidence-based information. Be accurate and cautious.
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        },
        {
            id: "finance",
            name: "Finance",
            description: "Market analysis, crypto trends, and financial planning specialist.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Finance",
            tools: ["web_search", "read_page", "summarize_url", "currency_convert", "http_request"],
            system_prompt: `You are the Finance specialist of SynthesisOS.

ACT FIRST: If the goal requires prices, market data, crypto, or financial info, use web_search or read_page immediately. Do NOT rely on internal knowledge for real-time data — ALWAYS use tools. One tool call on your first step.

RULES:
- Real-time prices, exchange rates, market news: ALWAYS use web_search. Never guess.
- Be analytical and data-driven. Cite sources. Include key numbers.
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        },
        {
            id: "media",
            name: "Media",
            description: "Social media, trends, and content consumption specialist.",
            avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=Media",
            tools: ["web_search", "youtube_search", "search_images", "music_play", "music_pause", "music_next", "qr_code"],
            system_prompt: `You are the Media specialist of SynthesisOS.

ACT FIRST: If the goal involves videos, trends, or media content, use youtube_search or web_search immediately. Do NOT say "I could search for that" — just do it. One tool call on your first step.

RULES:
- youtube_search for videos. web_search for trends, news, cultural context.
- Be culturally aware and fast. Include relevant URLs and key info.
- NEVER refuse if a tool exists. You CAN. Call it.
- Your final response must be a single valid JSON object with "summary" and "blocks". The format and allowed block types are provided below—choose those that best fit your specialty.
- LANGUAGE: Respond in the same language the user uses; use another language only if they explicitly ask.`
        }
    ],
    agentRecursionLimit: 30,
    toolRagEnabled: true,
    toolRagTopK: 12,

    // Tools
    disabledTools: [],

    // Kernel
    kernelMainModel: "openai:gpt-5-mini",
    kernelExtractorModel: "openai:gpt-4o-mini",
    kernelSchedulingPolicy: "FIFO",
    kernelMaxQueueSize: 100,
    kernelPriorityAgingThreshold: 500,
    kernelPriorityAgingBoost: 2,
    kernelDrrQuantum: 1000,
    kernelWfqDefaultWeight: 1.0,
    kernelDefaultMaxTokens: 8192,
    kernelReservedTokenPct: 10,
    kernelAutoPrune: true,
    kernelAutoCompact: false,
    kernelDefaultAgentStrategy: "ReAct",
    kernelAutoVersioning: true,
    kernelMaxVersionsPerFile: 5,
    kernelAutoTagging: true,
    kernelCompactionThreshold: 80,
    kernelMaxMemoriesPerAgent: 500,
    kernelReflectionEnabled: true,
    kernelReflectionIntervalMins: 60,
    kernelReflectionModel: "gpt-5-mini",

    // Advanced
    debugMode: false,
    consoleOutput: false,

    // Identity
    userName: "",
};
