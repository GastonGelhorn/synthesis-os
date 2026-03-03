import type { SynthesisSettings } from "@/types/settings";

export interface SynthesisTheme {
    id: string;
    name: string;
    category: "light" | "dark";
    colors: {
        bg: string;
        bgSecondary: string;
        glass: string;
        glassBorder: string;
        text: string;
        textSecondary: string;
        textMuted: string;
        accent: string;
        accentGlow: string;
        surface: string;
        surfaceHover: string;
        danger: string;
        warning: string;
        success: string;
    };
}

export type ThemeAppearancePreset = Pick<
    SynthesisSettings,
    | "backgroundPreset"
    | "accentSource"
    | "customAccentColor"
    | "glassTint"
    | "glassTintColor"
    | "glassMaterial"
    | "blurIntensity"
    | "glassSaturation"
    | "glassOpacity"
    | "glassOutlineOpacity"
    | "glassShadowStrength"
    | "noiseGrain"
    | "textVibrancy"
    | "textShadowStrength"
    | "cardCornerRadius"
    | "starField"
    | "backgroundOverlay"
>;

/** Only theme "personality" (background, accent, tint). Applied on theme change; glass sliders stay user-controlled. */
export type ThemePersonalityPreset = Pick<
    SynthesisSettings,
    | "backgroundPreset"
    | "accentSource"
    | "customAccentColor"
    | "glassTint"
    | "glassTintColor"
    | "cardCornerRadius"
    | "starField"
    | "backgroundOverlay"
>;

export const THEMES: Record<string, SynthesisTheme> = {
    dark: {
        id: "dark",
        name: "Dark",
        category: "dark",
        colors: {
            // macOS Tahoe dark: grayish, not pure black
            bg: "#1c1c1e",
            bgSecondary: "#2c2c2e",
            glass: "rgba(44,44,46,0.55)",
            glassBorder: "rgba(255,255,255,0.1)",
            text: "#F5F5F7",
            textSecondary: "rgba(245,245,247,0.7)",
            textMuted: "rgba(245,245,247,0.4)",
            accent: "#007AFF",
            accentGlow: "rgba(0,122,255,0.25)",
            surface: "rgba(255,255,255,0.05)",
            surfaceHover: "rgba(255,255,255,0.1)",
            danger: "#FF453A",
            warning: "#FF9F0A",
            success: "#32D74B",
        },
    },
    light: {
        id: "light",
        name: "Light",
        category: "light",
        colors: {
            // macOS Tahoe light: warm white, frosted
            bg: "#F5F5F7",
            bgSecondary: "#FFFFFF",
            glass: "rgba(255,255,255,0.65)",
            glassBorder: "rgba(0,0,0,0.06)",
            text: "#1D1D1F",
            textSecondary: "rgba(29,29,31,0.65)",
            textMuted: "rgba(29,29,31,0.38)",
            accent: "#007AFF",
            accentGlow: "rgba(0,122,255,0.18)",
            surface: "rgba(0,0,0,0.025)",
            surfaceHover: "rgba(0,0,0,0.05)",
            danger: "#FF3B30",
            warning: "#FF9500",
            success: "#28CD41",
        },
    },
};

/**
 * Generates semantic accent variables from a single seed color.
 */
export function generateAccentVariables(color: string, category: "light" | "dark") {
    const parsed = parseColor(color);
    const alpha = category === "light" ? 0.2 : 0.3;
    const hoverAlpha = category === "light" ? 0.3 : 0.4;

    return {
        "--synthesis-accent": color,
        "--synthesis-accent-rgb": `${parsed.r}, ${parsed.g}, ${parsed.b}`,
        "--synthesis-accent-glow": `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`,
        "--synthesis-accent-hover": `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${hoverAlpha})`,
    };
}

