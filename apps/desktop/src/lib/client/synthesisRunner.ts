import { getKernelEventsUrl, kernelInvoke } from "@/lib/apiClient";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import { isTauri } from "@/lib/tauriBridge";

export interface SynthesisEvent {
    type: "progress" | "metadata" | "partial" | "error" | "done";
    [key: string]: any;
}

/**
 * Streaming synthesis via Rust kernel.
 *
 * Flow:
 *  1. Invoke `submit_synthesis_task` — spawns a SynthesisAgent in Rust.
 *  2. Listen for `synthesis-progress` events → yield as "progress" events.
 *  3. Listen for `synthesis-complete` → yield the full card as a "partial" (final=true) + "done".
 *  4. Listen for `synthesis-error` → yield as "error".
 */
export async function* streamSynthesisClient(
    query: string,
    aiSettings: any,
    conversationHistory?: any,
    signal?: AbortSignal,
): AsyncGenerator<SynthesisEvent> {
    if (signal?.aborted) return;

    const taskId = uuidv4();

    // --- Event queue + wait mechanism ---
    const eventQueue: SynthesisEvent[] = [];
    let resolveWait: (() => void) | null = null;
    let finished = false;

    const push = (evt: SynthesisEvent) => {
        eventQueue.push(evt);
        if (resolveWait) {
            resolveWait();
            resolveWait = null;
        }
    };

    const waitForEvent = (): Promise<void> =>
        new Promise<void>((resolve) => {
            if (eventQueue.length > 0 || finished) {
                resolve();
                return;
            }
            resolveWait = resolve;
        });

    const unlisteners: UnlistenFn[] = [];
    let eventSource: EventSource | null = null;

    if (isTauri()) {
        const { listen } = await import("@tauri-apps/api/event");

        // Progress events (classifying, generating, etc.)
        const unlistenProgress = await listen<{
        task_id: string;
        phase: string;
        message: string;
    }>("synthesis-progress", (event) => {
        if (event.payload.task_id !== taskId) return;
        push({
            type: "progress",
            step: event.payload.message,
            phase: event.payload.phase,
        });
    });
    unlisteners.push(unlistenProgress);

    // Completion event — carries the full card JSON
    const unlistenComplete = await listen<{
        task_id: string;
        query: string;
        card: Record<string, unknown>;
    }>("synthesis-complete", (event) => {
        if (event.payload.task_id !== taskId) return;

        const card = event.payload.card;

        // Emit metadata
        push({
            type: "metadata",
            intent: (card.type as string) || "general",
            sources: (card.sources as string[]) || [],
            logs: (card.logs as string[]) || [],
        });

        // Emit the card as a final partial
        push({
            type: "partial",
            object: card,
            final: true,
        });

        push({ type: "done", success: true });
        finished = true;
    });
    unlisteners.push(unlistenComplete);

    // Error event
    const unlistenError = await listen<{
        task_id: string;
        query: string;
        error: string;
    }>("synthesis-error", (event) => {
        if (event.payload.task_id !== taskId) return;
        push({ type: "error", error: event.payload.error });
        finished = true;
    });
    unlisteners.push(unlistenError);
    } else {
        const url = getKernelEventsUrl(taskId);
        if (!url) {
            yield { type: "error", error: "Not authenticated. Please log in." };
            return;
        }
        const es = new EventSource(url);
        eventSource = es;
        es.addEventListener("synthesis-progress", (e: MessageEvent) => {
            try {
                const { message, phase } = JSON.parse(e.data || "{}");
                push({ type: "progress", step: message, phase: phase || "generating" });
            } catch (_) {}
        });
        es.addEventListener("synthesis-complete", (e: MessageEvent) => {
            try {
                const { card } = JSON.parse(e.data || "{}");
                push({ type: "metadata", intent: (card?.type as string) || "general", sources: card?.sources || [], logs: card?.logs || [] });
                push({ type: "partial", object: card || {}, final: true });
                push({ type: "done", success: true });
                finished = true;
                es.close();
            } catch (_) {}
        });
        es.addEventListener("synthesis-error", (e: MessageEvent) => {
            try {
                const { error } = JSON.parse(e.data || "{}");
                push({ type: "error", error: error || "Synthesis failed" });
                finished = true;
                es.close();
            } catch (_) {}
        });
        es.onerror = () => {
            if (!finished) {
                push({ type: "error", error: "Connection lost" });
                finished = true;
            }
            es.close();
        };
    }

    // --- Submit to Rust kernel ---
    try {
        yield { type: "progress", step: "Submitting to Rust kernel...", phase: "init" };
        await kernelInvoke("submit_synthesis_task", { query, taskId });
        yield { type: "progress", step: "Waiting for LLM response...", phase: "generating" };
    } catch (err: any) {
        yield { type: "error", error: err.message || String(err) };
        for (const u of unlisteners) u();
        if (eventSource) eventSource.close();
        return;
    }

    // --- Drain events ---
    try {
        while (!finished && !signal?.aborted) {
            await waitForEvent();

            while (eventQueue.length > 0) {
                const evt = eventQueue.shift()!;
                yield evt;

                if (evt.type === "done" || evt.type === "error") {
                    finished = true;
                    break;
                }
            }
        }
    } finally {
        for (const u of unlisteners) u();
        if (eventSource) eventSource.close();
    }
}

