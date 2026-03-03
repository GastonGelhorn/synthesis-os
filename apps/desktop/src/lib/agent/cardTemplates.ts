/**
 * Deterministic card templates for known tool types.
 * These build AdaptiveNode cards instantly — no LLM call needed.
 */

import type { UIBlock } from "@/types/synthesis";
import { normalizeShorthandComponent } from "../a2ui/types";
import { a2uiComponentToBlock, blocksFromSurfaceUpdate } from "@/lib/a2ui";

const A2UI_COMPONENT_NAMES = new Set([
    "Text", "TextBlock", "Image", "HeroImage", "Divider", "Separator",
    "DataGrid", "ActionRow", "ImageGallery", "ListBlock", "CodeBlock",
    "ProgressBar", "StatsRow", "LinkPreview", "Callout", "TableBlock",
    "CanvasBlock", "Column", "Row", "List", "Card", "Button",
]);

interface ToolExecResult {
    success: boolean;
    text: string;
    data?: any;
    durationMs: number;
    sources?: string[];
}

interface CardObject {
    [key: string]: unknown; // Index signature for Record<string, unknown> compat
    title: string;
    type: "agent_task" | "note" | "media_player" | "browser" | "chat";
    summary: string;
    design: {
        accent_color: string;
        vibe: string;
        text_style: "sans" | "mono" | "serif";
        glass_opacity: number;
    };
    blocks: any[];
    suggested_width: number;
    suggested_height: number;
    sources: string[];
    logs: string[];
}

type TemplateBuilder = (
    query: string,
    toolResult: ToolExecResult,
    allResults: { tool: string; input: string; result: ToolExecResult }[],
    finalReasoning: string,
) => CardObject | null;

/** Detect if the query asks for both images AND textual info */
function isMultiPartImageQuery(query: string): boolean {
    const q = query.toLowerCase();
    const asksForImages = /\b(pictures?|photos?|show me)\b/i.test(q);
    const asksForInfo = /\b(about|tell me|what is|describe|info|what it is about)\b/i.test(q);
    return asksForImages && asksForInfo;
}

/** Extract image URLs from various text formats (tool output + LLM markdown) */
function extractImageUrls(text: string): { url: string; title: string }[] {
    const seen = new Set<string>();
    const results: { url: string; title: string }[] = [];

    const addUrl = (url: string, title: string) => {
        const clean = url.trim().replace(/[)}\]]+$/, ""); // strip trailing brackets
        if (!clean.startsWith("http")) return;
        if (seen.has(clean)) return;
        seen.add(clean);
        results.push({ url: clean, title: title.trim() || `Image ${results.length + 1}` });
    };

    // Strategy 1: Rust tool format — "  Image: https://..."
    const imageLineRe = /^\s*Image:\s*(https?:\/\/\S+)/gm;
    let match;
    while ((match = imageLineRe.exec(text)) !== null) {
        // Get title from the preceding "- Title" line
        const before = text.slice(0, match.index);
        const titleMatch = before.match(/-\s*([^\n]+?)\s*$/);
        addUrl(match[1], titleMatch ? titleMatch[1] : "");
    }

    // Strategy 2: Markdown links — [title](url)
    const mdLinkRe = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    while ((match = mdLinkRe.exec(text)) !== null) {
        const url = match[2];
        // Check if it looks like an image URL
        if (/\.(jpe?g|png|gif|webp|svg|bmp|avif)/i.test(url) || /image|img|photo|cdn|media|upload/i.test(url)) {
            addUrl(url, match[1]);
        }
    }

    // Strategy 3: Bare image URLs on their own line
    const bareUrlRe = /^(https?:\/\/\S+\.(jpe?g|png|gif|webp|svg|bmp|avif)\S*)/gm;
    while ((match = bareUrlRe.exec(text)) !== null) {
        addUrl(match[1], "");
    }

    return results;
}

