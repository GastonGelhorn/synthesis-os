import { getKernelEventsUrl, kernelInvoke } from "@/lib/apiClient";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentSSEEvent } from "@/lib/agent/types";
import { isTauri } from "@/lib/tauriBridge";

/**
 * Extract a human-readable summary from an A2UI JSONL response string.
 * Looks for {"summary":...} lines or collects Text component content.
 */
function extractSummaryFromA2UIResponse(response: string): string {
    const objs = extractTopLevelJsonObjects(response);
    for (const obj of objs) {
        try {
            // Direct summary message
            if (typeof obj.summary === "string") return obj.summary;
            // Text component with usageHint "h1" or "h2" (title-like)
            if (obj.surfaceUpdate) {
                const su = obj.surfaceUpdate;
                if (su.Text && typeof su.Text === "string") return su.Text;
                if (su.Callout && typeof su.Callout === "object") {
                    if (typeof su.Callout.content === "string" && su.Callout.content.trim()) return su.Callout.content.trim();
                    if (typeof su.Callout.title === "string" && su.Callout.title.trim()) return su.Callout.title.trim();
                }
                if (su.DataGrid && typeof su.DataGrid === "object" && Array.isArray(su.DataGrid.items) && su.DataGrid.items.length > 0) {
                    const first = su.DataGrid.items[0];
                    if (first && typeof first === "object" && typeof first.label === "string" && typeof first.value === "string") {
                        return `${first.label}: ${first.value}`;
                    }
                }
                if (su.components) {
                    for (const c of su.components) {
                        if (c.Text && typeof c.Text === "string") return c.Text;
                    }
                }
            }
        } catch { /* skip invalid lines */ }
    }
    return "";
}

function extractTopLevelJsonObjects(raw: string): any[] {
    const out: any[] = [];
    if (!raw || typeof raw !== "string") return out;
    const text = raw.trim();
    if (!text) return out;

    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth += 1;
            continue;
        }
        if (ch === "}") {
            if (depth > 0) depth -= 1;
            if (depth === 0 && start >= 0) {
                const candidate = text.slice(start, i + 1);
                try {
                    const parsed = JSON.parse(candidate);
                    if (parsed && typeof parsed === "object") out.push(parsed);
                } catch {
                    // Ignore malformed candidate
                }
                start = -1;
            }
        }
    }
    return out;
}

function extractA2UIMessages(responseText: string): any[] {
    const objs = extractTopLevelJsonObjects(responseText);
    return objs.filter((obj) => {
        if (!obj || typeof obj !== "object") return false;
        return !!(obj.beginRendering || obj.surfaceUpdate || obj.dataModelUpdate || obj.endRendering);
    });
}

function parseJsonObject(raw: string): any | null {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
        if (typeof parsed === "string") {
            const nested = JSON.parse(parsed);
            return nested && typeof nested === "object" ? nested : null;
        }
        return null;
    } catch {
        return null;
    }
}

function extractJsonCandidate(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const fullFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fullFence?.[1]) return fullFence[1].trim();

    const anyFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (anyFence?.[1]) return anyFence[1].trim();

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return null;
}

function parseStructuredCardResponse(responseText: string): {
    title?: string;
    summary?: string;
    blocks?: Array<Record<string, unknown>>;
    design?: Record<string, unknown>;
} | null {
    const normalizeCandidate = (candidate: any): {
        title?: string;
        summary?: string;
        blocks?: Array<Record<string, unknown>>;
        design?: Record<string, unknown>;
    } | null => {
        if (!candidate || typeof candidate !== "object") return null;

        const root = candidate.card && typeof candidate.card === "object"
            ? candidate.card
            : candidate.response && typeof candidate.response === "object"
                ? candidate.response
                : candidate;

        if (!root || typeof root !== "object") return null;
        const looksLikeCard =
            root.type === "agent_task" ||
            Array.isArray(root.blocks) ||
            typeof root.summary === "string" ||
            typeof root.design === "object";
        if (!looksLikeCard) return null;

        return {
            title: typeof root.title === "string" ? root.title : undefined,
            summary: typeof root.summary === "string" ? root.summary : undefined,
            blocks: Array.isArray(root.blocks) ? root.blocks : [],
            design: root.design && typeof root.design === "object" ? root.design : undefined,
        };
    };

    const parsedDirect = parseJsonObject(responseText);
    const normalizedDirect = normalizeCandidate(parsedDirect);
    if (normalizedDirect) return normalizedDirect;

    const candidateJson = extractJsonCandidate(responseText);
    if (!candidateJson) return null;
    const parsedCandidate = parseJsonObject(candidateJson);
    const normalizedCandidate = normalizeCandidate(parsedCandidate);
    if (normalizedCandidate) return normalizedCandidate;

    return null;
}

