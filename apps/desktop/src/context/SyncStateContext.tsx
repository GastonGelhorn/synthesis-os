"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { useUserSyncState } from "@/hooks/useUserSyncState";

export type SyncStatus = "pending" | "ok" | "failed";

interface SyncStateContextType {
    /** True after the initial sync fetch has completed (success or failure). */
    syncAttempted: boolean;
    /** Result of the last sync fetch: pending (not yet), ok (success), failed (network/auth error). */
    syncStatus: SyncStatus;
    /** Call to retry loading sync state from the server. */
    retrySync: () => void;
}

const defaultRetry = () => {};

const SyncStateContext = createContext<SyncStateContextType>({
    syncAttempted: false,
    syncStatus: "pending",
    retrySync: defaultRetry,
});

/**
 * Provider that runs useUserSyncState and exposes whether the initial sync fetch has completed,
 * its status (ok/failed), and a retry function. Children can wait for syncAttempted before
 * loading from localStorage, and when syncStatus === "failed" show an error + retry instead of empty state.
 */
export function SyncStateProvider({ children }: { children: React.ReactNode }) {
    const [syncAttempted, setSyncAttempted] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>("pending");
    const retryRef = useRef<(() => void) | null>(null);

    useUserSyncState({
        onAttempted: setSyncAttempted,
        onStatus: setSyncStatus,
        retryRef,
    });

    const retrySync = useCallback(() => {
        retryRef.current?.();
    }, []);

    const value: SyncStateContextType = {
        syncAttempted,
        syncStatus,
        retrySync,
    };

    return (
        <SyncStateContext.Provider value={value}>
            {children}
        </SyncStateContext.Provider>
    );
}

export function useSyncStateAttempted(): boolean {
    return useContext(SyncStateContext).syncAttempted;
}

export function useSyncState(): SyncStateContextType {
    return useContext(SyncStateContext);
}
