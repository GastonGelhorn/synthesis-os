"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Hook to manage the native macOS SpaceDock (NSVisualEffectView + native buttons).
 * When active, the CSS SpaceDock should be hidden.
 */
export function useNativeDock(activeSpaceId: string) {
    const [isNativeDockReady, setIsNativeDockReady] = useState(false);
    const initialized = useRef(false);

    // Initialize native dock on mount
    useEffect(() => {
        if (!isTauri || initialized.current) return;
        initialized.current = true;

        let unlisten: (() => void) | null = null;

        (async () => {
            try {
                // Listen for ready event from Rust
                unlisten = await listen("native-dock-ready", () => {
                    console.log("[NativeDock] Native dock ready ✓");
                    setIsNativeDockReady(true);
                });

                // Create the native dock
                await invoke("create_native_dock");
                console.log("[NativeDock] create_native_dock invoked");
            } catch (e: any) {
                console.warn("[NativeDock] Failed to create native dock:", e?.message || e);
                initialized.current = false; // allow retry
            }
        })();

        return () => {
            unlisten?.();
            // Destroy native dock on unmount
            invoke("destroy_native_dock").catch(() => {});
            setIsNativeDockReady(false);
            initialized.current = false;
        };
    }, []);

    // Sync active space to native dock
    useEffect(() => {
        if (!isNativeDockReady || !isTauri) return;
        invoke("update_native_dock_active_space", { spaceId: activeSpaceId }).catch((e) => {
            console.warn("[NativeDock] Failed to update active space:", e);
        });
    }, [activeSpaceId, isNativeDockReady]);

    // Handle window resize — reposition dock
    useEffect(() => {
        if (!isNativeDockReady || !isTauri) return;

        const handleResize = () => {
            invoke("reposition_native_dock").catch(() => {});
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [isNativeDockReady]);

    // Visibility control
    const setVisible = useCallback((visible: boolean) => {
        if (!isTauri) return;
        invoke("set_native_dock_visible", { visible }).catch(() => {});
    }, []);

    return {
        isNativeDockReady,
        setNativeDockVisible: setVisible,
    };
}