export interface CardGeneratedEvent {
    type: "card_generated";
    card: Record<string, unknown>;
    sources?: string[];
    /** True when A2UI streaming was active — tells useSynthesis to preserve a2uiState */
    hadA2UIMessages?: boolean;
}

export interface AgentStreamEvent {
    type: "agent_stream";
    taskId: string;
    chunk: string;
    isFinal: boolean;
    isReasoning?: boolean;
    accumulated: string;
}

export interface AgentUiPatchEvent {
    type: "agent_ui_patch";
    taskId: string;
    patch: any;
}

export interface AgentToolResultEvent {
    type: "agent_tool_result";
    taskId: string;
    toolName: string;
    toolInput: string;
    resultText: string;
    success: boolean;
    stepIndex: number;
}

export interface AgentA2UIMessageEvent {
    type: "agent_a2ui_message";
    taskId: string;
    message: unknown;
}

export type AgentRunEvent = AgentSSEEvent | CardGeneratedEvent | AgentStreamEvent | AgentUiPatchEvent | AgentToolResultEvent | AgentA2UIMessageEvent;

export interface AgentRunParams {
    query: string;
    taskId: string;
    conversationHistory?: string;
    nodeSummaries?: any[];
    settings: any;
    /** When "os", agent responds conversationally; no card created. */
    mode?: "os" | "task";
    /** User context (timezone, location, etc.) for personalization */
    userContext?: string;
}

/**
 * Runs the agent task via the Rust kernel and bridges Tauri IPC events
 * back into the same AsyncGenerator<AgentSSEEvent> shape the UI expects.
 *
 * Flow:
 *  1. Invoke `submit_agent_task` — spawns the kernel BaseAgent.
 *  2. Listen for `agent-status-update` events (STARTING, THINKING, ACTING, COMPLETE, ERROR)
 *     and translate them into the SSE event vocabulary the UI already handles.
 *  3. Listen for `agent-response` — the final result with card data + tool steps.
 *  4. Yield events until the agent reaches a terminal state (COMPLETE or ERROR).
 */
