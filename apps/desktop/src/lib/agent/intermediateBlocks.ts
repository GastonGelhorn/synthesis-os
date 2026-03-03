/**
 * Intermediate Block Generation for Progressive Agent UI
 *
 * Generates lightweight UI blocks during agent execution so the user
 * sees content appearing dynamically as tools run, rather than waiting
 * for the final card.
 *
 * Two block categories:
 * 1. **Intermediate** (_isIntermediate: true) — transient "running" indicators
 *    that get replaced when the tool result arrives.
 * 2. **Rich** (no _isIntermediate) — permanent blocks built from actual tool
 *    results that survive into the final card.
 *
 * Each intermediate block carries a `_toolStepId` marker so the merge
 * logic can replace them cleanly when the tool result or final card arrives.
 */

import type { AgentStep } from "./types";

/** Extended UIBlock with optional step tracking marker */
export interface IntermediateBlock {
    type: "callout" | "text_block" | "list_block" | "stats_row" | "data_grid"
    | "code_block" | "link_preview" | "image_gallery" | "hero_image"
    | "separator" | "action_row" | "progress_bar" | "table_block" | "canvas_block";
    variant?: "info" | "success" | "error" | "warning";
    title?: string;
    content?: string;
    /** Internal marker — used to find & replace this block later */
    _toolStepId?: string;
    /** Whether this is a transient "running" indicator */
    _isIntermediate?: boolean;
    /** Tool name for dedup during final card merge */
    _toolName?: string;
    /** Step index for ordering */
    _stepIndex?: number;
    [key: string]: unknown;
}

// ── Tool display metadata ──

interface ToolMeta {
    icon: string;
    label: string;
    /** Category for grouping in the UI */
    category: "web" | "macos" | "system" | "knowledge" | "media" | "workspace" | "code";
    /** Extract a short description from the tool input */
    describeInput?: (input: string) => string;
    /** Generate a contextual "in progress" message */
    activeMessage?: (input: string) => string;
}

function safeParse(input: string): Record<string, unknown> | null {
    try {
        return JSON.parse(input);
    } catch {
        return null;
    }
}

