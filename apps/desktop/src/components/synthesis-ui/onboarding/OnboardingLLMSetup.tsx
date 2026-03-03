"use client";

import { useState, useEffect, useCallback } from "react";
import { Orbit } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { fetchModels } from "@/lib/client/modelsClient";
import type { SynthesisSettings } from "@/types/settings";
import { hasValidLLMConnection } from "@/lib/onboarding/hasValidLLM";

const PROVIDER_OPTIONS = [
    { label: "Ollama (Local)", value: "ollama" },
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Groq", value: "groq" },
    { label: "Gemini", value: "gemini" },
];

function getRecommendedTokens(model: string, provider: string): number {
    const id = model.toLowerCase();
    if (provider === "openai") {
        if (id.includes("o1") || id.includes("o3")) return 16384;
        return 4096;
    }
    return 4096;
}

function hasCredentials(provider: string, settings: SynthesisSettings): boolean {
    if (provider === "ollama") {
        return !!(settings.ollamaEndpoint?.trim());
    }
    const key = provider === "openai" ? settings.openaiApiKey
        : provider === "anthropic" ? settings.anthropicApiKey
            : provider === "groq" ? settings.groqApiKey
                : settings.geminiApiKey;
    return !!(key?.trim() && !key.includes("dummy"));
}

