import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type {
    SynthesisNode,
    SynthesisEdge,
    NodeType,
    SpaceId,
    ConversationMessage,
    SpaceConversationHistory,
    WidgetKind,
    WidgetType,
    EphemeralWidget,
} from "@/types/synthesis";
import type { AgentTask, AgentStep } from "@/lib/agent/types";
import { findNextOpenPosition } from "@/lib/positioning";
import { saveTask, deleteTask, isIndexedDBAvailable } from "@/lib/storage";

export type { SynthesisNode, SynthesisEdge, SpaceId, AgentTask, EphemeralWidget };

const DEFAULT_CONVERSATION_HISTORY: SpaceConversationHistory = {};

export interface NodesStoreSettings {
    clearOnSwitch?: boolean;
    maxConversationHistory?: number;
}

export interface SpaceSnapshot {
    nodes: SynthesisNode[];
    edges: SynthesisEdge[];
}

export interface NodesState {
    nodes: SynthesisNode[];
    activeSpaceId: SpaceId;
    activeNodeId: string | null;
    isHydrated: boolean;
    conversationHistory: SpaceConversationHistory;
    /** Global OS-level conversation; separate from per-space task history. */
    osConversationHistory: ConversationMessage[];
    edges: SynthesisEdge[];
    linkMode: string | null;
    tasks: Map<string, AgentTask>;
    ephemeralWidgets: EphemeralWidget[];
    /** Cache of nodes/edges per space when clearOnSwitch removes them. Restored when switching back. */
    spaceCache: Map<SpaceId, SpaceSnapshot>;
    /** True after workspace was hydrated from server (sync); skip loading from localStorage to avoid overwriting. */
    serverWorkspaceApplied: boolean;
}

export interface NodesActions {
    setNodes: (nodes: SynthesisNode[] | ((prev: SynthesisNode[]) => SynthesisNode[])) => void;
    setActiveSpaceId: (id: SpaceId) => void;
    setActiveNodeId: (id: string | null) => void;
    setIsHydrated: (value: boolean) => void;
    setServerWorkspaceApplied: (value: boolean) => void;
    setConversationHistory: (history: SpaceConversationHistory | ((prev: SpaceConversationHistory) => SpaceConversationHistory)) => void;
    setOsConversationHistory: (history: ConversationMessage[] | ((prev: ConversationMessage[]) => ConversationMessage[])) => void;
    setEdges: (edges: SynthesisEdge[] | ((prev: SynthesisEdge[]) => SynthesisEdge[])) => void;
    setLinkMode: (sourceId: string | null) => void;
    setTasks: (tasks: Map<string, AgentTask> | ((prev: Map<string, AgentTask>) => Map<string, AgentTask>)) => void;
    setEphemeralWidgets: (widgets: EphemeralWidget[] | ((prev: EphemeralWidget[]) => EphemeralWidget[])) => void;

    getTaskForNode: (nodeId: string) => AgentTask | undefined;
    getTaskById: (taskId: string) => AgentTask | undefined;

    activateNode: (id: string) => void;
    closeNode: (id: string) => void;
    minimizeNode: (id: string) => void;
    moveNode: (id: string, pos: { x: number; y: number }) => void;
    resizeNode: (id: string, dimension: { w: number; h: number }) => void;
    toggleGodMode: (id: string) => void;

    switchSpace: (spaceId: SpaceId, settings?: NodesStoreSettings) => void;

    addConversationMessage: (spaceId: SpaceId, message: ConversationMessage, settings?: NodesStoreSettings) => void;
    clearSpaceHistory: (spaceId: SpaceId) => void;
    clearNodeHistory: (spaceId: SpaceId, nodeId: string) => void;
    removeConversationMessage: (spaceId: SpaceId, index: number) => void;

    getOsHistory: () => ConversationMessage[];
    addOsMessage: (message: ConversationMessage, settings?: NodesStoreSettings) => void;
    getHistoryForNode: (spaceId: SpaceId, nodeId: string) => ConversationMessage[];

    startLinkMode: (sourceId: string) => void;
    cancelLinkMode: () => void;
    completeLinkMode: (targetId: string) => void;
    removeEdge: (edgeId: string) => void;

