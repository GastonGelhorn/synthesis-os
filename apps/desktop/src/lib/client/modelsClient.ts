/**
 * Client-side model fetcher.
 *
 * Replaces /api/models server route.
 * Fetches available models directly from Ollama or OpenAI APIs.
 */

export interface ModelOption {
    label: string;
    value: string;
}

const OPENAI_DEFAULT_MODELS: ModelOption[] = [
    { label: "GPT-4o", value: "gpt-4o" },
    { label: "GPT-5 Mini", value: "gpt-5-mini" },
    { label: "GPT-4 Turbo", value: "gpt-4-turbo" },
    { label: "o3-mini", value: "o3-mini" },
];

/**
 * Fetch available models from the given provider.
 * Works entirely client-side — no server proxy needed.
 */
export async function fetchModels(
    provider: string,
    apiKey?: string,
    ollamaEndpoint?: string,
): Promise<{ models: ModelOption[]; error?: string }> {
    try {
        if (provider === "openai") {
            if (!apiKey || apiKey === "sk-dummy-key-for-local-testing") {
                return { models: OPENAI_DEFAULT_MODELS };
            }

            const response = await fetch("https://api.openai.com/v1/models", {
                headers: { Authorization: `Bearer ${apiKey}` },
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                return {
                    models: OPENAI_DEFAULT_MODELS,
                    error: (err as any)?.error?.message || `OpenAI API error: ${response.status}`,
                };
            }

            const data = await response.json();

            const toolCapablePrefixes = ["gpt-", "o1", "o3"];
            const excludedKeywords = [
                "vision", "instruct", "embedding", "dall-e",
                "whisper", "tts", "audit", "moderation", "search",
            ];

            const models: ModelOption[] = (data.data || [])
                .filter((m: any) => {
                    const id = m.id.toLowerCase();
                    const hasValidPrefix = toolCapablePrefixes.some((p) => id.startsWith(p));
                    const hasExcludedKeyword = excludedKeywords.some((k) => id.includes(k));
                    return hasValidPrefix && !hasExcludedKeyword;
                })
                .map((m: any) => ({ label: m.id, value: m.id }))
                .sort((a: ModelOption, b: ModelOption) => a.label.localeCompare(b.label));

            return { models };
        }

        if (provider === "anthropic") {
            // Anthropic doesn't have a public model listing endpoint
            return {
                models: [
                    { label: "Claude 3.5 Sonnet", value: "claude-3-5-sonnet-20241022" },
                    { label: "Claude 3.5 Haiku", value: "claude-3-5-haiku-20241022" },
                    { label: "Claude 3 Opus", value: "claude-3-opus-20240229" },
                ],
            };
        }

        if (provider === "groq") {
            return {
                models: [
                    { label: "Llama 3 70B", value: "llama3-70b-8192" },
                    { label: "Llama 3 8B", value: "llama3-8b-8192" },
                    { label: "Mixtral 8x7B", value: "mixtral-8x7b-32768" },
                    { label: "Gemma 7B", value: "gemma-7b-it" },
                ],
            };
        }

        if (provider === "gemini") {
            return {
                models: [
                    { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
                    { label: "Gemini 1.5 Pro", value: "gemini-1.5-pro" },
                    { label: "Gemini 1.5 Flash", value: "gemini-1.5-flash" },
                    { label: "Gemini 1.0 Pro", value: "gemini-pro" },
                ],
            };
        }

        // Default: Ollama
        const ollamaUrl = ollamaEndpoint || "http://127.0.0.1:11434";
        const response = await fetch(`${ollamaUrl}/api/tags`);

        if (!response.ok) {
            console.error("Failed to fetch models from Ollama:", response.statusText);
            return { models: [], error: "Failed to connect to Ollama" };
        }

        const data = await response.json();
        const models: ModelOption[] = (data.models || []).map((m: any) => ({
            label: m.name,
            value: m.name,
        }));

        return { models };
    } catch (error) {
        console.error("Error fetching models:", error);
        return { models: [], error: "Could not fetch models" };
    }
}

const PROVIDER_LABELS: Record<string, string> = {
    ollama: "Ollama",
    openai: "OpenAI",
    anthropic: "Anthropic",
    groq: "Groq",
    gemini: "Gemini",
};

export interface ConnectedModelsInput {
    ollamaEndpoint?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    groqApiKey?: string;
    geminiApiKey?: string;
}

/**
 * Fetches models from all connected APIs (Ollama, OpenAI, Anthropic, Groq).
 * Returns a combined list with value "provider:modelId" for per-agent selection.
 */
export async function fetchAllConnectedModels(input: ConnectedModelsInput): Promise<{ label: string; value: string }[]> {
    const results: { label: string; value: string }[] = [];
    const providers: Array<{ key: string; connected: boolean; apiKey?: string }> = [
        { key: "ollama", connected: !!input.ollamaEndpoint?.trim() },
        {
            key: "openai",
            connected: !!(
                input.openaiApiKey &&
                input.openaiApiKey.trim() &&
                !input.openaiApiKey.includes("dummy")
            ),
            apiKey: input.openaiApiKey,
        },
        {
            key: "anthropic",
            connected: !!(input.anthropicApiKey && input.anthropicApiKey.trim()),
            apiKey: input.anthropicApiKey,
        },
        {
            key: "groq",
            connected: !!(input.groqApiKey && input.groqApiKey.trim()),
            apiKey: input.groqApiKey,
        },
        {
            key: "gemini",
            connected: !!(input.geminiApiKey && input.geminiApiKey.trim()),
            apiKey: input.geminiApiKey,
        },
    ];

    await Promise.all(
        providers.map(async (p) => {
            if (!p.connected) return;
            const { models, error } = await fetchModels(
                p.key,
                p.apiKey,
                input.ollamaEndpoint,
            );
            if (error) return;
            const prefix = PROVIDER_LABELS[p.key] || p.key;
            models.forEach((m) => {
                results.push({
                    label: `${prefix} · ${m.label}`,
                    value: `${p.key}:${m.value}`,
                });
            });
        }),
    );

    return results;
}
