"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from "react";
import { motion, AnimatePresence, useMotionValue, useDragControls } from "framer-motion";
import {
    Activity,
    Users,
    Plus,
    Trash2,
    Check,
    Edit3,
    ArrowLeft,
    Search,
    Brain,
    Palette,
    Laptop,
    Layers,
    LayoutGrid,
    Sparkles,
    Shield,
    Globe,
    Database,
    Zap,
    Monitor,
    Volume2,
    Bell,
    Bot,
    Wrench,
    Keyboard,
    User,
    Server,
    ShieldAlert,
    Cpu,
    Terminal,
    Orbit,
    ChevronRight,
    ChevronDown,
    X,
    Minus,
    Maximize2,
    Minimize2,
    Clapperboard,
    Image,
    Sun,
    Moon,
    Droplets,
    MessageSquare,
} from "lucide-react";
import { SynthesisNode, SpaceId, type ConversationMessage } from "@/types/synthesis";
import { DEFAULT_SETTINGS, type SynthesisSettings } from "@/types/settings";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import type { ApiUser } from "@/lib/apiClient";
import { useProfile } from "@/context/ProfileContext";
import { useNodesStore } from "@/stores/nodesStore";
import { clearStateFromIDB, clearAllTasksFromIDB, isIndexedDBAvailable, loadStateFromIDB } from "@/lib/storage";
import { confirmDialog } from "@/lib/confirmDialog";
import { THEME_LIST, type SynthesisTheme } from "@/lib/themes";
import { SYNTHESIS_BACKGROUND_PRESETS } from "@/lib/backgrounds";
import { cn } from "@/lib/utils";
import { fetchModels, fetchAllConnectedModels } from "@/lib/client/modelsClient";
import { getMetrics } from "@/lib/agent/metrics";
import type { AgentMetrics } from "@/lib/agent/types";
import { SectionSkeleton } from "./settings/SectionSkeleton";
import { ProfileSelector } from "./ProfileSelector";
import { FIRST_RUN_SETUP_SESSION_KEY } from "./FirstRunSetupStep1";

const LazyAISection = React.lazy(() => import("./settings/AISection"));

/* ─── Types ─── */
interface SettingsSection {
    id: string;
    label: string;
    icon: React.ReactNode;
    color: string;
}

interface SettingsViewProps {
    isOpen: boolean;
    onClose: () => void;
    initialSectionId?: string;
    spaceId: SpaceId;
    nodes?: SynthesisNode[];
    onCloseNode?: (id: string) => void;
    onActivateNode?: (id: string) => void;
    onCleanupStuckNodes?: () => void;
    onCloseAllSpaceNodes?: (spaceId: SpaceId) => void;
}

/* ─── Settings Sections ─── */
const SECTIONS: SettingsSection[] = [
    { id: "ai", label: "AI Engine", icon: <Brain size={16} />, color: "#a78bfa" },
    { id: "appearance", label: "Appearance", icon: <Palette size={16} />, color: "#60a5fa" },
    { id: "desktop", label: "Desktop", icon: <Laptop size={16} />, color: "#10b981" },
    { id: "spaces", label: "Spaces", icon: <Layers size={16} />, color: "#34d399" },
    { id: "nodes", label: "Node Manager", icon: <LayoutGrid size={16} />, color: "#38bdf8" },
    { id: "synthesis", label: "Synthesis", icon: <Sparkles size={16} />, color: "#fbbf24" },
    { id: "privacy", label: "Privacy & Data", icon: <Shield size={16} />, color: "#f472b6" },
    { id: "network", label: "Network", icon: <Globe size={16} />, color: "#22d3ee" },
    { id: "storage", label: "Storage", icon: <Database size={16} />, color: "#fb923c" },
    { id: "memory", label: "Data & Memory", icon: <Cpu size={16} />, color: "#f472b6" },
    { id: "performance", label: "Performance", icon: <Zap size={16} />, color: "#84cc16" },
    { id: "display", label: "Display", icon: <Monitor size={16} />, color: "#818cf8" },
    { id: "audio", label: "Audio", icon: <Volume2 size={16} />, color: "#e879f9" },
    { id: "notifications", label: "Notifications", icon: <Bell size={16} />, color: "#f87171" },
    { id: "agent", label: "Agent Loop", icon: <Bot size={16} />, color: "#a78bfa" },
    { id: "agents", label: "Agent Personas", icon: <Users size={16} />, color: "#818cf8" },
    { id: "tools", label: "System Tools", icon: <Wrench size={16} />, color: "#f59e0b" },
    { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} />, color: "#94a3b8" },
    { id: "account", label: "Account", icon: <User size={16} />, color: "#67e8f9" },
    { id: "users", label: "Users", icon: <Users size={16} />, color: "#8b5cf6" },
    { id: "kernel", label: "Kernel & Metrics", icon: <Activity size={16} />, color: "#ef4444" },
    { id: "advanced", label: "Advanced", icon: <Server size={16} />, color: "#6b7280" },
];

const APPEARANCE_TINTS = ["#ffffff", "#3b82f6", "#a855f7", "#10b981", "#f43f5e", "#f59e0b"];
const APPEARANCE_ACCENTS = ["#3b82f6", "#6366f1", "#a855f7", "#f43f5e", "#ef4444", "#f59e0b", "#22c55e", "#38bdf8"];
const GLASS_MATERIALS: Array<{ id: "thin" | "regular" | "thick"; label: string }> = [
    { id: "thin", label: "Thin" },
    { id: "regular", label: "Regular" },
    { id: "thick", label: "Thick" },
];
const SYSTEM_FONT_SIZES: Array<{ id: "x-small" | "small" | "medium" | "large" | "x-large"; label: string }> = [
    { id: "x-small", label: "XS" },
    { id: "small", label: "S" },
    { id: "medium", label: "M" },
    { id: "large", label: "L" },
    { id: "x-large", label: "XL" },
];

/* ─── Toggle Switch ─── */
function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!enabled)}
            className="group relative w-10 h-[22px] rounded-full transition-all duration-300 ring-offset-2 focus:ring-2 ring-theme/20 outline-none"
            style={{
                background: enabled ? "var(--synthesis-accent)" : "rgba(255,255,255,0.08)",
                boxShadow: enabled ? "0 0 10px var(--synthesis-accent-glow)" : "inset 0 1px 2px rgba(0,0,0,0.2)",
            }}
        >
            <motion.div
                animate={{ x: enabled ? 20 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-md border-0.5 border-black/5"
            />
        </button>
    );
}