/**
 * Non-streaming synthesis via Rust kernel.
 * Submits the query and waits for the complete result.
 */
export async function synthesizeClient(
    query: string,
    aiSettings?: any,
    conversationHistory?: any,
): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
    details?: string;
}> {
    if (!query) return { success: false, error: "Empty intent", details: "No query provided" };

    const taskId = uuidv4();

    return new Promise((resolve) => {
        const unlisteners: UnlistenFn[] = [];
        let settled = false;

        const cleanup = () => {
            for (const u of unlisteners) u();
        };

        // Timeout: 60 seconds
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                resolve({ success: false, error: "Synthesis timeout (60s)", details: "The Rust kernel did not respond in time." });
            }
        }, 60000);

        void (async () => {
            try {
                if (isTauri()) {
                    const { listen } = await import("@tauri-apps/api/event");
                    const unlistenComplete = await listen<{
                        task_id: string;
                        query: string;
                        card: Record<string, unknown>;
                    }>("synthesis-complete", (event: { payload: { task_id: string; card: Record<string, unknown> } }) => {
                        if (event.payload.task_id !== taskId || settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        cleanup();
                        resolve({
                            success: true,
                            data: event.payload.card as Record<string, unknown>,
                        });
                    });
                    unlisteners.push(unlistenComplete);

                    const unlistenError = await listen<{
                        task_id: string;
                        query: string;
                        error: string;
                    }>("synthesis-error", (event: { payload: { task_id: string; error: string } }) => {
                        if (event.payload.task_id !== taskId || settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        cleanup();
                        resolve({
                            success: false,
                            error: event.payload.error,
                            details: event.payload.error,
                        });
                    });
                    unlisteners.push(unlistenError);
                } else {
                    const url = getKernelEventsUrl(taskId);
                    if (!url) {
                        settled = true;
                        cleanup();
                        resolve({ success: false, error: "Not authenticated", details: "Please log in." });
                        return;
                    }
                    const es = new EventSource(url);
                    es.addEventListener("synthesis-complete", (e: MessageEvent) => {
                        if (settled) return;
                        try {
                            const { task_id, card } = JSON.parse(e.data || "{}");
                            if (task_id !== taskId) return;
                            settled = true;
                            clearTimeout(timeout);
                            es.close();
                            resolve({ success: true, data: card });
                        } catch (_) {}
                    });
                    es.addEventListener("synthesis-error", (e: MessageEvent) => {
                        if (settled) return;
                        try {
                            const { task_id, error } = JSON.parse(e.data || "{}");
                            if (task_id !== taskId) return;
                            settled = true;
                            clearTimeout(timeout);
                            es.close();
                            resolve({ success: false, error: error || "Synthesis failed", details: error });
                        } catch (_) {}
                    });
                    es.onerror = () => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeout);
                            es.close();
                            resolve({ success: false, error: "Connection lost", details: "EventSource error" });
                        }
                    };
                }

                await kernelInvoke("submit_synthesis_task", { query, taskId });
            } catch (err: unknown) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    cleanup();
                    const message = err instanceof Error ? err.message : String(err);
                    resolve({
                        success: false,
                        error: message,
                        details: String(err),
                    });
                }
            }
        })();
    });
}