export const LEGACY_THEMES: Record<string, SynthesisTheme> = {
    midnight: {
        id: "midnight",
        name: "Midnight Glass",
        category: "dark",
        colors: {
            bg: "#070b18",
            bgSecondary: "#11182f",
            glass: "rgba(255,255,255,0.06)",
            glassBorder: "rgba(255,255,255,0.14)",
            text: "#f5f8ff",
            textSecondary: "rgba(227,236,255,0.8)",
            textMuted: "rgba(188,203,236,0.56)",
            accent: "#63a4ff",
            accentGlow: "rgba(99,164,255,0.33)",
            surface: "rgba(255,255,255,0.05)",
            surfaceHover: "rgba(255,255,255,0.11)",
            danger: "#ff5f6d",
            warning: "#f6b73c",
            success: "#29cc7a",
        },
    },
    light: {
        id: "light",
        name: "Silk Light",
        category: "light",
        colors: {
            bg: "#edf1f8",
            bgSecondary: "#f8faff",
            glass: "rgba(255,255,255,0.55)",
            glassBorder: "rgba(15,23,42,0.12)",
            text: "#0f172a",
            textSecondary: "rgba(15,23,42,0.78)",
            textMuted: "rgba(15,23,42,0.52)",
            accent: "#2f7ef7",
            accentGlow: "rgba(47,126,247,0.24)",
            surface: "rgba(255,255,255,0.5)",
            surfaceHover: "rgba(255,255,255,0.65)",
            danger: "#d93036",
            warning: "#cc7a00",
            success: "#0f9f5f",
        },
    },
    nord: {
        id: "nord",
        name: "Arctic Slate",
        category: "dark",
        colors: {
            bg: "#1f2636",
            bgSecondary: "#2b354d",
            glass: "rgba(224,232,245,0.06)",
            glassBorder: "rgba(224,232,245,0.14)",
            text: "#f0f4ff",
            textSecondary: "#dce4f8",
            textMuted: "#a8b8d0",
            accent: "#7bc4d6",
            accentGlow: "rgba(123,196,214,0.3)",
            surface: "rgba(224,232,245,0.05)",
            surfaceHover: "rgba(224,232,245,0.11)",
            danger: "#e1737f",
            warning: "#f1c26f",
            success: "#9ed08f",
        },
    },
    monokai: {
        id: "monokai",
        name: "Electric Noir",
        category: "dark",
        colors: {
            bg: "#171917",
            bgSecondary: "#1f231f",
            glass: "rgba(245,248,236,0.05)",
            glassBorder: "rgba(245,248,236,0.13)",
            text: "#f8fceb",
            textSecondary: "#dce4c8",
            textMuted: "#a8b892",
            accent: "#b7f34f",
            accentGlow: "rgba(183,243,79,0.3)",
            surface: "rgba(245,248,236,0.04)",
            surfaceHover: "rgba(245,248,236,0.1)",
            danger: "#ff4f8b",
            warning: "#ffd05b",
            success: "#79dc7b",
        },
    },
    dracula: {
        id: "dracula",
        name: "Violet Night",
        category: "dark",
        colors: {
            bg: "#221b33",
            bgSecondary: "#2d2344",
            glass: "rgba(243,236,255,0.06)",
            glassBorder: "rgba(243,236,255,0.14)",
            text: "#f6f1ff",
            textSecondary: "#d8c6ff",
            textMuted: "#a591d0",
            accent: "#c89bff",
            accentGlow: "rgba(200,155,255,0.32)",
            surface: "rgba(243,236,255,0.05)",
            surfaceHover: "rgba(243,236,255,0.11)",
            danger: "#ff6b7f",
            warning: "#f8d879",
            success: "#68e4ad",
        },
    },
    catppuccin: {
        id: "catppuccin",
        name: "Mocha Bloom",
        category: "dark",
        colors: {
            bg: "#2b2134",
            bgSecondary: "#372a41",
            glass: "rgba(240,221,255,0.06)",
            glassBorder: "rgba(240,221,255,0.14)",
            text: "#f6ebff",
            textSecondary: "#ddc4ed",
            textMuted: "#b89bc8",
            accent: "#f4a5ff",
            accentGlow: "rgba(244,165,255,0.3)",
            surface: "rgba(240,221,255,0.05)",
            surfaceHover: "rgba(240,221,255,0.11)",
            danger: "#ff89ab",
            warning: "#ffc58a",
            success: "#9fe5c7",
        },
    },
    solarizedDark: {
        id: "solarizedDark",
        name: "Deep Lagoon",
        category: "dark",
        colors: {
            bg: "#022a35",
            bgSecondary: "#0b3a48",
            glass: "rgba(186,222,220,0.06)",
            glassBorder: "rgba(186,222,220,0.14)",
            text: "#e2f5f2",
            textSecondary: "#bddad6",
            textMuted: "#9eb8b6",
            accent: "#2da6d8",
            accentGlow: "rgba(45,166,216,0.33)",
            surface: "rgba(186,222,220,0.05)",
            surfaceHover: "rgba(186,222,220,0.1)",
            danger: "#ff6b62",
            warning: "#ffca4d",
            success: "#4fd18d",
        },
    },
    solarizedLight: {
        id: "solarizedLight",
        name: "Parchment",
        category: "light",
        colors: {
            bg: "#f8f2e2",
            bgSecondary: "#fbf6ea",
            glass: "rgba(253,246,227,0.6)",
            glassBorder: "rgba(88,110,117,0.18)",
            text: "#2c3a42",
            textSecondary: "rgba(44,58,66,0.8)",
            textMuted: "rgba(44,58,66,0.55)",
            accent: "#2c88cc",
            accentGlow: "rgba(44,136,204,0.25)",
            surface: "rgba(253,246,227,0.55)",
            surfaceHover: "rgba(253,246,227,0.7)",
            danger: "#c94f4a",
            warning: "#b48420",
            success: "#5a9a45",
        },
    },
    rosePine: {
        id: "rosePine",
        name: "Rose Dusk",
        category: "dark",
        colors: {
            bg: "#241a2e",
            bgSecondary: "#30203b",
            glass: "rgba(235,221,247,0.06)",
            glassBorder: "rgba(235,221,247,0.14)",
            text: "#f6ecfc",
            textSecondary: "#dac4e8",
            textMuted: "#b59bc4",
            accent: "#d8a6ec",
            accentGlow: "rgba(216,166,236,0.3)",
            surface: "rgba(235,221,247,0.05)",
            surfaceHover: "rgba(235,221,247,0.11)",
            danger: "#f37e9f",
            warning: "#ffc188",
            success: "#8fd2c9",
        },
    },
    obsidianSunset: {
        id: "obsidianSunset",
        name: "Obsidian Sunset",
        category: "dark",
        colors: {
            bg: "#1b1413",
            bgSecondary: "#2a1b1a",
            glass: "rgba(255,230,216,0.06)",
            glassBorder: "rgba(255,230,216,0.14)",
            text: "#fff4ee",
            textSecondary: "#eccfc1",
            textMuted: "#c59f8d",
            accent: "#ff875c",
            accentGlow: "rgba(255,135,92,0.33)",
            surface: "rgba(255,230,216,0.05)",
            surfaceHover: "rgba(255,230,216,0.11)",
            danger: "#ff6c70",
            warning: "#ffbe67",
            success: "#68cd94",
        },
    },
    mintGlass: {
        id: "mintGlass",
        name: "Mint Glass",
        category: "light",
        colors: {
            bg: "#e7f3ef",
            bgSecondary: "#f2fbf8",
            glass: "rgba(255,255,255,0.6)",
            glassBorder: "rgba(16,61,49,0.14)",
            text: "#0d281f",
            textSecondary: "rgba(13,40,31,0.78)",
            textMuted: "rgba(13,40,31,0.52)",
            accent: "#1f9f82",
            accentGlow: "rgba(31,159,130,0.24)",
            surface: "rgba(255,255,255,0.55)",
            surfaceHover: "rgba(255,255,255,0.7)",
            danger: "#cf4f5a",
            warning: "#c98a14",
            success: "#1f9963",
        },
    },
    graphite: {
        id: "graphite",
        name: "Graphite",
        category: "dark",
        colors: {
            bg: "#111317",
            bgSecondary: "#1a1e24",
            glass: "rgba(234,238,246,0.06)",
            glassBorder: "rgba(234,238,246,0.13)",
            text: "#f4f7fc",
            textSecondary: "#d4dceb",
            textMuted: "#a8b2c4",
            accent: "#78a6ff",
            accentGlow: "rgba(120,166,255,0.3)",
            surface: "rgba(234,238,246,0.05)",
            surfaceHover: "rgba(234,238,246,0.1)",
            danger: "#f06a75",
            warning: "#f6ba5a",
            success: "#63ca89",
        },
    },
};

