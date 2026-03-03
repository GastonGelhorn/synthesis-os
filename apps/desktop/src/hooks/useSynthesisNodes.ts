"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SynthesisNode, SynthesisEdge, SynthesisPersistedState, NodeType, SpaceId, ConversationMessage, SpaceConversationHistory, WidgetKind } from "@/types/synthesis";
import { SynthesisSettings } from "@/types/settings";
import { v4 as uuidv4 } from "uuid";
import { useDebugLog } from "./useDebugLog";
import { saveStateToIDB, loadStateFromIDB, isIndexedDBAvailable, saveTask, loadTaskByNodeId, listTasks as listTasksIDB, deleteTask as deleteTaskIDB } from "@/lib/storage";
import type { PersistedAgentTask } from "@/lib/storage";
import { findNextOpenPosition, clampPositionToViewport } from "@/lib/positioning";
import type { AgentTask, AgentStep } from "@/lib/agent/types";

const STORAGE_KEY = "synthesis-os-state.v3";

export function useSynthesisNodes(settings: SynthesisSettings) {
    const debugLog = useDebugLog(settings.consoleOutput);
    const [nodes, setNodes] = useState<SynthesisNode[]>([]);
    const [activeSpaceId, setActiveSpaceId] = useState<SpaceId>("work");
    const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState(false);
    const [conversationHistory, setConversationHistory] = useState<SpaceConversationHistory>({
        work: [],
        entertainment: [],
        research: [],
    });
    const [edges, setEdges] = useState<SynthesisEdge[]>([]);
    const [linkMode, setLinkMode] = useState<string | null>(null); // sourceId when linking

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Persistence: load ---
    useEffect(() => {
        async function loadState() {
            try {
                /** Validate and safely apply persisted state, handling schema drift */
                const applyParsed = (raw: unknown) => {
                    if (!raw || typeof raw !== "object") return;
                    const parsed = raw as Record<string, unknown>;

                    // Validate nodes array -- each entry must have at least id and position
                    if (Array.isArray(parsed.nodes)) {
                        const validNodes = (parsed.nodes as unknown[]).filter(
                            (n): n is SynthesisNode =>
                                n !== null && typeof n === "object" &&
                                "id" in (n as Record<string, unknown>) &&
                                "position" in (n as Record<string, unknown>),
                        );
                        if (validNodes.length > 0) setNodes(validNodes);
                    }
                    if (typeof parsed.activeSpaceId === "string" && ["work", "entertainment", "research"].includes(parsed.activeSpaceId)) {
                        setActiveSpaceId(parsed.activeSpaceId as SpaceId);
                    }
                    if (parsed.conversationHistory && typeof parsed.conversationHistory === "object") {
                        setConversationHistory((prev) => ({ ...prev, ...(parsed.conversationHistory as Partial<SpaceConversationHistory>) }));
                    }
                    if (Array.isArray(parsed.edges)) {
                        const validEdges = (parsed.edges as unknown[]).filter(
                            (e): e is SynthesisEdge =>
                                e !== null && typeof e === "object" &&
                                "sourceId" in (e as Record<string, unknown>) &&
                                "targetId" in (e as Record<string, unknown>),
                        );
                        setEdges(validEdges);
                    }
                };

                if (settings.dataPersistence === "session") {
                    const raw = sessionStorage.getItem(STORAGE_KEY);
                    if (raw) applyParsed(JSON.parse(raw));
                    else setActiveSpaceId(settings.defaultSpace ?? "work");
                } else if (isIndexedDBAvailable()) {
                    const idbState = await loadStateFromIDB();
                    if (idbState) applyParsed(idbState);
                    else {
                        const raw = localStorage.getItem(STORAGE_KEY);
                        if (raw) applyParsed(JSON.parse(raw));
                        else setActiveSpaceId(settings.defaultSpace ?? "work");
                    }
                } else {
                    const raw = localStorage.getItem(STORAGE_KEY);
                    if (raw) applyParsed(JSON.parse(raw));
                    else setActiveSpaceId(settings.defaultSpace ?? "work");
                }
            } catch (e) {
                console.error("Failed to restore Synthesis memory:", e);
            } finally {
                setIsHydrated(true);
            }
        }
        void loadState();
    }, [settings.defaultSpace, settings.dataPersistence]);

    // --- Cleanup stuck nodes on hydration (ghost nodes stuck in synthesizing state) ---
    const hasCleanedStuckRef = useRef(false);
    useEffect(() => {
        if (!isHydrated || hasCleanedStuckRef.current) return;
        hasCleanedStuckRef.current = true;
        setNodes((prev) => {
            const STUCK_THRESHOLD = 5 * 60 * 1000; // 5 minutes
            const now = Date.now();
            let changed = false;
            const cleaned = prev.map((n) => {
                // Nodes stuck in "synthesizing" for too long → mark active
                if (n.status === "synthesizing" && (now - n.updatedAt) > STUCK_THRESHOLD) {
                    changed = true;
                    debugLog(`Recovered stuck node: "${n.title}" (was synthesizing for ${Math.round((now - n.updatedAt) / 1000)}s)`);
                    return { ...n, status: "active" as const, updatedAt: now };
                }
                // Agent tasks stuck in transient states → mark as failed
                if (
                    n.type === "agent_task" &&
                    (n.taskStatus === "planning" || n.taskStatus === "running" || n.taskStatus === "waiting_approval" || n.taskStatus === "waiting_answer") &&
                    (now - n.updatedAt) > STUCK_THRESHOLD
                ) {
                    changed = true;
                    debugLog(`Recovered stuck agent task: "${n.title}" (was ${n.taskStatus} for ${Math.round((now - n.updatedAt) / 1000)}s)`);
                    return { ...n, status: "active" as const, taskStatus: "failed" as const, updatedAt: now };
                }
                return n;
            });
            return changed ? cleaned : prev;
        });
    }, [isHydrated, debugLog]);

    // --- Clamp persisted node positions to viewport on load (fix off-screen cards) ---
    const hasClampedOnLoadRef = useRef(false);
    useEffect(() => {
        if (!isHydrated || nodes.length === 0 || hasClampedOnLoadRef.current) return;
        if (typeof window === "undefined") return;
        hasClampedOnLoadRef.current = true;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const next = nodes.map((n) => {
            const clamped = clampPositionToViewport(n.position.x, n.position.y, n.dimension.w, n.dimension.h, vw, vh);
            if (clamped.x !== n.position.x || clamped.y !== n.position.y) {
                return { ...n, position: { ...n.position, x: clamped.x, y: clamped.y }, updatedAt: Date.now() };
            }
            return n;
        });
        if (next.some((n, i) => n.position.x !== nodes[i].position.x || n.position.y !== nodes[i].position.y)) {
            setNodes(next);
        }
    }, [isHydrated, nodes]);

    // --- Persistence: save (debounced) ---
    useEffect(() => {
        if (!isHydrated) return;

        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

        saveTimerRef.current = setTimeout(() => {
            const state = { activeSpaceId, nodes, edges, conversationHistory };

            if (settings.dataPersistence === "session") {
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } else if (isIndexedDBAvailable()) {
                void saveStateToIDB(state);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } else {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            }
        }, 500);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [activeSpaceId, isHydrated, nodes, edges, conversationHistory, settings.dataPersistence]);

    // --- Derived state ---
    const activeSpaceNodes = useMemo(
        () => nodes.filter((n) => n.spaceId === activeSpaceId),
        [activeSpaceId, nodes],
    );

    const nodeCountBySpace = useMemo(() => {
        const counts: Record<SpaceId, number> = { work: 0, entertainment: 0, research: 0 };
        for (const n of nodes) {
            // Match the same visibility logic as WorkspaceView's activeNodes filter:
            // exclude minimized, non-agent synthesizing nodes, and in-progress agent tasks
            if (n.status === "minimized") continue;
            if (n.status === "synthesizing" && n.type !== "agent_task") continue;
            if (
                n.type === "agent_task" &&
                (n.status === "synthesizing" ||
                    n.taskStatus === "planning" ||
                    n.taskStatus === "running" ||
                    n.taskStatus === "waiting_approval" ||
                    n.taskStatus === "waiting_answer")
            ) continue;
            counts[n.spaceId]++;
        }
        return counts;
    }, [nodes]);

    const hasVisibleNodes = useMemo(
        () => activeSpaceNodes.some((n) => n.status !== "minimized"),
        [activeSpaceNodes],
    );

    // --- Node actions ---
    const activateNode = useCallback((id: string) => {
        setNodes((prev) => {
            const nextZ = Math.max(0, ...prev.map((n) => n.zIndex)) + 1;
            return prev.map((n) =>
                n.id === id ? { ...n, zIndex: nextZ, status: "active" as const, updatedAt: Date.now() } : n,
            );
        });
        setActiveNodeId(id);
    }, []);

    const closeNode = useCallback((id: string) => {
        setNodes((prev) => prev.filter((n) => n.id !== id));
        setActiveNodeId((prev) => (prev === id ? null : prev));
    }, []);

    const minimizeNode = useCallback((id: string) => {
        setNodes((prev) =>
            prev.map((n) =>
                n.id === id
                    ? { ...n, status: "minimized" as const, isGodMode: false, updatedAt: Date.now() }
                    : n,
            ),
        );
        setActiveNodeId((prev) => (prev === id ? null : prev));
    }, []);

    const moveNode = useCallback((id: string, pos: { x: number; y: number }) => {
        setNodes((prev) =>
            prev.map((n) =>
                n.id === id
                    ? { ...n, position: { ...n.position, x: pos.x, y: pos.y }, updatedAt: Date.now() }
                    : n,
            ),
        );
    }, []);

    const resizeNode = useCallback((id: string, dimension: { w: number; h: number }) => {
        setNodes((prev) =>
            prev.map((n) =>
                n.id === id
                    ? { ...n, dimension: { w: dimension.w, h: dimension.h }, updatedAt: Date.now() }
                    : n,
            ),
        );
    }, []);

    const toggleGodMode = useCallback((id: string) => {
        setNodes((prev) =>
            prev.map((n) =>
                n.id === id ? { ...n, isGodMode: !n.isGodMode, updatedAt: Date.now() } : n,
            ),
        );
    }, []);

    // --- Conversation history ---
    const addConversationMessage = useCallback((spaceId: SpaceId, message: ConversationMessage) => {
        setConversationHistory((prev) => {
            const history = [...(prev[spaceId] || []), message];
            const maxHistory = (settings.maxConversationHistory ?? 10) * 2;
            return {
                ...prev,
                [spaceId]: history.slice(-maxHistory),
            };
        });
    }, [settings.maxConversationHistory]);

    const clearSpaceHistory = useCallback((spaceId: SpaceId) => {
        setConversationHistory((prev) => ({ ...prev, [spaceId]: [] }));
    }, []);

    const getSpaceHistory = useCallback((spaceId: SpaceId): ConversationMessage[] => {
        return conversationHistory[spaceId] || [];
    }, [conversationHistory]);

    // --- Navigation ---
    const switchSpace = useCallback(
        (spaceId: SpaceId) => {
            if (settings.clearOnSwitch) {
                setNodes((prev) => prev.filter((n) => n.spaceId !== activeSpaceId));
            }
            debugLog("Switched to space:", spaceId);
            setActiveSpaceId(spaceId);
            setActiveNodeId(null);
        },
        [settings.clearOnSwitch, activeSpaceId, debugLog],
    );

    // --- Edge / link management ---
    const activeSpaceEdges = useMemo(
        () => {
            const spaceNodeIds = new Set(activeSpaceNodes.map((n) => n.id));
            return edges.filter((e) => spaceNodeIds.has(e.sourceId) && spaceNodeIds.has(e.targetId));
        },
        [edges, activeSpaceNodes],
    );

    const startLinkMode = useCallback((sourceId: string) => {
        setLinkMode(sourceId);
    }, []);

    const cancelLinkMode = useCallback(() => {
        setLinkMode(null);
    }, []);

    const completeLinkMode = useCallback((targetId: string) => {
        if (!linkMode || linkMode === targetId) {
            setLinkMode(null);
            return;
        }
        const exists = edges.some(
            (e) =>
                (e.sourceId === linkMode && e.targetId === targetId) ||
                (e.sourceId === targetId && e.targetId === linkMode),
        );
        if (!exists) {
            const newEdge: SynthesisEdge = {
                id: uuidv4(),
                sourceId: linkMode,
                targetId,
                createdAt: Date.now(),
            };
            setEdges((prev) => [...prev, newEdge]);
            debugLog(`Created edge: ${linkMode} -> ${targetId}`);
        }
        setLinkMode(null);
    }, [linkMode, edges, debugLog]);

    const removeEdge = useCallback((edgeId: string) => {
        setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    }, []);

    // Clean up edges when nodes are removed
    useEffect(() => {
        const nodeIds = new Set(nodes.map((n) => n.id));
        setEdges((prev) => {
            const cleaned = prev.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
            return cleaned.length < prev.length ? cleaned : prev;
        });
    }, [nodes]);

    // --- Agent task management ---
    const [tasks, setTasks] = useState<Map<string, AgentTask>>(new Map());

    // Load tasks from IndexedDB on hydration
    useEffect(() => {
        if (!isHydrated) return;
        void (async () => {
            try {
                if (isIndexedDBAvailable()) {
                    const allTasks = await listTasksIDB();
                    const map = new Map<string, AgentTask>();
                    for (const t of allTasks) {
                        map.set(t.id, t as AgentTask);
                    }
                    setTasks(map);
                }
            } catch (e) {
                console.error("Failed to load agent tasks:", e);
            }
        })();
    }, [isHydrated]);

    const getTaskForNode = useCallback((nodeId: string): AgentTask | undefined => {
        const found = Array.from(tasks.values()).find((task) => task.nodeId === nodeId);
        return found;
    }, [tasks]);

    const getTaskById = useCallback((taskId: string): AgentTask | undefined => {
        return tasks.get(taskId);
    }, [tasks]);

    const upsertTask = useCallback((task: AgentTask) => {
        setTasks((prev) => {
            const next = new Map(prev);
            next.set(task.id, task);
            return next;
        });
        // Persist to IndexedDB
        if (isIndexedDBAvailable()) {
            void saveTask({
                id: task.id,
                nodeId: task.nodeId,
                query: task.query,
                spaceId: task.spaceId,
                status: task.status,
                steps: task.steps,
                config: task.config,
                createdAt: task.createdAt,
                updatedAt: Date.now(),
            });
        }
    }, []);

    const updateTaskStep = useCallback((taskId: string, step: AgentStep) => {
        setTasks((prev) => {
            const task = prev.get(taskId);
            if (!task) {
                console.warn(`[updateTaskStep] Task ${taskId} NOT FOUND in tasks map (size=${prev.size}). Step ${step.type}/${step.status} dropped!`);
                return prev;
            }
            const existingIdx = task.steps.findIndex((s) => s.id === step.id);
            const steps = [...task.steps];
            if (existingIdx >= 0) {
                steps[existingIdx] = { ...steps[existingIdx], ...step };
            } else {
                steps.push(step);
            }
            const updated = { ...task, steps, updatedAt: Date.now() };
            const next = new Map(prev);
            next.set(taskId, updated);
            // Persist
            if (isIndexedDBAvailable()) {
                void saveTask({
                    id: updated.id,
                    nodeId: updated.nodeId,
                    query: updated.query,
                    spaceId: updated.spaceId,
                    status: updated.status,
                    steps: updated.steps,
                    config: updated.config,
                    createdAt: updated.createdAt,
                    updatedAt: updated.updatedAt,
                });
            }
            return next;
        });
    }, []);

    const updateTaskStatus = useCallback((taskId: string, status: AgentTask["status"]) => {
        setTasks((prev) => {
            const task = prev.get(taskId);
            if (!task) return prev;
            const updated = { ...task, status, updatedAt: Date.now() };
            const next = new Map(prev);
            next.set(taskId, updated);
            if (isIndexedDBAvailable()) {
                void saveTask({
                    id: updated.id,
                    nodeId: updated.nodeId,
                    query: updated.query,
                    spaceId: updated.spaceId,
                    status: updated.status,
                    steps: updated.steps,
                    config: updated.config,
                    createdAt: updated.createdAt,
                    updatedAt: updated.updatedAt,
                });
            }
            return next;
        });
    }, []);

    const removeTask = useCallback((taskId: string) => {
        setTasks((prev) => {
            const next = new Map(prev);
            next.delete(taskId);
            return next;
        });
        if (isIndexedDBAvailable()) {
            void deleteTaskIDB(taskId);
        }
    }, []);

    // --- Bulk node management ---
    const cleanupStuckNodes = useCallback(() => {
        setNodes((prev) => {
            const now = Date.now();
            let removed = 0;
            const cleaned = prev.filter((n) => {
                // Remove nodes stuck in synthesizing for > 2 min
                if (n.status === "synthesizing" && (now - n.updatedAt) > 2 * 60 * 1000) {
                    removed++;
                    return false;
                }
                return true;
            });
            if (removed > 0) debugLog(`Cleaned up ${removed} stuck nodes`);
            return removed > 0 ? cleaned : prev;
        });
    }, [debugLog]);

    const closeAllSpaceNodes = useCallback((spaceId: SpaceId) => {
        setNodes((prev) => prev.filter((n) => n.spaceId !== spaceId));
        debugLog(`Closed all nodes in space: ${spaceId}`);
    }, [debugLog]);

    const closeNodeById = useCallback((id: string) => {
        setNodes((prev) => prev.filter((n) => n.id !== id));
        setActiveNodeId((prev) => (prev === id ? null : prev));
    }, []);

    // --- Spawn widget ---
    const spawnWidget = useCallback((kind: WidgetKind) => {
        const WIDGET_SIZES: Record<WidgetKind, { w: number; h: number }> = {
            clock: { w: 280, h: 240 },
            calculator: { w: 260, h: 380 },
            notes: { w: 320, h: 340 },
            timer: { w: 280, h: 320 },
            weather: { w: 300, h: 280 },
        };
        const WIDGET_LABELS: Record<WidgetKind, string> = {
            clock: "Clock",
            calculator: "Calculator",
            notes: "Quick Notes",
            timer: "Timer",
            weather: "Weather",
        };
        const size = WIDGET_SIZES[kind] || { w: 280, h: 280 };
        const id = uuidv4();

        // Use functional updater to avoid stale `nodes` closure
        setNodes((prev) => {
            const spaceNodes = prev.filter((n) => n.spaceId === activeSpaceId);
            const pos = findNextOpenPosition(spaceNodes, size);
            const widgetNode: SynthesisNode = {
                id,
                query: "",
                type: "widget",
                title: WIDGET_LABELS[kind],
                spaceId: activeSpaceId,
                position: { x: pos.x, y: pos.y, z: 0 },
                dimension: size,
                status: "active",
                zIndex: Math.max(0, ...prev.map((n) => n.zIndex)) + 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isGodMode: false,
                widgetKind: kind,
                content: {
                    title: WIDGET_LABELS[kind],
                    summary: "",
                    design: {
                        accent_color: "#818cf8",
                        vibe: "utility",
                        text_style: "sans",
                        glass_opacity: 0.4,
                    },
                    blocks: [],
                },
            };
            return [...prev, widgetNode];
        });
        setActiveNodeId(id);
        debugLog(`Spawned widget: ${kind}`);
    }, [activeSpaceId, debugLog, setNodes]);

    // --- Auto-cleanup old minimized nodes ---
    useEffect(() => {
        if (!settings.autoCleanup || !isHydrated) return;
        const interval = setInterval(() => {
            const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
            setNodes((prev) => {
                const cleaned = prev.filter(
                    (n) => n.status !== "minimized" || n.updatedAt > cutoff,
                );
                if (cleaned.length < prev.length) {
                    debugLog(
                        `Auto-cleanup: removed ${prev.length - cleaned.length} old nodes`,
                    );
                }
                return cleaned.length < prev.length ? cleaned : prev;
            });
        }, 60000);
        return () => clearInterval(interval);
    }, [settings.autoCleanup, isHydrated, debugLog]);

    // --- Storage limit warning ---
    useEffect(() => {
        if (!isHydrated) return;
        try {
            const storage =
                settings.dataPersistence === "session" ? sessionStorage : localStorage;
            let totalSize = 0;
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key) totalSize += (storage.getItem(key) || "").length;
            }
            const sizeMB = totalSize / (1024 * 1024);
            const limitMB = settings.storageLimit;
            if (sizeMB > limitMB * 0.9) {
                debugLog(
                    `Storage usage: ${sizeMB.toFixed(1)}MB / ${limitMB}MB (${Math.round((sizeMB / limitMB) * 100)}%)`,
                );
            }
        } catch {
            // storage access may fail
        }
    }, [nodes, isHydrated, settings.storageLimit, settings.dataPersistence, debugLog]);

    // --- Add a pre-built node directly (for file drops, etc.) ---
    const addNode = useCallback((opts: {
        query: string;
        type: NodeType;
        title: string;
        spaceId: SpaceId;
        content: SynthesisNode["content"];
    }) => {
        const id = uuidv4();
        // Use functional updater to avoid stale `nodes` closure
        setNodes((prev) => {
            const spaceNodes = prev.filter((n) => n.spaceId === opts.spaceId);
            const pos = findNextOpenPosition(spaceNodes, { w: 400, h: 300 });
            const newNode: SynthesisNode = {
                id,
                query: opts.query,
                type: opts.type,
                title: opts.title,
                spaceId: opts.spaceId,
                position: { x: pos.x, y: pos.y, z: 0 },
                dimension: { w: 400, h: 300 },
                status: "active",
                zIndex: Math.max(0, ...prev.map((n) => n.zIndex)) + 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isGodMode: false,
                content: opts.content,
            };
            return [...prev, newNode];
        });
        setActiveNodeId(id);
        debugLog(`Added node: ${opts.title}`);
        return id;
    }, [debugLog, setNodes]);

    // --- Ephemeral Widgets (Generative UI) ---
    const [ephemeralWidgets, setEphemeralWidgets] = useState<import("@/types/synthesis").EphemeralWidget[]>([]);

    const spawnEphemeralWidget = useCallback((type: import("@/types/synthesis").WidgetType, data?: any, title?: string) => {
        setEphemeralWidgets((prev) => {
            // Optional: limit to 3 widgets to prevent clutter
            const current = prev.length >= 3 ? prev.slice(1) : prev;
            return [
                ...current,
                {
                    id: uuidv4(),
                    type,
                    data,
                    title,
                    createdAt: Date.now(),
                },
            ];
        });
    }, []);

    const dismissEphemeralWidget = useCallback((id: string) => {
        setEphemeralWidgets((prev) => prev.filter((w) => w.id !== id));
    }, []);

    return {
        nodes,
        setNodes,
        activeNodeId,
        setActiveNodeId,
        activeSpaceId,
        activeSpaceNodes,
        nodeCountBySpace,
        hasVisibleNodes,
        isHydrated,
        activateNode,
        closeNode,
        minimizeNode,
        moveNode,
        resizeNode,
        toggleGodMode,
        switchSpace,
        debugLog,
        conversationHistory, // Expose full history state
        addConversationMessage,
        clearSpaceHistory,
        getSpaceHistory,
        spawnWidget,
        edges,
        activeSpaceEdges,
        linkMode,
        startLinkMode,
        cancelLinkMode,
        completeLinkMode,
        removeEdge,
        addNode,
        cleanupStuckNodes,
        closeAllSpaceNodes,
        closeNodeById,
        tasks,
        getTaskForNode,
        getTaskById,
        upsertTask,
        updateTaskStep,
        updateTaskStatus,
        removeTask,
        // Generative UI
        ephemeralWidgets,
        spawnEphemeralWidget,
        dismissEphemeralWidget,
    };
}

export type SynthesisNodeStore = ReturnType<typeof useSynthesisNodes>;
