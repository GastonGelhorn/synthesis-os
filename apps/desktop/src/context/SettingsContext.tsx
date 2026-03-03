"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SynthesisSettings, DEFAULT_SETTINGS } from "@/types/settings";
import { getTheme, applyThemeToDocument, getThemePersonalityPreset, generateAccentVariables } from "@/lib/themes";
import { BootScreen } from "@/components/synthesis-ui/BootScreen";

const SETTINGS_STORAGE_KEY = "synthesis-os-settings.v3";

const TOOL_ALIAS_MAP: Record<string, string[]> = {
    file_manager: [
        "file_write", "file_append", "file_read_full", "dir_list", "file_move", "file_copy",
        "storage_create", "storage_write", "storage_read", "storage_list",
        "storage_delete", "storage_versions", "storage_rollback",
    ],
    email_reader: ["email_list"],
    calendar: ["calendar_today", "calendar_create"],
    reminders: ["reminders_list", "reminders_add"],
    contacts: ["contacts_search"],
    system_info: ["get_system_info"],
    clipboard: ["clipboard_read", "clipboard_write"],
    spotlight_search: ["search_files"],
    desktop_screenshot: ["take_screenshot"],
    volume_brightness: ["get_volume", "set_volume", "get_brightness", "set_brightness"],
    battery_info: ["get_battery"],
    wifi_info: ["get_wifi"],
    dark_mode: ["toggle_dark_mode"],
    finder: ["finder_open", "finder_trash"],
    music: ["music_play", "music_pause", "music_next"],
    notes: ["notes_list", "notes_read", "notes_create"],
};

function normalizeToolIds(toolIds: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const toolId of toolIds) {
        if (toolId === "generate_code") continue;
        const expanded = TOOL_ALIAS_MAP[toolId] ?? [toolId];
        for (const id of expanded) {
            if (!seen.has(id)) {
                seen.add(id);
                out.push(id);
            }
        }
    }
    return out;
}

const API_KEY_KEYS: (keyof SynthesisSettings)[] = [
    "openaiApiKey", "anthropicApiKey", "groqApiKey", "geminiApiKey",
];

/** Strip API keys for localStorage - keys are stored only in Tauri store */
function stripApiKeysForLocalStorage(s: SynthesisSettings): Partial<SynthesisSettings> {
    const out = { ...s };
    out.openaiApiKey = "";
    out.anthropicApiKey = "";
    out.groqApiKey = "";
    out.geminiApiKey = "";
    return out;
}

function normalizeStoredSettings(partial: Partial<SynthesisSettings>): Partial<SynthesisSettings> {
    const next = { ...partial };
    if ((next.dataPersistence as string) === "encrypted") {
        next.dataPersistence = "local";
    }
    if ("agents" in next) {
        if (Array.isArray(next.agents)) {
            next.agents = next.agents
                .filter((agent) => agent && typeof agent === "object")
                .map((agent) => ({
                    ...agent,
                    tools: normalizeToolIds(
                        Array.isArray((agent as { tools?: unknown }).tools)
                            ? ((agent as { tools?: unknown[] }).tools ?? []).filter((t): t is string => typeof t === "string")
                            : [],
                    ),
                }));
        } else {
            delete (next as { agents?: unknown }).agents;
        }
    }
    if ("disabledTools" in next) {
        if (Array.isArray(next.disabledTools)) {
            next.disabledTools = normalizeToolIds(
                next.disabledTools.filter((id): id is string => typeof id === "string"),
            );
        } else {
            delete (next as { disabledTools?: unknown }).disabledTools;
        }
    }
    return next;
}

interface SettingsContextType {
    settings: SynthesisSettings;
    updateSetting: <K extends keyof SynthesisSettings>(key: K, value: SynthesisSettings[K]) => void;
    updateSettings: (partial: Partial<SynthesisSettings>) => void;
    resetSettings: () => void;
    exportSettings: () => string;
    importSettings: (json: string) => boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<SynthesisSettings>(DEFAULT_SETTINGS);
    const [isHydrated, setIsHydrated] = useState(false);
    const [bootStage, setBootStage] = useState<"sync" | "init" | "complete">("sync");