export async function* runAgentClient(
    params: AgentRunParams,
    signal?: AbortSignal,
): AsyncGenerator<AgentRunEvent> {
    const { query, taskId, settings } = params;

    if (signal?.aborted) return;

    // --- Event queue: Tauri listeners or HTTP SSE push events here, the generator pulls them ---
    const eventQueue: Array<AgentRunEvent> = [];
    let resolveWait: (() => void) | null = null;
    let finished = false;

    const push = (evt: AgentRunEvent) => {
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

    // --- Setup event source: Tauri IPC or HTTP SSE (for iPad/remote) ---
    const unlisteners: UnlistenFn[] = [];
    let eventSource: EventSource | null = null;

    // Track reasoning step index for generating stable step IDs
    let stepIndex = 0;
    const taskStartTime = Date.now();
    const isOsMode = params.mode === "os";
    // Track if any A2UI messages were received during this session
    let hadA2UIMessages = false;
    let streamAccumulatedReasoning = ""; // Reasoning tokens only
    let streamAccumulatedContent = "";   // Content tokens only
    const parseSsePayload = (raw: string): any => {
        try {
            const parsed = JSON.parse(raw || "{}");
            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                (parsed as Record<string, unknown>).payload &&
                typeof (parsed as Record<string, unknown>).payload === "object"
            ) {
                return (parsed as Record<string, unknown>).payload;
            }
            return parsed;
        } catch {
            return {};
        }
    };
    const eventMatchesTask = (payload: any): boolean => {
        const id =
            payload?.task_id ??
            payload?.process_id ??
            payload?.agent_id ??
            payload?.id;
        return typeof id !== "string" || id === taskId;
    };

    if (isTauri()) {
        const { listen } = await import("@tauri-apps/api/event");

        // 1. agent-status-update: granular progress from the Rust agent's ReAct loop
        //    We translate Rust status states into richer SSE events with contextual detail.
        let lastToolName = ""; // Track the tool being called for better UX
        let lastSemanticDetail = ""; // Semantic label from THINKING (e.g. "Searching the web") — preserved for step_completed
        const unlistenStatus = await listen<{
            process_id: string;
            state: string;
            details: string;
        }>("agent-status-update", (event) => {
            const { process_id, state, details } = event.payload;
            if (process_id !== taskId || finished) return;

            switch (state) {
                case "STARTING":
                    push({ type: "task_started", taskId } as AgentSSEEvent);
                    push({
                        type: "step_started",
                        taskId,
                        step: {
                            id: `step-${stepIndex++}`,
                            taskId,
                            index: stepIndex,
                            type: "llm_reasoning",
                            status: "running",
                            reasoning: details,
                        },
                    } as AgentSSEEvent);
                    break;

                case "PLANNING":
                    lastSemanticDetail = details;
                    push({
                        type: "step_progress",
                        taskId,
                        stepId: `step-${stepIndex}`,
                        reasoning: details,
                    } as AgentSSEEvent);
                    break;

                case "THINKING": {
                    // Extract richer context from the details string
                    // Rust now emits enriched details like "Reasoning about next steps (Step 1)..."
                    let enrichedDetail = details;

                    if (details.includes("Recalling context") || details.includes("Selecting tools")) {
                        // Single-agent boot phase — reset accumulators
                        streamAccumulatedReasoning = "";
                        streamAccumulatedContent = "";
                    } else if (details.includes("Reasoning about next steps") || details.includes("Reasoning...")) {
                        // New reasoning cycle — reset accumulators for fresh stream
                        streamAccumulatedReasoning = "";
                        streamAccumulatedContent = "";
                    } else if (details.includes("Reasoning")) {
                        // Legacy reasoning step
                        streamAccumulatedReasoning = "";
                        streamAccumulatedContent = "";
                        enrichedDetail = "Reasoning...";
                    } else if (details.includes("Calling:")) {
                        // Tool call preview AFTER LLM response — DON'T reset
                        // Reasoning should remain visible during tool execution
                        const toolsStr = details.replace("Calling:", "").trim();
                        const tools = toolsStr.split(",").map(t => t.trim());
                        lastToolName = tools[0] || "";
                        enrichedDetail = `Planning to use: ${tools.join(", ")}`;
                    } else if (details.includes("Processing results from")) {
                        // Post-tool processing — DON'T reset reasoning
                        enrichedDetail = details;
                    } else if (details.length <= 80 && !details.includes("Executing tool:") && !details.includes("CONTENT:") && !details.includes("TOOL_CALL:")) {
                        // Semantic label from kernel — preserve for step_completed when ACTING overwrites
                        lastSemanticDetail = details;
                    }

                    push({
                        type: "step_progress",
                        taskId,
                        stepId: `step-${stepIndex}`,
                        reasoning: enrichedDetail,
                    } as AgentSSEEvent);
                    break;
                }

                case "ACTING": {
                    // Mark previous reasoning step complete, start a tool step
                    // Extract tool name: "Executing tool: web_search..." → "web_search"
                    const toolName = details.replace("Executing tool: ", "").replace("...", "").trim();
                    lastToolName = toolName;

                    push({
                        type: "step_completed",
                        taskId,
                        step: {
                            id: `step-${stepIndex}`,
                            taskId,
                            index: stepIndex,
                            type: "llm_reasoning",
                            status: "completed",
                            reasoning: lastSemanticDetail || details,
                            completedAt: Date.now(),
                        },
                    } as AgentSSEEvent);
                    stepIndex++;
                    push({
                        type: "step_started",
                        taskId,
                        step: {
                            id: `step-${stepIndex}`,
                            taskId,
                            index: stepIndex,
                            type: "tool_call",
                            status: "running",
                            toolName,
                            toolInput: "",
                        },
                    } as AgentSSEEvent);
                    break;
                }

                case "COMPLETE":
                    // The agent finished. `agent-response` carries the full payload.
                    // We don't push task_completed yet — wait for agent-response.
                    push({
                        type: "step_completed",
                        taskId,
                        step: {
                            id: `step-${stepIndex}`,
                            taskId,
                            index: stepIndex,
                            type: "llm_reasoning",
                            status: "completed",
                            reasoning: details,
                            completedAt: Date.now(),
                        },
                    } as AgentSSEEvent);
                    break;

                case "ERROR":
                    push({
                        type: "task_failed",
                        taskId,
                        error: details,
                    } as AgentSSEEvent);
                    finished = true;
                    break;
            }
        });
        unlisteners.push(unlistenStatus);

        // 1.5. agent-stream: real-time LLM token streams for UI skeleton hydration
        const unlistenStream = await listen<{
            agent_id: string;
            chunk: string;
            is_final: boolean;
            is_reasoning?: boolean;
        }>("agent-stream", (event) => {
            const { agent_id, chunk, is_final, is_reasoning } = event.payload;
            if (agent_id !== taskId) return;

            // Skip empty non-final chunks
            if (!chunk && !is_final) return;

            // Track reasoning and content separately
            if (is_reasoning) {
                streamAccumulatedReasoning += chunk;
            } else {
                streamAccumulatedContent += chunk;
            }

            push({
                type: "agent_stream",
                taskId,
                chunk,
                isFinal: is_final,
                isReasoning: is_reasoning,
                accumulated: is_reasoning ? streamAccumulatedReasoning : streamAccumulatedContent,
            } as AgentStreamEvent);
        });
        unlisteners.push(unlistenStream);

        // 2. agent-response: final result from the Rust agent (includes card data + tool steps)
        //    This event means the agent has FINISHED — we generate the card and close.
        //    When mode==="os", emit conversation_message instead of card_generated.
        const unlistenResponse = await listen<{
            task_id: string;
            query: string;
            response: string;
            steps?: Array<{ tool: string; input: string; result: string }>;
        }>("agent-response", (event) => {
            const payload = event.payload;
            if (payload.task_id !== taskId) return;

            if (isOsMode) {
                const a2uiMessages = extractA2UIMessages(payload.response || "");
                if (a2uiMessages.length > 0 && !hadA2UIMessages) {
                    hadA2UIMessages = true;
                    for (const msg of a2uiMessages) {
                        push({
                            type: "agent_a2ui_message",
                            taskId,
                            message: msg,
                        } as AgentA2UIMessageEvent);
                    }
                }
                const responseText = payload.response?.trim() || "";
                const a2uiSummary = extractSummaryFromA2UIResponse(responseText);
                const text = a2uiSummary || (responseText.length > 0
                    ? (responseText.length > 500 && responseText.startsWith("{")
                        ? (() => {
                            try {
                                const p = JSON.parse(responseText);
                                return typeof p.summary === "string" ? p.summary : responseText;
                            } catch {
                                return responseText;
                            }
                        })()
                        : responseText
                    )
                    : "I'm here. How can I help?");
                push({
                    type: "conversation_message",
                    text,
                    query: payload.query,
                    taskId,
                } as import("@/lib/agent/types").AgentSSEEvent);
            } else {
                const a2uiMessages = extractA2UIMessages(payload.response || "");
                if (a2uiMessages.length > 0 && !hadA2UIMessages) {
                    hadA2UIMessages = true;
                    for (const msg of a2uiMessages) {
                        push({
                            type: "agent_a2ui_message",
                            taskId,
                            message: msg,
                        } as AgentA2UIMessageEvent);
                    }
                }
                // Build card content from the response
                let cardBlocks: Array<Record<string, unknown>> = [];
                const cardTitle = payload.query;
                let cardSummary = "";
                let cardDesign: Record<string, unknown> | undefined;

                if (hadA2UIMessages) {
                    // A2UI-only: blocks are in a2uiState on the node, just extract summary
                    cardSummary = extractSummaryFromA2UIResponse(payload.response);
                } else {
                    // No A2UI messages — attempt to parse JSON response
                    const responseText = payload.response?.trim() || "";
                    const parsedCard = parseStructuredCardResponse(responseText);
                    if (parsedCard) {
                        cardSummary = parsedCard.summary || parsedCard.title || payload.query;
                        cardBlocks = Array.isArray(parsedCard.blocks) ? parsedCard.blocks : [];
                        cardDesign = parsedCard.design;
                    } else if (responseText) {
                        cardSummary = responseText.length > 180 ? responseText.slice(0, 180) + "..." : responseText;
                        cardBlocks = [{ type: "text_block", style: "body", content: responseText }];
                    }
                }

                const card: Record<string, unknown> = {
                    type: "agent_task",
                    title: cardTitle,
                    summary: cardSummary || payload.query,
                    blocks: cardBlocks,
                    design: cardDesign,
                    logs: [`Completed in ${payload.steps?.length ?? 0} steps`],
                };

                push({
                    type: "card_generated",
                    card,
                    sources: [],
                    hadA2UIMessages,
                } as CardGeneratedEvent);
            }

            push({
                type: "task_completed",
                taskId,
                totalSteps: stepIndex + 1,
                durationMs: Date.now() - taskStartTime,
            } as AgentSSEEvent);

            finished = true;
        });
        unlisteners.push(unlistenResponse);

        // 4. agent-ui-patch: Hybrid UI intermediate blocks
        const unlistenUiPatch = await listen<{
            agent_id: string;
            patch: any;
        }>("agent-ui-patch", (event) => {
            const { agent_id, patch } = event.payload;
            if (agent_id !== taskId || finished) return;

            push({
                type: "agent_ui_patch",
                taskId,
                patch,
            });
        });
        unlisteners.push(unlistenUiPatch);

        // 4.5. agent-a2ui-message: A2UI JSONL streaming messages
        const unlistenA2UI = await listen<{
            agent_id: string;
            message: unknown;
        }>("agent-a2ui-message", (event) => {
            const { agent_id, message } = event.payload;
            if (agent_id !== taskId || finished) return;

            // Flag that A2UI streaming was active — used to skip redundant card building
            hadA2UIMessages = true;

            push({
                type: "agent_a2ui_message",
                taskId,
                message,
            });
        });
        unlisteners.push(unlistenA2UI);

        // 5. agent-tool-result: progressive tool result rendering
        //    When a tool result arrives, we also mark the tool step as completed
        //    so the UI can transition from "running" to the rich block immediately.
        const unlistenToolResult = await listen<{
            agent_id: string;
            tool_name: string;
            tool_input: string;
            result_text: string;
            success: boolean;
            step_index: number;
        }>("agent-tool-result", (event) => {
            const p = event.payload;
            if (p.agent_id !== taskId || finished) return;

            // Mark the tool step as completed
            push({
                type: "step_completed",
                taskId,
                step: {
                    id: `step-${stepIndex}`,
                    taskId,
                    index: stepIndex,
                    type: "tool_call",
                    status: "completed",
                    toolName: p.tool_name,
                    toolInput: p.tool_input,
                    toolResult: {
                        success: p.success,
                        text: p.result_text.slice(0, 200),
                        durationMs: 0,
                    },
                    completedAt: Date.now(),
                },
            } as AgentSSEEvent);

            // Then push the rich tool result event for block building
            push({
                type: "agent_tool_result",
                taskId,
                toolName: p.tool_name,
                toolInput: p.tool_input,
                resultText: p.result_text,
                success: p.success,
                stepIndex: p.step_index,
            } as AgentToolResultEvent);

            // Start a new reasoning step for the next iteration
            stepIndex++;
            push({
                type: "step_started",
                taskId,
                step: {
                    id: `step-${stepIndex}`,
                    taskId,
                    index: stepIndex,
                    type: "llm_reasoning",
                    status: "running",
                    reasoning: "Analyzing results...",
                },
            } as AgentSSEEvent);
        });
        unlisteners.push(unlistenToolResult);

        // 6. agent-approval-request: Human-in-the-loop gate for destructive tools (Alpha).
        //    Bridges to the existing approval_required SSE event so the UI shows InlineApproval.
        const unlistenApprovalReq = await listen<{
            agent_id: string;
            approval_key: string;
            tool_name: string;
            tool_input: string;
            step_index: number;
        }>("agent-approval-request", (event) => {
            const p = event.payload;
            if (p.agent_id !== taskId || finished) return;

            const approvalStepId = `approval-${p.approval_key}`;

            push({
                type: "step_completed",
                taskId,
                step: {
                    id: `step-${stepIndex}`,
                    taskId,
                    index: stepIndex,
                    type: "llm_reasoning",
                    status: "completed",
                    reasoning: `Requesting approval for ${p.tool_name}`,
                    completedAt: Date.now(),
                },
            } as AgentSSEEvent);
            stepIndex++;

            push({
                type: "approval_required",
                step: {
                    id: approvalStepId,
                    taskId,
                    index: stepIndex,
                    type: "tool_call",
                    status: "waiting_approval",
                    toolName: p.tool_name,
                    toolInput: p.tool_input,
                    approval: {
                        required: true,
                        status: "pending" as const,
                        reason: `Destructive operation: ${p.tool_name}`,
                    },
                },
            } as AgentSSEEvent);
        });
        unlisteners.push(unlistenApprovalReq);

        // 7. intent-cache-hit: Instant shortcut — cache intercepted the query
        const unlistenCacheHit = await listen<{
            task_id: string;
            query: string;
            tool_name: string;
            similarity: number;
        }>("intent-cache-hit", (event) => {
            const p = event.payload;
            if (p.task_id !== taskId || finished) return;

            push({
                type: "step_started",
                taskId,
                step: {
                    id: `step-${stepIndex}`,
                    taskId,
                    index: stepIndex,
                    type: "tool_call",
                    status: "running",
                    toolName: p.tool_name,
                    toolInput: `⚡ Shortcut (${Math.round(p.similarity * 100)}% match)`,
                },
            } as AgentSSEEvent);
        });
        unlisteners.push(unlistenCacheHit);

        // 8. intent-cache-result: Tool executed via cache shortcut — finalize
        const unlistenCacheResult = await listen<{
            task_id: string;
            tool_name: string;
            result: string;
            success: boolean;
        }>("intent-cache-result", (event) => {
            const p = event.payload;
            if (p.task_id !== taskId || finished) return;

            // Mark tool step complete
            push({
                type: "step_completed",
                taskId,
                step: {
                    id: `step-${stepIndex}`,
                    taskId,
                    index: stepIndex,
                    type: "tool_call",
                    status: "completed",
                    toolName: p.tool_name,
                    toolInput: "",
                    toolResult: {
                        success: p.success,
                        text: p.result.slice(0, 200),
                        durationMs: 0,
                    },
                    completedAt: Date.now(),
                },
            } as AgentSSEEvent);

            push({
                type: "agent_tool_result",
                taskId,
                toolName: p.tool_name,
                toolInput: "",
                resultText: p.result,
                success: p.success,
                stepIndex: 0,
            } as AgentToolResultEvent);

            // Emit card or conversation message
            if (isOsMode) {
                push({
                    type: "conversation_message",
                    text: p.success ? p.result : `Tool error: ${p.result}`,
                    query: query,
                    taskId,
                } as import("@/lib/agent/types").AgentSSEEvent);
            } else {
                push({
                    type: "card_generated",
                    card: {
                        type: "agent_task",
                        title: query,
                        summary: p.success ? `⚡ ${p.tool_name}` : `Error: ${p.result}`,
                        blocks: [{ type: "text_block", style: "body", content: p.result }],
                    },
                    sources: [],
                    hadA2UIMessages: false,
                } as CardGeneratedEvent);
            }

            push({
                type: "task_completed",
                taskId,
                totalSteps: 1,
                durationMs: Date.now() - taskStartTime,
            } as AgentSSEEvent);

            finished = true;
        });
        unlisteners.push(unlistenCacheResult);

    } else {
        // Remote client (e.g. iPad): receive events via HTTP SSE
        const url = getKernelEventsUrl(taskId);
        if (!url) throw new Error("Not authenticated. Please log in.");
        const es = new EventSource(url);
        eventSource = es;
        let completeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

        es.addEventListener("agent-status-update", (e: MessageEvent) => {
            if (finished) return;
            try {
                const payload = parseSsePayload(e.data);
                if (!eventMatchesTask(payload)) return;
                const state = typeof payload?.state === "string" ? payload.state : "";
                const details = typeof payload?.details === "string" ? payload.details : "";
                switch (state) {
                    case "STARTING":
                        push({ type: "task_started", taskId } as AgentSSEEvent);
                        push({
                            type: "step_started",
                            taskId,
                            step: {
                                id: `step-${stepIndex++}`,
                                taskId,
                                index: stepIndex,
                                type: "llm_reasoning",
                                status: "running",
                                reasoning: details,
                            },
                        } as AgentSSEEvent);
                        break;
                    case "ERROR":
                        push({
                            type: "task_failed",
                            taskId,
                            error: details || "Agent error",
                        } as AgentSSEEvent);
                        finished = true;
                        if (completeFallbackTimer) {
                            clearTimeout(completeFallbackTimer);
                            completeFallbackTimer = null;
                        }
                        es.close();
                        break;
                    case "COMPLETE":
                        // Fallback: if agent-response is dropped, still surface final output.
                        // Delay a bit to let agent-response arrive first (richer payload).
                        if (completeFallbackTimer) clearTimeout(completeFallbackTimer);
                        completeFallbackTimer = setTimeout(() => {
                            if (finished) return;
                            const fallbackText = (details || "").trim() || "Task completed.";
                            if (isOsMode) {
                                push({
                                    type: "conversation_message",
                                    text: fallbackText,
                                    query: params.query,
                                    taskId,
                                } as import("@/lib/agent/types").AgentSSEEvent);
                            } else {
                                const card: Record<string, unknown> = {
                                    type: "agent_task",
                                    title: params.query,
                                    summary: fallbackText,
                                    blocks: [{ type: "text_block", style: "body", content: fallbackText }],
                                    logs: ["Completed (fallback from COMPLETE status)"],
                                };
                                push({
                                    type: "card_generated",
                                    card,
                                    sources: [],
                                    hadA2UIMessages: false,
                                } as CardGeneratedEvent);
                            }
                            push({
                                type: "task_completed",
                                taskId,
                                totalSteps: stepIndex + 1,
                                durationMs: Date.now() - taskStartTime,
                            } as AgentSSEEvent);
                            finished = true;
                            es.close();
                        }, 500);
                        break;
                    default:
                        push({
                            type: "step_progress",
                            taskId,
                            stepId: `step-${stepIndex}`,
                            reasoning: details,
                        } as AgentSSEEvent);
                        break;
                }
            } catch (_) { }
        });

        es.addEventListener("agent-response", (e: MessageEvent) => {
            if (finished) return;
            try {
                if (completeFallbackTimer) {
                    clearTimeout(completeFallbackTimer);
                    completeFallbackTimer = null;
                }
                const payload = parseSsePayload(e.data);
                if (!eventMatchesTask(payload)) return;
                const responseText = (payload.response || "").trim();
                const a2uiMessages = extractA2UIMessages(responseText);
                if (a2uiMessages.length > 0 && !hadA2UIMessages) {
                    hadA2UIMessages = true;
                    for (const msg of a2uiMessages) {
                        push({
                            type: "agent_a2ui_message",
                            taskId,
                            message: msg,
                        } as AgentA2UIMessageEvent);
                    }
                }
                if (isOsMode) {
                    const a2uiSummary = extractSummaryFromA2UIResponse(responseText);
                    const text = a2uiSummary || (responseText.length > 0
                        ? (responseText.length > 500 && responseText.startsWith("{")
                            ? (() => {
                                try {
                                    const p = JSON.parse(responseText);
                                    return typeof p.summary === "string" ? p.summary : responseText;
                                } catch {
                                    return responseText;
                                }
                            })()
                            : responseText
                        )
                        : "I'm here. How can I help?");
                    push({
                        type: "conversation_message",
                        text,
                        query: payload.query,
                        taskId,
                    } as import("@/lib/agent/types").AgentSSEEvent);
                } else {
                    let cardSummary = payload.query || "";
                    let cardBlocks: Array<Record<string, unknown>> = [];
                    let cardDesign: Record<string, unknown> | undefined;
                    if (hadA2UIMessages) {
                        cardSummary = extractSummaryFromA2UIResponse(responseText) || payload.query;
                        cardBlocks = [];
                    } else {
                        const parsedCard = parseStructuredCardResponse(responseText);
                        if (parsedCard) {
                            cardSummary = parsedCard.summary ?? parsedCard.title ?? payload.query;
                            cardBlocks = Array.isArray(parsedCard.blocks) ? parsedCard.blocks : [];
                            cardDesign = parsedCard.design;
                        } else if (responseText) {
                            cardSummary = responseText.length > 180 ? responseText.slice(0, 180) + "..." : responseText;
                            cardBlocks = [{ type: "text_block", style: "body", content: responseText }];
                        }
                    }
                    const card: Record<string, unknown> = {
                        type: "agent_task",
                        title: payload.query,
                        summary: cardSummary,
                        blocks: cardBlocks,
                        design: cardDesign,
                        logs: [`Completed in ${(payload.steps || []).length} steps`],
                    };
                    push({
                        type: "card_generated",
                        card,
                        sources: [],
                        hadA2UIMessages,
                    } as CardGeneratedEvent);
                }
                push({
                    type: "task_completed",
                    taskId,
                    totalSteps: stepIndex + 1,
                    durationMs: Date.now() - taskStartTime,
                } as AgentSSEEvent);
                finished = true;
                es.close();
            } catch (_) { }
        });

        es.addEventListener("agent-tool-result", (e: MessageEvent) => {
            if (finished) return;
            try {
                const p = parseSsePayload(e.data);
                if (!eventMatchesTask(p)) return;
                push({
                    type: "step_completed",
                    taskId,
                    step: {
                        id: `step-${stepIndex}`,
                        taskId,
                        index: stepIndex,
                        type: "tool_call",
                        status: "completed",
                        toolName: p.tool_name,
                        toolInput: p.tool_input,
                        toolResult: { success: p.success, text: (p.result_text || "").slice(0, 200), durationMs: 0 },
                        completedAt: Date.now(),
                    },
                } as AgentSSEEvent);
                push({
                    type: "agent_tool_result",
                    taskId,
                    toolName: p.tool_name,
                    toolInput: p.tool_input,
                    resultText: p.result_text,
                    success: p.success,
                    stepIndex: p.step_index,
                } as AgentToolResultEvent);
                stepIndex++;
                push({
                    type: "step_started",
                    taskId,
                    step: {
                        id: `step-${stepIndex}`,
                        taskId,
                        index: stepIndex,
                        type: "llm_reasoning",
                        status: "running",
                        reasoning: "Analyzing results...",
                    },
                } as AgentSSEEvent);
            } catch (_) { }
        });

        es.addEventListener("agent-approval-request", (e: MessageEvent) => {
            if (finished) return;
            try {
                const p = parseSsePayload(e.data);
                if (!eventMatchesTask(p)) return;
                const approvalStepId = `approval-${p.approval_key}`;
                push({
                    type: "approval_required",
                    step: {
                        id: approvalStepId,
                        taskId,
                        index: stepIndex,
                        type: "tool_call",
                        status: "waiting_approval",
                        toolName: p.tool_name,
                        toolInput: p.tool_input,
                        approval: {
                            required: true,
                            status: "pending" as const,
                            reason: `Destructive operation: ${p.tool_name}`,
                        },
                    },
                } as AgentSSEEvent);
            } catch (_) { }
        });

        es.onerror = () => {
            if (!finished) {
                if (completeFallbackTimer) {
                    clearTimeout(completeFallbackTimer);
                    completeFallbackTimer = null;
                }
                push({ type: "task_failed", taskId, error: "Connection lost" } as AgentSSEEvent);
                finished = true;
            }
            es.close();
        };
    }

    // --- Submit task to Rust kernel ---
    try {
        yield { type: "task_started", taskId } as AgentSSEEvent;
        await kernelInvoke("submit_agent_task", {
            query,
            taskId,
            conversationHistory: params.conversationHistory,
            nodeSummaries: params.nodeSummaries,
            mode: params.mode,
            userContext: params.userContext,
        });
    } catch (err: any) {
        yield { type: "task_failed", taskId, error: err.message || String(err) } as AgentSSEEvent;
        // Cleanup listeners
        for (const u of unlisteners) u();
        return;
    }

    // --- Drain events from the queue until the agent finishes or is aborted ---
    try {
        while (!signal?.aborted) {
            if (eventQueue.length === 0) {
                if (finished) break;
                await waitForEvent();
            }

            while (eventQueue.length > 0) {
                const evt = eventQueue.shift()!;
                yield evt;

                if (
                    evt.type === "task_completed" ||
                    evt.type === "task_failed" ||
                    evt.type === "task_cancelled"
                ) {
                    finished = true;
                }
            }

            if (finished && eventQueue.length === 0) break;
        }
    } finally {
        for (const u of unlisteners) u();
        if (eventSource) eventSource.close();
    }
}