export const THEME_LIST = [THEMES.dark, THEMES.light];

const THEME_APPEARANCE_PRESETS: Record<string, ThemeAppearancePreset> = {
    dark: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#63a4ff",
        glassTint: true,
        glassTintColor: "#7aa9ff",
        glassMaterial: "regular",
        blurIntensity: 65,
        glassSaturation: 125,
        glassOpacity: 55,
        glassOutlineOpacity: 16,
        glassShadowStrength: 60,
        noiseGrain: 4,
        textVibrancy: 30,
        textShadowStrength: 0,
        cardCornerRadius: 18,
        starField: true,
        backgroundOverlay: true,
    },
    light: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#2f7ef7",
        glassTint: true,
        glassTintColor: "#95b9ff",
        glassMaterial: "thin",
        blurIntensity: 55,
        glassSaturation: 110,
        glassOpacity: 50,
        glassOutlineOpacity: 14,
        glassShadowStrength: 45,
        noiseGrain: 3,
        textVibrancy: 25,
        textShadowStrength: 0,
        cardCornerRadius: 18,
        starField: false,
        backgroundOverlay: true,
    },
    nord: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#7bc4d6",
        glassTint: true,
        glassTintColor: "#89d2da",
        glassMaterial: "regular",
        blurIntensity: 72,
        glassSaturation: 126,
        glassOpacity: 74,
        glassOutlineOpacity: 22,
        glassShadowStrength: 80,
        noiseGrain: 8,
        textVibrancy: 36,
        textShadowStrength: 0,
        cardCornerRadius: 14,
        starField: true,
        backgroundOverlay: true,
    },
    monokai: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#b7f34f",
        glassTint: true,
        glassTintColor: "#b7f34f",
        glassMaterial: "thin",
        blurIntensity: 62,
        glassSaturation: 152,
        glassOpacity: 68,
        glassOutlineOpacity: 24,
        glassShadowStrength: 76,
        noiseGrain: 10,
        textVibrancy: 52,
        textShadowStrength: 6,
        cardCornerRadius: 12,
        starField: false,
        backgroundOverlay: true,
    },
    dracula: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#c89bff",
        glassTint: true,
        glassTintColor: "#d7b1ff",
        glassMaterial: "regular",
        blurIntensity: 78,
        glassSaturation: 140,
        glassOpacity: 76,
        glassOutlineOpacity: 22,
        glassShadowStrength: 88,
        noiseGrain: 5,
        textVibrancy: 48,
        textShadowStrength: 10,
        cardCornerRadius: 18,
        starField: true,
        backgroundOverlay: true,
    },
    catppuccin: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#f4a5ff",
        glassTint: true,
        glassTintColor: "#f4a5ff",
        glassMaterial: "thick",
        blurIntensity: 84,
        glassSaturation: 148,
        glassOpacity: 78,
        glassOutlineOpacity: 24,
        glassShadowStrength: 84,
        noiseGrain: 7,
        textVibrancy: 50,
        textShadowStrength: 8,
        cardCornerRadius: 20,
        starField: true,
        backgroundOverlay: true,
    },
    solarizedDark: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#2da6d8",
        glassTint: true,
        glassTintColor: "#56b9dd",
        glassMaterial: "regular",
        blurIntensity: 70,
        glassSaturation: 122,
        glassOpacity: 70,
        glassOutlineOpacity: 20,
        glassShadowStrength: 78,
        noiseGrain: 6,
        textVibrancy: 34,
        textShadowStrength: 0,
        cardCornerRadius: 14,
        starField: true,
        backgroundOverlay: true,
    },
    solarizedLight: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#2c88cc",
        glassTint: true,
        glassTintColor: "#78aecd",
        glassMaterial: "thin",
        blurIntensity: 50,
        glassSaturation: 105,
        glassOpacity: 62,
        glassOutlineOpacity: 16,
        glassShadowStrength: 58,
        noiseGrain: 10,
        textVibrancy: 28,
        textShadowStrength: 0,
        cardCornerRadius: 10,
        starField: false,
        backgroundOverlay: true,
    },
    rosePine: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#d8a6ec",
        glassTint: true,
        glassTintColor: "#e0b6f1",
        glassMaterial: "regular",
        blurIntensity: 80,
        glassSaturation: 138,
        glassOpacity: 76,
        glassOutlineOpacity: 22,
        glassShadowStrength: 86,
        noiseGrain: 6,
        textVibrancy: 46,
        textShadowStrength: 8,
        cardCornerRadius: 18,
        starField: true,
        backgroundOverlay: true,
    },
    obsidianSunset: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#ff875c",
        glassTint: true,
        glassTintColor: "#ff9f74",
        glassMaterial: "thick",
        blurIntensity: 82,
        glassSaturation: 136,
        glassOpacity: 74,
        glassOutlineOpacity: 24,
        glassShadowStrength: 88,
        noiseGrain: 8,
        textVibrancy: 44,
        textShadowStrength: 6,
        cardCornerRadius: 16,
        starField: false,
        backgroundOverlay: true,
    },
    mintGlass: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#1f9f82",
        glassTint: true,
        glassTintColor: "#74d1bc",
        glassMaterial: "thin",
        blurIntensity: 54,
        glassSaturation: 114,
        glassOpacity: 66,
        glassOutlineOpacity: 18,
        glassShadowStrength: 62,
        noiseGrain: 4,
        textVibrancy: 32,
        textShadowStrength: 0,
        cardCornerRadius: 14,
        starField: false,
        backgroundOverlay: true,
    },
    graphite: {
        backgroundPreset: "sequoia-sunrise",
        accentSource: "custom",
        customAccentColor: "#78a6ff",
        glassTint: true,
        glassTintColor: "#8aa9df",
        glassMaterial: "regular",
        blurIntensity: 68,
        glassSaturation: 118,
        glassOpacity: 70,
        glassOutlineOpacity: 20,
        glassShadowStrength: 82,
        noiseGrain: 7,
        textVibrancy: 30,
        textShadowStrength: 0,
        cardCornerRadius: 12,
        starField: true,
        backgroundOverlay: true,
    },
};