    // ── Robust Sequential Boot Sequence ──
    useEffect(() => {
        let mounted = true;
        console.log("[SYNTHESIS_BOOT] Bootstrap sequence started.");

        // 1. Initial Data Load
        try {
            const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (stored && mounted) {
                const parsed = normalizeStoredSettings(JSON.parse(stored) as Partial<SynthesisSettings>);
                setSettings((prev) => ({ ...prev, ...parsed }));
                console.log("[SYNTHESIS_BOOT] Settings loaded from local storage.");
            }
        } catch (e) {
            console.error("[SYNTHESIS_BOOT] Data load failed:", e);
        }

        // 2. If in Tauri, load API keys from Tauri store (not persisted in localStorage)
        const loadTauriKeys = async () => {
            try {
                const { load } = await import("@tauri-apps/plugin-store");
                const store = await load("settings.json");
                const tauriSettings = await store.get<Partial<SynthesisSettings>>("settings");
                if (tauriSettings && mounted) {
                    const keysOnly: Partial<Pick<SynthesisSettings, "openaiApiKey" | "anthropicApiKey" | "groqApiKey" | "geminiApiKey">> = {};
                    for (const k of API_KEY_KEYS) {
                        const v = tauriSettings[k];
                        if (typeof v === "string" && v) (keysOnly as Record<string, string>)[k] = v;
                    }
                    if (Object.keys(keysOnly).length > 0) {
                        setSettings((prev) => ({ ...prev, ...keysOnly }));
                    }
                }
            } catch {
                // Not in Tauri or store unavailable
            }
        };
        void loadTauriKeys();

        // Signal that settings are ready (even if default)
        if (mounted) setIsHydrated(true);

        // 2. Transition Logic
        const syncTimeout = setTimeout(() => {
            if (!mounted) return;
            console.log("[SYNTHESIS_BOOT] Stage 1 (Sync) Complete -> Initializing Profile...");
            setBootStage("init");

            const initTimeout = setTimeout(() => {
                if (!mounted) return;
                console.log("[SYNTHESIS_BOOT] Stage 2 (Init) Complete -> Opening Workspace.");
                setBootStage("complete");
            }, 3500);

            return () => clearTimeout(initTimeout);
        }, 3000);

        return () => {
            mounted = false;
            clearTimeout(syncTimeout);
        };
    }, []); // Only run once on mount

