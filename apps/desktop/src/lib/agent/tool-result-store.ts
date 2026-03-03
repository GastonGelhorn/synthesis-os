/**
 * Global in-memory store for tool execution results.
 *
 * Problem: LangGraph's streamEvents serialization strips `toolResult` from
 * AgentStep objects, causing step_completed events to arrive without data.
 *
 * Solution: The graph's toolNode writes results here BEFORE returning.
 * The agentRunner reads them when processing step_completed events.
 * Both run in the same JS context (browser/Tauri), so shared memory works.
 *
 * Results auto-expire after 5 minutes to prevent memory leaks.
 */

import type { ToolExecResult } from "./types";

interface StoredResult {
    toolName: string;
    result: ToolExecResult;
    timestamp: number;
}

const store = new Map<string, StoredResult>();
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/** Store a tool result by step ID. Called from graph.ts toolNode. */
export function storeToolResult(stepId: string, toolName: string, result: ToolExecResult): void {
    store.set(stepId, { toolName, result, timestamp: Date.now() });
    // Also store by toolName as fallback (overwritten by latest call)
    store.set(`__latest_${toolName}`, { toolName, result, timestamp: Date.now() });
    // Cleanup expired entries
    const now = Date.now();
    const keys = Array.from(store.keys());
    for (const key of keys) {
        const val = store.get(key);
        if (val && now - val.timestamp > EXPIRY_MS) store.delete(key);
    }
}

/** Retrieve a tool result by step ID, or fall back to latest result for the tool. */
export function getToolResult(stepId: string, toolName?: string): ToolExecResult | null {
    const byId = store.get(stepId);
    if (byId) return byId.result;
    if (toolName) {
        const byName = store.get(`__latest_${toolName}`);
        if (byName) return byName.result;
    }
    return null;
}

/** Get ALL tool results stored during this task (for last-resort recovery). */
export function getAllToolResults(): Array<{ toolName: string; result: ToolExecResult }> {
    const results: Array<{ toolName: string; result: ToolExecResult }> = [];
    const keys = Array.from(store.keys());
    for (const key of keys) {
        if (key.startsWith("__latest_")) {
            const val = store.get(key);
            if (val) results.push({ toolName: val.toolName, result: val.result });
        }
    }
    return results;
}

/** Clear all stored results for a task (call on task completion). */
export function clearToolResults(): void {
    store.clear();
}