    addNode: (opts: {
        query: string;
        type: NodeType;
        title: string;
        spaceId: SpaceId;
        content: SynthesisNode["content"];
    }) => string;

    cleanupStuckNodes: () => void;
    closeAllSpaceNodes: (spaceId: SpaceId) => void;

    spawnWidget: (kind: WidgetKind) => void;

    upsertTask: (task: AgentTask) => void;
    updateTaskStep: (taskId: string, step: AgentStep) => void;
    updateTaskStatus: (taskId: string, status: AgentTask["status"]) => void;
    removeTask: (taskId: string) => void;

    spawnEphemeralWidget: (type: WidgetType, data?: unknown, title?: string) => void;
    dismissEphemeralWidget: (id: string) => void;
    setSpaceCache: (cache: Map<SpaceId, SpaceSnapshot>) => void;
}

export type NodesStore = NodesState & NodesActions;

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

export const useNodesStore = create<NodesStore>((set, get) => ({
    nodes: [],
    activeSpaceId: "work",
    activeNodeId: null,
    isHydrated: false,
    conversationHistory: { ...DEFAULT_CONVERSATION_HISTORY },
    osConversationHistory: [],
    edges: [],
    linkMode: null,
    tasks: new Map(),
    ephemeralWidgets: [],
    spaceCache: new Map(),
    serverWorkspaceApplied: false,

    setNodes: (nodesOrUpdater) => {
        set((state) => ({
            nodes: typeof nodesOrUpdater === "function" ? nodesOrUpdater(state.nodes) : nodesOrUpdater,
        }));
    },

    setActiveSpaceId: (id) => set({ activeSpaceId: id }),
    setActiveNodeId: (id) => set({ activeNodeId: id }),
    setIsHydrated: (value) => set({ isHydrated: value }),
    setServerWorkspaceApplied: (value) => set({ serverWorkspaceApplied: value }),
    setConversationHistory: (historyOrUpdater) => {
        set((state) => ({
            conversationHistory:
                typeof historyOrUpdater === "function"
                    ? historyOrUpdater(state.conversationHistory)
                    : historyOrUpdater,
        }));
    },
    setOsConversationHistory: (historyOrUpdater) => {
        set((state) => ({
            osConversationHistory:
                typeof historyOrUpdater === "function"
                    ? historyOrUpdater(state.osConversationHistory)
                    : historyOrUpdater,
        }));
    },
    setEdges: (edgesOrUpdater) => {
        set((state) => ({
            edges: typeof edgesOrUpdater === "function" ? edgesOrUpdater(state.edges) : edgesOrUpdater,
        }));
    },
    setLinkMode: (sourceId) => set({ linkMode: sourceId }),
    setTasks: (tasksOrUpdater) => {
        set((state) => ({
            tasks: typeof tasksOrUpdater === "function" ? tasksOrUpdater(state.tasks) : tasksOrUpdater,
        }));
    },
    setEphemeralWidgets: (widgetsOrUpdater) => {
        set((state) => ({
            ephemeralWidgets:
                typeof widgetsOrUpdater === "function"
                    ? widgetsOrUpdater(state.ephemeralWidgets)
                    : widgetsOrUpdater,
        }));
    },

    getTaskForNode: (nodeId) => {
        const tasks = get().tasks;
        const nodeTasks = Array.from(tasks.values()).filter((task) => task.nodeId === nodeId);
        if (nodeTasks.length === 0) return undefined;
        return nodeTasks.reduce((latest, current) =>
            current.createdAt > latest.createdAt ? current : latest
        );
    },

    getTaskById: (taskId) => get().tasks.get(taskId),

    activateNode: (id) => {
        set((state) => {
            const nextZ = Math.max(0, ...state.nodes.map((n) => n.zIndex)) + 1;
            return {
                nodes: state.nodes.map((n) =>
                    n.id === id ? { ...n, zIndex: nextZ, status: "active" as const, updatedAt: Date.now() } : n,
                ),
                activeNodeId: id,
            };
        });
    },

    closeNode: (id) => {
        set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== id),
            activeNodeId: state.activeNodeId === id ? null : state.activeNodeId,
        }));
    },

    minimizeNode: (id) => {
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === id
                    ? { ...n, status: "minimized" as const, isGodMode: false, updatedAt: Date.now() }
                    : n,
            ),
            activeNodeId: state.activeNodeId === id ? null : state.activeNodeId,
        }));
    },

    moveNode: (id, pos) => {
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === id
                    ? { ...n, position: { ...n.position, x: pos.x, y: pos.y }, updatedAt: Date.now() }
                    : n,
            ),
        }));
    },

    resizeNode: (id, dimension) => {
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === id ? { ...n, dimension: { w: dimension.w, h: dimension.h }, updatedAt: Date.now() } : n,
            ),
        }));
    },

    toggleGodMode: (id) => {
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === id ? { ...n, isGodMode: !n.isGodMode, updatedAt: Date.now() } : n,
            ),
        }));
    },

    switchSpace: (spaceId, settings) => {
        const state = get();
        const clearOnSwitch = settings?.clearOnSwitch ?? false;
        if (clearOnSwitch) {
            const leavingSpaceId = state.activeSpaceId;
            const leavingNodes = state.nodes.filter((n) => n.spaceId === leavingSpaceId);
            const leavingNodeIds = new Set(leavingNodes.map((n) => n.id));
            const leavingEdges = state.edges.filter(
                (e) => leavingNodeIds.has(e.sourceId) || leavingNodeIds.has(e.targetId),
            );

            const nextCache = new Map(state.spaceCache);
            if (leavingNodes.length > 0 || leavingEdges.length > 0) {
                nextCache.set(leavingSpaceId, { nodes: leavingNodes, edges: leavingEdges });
            }

            let nextNodes = state.nodes.filter((n) => n.spaceId !== leavingSpaceId);
            let nextEdges = state.edges.filter(
                (e) => !leavingNodeIds.has(e.sourceId) && !leavingNodeIds.has(e.targetId),
            );

            const cached = nextCache.get(spaceId);
            if (cached && (cached.nodes.length > 0 || cached.edges.length > 0)) {
                nextNodes = [...nextNodes, ...cached.nodes];
                nextEdges = [...nextEdges, ...cached.edges];
                nextCache.delete(spaceId);
            }

            set({
                nodes: nextNodes,
                edges: nextEdges,
                spaceCache: nextCache,
                activeSpaceId: spaceId,
                activeNodeId: null,
            });
        } else {
            set({ activeSpaceId: spaceId, activeNodeId: null });
        }
    },

    addConversationMessage: (spaceId, message, settings) => {
        const maxHistory = (settings?.maxConversationHistory ?? 10) * 2;
        set((state) => {
            const history = [...(state.conversationHistory[spaceId] || []), message];
            return {
                conversationHistory: {
                    ...state.conversationHistory,
                    [spaceId]: history.slice(-maxHistory),
                },
            };
        });
    },

    clearSpaceHistory: (spaceId) => {
        set((state) => ({
            conversationHistory: { ...state.conversationHistory, [spaceId]: [] },
        }));
    },

    clearNodeHistory: (spaceId, nodeId) => {
        set((state) => {
            const arr = state.conversationHistory[spaceId] || [];
            const next = arr.filter((m) => m.nodeId !== nodeId);
            return { conversationHistory: { ...state.conversationHistory, [spaceId]: next } };
        });
    },

    removeConversationMessage: (spaceId, index) => {
        set((state) => {
            const arr = state.conversationHistory[spaceId] || [];
            const next = arr.filter((_, i) => i !== index);
            return { conversationHistory: { ...state.conversationHistory, [spaceId]: next } };
        });
    },

    getOsHistory: () => get().osConversationHistory,

    addOsMessage: (message, settings) => {
        const maxHistory = (settings?.maxConversationHistory ?? 10) * 2;
        set((state) => {
            const history = [...state.osConversationHistory, message];
            return { osConversationHistory: history.slice(-maxHistory) };
        });
    },

    getHistoryForNode: (spaceId, nodeId) => {
        const arr = get().conversationHistory[spaceId] || [];
        return arr.filter((m) => m.nodeId === nodeId);
    },

    startLinkMode: (sourceId) => set({ linkMode: sourceId }),

    cancelLinkMode: () => set({ linkMode: null }),

    completeLinkMode: (targetId) => {
        const state = get();
        const { linkMode, edges } = state;
        if (!linkMode || linkMode === targetId) {
            set({ linkMode: null });
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
            set({ edges: [...edges, newEdge], linkMode: null });
        } else {
            set({ linkMode: null });
        }
    },

    removeEdge: (edgeId) => {
        set((state) => ({ edges: state.edges.filter((e) => e.id !== edgeId) }));
    },

    addNode: (opts) => {
        const id = uuidv4();
        set((state) => {
            const spaceNodes = state.nodes.filter((n) => n.spaceId === opts.spaceId);
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
                zIndex: Math.max(0, ...state.nodes.map((n) => n.zIndex)) + 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isGodMode: false,
                content: opts.content,
            };
            return { nodes: [...state.nodes, newNode], activeNodeId: id };
        });
        return id;
    },

    cleanupStuckNodes: () => {
        set((state) => {
            const now = Date.now();
            const STUCK_THRESHOLD = 2 * 60 * 1000;
            const cleaned = state.nodes.filter((n) => {
                if (n.status === "synthesizing" && now - n.updatedAt > STUCK_THRESHOLD) return false;
                return true;
            });
            if (cleaned.length < state.nodes.length) {
                return { nodes: cleaned };
            }
            return state;
        });
    },

    closeAllSpaceNodes: (spaceId) => {
        set((state) => ({ nodes: state.nodes.filter((n) => n.spaceId !== spaceId) }));
    },

    spawnWidget: (kind) => {
        const state = get();
        const size = WIDGET_SIZES[kind] ?? { w: 280, h: 280 };
        const id = uuidv4();
        set((s) => {
            const spaceNodes = s.nodes.filter((n) => n.spaceId === state.activeSpaceId);
            const pos = findNextOpenPosition(spaceNodes, size);
            const widgetNode: SynthesisNode = {
                id,
                query: "",
                type: "widget",
                title: WIDGET_LABELS[kind],
                spaceId: state.activeSpaceId,
                position: { x: pos.x, y: pos.y, z: 0 },
                dimension: size,
                status: "active",
                zIndex: Math.max(0, ...s.nodes.map((n) => n.zIndex)) + 1,
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
            return { nodes: [...s.nodes, widgetNode], activeNodeId: id };
        });
    },

    upsertTask: (task) => {
        set((state) => {
            const next = new Map(state.tasks);
            next.set(task.id, task);
            return { tasks: next };
        });
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
    },

    updateTaskStep: (taskId, step) => {
        const state = get();
        const task = state.tasks.get(taskId);
        if (!task) return;
        const existingIdx = task.steps.findIndex((s) => s.id === step.id);
        const steps = [...task.steps];
        if (existingIdx >= 0) {
            steps[existingIdx] = { ...steps[existingIdx], ...step };
        } else {
            steps.push(step);
        }
        const updated = { ...task, steps, updatedAt: Date.now() };
        const next = new Map(state.tasks);
        next.set(taskId, updated);
        set({ tasks: next });
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
    },

    updateTaskStatus: (taskId, status) => {
        const state = get();
        const task = state.tasks.get(taskId);
        if (!task) return;
        const updated = { ...task, status, updatedAt: Date.now() };
        const next = new Map(state.tasks);
        next.set(taskId, updated);
        set({ tasks: next });
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
    },

    removeTask: (taskId) => {
        set((state) => {
            const next = new Map(state.tasks);
            next.delete(taskId);
            return { tasks: next };
        });
        if (isIndexedDBAvailable()) {
            void deleteTask(taskId);
        }
    },

    spawnEphemeralWidget: (type, data, title) => {
        set((state) => {
            const current = state.ephemeralWidgets.length >= 3 ? state.ephemeralWidgets.slice(1) : state.ephemeralWidgets;
            return {
                ephemeralWidgets: [
                    ...current,
                    {
                        id: uuidv4(),
                        type,
                        data,
                        title,
                        createdAt: Date.now(),
                    },
                ],
            };
        });
    },

    dismissEphemeralWidget: (id) => {
        set((state) => ({
            ephemeralWidgets: state.ephemeralWidgets.filter((w) => w.id !== id),
        }));
    },
    setSpaceCache: (cache) => set({ spaceCache: cache }),
}));