    // ── Persist on change ──
    useEffect(() => {
        if (!isHydrated) return;
        // API keys are NOT stored in localStorage (only in Tauri store when available)
        const forLocalStorage = stripApiKeysForLocalStorage(settings);
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(forLocalStorage));

        // Full settings (including API keys) sync to Tauri Store - used by Rust kernel
        const syncToTauriStore = async () => {
            try {
                const { load } = await import("@tauri-apps/plugin-store");
                const store = await load("settings.json", { autoSave: true, defaults: DEFAULT_SETTINGS as any });
                await store.set("settings", settings);
                // No need to call store.save() if autoSave is true, but good practice
                await store.save();
            } catch (err) {
                // Silently fail if not in Tauri environment
            }
        };
        syncToTauriStore();
    }, [settings, isHydrated]);

    // ── Apply theme to document ──
    useEffect(() => {
        if (!isHydrated) return;

        // Determine active theme from appearanceMode
        let activeThemeId = settings.appearanceMode === "auto" ? "dark" : settings.appearanceMode; // Default to dark if auto for now

        // Simple auto detection if needed in future
        if (settings.appearanceMode === "auto") {
            const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            activeThemeId = isDark ? "dark" : "light";
        }

        const theme = getTheme(activeThemeId);
        applyThemeToDocument(theme);

        const root = document.documentElement;
        if (theme.category === "light") {
            root.classList.add("theme-light");
            root.classList.remove("theme-dark");
        } else {
            root.classList.add("theme-dark");
            root.classList.remove("theme-light");
        }

        // Keep legacy theme/themeName for compat
        if (settings.theme !== theme.category || settings.themeName !== theme.id) {
            setSettings(s => ({ ...s, theme: theme.category as any, themeName: theme.id }));
        }
    }, [settings.appearanceMode, isHydrated]);

    // ── When user switches theme, apply that theme's appearance preset (accent, glass, etc.) but keep current wallpaper ──
    const prevThemeNameRef = useRef<string | null>(null);
    useEffect(() => {
        if (!isHydrated) return;
        const next = settings.themeName;
        const prev = prevThemeNameRef.current;
        prevThemeNameRef.current = next;
        if (prev !== null && prev !== next) {
            const preset = getThemePersonalityPreset(next);
            setSettings((s) => ({ ...s, ...preset, backgroundPreset: s.backgroundPreset }));
        }
    }, [settings.themeName, isHydrated]);

    // ── Keep `theme` in sync with themeName category ──
    useEffect(() => {
        if (!isHydrated) return;
        const theme = getTheme(settings.themeName);
        if (settings.theme !== theme.category) {
            setSettings((prev) => ({ ...prev, theme: theme.category }));
        }
    }, [settings.themeName, settings.theme, isHydrated]);

    // ── Apply appearance variables ──
    useEffect(() => {
        if (!isHydrated) return;
        const root = document.documentElement;
        const fontScaleBySize: Record<SynthesisSettings["systemFontSize"], number> = {
            "x-small": 0.92,
            small: 0.97,
            medium: 1,
            large: 1.06,
            "x-large": 1.12,
        };

        const glassOpacityNorm = settings.glassOpacity / 100;
        root.style.setProperty("--synthesis-glass-opacity", String(glassOpacityNorm));

        // Chrome = frosted (Control Center). Cards/Windows = nearly solid (Finder/Settings).
        // Same look for cards and Settings panel; accent only for details (e.g. selected tab).
        const isClear = settings.glassStyle === "clear";
        const isDark = settings.theme === "dark";

        // System chrome: translucent in Clear, slightly more opaque in Tinted
        const systemDensity = isClear
            ? (isDark ? 0.20 + 0.30 * glassOpacityNorm : 0.30 + 0.30 * glassOpacityNorm)
            : (isDark ? 0.28 + 0.28 * glassOpacityNorm : 0.38 + 0.26 * glassOpacityNorm);

        // Cards/Windows: Clear = more transparent; Tinted = more opaque (accent depth).
        const cardDensity = isClear
            ? 0.93 + 0.04 * glassOpacityNorm  // 0.93–0.97 (Clear = more transparent)
            : 0.95 + 0.03 * glassOpacityNorm; // 0.95-0.98 (Tinted = more opaque)

        root.style.setProperty("--synthesis-system-glass-alpha", String(systemDensity));
        root.style.setProperty("--synthesis-card-glass-alpha", String(cardDensity));
        root.style.setProperty("--synthesis-glass-saturation", String(settings.glassSaturation / 100));
        const baseBlurPx = 12 + Math.round((settings.blurIntensity / 100) * 32);
        root.style.setProperty("--synthesis-glass-blur", `${baseBlurPx}px`);
        /* Chrome (input bar, dock, menu) gets stronger blur for Control Center frosted look */
        root.style.setProperty("--synthesis-chrome-blur", `${Math.min(48, baseBlurPx + 8)}px`);
        root.style.setProperty("--synthesis-glass-outline-opacity", String(settings.glassOutlineOpacity / 100));
        root.style.setProperty("--synthesis-glass-shadow-strength", String(settings.glassShadowStrength / 100));
        root.style.setProperty("--synthesis-font-scale", String(fontScaleBySize[settings.systemFontSize] ?? 1));

        /* Window surface: single radius for all cards/panels (Finder/Settings style) */
        root.style.setProperty("--synthesis-window-radius", `${Math.max(0, Math.min(32, settings.cardCornerRadius))}px`);

        // Glass Style (Clear vs Tinted)
        root.setAttribute("data-glass-style", settings.glassStyle);

        // Icon Style
        root.setAttribute("data-icon-style", settings.iconStyle || "default");

        // Scrollbar Visibility
        root.setAttribute("data-scrollbar", settings.scrollbarVisibility);

        // Accent Color logic
        const category = settings.theme; // determined by previous effect
        const accentVars = generateAccentVariables(settings.accentColor, category);
        Object.entries(accentVars).forEach(([key, val]) => {
            root.style.setProperty(key, val);
        });

    }, [
        settings.blurIntensity,
        settings.glassOpacity,
        settings.glassSaturation,
        settings.glassOutlineOpacity,
        settings.glassShadowStrength,
        settings.cardCornerRadius,
        settings.systemFontSize,
        settings.accentColor,
        settings.glassStyle,
        settings.theme,
        isHydrated,
    ]);

    const updateSetting = useCallback(<K extends keyof SynthesisSettings>(key: K, value: SynthesisSettings[K]) => {
        const normalized = normalizeStoredSettings({ [key]: value } as Partial<SynthesisSettings>);
        setSettings((prev) => ({ ...prev, ...normalized }));
    }, []);

    const updateSettings = useCallback((partial: Partial<SynthesisSettings>) => {
        const normalized = normalizeStoredSettings(partial);
        setSettings((prev) => ({ ...prev, ...normalized }));
    }, []);

    const resetSettings = useCallback(() => {
        setSettings(DEFAULT_SETTINGS);
    }, []);

    const exportSettings = useCallback((): string => {
        return JSON.stringify(settings, null, 2);
    }, [settings]);

    const importSettings = useCallback((json: string): boolean => {
        try {
            const parsed = normalizeStoredSettings(JSON.parse(json) as Partial<SynthesisSettings>);
            setSettings((prev) => ({ ...prev, ...parsed }));
            return true;
        } catch {
            return false;
        }
    }, []);

    const value = useMemo<SettingsContextType>(
        () => ({
            settings,
            updateSetting,
            updateSettings,
            resetSettings,
            exportSettings,
            importSettings,
        }),
        [settings, updateSetting, updateSettings, resetSettings, exportSettings, importSettings],
    );

    return (
        <SettingsContext.Provider value={value}>
            {bootStage !== "complete" ? (
                <BootScreen message={bootStage === "sync" ? "Synchronizing Settings..." : "Initializing Synthesis Profile..."} />
            ) : (
                children
            )}
        </SettingsContext.Provider>
    );
}

export function useSettings(): SettingsContextType {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error("useSettings must be used within a SettingsProvider");
    }
    return context;
}
