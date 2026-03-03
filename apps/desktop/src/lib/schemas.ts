import { z } from "zod";

// --- ATOMIC BLOCKS ---
// Flat schema: every block shares all fields. The LLM fills relevant ones and leaves the rest empty/default.
// This keeps structured output simple for the model while supporting 14 block types.

export const UIBlockSchema = z.object({
    type: z.enum([
        "hero_image", "text_block", "data_grid", "action_row", "image_gallery",
        "list_block", "code_block", "progress_bar", "stats_row",
        "link_preview", "separator", "callout", "table_block", "canvas_block",
    ]),

    // ── hero_image / link_preview ──
    url: z.string().describe("For hero_image or link_preview URL (empty string if not used)"),
    caption: z.string().describe("For hero_image caption (empty string if not used)"),

    // ── text_block / callout ──
    content: z.string().describe("For text_block, callout, or separator label (empty string if not used)"),
    style: z.enum(["h1", "h2", "body", "caption", "quote", "none"]).describe("For text_block style ('none' if not used)"),

    // ── data_grid / list_block / progress_bar / canvas_block ──
    items: z.array(
        z.object({
            label: z.string(),
            value: z.string(),
            icon: z.string().describe("Lucide icon name or empty string"),
        })
    ).describe("For data_grid items, list_block items (use label as text), progress_bar items (use value as '0'-'100'), or canvas_block points (label + numeric value as string). Empty array if not used."),

    // ── action_row ──
    actions: z.array(
        z.object({
            label: z.string(),
            intent: z.string(),
            primary: z.boolean(),
        })
    ).describe("For action_row buttons (empty array if not used)"),

    // ── code_block ──
    code: z.string().describe("For code_block: the source code (empty string if not used)"),
    language: z.string().describe("For code_block: language name e.g. 'python', 'javascript' (empty string if not used)"),

    // ── list_block ──
    ordered: z.boolean().describe("For list_block: true for numbered list, false for bullets (false if not used)"),

    // ── callout ──
    variant: z.enum(["info", "warning", "success", "error", "none"]).describe("For callout: severity level ('none' if not used)"),
    canvas_type: z.enum(["bar", "line", "none"]).describe("For canvas_block: chart style ('bar' or 'line'). Use 'none' for non-canvas blocks."),

    // ── stats_row ──
    stats: z.array(
        z.object({
            label: z.string(),
            value: z.string(),
            trend: z.enum(["up", "down", "neutral"]),
        })
    ).describe("For stats_row: big metric cards (empty array if not used)"),

    // ── link_preview ──
    title: z.string().describe("For link_preview title (empty string if not used)"),
    description: z.string().describe("For link_preview description (empty string if not used)"),

    // ── table_block ──
    headers: z.array(z.string()).describe("For table_block: column headers (empty array if not used)"),
    rows: z.array(z.array(z.string())).describe("For table_block: rows of cell values (empty array if not used)"),
});

// --- ADAPTIVE NODE ---

export const AdaptiveNodeSchema = z.object({
    title: z.string(),
    type: z.enum(["note", "media_player", "browser", "chat"]),
    summary: z.string().describe("Short summary for the window header/preview"),
    design: z.object({
        accent_color: z
            .string()
            .describe("Hex code for the accent color (e.g. #F7931A)"),
        vibe: z.string().describe("Description of the visual style (e.g. 'Cyberpunk', 'Nature', 'Minimal')"),
        text_style: z.enum(["sans", "mono", "serif"]).describe("Font style for the content"),
        glass_opacity: z.number().describe("Opacity of the glass effect (0-1)"),
    }),
    blocks: z.array(UIBlockSchema).describe("List of UI blocks to render the content"),
    suggested_width: z.number().describe("Suggested width in pixels (default 400)"),
    suggested_height: z.number().describe("Suggested height in pixels (default 500)"),
    sources: z.array(z.string()).describe("Source URLs used for this answer"),
    logs: z.array(z.string()).describe("Debug logs shown in God Mode"),
});
