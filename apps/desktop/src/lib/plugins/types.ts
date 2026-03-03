/**
 * Synthesis OS Plugin System - Architecture & Type Definitions
 *
 * This module defines the core interfaces for the Synthesis OS plugin system.
 * Plugins can extend the OS with custom node types, tools, AI providers,
 * widgets, and command palette entries.
 *
 * STATUS: Architecture design. Not yet wired into the runtime.
 *
 * LOADING STRATEGY (planned phases):
 *   Phase A: "Local plugins" -- plugin code lives in the repo under src/lib/plugins/
 *            and is registered at build time via a manifest.
 *   Phase B: "Installed plugins" -- plugins loaded from ~/.synthesis/plugins/ at startup,
 *            each in its own directory with a manifest.json.
 *   Phase C: "Dynamic plugins" -- hot-loaded from a plugin marketplace / URL,
 *            running inside a sandboxed iframe or Web Worker.
 *
 * SECURITY MODEL:
 *   - Plugins receive a PluginContext with a limited API surface.
 *   - No direct access to localStorage, IndexedDB, or the DOM.
 *   - Network requests are proxied through the host (SSRF protection applies).
 *   - Plugins can only create/read nodes in their registered namespace.
 */

import type { SynthesisNode, NodeType, SpaceId, WidgetKind } from "@/types/synthesis";
import type { SynthesisSettings } from "@/types/settings";

/* ─── Plugin Manifest ─── */

export interface SynthesisPlugin {
    /** Unique plugin identifier (reverse-domain style recommended) */
    id: string;
    /** Human-readable name */
    name: string;
    /** SemVer version string */
    version: string;
    /** Short description */
    description?: string;
    /** Plugin author */
    author?: string;
    /** Minimum Synthesis OS version required */
    minHostVersion?: string;

    /** Custom node types this plugin provides */
    nodeTypes?: NodeTypeDefinition[];
    /** Custom scraping/processing tools */
    tools?: ToolDefinition[];
    /** Custom AI provider adapters */
    providers?: ProviderDefinition[];
    /** Custom widget components */
    widgets?: WidgetDefinition[];
    /** Command palette entries */
    commands?: CommandDefinition[];
    /** Settings schema additions */
    settings?: PluginSettingsDefinition[];

    /** Called once when the plugin is loaded */
    init(context: PluginContext): void | Promise<void>;
    /** Called when the plugin is unloaded */
    destroy?(): void | Promise<void>;
}

/* ─── Node Type Extension ─── */

export interface NodeTypeDefinition {
    /** The NodeType string (must be unique across all plugins) */
    type: string;
    /** Display label */
    label: string;
    /** Lucide icon name */
    icon: string;
    /** Default dimensions for new nodes of this type */
    defaultSize: { w: number; h: number };
    /**
     * React component to render inside the card.
     * Receives the node and a scoped API for updates.
     */
    renderer: React.ComponentType<NodeRendererProps>;
}

export interface NodeRendererProps {
    node: SynthesisNode;
    api: NodeRendererApi;
}

export interface NodeRendererApi {
    /** Update the node's content */
    updateContent(content: Partial<SynthesisNode["content"]>): void;
    /** Close this node */
    close(): void;
    /** Trigger a synthesis with a query */
    synthesize(query: string): void;
}

/* ─── Tool Extension ─── */