// ── Image Search Template ──
const imageSearchTemplate: TemplateBuilder = (query, toolResult, allResults, finalReasoning) => {
    // If the user asked for images AND text info, skip template so the LLM card gen handles both
    if (isMultiPartImageQuery(query)) {
        console.log(`[CardTemplates] ⏭ Multi-part image query detected — falling back to LLM card gen`);
        return null;
    }

    // Extract image URLs from ALL available sources:
    // 1. Structured data (TypeScript-era tools)
    let imageData: { url: string; title: string }[] = [];
    const structuredUrls = (toolResult.data?.images as string[]) || (toolResult.data?.imageUrls as string[]) || [];
    if (structuredUrls.length > 0) {
        imageData = structuredUrls.map((url: string, i: number) => ({ url, title: `Image ${i + 1}` }));
    }

    // 2. Parse from tool result text (Rust tool output: "Image: https://...")
    if (imageData.length === 0 && toolResult.text) {
        imageData = extractImageUrls(toolResult.text);
    }

    // 3. Parse from ALL tool step results (in case search_images step isn't the last one)
    if (imageData.length === 0) {
        for (const step of allResults) {
            if (step.result.text) {
                imageData = extractImageUrls(step.result.text);
                if (imageData.length > 0) break;
            }
        }
    }

    // 4. Parse from the LLM's final response (markdown links)
    if (imageData.length === 0 && finalReasoning) {
        imageData = extractImageUrls(finalReasoning);
    }

    if (imageData.length === 0) {
        return {
            title: query.slice(0, 200),
            type: "agent_task",
            summary: "No images found for this search.",
            design: {
                accent_color: "#F59E0B",
                vibe: "Warm",
                text_style: "sans",
                glass_opacity: 0.15,
            },
            blocks: [
                {
                    type: "text_block",
                    content: "Could not find images. Try different search terms.",
                    style: "body",
                    url: "", caption: "", items: [], actions: [],
                },
            ],
            suggested_width: 400,
            suggested_height: 300,
            sources: [],
            logs: [],
        };
    }

    const blocks: any[] = [];

    // Image gallery — the main content
    blocks.push({
        type: "image_gallery",
        images: imageData.map((img) => ({
            url: img.url,
            caption: img.title,
        })),
        url: "", caption: "", content: "", style: "none", items: [], actions: [],
    });

    // Add source links for each image
    const sourceActions = imageData.slice(0, 3).map((img, i) => ({
        label: img.title.slice(0, 30) || `Imagen ${i + 1}`,
        intent: img.url,
        primary: i === 0,
    }));
    if (sourceActions.length > 0) {
        blocks.push({
            type: "action_row",
            actions: sourceActions,
            url: "", caption: "", content: "", style: "none", items: [],
        });
    }

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: `${imageData.length} image(s) found`,
        design: {
            accent_color: "#8B5CF6",
            vibe: "Vibrant",
            text_style: "sans",
            glass_opacity: 0.15,
        },
        blocks,
        suggested_width: 500,
        suggested_height: 600,
        sources: imageData.map(img => img.url),
        logs: [],
    };
};

/** Parse weather tool output: "Weather in Madrid: 4°C (feels like 2°C). Clear. Humidity: 81%. Wind: 9 km/h." */
function parseWeatherText(text: string): { location?: string; temp?: string; feelsLike?: string; condition?: string; humidity?: string; wind?: string } | null {
    const m = text.match(/Weather in ([^:]+):\s*([\d°]+)\s*\(feels like ([\d°]+)\)\.\s*([^.]+)\.\s*Humidity:\s*([^.]+)\.\s*Wind:\s*(.+)/i)
        || text.match(/Weather in ([^:]+):\s*([\d°]+)[^.]*\.\s*([^.]+)\./i);
    if (!m) return null;
    if (m.length >= 6) {
        return { location: m[1].trim(), temp: m[2], feelsLike: m[3], condition: m[4].trim(), humidity: m[5].trim(), wind: m[6].trim() };
    }
    if (m.length >= 4) {
        return { location: m[1].trim(), temp: m[2], condition: m[3].trim() };
    }
    return null;
}

// ── Weather Template ──
const weatherTemplate: TemplateBuilder = (query, toolResult, _allResults, _finalReasoning) => {
    const data = toolResult.data || {};
    const text = toolResult.text || "";
    const parsed = parseWeatherText(text);

    const blocks: any[] = [];
    if (parsed && (parsed.temp || parsed.condition)) {
        const stats: { label: string; value: string; icon?: string }[] = [];
        if (parsed.temp) stats.push({ label: "Temp", value: parsed.temp, icon: "thermometer" });
        if (parsed.feelsLike) stats.push({ label: "Feels", value: parsed.feelsLike, icon: "thermometer" });
        if (parsed.condition) stats.push({ label: "Condition", value: parsed.condition, icon: "cloud" });
        if (parsed.humidity) stats.push({ label: "Humidity", value: parsed.humidity, icon: "droplet" });
        if (parsed.wind) stats.push({ label: "Wind", value: parsed.wind, icon: "wind" });
        if (stats.length > 0) {
            blocks.push({
                type: "stats_row",
                stats,
                url: "", caption: "", content: "", style: "none", items: [], actions: [],
            });
        }
    }
    blocks.push({
        type: "text_block",
        content: text || JSON.stringify(data),
        style: "body",
        url: "", caption: "", items: [], actions: [],
    });

    return {
        title: (parsed?.location ? `Weather in ${parsed.location}` : data.location ? `Weather in ${data.location}` : "Weather"),
        type: "agent_task",
        summary: text.slice(0, 200),
        design: {
            accent_color: "#38BDF8",
            vibe: "Nature",
            text_style: "sans",
            glass_opacity: 0.12,
        },
        blocks,
        suggested_width: 400,
        suggested_height: parsed ? 280 : 350,
        sources: toolResult.sources || [],
        logs: [],
    };
};

