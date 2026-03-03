"use client";

import { useCallback } from "react";

export function useDebugLog(enabled: boolean) {
    return useCallback(
        (...args: unknown[]) => {
            if (enabled) {
                console.log("[Synthesis]", ...args);
            }
        },
        [enabled],
    );
}
