"use client";

import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { apiGetSyncState, apiPutSyncState, apiPutSyncStateKeepalive } from "@/lib/apiClient";
import { isTauri } from "@/lib/tauriBridge";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useNodesStore } from "@/stores/nodesStore";
import type { SynthesisSettings } from "@/types/settings";
import type { SynthesisNode, SynthesisEdge, SpaceConversationHistory } from "@/types/synthesis";
import type { ConversationMessage } from "@/types/synthesis";
import type { AgentTask } from "@/lib/agent/types";
import { saveTask } from "@/lib/storage";

/**
 * Debounce for local-change pushes:
 * - Desktop (Tauri): 500 ms is enough — changes are frequent and the server is local.
 * - Remote browser (iPad): same 500 ms keeps writes snappy.
 */
const SYNC_DEBOUNCE_MS = 500;

/** Full settings for sync so the same user gets the same config (including API keys) on every device. */
function settingsForSync(settings: SynthesisSettings): Record<string, unknown> {
    return { ...settings } as Record<string, unknown>;
}

export interface UseUserSyncStateOptions {
    onAttempted: (attempted: boolean) => void;
    onStatus: (status: "pending" | "ok" | "failed") => void;
    retryRef: MutableRefObject<(() => void) | null>;
}

/**
 * Cross-device session sync: same user sees the same settings and workspace on every device (Mac, iPad, etc.).
 * - Loads full sync state from server on login (settings + workspace) and applies it as the session state.
 * - Persists full settings (including API keys) and workspace to server when they change (debounced).
 * - Settings from server are applied in full so the session is identical across devices.
 */
