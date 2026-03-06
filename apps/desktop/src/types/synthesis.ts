export type NodeType =
    | "note"
    | "media_player"
    | "browser"
    | "chat"
    | "recipe"
    | "news"
    | "widget"
    | "agent_task";

export type WidgetKind = "clock" | "calculator" | "notes" | "timer" | "weather";
export type NodeStatus = "active" | "minimized" | "background" | "synthesizing";
export type SpaceId = string;
export type TextStyle = "sans" | "mono" | "serif";

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Dimension {
    w: number;
    h: number;
}

export interface NodeDesign {
    accent_color: string;
    vibe: string;
    text_style: TextStyle;
    glass_opacity: number;
}

export interface HeroImageBlock {
    type: "hero_image";
    url: string;
    caption?: string | null;
}

export interface TextBlock {
    type: "text_block";
    content: string;
    style: "h1" | "h2" | "body" | "caption" | "quote" | "none";
}

export interface DataGridBlock {
    type: "data_grid";
    items: Array<{
        label: string;
        value: string;
        icon?: string | null;
    }>;
}

export interface ActionRowBlock {
    type: "action_row";
    actions: Array<{
        label: string;
        intent: string;
        primary?: boolean;
    }>;
}

export interface ImageGalleryBlock {
    type: "image_gallery";
    images: Array<{
        url: string;
        caption?: string;
    }>;
}

export interface ListBlock {
    type: "list_block";
    items: Array<{ text: string; icon?: string | null }>;
    ordered?: boolean;
}

export interface CodeBlock {
    type: "code_block";
    code: string;
    language?: string;
}

export interface ProgressBarBlock {
    type: "progress_bar";
    items: Array<{ label: string; value: number; color?: string }>;
}

export interface StatsRowBlock {
    type: "stats_row";
    stats: Array<{ label: string; value: string; trend?: "up" | "down" | "neutral" }>;
}

export interface LinkPreviewBlock {
    type: "link_preview";
    url: string;
    title: string;
    description?: string;
}

export interface SeparatorBlock {
    type: "separator";
    label?: string;
}

export interface CalloutBlock {
    type: "callout";
    content: string;
    variant?: "info" | "warning" | "success" | "error";
    title?: string;
}

export interface TableBlock {
    type: "table_block";
    headers: string[];
    rows: string[][];
}

export interface CanvasBlock {
    type: "canvas_block";
    title?: string;
    canvas_type?: "bar" | "line";
    items: Array<{ label: string; value: string; color?: string }>;
}

export interface FlatUIBlock {
    type: "hero_image" | "text_block" | "data_grid" | "action_row" | "image_gallery"
    | "list_block" | "code_block" | "progress_bar" | "stats_row"
    | "link_preview" | "separator" | "callout" | "table_block" | "canvas_block"
    | "tabs_block" | "accordion_block" | "carousel_block" | "timeline_block" | "badge_set"
    | "input_block" | "select_block" | "toggle_block" | "slider_block" | "datepicker_block"
    | "map_block" | "audio_player" | "video_player" | "skeleton_block" | "markdown_block";
    id?: string;
    url?: string | null;
    caption?: string | null;
    content?: string | null;
    style?: "h1" | "h2" | "body" | "caption" | "quote" | "none" | null;
    items?: Array<{
        label: string;
        value: string;
        icon?: string | null;
        text?: string;
        color?: string;
    }> | null;
    actions?: Array<{
        label: string;
        intent: string;
        primary?: boolean;
    }> | null;
    // New block fields
    code?: string | null;
    language?: string | null;
    ordered?: boolean | null;
    variant?: "info" | "warning" | "success" | "error" | "none" | null;
    canvas_type?: "bar" | "line" | "none" | null;
    title?: string | null;
    description?: string | null;
    headers?: string[] | null;
    rows?: string[][] | null;
    stats?: Array<{ label: string; value: string; trend?: "up" | "down" | "neutral" }> | null;
}

export type UIBlock =
    | HeroImageBlock | TextBlock | DataGridBlock | ActionRowBlock | ImageGalleryBlock
    | ListBlock | CodeBlock | ProgressBarBlock | StatsRowBlock
    | LinkPreviewBlock | SeparatorBlock | CalloutBlock | TableBlock | CanvasBlock
    | FlatUIBlock;

export interface ReasoningTimelineEntry {
    id: string;
    label?: string;
    text: string;
}

/** A2UI streaming state (see @/lib/a2ui) - stored in node content when agent outputs A2UI JSONL */
export interface A2UIStateInContent {
    componentMap?: Record<string, Record<string, unknown>>;
    dataModel?: Record<string, Record<string, unknown>>;
    rootId?: string | null;
    surfaceId?: string | null;
    catalogId?: string | null;
}

export interface SynthesisNodeContent {
    title: string;
    summary: string;
    design: NodeDesign;
    blocks: UIBlock[];
    sources?: string[] | null;
    logs?: string[] | null;
    streamingReasoning?: string;
    streamingContent?: string;
    /** A2UI streaming state when agent outputs A2UI JSONL messages */
    a2uiState?: A2UIStateInContent | null;
    /** Completed reasoning segments, shown as collapsible timeline */
    reasoningTimeline?: ReasoningTimelineEntry[];
}

/** Content type when node.type === "agent_task". Use for type narrowing. */
export type AgentTaskContent = SynthesisNodeContent;

export interface SynthesisNode {
    id: string;
    query: string;
    type: NodeType;
    title: string;
    spaceId: SpaceId;
    position: Vec3;
    dimension: Dimension;
    status: NodeStatus;
    content: SynthesisNodeContent;
    zIndex: number;
    createdAt: number;
    updatedAt: number;
    isGodMode?: boolean;
    widgetKind?: WidgetKind;
    taskId?: string;
    taskStatus?: "planning" | "running" | "waiting_approval" | "waiting_answer" | "completed" | "failed" | "cancelled";
    thinkingPhase?: "listening" | "thinking" | "replying" | "ready";
}

export interface ConversationMessage {
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
    /** Optional node id for grouping conversations by card */
    nodeId?: string;
}

export type SpaceConversationHistory = Record<SpaceId, ConversationMessage[]>;

export interface SynthesisEdge {
    id: string;
    sourceId: string;
    targetId: string;
    label?: string;
    createdAt: number;
}

export type WidgetType = "music" | "weather" | "calendar" | "custom";

export interface EphemeralWidget {
    id: string;
    type: WidgetType;
    data?: unknown;
    title?: string;
    createdAt: number;
}

export interface SynthesisPersistedState {
    activeSpaceId: SpaceId;
    nodes: SynthesisNode[];
    spaceCache?: Record<string, { nodes: SynthesisNode[]; edges: SynthesisEdge[] }>;
    // We intentionally don't persist ephemeral widgets for now, true to their name
}
