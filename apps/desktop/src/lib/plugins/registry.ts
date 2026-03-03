/**
 * Synthesis OS Plugin Registry
 *
 * Runtime registry that manages plugin lifecycle: loading, initialization,
 * and teardown. In Phase A (local plugins), plugins are registered manually
 * at application startup.
 *
 * STATUS: Skeleton implementation. Not yet wired into the application.
 */

import type {
    SynthesisPlugin,
    PluginRegistry,
    PluginContext,
    NodeTypeDefinition,
    ToolDefinition,
    ProviderDefinition,
    WidgetDefinition,
    CommandDefinition,
} from "./types";

const HOST_VERSION = "0.9.4";

export function createPluginRegistry(): PluginRegistry {
    const plugins = new Map<string, SynthesisPlugin>();

    async function register(plugin: SynthesisPlugin): Promise<void> {
        if (plugins.has(plugin.id)) {
            console.warn(`[PluginRegistry] Plugin "${plugin.id}" already registered, skipping.`);
            return;
        }

        // Version compatibility check
        if (plugin.minHostVersion && plugin.minHostVersion > HOST_VERSION) {
            console.error(
                `[PluginRegistry] Plugin "${plugin.id}" requires host >= ${plugin.minHostVersion}, current is ${HOST_VERSION}.`,
            );
            return;
        }

        // Create sandboxed context for the plugin
        const context = createPluginContext(plugin.id);

        try {
            await plugin.init(context);
            plugins.set(plugin.id, plugin);
            console.log(`[PluginRegistry] Registered plugin: ${plugin.name} v${plugin.version}`);
        } catch (err) {
            console.error(`[PluginRegistry] Failed to initialize plugin "${plugin.id}":`, err);
        }
    }

    async function unregister(pluginId: string): Promise<void> {
        const plugin = plugins.get(pluginId);
        if (!plugin) return;

        try {
            await plugin.destroy?.();
        } catch (err) {
            console.error(`[PluginRegistry] Error destroying plugin "${pluginId}":`, err);
        }

        plugins.delete(pluginId);
        console.log(`[PluginRegistry] Unregistered plugin: ${pluginId}`);
    }

    function collectFromPlugins<T>(key: keyof SynthesisPlugin): T[] {
        const results: T[] = [];
        for (const plugin of Array.from(plugins.values())) {
            const items = plugin[key];
            if (Array.isArray(items)) {
                results.push(...(items as T[]));
            }
        }
        return results;
    }

    return {
        plugins,
        register,
        unregister,
        getNodeTypes: () => collectFromPlugins<NodeTypeDefinition>("nodeTypes"),
        getTools: () => collectFromPlugins<ToolDefinition>("tools"),
        getProviders: () => collectFromPlugins<ProviderDefinition>("providers"),
        getWidgets: () => collectFromPlugins<WidgetDefinition>("widgets"),
        getCommands: () => collectFromPlugins<CommandDefinition>("commands"),
    };
}

/**
 * Creates a sandboxed PluginContext for a given plugin.
 * In Phase A this is a thin wrapper; in Phase C it would be
 * a postMessage proxy to an iframe/Worker.
 */
function createPluginContext(pluginId: string): PluginContext {
    return {
        hostVersion: HOST_VERSION,

        // Placeholder implementations - will be wired to real stores in Phase B
        settings: {} as any,

        createNode(_opts) {
            console.warn(`[Plugin:${pluginId}] createNode called but not yet wired.`);
            return "";
        },

        getNodes() {
            console.warn(`[Plugin:${pluginId}] getNodes called but not yet wired.`);
            return [];
        },

        updateNode(_nodeId, _updates) {
            console.warn(`[Plugin:${pluginId}] updateNode called but not yet wired.`);
        },

        log(level, message) {
            const prefix = `[Plugin:${pluginId}]`;
            if (level === "error") console.error(prefix, message);
            else if (level === "warn") console.warn(prefix, message);
            else console.log(prefix, message);
        },

        async fetch(url, init) {
            // In production, this would be proxied through the server
            // to enforce SSRF protection and rate limiting
            return globalThis.fetch(url, init);
        },

        registerShortcut(_keys, _handler) {
            console.warn(`[Plugin:${pluginId}] registerShortcut not yet wired.`);
            return () => {};
        },

        showToast(message, _type) {
            console.log(`[Plugin:${pluginId}] Toast: ${message}`);
        },
    };
}
