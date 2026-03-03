"use client";

import { useEffect } from "react";
import { isTauri } from "@/lib/tauriBridge";

/**
 * Activates the native macOS Liquid Glass effect via Tauri plugin invoke().
 * In web-only environments (no Tauri, e.g. iPad Safari) this hook is a no-op.
 */
export function useLiquidGlass() {
  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const supported = await invoke<boolean>("plugin:liquid-glass|is_glass_supported");
        console.log("[LiquidGlass] isGlassSupported:", supported);
        if (!supported || cancelled) return;

        // Rust struct fields are snake_case, variant is a string enum
        await invoke("plugin:liquid-glass|set_liquid_glass_effect", {
          config: {
            enabled: true,
            corner_radius: 0,
            tint_color: null,
            variant: 2, // Dock (Regular=0, Clear=1, Dock=2)
          },
        });
        console.log("[LiquidGlass] Effect activated ✓");
      } catch (e: any) {
        console.warn("[LiquidGlass] Error:", e?.message || e);
      }
    })();

    return () => { cancelled = true; };
  }, []);
}
