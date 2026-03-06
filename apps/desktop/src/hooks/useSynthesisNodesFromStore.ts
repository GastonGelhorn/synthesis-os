import { useEffect, useRef, useMemo } from "react";
import type { SynthesisSettings } from "@/types/settings";
import type { SynthesisNode, SynthesisEdge, SpaceId, ConversationMessage } from "@/types/synthesis";
import type { AgentTask } from "@/lib/agent/types";
import { useNodesStore } from "@/stores/nodesStore";
import { useProfile } from "@/context/ProfileContext";
import { useSyncState } from "@/context/SyncStateContext";
import { useDebugLog } from "./useDebugLog";
import {
    saveStateToIDB,
    loadStateFromIDB,
    isIndexedDBAvailable,
    saveTask,
    listTasks as listTasksIDB,
    deleteTask as deleteTaskIDB,
} from "@/lib/storage";
import { clampPositionToViewport } from "@/lib/positioning";

const STUCK_THRESHOLD = 5 * 60 * 1000;

/**
 * Hook that hydrates the nodes Zustand store from storage, persists on change,
 * and returns the same API as useSynthesisNodes so App and useSynthesis work unchanged.
 */
const STORAGE_KEY_LEGACY = "synthesis-os-state.v3";

function getStorageKey(profileId: string | null): string {
    return profileId ? `synthesis-os-state.v3:${profileId}` : STORAGE_KEY_LEGACY;
}