/** Strip markdown syntax from text for use in summaries/plain contexts */
function stripMarkdown(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // [title](url) → title
        .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold** → bold
        .replace(/\*([^*]+)\*/g, "$1") // *italic* → italic
        .replace(/`([^`]+)`/g, "$1") // `code` → code
        .replace(/#{1,6}\s+/g, "") // headers
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** Extract markdown links from text, returning { title, url } pairs */
function extractMarkdownLinks(text: string): { title: string; url: string }[] {
    const links: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    const re = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const url = m[2].trim();
        if (!seen.has(url)) {
            seen.add(url);
            links.push({ title: m[1].trim(), url });
        }
    }
    return links;
}

// ── Web Search Template ──
const webSearchTemplate: TemplateBuilder = (query, toolResult, _allResults, finalReasoning) => {
    const text = toolResult.text || "";
    const sources = toolResult.sources || [];

    // Prefer LLM reasoning (summarized) over raw search results to avoid duplication
    const cleanReasoning = finalReasoning
        ?.replace(/^Tool '.*?' Output:.*$/gm, "")
        ?.replace(/^\[.*?\]\s*/gm, "")
        ?.trim();
    const displayContent = (cleanReasoning && cleanReasoning.length > 20) ? cleanReasoning : text;

    // Extract links from the content for link_preview blocks
    const extractedLinks = extractMarkdownLinks(displayContent);

    // Strip markdown links from the main text to avoid duplication with link_preview blocks
    // But KEEP inline links if there are many (>4) — only extract the most important ones
    const shouldExtractLinks = extractedLinks.length > 0 && extractedLinks.length <= 6;
    const mainText = shouldExtractLinks
        ? displayContent.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // [title](url) → title
        : displayContent;

    const blocks: any[] = [];

    // Main text content (with markdown stripped if links are extracted separately)
    const finalText = mainText.trim() ? mainText : "Gathering information...";

    blocks.push({
        type: "text_block",
        content: finalText.slice(0, 3000),
        style: "body",
        url: "", caption: "", items: [], actions: [],
    });

    // Link preview blocks for extracted URLs (max 4)
    if (shouldExtractLinks) {
        for (const link of extractedLinks.slice(0, 4)) {
            blocks.push({
                type: "link_preview",
                url: link.url,
                title: link.title,
                description: "",
                content: "", caption: "", style: "none", items: [], actions: [],
            });
        }
    }

    // Fallback: action_row for tool-provided sources not in the LLM text
    const linkUrls = new Set(extractedLinks.map(l => l.url));
    const remainingSources = sources.filter(s => !linkUrls.has(s));
    if (remainingSources.length > 0) {
        blocks.push({
            type: "action_row",
            actions: remainingSources.slice(0, 3).map((src: string, i: number) => ({
                label: `Source ${i + 1}`,
                intent: src,
                primary: i === 0,
            })),
            url: "", caption: "", content: "", style: "none", items: [],
        });
    }

    // Clean summary — no raw markdown
    const cleanSummary = stripMarkdown(
        (cleanReasoning && cleanReasoning.length > 20) ? cleanReasoning : text
    ).slice(0, 150);

    // Combine all source URLs
    const allSources = [...sources, ...extractedLinks.map(l => l.url)];
    const uniqueSources = [...new Set(allSources)];

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: cleanSummary,
        design: {
            accent_color: "#6366F1",
            vibe: "Tech",
            text_style: "sans",
            glass_opacity: 0.15,
        },
        blocks,
        suggested_width: 450,
        suggested_height: 400 + (Math.min(extractedLinks.length, 4) * 70),
        sources: uniqueSources,
        logs: [],
    };
};

// ── Email Template ──
const emailTemplate: TemplateBuilder = (query, toolResult) => {
    const text = toolResult.text || "";
    const data = toolResult.data || {};

    const blocks: any[] = [];
    if (Array.isArray(data.emails) && data.emails.length > 0) {
        blocks.push({
            type: "data_grid",
            items: data.emails.slice(0, 6).map((email: any) => ({
                label: email.from || email.sender || "Sender",
                value: email.subject || email.title || "No subject",
                icon: "mail",
            })),
            url: "", caption: "", content: "", style: "none", actions: [],
        });
    } else {
        blocks.push({
            type: "text_block",
            content: text || "No emails found.",
            style: "body",
            url: "", caption: "", items: [], actions: [],
        });
    }

    return {
        title: "Recent emails",
        type: "agent_task",
        summary: text.slice(0, 150) || "Latest emails",
        design: {
            accent_color: "#3B82F6",
            vibe: "Professional",
            text_style: "sans",
            glass_opacity: 0.15,
        },
        blocks,
        suggested_width: 450,
        suggested_height: 400,
        sources: [],
        logs: [],
    };
};

// ── Calendar Template ──
const calendarTemplate: TemplateBuilder = (query, toolResult) => {
    const text = toolResult.text || "";
    const data = toolResult.data || {};

    const blocks: any[] = [];
    if (Array.isArray(data.events) && data.events.length > 0) {
        blocks.push({
            type: "data_grid",
            items: data.events.slice(0, 8).map((ev: any) => ({
                label: ev.time || ev.start || "",
                value: ev.title || ev.summary || "Event",
                icon: "calendar",
            })),
            url: "", caption: "", content: "", style: "none", actions: [],
        });
    } else {
        blocks.push({
            type: "text_block",
            content: text || "No events for today.",
            style: "body",
            url: "", caption: "", items: [], actions: [],
        });
    }

    return {
        title: "Your schedule",
        type: "agent_task",
        summary: text.slice(0, 150) || "Today's events",
        design: {
            accent_color: "#10B981",
            vibe: "Clean",
            text_style: "sans",
            glass_opacity: 0.12,
        },
        blocks,
        suggested_width: 420,
        suggested_height: 380,
        sources: [],
        logs: [],
    };
};

// ── System Info Template ──
// Trusts the agent to return only what's relevant (scope: "time" vs "full").
// Uses the specialist's humanized reasoning when available.
const systemInfoTemplate: TemplateBuilder = (query, toolResult, _allResults, finalReasoning) => {
    const text = toolResult.text || "";
    const data = toolResult.data || {};

    // If the tool returned just time (no OS/CPU fields), compact time card
    const isTimeOnly = !data.os_name && !data.cpu;

    if (isTimeOnly) {
        // Prefer the specialist's humanized reasoning over raw tool data
        const cleanReasoning = finalReasoning
            ?.replace(/^Tool '.*?' Output:.*$/gm, "")
            ?.replace(/^\[.*?\]\s*/gm, "")
            ?.replace(/^Collected sufficient data.*$/gm, "")
            ?.trim();

        // Use specialist's human response if it looks like real content (not system messages)
        const hasHumanResponse = cleanReasoning
            && cleanReasoning.length > 5
            && !cleanReasoning.startsWith("[system_info]")
            && !cleanReasoning.includes("Generating final response");

        const displayText = hasHumanResponse ? cleanReasoning : ((data.current_time as string) || text || "—");

        return {
            title: displayText,
            type: "agent_task",
            summary: "",
            design: {
                accent_color: "#8B5CF6",
                vibe: "Minimal",
                text_style: "sans",
                glass_opacity: 0.12,
            },
            blocks: [],
            suggested_width: 380,
            suggested_height: 120,
            sources: [],
            logs: [],
        };
    }

    // Full system info — structured grid
    const gridItems: { label: string; value: string; icon: string }[] = [];
    if (data.current_time) gridItems.push({ label: "Time", value: String(data.current_time), icon: "clock" });
    if (data.os_name) gridItems.push({ label: "OS", value: `${data.os_name} ${data.os_version || ""}`.trim(), icon: "monitor" });
    if (data.hostname) gridItems.push({ label: "Host", value: String(data.hostname), icon: "server" });
    if (data.cpu) gridItems.push({ label: "CPU", value: String(data.cpu), icon: "cpu" });
    if (data.memory_gb) gridItems.push({ label: "Memory", value: `${Number(data.memory_gb).toFixed(1)} GB`, icon: "hard-drive" });
    if (data.arch) gridItems.push({ label: "Arch", value: String(data.arch), icon: "chip" });

    return {
        title: "System Info",
        type: "agent_task",
        summary: `${data.os_name || ""} ${data.os_version || ""} · ${data.cpu || ""}`.trim(),
        design: {
            accent_color: "#6366F1",
            vibe: "Tech",
            text_style: "mono",
            glass_opacity: 0.15,
        },
        blocks: gridItems.length > 0
            ? [{
                type: "data_grid",
                items: gridItems,
                url: "", caption: "", content: "", style: "none", actions: [],
            }]
            : [{
                type: "text_block",
                content: text.slice(0, 3000),
                style: "body",
                url: "", caption: "", items: [], actions: [],
            }],
        suggested_width: 420,
        suggested_height: 380,
        sources: [],
        logs: [],
    };
};

// ── Generic Text Result Template (for tools that return plain text) ──
const textResultTemplate: TemplateBuilder = (query, toolResult, _allResults, finalReasoning) => {
    const text = toolResult.text || JSON.stringify(toolResult.data || {});

    // Use the LLM's reasoning as the card content if it's cleaner than raw tool output
    // This prevents content duplication — the reasoning IS the final content
    const cleanReasoning = finalReasoning
        ?.replace(/^Tool '.*?' Output:.*$/gm, "")
        ?.replace(/^\[.*?\]\s*/gm, "")
        ?.trim();
    const displayContent = (cleanReasoning && cleanReasoning.length > 10) ? cleanReasoning : text;

    // Extract links for link_preview blocks
    const extractedLinks = extractMarkdownLinks(displayContent);
    const mainText = extractedLinks.length > 0 && extractedLinks.length <= 6
        ? displayContent.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
        : displayContent;

    const blocks: any[] = [];

    blocks.push({
        type: "text_block",
        content: mainText.slice(0, 3000),
        style: "body",
        url: "", caption: "", items: [], actions: [],
    });

    // Add link_preview blocks for extracted URLs
    for (const link of extractedLinks.slice(0, 4)) {
        blocks.push({
            type: "link_preview",
            url: link.url,
            title: link.title,
            description: "",
            content: "", caption: "", style: "none", items: [], actions: [],
        });
    }

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: stripMarkdown(displayContent).slice(0, 150),
        design: {
            accent_color: "#6366F1",
            vibe: "Minimal",
            text_style: "sans",
            glass_opacity: 0.15,
        },
        blocks,
        suggested_width: 420,
        suggested_height: 350 + (Math.min(extractedLinks.length, 4) * 70),
        sources: [...(toolResult.sources || []), ...extractedLinks.map(l => l.url)],
        logs: [],
    };
};

// ── Template Registry ──
const CARD_TEMPLATES: Record<string, TemplateBuilder> = {
    search_images: imageSearchTemplate,
    weather: weatherTemplate,
    web_search: webSearchTemplate,
    web_scrape: webSearchTemplate,
    read_page: webSearchTemplate,
    email_list: emailTemplate,
    // Backward compatibility aliases
    email_reader: emailTemplate,
    calendar: calendarTemplate,
    calendar_today: calendarTemplate,
    calendar_create: calendarTemplate,
    reminders_list: textResultTemplate,
    reminders_add: textResultTemplate,
    contacts_search: textResultTemplate,
    notes_list: textResultTemplate,
    notes_read: textResultTemplate,
    notes_create: textResultTemplate,
    notes: textResultTemplate,
    system_info: systemInfoTemplate,
    get_system_info: systemInfoTemplate,
    current_time: systemInfoTemplate,
    get_battery: textResultTemplate,
    get_wifi: textResultTemplate,
    get_spatial_bounds: textResultTemplate,
    calculate: textResultTemplate,
    translate: textResultTemplate,
    define_word: textResultTemplate,
    currency_convert: textResultTemplate,
    qr_code: textResultTemplate,
    clipboard_read: textResultTemplate,
    clipboard_write: textResultTemplate,
    notify: textResultTemplate,
    get_volume: textResultTemplate,
    set_volume: textResultTemplate,
    get_brightness: textResultTemplate,
    set_brightness: textResultTemplate,
    toggle_dark_mode: textResultTemplate,
    open_app: textResultTemplate,
    say_tts: textResultTemplate,
    take_screenshot: textResultTemplate,
    search_files: textResultTemplate,
    music_play: textResultTemplate,
    music_pause: textResultTemplate,
    music_next: textResultTemplate,
    finder_open: textResultTemplate,
    finder_trash: textResultTemplate,
    safari_tabs: textResultTemplate,
    read_file: textResultTemplate,
    file_read_full: textResultTemplate,
    dir_list: textResultTemplate,
    file_write: textResultTemplate,
    file_append: textResultTemplate,
    file_move: textResultTemplate,
    file_copy: textResultTemplate,
    storage_read: textResultTemplate,
    storage_write: textResultTemplate,
    storage_create: textResultTemplate,
    storage_list: textResultTemplate,
    storage_delete: textResultTemplate,
    storage_versions: textResultTemplate,
    storage_rollback: textResultTemplate,
};

const VALID_BLOCK_TYPES = new Set([
    "hero_image", "text_block", "data_grid", "action_row", "image_gallery",
    "list_block", "code_block", "progress_bar", "stats_row",
    "link_preview", "separator", "callout", "table_block", "canvas_block",
]);

/**
 * Normalize a block from agent JSON to flat UIBlock shape expected by AdaptiveNode.
 * Handles: flat format ({ type, content, ... }), wrapper format ({ text_block: {...} }),
 * and A2UI format ({ id, component: { TextBlock: { content: { literalString: "..." } } } }).
 */
function normalizeBlock(b: Record<string, unknown>): Record<string, unknown> {
    // A2UI format: { id, component: { TextBlock: {...} } } or { TextBlock: {...} } (direct)
    const comp = b.component;
    const compToUse = comp && typeof comp === "object" && !Array.isArray(comp)
        ? comp as Record<string, unknown>
        : null;
    const directKeys = Object.keys(b).filter((k) => A2UI_COMPONENT_NAMES.has(k));
    const effectiveComp = compToUse ?? (directKeys.length === 1 ? b : null);

    if (effectiveComp) {
        const compKeys = Object.keys(effectiveComp).filter((k) => A2UI_COMPONENT_NAMES.has(k));
        if (compKeys.length === 1) {
            const a2uiBlock = a2uiComponentToBlock(
                { id: (b.id as string) || "block", component: effectiveComp },
                {},
            );
            if (a2uiBlock) {
                const flat = a2uiBlock as unknown as Record<string, unknown>;
                return {
                    type: flat.type,
                    url: flat.url ?? "",
                    caption: flat.caption ?? "",
                    content: flat.content ?? "",
                    style: flat.style ?? "body",
                    items: flat.items ?? [],
                    actions: flat.actions ?? [],
                    code: flat.code ?? "",
                    language: flat.language ?? "",
                    ordered: flat.ordered ?? false,
                    variant: flat.variant ?? "none",
                    canvas_type: flat.canvas_type ?? "none",
                    title: flat.title ?? "",
                    description: flat.description ?? "",
                    headers: flat.headers ?? [],
                    rows: flat.rows ?? [],
                    stats: flat.stats ?? [],
                    images: flat.images,
                };
            }
        }
    }

    let type = (b.type as string) || "";
    let payload = b;

    // Wrapper format: single key is block type, value is the payload (e.g. { callout: { title, content, variant } })
    if (!VALID_BLOCK_TYPES.has(type)) {
        const keys = Object.keys(b).filter((k) => VALID_BLOCK_TYPES.has(k));
        if (keys.length === 1) {
            type = keys[0];
            const inner = b[type];
            payload = inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as Record<string, unknown>) : b;
        } else {
            type = "text_block";
        }
    }
    if (!VALID_BLOCK_TYPES.has(type)) return { type: "text_block", content: String(payload.content ?? ""), style: "body", url: "", caption: "", items: [], actions: [] };

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const normalizedItems =
        type === "list_block"
            ? rawItems
                .map((it) => {
                    if (typeof it === "string") {
                        const t = it.trim();
                        if (!t) return null;
                        return { text: t, label: t, value: t };
                    }
                    if (it && typeof it === "object") {
                        const obj = it as Record<string, unknown>;
                        const text = String(obj.text ?? obj.label ?? obj.value ?? "").trim();
                        if (!text) return null;
                        return { ...obj, text };
                    }
                    return null;
                })
                .filter((it) => it !== null)
            : rawItems;

    const flat: Record<string, unknown> = {
        type,
        url: payload.url ?? "",
        caption: payload.caption ?? "",
        content: payload.content ?? (payload.label ?? ""),
        style: payload.style ?? "body",
        items: normalizedItems,
        actions: Array.isArray(payload.actions) ? payload.actions : [],
        code: payload.code ?? "",
        language: payload.language ?? "",
        ordered: !!payload.ordered,
        variant: payload.variant ?? "none",
        canvas_type: payload.canvas_type ?? "none",
        title: payload.title ?? "",
        description: payload.description ?? "",
        headers: Array.isArray(payload.headers) ? payload.headers : [],
        rows: Array.isArray(payload.rows) ? payload.rows : [],
        stats: Array.isArray(payload.stats) ? payload.stats : [],
    };

    if (type === "image_gallery" && Array.isArray(payload.images)) flat.images = payload.images;
    return flat;
}

/**
 * Build a card from A2UI surfaceUpdate response (when agent outputs A2UI format).
 * Returns null if response does not contain surfaceUpdate.
 */
export function buildCardFromA2UISurfaceUpdate(query: string, raw: unknown): CardObject | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const surfaceUpdate = obj.surfaceUpdate;
    if (!surfaceUpdate || typeof surfaceUpdate !== "object") return null;

    const su = surfaceUpdate as { surfaceId?: string; components?: Array<{ id: string; component: Record<string, unknown> }> };
    const blocks = blocksFromSurfaceUpdate(su, "root");
    if (blocks.length === 0) return null;

    const summary = (typeof obj.summary === "string" ? obj.summary : null)
        ?? (blocks[0] && (blocks[0] as unknown as Record<string, unknown>).type === "text_block"
            ? String((blocks[0] as unknown as Record<string, unknown>).content ?? "").slice(0, 200)
            : query.slice(0, 100));

    const design = obj.design as Record<string, unknown> | undefined;
    const ts = design?.text_style as string;
    const safeTs = (["sans", "mono", "serif"] as const).includes(ts as "sans" | "mono" | "serif")
        ? (ts as "sans" | "mono" | "serif") : "sans";
    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: String(summary).slice(0, 500),
        design: {
            accent_color: design?.accent_color as string ?? "#6366F1",
            vibe: design?.vibe as string ?? "Minimal",
            text_style: safeTs,
            glass_opacity: (design?.glass_opacity as number) ?? 0.15,
        },
        blocks,
        suggested_width: typeof obj.suggested_width === "number" ? obj.suggested_width : 420,
        suggested_height: typeof obj.suggested_height === "number" ? obj.suggested_height : 400,
        sources: Array.isArray(obj.sources) ? (obj.sources as string[]) : [],
        logs: [],
    };
}

/** Decode double-encoded summary: "{\"summary\":\"...\"}" -> "..." */
function decodeSummary(s: string): string {
    const t = s.trim();
    if (!t.startsWith("{")) return s;
    try {
        const parsed = JSON.parse(t) as Record<string, unknown>;
        const inner = parsed.summary;
        return typeof inner === "string" ? inner : s;
    } catch {
        return s;
    }
}

/** If block content is nested A2UI/legacy JSON (summary+blocks), return normalized inner blocks; else null. */
function tryExpandNestedBlocks(b: Record<string, unknown>): Record<string, unknown>[] | null {
    const content = b.content ?? b.label;
    if (typeof content !== "string" || !content.trim().startsWith("{")) return null;
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const inner = parsed.blocks;
        if (!Array.isArray(inner) || inner.length === 0) return null;
        return inner
            .filter((x) => x && typeof x === "object")
            .map((x) => normalizeBlock(x as Record<string, unknown>));
    } catch {
        return null;
    }
}

/**
 * Build a card from specialist JSON response (summary + blocks).
 * Returns null if response is not valid JSON with summary and blocks.
 * Handles double-encoded summary and nested A2UI JSON inside text_block content.
 */
export function buildCardFromAgentJson(query: string, raw: unknown): CardObject | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    let summary = obj.summary;
    const blocks = obj.blocks;
    if (typeof summary !== "string" || !Array.isArray(blocks)) return null;
    summary = decodeSummary(summary);

    const expanded: Record<string, unknown>[] = [];
    for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        const rec = b as Record<string, unknown>;
        const type = (rec.type as string) || "";
        const nested = tryExpandNestedBlocks(rec);
        if (nested) {
            expanded.push(...nested);
        } else if (type === "text_block" && typeof rec.content === "string" && rec.content.trim().startsWith("{")) {
            const altNested = tryExpandNestedBlocks({ content: rec.content });
            if (altNested) expanded.push(...altNested);
            else expanded.push(normalizeBlock(rec));
        } else {
            expanded.push(normalizeBlock(rec));
        }
    }

    const normalizedBlocks = expanded;

    const finalBlocks =
        normalizedBlocks.length > 0
            ? normalizedBlocks
            : [{ type: "text_block", content: summary, style: "body", url: "", caption: "", items: [], actions: [] }];

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: String(summary).slice(0, 500),
        design: {
            accent_color: (obj.design as any)?.accent_color ?? "#6366F1",
            vibe: (obj.design as any)?.vibe ?? "Minimal",
            text_style: (obj.design as any)?.text_style ?? "sans",
            glass_opacity: (obj.design as any)?.glass_opacity ?? 0.15,
        },
        blocks: finalBlocks,
        suggested_width: typeof obj.suggested_width === "number" ? obj.suggested_width : 420,
        suggested_height: typeof obj.suggested_height === "number" ? obj.suggested_height : 400,
        sources: Array.isArray(obj.sources) ? (obj.sources as string[]) : [],
        logs: [],
    };
}

/**
 * Parse JSONL A2UI response (one JSON object per line) and build a card.
 * Returns null if no valid A2UI messages found.
 */
export function buildCardFromA2UIJsonlResponse(query: string, response: string): CardObject | null {
    const lines = response.split("\n").map((l) => l.trim()).filter(Boolean);
    let componentMap: Record<string, Record<string, { id: string; component: Record<string, unknown> }>> = {};
    let rootId: string | null = null;
    let surfaceId: string | null = null;
    let lastSummary: string | null = null;
    let lastDesign: Record<string, unknown> | null = null;

    const repairJson = (str: string) => {
        let repaired = str.trim();
        // Basic check for missing closing braces/brackets
        const openBraces = (repaired.match(/\{/g) || []).length;
        let closeBraces = (repaired.match(/\}/g) || []).length;
        while (openBraces > closeBraces) {
            repaired += "}";
            closeBraces++;
        }
        return repaired;
    };

    for (const line of lines) {
        if (!line.includes("{")) continue;
        try {
            // Attempt to parse original, then try repaired version
            let obj: any;
            try {
                obj = JSON.parse(line);
            } catch {
                obj = JSON.parse(repairJson(line));
            }

            if (!obj || typeof obj !== "object") continue;

            // Handle shorthand: if it has 'surfaceUpdate' but it's a single component (has 'id')
            if (obj.surfaceUpdate && typeof obj.surfaceUpdate === "object" && (obj.surfaceUpdate as any).id) {
                const normalized = normalizeShorthandComponent(obj.surfaceUpdate as any);
                if (normalized) {
                    const sid = (obj.surfaceId as string) ?? (obj.surfaceUpdate as any).surfaceId ?? "card-1";
                    surfaceId = sid;
                    const existing = componentMap[sid] || {};
                    componentMap = { ...componentMap, [sid]: { ...existing, [normalized.id]: normalized } };
                }
            }

            if (obj.surfaceUpdate && typeof obj.surfaceUpdate === "object") {
                const su = obj.surfaceUpdate as { surfaceId?: string; components?: Array<Record<string, unknown>> };
                const sid = su.surfaceId ?? "card-1";
                surfaceId = sid;
                const existing = componentMap[sid] || {};
                const merged = { ...existing };
                for (const c of su.components || []) {
                    const normalized = normalizeShorthandComponent(c as any);
                    if (normalized) merged[normalized.id] = normalized;
                }
                componentMap = { ...componentMap, [sid]: merged };
            }
            if (obj.dataModelUpdate && typeof obj.dataModelUpdate === "object") {
                // Skip for card building - we use literalString from components
            }
            if (obj.beginRendering && typeof obj.beginRendering === "object") {
                const br = obj.beginRendering as { root?: string; surfaceId?: string };
                if (br.root) rootId = br.root;
                if (br.surfaceId) surfaceId = br.surfaceId;
            }
            if (typeof obj.summary === "string") lastSummary = obj.summary;
            if (obj.design && typeof obj.design === "object") lastDesign = obj.design as Record<string, unknown>;
        } catch {
            // Skip invalid JSON lines
        }
    }

    const rid = rootId ?? "root";
    const sid = surfaceId ?? "card-1";
    const map = componentMap[sid];
    if (!map) return null;

    const components = Object.values(map);
    const blocks = blocksFromSurfaceUpdate({ surfaceId: sid, components }, rid);
    if (blocks.length === 0) return null;

    const summary = lastSummary ?? (blocks[0] && (blocks[0] as unknown as Record<string, unknown>).type === "text_block"
        ? String((blocks[0] as unknown as Record<string, unknown>).content ?? "").slice(0, 200)
        : query.slice(0, 100));
    const design = lastDesign ?? {};
    const textStyle = design.text_style as string;
    const safeTextStyle = (["sans", "mono", "serif"] as const).includes(textStyle as "sans" | "mono" | "serif")
        ? (textStyle as "sans" | "mono" | "serif") : "sans";

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: String(summary).slice(0, 500),
        design: {
            accent_color: (design.accent_color as string) ?? "#6366F1",
            vibe: (design.vibe as string) ?? "Minimal",
            text_style: safeTextStyle,
            glass_opacity: (design.glass_opacity as number) ?? 0.15,
        },
        blocks,
        suggested_width: 420,
        suggested_height: 400,
        sources: [],
        logs: [],
    };
}

/** Try to extract JSON object from a string (strip markdown code fence if present). */
export function extractJsonFromResponse(response: string): unknown {
    const trimmed = response.trim();
    let str = trimmed;
    if (trimmed.startsWith("```")) {
        const after = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        str = after;
    }
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(str.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * Build a minimal text card when no template matches or steps are missing.
 * Used as fallback for agent-response from Rust kernel.
 * Smart: detects image URLs in the response and renders them as image_gallery.
 */
export function buildTextCardFromResponse(query: string, response: string): CardObject {
    // Smart detection: if the response contains image URLs, render as image gallery
    const imageData = extractImageUrls(response);
    if (imageData.length > 0) {
        const blocks: any[] = [];

        // Image gallery
        blocks.push({
            type: "image_gallery",
            images: imageData.map((img) => ({
                url: img.url,
                caption: img.title,
            })),
            url: "", caption: "", content: "", style: "none", items: [], actions: [],
        });

        // Source links
        const sourceActions = imageData.slice(0, 3).map((img, i) => ({
            label: img.title.slice(0, 30) || `Imagen ${i + 1}`,
            intent: img.url,
            primary: i === 0,
        }));
        if (sourceActions.length > 0) {
            blocks.push({
                type: "action_row",
                actions: sourceActions,
                url: "", caption: "", content: "", style: "none", items: [],
            });
        }

        return {
            title: query.slice(0, 200),
            type: "agent_task",
            summary: `${imageData.length} imagen(es) encontrada(s)`,
            design: {
                accent_color: "#8B5CF6",
                vibe: "Vibrant",
                text_style: "sans",
                glass_opacity: 0.15,
            },
            blocks,
            suggested_width: 500,
            suggested_height: 600,
            sources: imageData.map(img => img.url),
            logs: [],
        };
    }

    // Smart detection: if the response contains markdown links, extract them as link_preview blocks
    const mdLinks: { url: string; title: string }[] = [];
    const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = mdLinkRe.exec(response)) !== null) {
        mdLinks.push({ title: match[1], url: match[2] });
    }

    // Strip markdown links from display text and clean up
    const cleanText = response
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // [title](url) → title
        .replace(/\s{2,}/g, " ")
        .trim();

    const blocks: any[] = [];

    // Main text content
    const finalText = cleanText.trim() ? cleanText : "Thinking...";
    blocks.push({
        type: "text_block",
        content: finalText.slice(0, 3000),
        style: "body",
        url: "", caption: "", items: [], actions: [],
    });

    // Link previews for extracted markdown links
    for (const link of mdLinks.slice(0, 4)) {
        blocks.push({
            type: "link_preview",
            url: link.url,
            title: link.title,
            description: "",
            content: "", caption: "", style: "none", items: [], actions: [],
        });
    }

    return {
        title: query.slice(0, 200),
        type: "agent_task",
        summary: stripMarkdown(cleanText).slice(0, 150) || stripMarkdown(response).slice(0, 150),
        design: {
            accent_color: "#6366F1",
            vibe: "Minimal",
            text_style: "sans",
            glass_opacity: 0.15,
        },
        blocks: blocks.length > 0 ? blocks : [{
            type: "text_block",
            content: response.slice(0, 3000),
            style: "body",
            url: "", caption: "", items: [], actions: [],
        }],
        suggested_width: 420,
        suggested_height: 350 + (mdLinks.length * 60),
        sources: mdLinks.map(l => l.url),
        logs: [],
    };
}

/**
 * Try to build a card from a deterministic template.
 * Returns null if no template matches (fallback to LLM card generation).
 */
export function tryBuildTemplateCard(
    query: string,
    stepRecords: { tool: string; input: string; result: ToolExecResult }[],
    finalReasoning: string,
): { card: CardObject; sources: string[] } | null {
    // Find the primary (last successful) tool
    const successfulSteps = stepRecords.filter(s => s.result.success);
    if (successfulSteps.length === 0) return null;

    const primaryStep = successfulSteps[successfulSteps.length - 1];
    const template = CARD_TEMPLATES[primaryStep.tool];
    if (!template) return null;

    const card = template(query, primaryStep.result, stepRecords, finalReasoning);
    if (!card) return null;

    const sources = stepRecords
        .flatMap(s => s.result.sources || [])
        .filter(Boolean);

    console.log(`[CardTemplates] ⚡ Built template card for tool "${primaryStep.tool}" (skipped LLM)`);
    return { card, sources };
}
