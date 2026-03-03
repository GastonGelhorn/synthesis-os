import type { SynthesisSettings } from "@/types/settings";

/** Returns true if the user has at least one valid LLM connection configured. */
export function hasValidLLMConnection(settings: SynthesisSettings): boolean {
    const provider = settings.aiProvider;
    if (provider === "ollama") {
        const ep = settings.ollamaEndpoint?.trim();
        return !!ep && ep.length > 0;
    }
    if (provider === "openai") {
        const key = settings.openaiApiKey?.trim();
        return !!key && !key.includes("dummy");
    }
    if (provider === "anthropic") {
        return !!(settings.anthropicApiKey?.trim());
    }
    if (provider === "groq") {
        return !!(settings.groqApiKey?.trim());
    }
    if (provider === "gemini") {
        return !!(settings.geminiApiKey?.trim());
    }
    return false;
}
