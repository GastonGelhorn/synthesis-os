"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Tauri IPC event listeners are now handled inside agentRunner.ts and synthesisRunner.ts
import { v4 as uuidv4 } from "uuid";
import { synthesizeClient } from "@/lib/client/synthesisRunner";
import { streamSynthesisClient } from "@/lib/client/synthesisRunner";
import { runAgentClient, type AgentStreamEvent, type AgentUiPatchEvent, type AgentToolResultEvent, type AgentA2UIMessageEvent } from "@/lib/client/agentRunner";
import { resolvePendingApproval } from "@/lib/agent/approval-store";
import { kernelInvoke } from "@/lib/apiClient";
import { resolvePendingQuestion } from "@/lib/agent/question-store";
import { recordTaskStarted, recordTaskCompleted, recordTaskFailed, recordToolCall } from "@/lib/agent/metrics";
// Card template building is now handled inside agentRunner.ts (Rust kernel bridge)
import { SynthesisNode } from "@/types/synthesis";
import { SynthesisSettings } from "@/types/settings";
import { playSound, startAmbientSound, stopAmbientSound } from "@/lib/audio";
import { findNextOpenPosition } from "@/lib/positioning";
import type { AgentSSEEvent, AgentStep, ToolExecResult } from "@/lib/agent/types";
import type { SynthesisNodeStore } from "./useSynthesisNodesFromStore";
import { buildIntermediateBlock, getToolMeta } from "@/lib/agent/intermediateBlocks";
import { buildRichBlockFromToolResult } from "@/lib/agent/toolResultBlocks";
import { applyA2UIMessage, type A2UIState } from "@/lib/a2ui";
import { tryParsePartialJson } from "@/lib/utils/tryParsePartialJson";
import { loadUserProfile, formatUserContext } from "@/lib/context/userProfile";

const CARD_SIZES = {
    compact: { w: 280, h: 360 },
    medium: { w: 340, h: 420 },
    large: { w: 420, h: 520 },
} as const;

function sendBrowserNotification(title: string, body: string) {
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        try {
            new Notification(title, { body, icon: "/favicon.ico" });
        } catch {
            // Notification API not available
        }
    }
}

function isMissingOpenAIKeyError(message: string): boolean {
    return /missing openai api key/i.test(message);
}

/** Build rich context for continuation requests so the agent understands existing content and user intent. */
function buildContinuationContext(node: SynthesisNode): string {
    const lines: string[] = [];

    lines.push("### CONTINUATION ON EXISTING CARD ###");
    lines.push("The user is replying to this card. Interpret their intent:");
    lines.push("- ADD/merge: add, include, sum → KEEP existing content and ADD or REORGANIZE. Do NOT discard what exists.");
    lines.push("- RECREATE: recrear, rehacer, desde cero, haz de nuevo, redo, start over → REPLACE everything. Ignore existing content.");
    lines.push("When unclear, default to ADD (preserve and enhance).");
    lines.push("");

    lines.push("User: " + (node.query || ""));
    if (node.content.summary) {
        lines.push("Assistant: " + node.content.summary);
    }

    // Existing card content (condensed)
    const blocks = node.content.blocks || [];
    if (blocks.length > 0) {
        lines.push("");
        lines.push("Current card content (preserve and extend for ADD intent):");
        for (const b of blocks as any[]) {
            if (b._isIntermediate || b.type === "callout") continue;
            if (b.type === "list_block" && Array.isArray(b.items)) {
                const preview = b.items.slice(0, 5).map((i: any) => (i.title ?? i.text ?? i.label ?? i.description ?? "").slice(0, 80)).join(" | ");
                lines.push(`  - list: ${b.items.length} items. Sample: ${preview || "(empty)"}`);
            } else if (b.type === "image_gallery" && Array.isArray(b.images)) {
                lines.push(`  - images: ${b.images.length} URLs`);
            } else if (b.type === "text_block" && b.content) {
                lines.push(`  - text: ${String(b.content).slice(0, 120)}...`);
            } else {
                lines.push(`  - ${b.type || "block"}`);
            }
        }
    }

    const a2ui = node.content.a2uiState as { surfaceId?: string; componentMap?: Record<string, unknown> } | undefined;
    if (a2ui?.surfaceId && a2ui?.componentMap?.[a2ui.surfaceId]) {
        const comps = Object.keys((a2ui.componentMap[a2ui.surfaceId] as Record<string, unknown>) || {});
        if (comps.length > 0) {
            lines.push(`  - A2UI components: ${comps.join(", ")}`);
        }
    }

    // Prior follow-ups
    const userBlocks = blocks.filter((b: any) => b.type === "text_block" && (b as { content?: string }).content?.startsWith("**You:**"));
    for (const b of userBlocks) {
        lines.push("User: " + String((b as { content?: string }).content || "").replace(/^\*\*You:\*\*\s*/, ""));
    }

    return lines.join("\n");
}

interface CardGeneratedEvent {
    type: "card_generated";
    card: Record<string, unknown>;
    sources?: string[];
}

type AgentClientEvent = AgentSSEEvent | CardGeneratedEvent | AgentStreamEvent | AgentUiPatchEvent | AgentToolResultEvent | AgentA2UIMessageEvent;