const TOOL_META: Record<string, ToolMeta> = {
    // ── Web & Research ──
    web_search: {
        icon: "🔍",
        label: "Web Search",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Searching: "${parsed?.query || parsed?.q || input.slice(0, 60)}"`;
        },
        activeMessage: (input) => {
            const parsed = safeParse(input);
            const q = parsed?.query || parsed?.q || input.slice(0, 40);
            return `Searching the web for "${q}"...`;
        },
    },
    read_page: {
        icon: "📖",
        label: "Reading Page",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            const url = parsed?.url || parsed?.href || input;
            return `Reading: ${truncateUrl(String(url))}`;
        },
        activeMessage: (input) => {
            const parsed = safeParse(input);
            const url = parsed?.url || parsed?.href || input;
            return `Extracting content from ${truncateUrl(String(url))}...`;
        },
    },
    summarize_url: {
        icon: "📝",
        label: "Summarizing Page",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Summarizing: ${truncateUrl(String(parsed?.url || input))}`;
        },
    },
    screenshot_url: {
        icon: "📸",
        label: "Capturing Page",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Capturing: ${truncateUrl(String(parsed?.url || input))}`;
        },
    },
    http_request: {
        icon: "🌐",
        label: "HTTP Request",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            const method = parsed?.method || "GET";
            const url = parsed?.url || input;
            return `${String(method).toUpperCase()} ${truncateUrl(String(url))}`;
        },
    },
    youtube_search: {
        icon: "▶",
        label: "YouTube Search",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Searching YouTube: "${parsed?.query || input.slice(0, 60)}"`;
        },
    },
    rss_reader: {
        icon: "📡",
        label: "RSS Feed",
        category: "web",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Reading feed: ${truncateUrl(String(parsed?.url || input))}`;
        },
    },

    // ── macOS Apps ──
    email_reader: {
        icon: "📧",
        label: "Reading Email",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.query) return `Searching: "${parsed.query}"`;
            if (parsed?.account) return `Checking: ${parsed.account}`;
            return "Reading inbox";
        },
        activeMessage: () => "Accessing Apple Mail...",
    },
    email_list: { icon: "📧", label: "Checking Inbox", category: "macos" },
    calendar: {
        icon: "📅",
        label: "Calendar",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.action === "create") return `Creating: "${parsed?.title || "event"}"`;
            return "Checking calendar";
        },
        activeMessage: () => "Reading Apple Calendar via EventKit...",
    },
    calendar_today: { icon: "📅", label: "Today's Events", category: "macos" },
    calendar_create: {
        icon: "📅",
        label: "Creating Event",
        category: "macos",
        activeMessage: (input) => {
            const parsed = safeParse(input);
            return `Creating calendar event "${parsed?.title || "new event"}"...`;
        },
    },
    contacts: {
        icon: "👤",
        label: "Contacts",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return parsed?.query ? `Searching: "${parsed.query}"` : "Listing contacts";
        },
        activeMessage: (input) => {
            const parsed = safeParse(input);
            return parsed?.query ? `Searching contacts for "${parsed.query}"...` : "Reading contacts list...";
        },
    },
    contacts_search: { icon: "👤", label: "Searching Contacts", category: "macos" },
    reminders: {
        icon: "✅",
        label: "Reminders",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.action === "create") return `Creating: "${parsed?.title || "reminder"}"`;
            return "Checking reminders";
        },
    },
    reminders_list: { icon: "✅", label: "Listing Reminders", category: "macos" },
    reminders_add: {
        icon: "✅",
        label: "Creating Reminder",
        category: "macos",
        activeMessage: (input) => {
            const parsed = safeParse(input);
            return `Creating reminder "${parsed?.title || "new reminder"}"...`;
        },
    },
    notes: {
        icon: "📝",
        label: "Apple Notes",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.action === "create") return `Creating: "${parsed?.title || "note"}"`;
            if (parsed?.action === "read") return `Reading: "${parsed?.title || "note"}"`;
            return "Browsing notes";
        },
    },
    finder: {
        icon: "📁",
        label: "Finder",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return parsed?.path ? `Opening: ${parsed.path}` : "Managing files";
        },
    },
    music: {
        icon: "🎵",
        label: "Apple Music",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.action === "play") return `Playing: "${parsed?.query || "music"}"`;
            if (parsed?.action === "search") return `Searching: "${parsed?.query || ""}"`;
            return String(parsed?.action || "Controlling music");
        },
        activeMessage: () => "Controlling Apple Music...",
    },
    safari_tabs: {
        icon: "🧭",
        label: "Safari",
        category: "macos",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.url) return `Opening: ${truncateUrl(String(parsed.url))}`;
            return "Managing Safari tabs";
        },
    },

    // ── macOS System ──
    clipboard: { icon: "📋", label: "Clipboard", category: "system" },
    open_app: {
        icon: "🚀",
        label: "Opening App",
        category: "system",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Opening: ${parsed?.name || parsed?.app || input.slice(0, 40)}`;
        },
    },
    desktop_screenshot: { icon: "📸", label: "Screenshot", category: "system" },
    volume_brightness: {
        icon: "🔈",
        label: "Volume/Brightness",
        category: "system",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.type === "volume") return `Setting volume: ${parsed?.value ?? parsed?.level ?? ""}`;
            if (parsed?.type === "brightness") return `Setting brightness: ${parsed?.value ?? parsed?.level ?? ""}`;
            return "Adjusting volume/brightness";
        },
    },
    say_tts: {
        icon: "🔊",
        label: "Speaking",
        category: "system",
        describeInput: (input) => {
            const parsed = safeParse(input);
            const text = parsed?.text || input;
            return `Speaking: "${String(text).slice(0, 50)}${String(text).length > 50 ? "…" : ""}"`;
        },
    },
    dark_mode: { icon: "🌙", label: "Dark Mode", category: "system" },
    file_manager: {
        icon: "📁",
        label: "File Manager",
        category: "system",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return parsed?.path ? `Reading: ${parsed.path}` : "Managing files";
        },
    },
    notify: { icon: "🔔", label: "Notification", category: "system" },
    spotlight_search: {
        icon: "🔦",
        label: "Spotlight Search",
        category: "system",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Searching: "${parsed?.query || input.slice(0, 40)}"`;
        },
    },
    system_info: { icon: "💻", label: "System Info", category: "system" },
    battery_info: { icon: "🔋", label: "Battery", category: "system" },
    wifi_info: {
        icon: "📶",
        label: "WiFi",
        category: "system",
        activeMessage: () => "Checking WiFi status and available networks...",
    },

    // ── Knowledge & Utilities ──
    weather: {
        icon: "🌤",
        label: "Weather",
        category: "knowledge",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Weather for: ${parsed?.location || parsed?.city || "current location"}`;
        },
        activeMessage: (input) => {
            const parsed = safeParse(input);
            return `Fetching weather for ${parsed?.location || parsed?.city || "your location"}...`;
        },
    },
    calculate: {
        icon: "🧮",
        label: "Calculator",
        category: "knowledge",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Computing: ${parsed?.expression || input.slice(0, 50)}`;
        },
    },
    translate: {
        icon: "🌍",
        label: "Translator",
        category: "knowledge",
        describeInput: (input) => {
            const parsed = safeParse(input);
            const text = parsed?.text || input;
            return `Translating: "${String(text).slice(0, 40)}${String(text).length > 40 ? "…" : ""}"`;
        },
    },
    define_word: {
        icon: "📖",
        label: "Dictionary",
        category: "knowledge",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Defining: "${parsed?.word || input.slice(0, 30)}"`;
        },
    },
    currency_convert: {
        icon: "💱",
        label: "Currency",
        category: "knowledge",
        describeInput: (input) => {
            const parsed = safeParse(input);
            if (parsed?.from && parsed?.to) return `${parsed.amount || ""} ${parsed.from} → ${parsed.to}`;
            return "Converting currency";
        },
    },

    // ── Media & Generation ──
    search_images: {
        icon: "🖼",
        label: "Image Search",
        category: "media",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Finding images: "${parsed?.query || input.slice(0, 60)}"`;
        },
    },
    image_description: { icon: "🔍", label: "Analyzing Image", category: "media" },
    qr_code: { icon: "📱", label: "QR Code", category: "media" },
    generate_code: {
        icon: "💻",
        label: "Code Generation",
        category: "code",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Generating: ${parsed?.language || "code"}`;
        },
    },

    // ── Workspace ──
    set_timer: {
        icon: "⏱",
        label: "Timer",
        category: "workspace",
        describeInput: (input) => {
            const parsed = safeParse(input);
            return `Setting timer: ${parsed?.duration || parsed?.seconds || ""}s`;
        },
    },
    summarize_nodes: {
        icon: "📊",
        label: "Workspace Summary",
        category: "workspace",
        activeMessage: () => "Analyzing workspace content and synthesizing summary...",
    },

    // ── Memory tools (intercepted in Rust but shown in UI) ──
    remember: { icon: "🧠", label: "Remembering", category: "workspace" },
    core_memory_append: { icon: "🧠", label: "Saving Memory", category: "workspace" },
    core_memory_replace: { icon: "🧠", label: "Updating Memory", category: "workspace" },
};