export interface ToolDefinition {
    /** Unique tool identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description shown in the command palette */
    description: string;
    /**
     * The tool's execute function.
     * Receives input (e.g., a URL or query) and returns extracted content.
     */
    execute(input: string, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
    /** Make an HTTP request (proxied through the host for security) */
    fetch(url: string, init?: RequestInit): Promise<Response>;
    /** Log a message to the debug panel */
    log(message: string): void;
    /** Current settings snapshot */
    settings: Readonly<SynthesisSettings>;
}

export interface ToolResult {
    /** Extracted text content */
    text?: string;
    /** Extracted structured data */
    data?: Record<string, unknown>;
    /** Source URLs */
    sources?: string[];
    /** Image URLs found */
    images?: string[];
}

/* ─── AI Provider Extension ─── */

export interface ProviderDefinition {
    /** Provider identifier (e.g., "my-custom-llm") */
    id: string;
    /** Display name */
    name: string;
    /** Available model IDs */
    models: { id: string; label: string }[];
    /** Factory function that creates an AI SDK-compatible provider */
    createProvider(config: { apiKey?: string; endpoint?: string }): unknown;
}

/* ─── Widget Extension ─── */

export interface WidgetDefinition {
    /** Widget kind identifier */
    kind: string;
    /** Display label */
    label: string;
    /** Lucide icon name */
    icon: string;
    /** Default card size */
    defaultSize: { w: number; h: number };
    /** React component for the widget */
    component: React.ComponentType<WidgetComponentProps>;
}

export interface WidgetComponentProps {
    nodeId: string;
}

/* ─── Command Extension ─── */

export interface CommandDefinition {
    /** Unique command identifier */
    id: string;
    /** Display label in the command palette */
    label: string;
    /** Description / subtitle */
    description?: string;
    /** Lucide icon name */
    icon?: string;
    /** Keyboard shortcut (e.g., "Cmd+Shift+P") */
    shortcut?: string;
    /** Action to execute when the command is selected */
    execute(context: CommandContext): void | Promise<void>;
}

export interface CommandContext {
    /** Switch to a space */
    switchSpace(spaceId: SpaceId): void;
    /** Open settings panel */
    openSettings(): void;
    /** Create a new node */
    createNode(opts: { type: NodeType; title: string; query?: string }): string;
    /** Focus the input bar */
    focusInput(): void;
    /** Run a synthesis */
    synthesize(query: string): void;
}

/* ─── Plugin Settings Extension ─── */

export interface PluginSettingsDefinition {
    /** Setting key (namespaced to plugin: "plugin.myPlugin.settingKey") */
    key: string;
    /** Display label */
    label: string;
    /** Description */
    description?: string;
    /** Setting type */
    type: "string" | "number" | "boolean" | "select";
    /** Default value */
    defaultValue: string | number | boolean;
    /** Options for select type */
    options?: { label: string; value: string }[];
}

/* ─── Plugin Context (runtime API given to plugins) ─── */

export interface PluginContext {
    /** Current Synthesis OS version */
    hostVersion: string;
    /** Read-only settings snapshot */
    settings: Readonly<SynthesisSettings>;

    /** Create a node in the current space */
    createNode(opts: {
        type: string;
        title: string;
        query?: string;
        content?: SynthesisNode["content"];
        widgetKind?: string;
    }): string;

    /** Read nodes in the current space */
    getNodes(): ReadonlyArray<SynthesisNode>;

    /** Update a node by ID (only nodes created by this plugin) */
    updateNode(nodeId: string, updates: Partial<SynthesisNode>): void;

    /** Log to the debug panel */
    log(level: "info" | "warn" | "error", message: string): void;

    /** Make a network request (proxied, SSRF-protected) */
    fetch(url: string, init?: RequestInit): Promise<Response>;

    /** Register a keyboard shortcut */
    registerShortcut(keys: string, handler: () => void): () => void;

    /** Show a toast notification */
    showToast(message: string, type?: "info" | "success" | "error"): void;
}

/* ─── Plugin Registry (host-side) ─── */

export interface PluginRegistry {
    /** All registered plugins */
    plugins: Map<string, SynthesisPlugin>;

    /** Register a plugin */
    register(plugin: SynthesisPlugin): Promise<void>;

    /** Unregister a plugin */
    unregister(pluginId: string): Promise<void>;

    /** Get all registered node types from plugins */
    getNodeTypes(): NodeTypeDefinition[];

    /** Get all registered tools from plugins */
    getTools(): ToolDefinition[];

    /** Get all registered providers from plugins */
    getProviders(): ProviderDefinition[];

    /** Get all registered widgets from plugins */
    getWidgets(): WidgetDefinition[];

    /** Get all registered commands from plugins */
    getCommands(): CommandDefinition[];
}