export function useSynthesis(nodeStore: SynthesisNodeStore, settings: SynthesisSettings) {
    const {
        nodes,
        setNodes,
        setActiveNodeId,
        activeSpaceId,
        debugLog,
        addConversationMessage,
        addOsMessage,
        getSpaceHistory,
        getOsHistory,
        getHistoryForNode,
        getTaskById,
        addNode,
        upsertTask,
        updateTaskStep,
        updateTaskStatus,
    } = nodeStore;

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<{
        message: string;
        details?: string;
        query?: string;
    } | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [ephemeralToasts, setEphemeralToasts] = useState<Array<{ id: string; text: string; query: string }>>([]);
    const [pendingChatMessage, setPendingChatMessage] = useState<{ text: string; query: string } | null>(null);
    const [missingApiKeyProvider, setMissingApiKeyProvider] = useState<"openai" | null>(null);
    const [activeSynthCount, _setActiveSynthCount] = useState(0);
    const activeSynthCountRef = useRef(0);
    /** Synced setter: updates both state and ref atomically */
    const setActiveSynthCount: typeof _setActiveSynthCount = useCallback((action) => {
        _setActiveSynthCount((prev) => {
            const next = typeof action === "function" ? action(prev) : action;
            activeSynthCountRef.current = next;
            return next;
        });
    }, []);
    const taskControllersRef = useRef(new Map<string, AbortController>());
    const handledToolEffectsRef = useRef(new Set<string>());
    const localTimerIdsRef = useRef<number[]>([]);
    /** Stores interval IDs for progressive block reveal (cleanup on unmount/cancel) */
    const revealIntervalsRef = useRef(new Map<string, number>());
    /** Guard: prevents double-invocation of handleQuery for the same query */
    const queryInFlightRef = useRef<string | null>(null);
    /** Guard: set of nodeIds that already received card_generated */
    const cardGeneratedForRef = useRef(new Set<string>());
    const getTaskByIdRef = useRef(getTaskById);
    getTaskByIdRef.current = getTaskById;

    useEffect(() => {
        const controllers = taskControllersRef.current;
        const timerIds = localTimerIdsRef.current;
        const revealIntervals = revealIntervalsRef.current;
        return () => {
            const activeControllers = Array.from(controllers.values());
            for (const controller of activeControllers) {
                controller.abort();
            }
            controllers.clear();
            for (const timerId of timerIds) {
                window.clearTimeout(timerId);
            }
            timerIds.length = 0;
            // Clean up any running progressive reveal intervals
            for (const [, intervalId] of revealIntervals) {
                window.clearInterval(intervalId);
            }
            revealIntervals.clear();
        };
    }, []);

    useEffect(() => {
        const msg = (error?.details || error?.message || "").trim();
        if (!msg) return;
        if (isMissingOpenAIKeyError(msg)) {
            setMissingApiKeyProvider("openai");
        }
    }, [error]);

    // NOTE: agent-status-update events are now handled inside agentRunner.ts which bridges
    // Tauri IPC events into the AsyncGenerator<AgentSSEEvent> stream. No duplicate listener needed here.

    // --- Streaming synthesis via SSE API route ---
    const handleStreamingSynthesis = useCallback(
        async (
            value: string,
            thinkingId: string,
            size: { w: number; h: number },
            addStep: (step: string) => void,
        ) => {
            addStep("Streaming mode enabled");

            const conversationCtx = getSpaceHistory(activeSpaceId)
                .slice(-(settings.maxConversationHistory * 2))
                .map((m) => ({ role: m.role, content: m.content }));

            // Create AbortController for cancellation
            const streamController = new AbortController();
            taskControllersRef.current.set(thinkingId, streamController);

            let intent = "general";
            let sources: string[] = [];
            let serverLogs: string[] = [];
            let finalObject: Record<string, unknown> | null = null;

            // Track milestones for ThinkingCard
            const seenMilestones = new Set<string>();
            const checkMilestone = (partial: Record<string, unknown>) => {
                if (partial.title && !seenMilestones.has("title")) {
                    seenMilestones.add("title");
                    addStep(`Title: "${(partial.title as string).slice(0, 60)}"`);
                }
                if (partial.summary && !seenMilestones.has("summary")) {
                    seenMilestones.add("summary");
                    addStep("Generating summary...");
                }
                if (partial.design && !seenMilestones.has("design")) {
                    seenMilestones.add("design");
                    const accent = (partial.design as Record<string, unknown>).accent_color;
                    addStep(`Design: ${accent || "applying styles..."}`);
                }
                if (Array.isArray(partial.blocks) && partial.blocks.length > 0 && !seenMilestones.has("blocks")) {
                    seenMilestones.add("blocks");
                    addStep("Building content blocks...");
                }
                if (Array.isArray(partial.blocks) && partial.blocks.length > 2 && !seenMilestones.has("blocks_many")) {
                    seenMilestones.add("blocks_many");
                    addStep(`${partial.blocks.length} blocks generated`);
                }
            };

            // Stream synthesis client-side — no HTTP round-trip
            for await (const event of streamSynthesisClient(
                value,
                {
                    aiProvider: settings.aiProvider,
                    aiModel: settings.aiModel,
                    ollamaEndpoint: settings.ollamaEndpoint,
                    temperature: settings.temperature,
                    maxTokens: settings.maxTokens,
                    scrapeEnabled: settings.scrapeEnabled,
                    timeout: settings.timeout,
                    userAgent: settings.userAgent,
                    openaiApiKey: settings.openaiApiKey,
                    anthropicApiKey: settings.anthropicApiKey,
                    groqApiKey: settings.groqApiKey,
                    geminiApiKey: settings.geminiApiKey,
                },
                conversationCtx,
                streamController.signal,
            )) {
                if (streamController.signal.aborted) break;

                switch (event.type) {
                    case "progress": {
                        if (event.step) addStep(event.step);
                        break;
                    }

                    case "metadata": {
                        intent = event.intent || "general";
                        sources = event.sources || [];
                        serverLogs = event.logs || [];
                        break;
                    }

                    case "partial": {
                        const partial = event.object;
                        const isFinal = event.final === true;

                        if (partial) {
                            if (isFinal) {
                                finalObject = partial;
                                addStep("Synthesis complete");
                            } else {
                                checkMilestone(partial);
                            }

                            setNodes((prev) =>
                                prev.map((n) =>
                                    n.id === thinkingId
                                        ? {
                                            ...n,
                                            thinkingPhase: isFinal ? "ready" : "replying",
                                            title: (partial.title as string) || n.title,
                                            content: {
                                                ...n.content,
                                                title: (partial.title as string) || n.content.title,
                                                summary: (partial.summary as string) || n.content.summary,
                                                design: partial.design
                                                    ? {
                                                        accent_color:
                                                            ((partial.design as Record<string, unknown>).accent_color as string) ||
                                                            n.content.design.accent_color,
                                                        vibe:
                                                            ((partial.design as Record<string, unknown>).vibe as string) ||
                                                            n.content.design.vibe,
                                                        text_style:
                                                            (((partial.design as Record<string, unknown>).text_style as string) as
                                                                | "sans" | "mono" | "serif") ||
                                                            n.content.design.text_style,
                                                        glass_opacity:
                                                            ((partial.design as Record<string, unknown>).glass_opacity as number) ??
                                                            n.content.design.glass_opacity,
                                                    }
                                                    : n.content.design,
                                                blocks: Array.isArray(partial.blocks)
                                                    ? (partial.blocks as typeof n.content.blocks)
                                                    : n.content.blocks,
                                            },
                                            updatedAt: Date.now(),
                                        }
                                        : n,
                                ),
                            );
                        }
                        break;
                    }

                    case "error": {
                        throw new Error(event.error || "Stream synthesis failed");
                    }

                    case "done": {
                        break;
                    }
                }
            }

            // Use the final object
            if (!finalObject || !finalObject.title) {
                throw new Error("Stream completed but no valid object was produced");
            }

            // Finalize the node — transition from synthesizing to active
            setNodes((prev) =>
                prev.map((n) =>
                    n.id === thinkingId
                        ? {
                            ...n,
                            type:
                                (finalObject!.type as string as SynthesisNode["type"]) ||
                                "agent_task",
                            title: (finalObject!.title as string) || value,
                            dimension: {
                                w: (finalObject!.suggested_width as number) || size.w,
                                h: (finalObject!.suggested_height as number) || size.h,
                            },
                            status: "active" as const,
                            isGodMode: false,
                            thinkingPhase: "ready",
                            updatedAt: Date.now(),
                            content: {
                                title: (finalObject!.title as string) || value,
                                summary: (finalObject!.summary as string) || "",
                                design: finalObject!.design
                                    ? {
                                        accent_color:
                                            ((finalObject!.design as Record<string, unknown>)
                                                .accent_color as string) || "#7BD4FF",
                                        vibe:
                                            ((finalObject!.design as Record<string, unknown>)
                                                .vibe as string) || "cosmic",
                                        text_style:
                                            (((finalObject!.design as Record<string, unknown>)
                                                .text_style as string) as
                                                | "sans"
                                                | "mono"
                                                | "serif") || "sans",
                                        glass_opacity:
                                            ((finalObject!.design as Record<string, unknown>)
                                                .glass_opacity as number) ?? 0.4,
                                    }
                                    : n.content.design,
                                blocks: Array.isArray(finalObject!.blocks)
                                    ? (finalObject!.blocks as typeof n.content.blocks)
                                    : [],
                                sources,
                                logs: serverLogs,
                            },
                        }
                        : n,
                ),
            );

            return {
                title: (finalObject.title as string) || value,
                intent,
            };
        },
        [activeSpaceId, getSpaceHistory, settings, setNodes],
    );

    // --- Main search handler ---
    const handleSearch = useCallback(
        async (value: string) => {
            if (activeSynthCountRef.current >= settings.concurrentSynthesis) {
                setError({
                    message: `Maximum concurrent syntheses (${settings.concurrentSynthesis}) reached. Wait for current operations to finish.`,
                });
                return;
            }

            setError(null);
            setActiveSynthCount((prev) => prev + 1);

            if (settings.synthSound !== "none" && settings.soundEffects) {
                startAmbientSound(settings.synthSound as "hum" | "pulse", settings.volume);
            }

            const visibleCount = nodes.filter(
                (n) => n.spaceId === activeSpaceId && n.status !== "minimized",
            ).length;

            if (visibleCount >= settings.maxNodes) {
                setError({
                    message: `Maximum of ${settings.maxNodes} nodes reached in this space. Close some before synthesizing more.`,
                });
                setActiveSynthCount((prev) => Math.max(0, prev - 1));
                stopAmbientSound();
                return;
            }

            const size = CARD_SIZES[settings.cardSize] || CARD_SIZES.medium;
            const spaceNodes = nodes.filter((n) => n.spaceId === activeSpaceId);
            const viewport = typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : undefined;
            const spawnPos = findNextOpenPosition(spaceNodes, size, 3, 140, 70, 40, viewport);

            const thinkingId = uuidv4();
            const thinkingNode: SynthesisNode = {
                id: thinkingId,
                query: value,
                type: "note",
                title: value,
                spaceId: activeSpaceId,
                position: { x: spawnPos.x, y: spawnPos.y, z: 0 },
                dimension: { w: size.w, h: Math.min(size.h, 300) },
                status: "synthesizing",
                zIndex: Math.max(0, ...nodes.map((n) => n.zIndex)) + 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isGodMode: false,
                content: {
                    title: value,
                    summary: "",
                    design: {
                        accent_color: "#A78BFA",
                        vibe: "cosmic",
                        text_style: "sans",
                        glass_opacity: 0.4,
                    },
                    blocks: [],
                    logs: ["Starting synthesis..."],
                },
                thinkingPhase: "listening",
            };

            setNodes((prev) => [...prev, thinkingNode]);
            setActiveNodeId(thinkingId);
            setIsLoading(true);

            const addStep = (step: string) => {
                setNodes((prev) =>
                    prev.map((n) =>
                        n.id === thinkingId && n.status === "synthesizing"
                            ? {
                                ...n,
                                content: {
                                    ...n.content,
                                    logs: [...(n.content.logs || []), step],
                                },
                                thinkingPhase: "thinking",
                                updatedAt: Date.now(),
                            }
                            : n,
                    ),
                );
            };

            addStep(`Model: ${settings.aiModel}`);

            try {
                if (settings.streamResponses) {
                    // --- Streaming path ---
                    const streamResult = await handleStreamingSynthesis(
                        value,
                        thinkingId,
                        size,
                        addStep,
                    );
                    debugLog("Stream synthesis complete:", streamResult.title);

                    addConversationMessage(activeSpaceId, { role: "user", content: value, timestamp: Date.now(), nodeId: thinkingId });
                    addConversationMessage(activeSpaceId, { role: "assistant", content: streamResult.title, timestamp: Date.now(), nodeId: thinkingId });

                    // Toast disabled for synthesis results — only system notifications use toast
                    if (settings.synthComplete && settings.notifs) {
                        sendBrowserNotification("Synthesis Complete", streamResult.title);
                    }
                } else {
                    // --- Non-streaming path (server action) ---
                    const conversationCtx = getSpaceHistory(activeSpaceId)
                        .slice(-(settings.maxConversationHistory * 2))
                        .map((m) => ({ role: m.role, content: m.content }));

                    const result = await synthesizeClient(value, {
                        aiProvider: settings.aiProvider,
                        aiModel: settings.aiModel,
                        ollamaEndpoint: settings.ollamaEndpoint,
                        temperature: settings.temperature,
                        maxTokens: settings.maxTokens,
                        scrapeEnabled: settings.scrapeEnabled,
                        timeout: settings.timeout,
                        userAgent: settings.userAgent,
                        openaiApiKey: settings.openaiApiKey,
                        anthropicApiKey: settings.anthropicApiKey,
                        groqApiKey: settings.groqApiKey,
                        geminiApiKey: settings.geminiApiKey,
                    }, conversationCtx);

                    if (!result.success || !result.data) {
                        setNodes((prev) => prev.filter((n) => n.id !== thinkingId));
                        setError({
                            message: result.error || "Synthesis failed.",
                            details: result.error ? result.details : undefined,
                            query: value,
                        });
                        return;
                    }

                    const rData = result.data as Record<string, unknown>;
                    const rTitle = String(rData?.title ?? value);
                    const rSummary = String(rData?.summary ?? "");
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.id === thinkingId
                                ? {
                                    ...n,
                                    type: (rData.type || "agent_task") as SynthesisNode["type"],
                                    title: rTitle,
                                    dimension: {
                                        w: (rData.suggested_width as number) || size.w,
                                        h: (rData.suggested_height as number) || size.h,
                                    },
                                    status: "active" as const,
                                    isGodMode: false,
                                    updatedAt: Date.now(),
                                    content: {
                                        title: rTitle,
                                        summary: rSummary,
                                        design: (rData.design ?? n.content.design) as SynthesisNode["content"]["design"],
                                        blocks: (rData.blocks ?? n.content.blocks) as SynthesisNode["content"]["blocks"],
                                        sources: (rData.sources as string[] | undefined) ?? n.content.sources,
                                        logs: (rData.logs as string[] | undefined) ?? n.content.logs,
                                    },
                                    thinkingPhase: "ready",
                                }
                                : n,
                        ),
                    );
                    debugLog("Synthesis complete:", rTitle);

                    addConversationMessage(activeSpaceId, { role: "user", content: value, timestamp: Date.now(), nodeId: thinkingId });
                    addConversationMessage(activeSpaceId, { role: "assistant", content: rSummary || rTitle, timestamp: Date.now(), nodeId: thinkingId });

                    // Toast disabled for synthesis results — only system notifications use toast
                    if (settings.synthComplete && settings.notifs) {
                        sendBrowserNotification("Synthesis Complete", rTitle || "Synthesis Complete");
                    }

                    // Auto-refine
                    if (settings.autoRefine && result.data) {
                        setTimeout(async () => {
                            addStep("Auto-refining...");
                            try {
                                const refineResult = await synthesizeClient(value, {
                                    aiProvider: settings.aiProvider,
                                    aiModel: settings.aiModel,
                                    ollamaEndpoint: settings.ollamaEndpoint,
                                    temperature: Math.max(0, settings.temperature - 10),
                                    maxTokens: settings.maxTokens,
                                    scrapeEnabled: false,
                                    openaiApiKey: settings.openaiApiKey,
                                    anthropicApiKey: settings.anthropicApiKey,
                                    groqApiKey: settings.groqApiKey,
                                    geminiApiKey: settings.geminiApiKey,
                                });
                                if (refineResult.success && refineResult.data) {
                                    const rfData = refineResult.data as Record<string, unknown>;
                                    setNodes((prev) =>
                                        prev.map((n) =>
                                            n.id === thinkingId
                                                ? {
                                                    ...n,
                                                    content: {
                                                        ...n.content,
                                                        title: String(rfData?.title ?? n.content.title),
                                                        summary: String(rfData?.summary ?? n.content.summary),
                                                        blocks: (rfData?.blocks ?? n.content.blocks) as typeof n.content.blocks,
                                                        logs: [
                                                            ...(n.content.logs || []),
                                                            "Auto-refined",
                                                        ],
                                                    },
                                                    updatedAt: Date.now(),
                                                }
                                                : n,
                                        ),
                                    );
                                    debugLog("Auto-refined:", rfData.title);
                                }
                            } catch (refineError) {
                                debugLog(
                                    "Auto-refine failed:",
                                    refineError instanceof Error
                                        ? refineError.message
                                        : String(refineError),
                                );
                            }
                        }, 2000);
                    }
                }
            } catch (requestError) {
                console.error("Synthesis Error:", requestError);
                setNodes((prev) => prev.filter((n) => n.id !== thinkingId));
                setError({
                    message:
                        requestError instanceof Error
                            ? requestError.message
                            : "Could not reach the synthesis backend.",
                    details:
                        requestError instanceof Error
                            ? requestError.message
                            : String(requestError),
                    query: value,
                });
            } finally {
                setActiveSynthCount((prev) => {
                    const newCount = Math.max(0, prev - 1);
                    if (newCount === 0) {
                        setIsLoading(false);
                        stopAmbientSound();
                    }
                    return newCount;
                });
            }
        },
        [
            activeSpaceId,
            nodes,
            settings,
            debugLog,
            addConversationMessage,
            getSpaceHistory,
            setNodes,
            setActiveNodeId,
            setActiveSynthCount,
            handleStreamingSynthesis,
        ],
    );

    // Request notification permission on mount
    useEffect(() => {
        if (settings.notifs && typeof Notification !== "undefined" && Notification.permission === "default") {
            void Notification.requestPermission();
        }
    }, [settings.notifs]);

    // Play notification sound on error
    useEffect(() => {
        if (error && settings.notifSound && settings.notifs) {
            playSound("error", settings.volume);
        }
    }, [error, settings.notifSound, settings.notifs, settings.volume]);

    const applyToolResultEffects = useCallback(
        (step: AgentStep, nodeId: string) => {
            if (
                step.type !== "tool_call" ||
                !step.toolResult?.success ||
                handledToolEffectsRef.current.has(step.id)
            ) {
                return;
            }

            const result = step.toolResult as ToolExecResult;
            const payload = (result.data || {}) as Record<string, unknown>;
            const payloadType = payload.type;
            if (typeof payloadType !== "string") return;

            handledToolEffectsRef.current.add(step.id);

            if (payloadType === "create_note") {
                const title =
                    typeof payload.title === "string" && payload.title.trim().length > 0
                        ? payload.title.trim()
                        : "New Note";
                const content =
                    typeof payload.content === "string" ? payload.content.trim() : "";
                if (!content) return;
                const ownerNode = nodes.find((n) => n.id === nodeId);
                addNode({
                    query: `Agent note: ${title}`,
                    type: "note",
                    title,
                    spaceId: ownerNode?.spaceId || activeSpaceId,
                    content: {
                        title,
                        summary: content.slice(0, 180) + (content.length > 180 ? "..." : ""),
                        design: {
                            accent_color: "#34d399",
                            vibe: "focused",
                            text_style: "sans",
                            glass_opacity: 0.4,
                        },
                        blocks: [{ type: "text_block", style: "body", content }],
                        logs: ['Created by tool "create_note"'],
                    },
                });
                return;
            }

            if (payloadType === "set_timer") {
                const label =
                    typeof payload.label === "string" && payload.label.trim().length > 0
                        ? payload.label.trim()
                        : "Reminder";
                const seconds =
                    typeof payload.seconds === "number" ? Math.max(1, Math.floor(payload.seconds)) : 0;
                if (!seconds) return;
                const timeoutId = window.setTimeout(() => {
                    const msg = `Reminder: ${label}`;
                    if (settings.notifSound && settings.notifs) {
                        playSound("success", settings.volume);
                    }
                    sendBrowserNotification("Synthesis Timer", label);
                    setSuccessMsg(msg);
                    setTimeout(() => setSuccessMsg(null), 5000);
                }, seconds * 1000);
                localTimerIdsRef.current.push(timeoutId);
            }
        },
        [activeSpaceId, addNode, nodes, settings.notifSound, settings.notifs, settings.volume],
    );

    // --- Handle individual agent SSE events ---
    const handleAgentEvent = useCallback(
        (event: AgentClientEvent, nodeId: string, taskId: string, query: string) => {
            switch (event.type) {
                case "task_started":
                    recordTaskStarted();
                    updateTaskStatus(taskId, "running");
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.id === nodeId
                                ? {
                                    ...n,
                                    taskStatus: "running" as const,
                                    content: n.content,
                                    updatedAt: Date.now(),
                                }
                                : n,
                        ),
                    );
                    break;

                case "step_started": {
                    updateTaskStep(taskId, event.step);
                    // Generate intermediate block for visual feedback
                    const startBlock = event.step.type === "tool_call" && event.step.toolName
                        ? buildIntermediateBlock(event.step)
                        : null;
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;
                            const newBlocks = startBlock
                                ? [...(n.content.blocks || []), startBlock]
                                : (n.content.blocks || []);
                            const isNewToolCall = event.step.type === "tool_call";
                            const existingTimeline = n.content.reasoningTimeline ?? [];
                            const toolLabel = event.step.toolName
                                ? getToolMeta(event.step.toolName).label
                                : "Step";
                            // When starting a tool call, push completed reasoning to timeline before clearing
                            let timeline = existingTimeline;
                            if (isNewToolCall && n.content.streamingReasoning?.trim()) {
                                const entry = {
                                    id: `reason-${Date.now()}-${existingTimeline.length}`,
                                    label: `Before ${toolLabel}`,
                                    text: n.content.streamingReasoning.trim(),
                                };
                                timeline = [...existingTimeline, entry];
                            }
                            return {
                                ...n,
                                content: {
                                    ...n.content,
                                    blocks: newBlocks,
                                    reasoningTimeline: timeline,
                                    streamingReasoning: isNewToolCall ? "" : n.content.streamingReasoning,
                                    streamingContent: isNewToolCall ? "" : n.content.streamingContent,
                                    logs: event.step.toolName
                                        ? [...(n.content.logs || []), `Calling ${event.step.toolName}...`]
                                        : (n.content.logs || []),
                                },
                                updatedAt: Date.now(),
                            };
                        }),
                    );
                    break;
                }
                case "step_progress":
                    updateTaskStep(taskId, {
                        id: event.stepId,
                        taskId: event.taskId,
                        reasoning: event.reasoning,
                        toolInput: event.toolInput,
                    } as AgentStep);
                    // Also update the node's logs so the thinking banner picks this up
                    if (event.reasoning) {
                        setNodes((prev) =>
                            prev.map((n) => {
                                if (n.id === nodeId && n.status === "synthesizing") {
                                    const newLogs = [...(n.content.logs || [])];
                                    if (newLogs.length > 0) {
                                        const last = newLogs[newLogs.length - 1];
                                        // If the last log is a system msg or tool call, start a new reasoning log.
                                        // Otherwise, we assume it's the ongoing reasoning stream and replace it.
                                        if (last.startsWith("Calling ") || last.startsWith("Model: ") || last === "Starting synthesis...") {
                                            newLogs.push(event.reasoning!);
                                        } else {
                                            newLogs[newLogs.length - 1] = event.reasoning!;
                                        }
                                    } else {
                                        newLogs.push(event.reasoning!);
                                    }
                                    return {
                                        ...n,
                                        content: {
                                            ...n.content,
                                            logs: newLogs,
                                        },
                                        updatedAt: Date.now(),
                                    };
                                }
                                return n;
                            })
                        );
                    }
                    break;

                case "step_completed": {
                    if (event.step.type === "tool_call" && event.step.toolName) {
                        const success = event.step.toolResult?.success ?? false;
                        recordToolCall(event.step.toolName, success);
                    }
                    updateTaskStep(taskId, event.step);
                    applyToolResultEffects(event.step, nodeId);
                    if (event.step.type === "approval_request") {
                        updateTaskStatus(taskId, "running");
                        setNodes((prev) =>
                            prev.map((n) =>
                                n.id === nodeId
                                    ? { ...n, taskStatus: "running" as const, updatedAt: Date.now() }
                                    : n,
                            ),
                        );
                    }
                    // Replace the "running" intermediate block with "completed" version
                    const completedBlock = event.step.type === "tool_call" && event.step.toolName
                        ? buildIntermediateBlock(event.step)
                        : null;
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;
                            const blocks = [...(n.content.blocks || [])];
                            if (completedBlock) {
                                // Find the running block for this step and replace it
                                const existingIdx = blocks.findLastIndex(
                                    (b: any) => b._toolStepId === event.step.id,
                                );
                                if (existingIdx >= 0) {
                                    blocks[existingIdx] = completedBlock;
                                } else {
                                    blocks.push(completedBlock);
                                }
                            }
                            return {
                                ...n,
                                content: {
                                    ...n.content,
                                    blocks,
                                    logs: [
                                        ...(n.content.logs || []),
                                        event.step.toolName
                                            ? `${event.step.toolName} completed`
                                            : event.step.reasoning
                                                ? `Reasoning: ${event.step.reasoning}`
                                                : "Step completed",
                                    ],
                                },
                                updatedAt: Date.now(),
                            };
                        }),
                    );
                    break;
                }

                case "step_failed":
                    updateTaskStep(taskId, event.step);
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.id === nodeId
                                ? {
                                    ...n,
                                    content: {
                                        ...n.content,
                                        logs: [
                                            ...(n.content.logs || []),
                                            `Failed: ${event.error || "unknown error"}`,
                                        ],
                                    },
                                    updatedAt: Date.now(),
                                }
                                : n,
                        ),
                    );
                    break;

                case "approval_required":
                    updateTaskStep(taskId, event.step);
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id === nodeId && n.taskId === taskId) {
                                return {
                                    ...n,
                                    taskStatus: "waiting_approval" as const,
                                    content: {
                                        ...n.content,
                                        logs: [
                                            ...(n.content.logs || []),
                                            `Approval needed: ${event.step.toolName} (${event.step.toolInput?.slice(0, 80)})`,
                                        ],
                                    },
                                    updatedAt: Date.now(),
                                };
                            }
                            return n;
                        })
                    );
                    break;

                case "question_for_user":
                    addConversationMessage(activeSpaceId, {
                        role: "assistant",
                        content: event.question,
                        timestamp: Date.now(),
                        nodeId,
                    });
                    updateTaskStep(taskId, event.step);
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id === nodeId && n.taskId === taskId) {
                                return {
                                    ...n,
                                    taskStatus: "waiting_answer" as const,
                                    content: {
                                        ...n.content,
                                        logs: [
                                            ...(n.content.logs || []),
                                            `Agent asks: ${event.question}`,
                                        ],
                                    },
                                    updatedAt: Date.now(),
                                };
                            }
                            return n;
                        })
                    );
                    break;

                case "final_answer":
                    updateTaskStep(taskId, event.step);
                    break;

                case "task_completed": {
                    recordTaskCompleted(event.totalSteps, event.durationMs);
                    handledToolEffectsRef.current.clear();

                    updateTaskStatus(taskId, "completed");
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;
                            const existingTimeline = n.content.reasoningTimeline ?? [];
                            let timeline = existingTimeline;
                            if (n.content.streamingReasoning?.trim()) {
                                timeline = [
                                    ...existingTimeline,
                                    { id: `reason-final-${Date.now()}`, label: "Final thought", text: n.content.streamingReasoning.trim() },
                                ];
                            }
                            const newContent = { ...n.content, reasoningTimeline: timeline, streamingReasoning: "", streamingContent: "" };
                            return {
                                ...n,
                                taskStatus: "completed" as const,
                                status: n.status === "synthesizing" ? ("active" as const) : n.status,
                                updatedAt: Date.now(),
                                content: newContent,
                            };
                        }),
                    );
                    break;
                }

                case "task_failed":
                    recordTaskFailed();
                    updateTaskStatus(taskId, "failed");
                    handledToolEffectsRef.current.clear();
                    if (isMissingOpenAIKeyError(event.error || "")) {
                        setError({
                            message: "OpenAI API Key is missing. Configure it in Settings > AI Engine.",
                            details: event.error,
                            query,
                        });
                    }
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.id === nodeId
                                ? {
                                    ...n,
                                    taskStatus: "failed" as const,
                                    status: "active" as const,
                                    content: {
                                        ...n.content,
                                        summary: `Task failed: ${event.error || "unknown"}`,
                                        logs: [...(n.content.logs || []), `FAILED: ${event.error}`],
                                        streamingReasoning: "",
                                        streamingContent: "",
                                    },
                                    updatedAt: Date.now(),
                                }
                                : n,
                        ),
                    );
                    break;

                case "task_cancelled":
                    updateTaskStatus(taskId, "cancelled");
                    handledToolEffectsRef.current.clear();
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.id === nodeId
                                ? {
                                    ...n,
                                    taskStatus: "cancelled" as const,
                                    content: { ...n.content, streamingReasoning: "", streamingContent: "" },
                                    updatedAt: Date.now(),
                                }
                                : n,
                        ),
                    );
                    break;

                case "ephemeral_response": {
                    // Ephemeral: show toast, remove the agent_task node, don't create a card
                    const epText = event.text ?? "";
                    const epQuery = event.query ?? query;
                    const epId = `eph-${Date.now()}`;
                    setEphemeralToasts((prev) => [...prev, { id: epId, text: epText, query: epQuery }]);
                    // Remove the agent_task node — no card needed
                    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
                    // Add to conversation history
                    addConversationMessage(activeSpaceId, { role: "user", content: epQuery, timestamp: Date.now(), nodeId });
                    addConversationMessage(activeSpaceId, { role: "assistant", content: epText, timestamp: Date.now(), nodeId });
                    break;
                }

                case "conversation_message": {
                    // Conversational: signal page to auto-open ChatPanel + append message
                    const convText = event.text ?? "";
                    const convQuery = event.query ?? query;
                    setPendingChatMessage({ text: convText, query: convQuery });
                    break;
                }

                case "card_generated": {
                    // Guard: only process card_generated ONCE per node
                    if (cardGeneratedForRef.current.has(nodeId)) {
                        console.warn("[useSynthesis] Duplicate card_generated blocked for node:", nodeId.slice(0, 8));
                        break;
                    }
                    cardGeneratedForRef.current.add(nodeId);

                    const card = event.card as {
                        type?: string;
                        title?: string;
                        summary?: string;
                        suggested_width?: number;
                        suggested_height?: number;
                        design?: SynthesisNode["content"]["design"];
                        blocks?: SynthesisNode["content"]["blocks"];
                    };
                    const sources = event.sources || [];

                    // ── Merge card blocks with existing content ──
                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;

                            console.log('[useSynthesis] card_generated for node:', nodeId.slice(0, 8), {
                                a2uiRootId: n.content.a2uiState?.rootId,
                                a2uiSurfaceId: n.content.a2uiState?.surfaceId,
                                a2uiComponentMapKeys: n.content.a2uiState?.surfaceId ? Object.keys(n.content.a2uiState?.componentMap?.[n.content.a2uiState.surfaceId] || {}) : [],
                                existingBlocks: n.content.blocks?.length,
                                cardBlocks: card.blocks?.length,
                            });

                            // Push any remaining streaming reasoning to timeline
                            const existingTimeline = n.content.reasoningTimeline ?? [];
                            let timeline = existingTimeline;
                            if (n.content.streamingReasoning?.trim()) {
                                timeline = [
                                    ...existingTimeline,
                                    { id: `reason-final-${Date.now()}`, label: "Final thought", text: n.content.streamingReasoning.trim() },
                                ];
                            }

                            // Determine final blocks:
                            // - If A2UI content is active, keep existing blocks as-is (A2UIRenderer handles display)
                            // - Continuation (user replied to add/modify): MERGE existing content + new card blocks
                            // - Fresh run: use card blocks (or intermediate + card)
                            const hasA2UI = !!(n.content.a2uiState?.rootId && n.content.a2uiState?.surfaceId);
                            const existingBlocks = n.content.blocks || [];
                            const youBlock = existingBlocks.find((b: any) =>
                                b.type === "text_block" && String(b.content || "").startsWith("**You:**")
                            ) as { content?: string } | undefined;
                            const lastUserMessage = (youBlock?.content || "").replace(/^\*\*You:\*\*\s*/, "").toLowerCase();
                            const wantsRecreate = /\b(recrear|rehacer|desde cero|haz de nuevo|redo|start over)\b/i.test(lastUserMessage);
                            const isContinuation = !!youBlock;
                            let finalBlocks = existingBlocks;
                            if (!hasA2UI && card.blocks && card.blocks.length > 0) {
                                if (isContinuation && !wantsRecreate) {
                                    // ADD intent: keep existing content, append new. Drop You-blocks and intermediate.
                                    const contentBlocks = existingBlocks.filter((b: any) => {
                                        const ext = b as Record<string, unknown>;
                                        if (ext._isIntermediate === true || typeof ext._toolStepId === "string") return false;
                                        if (b.type === "text_block" && String(b.content || "").startsWith("**You:**")) return false;
                                        return true;
                                    });
                                    finalBlocks = [...contentBlocks, ...card.blocks];
                                } else {
                                    const intermediateBlocks = existingBlocks.filter((b) => {
                                        const ext = b as unknown as Record<string, unknown>;
                                        return ext._isIntermediate === true || typeof ext._toolStepId === "string";
                                    });
                                    finalBlocks = [...intermediateBlocks, ...card.blocks];
                                }
                            }

                            return {
                                ...n,
                                // Preserve agent_task type — HybridAgentCard handles A2UI rendering.
                                // Only override type for non-agent nodes (legacy card flow).
                                type: n.type === "agent_task" ? "agent_task" : ((card.type || "agent_task") as SynthesisNode["type"]),
                                title: card.title || query,
                                status: "active" as const,
                                taskStatus: "completed" as const,
                                isGodMode: false,
                                dimension: {
                                    w: card.suggested_width || n.dimension.w,
                                    h: card.suggested_height || n.dimension.h,
                                },
                                updatedAt: Date.now(),
                                content: {
                                    ...n.content,
                                    title: card.title || query,
                                    summary: card.summary || n.content.summary || "",
                                    design: card.design || n.content.design,
                                    blocks: finalBlocks,
                                    sources,
                                    logs: ((event.card as { logs?: string[] })?.logs) ?? n.content.logs,
                                    reasoningTimeline: timeline,
                                    streamingReasoning: "",
                                    streamingContent: "",
                                    // a2uiState is preserved via ...n.content spread
                                },
                            };
                        }),
                    );

                    addConversationMessage(activeSpaceId, {
                        role: "user",
                        content: query,
                        timestamp: Date.now(),
                        nodeId,
                    });
                    addConversationMessage(activeSpaceId, {
                        role: "assistant",
                        content: card.summary || card.title || query,
                        timestamp: Date.now(),
                        nodeId,
                    });
                    if (settings.synthComplete && settings.notifs) {
                        sendBrowserNotification("Agent Task Complete", card.title || query);
                    }

                    if (settings.autoRefine && card) {
                        setTimeout(async () => {
                            setNodes((prev) =>
                                prev.map((n) =>
                                    n.id === nodeId
                                        ? {
                                            ...n,
                                            status: "synthesizing",
                                            content: {
                                                ...n.content,
                                                logs: [...(n.content.logs || []), "Auto-refining output (max tokens)..."],
                                            },
                                        }
                                        : n
                                )
                            );

                            const textToRefine = card.blocks
                                ? JSON.stringify(card.blocks)
                                : card.summary || card.title || query;

                            try {
                                const refineResult = await synthesizeClient(
                                    `Refine, polish, and deeply improve the quality of this response. Fix formatting, structure, and tone. Do not invent new facts. Respond with a highly professional structure:\n\n${textToRefine}`,
                                    {
                                        aiProvider: settings.aiProvider,
                                        aiModel: settings.aiModel,
                                        ollamaEndpoint: settings.ollamaEndpoint,
                                        temperature: Math.max(0, settings.temperature - 10),
                                        maxTokens: settings.maxTokens,
                                        scrapeEnabled: false,
                                        openaiApiKey: settings.openaiApiKey,
                                        anthropicApiKey: settings.anthropicApiKey,
                                        groqApiKey: settings.groqApiKey,
                                        geminiApiKey: settings.geminiApiKey,
                                    }
                                );

                                if (refineResult.success && refineResult.data) {
                                    const rfData = refineResult.data as Record<string, unknown>;
                                    setNodes((prev) =>
                                        prev.map((n) =>
                                            n.id === nodeId
                                                ? {
                                                    ...n,
                                                    status: "active",
                                                    content: {
                                                        ...n.content,
                                                        title: String(rfData?.title ?? n.content.title),
                                                        summary: String(rfData?.summary ?? n.content.summary),
                                                        blocks: (rfData?.blocks ?? n.content.blocks) as typeof n.content.blocks,
                                                        logs: [...(n.content.logs || []), "Auto-refined successfully"],
                                                    },
                                                    updatedAt: Date.now(),
                                                }
                                                : n
                                        )
                                    );
                                } else {
                                    setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, status: "active" } : n));
                                }
                            } catch (e) {
                                setNodes((prev) => prev.map((n) => n.id === nodeId ? { ...n, status: "active" } : n));
                            }
                        }, 2000);
                    }
                    break;
                }

                case "agent_stream": {
                    const streamEvt = event as AgentStreamEvent;
                    if (streamEvt.chunk) {
                        setNodes((prev) =>
                            prev.map((n) => {
                                // Match by node id or by taskId (agent task node for this task)
                                const isTargetNode = n.id === nodeId || (n.type === "agent_task" && n.taskId === taskId);
                                const isActive = n.status === "synthesizing" || n.taskStatus === "running" || n.taskStatus === "planning";
                                if (!isTargetNode || !isActive) return n;

                                const content = n.content;
                                const currentReasoning = content.streamingReasoning || "";
                                const currentStreamingContent = content.streamingContent || "";

                                if (streamEvt.isReasoning) {
                                    return {
                                        ...n,
                                        content: {
                                            ...content,
                                            streamingReasoning: currentReasoning + streamEvt.chunk,
                                        },
                                        updatedAt: Date.now(),
                                    };
                                } else {
                                    return {
                                        ...n,
                                        content: {
                                            ...content,
                                            streamingContent: currentStreamingContent + streamEvt.chunk,
                                        },
                                        updatedAt: Date.now(),
                                    };
                                }
                            }),
                        );
                    }
                    break;
                }

                case "agent_ui_patch": {
                    const patchEvent = event as AgentUiPatchEvent;
                    const patch = patchEvent.patch;

                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;

                            // Merge logic: append new blocks to existing ones
                            const newBlocks = Array.isArray(patch.blocks) ? patch.blocks : [];
                            const existingBlocks = n.content.blocks || [];

                            // Naive append for now. If blocks have IDs we could merge smarter.
                            const mergedBlocks = [...existingBlocks, ...newBlocks];

                            return {
                                ...n,
                                content: {
                                    ...n.content,
                                    summary: patch.summary || n.content.summary,
                                    blocks: mergedBlocks,
                                },
                                updatedAt: Date.now(),
                            };
                        })
                    );
                    break;
                }

                case "agent_a2ui_message": {
                    const a2uiEvent = event as AgentA2UIMessageEvent;
                    const initialState: A2UIState = {
                        componentMap: {},
                        dataModel: {},
                        rootId: null,
                        surfaceId: null,
                        catalogId: null,
                    };

                    setNodes((prev) =>
                        prev.map((n) => {
                            if (n.id !== nodeId) return n;
                            const prevState: A2UIState = n.content.a2uiState
                                ? { ...initialState, ...n.content.a2uiState } as A2UIState
                                : initialState;
                            const nextState = applyA2UIMessage(prevState, a2uiEvent.message);
                            return {
                                ...n,
                                content: {
                                    ...n.content,
                                    a2uiState: nextState,
                                },
                                updatedAt: Date.now(),
                            };
                        })
                    );
                    break;
                }

                case "agent_tool_result": {
                    const trEvent = event as AgentToolResultEvent;
                    const richBlock = buildRichBlockFromToolResult(
                        trEvent.toolName,
                        trEvent.toolInput,
                        trEvent.resultText,
                        trEvent.success,
                    );

                    if (richBlock) {
                        const blockWithStep = { ...richBlock, _stepIndex: trEvent.stepIndex };

                        setNodes((prev) =>
                            prev.map((n) => {
                                if (n.id !== nodeId) return n;

                                const blocks = [...(n.content.blocks || [])];
                                type BlockLike = { _isIntermediate?: boolean; _toolName?: string; _stepIndex?: number; _toolStepId?: string };

                                let targetIdx = blocks.findLastIndex(
                                    (b) => (b as BlockLike)._isIntermediate && (b as BlockLike)._toolName === trEvent.toolName,
                                );

                                if (targetIdx < 0) {
                                    targetIdx = blocks.findLastIndex(
                                        (b) => (b as BlockLike)._isIntermediate && (b as BlockLike)._stepIndex === trEvent.stepIndex,
                                    );
                                }

                                if (targetIdx < 0) {
                                    targetIdx = blocks.findLastIndex(
                                        (b) => (b as BlockLike)._isIntermediate && (b as BlockLike)._toolStepId,
                                    );
                                }

                                const blockAsUi = blockWithStep as import("@/types/synthesis").UIBlock;
                                if (targetIdx >= 0) {
                                    blocks[targetIdx] = blockAsUi;
                                } else {
                                    blocks.push(blockAsUi);
                                }

                                return {
                                    ...n,
                                    content: { ...n.content, blocks },
                                    updatedAt: Date.now(),
                                };
                            }),
                        );
                    }
                    break;
                }
            }
        },
        [
            activeSpaceId,
            addConversationMessage,
            applyToolResultEffects,
            setNodes,
            settings,
            updateTaskStatus,
            updateTaskStep,
            setEphemeralToasts,
            setPendingChatMessage,
        ],
    );

    // NOTE: agent-response events are now handled inside agentRunner.ts which bridges
    // them into card_generated events in the AsyncGenerator stream. No duplicate listener needed here.

    const handleOsQuery = useCallback(
        async (value: string) => {
            setError(null);
            addOsMessage({ role: "user", content: value, timestamp: Date.now() });
            setIsLoading(true);

            if (settings.synthSound !== "none" && settings.soundEffects) {
                startAmbientSound(settings.synthSound as "hum" | "pulse", settings.volume);
            }

            const requestController = new AbortController();
            const resolvedTaskId = uuidv4();
            taskControllersRef.current.set(resolvedTaskId, requestController);

            try {
                const conversationCtx = getOsHistory()
                    .slice(-(settings.maxConversationHistory ?? 10) * 2)
                    .map((m) => `${m.role}: ${m.content}`)
                    .join("\n");

                const nodeSummaries = nodes
                    .filter((n) => n.status === "active" || n.status === "minimized")
                    .map((n) => ({
                        id: n.id,
                        title: n.title,
                        summary: n.content.summary || "",
                        type: n.type,
                        spaceId: n.spaceId,
                        createdAt: n.createdAt,
                    }));
                let sawAssistantMessage = false;

                for await (const event of runAgentClient(
                    {
                        query: value,
                        taskId: resolvedTaskId,
                        conversationHistory: conversationCtx || undefined,
                        nodeSummaries,
                        mode: "os",
                        userContext: formatUserContext(loadUserProfile()),
                        settings: {
                            aiProvider: settings.aiProvider,
                            aiModel: settings.aiModel,
                            ollamaEndpoint: settings.ollamaEndpoint,
                            temperature: settings.temperature,
                            maxTokens: settings.maxTokens,
                            scrapeEnabled: settings.scrapeEnabled,
                            timeout: settings.timeout,
                            userAgent: settings.userAgent,
                            openaiApiKey: settings.openaiApiKey,
                            anthropicApiKey: settings.anthropicApiKey,
                            agentMaxSteps: settings.agentMaxSteps,
                            agentTimeout: settings.agentTimeout,
                            agentApprovalRequired: settings.agentApprovalRequired,
                            agentRecursionLimit: settings.agentRecursionLimit,
                        },
                    },
                    requestController.signal,
                )) {
                    if (requestController.signal.aborted) break;
                    if (event && typeof event === "object" && "type" in event) {
                        const ev = event as AgentClientEvent;
                        if (ev.type === "conversation_message") {
                            const text = (ev as { text?: string }).text ?? "";
                            addOsMessage({ role: "assistant", content: text, timestamp: Date.now() });
                            setPendingChatMessage({ text, query: value });
                            sawAssistantMessage = true;
                        }
                        if (ev.type === "task_failed") {
                            const details = (ev as { error?: string }).error || "No response received from agent.";
                            setError({
                                message: "OS chat failed.",
                                details,
                                query: value,
                            });
                            if (!sawAssistantMessage) {
                                addOsMessage({
                                    role: "assistant",
                                    content: `I couldn't respond this time (${details}).`,
                                    timestamp: Date.now(),
                                });
                                sawAssistantMessage = true;
                            }
                            break;
                        }
                        if (ev.type === "task_completed") {
                            if (!sawAssistantMessage) {
                                const fallback = "Done, but no final text arrived at the chat.";
                                addOsMessage({ role: "assistant", content: fallback, timestamp: Date.now() });
                                setPendingChatMessage({ text: fallback, query: value });
                                sawAssistantMessage = true;
                            }
                            break;
                        }
                        if (ev.type === "task_cancelled") {
                            break;
                        }
                    }
                }
            } catch (err) {
                if (!requestController.signal.aborted) {
                    console.error("OS query error:", err);
                    setError({
                        message: err instanceof Error ? err.message : "OS chat failed.",
                        details: err instanceof Error ? err.message : String(err),
                        query: value,
                    });
                }
            } finally {
                taskControllersRef.current.delete(resolvedTaskId);
                setIsLoading(false);
                stopAmbientSound();
            }
        },
        [
            addOsMessage,
            getOsHistory,
            nodes,
            settings,
            setError,
            setPendingChatMessage,
        ],
    );

    const handleQuery = useCallback(
        async (value: string, targetNodeId?: string) => {
            // Guard: prevent double-invocation for the same query within the same tick
            if (queryInFlightRef.current === value) {
                console.warn("[useSynthesis] Duplicate handleQuery call blocked:", value.slice(0, 40));
                return;
            }

            if (!targetNodeId && activeSynthCountRef.current >= settings.concurrentSynthesis) {
                setError({
                    message: `Maximum concurrent syntheses (${settings.concurrentSynthesis}) reached.`,
                });
                return;
            }

            queryInFlightRef.current = value;
            setError(null);
            if (!targetNodeId) setActiveSynthCount((prev) => prev + 1);

            if (settings.synthSound !== "none" && settings.soundEffects) {
                startAmbientSound(settings.synthSound as "hum" | "pulse", settings.volume);
            }

            const size = CARD_SIZES[settings.cardSize] || CARD_SIZES.medium;
            const isContinuation = !!targetNodeId;
            const agentNodeId = targetNodeId || uuidv4();
            const requestController = new AbortController();
            let taskId: string | null = null;

            if (!isContinuation) {
                const spaceNodes = nodes.filter((n) => n.spaceId === activeSpaceId);
                const viewport = typeof window !== "undefined" ? { w: window.innerWidth, h: window.innerHeight } : undefined;
                const spawnPos = findNextOpenPosition(spaceNodes, size, 3, 140, 70, 40, viewport);

                const agentNode: SynthesisNode = {
                    id: agentNodeId,
                    query: value,
                    type: "agent_task",
                    title: value,
                    spaceId: activeSpaceId,
                    position: { x: spawnPos.x, y: spawnPos.y, z: 0 },
                    dimension: { w: Math.floor(size.w * 1.4), h: Math.max(size.h, 460) },
                    status: "synthesizing",
                    zIndex: Math.max(0, ...nodes.map((n) => n.zIndex)) + 1,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    isGodMode: false,
                    taskStatus: "planning",
                    content: {
                        title: value,
                        summary: "Agent is working...",
                        design: {
                            accent_color: "#A78BFA",
                            vibe: "cosmic",
                            text_style: "sans",
                            glass_opacity: 0.4,
                        },
                        blocks: [],
                        logs: [],
                    },
                };
                setNodes((prev) => [...prev, agentNode]);
            } else {
                setNodes((prev) => prev.map(n => n.id === agentNodeId ? {
                    ...n,
                    status: "synthesizing",
                    taskStatus: "planning",
                    content: {
                        ...n.content,
                        blocks: [...(n.content.blocks || []), { type: "text_block", style: "body", content: `**You:** ${value}` }],
                        logs: [...(n.content.logs || []), "Resuming task..."]
                    },
                    updatedAt: Date.now()
                } : n));
            }

            setActiveNodeId(agentNodeId);
            setIsLoading(true);

            try {
                let conversationCtx = "";
                if (isContinuation) {
                    const targetNode = nodes.find(n => n.id === targetNodeId);
                    if (targetNode) {
                        const nodeHistory = getHistoryForNode(activeSpaceId, targetNodeId)
                            .slice(-(settings.maxConversationHistory * 2))
                            .map((m) => `${m.role}: ${m.content}`)
                            .join("\n");
                        const cardContext = buildContinuationContext(targetNode);
                        conversationCtx = nodeHistory ? `${nodeHistory}\n\n${cardContext}` : cardContext;
                    }
                } else {
                    conversationCtx = getSpaceHistory(activeSpaceId)
                        .slice(-(settings.maxConversationHistory * 2))
                        .map((m) => `${m.role}: ${m.content}`)
                        .join("\n");
                }

                // Send node summaries so the agent can introspect the workspace
                const nodeSummaries = nodes
                    .filter((n) => n.status === "active" || n.status === "minimized")
                    .map((n) => ({
                        id: n.id,
                        title: n.title,
                        summary: n.content.summary || "",
                        type: n.type,
                        spaceId: n.spaceId,
                        createdAt: n.createdAt,
                    }));

                // Run the agent client-side — no HTTP round-trip
                const resolvedTaskId = uuidv4();
                taskId = resolvedTaskId;
                taskControllersRef.current.set(resolvedTaskId, requestController);
                upsertTask({
                    id: resolvedTaskId,
                    nodeId: agentNodeId,
                    query: value,
                    spaceId: activeSpaceId,
                    status: "running",
                    steps: [],
                    config: {
                        maxSteps: settings.agentMaxSteps || 10,
                        timeoutMs: (settings.agentTimeout || 120) * 1000,
                        requireApproval: settings.agentApprovalRequired || false,
                    },
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });

                setNodes((prev) =>
                    prev.map((n) =>
                        n.id === agentNodeId
                            ? {
                                ...n,
                                taskId: resolvedTaskId,
                                taskStatus: "running" as const,
                                updatedAt: Date.now(),
                            }
                            : n,
                    ),
                );

                // Iterate the async generator directly
                for await (const event of runAgentClient(
                    {
                        query: value,
                        taskId: resolvedTaskId,
                        conversationHistory: conversationCtx || undefined,
                        nodeSummaries,
                        userContext: formatUserContext(loadUserProfile()),
                        settings: {
                            aiProvider: settings.aiProvider,
                            aiModel: settings.aiModel,
                            ollamaEndpoint: settings.ollamaEndpoint,
                            temperature: settings.temperature,
                            maxTokens: settings.maxTokens,
                            scrapeEnabled: settings.scrapeEnabled,
                            timeout: settings.timeout,
                            userAgent: settings.userAgent,
                            openaiApiKey: settings.openaiApiKey,
                            anthropicApiKey: settings.anthropicApiKey,
                            agentMaxSteps: settings.agentMaxSteps,
                            agentTimeout: settings.agentTimeout,
                            agentApprovalRequired: settings.agentApprovalRequired,
                            agentRecursionLimit: settings.agentRecursionLimit,
                        },
                    },
                    requestController.signal,
                )) {
                    if (requestController.signal.aborted) break;
                    if (event && typeof event === "object" && "type" in event && typeof (event as { type: string }).type === "string") {
                        handleAgentEvent(
                            event as AgentClientEvent,
                            agentNodeId,
                            resolvedTaskId,
                            value,
                        );
                    }
                }
            } catch (err) {
                if (requestController.signal.aborted) {
                    return;
                }
                console.error("Agent search error:", err);
                setNodes((prev) => prev.filter((n) => n.id !== agentNodeId));
                setError({
                    message: err instanceof Error ? err.message : "Agent task failed.",
                    details: err instanceof Error ? err.message : String(err),
                    query: value,
                });
            } finally {
                queryInFlightRef.current = null;
                if (taskId) {
                    taskControllersRef.current.delete(taskId);
                }
                if (!targetNodeId) {
                    setActiveSynthCount((prev) => {
                        const newCount = Math.max(0, prev - 1);
                        if (newCount === 0) {
                            setIsLoading(false);
                            stopAmbientSound();
                        }
                        return newCount;
                    });
                } else {
                    setIsLoading(false);
                    stopAmbientSound();
                }
            }
        },
        [
            activeSpaceId,
            debugLog,
            getSpaceHistory,
            getHistoryForNode,
            handleAgentEvent,
            nodes,
            setNodes,
            setActiveNodeId,
            setActiveSynthCount,
            settings,
            upsertTask,
        ],
    );

    const handleApproveStep = useCallback(
        async (taskId: string, stepId: string) => {
            try {
                // HITL approval: if this is a kernel-gated approval, resolve via Tauri IPC
                if (stepId.startsWith("approval-")) {
                    const approvalKey = stepId.replace("approval-", "");
                    await kernelInvoke("respond_tool_approval", {
                        approvalKey,
                        approved: true,
                    });
                } else {
                    const resolved = resolvePendingApproval(taskId, stepId, true);
                    if (!resolved.ok) {
                        throw new Error("No pending approval found for this task");
                    }
                }
                updateTaskStatus(taskId, "running");
                setNodes((prev) =>
                    prev.map((n) =>
                        n.taskId === taskId
                            ? {
                                ...n,
                                taskStatus: "running" as const,
                                content: {
                                    ...n.content,
                                    logs: [...(n.content.logs || []), `Approved step ${stepId.slice(0, 8)}`],
                                },
                                updatedAt: Date.now(),
                            }
                            : n,
                    ),
                );
            } catch (err) {
                setError({
                    message: err instanceof Error ? err.message : "Failed to approve action",
                });
            }
        },
        [setNodes, updateTaskStatus, setError],
    );

    const handleRejectStep = useCallback(
        async (taskId: string, stepId: string) => {
            try {
                // HITL rejection: if this is a kernel-gated approval, resolve via Tauri IPC
                if (stepId.startsWith("approval-")) {
                    const approvalKey = stepId.replace("approval-", "");
                    await kernelInvoke("respond_tool_approval", {
                        approvalKey,
                        approved: false,
                    });
                } else {
                    const resolved = resolvePendingApproval(taskId, stepId, false);
                    if (!resolved.ok) {
                        throw new Error("No pending approval found for this task");
                    }
                }
                updateTaskStatus(taskId, "running");
                setNodes((prev) =>
                    prev.map((n) =>
                        n.taskId === taskId
                            ? {
                                ...n,
                                taskStatus: "running" as const,
                                content: {
                                    ...n.content,
                                    logs: [...(n.content.logs || []), `Rejected step ${stepId.slice(0, 8)}`],
                                },
                                updatedAt: Date.now(),
                            }
                            : n,
                    ),
                );
            } catch (err) {
                setError({
                    message: err instanceof Error ? err.message : "Failed to reject action",
                });
            }
        },
        [setNodes, updateTaskStatus, setError],
    );

    const handleAnswerStep = useCallback(
        async (taskId: string, stepId: string, answer: string) => {
            try {
                // Resolve directly in-memory — no HTTP round-trip
                const resolved = resolvePendingQuestion(taskId, stepId, answer);

                if (!resolved.ok) {
                    // Question expired/not found — agent already continued
                    updateTaskStatus(taskId, "running");
                    updateTaskStep(taskId, {
                        id: stepId,
                        taskId,
                        index: 0,
                        type: "question_for_user",
                        status: "skipped" as const,
                        error: "Question expired — the agent continued without your answer",
                        completedAt: Date.now(),
                    });
                    setNodes((prev) =>
                        prev.map((n) =>
                            n.taskId === taskId
                                ? {
                                    ...n,
                                    taskStatus: "running" as const,
                                    content: {
                                        ...n.content,
                                        logs: [...(n.content.logs || []), `Question expired. Agent is continuing...`],
                                    },
                                    updatedAt: Date.now(),
                                }
                                : n,
                        ),
                    );
                    return;
                }

                updateTaskStatus(taskId, "running");
                const task = getTaskByIdRef.current(taskId);
                addConversationMessage(activeSpaceId, {
                    role: "user",
                    content: answer,
                    timestamp: Date.now(),
                    nodeId: task?.nodeId,
                });
                setNodes((prev) =>
                    prev.map((n) =>
                        n.taskId === taskId
                            ? {
                                ...n,
                                taskStatus: "running" as const,
                                content: {
                                    ...n.content,
                                    logs: [...(n.content.logs || []), `Answered: ${answer.slice(0, 50)}`],
                                },
                                updatedAt: Date.now(),
                            }
                            : n,
                    ),
                );
            } catch (err) {
                setError({
                    message: err instanceof Error ? err.message : "Failed to submit answer",
                });
            }
        },
        [setNodes, updateTaskStatus, updateTaskStep, setError, addConversationMessage, activeSpaceId],
    );

    const handleCancelTask = useCallback(
        (taskId: string) => {
            const controller = taskControllersRef.current.get(taskId);
            if (controller) {
                controller.abort();
                taskControllersRef.current.delete(taskId);
            }
            // Cancel any in-progress progressive reveal for this task's nodes
            for (const [nId, intervalId] of revealIntervalsRef.current) {
                window.clearInterval(intervalId);
                revealIntervalsRef.current.delete(nId);
            }
            updateTaskStatus(taskId, "cancelled");
            setNodes((prev) =>
                prev.map((n) =>
                    n.taskId === taskId
                        ? {
                            ...n,
                            status: "active" as const,
                            taskStatus: "cancelled" as const,
                            content: {
                                ...n.content,
                                summary: "Task cancelled by user.",
                                logs: [...(n.content.logs || []), "Task cancelled by user"],
                            },
                            updatedAt: Date.now(),
                        }
                        : n,
                ),
            );
        },
        [setNodes, updateTaskStatus],
    );

    /** Cancel ALL active operations (agent tasks + streaming syntheses) */
    const cancelAllActive = useCallback(() => {
        // Abort every active controller
        const controllers = taskControllersRef.current;
        const entries = Array.from(controllers.entries());
        for (const [id, controller] of entries) {
            controller.abort();
            updateTaskStatus(id, "cancelled");
        }
        controllers.clear();

        // Mark all synthesizing / running nodes as cancelled / active
        setNodes((prev) =>
            prev.map((n) => {
                if (n.status === "synthesizing") {
                    return {
                        ...n,
                        status: "active" as const,
                        taskStatus: n.taskStatus === "running" || n.taskStatus === "planning"
                            ? "cancelled" as const
                            : n.taskStatus,
                        content: {
                            ...n.content,
                            summary: n.content.summary || "Cancelled.",
                            logs: [...(n.content.logs || []), "Cancelled by user"],
                        },
                        updatedAt: Date.now(),
                    };
                }
                return n;
            }),
        );

        // Reset loading state
        setActiveSynthCount(0);
        setIsLoading(false);
        stopAmbientSound();
    }, [setNodes, setActiveSynthCount, updateTaskStatus]);

    // Intent listener (synthesis:intent events from action buttons in cards)
    // When sourceNodeId is present, continue in that card. Include originalQuery so the agent
    // retains context (e.g. "search_now" + "Carlos Cañas SWorkz" -> agent knows what to search).
    useEffect(() => {
        const onIntent = (event: Event) => {
            const ce = event as CustomEvent<{ intent?: string; sourceNodeId?: string; originalQuery?: string }>;
            if (!ce.detail?.intent) return;
            const intent = ce.detail.intent.trim();
            if (!intent) return;
            const sourceNodeId = ce.detail.sourceNodeId;
            const originalQuery = ce.detail.originalQuery?.trim();

            // Remove common prefixes to extract the actual query
            let query = intent;
            if (intent.startsWith("search:")) query = intent.replace("search:", "").trim();
            else if (intent.startsWith("query:")) query = intent.replace("query:", "").trim();
            else if (intent.startsWith("action:")) query = intent.replace("action:", "").trim();

            // When continuing in same card: meta-intents (search_now, clarify, cancel, etc.) need
            // the original query so the agent knows what "search now" refers to.
            const isMetaIntent = sourceNodeId && originalQuery && /^(search_now|clarify|cancel|ok|yes|no)$/i.test(query);
            if (isMetaIntent) {
                query = `[${query}] ${originalQuery}`;
            }

            if (query) void handleQuery(query, sourceNodeId);
        };

        window.addEventListener("synthesis:intent", onIntent);
        return () => window.removeEventListener("synthesis:intent", onIntent);
    }, [handleQuery]);

    const dismissEphemeralToast = useCallback((id: string) => {
        setEphemeralToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const consumePendingChatMessage = useCallback(() => {
        const msg = pendingChatMessage;
        setPendingChatMessage(null);
        return msg;
    }, [pendingChatMessage]);

    const clearMissingApiKeyPrompt = useCallback(() => {
        setMissingApiKeyProvider(null);
    }, []);

    return {
        handleSearch,
        handleQuery,
        handleOsQuery,
        handleApproveStep,
        handleRejectStep,
        handleAnswerStep,
        handleCancelTask,
        cancelAllActive,
        isLoading,
        error,
        setError,
        successMsg,
        setSuccessMsg,
        activeSynthCount,
        ephemeralToasts,
        dismissEphemeralToast,
        pendingChatMessage,
        consumePendingChatMessage,
        missingApiKeyProvider,
        clearMissingApiKeyPrompt,
    };
}