function truncateUrl(url: string): string {
    try {
        const u = new URL(url);
        const host = u.hostname.replace("www.", "");
        const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + "..." : u.pathname;
        return `${host}${path === "/" ? "" : path}`;
    } catch {
        return url.length > 50 ? url.slice(0, 50) + "..." : url;
    }
}

/** Get tool metadata (exported for HybridAgentCard) */
export function getToolMeta(toolName: string): ToolMeta {
    return TOOL_META[toolName] || {
        icon: "⚡",
        label: humanizeToolName(toolName),
        category: "workspace" as const,
    };
}

/** Get the category icon for a tool category */
export function getCategoryIcon(category: string): string {
    switch (category) {
        case "web": return "🌐";
        case "macos": return "🍎";
        case "system": return "⚙️";
        case "knowledge": return "📚";
        case "media": return "🎨";
        case "workspace": return "📋";
        case "code": return "💻";
        default: return "⚡";
    }
}

// ── Block Builders ──

/**
 * Build an intermediate UI block from an agent step.
 * Called on step_started (running state) and step_completed (result state).
 */
export function buildIntermediateBlock(step: AgentStep): IntermediateBlock | null {
    if (step.type !== "tool_call" || !step.toolName) return null;

    const meta = getToolMeta(step.toolName);

    // ── Running state: show what tool is doing ──
    if (step.status === "running" || step.status === "pending") {
        const description = meta.activeMessage && step.toolInput
            ? meta.activeMessage(step.toolInput)
            : meta.describeInput && step.toolInput
                ? meta.describeInput(step.toolInput)
                : `Running ${meta.label.toLowerCase()}...`;

        return {
            type: "callout",
            variant: "info",
            title: `${meta.icon} ${meta.label}`,
            content: description,
            _toolStepId: step.id,
            _isIntermediate: true,
            _toolName: step.toolName,
            _stepIndex: step.index,
        };
    }

    // ── Completed state: show result preview ──
    if (step.status === "completed") {
        if (step.toolResult?.success) {
            const preview = step.toolResult.text
                ? step.toolResult.text.slice(0, 150) + (step.toolResult.text.length > 150 ? "..." : "")
                : "Completed successfully";

            return {
                type: "callout",
                variant: "success",
                title: `${meta.icon} ${meta.label}`,
                content: preview,
                _toolStepId: step.id,
                _isIntermediate: true,
                _toolName: step.toolName,
                _stepIndex: step.index,
            };
        } else {
            return {
                type: "callout",
                variant: "error",
                title: `${meta.icon} ${meta.label} — Error`,
                content: step.toolResult?.error || step.error || "Tool execution failed",
                _toolStepId: step.id,
                _isIntermediate: true,
                _toolName: step.toolName,
                _stepIndex: step.index,
            };
        }
    }

    // ── Failed state ──
    if (step.status === "failed") {
        return {
            type: "callout",
            variant: "error",
            title: `${meta.icon} ${meta.label} — Failed`,
            content: step.error || "Unknown error",
            _toolStepId: step.id,
            _isIntermediate: true,
            _toolName: step.toolName,
            _stepIndex: step.index,
        };
    }

    return null;
}

