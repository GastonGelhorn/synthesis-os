"use client";

import { useState, useEffect, useCallback } from "react";
import { Orbit } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { fetchModels } from "@/lib/client/modelsClient";
import { cn } from "@/lib/utils";
import type { SynthesisSettings } from "@/types/settings";
import { SettingRow, Slider, Select, Toggle } from "./SettingsPrimitives";

export default function AISection() {
    const { settings, updateSetting } = useSettings();
    const [dynamicModels, setDynamicModels] = useState<Record<string, { label: string; value: string }[]>>({});
    const [isLoading, setIsLoading] = useState(false);

    const refreshModels = useCallback(async (provider: string) => {
        setIsLoading(true);
        const apiKey = provider === "openai" ? settings.openaiApiKey
            : provider === "anthropic" ? settings.anthropicApiKey
                : provider === "groq" ? settings.groqApiKey
                    : undefined;

        try {
            const data = await fetchModels(
                provider,
                apiKey || undefined,
                provider === "ollama" ? settings.ollamaEndpoint : undefined,
            );
            if (data.models && Array.isArray(data.models)) {
                setDynamicModels(prev => ({ ...prev, [provider]: data.models }));
            }
            if (data.error) {
                console.warn(`Model fetch warning for ${provider}:`, data.error);
            }
        } catch (err) {
            console.error(`Failed to fetch ${provider} models:`, err);
        } finally {
            setIsLoading(false);
        }
    }, [settings.openaiApiKey, settings.anthropicApiKey, settings.groqApiKey, settings.ollamaEndpoint]);

    useEffect(() => {
        if (!dynamicModels[settings.aiProvider]) {
            refreshModels(settings.aiProvider);
        }
    }, [settings.aiProvider, dynamicModels, refreshModels]);

    const PROVIDER_MODELS: Record<string, { label: string; value: string }[]> = {
        ollama: dynamicModels.ollama || [
            { label: "Loading...", value: "" },
            { label: "llama3.2:latest", value: "llama3.2:latest" },
        ],
        openai: dynamicModels.openai || [
            { label: "GPT-4o", value: "gpt-4o" },
            { label: "GPT-5 Mini", value: "gpt-5-mini" },
            { label: "GPT-4 Turbo", value: "gpt-4-turbo" },
            { label: "o3-mini", value: "o3-mini" },
        ],
        anthropic: [
            { label: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
            { label: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
            { label: "Claude Opus 4", value: "claude-opus-4-20250514" },
        ],
        groq: [
            { label: "Llama 3.3 70B", value: "llama-3.3-70b-versatile" },
            { label: "Llama 3.1 8B", value: "llama-3.1-8b-instant" },
            { label: "Mixtral 8x7B", value: "mixtral-8x7b-32768" },
        ],
    };

    const getRecommendedTokens = (model: string, provider: string): number => {
        const id = model.toLowerCase();
        if (provider === "openai") {
            if (id.includes("o1") || id.includes("o3")) return 16384;
            if (id.includes("gpt-4o")) return 4096;
            if (id.includes("gpt-4")) return 4096;
            return 4096;
        }
        if (provider === "anthropic") {
            if (id.includes("opus")) return 4096;
            if (id.includes("sonnet")) return 4096;
            return 4096;
        }
        return 4096;
    };

    const models = PROVIDER_MODELS[settings.aiProvider] || PROVIDER_MODELS.ollama;
    const apiKeyField = settings.aiProvider === "openai" ? "openaiApiKey"
        : settings.aiProvider === "anthropic" ? "anthropicApiKey"
            : settings.aiProvider === "groq" ? "groqApiKey"
                : null;
    const currentApiKey = apiKeyField ? settings[apiKeyField] : "";

    return (
        <div>
            <SettingRow label="AI Provider" description="The inference backend used for synthesis">
                <Select value={settings.aiProvider} onChange={(v) => {
                    updateSetting("aiProvider", v as SynthesisSettings["aiProvider"]);
                    let newModel = "";
                    if (dynamicModels[v] && dynamicModels[v].length > 0) {
                        newModel = dynamicModels[v][0].value;
                    } else if (v !== "ollama" && PROVIDER_MODELS[v]?.length > 0) {
                        newModel = PROVIDER_MODELS[v][0].value;
                    }
                    if (newModel) {
                        updateSetting("aiModel", newModel);
                        updateSetting("maxTokens", getRecommendedTokens(newModel, v));
                    }
                }} options={[
                    { label: "Ollama (Local)", value: "ollama" },
                    { label: "OpenAI", value: "openai" },
                    { label: "Anthropic", value: "anthropic" },
                    { label: "Groq", value: "groq" },
                ]} />
            </SettingRow>
            <SettingRow label="Model" description="Primary model used for generating synthesis results">
                <div className="flex items-center gap-2">
                    <Select value={settings.aiModel} onChange={(v) => {
                        updateSetting("aiModel", v);
                        updateSetting("maxTokens", getRecommendedTokens(v, settings.aiProvider));
                    }} options={models} />
                    <button
                        onClick={() => refreshModels(settings.aiProvider)}
                        disabled={isLoading}
                        className={cn(
                            "p-1 hover:bg-white/10 rounded-md transition-all active:scale-95",
                            isLoading && "animate-spin opacity-50"
                        )}
                        title="Refresh Models"
                    >
                        <Orbit size={14} className="text-theme-muted" />
                    </button>
                </div>
            </SettingRow>
            {apiKeyField && (
                <SettingRow label="API Key" description={`Your ${settings.aiProvider} API key. Stored in app data (Tauri) only, not in browser storage.`}>
                    <input
                        type="password"
                        value={currentApiKey}
                        onChange={(e) => updateSetting(apiKeyField, e.target.value)}
                        placeholder="sk-..."
                        className="bg-theme-surface border-theme text-theme-secondary border rounded-lg px-3 py-1.5 text-[11px] outline-none w-44 font-mono focus:border-theme"
                    />
                </SettingRow>
            )}
            <SettingRow label="Temperature" description={`Controls creativity vs. precision (${settings.temperature / 100})`}>
                <div className="w-32">
                    <Slider value={settings.temperature} onChange={(v) => updateSetting("temperature", v)} color="#a78bfa" />
                </div>
            </SettingRow>
            <SettingRow label="Max Tokens" description="Maximum output length per synthesis">
                <Select value={String(settings.maxTokens)} onChange={(v) => updateSetting("maxTokens", Number(v))} options={[
                    { label: "2048", value: "2048" },
                    { label: "4096", value: "4096" },
                    { label: "8192", value: "8192" },
                    { label: "16384", value: "16384" },
                    { label: "400000", value: "400000" },
                ]} />
            </SettingRow>
            <SettingRow label="Stream Responses" description="Show results as they generate in real-time">
                <Toggle enabled={settings.streamResponses} onChange={(v) => updateSetting("streamResponses", v)} />
            </SettingRow>
            {settings.aiProvider === "ollama" && (
                <SettingRow label="Ollama Endpoint" description="URL of your local Ollama server">
                    <input
                        type="text"
                        value={settings.ollamaEndpoint}
                        onChange={(e) => updateSetting("ollamaEndpoint", e.target.value)}
                        className="bg-theme-surface border-theme text-theme-secondary border rounded-lg px-3 py-1.5 text-[11px] outline-none w-44 font-mono focus:border-theme"
                    />
                </SettingRow>
            )}
        </div>
    );
}