export function useUserSyncState(options: UseUserSyncStateOptions) {
    const { onAttempted, onStatus, retryRef } = options;
    const { user, token, isLoading, isAuthenticated } = useAuth();
    const { settings, updateSettings } = useSettings();
    const initialLoadDone = useRef(false);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Timestamp of the last local change to the workspace. */
    const lastWorkspaceChangeAtRef = useRef<number>(0);

    const setNodes = useNodesStore((s) => s.setNodes);
    const setEdges = useNodesStore((s) => s.setEdges);
    const setActiveSpaceId = useNodesStore((s) => s.setActiveSpaceId);
    const setConversationHistory = useNodesStore((s) => s.setConversationHistory);
    const setOsConversationHistory = useNodesStore((s) => s.setOsConversationHistory);
    const setIsHydrated = useNodesStore((s) => s.setIsHydrated);
    const setServerWorkspaceApplied = useNodesStore((s) => s.setServerWorkspaceApplied);
    const setTasks = useNodesStore((s) => s.setTasks);

    const nodes = useNodesStore((s) => s.nodes);
    const edges = useNodesStore((s) => s.edges);
    const activeSpaceId = useNodesStore((s) => s.activeSpaceId);
    const conversationHistory = useNodesStore((s) => s.conversationHistory);
    const osConversationHistory = useNodesStore((s) => s.osConversationHistory);

    // Cualquier cambio en workspace (local o aplicado desde servidor) actualiza el timestamp.
    useEffect(() => {
        lastWorkspaceChangeAtRef.current = Date.now();
    }, [nodes, edges, conversationHistory, osConversationHistory]);

    const doFetch = useCallback(() => {
        setServerWorkspaceApplied(false);
        let cancelled = false;
        apiGetSyncState()
            .then(async (state) => {
                if (cancelled) return;
                // Apply full server settings as session state (same table of work on every device)
                if (state.settings && typeof state.settings === "object") {
                    updateSettings(state.settings as Partial<SynthesisSettings>);
                } else if (user?.display_name) {
                    updateSettings({ userName: user.display_name } as Partial<SynthesisSettings>);
                }
                if (state.workspace && typeof state.workspace === "object") {
                    const w = state.workspace;

                    // ── Protección: no pisar workspace local reciente ni tareas/agents en curso ──
                    const now = Date.now();
                    const sinceChange = now - lastWorkspaceChangeAtRef.current;
                    const hasInFlightAgent = useNodesStore
                        .getState()
                        .nodes.some((n) => {
                            if (n.status === "synthesizing" && n.type !== "agent_task") return true;
                            if (n.type !== "agent_task") return false;
                            return (
                                n.status === "synthesizing" ||
                                n.taskStatus === "planning" ||
                                n.taskStatus === "running" ||
                                n.taskStatus === "waiting_approval" ||
                                n.taskStatus === "waiting_answer"
                            );
                        });
                    const SHOULD_APPLY_THRESHOLD_MS = 3000;
                    const shouldApplyWorkspace =
                        sinceChange > SHOULD_APPLY_THRESHOLD_MS && !hasInFlightAgent;

                    if (shouldApplyWorkspace) {
                        if (Array.isArray(w.nodes)) setNodes(w.nodes as SynthesisNode[]);
                        if (Array.isArray(w.edges)) setEdges(w.edges as SynthesisEdge[]);
                        if (w.activeSpaceId && ["work", "entertainment", "research"].includes(w.activeSpaceId)) {
                            setActiveSpaceId(w.activeSpaceId as "work" | "entertainment" | "research");
                        }
                        if (w.conversationHistory && typeof w.conversationHistory === "object") {
                            setConversationHistory(w.conversationHistory as SpaceConversationHistory);
                        }
                        if (Array.isArray(w.osConversationHistory)) {
                            setOsConversationHistory(w.osConversationHistory as ConversationMessage[]);
                        }
                        if (Array.isArray(w.tasks) && w.tasks.length > 0) {
                            const validTasks = w.tasks.filter(
                                (t): t is AgentTask =>
                                    t !== null &&
                                    typeof t === "object" &&
                                    "id" in (t as object) &&
                                    "nodeId" in (t as object) &&
                                    "query" in (t as object),
                            );
                            for (const t of validTasks) {
                                await saveTask(t);
                            }
                            setTasks(new Map(validTasks.map((t) => [t.id, t])));
                        }
                    }

                    // Aunque no apliquemos el snapshot, marcamos que el workspace del servidor está disponible.
                    setServerWorkspaceApplied(true);
                    setIsHydrated(true);
                }
                onStatus("ok");
            })
            .catch((err) => {
                console.error("[useUserSyncState] doFetch failed:", err?.message ?? err);
                if (!cancelled) onStatus("failed");
            })
            .finally(() => {
                if (!cancelled) {
                    initialLoadDone.current = true;
                    onAttempted(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [
        user?.display_name,
        updateSettings,
        setNodes,
        setEdges,
        setActiveSpaceId,
        setConversationHistory,
        setOsConversationHistory,
        setIsHydrated,
        setServerWorkspaceApplied,
        onAttempted,
        onStatus,
        setTasks,
    ]);

    // Load from server once per authenticated user and register retry.
    const lastFetchedUserIdRef = useRef<string | null>(null);
    useEffect(() => {
        retryRef.current = () => doFetch();

        // Avoid a false "failed sync" before auth is ready.
        if (isLoading || !isAuthenticated || !token || !user?.id) {
            return () => {
                retryRef.current = null;
            };
        }

        // Fetch once per user id. Retry button can still call doFetch manually.
        if (lastFetchedUserIdRef.current === user.id) {
            return () => {
                retryRef.current = null;
            };
        }

        initialLoadDone.current = false;
        lastFetchedUserIdRef.current = user.id;
        const cancel = doFetch();
        return () => {
            retryRef.current = null;
            if (typeof cancel === "function") cancel();
        };
    }, [doFetch, retryRef, isLoading, isAuthenticated, token, user?.id]);

    // When auth user is available and display name is missing or generic, set it so bar shows correct name on any device
    useEffect(() => {
        if (!user?.display_name) return;
        const current = settings.userName?.trim();
        if (current === user.display_name) return;
        if (!current || current === "Usuario") {
            updateSettings({ userName: user.display_name } as Partial<SynthesisSettings>);
        }
    }, [user?.display_name, settings.userName, updateSettings]);

    // Persist to server when settings or workspace change (debounced), only after initial load attempted
    const flushToServer = useCallback(() => {
        if (!initialLoadDone.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            const tasksMap = useNodesStore.getState().tasks;
            const tasksArray = Array.from(tasksMap.values());
            apiPutSyncState({
                settings: settingsForSync(settings),
                workspace: {
                    activeSpaceId,
                    nodes,
                    edges,
                    conversationHistory,
                    osConversationHistory,
                    tasks: tasksArray,
                },
            }).catch(() => { });
        }, SYNC_DEBOUNCE_MS);
    }, [
        settings,
        activeSpaceId,
        nodes,
        edges,
        conversationHistory,
        osConversationHistory,
    ]);

    useEffect(() => {
        flushToServer();
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [flushToServer]);

    // Keep latest payload in a ref so beforeunload/visibility send current state
    const payloadRef = useRef<{
        settings: Record<string, unknown>;
        workspace: Record<string, unknown>;
    } | null>(null);
    useEffect(() => {
        if (!initialLoadDone.current) return;
        const tasksMap = useNodesStore.getState().tasks;
        payloadRef.current = {
            settings: settingsForSync(settings),
            workspace: {
                activeSpaceId,
                nodes,
                edges,
                conversationHistory,
                osConversationHistory,
                tasks: Array.from(tasksMap.values()),
            },
        };
    }, [settings, activeSpaceId, nodes, edges, conversationHistory, osConversationHistory]);

    // Flush sync state when tab becomes hidden or page unloads (so Mac pushes to server for other devices)
    useEffect(() => {
        const flushNow = () => {
            if (!isAuthenticated || !token) return;
            if (!initialLoadDone.current) return;
            const p = payloadRef.current;
            if (p) apiPutSyncStateKeepalive(p);
        };
        const onVisibility = () => {
            if (!isAuthenticated || !token) return;
            if (document.visibilityState === "hidden") {
                // Desktop: push current state when switching away so other devices get it immediately.
                flushNow();
            } else if (document.visibilityState === "visible") {
                // Remote browser (iPad): pull latest state from server when tab comes back into focus
                // so the workspace stays in sync with the Mac without a page reload.
                // On Tauri desktop this also helps if the app was backgrounded for a while.
                doFetch();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", flushNow);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("pagehide", flushNow);
        };
    }, [doFetch, isAuthenticated, token]);

    // Poll for workspace updates while the tab is visible.
    // This keeps Mac <-> iPad state converged even when both stay open for long periods.
    useEffect(() => {
        if (!isAuthenticated || !token || !user?.id) return;
        const intervalMs = isTauri() ? 15_000 : 10_000;
        const id = setInterval(() => {
            if (document.visibilityState === "visible") doFetch();
        }, intervalMs);
        return () => clearInterval(id);
    }, [doFetch, isAuthenticated, token, user?.id]);
}