/**
 * Build a phase-aware status block for the thinking/routing phase.
 * These are used when no tool results are available yet to show
 * what the agent is currently doing.
 */
export function buildPhaseBlock(
    phase: "reasoning" | "planning" | "preparing",
    detail: string,
    _agentId?: string,
): IntermediateBlock {
    const phaseConfig = {
        reasoning: {
            icon: "🧠",
            title: "Reasoning",
            variant: "info" as const,
        },
        planning: {
            icon: "📋",
            title: "Planning Actions",
            variant: "info" as const,
        },
        preparing: {
            icon: "🔧",
            title: "Selecting Tools",
            variant: "info" as const,
        },
    };

    const config = phaseConfig[phase];
    return {
        type: "callout",
        variant: config.variant,
        title: `${config.icon} ${config.title}`,
        content: detail,
        _isIntermediate: true,
        _toolStepId: `phase-${phase}`,
    };
}

/**
 * Build a reasoning callout from an LLM reasoning step.
 */
export function buildReasoningBlock(reasoning: string): IntermediateBlock {
    const shortReasoning = reasoning.length > 120
        ? reasoning.slice(0, 120) + "..."
        : reasoning;

    return {
        type: "callout",
        variant: "info",
        title: "🧠 Thinking",
        content: shortReasoning,
        _isIntermediate: true,
    };
}

/**
 * Merge intermediate blocks with final card blocks.
 *
 * Strategy:
 * 1. Collect all permanent blocks (non-intermediate rich blocks from tool results)
 * 2. From the final card blocks, only keep those that add new value:
 *    - Headings, summaries, separators, action rows
 *    - Blocks for tools we don't already have results for
 * 3. Remove ALL intermediate callout blocks (running/completed indicators)
 */
export function mergeWithFinalBlocks(
    currentBlocks: any[],
    finalBlocks: any[],
): any[] {
    // Collect permanent rich blocks from progressive tool results
    const permanentBlocks = currentBlocks.filter(
        (b) => !b._isIntermediate,
    );

    // If no final blocks, just return permanent blocks
    if (!finalBlocks || finalBlocks.length === 0) {
        return permanentBlocks.length > 0 ? permanentBlocks : currentBlocks;
    }

    // If no permanent blocks, use final blocks entirely
    if (permanentBlocks.length === 0) {
        return finalBlocks;
    }

    // LLM Authority: When finalBlocks are available, the LLM has already
    // incorporated tool results. Discard progressive tool-result blocks
    // to avoid duplication and messy ordering.
    if (finalBlocks.length > 0) {
        const nonToolBlocks = permanentBlocks.filter(
            (b) => !b._toolName && !(b as any)._isToolError,
        );
        return [...nonToolBlocks, ...finalBlocks];
    }

    return permanentBlocks;
}

// ── Helpers ──

function humanizeToolName(toolName: string): string {
    return toolName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}