export function getThemeAppearancePreset(id: string): ThemeAppearancePreset {
    return THEME_APPEARANCE_PRESETS[id] ?? THEME_APPEARANCE_PRESETS.dark;
}

const THEME_PERSONALITY_KEYS: (keyof ThemePersonalityPreset)[] = [
    "backgroundPreset", "accentSource", "customAccentColor", "glassTint", "glassTintColor",
    "cardCornerRadius", "starField", "backgroundOverlay",
];

export function getThemePersonalityPreset(id: string): ThemePersonalityPreset {
    const full = getThemeAppearancePreset(id);
    return THEME_PERSONALITY_KEYS.reduce((acc, k) => ({ ...acc, [k]: full[k] }), {} as ThemePersonalityPreset);
}

type ParsedColor = { r: number; g: number; b: number; a: number };

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function clampAlpha(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function parseColor(value: string): ParsedColor {
    const input = value.trim();

    if (input.startsWith("#")) {
        const hex = input.slice(1);
        if (hex.length === 3) {
            return {
                r: clampByte(parseInt(hex[0] + hex[0], 16)),
                g: clampByte(parseInt(hex[1] + hex[1], 16)),
                b: clampByte(parseInt(hex[2] + hex[2], 16)),
                a: 1,
            };
        }
        if (hex.length === 6 || hex.length === 8) {
            return {
                r: clampByte(parseInt(hex.slice(0, 2), 16)),
                g: clampByte(parseInt(hex.slice(2, 4), 16)),
                b: clampByte(parseInt(hex.slice(4, 6), 16)),
                a: hex.length === 8 ? clampAlpha(parseInt(hex.slice(6, 8), 16) / 255) : 1,
            };
        }
    }

    const rgbMatch = input.match(/^rgba?\((.+)\)$/i);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(",").map((part) => part.trim());
        if (parts.length >= 3) {
            const r = clampByte(Number(parts[0]));
            const g = clampByte(Number(parts[1]));
            const b = clampByte(Number(parts[2]));
            const a = parts.length >= 4 ? clampAlpha(Number(parts[3])) : 1;
            return { r, g, b, a };
        }
    }

    return { r: 255, g: 255, b: 255, a: 1 };
}

export function getTheme(id: string): SynthesisTheme {
    return THEMES[id] || THEMES.dark;
}

/**
 * Apply theme by setting only data-theme and data-theme-category.
 * All color variables are defined in globals.css per [data-theme-category].
 * Accent is set separately from SettingsContext (user accent color).
 */
export function applyThemeToDocument(theme: SynthesisTheme) {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme.id);
    root.setAttribute("data-theme-category", theme.category);
}
