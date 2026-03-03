/**
 * User profile context — persistent user context for agent personalization.
 * Auto-detects locale, timezone, language on first run.
 * Stored in localStorage (web) or Tauri store.
 */

export interface UserProfile {
    locale: string;       // e.g. "es-ES"
    timezone: string;     // e.g. "Europe/Madrid"
    country: string;      // e.g. "Spain"
    language: string;     // e.g. "Spanish"
    name: string;         // e.g. "Gaston"
    /** Key facts learned from conversations */
    facts: string[];
}

const STORAGE_KEY = "synthesis_user_profile";

/** Detect defaults from browser/system */
function detectDefaults(): UserProfile {
    const locale = typeof navigator !== "undefined"
        ? navigator.language || "en-US"
        : "en-US";

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    // Map locale → country / language
    const langMap: Record<string, { country: string; language: string }> = {
        "es": { country: "España", language: "Spanish" },
        "en": { country: "United States", language: "English" },
        "fr": { country: "France", language: "French" },
        "de": { country: "Germany", language: "German" },
        "pt": { country: "Portugal", language: "Portuguese" },
        "it": { country: "Italy", language: "Italian" },
        "ja": { country: "Japan", language: "Japanese" },
        "zh": { country: "China", language: "Chinese" },
        "ko": { country: "Korea", language: "Korean" },
    };

    // Also try timezone → country refinement
    const tzCountryMap: Record<string, string> = {
        "Europe/Madrid": "España",
        "Europe/London": "United Kingdom",
        "Europe/Paris": "France",
        "Europe/Berlin": "Germany",
        "America/New_York": "United States",
        "America/Los_Angeles": "United States",
        "America/Chicago": "United States",
        "America/Mexico_City": "México",
        "America/Buenos_Aires": "Argentina",
        "America/Bogota": "Colombia",
        "America/Lima": "Perú",
        "America/Santiago": "Chile",
        "Asia/Tokyo": "Japan",
    };

    const langCode = locale.split("-")[0];
    const detected = langMap[langCode] || { country: "Unknown", language: "English" };

    // Timezone-based country takes priority (more specific)
    const tzCountry = tzCountryMap[tz];
    if (tzCountry) detected.country = tzCountry;

    return {
        locale,
        timezone: tz,
        country: detected.country,
        language: detected.language,
        name: "",
        facts: [],
    };
}

/** Load profile from storage, or create defaults */
export function loadUserProfile(): UserProfile {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored) as Partial<UserProfile>;
            // Merge with defaults to pick up new fields
            return { ...detectDefaults(), ...parsed };
        }
    } catch { /* ignore parse errors */ }

    const defaults = detectDefaults();
    saveUserProfile(defaults);
    return defaults;
}

/** Save profile to storage */
export function saveUserProfile(profile: UserProfile): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch { /* ignore quota errors */ }
}

/** Add a learned fact (deduplicates) */
export function addUserFact(fact: string): void {
    const profile = loadUserProfile();
    if (!profile.facts.includes(fact)) {
        profile.facts.push(fact);
        if (profile.facts.length > 20) profile.facts.shift(); // cap at 20
        saveUserProfile(profile);
    }
}

/** Format user context for injection into agent prompts */
export function formatUserContext(profile: UserProfile): string {
    const parts: string[] = [
        `Location: ${profile.country}`,
        `Timezone: ${profile.timezone}`,
        `Language: ${profile.language}`,
        `Locale: ${profile.locale}`,
    ];
    if (profile.name) parts.push(`Name: ${profile.name}`);
    if (profile.facts.length > 0) {
        parts.push(`Known facts: ${profile.facts.join("; ")}`);
    }
    return parts.join("\n");
}
