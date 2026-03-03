export type SynthesisBackgroundKind = "dynamic" | "image" | "video";
export type SynthesisBackgroundCategory = "dynamic" | "landscape" | "cityscape" | "underwater" | "abstract";

export interface SynthesisBackgroundPreset {
    id: string;
    label: string;
    kind: SynthesisBackgroundKind;
    category: SynthesisBackgroundCategory;
    preview: string;
    base: string;
    pattern?: string;
    mediaUrl?: string;
    posterUrl?: string;
}

const W = "/wallpapers";

export const SYNTHESIS_DEFAULT_WALLPAPER = `${W}/landscape/08-valley.jpg`;

export const SYNTHESIS_BACKGROUND_PRESETS: SynthesisBackgroundPreset[] = [
    // ── Landscape (10) ──
    { id: "synthesis-default", label: "Synthesis OS", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #1e3a8a, #3b82f6)", base: "#0f172a", mediaUrl: SYNTHESIS_DEFAULT_WALLPAPER },
    { id: "sequoia-sunrise", label: "Sequoia Sunrise", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #2d3a1a, #4a5d23)", base: "#1a240f", mediaUrl: `${W}/landscape/01-sequoia.jpg` },
    { id: "tahoe-day", label: "Tahoe Day", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #0ea5e9, #38bdf8)", base: "#075985", mediaUrl: `${W}/landscape/02-tahoe.jpg` },
    { id: "sonoma-horizon", label: "Sonoma Horizon", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #4d7c0f, #65a30d)", base: "#365314", mediaUrl: `${W}/landscape/03-sonoma.jpg` },
    { id: "goa-beaches", label: "Goa Beaches", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #0d9488, #2dd4bf)", base: "#134e4a", mediaUrl: `${W}/landscape/04-goa.jpg` },
    { id: "mountain-dawn", label: "Mountain Dawn", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #1e3a5f, #f59e0b)", base: "#78350f", mediaUrl: `${W}/landscape/05-mountain-dawn.jpg` },
    { id: "forest-mist", label: "Forest Mist", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #334155, #475569)", base: "#1e293b", mediaUrl: `${W}/landscape/06-forest.jpg` },
    { id: "alps", label: "Alps", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #e2e8f0, #94a3b8)", base: "#475569", mediaUrl: `${W}/landscape/07-alps.jpg` },
    { id: "valley", label: "Valley", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #4d7c0f, #65a30d)", base: "#365314", mediaUrl: `${W}/landscape/08-valley.jpg` },
    { id: "beach-sunset", label: "Beach Sunset", kind: "image", category: "landscape", preview: "linear-gradient(135deg, #0d9488, #fbbf24)", base: "#134e4a", mediaUrl: `${W}/landscape/09-beach.jpg` },

    // ── Cityscape (9) ──
    { id: "dubai-skyline", label: "Dubai Skyline", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #475569, #64748b)", base: "#1e293b", mediaUrl: `${W}/cityscape/01-dubai.jpg` },
    { id: "la-overpass", label: "LA Overpass", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #334155, #475569)", base: "#0f172a", mediaUrl: `${W}/cityscape/02-la.jpg` },
    { id: "london-evening", label: "London Evening", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #1e3a8a, #1d4ed8)", base: "#172554", mediaUrl: `${W}/cityscape/03-london.jpg` },
    { id: "ny-night", label: "NY Night", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #1e1b4b, #312e81)", base: "#0c0a09", mediaUrl: `${W}/cityscape/04-ny-night.jpg` },
    { id: "city-lights", label: "City Lights", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #111827, #1e1b4b)", base: "#0f172a", mediaUrl: `${W}/cityscape/05-city-lights.jpg` },
    { id: "skyscraper", label: "Skyscraper", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #334155, #64748b)", base: "#1e293b", mediaUrl: `${W}/cityscape/06-skyscraper.jpg` },
    { id: "skyline", label: "Skyline", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #1e293b, #475569)", base: "#0f172a", mediaUrl: `${W}/cityscape/07-skyline.jpg` },
    { id: "city-night", label: "City Night", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #1e1b4b, #312e81)", base: "#0c0a09", mediaUrl: `${W}/cityscape/08-city-night.jpg` },
    { id: "tokyo", label: "Tokyo", kind: "image", category: "cityscape", preview: "linear-gradient(135deg, #475569, #64748b)", base: "#1e293b", mediaUrl: `${W}/cityscape/09-tokyo.jpg` },

    // ── Underwater (9) ──
    { id: "coral-reef", label: "Coral Reef", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0891b2, #06b6d4)", base: "#164e63", mediaUrl: `${W}/underwater/01-coral.jpg` },
    { id: "deep-blue", label: "Deep Blue", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #1e40af, #1d4ed8)", base: "#172554", mediaUrl: `${W}/underwater/02-deep-blue.jpg` },
    { id: "kelp-forest", label: "Kelp Forest", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #065f46, #059669)", base: "#064e3b", mediaUrl: `${W}/underwater/03-kelp.jpg` },
    { id: "ocean", label: "Ocean", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0e7490, #22d3ee)", base: "#164e63", mediaUrl: `${W}/underwater/04-ocean.jpg` },
    { id: "reef", label: "Reef", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0891b2, #06b6d4)", base: "#164e63", mediaUrl: `${W}/underwater/05-reef.jpg` },
    { id: "underwater", label: "Underwater", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #1e40af, #06b6d4)", base: "#172554", mediaUrl: `${W}/underwater/06-underwater.jpg` },
    { id: "sea-life", label: "Sea Life", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0891b2, #22d3ee)", base: "#164e63", mediaUrl: `${W}/underwater/07-sea-life.jpg` },
    { id: "tropical-water", label: "Tropical Water", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0d9488, #2dd4bf)", base: "#134e4a", mediaUrl: `${W}/underwater/08-tropical.jpg` },
    { id: "water", label: "Water", kind: "image", category: "underwater", preview: "linear-gradient(135deg, #0e7490, #06b6d4)", base: "#164e63", mediaUrl: `${W}/underwater/09-water.jpg` },

    // ── Abstract (9) ──
    { id: "gradient-abstract", label: "Gradient", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #6366f1, #8b5cf6)", base: "#312e81", mediaUrl: `${W}/abstract/01-gradient.jpg` },
    { id: "blur-abstract", label: "Blur", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #64748b, #94a3b8)", base: "#475569", mediaUrl: `${W}/abstract/02-blur.jpg` },
    { id: "mesh-abstract", label: "Mesh", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #6366f1, #a855f7)", base: "#4c1d95", mediaUrl: `${W}/abstract/03-mesh.jpg` },
    { id: "pastel-abstract", label: "Pastel", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #f0abfc, #c084fc)", base: "#701a75", mediaUrl: `${W}/abstract/04-pastel.jpg` },
    { id: "abstract-art", label: "Abstract Art", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #818cf8, #c084fc)", base: "#4338ca", mediaUrl: `${W}/abstract/05-abstract.jpg` },
    { id: "aurora-abstract", label: "Aurora", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #0f172a, #1e3a8a)", base: "#0c0a09", mediaUrl: `${W}/abstract/06-aurora.jpg` },
    { id: "geometry-abstract", label: "Geometry", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #334155, #64748b)", base: "#1e293b", mediaUrl: `${W}/abstract/07-geometry.jpg` },
    { id: "wave-abstract", label: "Wave", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #06b6d4, #3b82f6)", base: "#0e7490", mediaUrl: `${W}/abstract/08-wave.jpg` },
    { id: "soft-abstract", label: "Soft", kind: "image", category: "abstract", preview: "linear-gradient(135deg, #e0e7ff, #c7d2fe)", base: "#4338ca", mediaUrl: `${W}/abstract/09-soft.jpg` },
];

export const SYNTHESIS_BACKGROUND_PRESET_BY_ID: Record<string, SynthesisBackgroundPreset> = Object.fromEntries(
    SYNTHESIS_BACKGROUND_PRESETS.map((preset) => [preset.id, preset]),
);