export function OnboardingLLMSetup({ onValid }: { onValid?: (valid: boolean) => void }) {
    const { settings, updateSetting } = useSettings();
    const [models, setModels] = useState<{ label: string; value: string }[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const provider = settings.aiProvider;
    const apiKeyField = provider === "openai" ? "openaiApiKey"
        : provider === "anthropic" ? "anthropicApiKey"
            : provider === "groq" ? "groqApiKey"
                : provider === "gemini" ? "geminiApiKey"
                    : null;
    const currentApiKey = apiKeyField ? settings[apiKeyField] : "";
    const hasCreds = hasCredentials(provider, settings);

    const loadModels = useCallback(async () => {
        if (!hasCreds) return;
        setIsLoading(true);
        setFetchError(null);
        try {
            const apiKey = provider === "openai" ? settings.openaiApiKey
                : provider === "anthropic" ? settings.anthropicApiKey
                    : provider === "groq" ? settings.groqApiKey
                        : provider === "gemini" ? settings.geminiApiKey
                            : undefined;
            const data = await fetchModels(
                provider,
                apiKey || undefined,
                provider === "ollama" ? settings.ollamaEndpoint : undefined,
            );
            if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                setModels(data.models);
                const first = data.models[0].value;
                if (first) {
                    updateSetting("aiModel", first);
                    updateSetting("kernelMainModel", `${provider}:${first}`);
                    const mini = data.models.find(m => m.value.toLowerCase().includes("mini") || m.value.toLowerCase().includes("haiku"));
                    updateSetting("kernelExtractorModel", `${provider}:${mini?.value || first}`);
                    updateSetting("kernelReflectionModel", `${provider}:${first}`);
                    updateSetting("maxTokens", getRecommendedTokens(first, provider));
                }
            } else {
                setModels([]);
                setFetchError(data?.error || "No models were found");
            }
        } catch (err) {
            setModels([]);
            setFetchError(err instanceof Error ? err.message : "Error loading models");
        } finally {
            setIsLoading(false);
        }
    }, [provider, hasCreds, settings.openaiApiKey, settings.anthropicApiKey, settings.groqApiKey, settings.geminiApiKey, settings.ollamaEndpoint, updateSetting]);

    useEffect(() => {
        if (!hasCreds) {
            setModels([]);
            setFetchError(null);
            return;
        }
        void loadModels();
    }, [hasCreds, provider]);

    const modelFromKernel = (k: string) => {
        if (!k?.trim()) return models[0]?.value ?? "";
        return k.includes(":") ? k.split(":")[1] : k;
    };

    const setKernelModel = (key: "kernelMainModel" | "kernelExtractorModel" | "kernelReflectionModel", modelValue: string) => {
        const val = modelValue ? `${provider}:${modelValue}` : "";
        updateSetting(key, val);
        if (key === "kernelMainModel") {
            updateSetting("aiModel", modelValue);
            updateSetting("maxTokens", getRecommendedTokens(modelValue, provider));
        }
    };

    const valid = hasValidLLMConnection(settings) && models.length > 0;
    useEffect(() => {
        onValid?.(valid);
    }, [valid, onValid]);

    return (
        <div className="space-y-5">
            <p className="text-sm text-white/55 leading-relaxed">
                First enter your API key to load the available models.
            </p>

            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-medium text-white/70 mb-1.5">AI provider</label>
                    <select
                        value={provider}
                        onChange={(e) => {
                            const v = e.target.value as SynthesisSettings["aiProvider"];
                            updateSetting("aiProvider", v);
                            setModels([]);
                            setFetchError(null);
                        }}
                        className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20"
                    >
                        {PROVIDER_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value} className="bg-[#0f1419] text-white">
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                {apiKeyField && (
                    <div>
                        <label className="block text-xs font-medium text-white/70 mb-1.5">API Key</label>
                        <input
                            type="password"
                            value={currentApiKey}
                            onChange={(e) => {
                                updateSetting(apiKeyField, e.target.value);
                                setModels([]);
                                setFetchError(null);
                            }}
                            placeholder="sk-..."
                            className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 bg-white/5 border border-white/10 outline-none focus:border-blue-400/50 font-mono"
                        />
                    </div>
                )}

                {provider === "ollama" && (
                    <div>
                        <label className="block text-xs font-medium text-white/70 mb-1.5">Ollama endpoint</label>
                        <input
                            type="text"
                            value={settings.ollamaEndpoint}
                            onChange={(e) => {
                                updateSetting("ollamaEndpoint", e.target.value);
                                setModels([]);
                                setFetchError(null);
                            }}
                            placeholder="http://127.0.0.1:11434"
                            className="w-full px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 bg-white/5 border border-white/10 outline-none focus:border-blue-400/50 font-mono"
                        />
                    </div>
                )}

                {hasCreds && isLoading && (
                    <p className="text-sm text-white/50 flex items-center gap-2">
                        <Orbit size={16} className="animate-spin" />
                        Loading available models...
                    </p>
                )}

                {fetchError && (
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-red-400">{fetchError}</p>
                        <button
                            type="button"
                            onClick={() => void loadModels()}
                            className="text-xs text-white/60 hover:text-white"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {models.length > 0 && (
                    <>
                        <div>
                            <label className="block text-xs font-medium text-white/70 mb-1.5">Primary model (agent)</label>
                            <p className="text-[10px] text-white/40 mb-1">The main intelligence that executes tasks and selects tools.</p>
                            <select
                                value={modelFromKernel(settings.kernelMainModel || settings.aiModel)}
                                onChange={(e) => setKernelModel("kernelMainModel", e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-blue-400/50"
                            >
                                {models.map((opt) => (
                                    <option key={opt.value} value={opt.value} className="bg-[#0f1419] text-white">
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-white/70 mb-1.5">Extractor model (memory)</label>
                            <p className="text-[10px] text-white/40 mb-1">Extracts personal data from conversations. Recommended: a fast, cost‑effective model.</p>
                            <select
                                value={modelFromKernel(settings.kernelExtractorModel)}
                                onChange={(e) => setKernelModel("kernelExtractorModel", e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-blue-400/50"
                            >
                                {models.map((opt) => (
                                    <option key={opt.value} value={opt.value} className="bg-[#0f1419] text-white">
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-white/70 mb-1.5">Consolidation model (cron)</label>
                            <p className="text-[10px] text-white/40 mb-1">Consolidates memory fragments in the background. Recommended: a model with strong context length.</p>
                            <select
                                value={modelFromKernel(settings.kernelReflectionModel || "")}
                                onChange={(e) => setKernelModel("kernelReflectionModel", e.target.value)}
                                className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 outline-none focus:border-blue-400/50"
                            >
                                {models.map((opt) => (
                                    <option key={opt.value} value={opt.value} className="bg-[#0f1419] text-white">
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
