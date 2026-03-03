import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface SpatialState {
    focusedId: string | null;
    queueOrder: string[];
    floatingPositions: Record<string, { x: number; y: number }>;
    hydrate: (visibleIds: string[], activeId: string | null) => void;
    focus: (id: string) => void;
    pushToQueue: (id: string) => void;
    setFloatingPosition: (id: string, position: { x: number; y: number }) => void;
    clearFloatingPosition: (id: string) => void;
}

function dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

export const useSpatialStore = create<SpatialState>((set, get) => ({
    focusedId: null,
    queueOrder: [],
    floatingPositions: {},

    hydrate: (visibleIds, activeId) => {
        const current = get();
        const visibleSet = new Set(visibleIds);
        const preferredFocus =
            (activeId && visibleSet.has(activeId) ? activeId : null) ??
            (current.focusedId && visibleSet.has(current.focusedId) ? current.focusedId : null) ??
            visibleIds[0] ??
            null;

        const mergedQueue = dedupe([
            ...current.queueOrder.filter((id) => visibleSet.has(id) && id !== preferredFocus),
            ...visibleIds.filter((id) => id !== preferredFocus),
        ]);

        const nextFloating: Record<string, { x: number; y: number }> = {};
        for (const id of Object.keys(current.floatingPositions)) {
            if (visibleSet.has(id)) {
                nextFloating[id] = current.floatingPositions[id];
            }
        }

        set({
            focusedId: preferredFocus,
            queueOrder: mergedQueue,
            floatingPositions: nextFloating,
        });

        // Sync with Tauri backend
        invoke("update_spatial_positions", { positions: nextFloating }).catch(e => console.warn("Failed to sync spatial data to Rust:", e));
    },

    focus: (id) =>
        set((state) => ({
            focusedId: id,
            queueOrder: state.queueOrder.filter((candidate) => candidate !== id),
        })),

    pushToQueue: (id) =>
        set((state) => ({
            queueOrder: dedupe([id, ...state.queueOrder.filter((candidate) => candidate !== id)]),
            focusedId: state.focusedId === id ? null : state.focusedId,
        })),

    setFloatingPosition: (id, position) => {
        set((state) => {
            const next = {
                ...state.floatingPositions,
                [id]: position,
            };
            // Sync with Tauri backend
            invoke("update_spatial_positions", { positions: next }).catch(e => console.warn("Failed to sync spatial data to Rust:", e));
            return { floatingPositions: next };
        });
    },

    clearFloatingPosition: (id) => {
        set((state) => {
            const next = { ...state.floatingPositions };
            delete next[id];
            // Sync with Tauri backend
            invoke("update_spatial_positions", { positions: next }).catch(e => console.warn("Failed to sync spatial data to Rust:", e));
            return { floatingPositions: next };
        });
    }
}));