/* ─── Slider ─── */
function Slider({
    value,
    onChange,
    min = 0,
    max = 100,
    color = "var(--synthesis-accent)",
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    color?: string;
}) {
    const pct = ((value - min) / (max - min)) * 100;
    return (
        <div className="relative w-full h-1.5 rounded-full bg-theme-muted group/slider">
            <div
                className="absolute top-0 left-0 h-full rounded-full"
                style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}dd)`
                }}
            />
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md border border-black/5 pointer-events-none transition-transform group-hover/slider:scale-110 active:scale-95"
                style={{
                    left: `calc(${pct}% - 8px)`,
                }}
            />
        </div>
    );
}

/* ─── Select ─── */
function Select({ value, options, onChange }: { value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
    const safeOptions = Array.isArray(options) ? options : [];
    return (
        <div className="relative group/select">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="bg-theme-surface border border-theme text-theme rounded-lg px-3 pr-8 py-1.5 text-[11px] font-medium outline-none transition-all cursor-pointer appearance-none hover:bg-theme-surface-hover hover:border-theme-secondary focus:ring-2 focus:ring-theme/20"
            >
                {safeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-theme-surface text-theme">
                        {opt.label}
                    </option>
                ))}
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-theme-muted group-hover/select:text-theme transition-colors">
                <ChevronDown size={10} />
            </div>
        </div>
    );
}

/* ─── Setting Row ─── */
function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
        <div className={`flex items-center justify-between py-3 border-b border-theme last:border-0`}>
            <div className="flex-1 pr-4">
                <p className={`text-[12px] text-theme font-medium`}>{label}</p>
                {description && (
                    <p className={`text-[10px] text-theme-muted mt-0.5 leading-relaxed`}>{description}</p>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

/* ─── Agents Section ─── */
interface AgentConfig {
    id: string;
    name: string;
    description: string;
    avatar?: string;
    model?: string;
    tools: string[];
    system_prompt?: string;
}

const AVATAR_PRESETS = [
    "https://api.dicebear.com/7.x/bottts/svg?seed=Felix",
    "https://api.dicebear.com/7.x/bottts/svg?seed=Aria",
    "https://api.dicebear.com/7.x/bottts/svg?seed=Max",
    "https://api.dicebear.com/7.x/bottts/svg?seed=Nova",
    "https://api.dicebear.com/7.x/bottts/svg?seed=Echo",
    "https://api.dicebear.com/7.x/bottts/svg?seed=Zane",
];

function GeneralAgentSection({ settings, updateSetting }: { settings: SynthesisSettings; updateSetting: <K extends keyof SynthesisSettings>(key: K, value: SynthesisSettings[K]) => void }) {
    return (
        <div className="space-y-6">
            <SettingRow label="Agent Mode" description="Enable the single-agent ReAct loop with dynamic tool selection. The agent uses Tool RAG to pick relevant tools per query, executes actions, and synthesizes results via A2UI streaming.">
                <Toggle enabled={settings.agentMode} onChange={(v) => updateSetting("agentMode", v)} />
            </SettingRow>
            <SettingRow label="Max Steps" description="Maximum number of tool calls per agent task (1-20)">
                <div className="flex items-center gap-3">
                    <input
                        type="range"
                        min={1}
                        max={20}
                        value={settings.agentMaxSteps}
                        onChange={(e) => updateSetting("agentMaxSteps", Number(e.target.value))}
                        className="w-20 accent-purple-400"
                    />
                    <span className="text-[11px] text-theme-muted font-mono w-6 text-right">{settings.agentMaxSteps}</span>
                </div>
            </SettingRow>
            <SettingRow label="Timeout" description="Maximum time for an agent task in seconds (30-300)">
                <div className="flex items-center gap-3">
                    <input
                        type="range"
                        min={30}
                        max={300}
                        step={10}
                        value={settings.agentTimeout}
                        onChange={(e) => updateSetting("agentTimeout", Number(e.target.value))}
                        className="w-20 accent-purple-400"
                    />
                    <span className="text-[11px] text-theme-muted font-mono w-8 text-right">{settings.agentTimeout}s</span>
                </div>
            </SettingRow>
            <SettingRow label="Require Approval" description="Always require user approval before executing any tool (more control, slower)">
                <Toggle enabled={settings.agentApprovalRequired} onChange={(v) => updateSetting("agentApprovalRequired", v)} />
            </SettingRow>

            {/* ── Rendering ── */}
            <div className="pt-2 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted/60">Rendering</span>
            </div>
            <SettingRow label="A2UI Protocol" description="Responses use A2UI v0.8 JSONL streaming for progressive generative UI. Components render in real-time as the agent streams tokens.">
                <span className="text-[10px] font-mono text-emerald-400/80">Always On</span>
            </SettingRow>

            {/* ── Tool RAG ── */}
            <div className="pt-2 pb-1">
                <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted/60">Tool RAG</span>
            </div>
            <SettingRow label="Semantic Tool Retrieval" description="Use vector search to dynamically select relevant tools per query instead of giving the agent all tools. Reduces noise and improves accuracy.">
                <Toggle enabled={settings.toolRagEnabled ?? true} onChange={(v) => updateSetting("toolRagEnabled", v)} />
            </SettingRow>
            {(settings.toolRagEnabled ?? true) && (
                <SettingRow label="Top-K Tools" description="Number of tools retrieved per query via semantic search (4-24). Higher = more tools available but slower.">
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min={4}
                            max={24}
                            value={settings.toolRagTopK ?? 12}
                            onChange={(e) => updateSetting("toolRagTopK", Number(e.target.value))}
                            className="w-20 accent-purple-400"
                        />
                        <span className="text-[11px] text-theme-muted font-mono w-6 text-right">{settings.toolRagTopK ?? 12}</span>
                    </div>
                </SettingRow>
            )}
        </div>
    );
}

/** Normalize stored agent model for selector: "provider:id" or legacy "id" -> "provider:id". */
function agentModelValue(agentModel: string | undefined, fallback: string): string {
    if (!agentModel?.trim()) return fallback;
    if (agentModel.includes(":")) return agentModel;
    return `openai:${agentModel}`;
}

/** Value to show in model Select: must be one of options or first option. */
function selectableModelValue(agentModel: string | undefined, options: { value: string }[], fallback: string): string {
    const normalized = agentModelValue(agentModel, fallback);
    const exists = options.some((o) => o.value === normalized);
    return exists ? normalized : (options[0]?.value ?? fallback);
}

function AgentsSection() {
    const { settings, updateSetting } = useSettings();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [allTools, setAllTools] = useState<Array<{ function?: { name?: string; description?: string } }>>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [agentModelOptions, setAgentModelOptions] = useState<{ label: string; value: string }[]>([]);

    const agents: AgentConfig[] = Array.isArray(settings.agents) ? settings.agents : [];

    useEffect(() => {
        const fetchTools = async () => {
            try {
                const { kernelInvoke } = await import("@/lib/apiClient");
                const tools = await kernelInvoke<unknown>("get_all_tools");
                const list = Array.isArray(tools)
                    ? tools
                    : (tools && typeof tools === "object" && Array.isArray((tools as { tools?: unknown[] }).tools))
                        ? (tools as { tools: unknown[] }).tools
                        : [];
                setAllTools(list as Array<{ function?: { name?: string; description?: string } }>);
            } catch (err) {
                console.error("Failed to fetch tools:", err);
            }
        };
        fetchTools();
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchAllConnectedModels({
            ollamaEndpoint: settings.ollamaEndpoint,
            openaiApiKey: settings.openaiApiKey,
            anthropicApiKey: settings.anthropicApiKey,
            groqApiKey: settings.groqApiKey,
        }).then((opts) => {
            if (!cancelled) {
                setAgentModelOptions(opts.length > 0 ? opts : [
                    { label: "OpenAI · gpt-4o (add API key to see models)", value: "openai:gpt-4o" },
                    { label: "OpenAI · gpt-5-mini", value: "openai:gpt-5-mini" },
                ]);
            }
        });
        return () => { cancelled = true; };
    }, [settings.ollamaEndpoint, settings.openaiApiKey, settings.anthropicApiKey, settings.groqApiKey]);

    const handleSaveAgent = (agent: AgentConfig) => {
        const existing = agents.findIndex(a => a.id === agent.id);
        const newAgents = [...agents];
        if (existing >= 0) {
            newAgents[existing] = agent;
        } else {
            newAgents.push(agent);
        }
        updateSetting("agents", newAgents);
        setEditingId(null);
        setIsAdding(false);
    };

    const handleDeleteAgent = (id: string) => {
        updateSetting("agents", agents.filter(a => a.id !== id));
    };

    const editingAgent = editingId ? agents.find(a => a.id === editingId) : (isAdding ? {
        id: `agent_${Date.now()}`,
        name: "New Assistant",
        description: "Describe what this agent does...",
        tools: [],
        model: "gpt-5-mini",
        avatar: AVATAR_PRESETS[Math.floor(Math.random() * AVATAR_PRESETS.length)],
        system_prompt: "You are a helpful SynthesisOS specialist."
    } : null);

    if (editingAgent) {
        return (
            <AgentEditor
                agent={editingAgent as AgentConfig}
                onSave={handleSaveAgent}
                onCancel={() => { setEditingId(null); setIsAdding(false); }}
                allTools={allTools}
                modelOptions={agentModelOptions}
            />
        );
    }

    return (
        <div className="py-2 space-y-6">
            {/* ── Model Routing ── */}
            <div className="flex flex-col space-y-3 p-4 rounded-2xl bg-theme-surface border border-theme">
                <div className="pb-2 border-b border-theme/30 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-theme-accent">Global Model Routing</span>
                </div>
                <SettingRow label="Main Reasoning Model" description="The core intelligence that drives SynthesisOS and selects tools (e.g. gpt-5-mini, claude-3-5).">
                    <Select
                        value={selectableModelValue(settings.kernelMainModel, agentModelOptions, agentModelOptions[0]?.value ?? "openai:gpt-4o")}
                        options={agentModelOptions}
                        onChange={(v) => updateSetting("kernelMainModel", v)}
                    />
                </SettingRow>
                <SettingRow label="Background Extractor Model" description="Fast, low-cost model used implicitly to extract personal facts for memory.">
                    <Select
                        value={selectableModelValue(settings.kernelExtractorModel, agentModelOptions, agentModelOptions[0]?.value ?? "openai:gpt-4o-mini")}
                        options={agentModelOptions}
                        onChange={(v) => updateSetting("kernelExtractorModel", v)}
                    />
                </SettingRow>
                <SettingRow label="Deep Reflection Model" description="Large context model that periodically consolidates thousands of memory fragments.">
                    <Select
                        value={selectableModelValue(settings.kernelReflectionModel, agentModelOptions, agentModelOptions[0]?.value ?? "openai:gpt-5-mini")}
                        options={agentModelOptions}
                        onChange={(v) => updateSetting("kernelReflectionModel", v)}
                    />
                </SettingRow>
            </div>

            <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted/60 mb-1">Specialist Personas</span>
                    <p className="text-[11px] text-theme-muted">Context fragments for the single-agent loop. Tools are selected dynamically via Tool RAG.</p>
                    {agents.length === 0 && (
                        <p className="text-[10px] text-amber-400/80 mt-1">No personas configured. Use &quot;Seed Defaults&quot; to restore built-in presets.</p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            updateSetting("agents", DEFAULT_SETTINGS.agents);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme hover:bg-theme-muted transition-all flex items-center gap-2"
                    >
                        <Plus size={12} />
                        Seed Defaults
                    </button>
                    <button
                        onClick={() => setIsAdding(true)}
                        className="px-3 py-1.5 rounded-lg bg-theme-muted text-[10px] text-theme hover:bg-theme-surface transition-all flex items-center gap-2"
                    >
                        <Plus size={12} />
                        Add Persona
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
                {agents.map((agent) => (
                    <div
                        key={agent.id}
                        className="group flex items-center gap-4 p-4 rounded-2xl bg-theme-surface border border-theme hover:border-theme-secondary transition-all"
                    >
                        <div className="w-12 h-12 rounded-xl bg-theme-muted flex items-center justify-center overflow-hidden border border-theme p-1">
                            <img src={agent.avatar || AVATAR_PRESETS[0]} alt={agent.name} className="w-full h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <h3 className="text-[13px] font-semibold text-theme">{agent.name}</h3>
                                {agent.id === "manager" && (
                                    <span className="px-1.5 py-0.5 rounded-full bg-theme-accent/10 text-theme-accent text-[9px] font-bold uppercase tracking-wider border border-theme-accent/20">
                                        System
                                    </span>
                                )}
                            </div>
                            <p className="text-[11px] text-theme-muted line-clamp-1">{agent.description}</p>
                            <div className="flex items-center gap-3 mt-2">
                                <span className="px-2 py-0.5 rounded-full bg-theme-muted text-[9px] font-mono text-theme-secondary">
                                    {agent.tools.length} Tools Available
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                onClick={() => setEditingId(agent.id)}
                                className="p-2 rounded-lg hover:bg-theme-muted text-theme-muted hover:text-theme transition-colors"
                            >
                                <Edit3 size={14} />
                            </button>
                            {agent.id !== "manager" && (
                                <button
                                    onClick={() => handleDeleteAgent(agent.id)}
                                    className="p-2 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400 transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {agents.length === 0 && (
                    <div className="text-center py-12 border-2 border-dashed border-theme rounded-3xl">
                        <Users size={32} className="mx-auto text-theme-muted mb-3 opacity-20" />
                        <p className="text-[12px] text-theme-muted">No specialists hired yet.</p>
                        <button
                            onClick={() => setIsAdding(true)}
                            className="mt-4 text-[11px] text-theme-accent font-medium hover:underline"
                        >
                            Hire your first agent →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function AgentEditor({ agent, onSave, onCancel, allTools, modelOptions }: { agent: AgentConfig; onSave: (a: AgentConfig) => void; onCancel: () => void; allTools: Array<{ function?: { name?: string; description?: string } }>; modelOptions: { label: string; value: string }[] }) {
    const [draft, setDraft] = useState<AgentConfig>({ ...agent });
    const [searchTerm, setSearchTerm] = useState("");

    const filteredTools = allTools.filter(t =>
        (t.function?.name ?? "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.function?.description ?? "").toLowerCase().includes(searchTerm.toLowerCase())
    );

    const toggleTool = (name: string) => {
        if (draft.tools.includes(name)) {
            setDraft({ ...draft, tools: draft.tools.filter(t => t !== name) });
        } else {
            setDraft({ ...draft, tools: [...draft.tools, name] });
        }
    };

    return (
        <div className="py-2 space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <button onClick={onCancel} className="p-2 -ml-2 rounded-lg hover:bg-theme-muted text-theme-muted hover:text-theme">
                    <ArrowLeft size={16} />
                </button>
                <h3 className="text-[14px] font-semibold text-theme">Edit Specialist</h3>
            </div>

            <div className="flex gap-6">
                <div className="w-24 shrink-0 space-y-3">
                    <div className="w-24 h-24 rounded-2xl bg-theme-surface border border-theme p-2 flex items-center justify-center">
                        <img src={draft.avatar} alt="Avatar" className="w-full h-full object-contain" />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {AVATAR_PRESETS.map(p => (
                            <button
                                key={p}
                                onClick={() => setDraft({ ...draft, avatar: p })}
                                className={cn(
                                    "w-full aspect-square rounded-lg border p-1 transition-all hover:border-theme-accent",
                                    draft.avatar === p ? "border-theme-accent bg-theme-accent/10" : "border-theme bg-theme-surface"
                                )}
                            >
                                <img src={p} className="w-full h-full object-contain" />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-theme-muted font-bold">Name</label>
                        <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className="w-full bg-theme-surface border border-theme rounded-xl px-4 py-2 text-[12px] text-theme outline-none focus:border-theme-secondary transition-all"
                            placeholder="e.g. Researcher"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-theme-muted font-bold">Description</label>
                        <textarea
                            value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                            className="w-full bg-theme-surface border border-theme rounded-xl px-4 py-2 text-[11px] text-theme-secondary outline-none focus:border-theme-secondary transition-all resize-none h-16"
                            placeholder="Summarize the core responsibility (used for routing)..."
                        />
                    </div>
                </div>
            </div>



            <div className="space-y-1.5">
                <label className="text-[10px] uppercase tracking-wider text-theme-muted font-bold">Capabilities (System Prompt)</label>
                <p className="text-[9px] text-theme-muted">Edit below and click Save Changes to apply. Shown in full so you can review the whole prompt.</p>
                <textarea
                    value={draft.system_prompt}
                    onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                    className="w-full bg-theme-surface border border-theme rounded-xl px-4 py-3 text-[11px] text-theme-secondary outline-none focus:border-theme-secondary transition-all resize-y min-h-[320px] font-mono leading-relaxed"
                    placeholder="Instructions for the agent behavior..."
                    spellCheck={false}
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-wider text-theme-muted font-bold">Tool permissions</label>
                    <div className="relative">
                        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-theme-muted" />
                        <input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Find tool..."
                            className="pl-8 pr-3 py-1 bg-theme-muted rounded-full text-[10px] text-theme-secondary border-none outline-none w-32 focus:w-48 transition-all"
                        />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredTools.map((tool) => {
                        const toolName = tool.function?.name ?? "";
                        if (!toolName) return null;
                        const isEnabled = draft.tools.includes(toolName);
                        return (
                            <button
                                key={toolName}
                                onClick={() => toggleTool(toolName)}
                                className={cn(
                                    "flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all",
                                    isEnabled
                                        ? "bg-theme-accent/5 border-theme-accent/30 text-theme"
                                        : "bg-theme-surface border-theme text-theme-muted grayscale opacity-60 hover:grayscale-0 hover:opacity-100"
                                )}
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded mt-0.5 shrink-0 flex items-center justify-center border transition-all",
                                    isEnabled ? "bg-theme-accent border-theme-accent text-white" : "bg-theme-muted border-theme"
                                )}>
                                    {isEnabled && <Check size={10} strokeWidth={3} />}
                                </div>
                                <div>
                                    <p className="text-[10px] font-semibold leading-tight mb-0.5">{toolName}</p>
                                    <p className="text-[9px] text-theme-muted line-clamp-1">{tool.function?.description ?? ""}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-theme">
                <button
                    onClick={() => onSave(draft)}
                    className="flex-1 py-2.5 rounded-xl bg-theme-accent text-white text-[12px] font-bold hover:shadow-[0_0_15px_rgba(96,165,250,0.4)] transition-all"
                >
                    Save Changes
                </button>
                <button
                    onClick={onCancel}
                    className="px-6 py-2.5 rounded-xl bg-theme-muted text-theme-muted text-[12px] font-bold hover:text-theme transition-all"
                >
                    Discard
                </button>
            </div>
        </div>
    );
}

const SPACE_IDS: SpaceId[] = ["work", "entertainment", "research"];

const WORKSPACE_STORAGE_KEY_LEGACY = "synthesis-os-state.v3";

function getWorkspaceStorageKey(profileId: string | null): string {
    return profileId ? `synthesis-os-state.v3:${profileId}` : WORKSPACE_STORAGE_KEY_LEGACY;
}

function AccountPinRow() {
    const { profiles, activeProfileId, setProfilePin, clearProfilePin } = useProfile();
    const activeProfile = profiles.find((p) => p.id === activeProfileId);
    const hasPin = !!activeProfile?.passwordHash;

    const handleSetPin = async () => {
        if (!activeProfileId) return;
        const pin = window.prompt("Enter a 4-8 digit PIN:");
        if (!pin || pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
            if (pin !== null) alert("The PIN must be between 4 and 8 digits.");
            return;
        }
        const confirmPin = window.prompt("Confirm PIN:");
        if (pin !== confirmPin) {
            alert("PINs do not match.");
            return;
        }
        await setProfilePin(activeProfileId, pin);
    };

    const handleRemovePin = () => {
        if (!activeProfileId || !hasPin) return;
        if (window.confirm("Do you want to remove PIN protection from this profile?")) {
            clearProfilePin(activeProfileId);
        }
    };

    return (
        <SettingRow label="PIN del perfil" description="Protege el perfil con un PIN para desbloquear al iniciar">
            {hasPin ? (
                <button
                    type="button"
                    onClick={handleRemovePin}
                    className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 transition-all"
                >
                    Remove PIN
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => void handleSetPin()}
                    className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all"
                >
                    Set PIN
                </button>
            )}
        </SettingRow>
    );
}

/* ─── Data & Memory Section ─── */
function MemorySection() {
    const { settings, updateSetting } = useSettings();
    const { activeProfileId } = useProfile();
    const conversationHistory = useNodesStore((s) => s.conversationHistory);
    const nodes = useNodesStore((s) => s.nodes);
    const clearSpaceHistory = useNodesStore((s) => s.clearSpaceHistory);
    const clearNodeHistory = useNodesStore((s) => s.clearNodeHistory);
    const removeConversationMessage = useNodesStore((s) => s.removeConversationMessage);
    const setNodes = useNodesStore((s) => s.setNodes);
    const setEdges = useNodesStore((s) => s.setEdges);
    const setActiveNodeId = useNodesStore((s) => s.setActiveNodeId);
    const setTasks = useNodesStore((s) => s.setTasks);
    const setConversationHistory = useNodesStore((s) => s.setConversationHistory);
    const setOsConversationHistory = useNodesStore((s) => s.setOsConversationHistory);
    const [memories, setMemories] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const [agentFilter, setAgentFilter] = useState("all");
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [stats, setStats] = useState({ total: 0, agents: 0, oldest: "", newest: "" });
    const [expandedWorkspace, setExpandedWorkspace] = useState(true);
    const [expandedLanceDB, setExpandedLanceDB] = useState(false);
    const [chatSpaceFilter, setChatSpaceFilter] = useState<SpaceId>("work");
    const [chatSearchTerm, setChatSearchTerm] = useState("");
    const [chatRefreshLoading, setChatRefreshLoading] = useState(false);
    const [expandedChatNodes, setExpandedChatNodes] = useState<Set<string>>(new Set());

    const formatTimeMs = (ts: number) => {
        if (!ts) return "—";
        const d = new Date(ts);
        const now = Date.now();
        const diff = Math.floor((now - ts) / 1000);
        if (diff < 60) return "Just now";
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return d.toLocaleDateString();
    };

    const chatMessages = useMemo(() => conversationHistory[chatSpaceFilter] || [], [conversationHistory, chatSpaceFilter]);
    const totalChatCount = useMemo(() => SPACE_IDS.reduce((sum, id) => sum + (conversationHistory[id]?.length || 0), 0), [conversationHistory]);

    /** Group messages by nodeId; each entry has { msg, flatIndex } for removeConversationMessage */
    const groupedChatMessages = useMemo(() => {
        const raw = chatMessages;
        const q = chatSearchTerm.trim().toLowerCase();
        const filtered = q
            ? raw.map((m, i) => ({ msg: m, flatIndex: i })).filter(({ msg }) => (msg.content || "").toLowerCase().includes(q))
            : raw.map((m, i) => ({ msg: m, flatIndex: i }));
        const groups = new Map<string | null, Array<{ msg: ConversationMessage; flatIndex: number }>>();
        for (const { msg, flatIndex } of filtered) {
            const key = msg.nodeId ?? null;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push({ msg, flatIndex });
        }
        return groups;
    }, [chatMessages, chatSearchTerm]);

    const handleRefreshConversations = useCallback(async () => {
        setChatRefreshLoading(true);
        try {
            if (settings.dataPersistence === "local" && isIndexedDBAvailable()) {
                const state = await loadStateFromIDB(activeProfileId);
                if (state?.conversationHistory) {
                    setConversationHistory((prev) => ({ ...prev, ...state.conversationHistory }));
                }
            }
        } finally {
            setChatRefreshLoading(false);
        }
    }, [settings.dataPersistence, activeProfileId, setConversationHistory]);

    const toggleExpandedChatNode = useCallback((key: string) => {
        setExpandedChatNodes((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const handleDeleteCardCompletely = useCallback(async (nodeId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!(await confirmDialog("Delete this card and all its conversation history? This cannot be undone."))) return;
        setNodes((prev) => prev.filter((n) => n.id !== nodeId));
        setEdges((prev) => prev.filter((e) => e.sourceId !== nodeId && e.targetId !== nodeId));
        const current = useNodesStore.getState().activeNodeId;
        setActiveNodeId(current === nodeId ? null : current);
        clearNodeHistory(chatSpaceFilter, nodeId);
        setTasks((prev) => {
            const next = new Map(prev);
            for (const [tid, t] of next) if (t.nodeId === nodeId) next.delete(tid);
            return next;
        });
    }, [chatSpaceFilter, setNodes, setEdges, setActiveNodeId, clearNodeHistory, setTasks]);
    const chatStats = useMemo(() => {
        const allMsgs: number[] = [];
        let activeSpaces = 0;
        SPACE_IDS.forEach((id) => {
            const msgs = conversationHistory[id] || [];
            if (msgs.length > 0) activeSpaces++;
            msgs.forEach((m: ConversationMessage) => { const t = m.timestamp || 0; if (t) allMsgs.push(t); });
        });
        const oldest = allMsgs.length > 0 ? new Date(Math.min(...allMsgs)).toLocaleDateString() : "—";
        const newest = allMsgs.length > 0 ? new Date(Math.max(...allMsgs)).toLocaleDateString() : "—";
        return { total: SPACE_IDS.reduce((s, id) => s + (conversationHistory[id]?.length || 0), 0), spaces: activeSpaces, oldest, newest };
    }, [conversationHistory]);

    const handleClearConversationHistory = useCallback(async () => {
        if (!(await confirmDialog("Clear all conversation history for Work, Play, and Research spaces? LanceDB memories will NOT be affected."))) return;
        SPACE_IDS.forEach((id) => clearSpaceHistory(id));
    }, [clearSpaceHistory]);

    const handleClearOsChatHistory = useCallback(async () => {
        if (!(await confirmDialog("Clear the main OS chat history (input bar conversations)? This does not affect per-space chat or LanceDB memories."))) return;
        setOsConversationHistory([]);
    }, [setOsConversationHistory]);

    const storageKey = getWorkspaceStorageKey(activeProfileId);
    const handleClearAllCards = useCallback(async () => {
        if (!(await confirmDialog("Remove all cards and edges from the workspace? Conversation history and LanceDB memories will NOT be affected."))) return;
        setNodes([]);
        setEdges([]);
        setActiveNodeId(null);
        if (isIndexedDBAvailable()) {
            void clearAllTasksFromIDB();
        }
        setTasks(new Map());
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey);
        if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
    }, [setNodes, setEdges, setActiveNodeId, setTasks, storageKey]);

    const handleClearAllWorkspaceData = useCallback(async () => {
        if (!(await confirmDialog("Clear ALL workspace data: cards, edges, conversation history (including OS chat), and tasks. Settings and LanceDB kernel memories will NOT be affected. Continue?"))) return;
        setNodes([]);
        setEdges([]);
        setConversationHistory(Object.fromEntries(settings.spaces.map(s => [s.id, []])));
        setOsConversationHistory([]);
        setActiveNodeId(null);
        setTasks(new Map());
        if (isIndexedDBAvailable()) {
            await clearStateFromIDB(activeProfileId);
            await clearAllTasksFromIDB();
        }
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey);
        if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey);
    }, [setNodes, setEdges, setConversationHistory, setOsConversationHistory, setActiveNodeId, setTasks, activeProfileId, storageKey]);

    const loadMemories = useCallback(async () => {
        setLoading(true);
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            const data = (await kernelInvoke<unknown[]>("list_memories", { agentId: null })) as Array<{ agent_id?: string; updated_at?: number; created_at?: number }>;
            setMemories(data);
            // Compute stats
            const agentSet = new Set(data.map((m) => m.agent_id));
            const timestamps = data.map((m) => m.updated_at ?? m.created_at ?? 0).filter(Boolean);
            const oldest = timestamps.length > 0 ? new Date(Math.min(...timestamps) * 1000).toLocaleDateString() : "—";
            const newest = timestamps.length > 0 ? new Date(Math.max(...timestamps) * 1000).toLocaleDateString() : "—";
            setStats({ total: data.length, agents: agentSet.size, oldest, newest });
        } catch (err) {
            console.error("Failed to load memories:", err);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleClearAllKernelMemories = useCallback(async () => {
        if (!(await confirmDialog("Delete ALL kernel memories (LanceDB)? This will remove all facts and preferences the AI has learned about you. This cannot be undone."))) return;
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("delete_all_memories", { agentId: null });
            loadMemories();
        } catch (err) {
            console.error("Failed to clear kernel memories:", err);
        }
    }, [loadMemories]);

    useEffect(() => { loadMemories(); }, [loadMemories]);

    const handleDelete = async (agentId: string, entryId: string) => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("delete_memory", { agentId, entryId });
            setDeleteConfirm(null);
            loadMemories();
        } catch (err) {
            console.error("Failed to delete memory:", err);
        }
    };

    const handleUpdate = async (agentId: string, entryId: string, content: string) => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("update_memory", { agentId, entryId, content, tags: null, context: null });
            setEditingId(null);
            loadMemories();
        } catch (err) {
            console.error("Failed to update memory:", err);
        }
    };

    const agentIds = useMemo(() => {
        const set = new Set(memories.map((m: any) => m.agent_id || "unknown"));
        return Array.from(set).sort();
    }, [memories]);

    const filtered = useMemo(() => {
        let result = memories;
        if (agentFilter !== "all") {
            result = result.filter((m: any) => m.agent_id === agentFilter);
        }
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            result = result.filter((m: any) =>
                (m.content || "").toLowerCase().includes(q) ||
                (m.key || "").toLowerCase().includes(q) ||
                (m.tags || []).some((t: string) => t.toLowerCase().includes(q))
            );
        }
        return result;
    }, [memories, agentFilter, searchTerm]);

    const formatTime = (ts: number) => {
        if (!ts) return "—";
        const d = new Date(ts * 1000);
        const now = new Date();
        const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
        if (diff < 60) return "Just now";
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return d.toLocaleDateString();
    };

    return (
        <div className="space-y-4">
            {/* Desplegable 1: Workspace / Chat & Cards */}
            <div className="rounded-xl border border-theme bg-theme-surface overflow-hidden">
                <button
                    type="button"
                    onClick={() => setExpandedWorkspace(!expandedWorkspace)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-theme-surface-hover transition-colors"
                >
                    <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider flex items-center gap-2">
                        <LayoutGrid size={12} /> Workspace / Chat & Cards — {totalChatCount} messages
                    </span>
                    {expandedWorkspace ? <ChevronDown size={14} className="text-theme-muted" /> : <ChevronRight size={14} className="text-theme-muted" />}
                </button>
                {expandedWorkspace && (
                    <div className="px-4 pb-4 pt-0 space-y-3 border-t border-theme">
                        <SettingRow
                            label="Data Persistence"
                            description="Where cards and conversation history are stored. Session Only = lost when you close the app; Local Storage = persists across restarts."
                        >
                            <Select
                                value={settings.dataPersistence}
                                onChange={(v) => updateSetting("dataPersistence", v as "local" | "session")}
                                options={[
                                    { label: "Local Storage", value: "local" },
                                    { label: "Session Only", value: "session" },
                                ]}
                            />
                        </SettingRow>
                        <SettingRow
                            label="Clear All Cards"
                            description="Remove all cards and edges from the workspace. Conversation history and LanceDB memories are not affected."
                        >
                            <button
                                type="button"
                                onClick={() => void handleClearAllCards()}
                                className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-[10px] text-amber-400/80 hover:bg-amber-500/10 transition-all"
                            >
                                Clear Cards
                            </button>
                        </SettingRow>
                        <SettingRow
                            label="Clear All Workspace Data"
                            description="Remove cards, edges, conversation history, and tasks. Settings and LanceDB kernel memories are not affected."
                        >
                            <button
                                type="button"
                                onClick={() => void handleClearAllWorkspaceData()}
                                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 transition-all"
                            >
                                Clear Workspace
                            </button>
                        </SettingRow>
                        <SettingRow
                            label="Clear All Conversation History"
                            description="Remove all messages from Work, Play, and Research spaces. Cards, edges, and LanceDB memories are not affected."
                        >
                            <button
                                type="button"
                                onClick={() => void handleClearConversationHistory()}
                                className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-[10px] text-amber-400/80 hover:bg-amber-500/10 transition-all"
                            >
                                Clear History
                            </button>
                        </SettingRow>
                        <SettingRow
                            label="Clear OS Chat History"
                            description="Remove the main chat history (input bar with the OS). Per-space conversations and LanceDB memories are not affected."
                        >
                            <button
                                type="button"
                                onClick={() => void handleClearOsChatHistory()}
                                className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-[10px] text-amber-400/80 hover:bg-amber-500/10 transition-all"
                            >
                                Clear OS Chat
                            </button>
                        </SettingRow>

                        {/* Chat metrics */}
                        <div className="grid grid-cols-4 gap-3 pt-1">
                            {[
                                { label: "Total Messages", value: String(chatStats.total), color: "#a78bfa" },
                                { label: "Active Spaces", value: String(chatStats.spaces), color: "#60a5fa" },
                                { label: "Oldest", value: chatStats.oldest, color: "#34d399" },
                                { label: "Newest", value: chatStats.newest, color: "#f472b6" },
                            ].map((s) => (
                                <div key={s.label} className="p-3 rounded-xl bg-theme-surface border border-theme text-center">
                                    <p className="text-[18px] font-bold text-theme" style={{ color: s.color }}>{s.value}</p>
                                    <p className="text-[9px] text-theme-muted mt-0.5 uppercase tracking-wider font-semibold">{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Conversation history */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[10px] font-semibold text-theme-muted uppercase tracking-wider">Conversations</p>
                                <Select
                                    value={chatSpaceFilter}
                                    onChange={(v) => {
                                        setChatSpaceFilter(v as SpaceId);
                                        setExpandedChatNodes(new Set());
                                    }}
                                    options={settings.spaces.map(s => ({ label: s.label, value: s.id }))}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                                    <input
                                        value={chatSearchTerm}
                                        onChange={(e) => setChatSearchTerm(e.target.value)}
                                        placeholder="Search by content..."
                                        className="w-full pl-8 pr-3 py-2 bg-theme-surface border border-theme rounded-xl text-[11px] text-theme outline-none focus:border-theme-secondary transition-all"
                                    />
                                </div>
                                <button
                                    onClick={handleRefreshConversations}
                                    disabled={chatRefreshLoading}
                                    className={cn(
                                        "p-2 rounded-xl border border-theme hover:bg-theme-surface-hover text-theme-muted hover:text-theme transition-all",
                                        chatRefreshLoading && "animate-spin opacity-50"
                                    )}
                                    title="Refresh"
                                >
                                    <Orbit size={14} />
                                </button>
                            </div>
                            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                                {chatMessages.length === 0 ? (
                                    <p className="text-[10px] text-theme-muted py-4 text-center">No messages in this space yet.</p>
                                ) : groupedChatMessages.size === 0 ? (
                                    <p className="text-[10px] text-theme-muted py-4 text-center">No messages match your search.</p>
                                ) : (
                                    Array.from(groupedChatMessages.entries())
                                        .sort(([a], [b]) => {
                                            if (a === null) return 1;
                                            if (b === null) return -1;
                                            const msgsA = groupedChatMessages.get(a)!;
                                            const msgsB = groupedChatMessages.get(b)!;
                                            const latestA = Math.max(...msgsA.map(({ msg }) => msg.timestamp || 0));
                                            const latestB = Math.max(...msgsB.map(({ msg }) => msg.timestamp || 0));
                                            return latestB - latestA;
                                        })
                                        .map(([nodeKey, entries]) => {
                                            const nodeLabel = nodeKey === null
                                                ? "General"
                                                : (nodes.find((n) => n.id === nodeKey)?.title || nodes.find((n) => n.id === nodeKey)?.content?.title || `Card ${nodeKey.slice(0, 8)}`);
                                            const groupKey = nodeKey ?? "_none";
                                            const isExpanded = expandedChatNodes.has(groupKey);
                                            return (
                                                <div key={groupKey} className="rounded-lg border border-theme bg-theme-surface overflow-hidden">
                                                    <div className="px-3 py-2 flex items-center gap-2 hover:bg-theme-surface-hover transition-colors text-[11px]">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleExpandedChatNode(groupKey)}
                                                            className="flex-1 flex items-center justify-between text-left min-w-0"
                                                        >
                                                            <span className="font-semibold text-theme truncate">{nodeLabel}</span>
                                                            <span className="text-theme-muted text-[9px] shrink-0">{entries.length} msg</span>
                                                            {isExpanded ? <ChevronDown size={12} className="text-theme-muted ml-1" /> : <ChevronRight size={12} className="text-theme-muted ml-1" />}
                                                        </button>
                                                        {nodeKey && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => void handleDeleteCardCompletely(nodeKey, e)}
                                                                className="p-1.5 rounded-lg shrink-0 text-theme-muted hover:bg-red-500/10 hover:text-red-400 transition-all"
                                                                title="Delete card and its history"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {isExpanded && (
                                                        <div className="border-t border-theme px-2 py-1.5 space-y-1">
                                                            {entries.map(({ msg, flatIndex }) => (
                                                                <div
                                                                    key={`${chatSpaceFilter}-${flatIndex}`}
                                                                    className="group flex items-center gap-2 py-1.5 px-2 rounded-lg bg-theme-surface border border-theme hover:border-theme-secondary transition-all"
                                                                >
                                                                    <MessageSquare size={10} className="text-theme-muted shrink-0" />
                                                                    <div className="flex-1 min-w-0 flex items-center gap-2 text-[10px] truncate">
                                                                        <span className={cn(
                                                                            "px-1 py-0.5 rounded text-[7px] font-bold uppercase shrink-0 border",
                                                                            msg.role === "user" && "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
                                                                            msg.role === "assistant" && "bg-violet-500/15 text-violet-400 border-violet-500/30",
                                                                            msg.role === "system" && "bg-gray-500/15 text-gray-400 border-gray-500/30"
                                                                        )}>
                                                                            {msg.role}
                                                                        </span>
                                                                        <span className="text-theme truncate">{msg.content || "(empty)"}</span>
                                                                        <span className="text-theme-muted shrink-0">·</span>
                                                                        <span className="text-theme-muted text-[8px] shrink-0">{formatTimeMs(msg.timestamp)}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => removeConversationMessage(chatSpaceFilter, flatIndex)}
                                                                        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-theme-muted hover:text-red-400 transition-all"
                                                                        title="Delete"
                                                                    >
                                                                        <Trash2 size={10} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Desplegable 2: LanceDB (Kernel Memories) — 1 line when collapsed */}
            <div className="rounded-xl border border-theme bg-theme-surface overflow-hidden">
                <button
                    type="button"
                    onClick={() => setExpandedLanceDB(!expandedLanceDB)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-theme-surface-hover transition-colors"
                >
                    <span className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider flex items-center gap-2">
                        <Brain size={12} /> LanceDB (Kernel memories) — {stats.total} memories
                    </span>
                    {expandedLanceDB ? <ChevronDown size={14} className="text-theme-muted" /> : <ChevronRight size={14} className="text-theme-muted" />}
                </button>
                {expandedLanceDB && (
                    <div className="px-4 pb-4 pt-3 border-t border-theme space-y-3">
                        <SettingRow
                            label="Clear All Kernel Memories"
                            description="Remove all memories stored in LanceDB. Workspace data, conversation history, and settings are not affected."
                        >
                            <button
                                type="button"
                                onClick={() => void handleClearAllKernelMemories()}
                                className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 transition-all"
                            >
                                Clear Kernel Memories
                            </button>
                        </SettingRow>
                        {/* Stats Grid */}
                        <div className="grid grid-cols-4 gap-3">
                            {[
                                { label: "Total Memories", value: String(stats.total), color: "#a78bfa" },
                                { label: "Active Agents", value: String(stats.agents), color: "#60a5fa" },
                                { label: "Oldest", value: stats.oldest, color: "#34d399" },
                                { label: "Newest", value: stats.newest, color: "#f472b6" },
                            ].map((s) => (
                                <div key={s.label} className="p-3 rounded-xl bg-theme-surface border border-theme text-center">
                                    <p className="text-[18px] font-bold text-theme" style={{ color: s.color }}>{s.value}</p>
                                    <p className="text-[9px] text-theme-muted mt-0.5 uppercase tracking-wider font-semibold">{s.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Toolbar: search + filter + refresh */}
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" />
                                <input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search memories by content, key, or tag..."
                                    className="w-full pl-8 pr-3 py-2 bg-theme-surface border border-theme rounded-xl text-[11px] text-theme outline-none focus:border-theme-secondary transition-all"
                                />
                            </div>
                            <Select
                                value={agentFilter}
                                onChange={setAgentFilter}
                                options={[
                                    { label: "All Agents", value: "all" },
                                    ...agentIds.map((id) => ({ label: id, value: id })),
                                ]}
                            />
                            <button
                                onClick={loadMemories}
                                disabled={loading}
                                className={cn(
                                    "p-2 rounded-xl border border-theme hover:bg-theme-surface-hover text-theme-muted hover:text-theme transition-all",
                                    loading && "animate-spin opacity-50"
                                )}
                                title="Refresh"
                            >
                                <Orbit size={14} />
                            </button>
                        </div>

                        {/* Memory List */}
                        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                            {loading ? (
                                <div className="text-center py-12">
                                    <Orbit size={24} className="mx-auto text-theme-muted animate-spin mb-3" />
                                    <p className="text-[11px] text-theme-muted">Loading memories...</p>
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="text-center py-12 border-2 border-dashed border-theme rounded-2xl">
                                    <Cpu size={28} className="mx-auto text-theme-muted mb-3 opacity-20" />
                                    <p className="text-[12px] text-theme-muted">
                                        {memories.length === 0
                                            ? "No memories stored yet. The AI will create memories as you interact."
                                            : "No memories match your search."}
                                    </p>
                                </div>
                            ) : (
                                filtered.map((mem: any) => {
                                    const isEditing = editingId === mem.id;
                                    const isDeleting = deleteConfirm === mem.id;
                                    return (
                                        <motion.div
                                            key={mem.id}
                                            layout
                                            initial={{ opacity: 0, y: 2 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -2 }}
                                            className="group flex items-center gap-2 py-2 px-3 rounded-lg bg-theme-surface border border-theme hover:border-theme-secondary transition-all"
                                        >
                                            {isEditing ? (
                                                <div className="flex-1 flex flex-col gap-2">
                                                    <textarea
                                                        value={editDraft}
                                                        onChange={(e) => setEditDraft(e.target.value)}
                                                        className="w-full bg-theme-muted border border-theme rounded-lg px-3 py-2 text-[11px] text-theme font-mono outline-none focus:border-theme-accent resize-y min-h-[60px]"
                                                        autoFocus
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <button onClick={() => handleUpdate(mem.agent_id, mem.id, editDraft)} className="px-2 py-1 rounded-lg bg-theme-accent text-white text-[10px] font-semibold"><Check size={10} /> Save</button>
                                                        <button onClick={() => setEditingId(null)} className="px-2 py-1 rounded-lg border border-theme text-[10px] text-theme-muted">Cancel</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <Brain size={12} className="text-theme-muted shrink-0" />
                                                    <div className="flex-1 min-w-0 flex items-center gap-2 text-[11px] truncate">
                                                        <span className="text-theme font-medium truncate">{mem.content || "(empty)"}</span>
                                                        {mem.category && mem.category !== "uncategorized" && (
                                                            <span className={cn(
                                                                "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider shrink-0 border",
                                                                mem.category === "user_fact" && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                                                                mem.category === "preference" && "bg-blue-500/15 text-blue-400 border-blue-500/30",
                                                                mem.category === "os_insight" && "bg-purple-500/15 text-purple-400 border-purple-500/30",
                                                                mem.category === "pattern" && "bg-amber-500/15 text-amber-400 border-amber-500/30",
                                                                mem.category === "conversation" && "bg-gray-500/15 text-gray-400 border-gray-500/30",
                                                                !["user_fact", "preference", "os_insight", "pattern", "conversation"].includes(mem.category) && "bg-theme-muted text-theme-muted border-theme"
                                                            )}>
                                                                {mem.category.replace("_", " ")}
                                                            </span>
                                                        )}
                                                        <span className="text-theme-muted shrink-0">·</span>
                                                        <span className="text-theme-muted truncate font-mono text-[10px]">{mem.key || "—"}</span>
                                                        <span className="text-theme-muted shrink-0">·</span>
                                                        <span className="text-theme-muted text-[9px] shrink-0">{formatTime(mem.updated_at)}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                        <button onClick={() => { setEditingId(mem.id); setEditDraft(mem.content || ""); }} className="p-1.5 rounded-lg hover:bg-theme-muted text-theme-muted hover:text-theme" title="Edit"><Edit3 size={12} /></button>
                                                        {isDeleting ? (
                                                            <>
                                                                <button onClick={() => handleDelete(mem.agent_id, mem.id)} className="p-1.5 rounded-lg bg-red-500/20 text-red-400" title="Confirm"><Check size={12} /></button>
                                                                <button onClick={() => setDeleteConfirm(null)} className="p-1.5 rounded-lg hover:bg-theme-muted text-theme-muted" title="Cancel"><X size={12} /></button>
                                                            </>
                                                        ) : (
                                                            <button onClick={() => setDeleteConfirm(mem.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-theme-muted hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </motion.div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer info */}
                        {filtered.length > 0 && (
                            <p className="text-[9px] text-theme-muted text-center">
                                Showing {filtered.length} of {memories.length} memories · Stored in ~/Library/Application Support/com.synthesis.synthesis-os/lancedb/
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Section Content ─── */
function SectionContent({ sectionId, nodes, onCloseNode, onActivateNode, onCleanupStuckNodes, onCloseAllSpaceNodes, setManageSpacesOpen }: {
    sectionId: string;
    nodes?: SynthesisNode[];
    onCloseNode?: (id: string) => void;
    onActivateNode?: (id: string) => void;
    onCleanupStuckNodes?: () => void;
    onCloseAllSpaceNodes?: (spaceId: SpaceId) => void;
    setManageSpacesOpen: (open: boolean) => void;
}) {
    const { settings, updateSetting, resetSettings, exportSettings, importSettings } = useSettings();
    const { activeProfileId } = useProfile();
    const setNodes = useNodesStore((s) => s.setNodes);
    const setEdges = useNodesStore((s) => s.setEdges);
    const setConversationHistory = useNodesStore((s) => s.setConversationHistory);
    const setOsConversationHistory = useNodesStore((s) => s.setOsConversationHistory);
    const setTasks = useNodesStore((s) => s.setTasks);
    const setActiveNodeId = useNodesStore((s) => s.setActiveNodeId);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [backgroundFilter, setBackgroundFilter] = useState<"all" | "dynamic" | "image" | "video">("all");
    const filteredBackgroundPresets = backgroundFilter === "all"
        ? SYNTHESIS_BACKGROUND_PRESETS
        : SYNTHESIS_BACKGROUND_PRESETS.filter((preset) => preset.kind === backgroundFilter);

    // Handle export
    const handleExport = () => {
        const json = exportSettings();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `synthesis-settings-${new Date().toISOString().split("T")[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // Handle import
    const handleImport = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = event.target?.result as string;
                importSettings(json);
                alert("Settings imported successfully!");
            } catch {
                alert("Failed to import settings. Check file format.");
            }
        };
        reader.readAsText(file);
    };

    // Handle clear data — clears all stored data (workspace + kernel memories + IDB)
    const clearDataStorageKey = getWorkspaceStorageKey(activeProfileId);
    const handleClearData = async () => {
        if (!(await confirmDialog("Delete ALL stored data? This will remove workspace (cards, conversation, tasks), kernel memories (LanceDB), and local storage. Settings will NOT be affected. This cannot be undone."))) return;
        setNodes([]);
        setEdges([]);
        setConversationHistory(Object.fromEntries(settings.spaces.map(s => [s.id, []])));
        setOsConversationHistory([]);
        setActiveNodeId(null);
        setTasks(new Map());
        if (isIndexedDBAvailable()) {
            await clearStateFromIDB(activeProfileId);
            await clearAllTasksFromIDB();
        }
        if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(clearDataStorageKey);
        if (typeof localStorage !== "undefined") localStorage.removeItem(clearDataStorageKey);
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("delete_all_memories", { agentId: null });
        } catch (err) {
            console.error("Failed to clear kernel memories:", err);
        }
    };

    // Handle reset settings
    const handleResetSettings = async () => {
        if (await confirmDialog("Are you sure you want to reset all settings to defaults? This cannot be undone.")) {
            resetSettings();
        }
    };

    switch (sectionId) {
        case "ai": {
            return (
                <Suspense fallback={<SectionSkeleton />}>
                    <LazyAISection />
                </Suspense>
            );
        }

        case "kernel":
            return <KernelSection />;

        case "users":
            return <UsersSection />;

        case "appearance":
            return (
                <div className="py-4 space-y-6">
                    {/* ── Appearance Mode ── */}
                    <section className="glass-grouped-section p-4">
                        <p className="text-[11px] font-semibold mb-3 text-theme-muted">Appearance</p>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { id: "light", label: "Light", icon: <Sun size={14} /> },
                                { id: "dark", label: "Dark", icon: <Moon size={14} /> },
                                { id: "auto", label: "Auto", icon: <Monitor size={14} /> },
                            ].map((mode) => (
                                <button
                                    key={mode.id}
                                    onClick={() => updateSetting("appearanceMode", mode.id as SynthesisSettings["appearanceMode"])}
                                    className={`relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${settings.appearanceMode === mode.id
                                        ? "bg-theme-muted border-theme ring-1 ring-theme-accent"
                                        : "border-theme hover:bg-theme-surface-hover hover:border-theme-secondary text-theme-muted hover:text-theme"
                                        }`}
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${settings.appearanceMode === mode.id ? "bg-accent text-white" : "bg-theme-surface border border-theme"}`}>
                                        {mode.icon}
                                    </div>
                                    <span className="text-[11px] font-medium">{mode.label}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* ── Glass Style ── */}
                    <section className="glass-grouped-section p-4">
                        <p className="text-[11px] font-semibold mb-3 text-theme-muted">Glass Effect</p>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { id: "clear", label: "Clear", sub: "Natural translucency" },
                                { id: "tinted", label: "Tinted", sub: "Accent-aware depth" },
                            ].map((style) => (
                                <button
                                    key={style.id}
                                    onClick={() => updateSetting("glassStyle", style.id as SynthesisSettings["glassStyle"])}
                                    className={`relative flex flex-col p-3 rounded-xl border transition-all text-left ${settings.glassStyle === style.id
                                        ? "bg-theme-muted border-theme ring-1 ring-theme-accent"
                                        : "border-theme hover:bg-theme-surface-hover hover:border-theme-secondary text-theme-muted hover:text-theme"
                                        }`}
                                >
                                    <span className="text-[11px] font-semibold text-theme mb-0.5">{style.label}</span>
                                    <span className="text-[9px] text-theme-muted">{style.sub}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* ── Accent Color ── */}
                    <section className="glass-grouped-section p-4">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[11px] font-semibold text-theme-muted">Accent Color</p>
                            <span className="text-[10px] py-0.5 px-2 rounded-full bg-theme-muted text-theme-secondary font-mono">
                                {settings.accentColor}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            {[
                                "#007AFF", // Blue
                                "#FF9500", // Orange
                                "#FF2D55", // Red-Pink
                                "#AF52DE", // Purple
                                "#34C759", // Green
                                "#FFCC00", // Gold
                                "#A2845E", // Graphite/Brown
                                "multicolor", // Special multicolor icon logic
                            ].map((color) => {
                                if (color === "multicolor") {
                                    return (
                                        <button
                                            key="multicolor"
                                            className="w-7 h-7 rounded-full border border-theme relative overflow-hidden active:scale-95 transition-transform"
                                            style={{
                                                background: "linear-gradient(45deg, #FF2D55, #AF52DE, #007AFF, #34C759, #FFCC00, #FF9500)",
                                            }}
                                            onClick={() => {
                                                const input = document.getElementById("hidden-color-input") as HTMLInputElement;
                                                if (input) input.click();
                                            }}
                                        />
                                    );
                                }
                                const selected = settings.accentColor.toLowerCase() === color.toLowerCase();
                                return (
                                    <button
                                        key={color}
                                        onClick={() => updateSetting("accentColor", color)}
                                        className={`w-7 h-7 rounded-full border transition-all flex items-center justify-center ${selected ? "scale-110 shadow-lg" : "hover:scale-105"}`}
                                        style={{
                                            background: color,
                                            borderColor: selected ? "#ffffff" : "transparent",
                                            boxShadow: selected ? `0 0 12px ${color}66` : undefined,
                                        }}
                                    >
                                        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
                                    </button>
                                );
                            })}
                            <input
                                id="hidden-color-input"
                                type="color"
                                value={settings.accentColor}
                                onChange={(e) => updateSetting("accentColor", e.target.value)}
                                className="w-0 h-0 opacity-0 overflow-hidden"
                            />
                        </div>
                    </section>

                    <section className={`glass-grouped-section p-4`}>
                        <p className={`text-[11px] font-semibold mb-3 text-theme-muted`}>Typography & Readability</p>
                        <div className="space-y-4">
                            <div>
                                <p className={`text-[11px] font-medium mb-2 text-theme`}>System Font Size</p>
                                <div className="grid grid-cols-5 gap-1.5 p-1 rounded-xl bg-theme-muted">
                                    {SYSTEM_FONT_SIZES.map((size) => (
                                        <button
                                            key={size.id}
                                            onClick={() => updateSetting("systemFontSize", size.id)}
                                            className={`h-8 rounded-lg text-[11px] font-semibold transition-all ${settings.systemFontSize === size.id
                                                ? "bg-theme-muted text-theme shadow-sm"
                                                : "text-theme-muted hover:bg-theme-surface hover:text-theme-secondary"
                                                }`}
                                        >
                                            {size.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className={`text-[11px] text-theme`}>Text Vibrancy</p>
                                    <span className={`text-[10px] text-theme-muted`}>{settings.textVibrancy}%</span>
                                </div>
                                <Slider value={settings.textVibrancy} onChange={(v) => updateSetting("textVibrancy", v)} color="#3b82f6" />
                                <div className="mt-2 rounded-xl px-3 py-2 border border-theme bg-theme-surface">
                                    <p className={`text-[12px] text-theme`} style={{ filter: `saturate(${1 + settings.textVibrancy / 120})` }}>
                                        Preview: The quick brown fox jumps over the lazy dog.
                                    </p>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className={`text-[11px] text-theme`}>Text Shadows</p>
                                    <span className={`text-[10px] text-theme-muted`}>{settings.textShadowStrength}%</span>
                                </div>
                                <Slider value={settings.textShadowStrength} onChange={(v) => updateSetting("textShadowStrength", v)} color="#6366f1" />
                                <div className="mt-2 rounded-xl px-3 py-2 border border-theme bg-theme-surface">
                                    <p
                                        className={`text-[12px] text-theme`}
                                        style={{
                                            textShadow: settings.textShadowStrength
                                                ? `0 0 ${Math.round(settings.textShadowStrength / 10)}px rgba(var(--synthesis-glass-border-rgb, 128, 128, 128), ${(settings.textShadowStrength / 100) * 0.5})`
                                                : "none",
                                        }}
                                    >
                                        Preview: Readable text on busy backgrounds.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className={`glass-grouped-section p-4`}>
                        <p className={`text-[11px] font-semibold mb-3 text-theme-muted`}>Shapes & Spacing</p>
                        <div className="space-y-4">
                            <div>
                                <p className={`text-[11px] font-medium mb-2 text-theme`}>Glass Material</p>
                                <div className="grid grid-cols-3 gap-2">
                                    {GLASS_MATERIALS.map((material) => (
                                        <button
                                            key={material.id}
                                            onClick={() => updateSetting("glassMaterial", material.id)}
                                            className={`h-9 rounded-xl border text-[11px] font-medium transition-colors ${settings.glassMaterial === material.id
                                                ? "border-theme bg-theme-muted text-theme"
                                                : "border-theme text-theme-secondary hover:bg-theme-muted"
                                                }`}
                                        >
                                            {material.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className={`text-[11px] text-theme`}>Corner Radius</p>
                                    <span className={`text-[10px] text-theme-muted`}>{settings.cardCornerRadius}px</span>
                                </div>
                                <Slider value={settings.cardCornerRadius} onChange={(v) => updateSetting("cardCornerRadius", v)} min={0} max={32} color="#60a5fa" />
                            </div>

                            <SettingRow label="Compact Mode" description="Reduce spacing across cards and controls for denser layout">
                                <Toggle enabled={settings.compactMode} onChange={(v) => updateSetting("compactMode", v)} />
                            </SettingRow>
                        </div>
                    </section>

                    {/* ── Advanced Effects (Accordion) ── */}
                    <details className="group glass-grouped-section overflow-hidden">
                        <summary className="flex items-center justify-between p-4 cursor-pointer hover:bg-theme-surface-hover transition-colors list-none">
                            <p className="text-[11px] font-semibold text-theme-muted">Advanced Effects</p>
                            <ChevronDown size={14} className="text-theme-muted group-open:rotate-180 transition-transform" />
                        </summary>
                        <div className="p-4 pt-0 space-y-4 border-t border-theme">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">Glass Blur</p>
                                    <span className="text-[10px] text-theme-muted">{settings.blurIntensity}%</span>
                                </div>
                                <Slider value={settings.blurIntensity} onChange={(v) => updateSetting("blurIntensity", v)} color="#60a5fa" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">Saturation</p>
                                    <span className="text-[10px] text-theme-muted">{settings.glassSaturation}%</span>
                                </div>
                                <Slider value={settings.glassSaturation} onChange={(v) => updateSetting("glassSaturation", v)} min={80} max={200} color="#38bdf8" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">System Translucency</p>
                                    <span className="text-[10px] text-theme-muted">{settings.glassOpacity}%</span>
                                </div>
                                <Slider value={settings.glassOpacity} onChange={(v) => updateSetting("glassOpacity", v)} min={30} max={100} color="#0ea5e9" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">Outline Opacity</p>
                                    <span className="text-[10px] text-theme-muted">{settings.glassOutlineOpacity}%</span>
                                </div>
                                <Slider value={settings.glassOutlineOpacity} onChange={(v) => updateSetting("glassOutlineOpacity", v)} color="#a78bfa" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">Shadow Strength</p>
                                    <span className="text-[10px] text-theme-muted">{settings.glassShadowStrength}%</span>
                                </div>
                                <Slider value={settings.glassShadowStrength} onChange={(v) => updateSetting("glassShadowStrength", v)} color="#6366f1" />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[11px] text-theme">Noise / Grain</p>
                                    <span className="text-[10px] text-theme-muted">{settings.noiseGrain}%</span>
                                </div>
                                <Slider value={settings.noiseGrain} onChange={(v) => updateSetting("noiseGrain", v)} min={0} max={30} color="#8b5cf6" />
                            </div>
                            <SettingRow label="Specular Highlights" description="Simulate light reflections on glass edges">
                                <Toggle enabled={settings.specularHighlights} onChange={(v) => updateSetting("specularHighlights", v)} />
                            </SettingRow>
                            <SettingRow label="Background Overlay" description="Add a subtle atmospheric overlay above wallpapers">
                                <Toggle enabled={settings.backgroundOverlay} onChange={(v) => updateSetting("backgroundOverlay", v)} />
                            </SettingRow>
                            <SettingRow label="Adaptive Context Colors" description="Use space/content color as dynamic ambient tint">
                                <Toggle enabled={settings.adaptiveColor} onChange={(v) => updateSetting("adaptiveColor", v)} />
                            </SettingRow>
                            <SettingRow label="Star Field" description="Animated background particles">
                                <Toggle enabled={settings.starField} onChange={(v) => updateSetting("starField", v)} />
                            </SettingRow>
                            <SettingRow label="Animations" description="Enable physics-based transitions">
                                <Toggle enabled={settings.animations} onChange={(v) => updateSetting("animations", v)} />
                            </SettingRow>
                            <div className="pt-2 mt-2 border-t border-theme-primary/10">
                                <p className="text-[10px] text-theme-muted uppercase tracking-wider font-semibold mb-3 px-1">Interface Details</p>
                                <SettingRow label="Icon Style" description="System-wide icon appearance">
                                    <Select value={settings.iconStyle || "default"} onChange={(v) => updateSetting("iconStyle", v as SynthesisSettings["iconStyle"])} options={[
                                        { label: "Default", value: "default" },
                                        { label: "Dark", value: "dark" },
                                        { label: "Clear", value: "clear" },
                                        { label: "Tinted", value: "tinted" },
                                    ]} />
                                </SettingRow>
                                <SettingRow label="Sidebar Icons" description="Size of dock and navigation icons">
                                    <Select value={settings.sidebarIconSize || "medium"} onChange={(v) => updateSetting("sidebarIconSize", v as SynthesisSettings["sidebarIconSize"])} options={[
                                        { label: "Small", value: "small" },
                                        { label: "Medium", value: "medium" },
                                        { label: "Large", value: "large" },
                                    ]} />
                                </SettingRow>
                                <SettingRow label="Scrollbars" description="Visibility behavior of system scrollbars">
                                    <Select value={settings.scrollbarVisibility || "auto"} onChange={(v) => updateSetting("scrollbarVisibility", v as SynthesisSettings["scrollbarVisibility"])} options={[
                                        { label: "Auto", value: "auto" },
                                        { label: "Always Shown", value: "always" },
                                        { label: "Hidden", value: "hidden" },
                                    ]} />
                                </SettingRow>
                            </div>
                        </div>
                    </details>
                </div>
            );

        case "desktop":
            return (
                <div className="py-2 space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <Image size={14} className="text-theme-muted" />
                            <p className="text-[11px] font-semibold text-theme-muted">Wallpaper</p>
                        </div>
                        <div className="space-y-8">
                            {(["landscape", "cityscape", "underwater", "abstract"] as const).map((cat) => {
                                const catPresets = SYNTHESIS_BACKGROUND_PRESETS.filter(p => p.category === cat);
                                if (catPresets.length === 0) return null;

                                return (
                                    <div key={cat} className="space-y-3">
                                        <p className="text-[10px] items-center gap-1.5 uppercase tracking-[0.2em] font-bold text-theme-muted px-1 flex">
                                            {cat === "landscape" && <Sun size={10} />}
                                            {cat === "cityscape" && <Image size={10} />}
                                            {cat === "underwater" && <Droplets size={10} />}
                                            {cat === "abstract" && <Sparkles size={10} />}
                                            {cat}
                                        </p>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            {catPresets.map((p) => {
                                                const isActive = settings.backgroundPreset === p.id;
                                                return (
                                                    <button
                                                        key={p.id}
                                                        onClick={() => updateSetting("backgroundPreset", p.id)}
                                                        className={cn(
                                                            "group relative aspect-[16/10] rounded-xl overflow-hidden border-2 transition-all duration-300",
                                                            isActive ? "border-theme-accent shadow-lg scale-[1.02]" : "border-theme hover:border-theme-secondary"
                                                        )}
                                                        style={isActive ? { borderColor: "var(--synthesis-accent)" } : {}}
                                                    >
                                                        <div
                                                            className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-110"
                                                            style={{ transformOrigin: "center", backfaceVisibility: "hidden" }}
                                                        >
                                                            <div
                                                                className="absolute inset-0"
                                                                style={{ background: p.preview, backgroundSize: "cover", backgroundPosition: "center" }}
                                                            />
                                                            {p.mediaUrl && p.kind === "image" && (
                                                                <img
                                                                    src={p.mediaUrl}
                                                                    alt={p.label}
                                                                    className="absolute inset-0 w-full h-full object-cover"
                                                                    loading="lazy"
                                                                    decoding="async"
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 pointer-events-none" />
                                                        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                                                            <span className="text-[10px] font-medium text-white truncate drop-shadow-md">{p.label}</span>
                                                            {isActive && (
                                                                <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center shadow-sm">
                                                                    <Check size={10} className="text-[var(--synthesis-accent)]" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-theme">
                        <SettingRow label="Jarvis Mode" description="Take over the desktop: hide Finder icons and the Dock. Restores on exit.">
                            <Toggle enabled={settings.jarvisMode} onChange={async (v) => {
                                updateSetting("jarvisMode", v);
                                try {
                                    const bridge = await import("@/lib/tauriBridge");
                                    if (v) await bridge.enterJarvisMode();
                                    else await bridge.exitJarvisMode();
                                } catch (err) { console.warn(err); }
                            }} />
                        </SettingRow>
                    </div>
                </div>
            );

        case "spaces":
            return (
                <div>
                    <SettingRow label="Max Nodes Per Space" description={`Limit visible nodes to prevent clutter (${settings.maxNodes})`}>
                        <div className="w-32">
                            <Slider value={settings.maxNodes} onChange={(v) => updateSetting("maxNodes", v)} min={4} max={24} color="#34d399" />
                        </div>
                    </SettingRow>
                    <SettingRow label="Clear Nodes on Space Switch" description="Remove nodes when switching spaces">
                        <Toggle enabled={settings.clearOnSwitch} onChange={(v) => updateSetting("clearOnSwitch", v)} />
                    </SettingRow>
                    <SettingRow label="God Mode" description="Enable flip-to-reveal JSON traces on all cards">
                        <Toggle enabled={settings.godMode} onChange={(v) => updateSetting("godMode", v)} />
                    </SettingRow>
                    <SettingRow label="Widgets" description="Show weather, music and calendar widget icons in the top bar">
                        <Toggle enabled={settings.widgetsEnabled} onChange={(v) => updateSetting("widgetsEnabled", v)} />
                    </SettingRow>
                    <SettingRow label="Default Space" description="Space to load on startup">
                        <Select value={settings.defaultSpace} onChange={(v) => updateSetting("defaultSpace", v as SpaceId)} options={settings.spaces.map(s => ({ label: s.label, value: s.id }))} />
                    </SettingRow>
                    <SettingRow label="Custom Spaces" description="Create and manage your own spaces">
                        <button
                            onClick={() => setManageSpacesOpen(true)}
                            className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all"
                        >
                            Manage →
                        </button>
                    </SettingRow>
                </div>
            );

        case "nodes": {
            const allNodes = nodes || [];
            const statusColors: Record<string, string> = {
                active: "#34d399",
                minimized: "#94a3b8",
                synthesizing: "#a78bfa",
                error: "#f87171",
            };
            const nodesBySpace = settings.spaces.map((s) => ({
                spaceId: s.id,
                label: s.label,
                nodes: allNodes.filter((n) => n.spaceId === s.id),
                color: s.color,
            }));
            const stuckCount = allNodes.filter(
                (n) =>
                    (n.status === "synthesizing" && (Date.now() - n.updatedAt) > 2 * 60 * 1000) ||
                    (n.type === "agent_task" &&
                        (n.taskStatus === "planning" || n.taskStatus === "running" || n.taskStatus === "waiting_approval" || n.taskStatus === "waiting_answer") &&
                        (Date.now() - n.updatedAt) > 2 * 60 * 1000)
            ).length;

            return (
                <div className="py-4 space-y-4">
                    {/* Summary bar */}
                    <div className="flex items-center justify-between px-1 pb-2 border-b border-theme">
                        <p className="text-[11px] text-theme-muted">
                            {allNodes.length} total nodes{stuckCount > 0 && <span className="text-amber-400 ml-1">· {stuckCount} stuck</span>}
                        </p>
                        <div className="flex items-center gap-2">
                            {stuckCount > 0 && onCleanupStuckNodes && (
                                <button
                                    onClick={onCleanupStuckNodes}
                                    className="text-[10px] px-2 py-1 rounded-lg transition-colors text-amber-400 hover:bg-amber-500/10 border border-amber-500/20"
                                >
                                    Clean {stuckCount} stuck
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Nodes by space */}
                    {nodesBySpace.map((group) => (
                        <section
                            key={group.spaceId}
                            className="glass-grouped-section p-4"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ background: group.color }} />
                                    <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-theme-muted">
                                        {group.label}
                                    </p>
                                    <span className="text-[9px] text-theme-muted">
                                        {group.nodes.length} nodes
                                    </span>
                                </div>
                                {group.nodes.length > 0 && onCloseAllSpaceNodes && (
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            if (await confirmDialog(`Close all ${group.nodes.length} nodes in ${group.label}?`)) {
                                                onCloseAllSpaceNodes(group.spaceId);
                                            }
                                        }}
                                        className="text-[9px] px-2 py-0.5 rounded-md transition-colors text-red-400/70 hover:bg-red-500/10 border border-red-500/15"
                                    >
                                        Close All
                                    </button>
                                )}
                            </div>

                            {group.nodes.length === 0 ? (
                                <p className="text-[10px] text-theme-muted py-2 px-2">No nodes in this space</p>
                            ) : (
                                <div className="space-y-0.5 max-h-[240px] overflow-y-auto custom-scrollbar">
                                    {group.nodes.map((node) => {
                                        const isStuck = (
                                            (node.status === "synthesizing" && (Date.now() - node.updatedAt) > 2 * 60 * 1000) ||
                                            (node.type === "agent_task" &&
                                                (node.taskStatus === "planning" || node.taskStatus === "running") &&
                                                (Date.now() - node.updatedAt) > 2 * 60 * 1000)
                                        );
                                        const age = Date.now() - node.createdAt;
                                        const ageLabel = age < 60000 ? "<1m"
                                            : age < 3600000 ? `${Math.floor(age / 60000)}m`
                                                : age < 86400000 ? `${Math.floor(age / 3600000)}h`
                                                    : `${Math.floor(age / 86400000)}d`;

                                        return (
                                            <div
                                                key={node.id}
                                                className={`flex items-center justify-between py-2 px-2 rounded-lg transition-colors hover:bg-theme-surface group ${isStuck ? "bg-amber-500/5" : ""}`}
                                            >
                                                <div className="flex-1 min-w-0 pr-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColors[node.status] || "#6b7280" }} />
                                                        <p className="text-[11px] font-medium text-theme truncate">
                                                            {node.title || node.query || "Untitled"}
                                                        </p>
                                                        {isStuck && (
                                                            <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-amber-500/15 text-amber-400/80 border border-amber-500/15 shrink-0">
                                                                STUCK
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-0.5 ml-3.5">
                                                        <span className="text-[9px] text-theme-muted">{node.type}</span>
                                                        <span className="text-[9px] text-theme-muted">·</span>
                                                        <span className="text-[9px] text-theme-muted">{node.status}{node.taskStatus ? ` / ${node.taskStatus}` : ""}</span>
                                                        <span className="text-[9px] text-theme-muted">·</span>
                                                        <span className="text-[9px] text-theme-muted">{ageLabel} ago</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {onActivateNode && node.status !== "active" && (
                                                        <button
                                                            onClick={() => onActivateNode(node.id)}
                                                            className="text-[9px] px-2 py-1 rounded-md text-theme-muted hover:text-theme-secondary hover:bg-theme-muted transition-colors"
                                                            title="Activate"
                                                        >
                                                            Show
                                                        </button>
                                                    )}
                                                    {onCloseNode && (
                                                        <button
                                                            onClick={() => onCloseNode(node.id)}
                                                            className="text-[9px] px-2 py-1 rounded-md text-red-400/70 hover:bg-red-500/10 transition-colors"
                                                            title="Close node"
                                                        >
                                                            Close
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </section>
                    ))}
                </div>
            );
        }

        case "synthesis":
            return (
                <div>
                    <SettingRow label="Auto-Refine" description="Automatically refine results for better quality. This triggers an extra LLM call using max tokens.">
                        <Toggle enabled={settings.autoRefine} onChange={(v) => updateSetting("autoRefine", v)} />
                    </SettingRow>
                    <SettingRow label="Show Source Links" description="Display source attribution on synthesis cards">
                        <Toggle enabled={settings.sourceLinks} onChange={(v) => updateSetting("sourceLinks", v)} />
                    </SettingRow>
                </div>
            );

        case "privacy":
            return (
                <div>
                    <SettingRow label="Cache Synthesis Results" description="Store results locally for faster access">
                        <Toggle enabled={settings.cacheResults} onChange={(v) => updateSetting("cacheResults", v)} />
                    </SettingRow>
                </div>
            );

        case "network":
            return (
                <div>
                    <SettingRow label="Web Scraping" description="Enable web content extraction via fetch + Readability">
                        <Toggle enabled={settings.scrapeEnabled} onChange={(v) => updateSetting("scrapeEnabled", v)} />
                    </SettingRow>
                    <SettingRow label="Proxy" description="Route scraping through a proxy server">
                        <Toggle enabled={settings.proxyEnabled} onChange={(v) => updateSetting("proxyEnabled", v)} />
                    </SettingRow>
                    <SettingRow label="Request Timeout" description={`Max wait time for web requests (${settings.timeout}s)`}>
                        <div className="w-32">
                            <Slider value={settings.timeout} onChange={(v) => updateSetting("timeout", v)} min={5} max={120} color="#22d3ee" />
                        </div>
                    </SettingRow>
                    <SettingRow label="User Agent" description="Browser identity for scraping requests">
                        <Select value={settings.userAgent} onChange={(v) => updateSetting("userAgent", v)} options={[
                            { label: "Chrome (Default)", value: "chrome" },
                            { label: "Firefox", value: "firefox" },
                            { label: "Custom", value: "custom" },
                        ]} />
                    </SettingRow>


                </div>
            );

        case "storage":
            return (
                <div>
                    <SettingRow label="Storage Limit" description={`Max local storage in MB (${settings.storageLimit} MB)`}>
                        <div className="w-32">
                            <Slider value={settings.storageLimit} onChange={(v) => updateSetting("storageLimit", v)} min={100} max={2000} color="#fb923c" />
                        </div>
                    </SettingRow>
                    <SettingRow label="Auto-Cleanup" description="Automatically remove old nodes to save space">
                        <Toggle enabled={settings.autoCleanup} onChange={(v) => updateSetting("autoCleanup", v)} />
                    </SettingRow>
                    <SettingRow label="Export Data" description="Download all your data as JSON">
                        <button onClick={handleExport} className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all">
                            Export →
                        </button>
                    </SettingRow>
                    <SettingRow label="Import Data" description="Load data from a previous export">
                        <button onClick={handleImport} className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all">
                            Import →
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileSelect}
                            className="hidden"
                        />
                    </SettingRow>
                </div>
            );

        case "performance":
            return (
                <div>
                    <SettingRow label="GPU Acceleration" description="Use GPU for animations and rendering">
                        <Toggle enabled={settings.gpuAccel} onChange={(v) => updateSetting("gpuAccel", v)} />
                    </SettingRow>
                    <SettingRow label="Lazy Loading" description="Load node content only when visible">
                        <Toggle enabled={settings.lazyLoad} onChange={(v) => updateSetting("lazyLoad", v)} />
                    </SettingRow>
                    <SettingRow label="Animation Quality" description="Balance between smoothness and performance">
                        <Select value={settings.animationQuality} onChange={(v) => updateSetting("animationQuality", v as SynthesisSettings["animationQuality"])} options={[
                            { label: "High (60fps)", value: "high" },
                            { label: "Medium (30fps)", value: "medium" },
                            { label: "Low (Power Saver)", value: "low" },
                        ]} />
                    </SettingRow>
                    <SettingRow label="Concurrent Synthesis" description="Max parallel AI operations">
                        <Select value={String(settings.concurrentSynthesis)} onChange={(v) => updateSetting("concurrentSynthesis", Number(v))} options={[
                            { label: "1 (Sequential)", value: "1" },
                            { label: "3 (Balanced)", value: "3" },
                            { label: "5 (Fast)", value: "5" },
                        ]} />
                    </SettingRow>
                </div>
            );

        case "display":
            return (
                <div>
                    <SettingRow label="Resolution" description="Rendering resolution for the workspace">
                        <Select value={settings.resolution} onChange={(v) => updateSetting("resolution", v)} options={[
                            { label: "Auto", value: "auto" },
                            { label: "1080p", value: "1080" },
                            { label: "1440p", value: "1440" },
                            { label: "4K", value: "4k" },
                        ]} />
                    </SettingRow>
                    <SettingRow label="Card Size" description="Default size for synthesis cards">
                        <Select value={settings.cardSize} onChange={(v) => updateSetting("cardSize", v as SynthesisSettings["cardSize"])} options={[
                            { label: "Compact", value: "compact" },
                            { label: "Medium", value: "medium" },
                            { label: "Large", value: "large" },
                        ]} />
                    </SettingRow>
                    <SettingRow label="Fullscreen Mode" description="Hide system bars for immersive experience">
                        <button className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all">
                            Enter →
                        </button>
                    </SettingRow>
                </div>
            );

        case "audio":
            return (
                <div>
                    <SettingRow label="Sound Effects" description="Play sounds for interactions and events">
                        <Toggle enabled={settings.soundEffects} onChange={(v) => updateSetting("soundEffects", v)} />
                    </SettingRow>
                    <SettingRow label="Volume" description={`Master volume level (${settings.volume}%)`}>
                        <div className="w-32">
                            <Slider value={settings.volume} onChange={(v) => updateSetting("volume", v)} color="#e879f9" />
                        </div>
                    </SettingRow>
                    <SettingRow label="Synthesis Sound" description="Ambient sound during AI processing">
                        <Select value={settings.synthSound} onChange={(v) => updateSetting("synthSound", v as SynthesisSettings["synthSound"])} options={[
                            { label: "None", value: "none" },
                            { label: "Subtle Hum", value: "hum" },
                            { label: "Sci-Fi Pulse", value: "pulse" },
                        ]} />
                    </SettingRow>
                </div>
            );

        case "notifications":
            return (
                <div>
                    <SettingRow label="Notifications" description="Show toast notifications for events">
                        <Toggle enabled={settings.notifs} onChange={(v) => updateSetting("notifs", v)} />
                    </SettingRow>
                    <SettingRow label="Auto-Complete Synthesis" description="Notify when synthesis or agent task finishes">
                        <Toggle enabled={settings.synthComplete} onChange={(v) => updateSetting("synthComplete", v)} />
                    </SettingRow>
                    <SettingRow label="Notification Sound" description="Play sound with notifications">
                        <Toggle enabled={settings.notifSound} onChange={(v) => updateSetting("notifSound", v)} />
                    </SettingRow>
                    <SettingRow label="Position" description="Where notifications appear on screen">
                        <Select value={settings.notifPosition} onChange={(v) => updateSetting("notifPosition", v as SynthesisSettings["notifPosition"])} options={[
                            { label: "Top Right", value: "top-right" },
                            { label: "Top Center", value: "top-center" },
                            { label: "Bottom Right", value: "bottom-right" },
                        ]} />
                    </SettingRow>
                </div>
            );

        case "shortcuts":
            return (
                <div>
                    <SettingRow label="Toggle God Mode" description="Flip all cards to show raw data">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + G</span>
                    </SettingRow>
                    <SettingRow label="New Synthesis" description="Focus the input bar">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + K</span>
                    </SettingRow>
                    <SettingRow label="Switch Space" description="Cycle through spaces">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + 1-3</span>
                    </SettingRow>
                    <SettingRow label="Close Node" description="Close the focused node">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + W</span>
                    </SettingRow>
                    <SettingRow label="Settings" description="Open this settings panel">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + ,</span>
                    </SettingRow>
                    <SettingRow label="Minimize All" description="Minimize all open nodes">
                        <span className="text-[10px] font-mono text-theme-muted bg-theme-surface px-2 py-1 rounded">⌘ + M</span>
                    </SettingRow>
                </div>
            );

        case "account":
            return (
                <div>
                    <SettingRow label="Profile" description="Switch between user profiles (each has its own workspace)">
                        <ProfileSelector />
                    </SettingRow>
                    <AccountPinRow />
                    <SettingRow label="Name" description="How Synthesis OS refers to you">
                        <div className="flex items-center gap-2">
                            <div
                                className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                                aria-hidden
                            >
                                {settings.userName ? settings.userName[0].toUpperCase() : "?"}
                            </div>
                            <input
                                type="text"
                                value={settings.userName}
                                onChange={(e) => updateSetting("userName", e.target.value)}
                                placeholder="Tu nombre…"
                                maxLength={40}
                                className="bg-theme-surface border-theme text-theme-secondary border rounded-lg px-3 py-1.5 text-[11px] outline-none w-36 focus:border-theme transition-colors"
                            />
                        </div>
                    </SettingRow>
                    <SettingRow label="Sync" description="Sync settings across devices">
                        <button className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all">
                            Setup →
                        </button>
                    </SettingRow>
                    <SettingRow label="API Keys" description="Manage keys for cloud AI providers">
                        <button className="px-3 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:text-theme-secondary transition-all">
                            Manage →
                        </button>
                    </SettingRow>
                </div>
            );

        case "agent":
            return (
                <GeneralAgentSection settings={settings} updateSetting={updateSetting} />
            );

        case "tools":
            return <ToolsSection />;

        case "agents":
            return <AgentsSection />;

        case "advanced":
            return (
                <div>
                    <SettingRow label="Debug Mode" description="Show debug logs and performance metrics">
                        <Toggle enabled={settings.debugMode} onChange={(v) => updateSetting("debugMode", v)} />
                    </SettingRow>
                    <SettingRow label="Console Output" description="Log AI interactions to browser console">
                        <Toggle enabled={settings.consoleOutput} onChange={(v) => updateSetting("consoleOutput", v)} />
                    </SettingRow>
                    <SettingRow label="Reset All Settings" description="Restore all settings to defaults">
                        <button type="button" onClick={() => void handleResetSettings()} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 transition-all">
                            Reset →
                        </button>
                    </SettingRow>
                    <SettingRow label="Clear All Data" description="Delete all stored data: workspace (cards, conversation, tasks), kernel memories (LanceDB), and local storage. Settings are NOT affected. This cannot be undone.">
                        <button type="button" onClick={() => void handleClearData()} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 transition-all">
                            Clear All Data
                        </button>
                    </SettingRow>
                    <SettingRow label="Version" description="Synthesis OS build information">
                        <span className="text-[10px] font-mono text-theme-muted">v0.1.0-genesis</span>
                    </SettingRow>
                </div>
            );

        case "memory":
            return <MemorySection />;

        default:
            return null;
    }
}

const SETTINGS_WINDOW_WIDTH = 920;
const SETTINGS_WINDOW_HEIGHT = 640;
const SETTINGS_MIN_WIDTH = 640;
const SETTINGS_MIN_HEIGHT = 480;
/* ─── Manage Spaces Dialog ─── */
function ManageSpacesDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
    const { settings, updateSetting } = useSettings();
    const [newSpaceLabel, setNewSpaceLabel] = useState("");
    const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);

    const handleAddSpace = () => {
        if (!newSpaceLabel.trim()) return;
        const id = newSpaceLabel.toLowerCase().replace(/\s+/g, "-");
        if (settings.spaces.some(s => s.id === id)) return;

        const newSpace = {
            id,
            label: newSpaceLabel,
            icon: "Layers",
            color: "#60a5fa"
        };
        updateSetting("spaces", [...settings.spaces, newSpace]);
        setNewSpaceLabel("");
    };

    const handleDeleteSpace = (id: string) => {
        if (settings.spaces.length <= 1) return;
        updateSetting("spaces", settings.spaces.filter(s => s.id !== id));
        if (settings.defaultSpace === id) {
            updateSetting("defaultSpace", settings.spaces.find(s => s.id !== id)?.id || "");
        }
    };

    const handleUpdateSpace = (id: string, updates: Partial<import("@/types/settings").SpaceDefinition>) => {
        updateSetting("spaces", settings.spaces.map(s => s.id === id ? { ...s, ...updates } : s));
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="relative w-full max-w-md glass-elevated border-theme rounded-3xl overflow-hidden shadow-2xl"
                    >
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-theme-accent">Manage Spaces</h3>
                                <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="space-y-4 max-h-[400px] overflow-y-auto mb-6 pr-2">
                                {settings.spaces.map((s) => (
                                    <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                                            <span className="text-xs font-medium">{s.label}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleDeleteSpace(s.id)}
                                                className="p-1.5 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                                                disabled={settings.spaces.length <= 1}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newSpaceLabel}
                                    onChange={(e) => setNewSpaceLabel(e.target.value)}
                                    placeholder="New space name..."
                                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-theme-accent transition-colors"
                                    onKeyDown={(e) => e.key === "Enter" && handleAddSpace()}
                                />
                                <button
                                    onClick={handleAddSpace}
                                    className="px-4 py-2 bg-theme-accent text-white rounded-xl text-xs font-bold hover:brightness-110 active:scale-95 transition-all"
                                >
                                    Add
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}

/* ─── Main Settings View ─── */
export function SettingsView({ isOpen, onClose, initialSectionId, spaceId, nodes, onCloseNode, onActivateNode, onCleanupStuckNodes, onCloseAllSpaceNodes }: SettingsViewProps) {
    const { settings } = useSettings();
    const { user } = useAuth();
    const [activeSection, setActiveSection] = useState("ai");
    const [manageSpacesOpen, setManageSpacesOpen] = useState(false);
    const visibleSections = useMemo(
        () => SECTIONS.filter((s) => s.id !== "users" || user?.role === "super_admin"),
        [user?.role]
    );
    const [isMaximized, setIsMaximized] = useState(false);
    const [windowSize, setWindowSize] = useState({ w: SETTINGS_WINDOW_WIDTH, h: SETTINGS_WINDOW_HEIGHT });
    const dragControls = useDragControls();
    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const currentSection = visibleSections.find((s) => s.id === activeSection) ?? visibleSections[0];

    useEffect(() => {
        if (!isOpen || !initialSectionId) return;
        if (visibleSections.some((s) => s.id === initialSectionId)) {
            setActiveSection(initialSectionId);
        }
    }, [isOpen, initialSectionId, visibleSections]);

    const getDims = useCallback(() => {
        if (isMaximized) {
            const w = typeof window !== "undefined" ? Math.min(window.innerWidth - 48, 1200) : 960;
            const h = typeof window !== "undefined" ? Math.min(window.innerHeight - 48, 800) : 640;
            return { w, h };
        }
        return { w: windowSize.w, h: windowSize.h };
    }, [isMaximized, windowSize]);

    // Center window when opening or when toggling maximize
    useEffect(() => {
        if (!isOpen) return;
        const { w, h } = getDims();
        const left = typeof window !== "undefined" ? (window.innerWidth - w) / 2 : 0;
        const top = typeof window !== "undefined" ? (window.innerHeight - h) / 2 : 0;
        x.set(left);
        y.set(top);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, isMaximized]);

    const handleDragEnd = useCallback(() => {
        const { w, h } = getDims();
        const maxX = typeof window !== "undefined" ? window.innerWidth - w : 0;
        const maxY = typeof window !== "undefined" ? window.innerHeight - h : 0;
        x.set(Math.max(0, Math.min(maxX, x.get())));
        y.set(Math.max(0, Math.min(maxY, y.get())));
    }, [getDims, x, y]);

    const width = isMaximized ? "min(96vw, 1200px)" : windowSize.w;
    const height = isMaximized ? "min(88vh, 800px)" : windowSize.h;

    const handleResizeStart = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = windowSize.w;
        const startH = windowSize.h;
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            const newW = Math.max(SETTINGS_MIN_WIDTH, Math.min(typeof window !== "undefined" ? window.innerWidth - 48 : 1200, startW + dx));
            const newH = Math.max(SETTINGS_MIN_HEIGHT, Math.min(typeof window !== "undefined" ? window.innerHeight - 48 : 800, startH + dy));
            setWindowSize({ w: newW, h: newH });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [windowSize]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    drag
                    dragControls={dragControls}
                    dragListener={false}
                    dragMomentum={false}
                    onDragEnd={handleDragEnd}
                    style={{
                        position: "fixed",
                        left: 0,
                        top: 0,
                        x,
                        y,
                        width,
                        height,
                        maxWidth: "96vw",
                        maxHeight: "88vh",
                        zIndex: 2001,
                    }}
                    className="overflow-hidden flex border border-theme glass-system-panel"
                >
                    {/* Sidebar */}
                    <div className="w-[220px] shrink-0 border-r border-theme glass-panel-sidebar flex flex-col">
                        {/* Title bar — drag handle + traffic lights */}
                        <div
                            className="px-4 py-3 flex items-center gap-2.5 border-b border-theme cursor-grab active:cursor-grabbing select-none"
                            onPointerDown={(e) => { if ((e.target as HTMLElement).closest("button")) return; dragControls.start(e); }}
                        >
                            <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                                    title="Close"
                                    className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/90 flex items-center justify-center transition-colors shadow-sm"
                                >
                                    <X size={8} strokeWidth={2.5} className="text-red-900/70" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                                    title="Minimize"
                                    className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/90 flex items-center justify-center transition-colors shadow-sm"
                                >
                                    <Minus size={8} strokeWidth={2.5} className="text-amber-900/60" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setIsMaximized((m) => !m); }}
                                    title={isMaximized ? "Restore" : "Maximize"}
                                    className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/90 flex items-center justify-center transition-colors shadow-sm"
                                >
                                    {isMaximized ? <Minimize2 size={8} strokeWidth={2.5} className="text-green-900/70" /> : <Maximize2 size={8} strokeWidth={2.5} className="text-green-900/70" />}
                                </button>
                            </div>
                            <div className="relative w-5 h-5 ml-1 shrink-0">
                                <div
                                    className="w-full h-full rounded-full"
                                    style={{
                                        background: "linear-gradient(135deg, #60a5fa, #818cf8)",
                                        boxShadow: "0 0 12px rgba(96, 165, 250, 0.4)",
                                    }}
                                />
                                <Orbit size={10} className={`absolute inset-0 m-auto text-theme`} strokeWidth={2.5} />
                            </div>
                            <span className={`text-[12px] font-semibold tracking-[0.04em] text-theme truncate`}>Settings</span>
                        </div>

                        {/* Nav */}
                        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5 custom-scrollbar">
                            {visibleSections.map((section) => (
                                <button
                                    key={section.id}
                                    onClick={() => setActiveSection(section.id)}
                                    className={cn(
                                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-200",
                                        activeSection === section.id
                                            ? "bg-theme text-white shadow-sm"
                                            : "text-theme-muted hover:text-theme-secondary hover:bg-theme-surface"
                                    )}
                                    style={activeSection === section.id ? {
                                        backgroundColor: "var(--synthesis-accent)",
                                        boxShadow: "0 2px 8px var(--synthesis-accent-glow)"
                                    } : {}}
                                >
                                    <span
                                        className="shrink-0 transition-colors"
                                        style={{
                                            color: activeSection === section.id ? section.color : undefined,
                                        }}
                                    >
                                        {section.icon}
                                    </span>
                                    <span className="text-[11px] font-medium">{section.label}</span>
                                    {activeSection === section.id && (
                                        <ChevronRight size={10} className="ml-auto opacity-70" />
                                    )}
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex flex-col min-w-0 min-h-0">
                        {/* Content header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-theme shrink-0">
                            <div className="flex items-center gap-2.5">
                                <span style={{ color: currentSection.color }}>{currentSection.icon}</span>
                                <h2 className={`text-[13px] font-semibold text-theme`}>{currentSection.label}</h2>
                            </div>
                        </div>

                        {/* Content body */}
                        <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar select-text relative">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={activeSection}
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    transition={{ duration: 0.15 }}
                                >
                                    <SectionContent
                                        sectionId={activeSection}
                                        nodes={nodes}
                                        onCloseNode={onCloseNode}
                                        onActivateNode={onActivateNode}
                                        onCleanupStuckNodes={onCleanupStuckNodes}
                                        onCloseAllSpaceNodes={onCloseAllSpaceNodes}
                                        setManageSpacesOpen={setManageSpacesOpen}
                                    />
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                    {!isMaximized && (
                        <div
                            onPointerDown={handleResizeStart}
                            className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize flex items-end justify-end p-1"
                            style={{ background: "linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.06) 50%)" }}
                            title="Resize"
                        >
                            <svg width={12} height={12} viewBox="0 0 12 12" className="text-theme-muted shrink-0" fill="currentColor">
                                <path d="M12 12H8v-2h2V8h2v4zM8 8H4V4h4v4zM4 4V2H2v2H0v2h4V4z" />
                            </svg>
                        </div>
                    )}
                </motion.div>
            )}
            <ManageSpacesDialog isOpen={manageSpacesOpen} onClose={() => setManageSpacesOpen(false)} />
        </AnimatePresence>
    );
}
/* ─── Users Section (super_admin: list, impersonate) ─── */
function UsersSection() {
    const { user, impersonating, impersonate, listUsers, logout } = useAuth();
    const { activeProfileId, clearAllProfilesForFirstRun } = useProfile();
    const { settings } = useSettings();
    const setNodes = useNodesStore((s) => s.setNodes);
    const setEdges = useNodesStore((s) => s.setEdges);
    const setActiveNodeId = useNodesStore((s) => s.setActiveNodeId);
    const setConversationHistory = useNodesStore((s) => s.setConversationHistory);
    const setOsConversationHistory = useNodesStore((s) => s.setOsConversationHistory);
    const setTasks = useNodesStore((s) => s.setTasks);
    const [users, setUsers] = useState<ApiUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [resetting, setResetting] = useState(false);
    const [resettingToSetup, setResettingToSetup] = useState(false);

    useEffect(() => {
        let cancelled = false;
        listUsers().then((list) => {
            if (!cancelled) setUsers(Array.isArray(list) ? list : []);
        }).catch(() => {
            if (!cancelled) setUsers([]);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [listUsers]);

    const handleReset = async () => {
        if (!(await confirmDialog("Reset all users and memories? Super admin will be reseeded. This cannot be undone.", "SynthesisOS"))) return;
        setResetting(true);
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("reset_all_data");
            setUsers([]);
            window.location.reload();
        } catch (err) {
            console.error(err);
            alert("Reset failed. May only work in desktop app.");
        } finally {
            setResetting(false);
        }
    };

    const handleResetToSetup = async () => {
        if (!(await confirmDialog("Delete all users and return to initial onboarding? You will have to create a new account.", "SynthesisOS"))) return;
        setResettingToSetup(true);
        try {
            // Clear frontend state BEFORE api call so we don't lose context on reload
            clearAllProfilesForFirstRun();
            if (typeof localStorage !== "undefined") {
                localStorage.removeItem("synthesis_user_profile");
                localStorage.removeItem(WORKSPACE_STORAGE_KEY_LEGACY);
                localStorage.removeItem(getWorkspaceStorageKey(activeProfileId));
            }
            if (typeof sessionStorage !== "undefined") {
                sessionStorage.removeItem(WORKSPACE_STORAGE_KEY_LEGACY);
                sessionStorage.removeItem(getWorkspaceStorageKey(activeProfileId));
                sessionStorage.setItem(FIRST_RUN_SETUP_SESSION_KEY, "account-done");
            }
            if (isIndexedDBAvailable()) {
                await clearStateFromIDB(null);
                if (activeProfileId) await clearStateFromIDB(activeProfileId);
                await clearAllTasksFromIDB();
            }
            setNodes([]);
            setEdges([]);
            setActiveNodeId(null);
            setConversationHistory(Object.fromEntries(settings.spaces.map(s => [s.id, []])));
            setOsConversationHistory([]);
            setTasks(new Map());

            const { apiResetToSetup } = await import("@/lib/apiClient");
            await apiResetToSetup();
            logout();
            window.location.reload();
        } catch (err) {
            console.error(err);
            alert("Error returning to setup.");
        } finally {
            setResettingToSetup(false);
        }
    };

    if (user?.role !== "super_admin") {
        return <div className="p-4 text-theme-muted text-sm">Access denied.</div>;
    }

    return (
        <div className="py-4 space-y-6">
            <div className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold mb-3 text-theme-muted">Users</p>
                {impersonating && (
                    <div className="mb-3 p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-between">
                        <span className="text-[11px] text-amber-200">Impersonating: {impersonating.display_name} ({impersonating.username})</span>
                        <button onClick={() => impersonate(null)} className="px-2 py-1 rounded text-[10px] bg-amber-500/30 hover:bg-amber-500/50 text-white">Stop</button>
                    </div>
                )}
                {loading ? (
                    <p className="text-theme-muted text-sm">Loading...</p>
                ) : (
                    <div className="space-y-2">
                        {users.map((u) => (
                            <div key={u.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-theme-surface border border-theme">
                                <div>
                                    <span className="text-theme font-medium text-[11px]">{u.display_name || u.username}</span>
                                    <span className="text-theme-muted text-[10px] ml-2">@{u.username}</span>
                                    <span className="text-theme-muted text-[9px] ml-2 px-1.5 py-0.5 rounded bg-theme-muted">{u.role}</span>
                                </div>
                                {impersonating?.id === u.id ? (
                                    <button onClick={() => impersonate(null)} className="px-2 py-1 rounded text-[10px] border border-theme text-theme-muted">Stop</button>
                                ) : (
                                    <button onClick={() => impersonate(u)} className="px-2 py-1 rounded text-[10px] bg-theme-accent/80 hover:bg-theme-accent text-white">Impersonate</button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold mb-3 text-theme-muted">Reset</p>
                <p className="text-[11px] text-theme-muted mb-3">Delete all users and memories, reseed super admin. Only available in desktop app.</p>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => void handleReset()} disabled={resetting || resettingToSetup} className="px-3 py-1.5 rounded-lg border border-red-500/30 text-[10px] text-red-400/80 hover:bg-red-500/10 disabled:opacity-50">Reset All Data</button>
                    <button onClick={() => void handleResetToSetup()} disabled={resetting || resettingToSetup} className="px-3 py-1.5 rounded-lg border border-amber-500/30 text-[10px] text-amber-400/80 hover:bg-amber-500/10 disabled:opacity-50">Volver al setup inicial</button>
                </div>
            </div>
        </div>
    );
}

/* ─── Kernel Section (telemetry + configuration) ─── */
function formatUptime(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
}

function KernelSection() {
    const { settings, updateSetting } = useSettings();
    const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
    const [kernelStats, setKernelStats] = useState<{
        uptime_secs: number; total_syscalls: number; active_agents: number;
        llm_avg_latency_ms: number; queue_size: number; policy: string;
    } | null>(null);

    useEffect(() => {
        const refresh = async () => {
            try { setMetrics(getMetrics()); } catch { setMetrics(null); }
            try {
                const { kernelInvoke } = await import("@/lib/apiClient");
                const stats = await kernelInvoke("get_kernel_stats") as {
                    uptime_secs: number; total_syscalls: number; active_agents: number;
                    llm_avg_latency_ms: number; queue_size: number; policy: string;
                };
                setKernelStats(stats);
            } catch { /* Not in Tauri context */ }
        };
        refresh();
        const interval = setInterval(refresh, 2000);
        return () => clearInterval(interval);
    }, []);

    const invokePolicy = async (policy: string) => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("set_scheduler_policy", { policy });
        } catch { /* Not in Tauri context */ }
    };

    const invokeQos = async () => {
        try {
            const pol = settings.kernelSchedulingPolicy;
            let qosType = "none";
            let params: Record<string, number> = {};
            if (pol === "PriorityWithAging") {
                qosType = "priority";
                params = { age_threshold_ms: settings.kernelPriorityAgingThreshold, aging_boost: settings.kernelPriorityAgingBoost };
            } else if (pol === "DeficitRoundRobin") {
                qosType = "drr";
                params = { quantum: settings.kernelDrrQuantum };
            } else if (pol === "WeightedFairQueue") {
                qosType = "wfq";
                params = { default_weight: settings.kernelWfqDefaultWeight };
            }
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("set_qos_params", { qosType, params });
        } catch { /* Not in Tauri context */ }
    };

    const invokeContextDefaults = async () => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("set_context_defaults", {
                maxTokens: settings.kernelDefaultMaxTokens,
                reservedPct: settings.kernelReservedTokenPct,
                autoPrune: settings.kernelAutoPrune,
                autoCompact: settings.kernelAutoCompact,
            });
        } catch { /* Not in Tauri context */ }
    };

    const invokeStorageConfig = async () => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("set_storage_config", {
                autoVersioning: settings.kernelAutoVersioning,
                maxVersions: settings.kernelMaxVersionsPerFile,
            });
        } catch { /* Not in Tauri context */ }
    };

    const invokeMemoryConfig = async () => {
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            await kernelInvoke("set_memory_config", {
                autoTagging: settings.kernelAutoTagging,
                compactionThreshold: settings.kernelCompactionThreshold,
                maxPerAgent: settings.kernelMaxMemoriesPerAgent,
                reflectionEnabled: settings.kernelReflectionEnabled,
                reflectionIntervalMins: settings.kernelReflectionIntervalMins,
                reflectionModel: settings.kernelReflectionModel || "gpt-5-mini",
            });
        } catch { /* Not in Tauri context */ }
    };

    return (
        <div className="py-4 space-y-6">
            {/* ── A. Kernel Dashboard ── */}
            <section className="glass-grouped-section p-4 space-y-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider">Kernel Dashboard</p>

                {kernelStats ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px] font-mono">
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">Uptime</span>
                            <span className="text-theme">{formatUptime(kernelStats.uptime_secs * 1000)}</span>
                        </div>
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">Total Syscalls</span>
                            <span className="text-theme">{kernelStats.total_syscalls.toLocaleString()}</span>
                        </div>
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">Active Agents</span>
                            <span className="text-theme">{kernelStats.active_agents}</span>
                        </div>
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">LLM Latency</span>
                            <span className="text-theme">{kernelStats.llm_avg_latency_ms.toFixed(0)}ms</span>
                        </div>
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">Queue Size</span>
                            <span className="text-theme">{kernelStats.queue_size}</span>
                        </div>
                        <div className="rounded-lg bg-theme/30 px-3 py-2">
                            <span className="text-theme-muted block text-[9px]">Policy</span>
                            <span className="text-theme text-[10px]">{kernelStats.policy}</span>
                        </div>
                    </div>
                ) : (
                    <p className="text-[10px] text-theme-secondary italic">Waiting for kernel connection…</p>
                )}

                {/* Agent-level metrics from JS side */}
                {metrics && (
                    <div className="pt-3 border-t border-theme/10">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
                            <div className="rounded-lg bg-theme/30 px-3 py-2">
                                <span className="text-theme-muted block text-[9px]">Tasks</span>
                                <span className="text-theme">{metrics.tasksCompleted}/{metrics.tasksStarted}</span>
                                {metrics.tasksFailed > 0 && (
                                    <span className="text-red-400/90 ml-1 text-[9px]">({metrics.tasksFailed} failed)</span>
                                )}
                            </div>
                            <div className="rounded-lg bg-theme/30 px-3 py-2">
                                <span className="text-theme-muted block text-[9px]">Avg Steps</span>
                                <span className="text-theme">{metrics.avgStepsPerTask.toFixed(1)}</span>
                            </div>
                            <div className="rounded-lg bg-theme/30 px-3 py-2">
                                <span className="text-theme-muted block text-[9px]">Avg Duration</span>
                                <span className="text-theme">{metrics.avgDurationMs >= 1000 ? `${(metrics.avgDurationMs / 1000).toFixed(1)}s` : `${Math.round(metrics.avgDurationMs)}ms`}</span>
                            </div>
                            <div className="rounded-lg bg-theme/30 px-3 py-2">
                                <span className="text-theme-muted block text-[9px]">Approval Rate</span>
                                <span className="text-theme">{(metrics.approvalRate * 100).toFixed(0)}%</span>
                            </div>
                        </div>
                        {Object.keys(metrics.toolCallCounts).length > 0 && (
                            <div className="mt-3">
                                <span className="text-[10px] text-theme-muted block mb-1">Tool Calls</span>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(metrics.toolCallCounts).map(([id, count]) => {
                                        const rate = metrics.toolSuccessRates[id];
                                        const pct = rate != null ? `${(rate * 100).toFixed(0)}%` : "–";
                                        return (
                                            <span key={id} className="text-[9px] font-mono px-2 py-0.5 rounded bg-theme/20 text-theme">
                                                {id}: {count} ({pct})
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {!metrics && (
                    <p className="text-[10px] text-theme-secondary">No agent metrics yet. Run a task to see telemetry.</p>
                )}
            </section>

            {/* ── B. Scheduler Configuration ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Scheduler</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    The scheduler is the heart of the kernel. It decides in what order syscalls from agents get processed.
                    Different policies trade off fairness, latency, and throughput. FIFO is the simplest; advanced QoS policies
                    prevent any single agent from starving the others.
                </p>

                <SettingRow
                    label="Scheduling Policy"
                    description="How the kernel orders pending syscalls. FIFO processes in arrival order (simple, fast). Round Robin gives each agent equal turns. WFQ assigns weighted bandwidth shares. DRR allocates deficit-based credits per round. Priority+Aging processes high-priority first but gradually boosts old requests to prevent starvation."
                >
                    <Select
                        value={settings.kernelSchedulingPolicy}
                        options={[
                            { label: "FIFO", value: "FIFO" },
                            { label: "Round Robin", value: "RoundRobin" },
                            { label: "Weighted Fair Queue", value: "WeightedFairQueue" },
                            { label: "Deficit Round Robin", value: "DeficitRoundRobin" },
                            { label: "Priority + Aging", value: "PriorityWithAging" },
                        ]}
                        onChange={(v) => {
                            updateSetting("kernelSchedulingPolicy", v as typeof settings.kernelSchedulingPolicy);
                            invokePolicy(v);
                        }}
                    />
                </SettingRow>

                <SettingRow
                    label="Max Queue Size"
                    description="Maximum number of pending syscalls the kernel will hold before applying backpressure. If the queue fills up, new requests are rejected with a 'queue full' error instead of buffering forever. Lower values protect memory but may reject bursts; higher values absorb spikes but use more RAM."
                >
                    <div className="flex items-center gap-2 w-40">
                        <Slider value={settings.kernelMaxQueueSize} onChange={(v) => updateSetting("kernelMaxQueueSize", v)} min={10} max={500} />
                        <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelMaxQueueSize}</span>
                    </div>
                </SettingRow>

                {/* Conditional: PriorityWithAging */}
                {settings.kernelSchedulingPolicy === "PriorityWithAging" && (
                    <>
                        <SettingRow
                            label="Age Threshold (ms)"
                            description="How long a low-priority syscall must wait (in milliseconds) before the kernel starts boosting its priority. This is the anti-starvation mechanism: without it, low-priority requests could wait forever if high-priority ones keep arriving. Lower = more aggressive anti-starvation."
                        >
                            <div className="flex items-center gap-2 w-40">
                                <Slider value={settings.kernelPriorityAgingThreshold} onChange={(v) => { updateSetting("kernelPriorityAgingThreshold", v); invokeQos(); }} min={100} max={5000} />
                                <span className="text-[10px] text-theme-muted w-12 text-right font-mono">{settings.kernelPriorityAgingThreshold}ms</span>
                            </div>
                        </SettingRow>
                        <SettingRow
                            label="Aging Boost"
                            description="How many priority levels to add each time an aged request gets boosted. A boost of 1 is gentle (takes many cycles to promote); a boost of 5-10 is aggressive (old requests quickly jump to the front). Tune based on how many priority levels your agents use."
                        >
                            <div className="flex items-center gap-2 w-40">
                                <Slider value={settings.kernelPriorityAgingBoost} onChange={(v) => { updateSetting("kernelPriorityAgingBoost", v); invokeQos(); }} min={1} max={10} />
                                <span className="text-[10px] text-theme-muted w-6 text-right font-mono">{settings.kernelPriorityAgingBoost}</span>
                            </div>
                        </SettingRow>
                    </>
                )}

                {/* Conditional: DeficitRoundRobin */}
                {settings.kernelSchedulingPolicy === "DeficitRoundRobin" && (
                    <SettingRow
                        label="DRR Quantum"
                        description="Credits each agent receives per scheduling round. Each syscall 'costs' a certain amount of credits; when an agent runs out, it waits for the next round. Higher quantum = agents can send more syscalls per round (bursty). Lower quantum = stricter fairness but more scheduling overhead."
                    >
                        <div className="flex items-center gap-2 w-40">
                            <Slider value={settings.kernelDrrQuantum} onChange={(v) => { updateSetting("kernelDrrQuantum", v); invokeQos(); }} min={100} max={10000} />
                            <span className="text-[10px] text-theme-muted w-12 text-right font-mono">{settings.kernelDrrQuantum}</span>
                        </div>
                    </SettingRow>
                )}

                {/* Conditional: WeightedFairQueue */}
                {settings.kernelSchedulingPolicy === "WeightedFairQueue" && (
                    <SettingRow
                        label="Default Weight"
                        description="Base weight assigned to each agent in the Weighted Fair Queue. Agents with higher weight get proportionally more scheduling bandwidth. For example, a weight of 2.0 gets twice the throughput of 1.0. Use this to give critical agents (like the Manager) more resources than background workers."
                    >
                        <div className="flex items-center gap-2 w-40">
                            <Slider value={Math.round(settings.kernelWfqDefaultWeight * 10)} onChange={(v) => { updateSetting("kernelWfqDefaultWeight", v / 10); invokeQos(); }} min={1} max={100} />
                            <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelWfqDefaultWeight.toFixed(1)}</span>
                        </div>
                    </SettingRow>
                )}
            </section>

            {/* ── C. Context Window Defaults ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Context Window</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    Each agent maintains a context window — the conversation history the LLM sees when making decisions.
                    These settings control how much memory each agent gets and what happens when it fills up.
                    Larger windows give agents better recall but cost more tokens per LLM call.
                </p>

                <SettingRow
                    label="Default Max Tokens"
                    description="Total token budget per agent. This is the maximum number of tokens (roughly 0.75 words each) that an agent's context window can hold, including system prompt, conversation history, and tool results. 4096 is minimal, 8192 is balanced, 16384+ is for complex multi-step tasks that need deep history."
                >
                    <div className="flex items-center gap-2 w-44">
                        <Slider value={settings.kernelDefaultMaxTokens} onChange={(v) => { updateSetting("kernelDefaultMaxTokens", v); invokeContextDefaults(); }} min={2048} max={32768} />
                        <span className="text-[10px] text-theme-muted w-14 text-right font-mono">{settings.kernelDefaultMaxTokens.toLocaleString()}</span>
                    </div>
                </SettingRow>

                <SettingRow
                    label="Reserved Tokens (%)"
                    description="Percentage of the token budget permanently reserved for the system prompt and response format instructions. The agent can never use these tokens for conversation history. 10% is the default; increase if your specialist prompts are very long, decrease if you need more room for conversation."
                >
                    <div className="flex items-center gap-2 w-40">
                        <Slider value={settings.kernelReservedTokenPct} onChange={(v) => { updateSetting("kernelReservedTokenPct", v); invokeContextDefaults(); }} min={5} max={25} />
                        <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelReservedTokenPct}%</span>
                    </div>
                </SettingRow>

                <SettingRow
                    label="Auto-Prune"
                    description="When the context window exceeds its token budget, automatically drop the oldest messages to make room. Without this, agents will fail with 'context too long' errors. Recommended ON unless you want manual control over what stays in context."
                >
                    <Toggle enabled={settings.kernelAutoPrune} onChange={(v) => { updateSetting("kernelAutoPrune", v); invokeContextDefaults(); }} />
                </SettingRow>

                <SettingRow
                    label="Auto-Compact"
                    description="Instead of simply dropping old messages, summarize them into a compressed 'memory checkpoint' before removing them. Preserves key information from earlier in the conversation at the cost of a small extra LLM call. Best for long-running research tasks where historical context matters."
                >
                    <Toggle enabled={settings.kernelAutoCompact} onChange={(v) => { updateSetting("kernelAutoCompact", v); invokeContextDefaults(); }} />
                </SettingRow>
            </section>

            {/* ── D. Agent Runtime Defaults ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Agent Runtime</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    Controls how agents reason and execute tasks. The strategy determines the agent's thinking loop — how it decides
                    what tool to use next and when to stop.
                </p>

                <SettingRow
                    label="Default Strategy"
                    description="ReAct: Think-Act loop — the agent reasons about what to do, executes one tool, observes the result, then reasons again. Fast and simple, best for most tasks. Plan & Execute: The agent first creates a full plan of steps, then executes them one by one. Better for complex multi-step tasks but slower to start. Multi-Agent: Delegates subtasks to child agents that work in parallel. Best for broad research queries that can be split into independent parts."
                >
                    <Select
                        value={settings.kernelDefaultAgentStrategy}
                        options={[
                            { label: "ReAct", value: "ReAct" },
                            { label: "Plan & Execute", value: "PlanAndExecute" },
                            { label: "Multi-Agent", value: "MultiAgent" },
                        ]}
                        onChange={(v) => updateSetting("kernelDefaultAgentStrategy", v as typeof settings.kernelDefaultAgentStrategy)}
                    />
                </SettingRow>
            </section>

            {/* ── E. Storage Configuration ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Storage (LSFS)</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    The Local Storage File System (LSFS) is the kernel's SQLite-backed virtual filesystem.
                    Agents use it to persist files, notes, and data across sessions. Every write can create a new version,
                    enabling rollback to any previous state — like Git for agent data.
                </p>

                <SettingRow
                    label="Auto-Versioning"
                    description="When enabled, every file write creates a new version in the database instead of overwriting the previous content. This allows agents (and you) to rollback to any historical state. Disabling saves disk space but makes file changes irreversible."
                >
                    <Toggle enabled={settings.kernelAutoVersioning} onChange={(v) => { updateSetting("kernelAutoVersioning", v); invokeStorageConfig(); }} />
                </SettingRow>

                <SettingRow
                    label="Max Versions per File"
                    description="How many historical versions to keep per file before the oldest are pruned. A value of 5 means you can rollback up to 5 writes ago. Higher values use more disk space but give you a deeper undo history. Set to 1 to effectively disable versioning while keeping the latest snapshot."
                >
                    <div className="flex items-center gap-2 w-40">
                        <Slider value={settings.kernelMaxVersionsPerFile} onChange={(v) => { updateSetting("kernelMaxVersionsPerFile", v); invokeStorageConfig(); }} min={1} max={100} />
                        <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelMaxVersionsPerFile}</span>
                    </div>
                </SettingRow>
            </section>

            {/* ── F. Memory Configuration ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Memory</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    The memory subsystem stores agent observations, learnings, and extracted knowledge as structured entries with
                    keywords, tags, and similarity scores. Unlike the context window (which resets per task), memories persist across
                    tasks and enable agents to recall past experiences.
                </p>

                <SettingRow
                    label="Auto-Tagging"
                    description="Automatically extract keywords and assign tags (error, success, warning, task, note) to new memories using word-frequency analysis. This makes memories searchable and enables the agentic pipeline to find related past experiences. Disabling means memories are stored as raw text without metadata."
                >
                    <Toggle enabled={settings.kernelAutoTagging} onChange={(v) => { updateSetting("kernelAutoTagging", v); invokeMemoryConfig(); }} />
                </SettingRow>

                <SettingRow
                    label="Compaction Threshold (%)"
                    description="When an agent's memory store reaches this percentage of its maximum capacity, the kernel triggers automatic compaction — merging redundant memories that share >50% keyword overlap. Lower thresholds compact more aggressively (keeps memory lean but may lose nuance); higher thresholds let memories accumulate longer before merging."
                >
                    <div className="flex items-center gap-2 w-40">
                        <Slider value={settings.kernelCompactionThreshold} onChange={(v) => { updateSetting("kernelCompactionThreshold", v); invokeMemoryConfig(); }} min={50} max={95} />
                        <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelCompactionThreshold}%</span>
                    </div>
                </SettingRow>

                <SettingRow
                    label="Max Memories per Agent"
                    description="Hard limit on the number of memory entries each agent can store. Prevents unbounded memory growth from long-running agents. When the limit is reached, new memories trigger compaction first; if still full, the oldest low-access-count entries are evicted. 500 is conservative, 2000+ is for agents that need deep recall."
                >
                    <div className="flex items-center gap-2 w-44">
                        <Slider value={settings.kernelMaxMemoriesPerAgent} onChange={(v) => { updateSetting("kernelMaxMemoriesPerAgent", v); invokeMemoryConfig(); }} min={100} max={10000} />
                        <span className="text-[10px] text-theme-muted w-14 text-right font-mono">{settings.kernelMaxMemoriesPerAgent.toLocaleString()}</span>
                    </div>
                </SettingRow>
            </section>

            {/* ── G. Conscious Memory & Reflection ── */}
            <section className="glass-grouped-section p-4">
                <p className="text-[11px] font-semibold text-theme-muted uppercase tracking-wider mb-1">Conscious Memory (Sleep-time)</p>
                <p className="text-[10px] text-theme-secondary mb-3 leading-relaxed">
                    This allows agents to actively self-manage their identity and learn from paged-out context.
                    Sleep-time Reflection triggers a background consolidation pass that extracts persistent insights from archived conversation turns.
                </p>

                <SettingRow
                    label="Background Reflection"
                    description="Enable a periodic background process that reviews 'subconscious' (archived) memory blocks to extract new permanent facts and preferences about you."
                >
                    <Toggle enabled={settings.kernelReflectionEnabled} onChange={(v) => { updateSetting("kernelReflectionEnabled", v); invokeMemoryConfig(); }} />
                </SettingRow>

                {settings.kernelReflectionEnabled && (
                    <>
                        <SettingRow
                            label="Reflection Interval (mins)"
                            description="How often the background reflection kernel runs. Shorter intervals mean faster learning but more background compute usage."
                        >
                            <div className="flex items-center gap-2 w-40">
                                <Slider value={settings.kernelReflectionIntervalMins} onChange={(v) => { updateSetting("kernelReflectionIntervalMins", v); invokeMemoryConfig(); }} min={10} max={1440} />
                                <span className="text-[10px] text-theme-muted w-8 text-right font-mono">{settings.kernelReflectionIntervalMins}m</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Reflection Model"
                            description="The model used for the consolidation processes. A balanced model like gpt-5-mini is recommended for cost/efficiency."
                        >
                            <Select
                                value={settings.kernelReflectionModel}
                                options={[
                                    { label: "gpt-5-mini", value: "gpt-5-mini" },
                                    { label: "gpt-4o", value: "gpt-4o" },
                                    { label: "llama3.2:latest", value: "llama3.2:latest" },
                                ]}
                                onChange={(v) => { updateSetting("kernelReflectionModel", v); invokeMemoryConfig(); }}
                            />
                        </SettingRow>
                    </>
                )}
            </section>

            {/* ── Storage (LSFS) browser ── */}
            <StorageBrowser />
        </div>
    );
}

function StorageBrowser() {
    const [path, setPath] = useState("/");
    const [entries, setEntries] = useState<Array<{ name: string; is_dir: boolean; size: number; modified: number }>>([]);
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadList = useCallback(async () => {
        setLoading(true);
        setError(null);
        setContent(null);
        try {
            const { kernelInvoke } = await import("@/lib/apiClient");
            const list = (await kernelInvoke<unknown[]>("list_storage", { path })) as Array<{ name?: string; is_dir?: boolean; size?: number; modified?: number }>;
            setEntries(Array.isArray(list) ? list.map((e) => ({ name: e.name ?? "", is_dir: e.is_dir ?? false, size: e.size ?? 0, modified: e.modified ?? 0 })) : []);
        } catch (e) {
            setError(String(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [path]);

    useEffect(() => { void loadList(); }, [loadList]);

    const readFile = async (filePath: string) => {
        setLoading(true);
        setError(null);
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const fullPath = path === "/" ? filePath : `${path}/${filePath}`.replace(/\/+/g, "/");
            const { kernelInvoke } = await import("@/lib/apiClient");
            const text = (await kernelInvoke<string>("read_storage", { path: fullPath })) as string;
            setContent(text);
        } catch (e) {
            setError(String(e));
            setContent(null);
        } finally {
            setLoading(false);
        }
    };

    const openDir = (name: string) => {
        const next = path === "/" ? `/${name}` : `${path}/${name}`.replace(/\/+/g, "/");
        setPath(next);
    };

    return (
        <section className="glass-grouped-section p-4 mt-4">
            <p className="text-[11px] font-semibold mb-3 text-theme-muted uppercase tracking-wider">Storage (LSFS)</p>
            <p className="text-[10px] text-theme-secondary mb-3">Versioned file system used by agents. Paths are under agent namespace &quot;settings&quot; for this browser.</p>
            <div className="flex gap-2 mb-3">
                <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="/"
                    className="flex-1 rounded-lg border border-theme bg-theme-surface text-theme text-[11px] px-2 py-1.5 font-mono"
                />
                <button type="button" onClick={() => void loadList()} className="px-2 py-1.5 rounded-lg border border-theme text-[10px] text-theme-muted hover:bg-theme-muted">List</button>
            </div>
            {error && <p className="text-[10px] text-red-400 mb-2">{error}</p>}
            {loading && <p className="text-[10px] text-theme-muted">Loading…</p>}
            <div className="space-y-1 max-h-48 overflow-y-auto">
                {path !== "/" && (
                    <button type="button" onClick={() => setPath(path.split("/").filter(Boolean).slice(0, -1).join("/") || "/")} className="text-[10px] text-theme-accent">..</button>
                )}
                {entries.map((e) => (
                    <div key={e.name} className="flex items-center gap-2 text-[10px]">
                        {e.is_dir ? (
                            <button type="button" onClick={() => openDir(e.name)} className="text-theme-accent hover:underline">{e.name}/</button>
                        ) : (
                            <button type="button" onClick={() => readFile(e.name)} className="text-theme hover:underline">{e.name}</button>
                        )}
                        <span className="text-theme-muted">{e.is_dir ? "" : `${e.size ?? 0} B`}</span>
                    </div>
                ))}
            </div>
            {content !== null && (
                <div className="mt-3 p-2 rounded-lg bg-theme-surface border border-theme max-h-40 overflow-y-auto">
                    <p className="text-[10px] font-medium text-theme-muted mb-1">File content</p>
                    <pre className="text-[10px] text-theme whitespace-pre-wrap break-words">{content}</pre>
                    <button type="button" onClick={() => setContent(null)} className="mt-1 text-[10px] text-theme-muted hover:text-theme">Close</button>
                </div>
            )}
            {!loading && entries.length === 0 && path === "/" && !error && <p className="text-[10px] text-theme-muted">Storage empty or not initialized. Agents create files when using storage_* tools.</p>}
        </section>
    );
}

function ToolsSection() {
    const { settings, updateSetting } = useSettings();
    const [kernelTools, setKernelTools] = useState<Array<{ id: string; desc: string }> | null>(null);

    const normalizeKernelToolDefs = (defs: unknown): Array<{ id: string; desc: string }> => {
        const list = Array.isArray(defs)
            ? defs
            : (defs && typeof defs === "object" && Array.isArray((defs as { tools?: unknown[] }).tools))
                ? (defs as { tools: unknown[] }).tools
                : [];
        return list
            .map((d: any) => {
                const fn = d?.function;
                const id =
                    typeof fn?.name === "string" ? fn.name.trim()
                        : typeof d?.id === "string" ? d.id.trim()
                            : typeof d?.name === "string" ? d.name.trim()
                                : "";
                const desc =
                    typeof fn?.description === "string" ? fn.description.trim()
                        : typeof d?.desc === "string" ? d.desc.trim()
                            : typeof d?.description === "string" ? d.description.trim()
                                : "";
                return { id, desc };
            })
            .filter((t: { id: string }) => t.id.length > 0);
    };

    useEffect(() => {
        let cancelled = false;
        const fetchKernelTools = async () => {
            try {
                const { kernelInvoke } = await import("@/lib/apiClient");
                const defs = await kernelInvoke<unknown>("get_all_tools");
                const parsed = normalizeKernelToolDefs(defs);
                if (!cancelled) setKernelTools(parsed);
            } catch (err) {
                console.error("Failed to fetch kernel tools for settings:", err);
                if (!cancelled) setKernelTools([]);
            }
        };
        fetchKernelTools();
        return () => { cancelled = true; };
    }, []);

    const BASE_TOOL_CATEGORIES = [
        {
            name: "Web & Research",
            color: "#a78bfa",
            tools: [
                { id: "web_search", name: "Web Search", desc: "Real-time search via DuckDuckGo", approval: false },
                { id: "read_page", name: "Read Page", desc: "Extract full text from any URL", approval: false },
                { id: "web_scrape", name: "Web Scrape", desc: "Fetch raw page text/HTML for a URL", approval: false },
                { id: "summarize_url", name: "Summarize URL", desc: "Deep summary of any web page", approval: false },
                { id: "http_request", name: "HTTP Request", desc: "Call external APIs with custom method/body", approval: true },
                { id: "search_images", name: "Image Search", desc: "Find images and visual assets", approval: false },
                { id: "youtube_search", name: "YouTube Search", desc: "Search and list YouTube videos", approval: false },
                { id: "rss_reader", name: "RSS Reader", desc: "Read RSS and Atom feeds", approval: false },
                { id: "weather", name: "Weather", desc: "Current weather for cities", approval: false },
            ],
        },
        {
            name: "Knowledge & Utilities",
            color: "#818cf8",
            tools: [
                { id: "calculate", name: "Calculator", desc: "Math expressions and numeric ops", approval: false },
                { id: "currency_convert", name: "Currency Convert", desc: "Convert between currencies", approval: false },
                { id: "define_word", name: "Define Word", desc: "Dictionary definitions", approval: false },
                { id: "translate", name: "Translate", desc: "Text translation", approval: false },
                { id: "current_time", name: "Current Time", desc: "Local date/time query", approval: false },
                { id: "qr_code", name: "QR Code", desc: "Generate QR code payloads", approval: false },
            ],
        },
        {
            name: "System Control",
            color: "#fb923c",
            tools: [
                { id: "clipboard_read", name: "Clipboard Read", desc: "Read system clipboard content", approval: true },
                { id: "clipboard_write", name: "Clipboard Write", desc: "Write text to system clipboard", approval: true },
                { id: "notify", name: "Notifications", desc: "Send macOS notifications", approval: false },
                { id: "open_app", name: "Open App/URL", desc: "Open apps, URLs, or files", approval: true },
                { id: "say_tts", name: "Text-to-Speech", desc: "Speak text with macOS TTS", approval: true },
                { id: "take_screenshot", name: "Screenshot", desc: "Capture desktop screenshots", approval: true },
                { id: "search_files", name: "Search Files", desc: "Search filesystem paths by pattern", approval: false },
                { id: "set_timer", name: "Set Timer", desc: "Create a system timer/reminder", approval: false },
                { id: "get_system_info", name: "System Info", desc: "CPU, memory, OS details", approval: false },
                { id: "get_spatial_bounds", name: "Spatial Bounds", desc: "Read 3D window positions", approval: false },
                { id: "get_volume", name: "Get Volume", desc: "Read output volume", approval: false },
                { id: "set_volume", name: "Set Volume", desc: "Set output volume level", approval: true },
                { id: "get_brightness", name: "Get Brightness", desc: "Read screen brightness", approval: false },
                { id: "set_brightness", name: "Set Brightness", desc: "Set screen brightness", approval: true },
                { id: "toggle_dark_mode", name: "Toggle Dark Mode", desc: "Toggle macOS dark mode", approval: true },
                { id: "get_battery", name: "Battery Info", desc: "Battery status and health", approval: false },
                { id: "get_wifi", name: "WiFi Info", desc: "Current network details", approval: false },
            ],
        },
        {
            name: "macOS Apps",
            color: "#f43f5e",
            tools: [
                { id: "notes_list", name: "Notes List", desc: "List notes from Apple Notes", approval: true },
                { id: "notes_read", name: "Notes Read", desc: "Read a note from Apple Notes", approval: true },
                { id: "notes_create", name: "Notes Create", desc: "Create note in Apple Notes", approval: true },
                { id: "email_list", name: "Email List", desc: "Read emails from Apple Mail", approval: true },
                { id: "calendar_today", name: "Calendar Today", desc: "List today's events", approval: true },
                { id: "calendar_create", name: "Calendar Create", desc: "Create event in Calendar", approval: true },
                { id: "reminders_list", name: "Reminders List", desc: "List Apple Reminders", approval: true },
                { id: "reminders_add", name: "Reminders Add", desc: "Create reminder item", approval: true },
                { id: "contacts_search", name: "Contacts Search", desc: "Search Apple Contacts", approval: true },
                { id: "music_play", name: "Music Play", desc: "Play in Apple Music", approval: true },
                { id: "music_pause", name: "Music Pause", desc: "Pause Apple Music", approval: true },
                { id: "music_next", name: "Music Next", desc: "Skip track in Apple Music", approval: true },
                { id: "finder_open", name: "Finder Open", desc: "Open path in Finder", approval: true },
                { id: "finder_trash", name: "Finder Trash", desc: "Move file to trash", approval: true },
                { id: "safari_tabs", name: "Safari Tabs", desc: "Inspect open Safari tabs", approval: true },
            ],
        },
        {
            name: "Storage (LSFS)",
            color: "#38bdf8",
            tools: [
                { id: "storage_read", name: "Storage Read", desc: "Read file from versioned storage", approval: false },
                { id: "storage_write", name: "Storage Write", desc: "Write file in versioned storage", approval: true },
                { id: "storage_create", name: "Storage Create", desc: "Create file/dir in versioned storage", approval: true },
                { id: "storage_list", name: "Storage List", desc: "List versioned storage directory", approval: false },
                { id: "storage_delete", name: "Storage Delete", desc: "Delete file/dir from versioned storage", approval: true },
                { id: "storage_versions", name: "Storage Versions", desc: "Inspect version history", approval: false },
                { id: "storage_rollback", name: "Storage Rollback", desc: "Rollback file to old version", approval: true },
            ],
        },
        {
            name: "Filesystem",
            color: "#e879f9",
            tools: [
                { id: "read_file", name: "Read File (Sandbox)", desc: "Read file from sandboxed path", approval: false },
                { id: "file_read_full", name: "File Read Full", desc: "Read full file from macOS filesystem", approval: true },
                { id: "dir_list", name: "Directory List", desc: "List directory entries on macOS filesystem", approval: true },
                { id: "file_write", name: "File Write", desc: "Create/overwrite file on macOS filesystem", approval: true },
                { id: "file_append", name: "File Append", desc: "Append content to file", approval: true },
                { id: "file_move", name: "File Move", desc: "Move or rename filesystem file", approval: true },
                { id: "file_copy", name: "File Copy", desc: "Copy filesystem file", approval: true },
            ],
        },
    ];

    const inferApproval = (toolId: string): boolean => {
        if (
            toolId.includes("write")
            || toolId.includes("create")
            || toolId.includes("delete")
            || toolId.includes("rollback")
            || toolId.includes("move")
            || toolId.includes("copy")
            || toolId.startsWith("set_")
            || toolId === "toggle_dark_mode"
            || toolId === "open_app"
            || toolId === "take_screenshot"
            || toolId === "say_tts"
            || toolId.startsWith("finder_")
            || toolId.startsWith("calendar_create")
            || toolId.startsWith("reminders_add")
        ) {
            return true;
        }
        return false;
    };

    const humanizeToolName = (toolId: string): string =>
        toolId
            .split("_")
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(" ");

    const TOOL_CATEGORIES = useMemo(() => {
        const safeKernelTools = Array.isArray(kernelTools) ? kernelTools : [];
        if (safeKernelTools.length === 0) {
            return BASE_TOOL_CATEGORIES;
        }

        const kernelDesc = new Map(safeKernelTools.map((t) => [t.id, t.desc] as const));
        const mapped = BASE_TOOL_CATEGORIES
            .map((category) => ({
                ...category,
                tools: category.tools
                    .filter((tool) => kernelDesc.has(tool.id))
                    .map((tool) => ({ ...tool, desc: kernelDesc.get(tool.id) || tool.desc })),
            }))
            .filter((category) => category.tools.length > 0);

        const knownIds = new Set(mapped.flatMap((c) => c.tools.map((t) => t.id)));
        const extras = safeKernelTools
            .filter((tool) => !knownIds.has(tool.id))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((tool) => ({
                id: tool.id,
                name: humanizeToolName(tool.id),
                desc: tool.desc || "Kernel tool",
                approval: inferApproval(tool.id),
            }));

        if (extras.length > 0) {
            mapped.push({
                name: "Kernel (Unmapped)",
                color: "#94a3b8",
                tools: extras,
            });
        }

        return mapped;
    }, [kernelTools]);

    const disabledTools = Array.isArray(settings.disabledTools) ? settings.disabledTools : [];
    const isToolDisabled = (toolId: string) => disabledTools.includes(toolId);
    const knownToolIds = new Set(TOOL_CATEGORIES.flatMap((c) => c.tools.map((t) => t.id)));
    const toggleTool = (toolId: string) => {
        const current = disabledTools;
        if (current.includes(toolId)) {
            updateSetting("disabledTools", current.filter((t: string) => t !== toolId));
        } else {
            updateSetting("disabledTools", [...current, toolId]);
        }
    };

    const totalTools = TOOL_CATEGORIES.reduce((sum, c) => sum + c.tools.length, 0);
    const disabledKnownCount = disabledTools.filter((id) => knownToolIds.has(id)).length;
    const enabledCount = totalTools - disabledKnownCount;

    return (
        <div className="py-4 space-y-4">
            <div className="flex items-center justify-between px-1 pb-2 border-b border-theme">
                <p className={`text-[11px] text-theme-muted`}>
                    {enabledCount} of {totalTools} tools active
                </p>
                <button
                    onClick={() => updateSetting("disabledTools", [])}
                    className="text-[10px] px-2 py-1 rounded-lg transition-colors text-theme-muted hover:text-theme-secondary hover:bg-theme-muted"
                >
                    Enable All
                </button>
            </div>

            {TOOL_CATEGORIES.map((category) => (
                <section
                    key={category.name}
                    className={`glass-grouped-section p-4`}
                >
                    <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ background: category.color }} />
                        <p className="text-[11px] font-semibold text-theme-muted">
                            {category.name}
                        </p>
                        <span className={`text-[9px] ml-auto text-theme-muted`}>
                            {category.tools.filter((t) => !isToolDisabled(t.id)).length}/{category.tools.length}
                        </span>
                    </div>
                    <div className="space-y-0.5">
                        {category.tools.map((tool) => (
                            <div
                                key={tool.id}
                                className={`flex items-center justify-between py-2 px-2 rounded-lg transition-colors ${isToolDisabled(tool.id)
                                    ? "opacity-40"
                                    : "hover:bg-theme-surface"
                                    }`}
                            >
                                <div className="flex-1 min-w-0 pr-3">
                                    <div className="flex items-center gap-2">
                                        <p className={`text-[11px] font-medium text-theme`}>
                                            {tool.name}
                                        </p>
                                        {tool.approval && (
                                            <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-amber-500/15 text-amber-400/80 border border-amber-500/15">
                                                APPROVAL
                                            </span>
                                        )}
                                    </div>
                                    <p className={`text-[10px] mt-0.5 text-theme-muted`}>
                                        {tool.desc}
                                    </p>
                                </div>
                                <Toggle
                                    enabled={!isToolDisabled(tool.id)}
                                    onChange={() => toggleTool(tool.id)}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