export function useSynthesisNodesFromStore(settings: SynthesisSettings) {
    const { activeProfileId } = useProfile();
    const { syncAttempted, syncStatus, retrySync } = useSyncState();
    const debugLog = useDebugLog(settings.consoleOutput);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasCleanedStuckRef = useRef(false);
    const hasClampedOnLoadRef = useRef(false);

    const nodes = useNodesStore((s) => s.nodes);
    const activeSpaceId = useNodesStore((s) => s.activeSpaceId);
    const activeNodeId = useNodesStore((s) => s.activeNodeId);
    const isHydrated = useNodesStore((s) => s.isHydrated);
    const conversationHistory = useNodesStore((s) => s.conversationHistory);
    const osConversationHistory = useNodesStore((s) => s.osConversationHistory);
    const edges = useNodesStore((s) => s.edges);
    const linkMode = useNodesStore((s) => s.linkMode);
    const tasks = useNodesStore((s) => s.tasks);
    const ephemeralWidgets = useNodesStore((s) => s.ephemeralWidgets);

    const setNodes = useNodesStore((s) => s.setNodes);
    const setActiveSpaceId = useNodesStore((s) => s.setActiveSpaceId);
    const setActiveNodeId = useNodesStore((s) => s.setActiveNodeId);
    const setIsHydrated = useNodesStore((s) => s.setIsHydrated);
    const setConversationHistory = useNodesStore((s) => s.setConversationHistory);
    const setOsConversationHistory = useNodesStore((s) => s.setOsConversationHistory);
    const setEdges = useNodesStore((s) => s.setEdges);
    const setTasks = useNodesStore((s) => s.setTasks);

    const activateNode = useNodesStore((s) => s.activateNode);
    const closeNode = useNodesStore((s) => s.closeNode);
    const minimizeNode = useNodesStore((s) => s.minimizeNode);
    const moveNode = useNodesStore((s) => s.moveNode);
    const resizeNode = useNodesStore((s) => s.resizeNode);
    const toggleGodMode = useNodesStore((s) => s.toggleGodMode);
    const switchSpace = useNodesStore((s) => s.switchSpace);
    const addConversationMessage = useNodesStore((s) => s.addConversationMessage);
    const addOsMessage = useNodesStore((s) => s.addOsMessage);
    const clearSpaceHistory = useNodesStore((s) => s.clearSpaceHistory);
    const getOsHistory = useNodesStore((s) => s.getOsHistory);
    const getHistoryForNode = useNodesStore((s) => s.getHistoryForNode);
    const startLinkMode = useNodesStore((s) => s.startLinkMode);
    const cancelLinkMode = useNodesStore((s) => s.cancelLinkMode);
    const completeLinkMode = useNodesStore((s) => s.completeLinkMode);
    const removeEdge = useNodesStore((s) => s.removeEdge);
    const addNode = useNodesStore((s) => s.addNode);
    const cleanupStuckNodes = useNodesStore((s) => s.cleanupStuckNodes);
    const closeAllSpaceNodes = useNodesStore((s) => s.closeAllSpaceNodes);
    const spawnWidget = useNodesStore((s) => s.spawnWidget);
    const getTaskForNode = useNodesStore((s) => s.getTaskForNode);
    const getTaskById = useNodesStore((s) => s.getTaskById);
    const upsertTask = useNodesStore((s) => s.upsertTask);
    const updateTaskStep = useNodesStore((s) => s.updateTaskStep);
    const updateTaskStatus = useNodesStore((s) => s.updateTaskStatus);
    const removeTask = useNodesStore((s) => s.removeTask);
    const spawnEphemeralWidget = useNodesStore((s) => s.spawnEphemeralWidget);
    const dismissEphemeralWidget = useNodesStore((s) => s.dismissEphemeralWidget);
    const setSpaceCache = useNodesStore((s) => s.setSpaceCache);

    const activeSpaceNodes = useMemo(
        () => nodes.filter((n) => n.spaceId === activeSpaceId),
        [activeSpaceId, nodes],
    );

    const nodeCountBySpace = useMemo(() => {
        const counts: Record<string, number> = Object.fromEntries(settings.spaces.map(s => [s.id, 0]));
        for (const n of nodes) {
            counts[n.spaceId] = (counts[n.spaceId] || 0) + 1;
        }
        return counts;
    }, [nodes, settings.spaces]);

    const hasVisibleNodes = useMemo(
        () => activeSpaceNodes.some((n) => n.status !== "minimized"),
        [activeSpaceNodes],
    );

    const activeSpaceEdges = useMemo(() => {
        const spaceNodeIds = new Set(activeSpaceNodes.map((n) => n.id));
        return edges.filter((e) => spaceNodeIds.has(e.sourceId) && spaceNodeIds.has(e.targetId));
    }, [edges, activeSpaceNodes]);

    const getSpaceHistory = useMemo(
        () => (spaceId: SpaceId) => conversationHistory[spaceId] || [],
        [conversationHistory],
    );

    // Hydrate from storage — wait for sync attempt so server state is not overwritten by empty localStorage.
    // When sync failed, do not load from local; let UI show error + retry so user can try again.
    useEffect(() => {
        if (!syncAttempted) return;
        if (useNodesStore.getState().serverWorkspaceApplied) {
            setIsHydrated(true);
            return;
        }
        if (syncStatus === "failed") {
            setIsHydrated(true);
            return;
        }
        setIsHydrated(false);
        let mounted = true;
        async function loadState() {
            try {
                if (useNodesStore.getState().serverWorkspaceApplied) {
                    if (mounted) setIsHydrated(true);
                    return;
                }
                if (syncStatus === "failed") {
                    if (mounted) setIsHydrated(true);
                    return;
                }
                const applyParsed = (raw: unknown) => {
                    if (!raw || typeof raw !== "object") return;
                    const parsed = raw as Record<string, unknown>;
                    if (Array.isArray(parsed.nodes)) {
                        const validNodes = (parsed.nodes as unknown[]).filter(
                            (n): n is SynthesisNode =>
                                n !== null &&
                                typeof n === "object" &&
                                "id" in (n as Record<string, unknown>) &&
                                "position" in (n as Record<string, unknown>),
                        );
                        if (validNodes.length > 0) setNodes(validNodes);
                    }
                    setActiveSpaceId(parsed.activeSpaceId as SpaceId);
                    if (parsed.spaceCache && typeof parsed.spaceCache === "object") {
                        const cacheMap = new Map<string, { nodes: SynthesisNode[]; edges: SynthesisEdge[] }>();
                        Object.entries(parsed.spaceCache).forEach(([sid, data]) => {
                            cacheMap.set(sid, data as { nodes: SynthesisNode[]; edges: SynthesisEdge[] });
                        });
                        setSpaceCache(cacheMap);
                    }
                    if (parsed.conversationHistory && typeof parsed.conversationHistory === "object") {
                        setConversationHistory((prev) => {
                            const newHistory = { ...prev };
                            Object.entries(parsed.conversationHistory as Record<string, unknown>).forEach(([key, val]) => {
                                if (Array.isArray(val)) {
                                    newHistory[key] = val as ConversationMessage[];
                                }
                            });
                            return newHistory;
                        });
                    }
                    if (Array.isArray(parsed.osConversationHistory)) {
                        setOsConversationHistory(parsed.osConversationHistory as ConversationMessage[]);
                    }
                    if (Array.isArray(parsed.edges)) {
                        const validEdges = (parsed.edges as unknown[]).filter(
                            (e): e is SynthesisEdge =>
                                e !== null &&
                                typeof e === "object" &&
                                "sourceId" in (e as Record<string, unknown>) &&
                                "targetId" in (e as Record<string, unknown>),
                        );
                        if (validEdges.length > 0) setEdges(validEdges);
                    }
                };

                const storageKey = getStorageKey(activeProfileId);

                if (settings.dataPersistence === "session") {
                    const raw = sessionStorage.getItem(storageKey);
                    if (raw && mounted) applyParsed(JSON.parse(raw));
                    else if (mounted) setActiveSpaceId(settings.defaultSpace ?? "work");
                } else if (isIndexedDBAvailable()) {
                    let idbState = await loadStateFromIDB(activeProfileId);
                    if (!idbState && activeProfileId) {
                        idbState = await loadStateFromIDB(null);
                    }
                    if (idbState && mounted) applyParsed(idbState);
                    else {
                        let raw = localStorage.getItem(storageKey);
                        if (!raw && activeProfileId) raw = localStorage.getItem(STORAGE_KEY_LEGACY);
                        if (raw && mounted) applyParsed(JSON.parse(raw));
                        else if (mounted) setActiveSpaceId(settings.defaultSpace ?? "work");
                    }
                } else {
                    let raw = localStorage.getItem(storageKey);
                    if (!raw && activeProfileId) raw = localStorage.getItem(STORAGE_KEY_LEGACY);
                    if (raw && mounted) applyParsed(JSON.parse(raw));
                    else if (mounted) setActiveSpaceId(settings.defaultSpace ?? "work");
                }
            } catch (e) {
                console.error("Failed to restore Synthesis memory:", e);
            } finally {
                if (mounted) setIsHydrated(true);
            }
        }
        void loadState();
        return () => {
            mounted = false;
        };
    }, [syncAttempted, syncStatus, settings.defaultSpace, settings.dataPersistence, activeProfileId]);

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

    // Cleanup stuck nodes on hydration
    useEffect(() => {
        if (!isHydrated || hasCleanedStuckRef.current) return;
        hasCleanedStuckRef.current = true;
        setNodes((prev) => {
            const now = Date.now();
            let changed = false;
            const cleaned = prev.map((n) => {
                if (n.status === "synthesizing" && (now - n.updatedAt) > STUCK_THRESHOLD) {
                    changed = true;
                    debugLog(`Recovered stuck node: "${n.title}"`);
                    return { ...n, status: "active" as const, updatedAt: now };
                }
                if (
                    n.type === "agent_task" &&
                    (n.taskStatus === "planning" ||
                        n.taskStatus === "running" ||
                        n.taskStatus === "waiting_approval" ||
                        n.taskStatus === "waiting_answer") &&
                    (now - n.updatedAt) > STUCK_THRESHOLD
                ) {
                    changed = true;
                    debugLog(`Recovered stuck agent task: "${n.title}"`);
                    return { ...n, status: "active" as const, taskStatus: "failed" as const, updatedAt: now };
                }
                return n;
            });
            return changed ? cleaned : prev;
        });
    }, [isHydrated, debugLog]);

    // Clamp node positions on load
    useEffect(() => {
        if (!isHydrated || nodes.length === 0 || hasClampedOnLoadRef.current) return;
        if (typeof window === "undefined") return;
        hasClampedOnLoadRef.current = true;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const next = nodes.map((n) => {
            const clamped = clampPositionToViewport(
                n.position.x,
                n.position.y,
                n.dimension.w,
                n.dimension.h,
                vw,
                vh,
            );
            if (clamped.x !== n.position.x || clamped.y !== n.position.y) {
                return {
                    ...n,
                    position: { ...n.position, x: clamped.x, y: clamped.y },
                    updatedAt: Date.now(),
                };
            }
            return n;
        });
        if (next.some((n, i) => n.position.x !== nodes[i].position.x || n.position.y !== nodes[i].position.y)) {
            setNodes(next);
        }
    }, [isHydrated, nodes]);

    // Clean edges when nodes are removed
    useEffect(() => {
        if (!isHydrated) return;
        const nodeIds = new Set(nodes.map((n) => n.id));
        setEdges((prev) => {
            const cleaned = prev.filter((e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId));
            return cleaned.length < prev.length ? cleaned : prev;
        });
    }, [nodes, isHydrated]);

    // Persist (debounced)
    useEffect(() => {
        if (!isHydrated) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const state = useNodesStore.getState();
            const payload = {
                activeSpaceId: state.activeSpaceId,
                nodes: state.nodes,
                edges: state.edges,
                conversationHistory: state.conversationHistory,
                osConversationHistory: state.osConversationHistory,
                spaceCache: Object.fromEntries(state.spaceCache.entries()),
            };
            const storageKey = getStorageKey(activeProfileId);
            if (settings.dataPersistence === "session") {
                sessionStorage.setItem(storageKey, JSON.stringify(payload));
            } else if (isIndexedDBAvailable()) {
                void saveStateToIDB(payload, activeProfileId);
                localStorage.setItem(storageKey, JSON.stringify(payload));
            } else {
                localStorage.setItem(storageKey, JSON.stringify(payload));
            }
        }, 500);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [
        activeSpaceId,
        activeProfileId,
        isHydrated,
        nodes,
        edges,
        conversationHistory,
        osConversationHistory,
        settings.dataPersistence,
    ]);

    // Persist task to IDB when upsertTask/updateTaskStep/updateTaskStatus (handled in useSynthesis/agentRunner; store doesn't persist tasks)
    // We keep task persistence in the store's callers or add a subscribe in the hook that persists tasks. For simplicity, keep task save in agentRunner/synthesis when they call upsertTask. So no change.

    const switchSpaceWithSettings = (spaceId: SpaceId) => {
        switchSpace(spaceId, { clearOnSwitch: settings.clearOnSwitch });
    };

    const addConversationMessageWithSettings = (spaceId: SpaceId, message: ConversationMessage) => {
        addConversationMessage(spaceId, message, {
            maxConversationHistory: settings.maxConversationHistory ?? 10,
        });
    };

    const addOsMessageWithSettings = (message: ConversationMessage) => {
        addOsMessage(message, {
            maxConversationHistory: settings.maxConversationHistory ?? 10,
        });
    };

    const closeNodeById = closeNode;

    const syncFailed = syncAttempted && syncStatus === "failed";

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
        switchSpace: switchSpaceWithSettings,
        debugLog,
        conversationHistory,
        osConversationHistory,
        addConversationMessage: addConversationMessageWithSettings,
        addOsMessage: addOsMessageWithSettings,
        clearSpaceHistory,
        getSpaceHistory,
        getOsHistory,
        getHistoryForNode,
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
        ephemeralWidgets,
        spawnEphemeralWidget,
        dismissEphemeralWidget,
        syncFailed,
        retrySync,
    };
}

export type SynthesisNodeStore = ReturnType<typeof useSynthesisNodesFromStore>;
