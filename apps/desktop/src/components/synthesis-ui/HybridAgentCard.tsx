"use client";

import React, { useMemo, useCallback, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    ShieldAlert,
    MessageCircle,
    ChevronDown,
    ChevronUp,
    Brain,
    Send,
    Zap,
    Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getToolIcon, getToolLabel } from "./HybridAgentCard/constants";
import type { AgentTask, AgentStep } from "@/lib/agent/types";
import type { UIBlock } from "@/types/synthesis";
import type { ReasoningTimelineEntry } from "@/types/synthesis";
import { getToolMeta } from "@/lib/agent/intermediateBlocks";
import { A2UIRenderer, renderBlock } from "@/lib/a2ui";
import type { A2UIState } from "@/lib/a2ui";
import { CardSkeleton } from "./CardSkeleton";

// ── Types ──

interface HybridAgentCardProps {
    task?: AgentTask;
    blocks: UIBlock[];
    title: string;
    summary: string;
    streamingReasoning?: string;
    streamingContent?: string;
    /** Completed reasoning segments, shown as collapsible timeline */
    reasoningTimeline?: ReasoningTimelineEntry[];
    design?: {
        accent_color: string;
        vibe: string;
        text_style: "sans" | "mono" | "serif";
        glass_opacity: number;
    };
    compact?: boolean;
    themeCategory?: "light" | "dark";
    /** A2UI streaming state — always active */
    a2uiState?: A2UIState | null;
    onCancel?: (taskId: string) => void;
    onApprove?: (taskId: string, stepId: string) => void;
    onReject?: (taskId: string, stepId: string) => void;
    onAnswer?: (taskId: string, stepId: string, answer: string) => void;
    /** Called when user submits from the card footer input to continue the conversation */
    onContinueConversation?: (message: string) => void;
    /** Whether this card is the active/focused one (shows footer input when true and completed) */
    isActive?: boolean;
}

// ── Phase detection from logs/reasoning ──

interface AgentPhase {
    phase: "booting" | "reasoning" | "executing" | "synthesizing";
    label: string;
    detail: string;
    icon: React.ReactNode;
}

/** Semantic labels from Rust kernel (for example, short human-readable phrases like "Searching the web"). */
function isSemanticStatus(reasoning: string): boolean {
    if (!reasoning || reasoning.length > 80) return false;
    const lower = reasoning.toLowerCase();
    if (lower.includes("content:") || lower.includes("tool_call:") || lower.includes("reasoning about")) return false;
    if (lower.startsWith("executing tool:")) return false;
    if (lower.includes("{") && lower.includes("}")) return false;
    return true;
}

function detectPhase(
    steps: AgentStep[],
    latestStep: AgentStep | null,
    streamingReasoning?: string,
    isRunning?: boolean,
): AgentPhase {
    const toolSteps = steps.filter(s => s.type === "tool_call");
    const completedTools = toolSteps.filter(s => s.status === "completed");

    // Extract phase info from step reasoning messages
    const allReasonings = steps.map(s => s.reasoning || "").filter(Boolean);
    const lastReasoning = allReasonings[allReasonings.length - 1] || "";

    // PRIORITY: semantic status from kernel (e.g. "Buscando en la web", "Revisando calendario")
    if (isRunning && lastReasoning && isSemanticStatus(lastReasoning)) {
        return {
            phase: "reasoning",
            label: lastReasoning,
            detail: lastReasoning,
            icon: <Brain className="w-3.5 h-3.5" />,
        };
    }

    // Check if we have streaming reasoning — show brief status, not raw stream snippet
    if (streamingReasoning && streamingReasoning.trim().length > 0 && isRunning) {
        const hasSemantic = allReasonings.some(r => isSemanticStatus(r));
        return {
            phase: "reasoning",
            label: hasSemantic ? lastReasoning || "Processing" : "Reasoning",
            detail: hasSemantic ? lastReasoning : "Analyzing context...",
            icon: <Brain className="w-3.5 h-3.5" />,
        };
    }

    // Check for specific status messages
    if (lastReasoning.includes("Reasoning about next steps")) {
        return {
            phase: "reasoning",
            label: "Reasoning",
            detail: "Analyzing context and planning next action...",
            icon: <Brain className="w-3.5 h-3.5" />,
        };
    }

    // Check for tool selection (Tool RAG)
    if (lastReasoning.includes("Selecting tools") || lastReasoning.includes("Recalling context")) {
        return {
            phase: "reasoning",
            label: "Preparing",
            detail: lastReasoning.includes("Selecting tools")
                ? "Selecting relevant tools for your request..."
                : "Recalling relevant context...",
            icon: <Brain className="w-3.5 h-3.5" />,
        };
    }

    // Check for tool execution
    if (latestStep?.type === "tool_call" && latestStep.status === "running") {
        const meta = getToolMeta(latestStep.toolName || "");
        return {
            phase: "executing",
            label: meta.label,
            detail: meta.describeInput && latestStep.toolInput
                ? meta.describeInput(latestStep.toolInput)
                : `Running ${meta.label}...`,
            icon: <Wrench className="w-3.5 h-3.5" />,
        };
    }

    // Multiple tools completed — might be synthesizing
    if (completedTools.length > 0 && !latestStep?.toolName) {
        return {
            phase: "synthesizing",
            label: "Synthesizing",
            detail: `Combining results from ${completedTools.length} tool${completedTools.length > 1 ? "s" : ""}...`,
            icon: <Zap className="w-3.5 h-3.5" />,
        };
    }

    // Default: booting
    if (steps.length === 0) {
        return {
            phase: "booting",
            label: "Starting",
            detail: "Initializing agent...",
            icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
        };
    }

    return {
        phase: "reasoning",
        label: "Processing",
        detail: "Working on your request...",
        icon: <Brain className="w-3.5 h-3.5" />,
    };
}

// ── Compact Step Indicator with better labels ──

function CompactStep({ step, isLight }: { step: AgentStep; isLight: boolean }) {
    const isRunning = step.status === "running";
    const isCompleted = step.status === "completed";
    const isFailed = step.status === "failed";
    const label = getToolLabel(step.toolName);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium shrink-0",
                isLight
                    ? isRunning ? "bg-blue-100 text-blue-700"
                        : isCompleted ? "bg-emerald-100 text-emerald-700"
                            : isFailed ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-600"
                    : isRunning ? "bg-blue-500/15 text-blue-400"
                        : isCompleted ? "bg-emerald-500/15 text-emerald-400"
                            : isFailed ? "bg-red-500/15 text-red-400"
                                : "bg-white/5 text-white/50",
            )}
            title={label}
        >
            {isRunning && (
                <motion.div
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                >
                    <Loader2 className="w-2.5 h-2.5" />
                </motion.div>
            )}
            {isCompleted && <CheckCircle2 className="w-2.5 h-2.5" />}
            {isFailed && <XCircle className="w-2.5 h-2.5" />}
            {!isRunning && !isCompleted && !isFailed && getToolIcon(step.toolName)}
            <span className="truncate max-w-[100px]">
                {label}
            </span>
        </motion.div>
    );
}

// ── Approval Buttons with tool input context ──

function InlineApproval({
    step,
    isLight,
    onApprove,
    onReject,
}: {
    step: AgentStep;
    isLight: boolean;
    onApprove?: (stepId: string) => void;
    onReject?: (stepId: string) => void;
}) {
    const [decided, setDecided] = useState(false);
    const toolLabel = getToolLabel(step.toolName);

    if (decided) {
        return (
            <div className="flex items-center gap-1.5 py-2 px-3">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                <span className={cn("text-[11px]", isLight ? "text-emerald-600" : "text-emerald-400/70")}>
                    Processing...
                </span>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "flex flex-col gap-2 p-3 rounded-xl border",
                isLight
                    ? "bg-amber-50 border-amber-200"
                    : "bg-amber-500/10 border-amber-500/20",
            )}
        >
            <div className="flex items-center gap-2">
                <ShieldAlert className={cn("w-4 h-4", isLight ? "text-amber-600" : "text-amber-400")} />
                <span className={cn("text-xs font-semibold", isLight ? "text-amber-800" : "text-amber-300")}>
                    Approval Required
                </span>
            </div>
            <div className="space-y-1.5">
                <p className={cn("text-[11px] font-medium", isLight ? "text-amber-700" : "text-amber-200/80")}>
                    {toolLabel}
                </p>
                {step.toolInput && (
                    <p className={cn("text-[10px] font-mono", isLight ? "text-amber-600/70" : "text-amber-200/50")}>
                        {step.toolInput.length > 100 ? `${step.toolInput.slice(0, 100)}…` : step.toolInput}
                    </p>
                )}
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => { setDecided(true); onApprove?.(step.id); }}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 active:scale-95 transition-all"
                >
                    Approve
                </button>
                <button
                    onClick={() => { setDecided(true); onReject?.(step.id); }}
                    className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 active:scale-95 transition-all"
                >
                    Reject
                </button>
            </div>
        </motion.div>
    );
}

// ── Answer Input (inline) ──

function InlineAnswer({
    step,
    isLight,
    onAnswer,
}: {
    step: AgentStep;
    isLight: boolean;
    onAnswer?: (stepId: string, answer: string) => void;
}) {
    const [value, setValue] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const handleSubmit = () => {
        if (value.trim() && onAnswer) {
            setSubmitted(true);
            onAnswer(step.id, value.trim());
        }
    };

    if (submitted) {
        return (
            <div className="flex items-center gap-1.5 py-2 px-3">
                <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                <span className={cn("text-[11px]", isLight ? "text-violet-600" : "text-violet-400/70")}>
                    Processing...
                </span>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                "flex flex-col gap-2 p-3 rounded-xl border",
                isLight
                    ? "bg-violet-50 border-violet-200"
                    : "bg-violet-500/10 border-violet-500/20",
            )}
        >
            <div className="flex items-center gap-2">
                <MessageCircle className={cn("w-4 h-4", isLight ? "text-violet-600" : "text-violet-400")} />
                <span className={cn("text-xs font-semibold", isLight ? "text-violet-800" : "text-violet-300")}>
                    Agent Question
                </span>
            </div>
            <p className={cn("text-[12px] leading-snug", isLight ? "text-violet-700" : "text-white/90")}>
                {step.reasoning?.replace("Question for user: ", "").trim()}
            </p>
            {/* Quick options */}
            {step.options && step.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {step.options.map((opt) => (
                        <button
                            key={opt}
                            onClick={() => { setSubmitted(true); onAnswer?.(step.id, opt); }}
                            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/40 active:scale-95 transition-all"
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}
            {/* Free text */}
            <div className="flex gap-1.5">
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                    placeholder="Type your answer..."
                    className={cn(
                        "flex-1 px-2.5 py-1.5 text-[11px] rounded-lg border focus:outline-none transition-colors",
                        isLight
                            ? "bg-white border-violet-200 text-violet-900 placeholder:text-violet-400 focus:border-violet-400"
                            : "bg-white/5 border-violet-500/30 text-white/80 placeholder:text-white/30 focus:border-violet-500/60",
                    )}
                />
                <button
                    onClick={handleSubmit}
                    disabled={!value.trim()}
                    className="px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                    <Send className="w-3 h-3" />
                </button>
            </div>
        </motion.div>
    );
}

// ── Card footer: continue conversation input ──

function CardContinueInput({
    onSubmit,
    isLight,
    compact,
}: {
    onSubmit: (message: string) => void;
    isLight: boolean;
    compact: boolean;
}) {
    const [value, setValue] = useState("");

    const handleSubmit = () => {
        const trimmed = value.trim();
        if (trimmed) {
            onSubmit(trimmed);
            setValue("");
        }
    };

    return (
        <div
            className={cn(
                "shrink-0 flex items-center gap-2 px-3 py-2 border-t",
                isLight ? "border-slate-200/50 bg-slate-50/50" : "border-white/5 bg-white/[0.02]",
            )}
        >
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                }}
                placeholder="Continue the conversation..."
                className={cn(
                    "flex-1 px-2.5 py-1.5 rounded-lg border outline-none transition-colors",
                    compact ? "text-[11px]" : "text-xs",
                    isLight
                        ? "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-blue-400"
                        : "bg-white/5 border-white/10 text-white/90 placeholder:text-white/40 focus:border-white/30",
                )}
                aria-label="Continue the conversation"
            />
            <button
                type="button"
                onClick={handleSubmit}
                disabled={!value.trim()}
                className={cn(
                    "shrink-0 p-1.5 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                    isLight
                        ? "bg-blue-500/20 text-blue-600 hover:bg-blue-500/30"
                        : "bg-white/10 text-white/80 hover:bg-white/20",
                )}
                aria-label="Send"
            >
                <Send className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

// ── Live Reasoning Stream with Typewriter Effect ──

function LiveReasoningStream({ text, isLight }: { text: string; isLight: boolean }) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [text]);

    // Clean up the raw text - remove JSON artifacts, tool call syntax
    const cleanText = useMemo(() => {
        let cleaned = text;
        // Remove JSON-like tool call patterns
        cleaned = cleaned.replace(/TOOL_CALL:\s*\[[\s\S]*?\]/g, "");
        // Remove markdown artifacts
        cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
        // Trim and clean whitespace
        cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
        return cleaned || "Analyzing context...";
    }, [text]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className={cn(
                "rounded-xl border p-3 max-h-[160px] overflow-y-auto relative",
                isLight
                    ? "bg-blue-50/50 border-blue-200/30 ring-1 ring-blue-500/5"
                    : "bg-blue-500/5 border-blue-500/10 ring-1 ring-blue-500/10",
            )}
            ref={scrollRef}
        >
            <div className="flex items-center justify-between gap-1.5 mb-1.5 border-b pb-1.5 border-blue-500/10">
                <div className="flex items-center gap-1.5 ">
                    <Brain className={cn("w-3 h-3", isLight ? "text-blue-500" : "text-blue-400")} />
                    <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider",
                        isLight ? "text-blue-600" : "text-blue-300"
                    )}>
                        Internal Thought Stream
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                    </span>
                    <span className={cn("text-[9px] font-medium", isLight ? "text-blue-500" : "text-blue-400/80")}>LIVE</span>
                </div>
            </div>

            <div className={cn(
                "text-[11px] leading-relaxed font-mono whitespace-pre-wrap",
                isLight ? "text-slate-600" : "text-blue-100/70"
            )}>
                {cleanText}
                <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className={cn("inline-block w-1 h-3 ml-0.5 align-middle", isLight ? "bg-blue-500" : "bg-blue-400")}
                />
            </div>
        </motion.div>
    );
}

// ── Collapsible Reasoning Timeline ──

function cleanReasoningText(text: string): string {
    return text
        .replace(/TOOL_CALL:\s*\[[\s\S]*?\]/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function ReasoningTimeline({
    entries,
    isLight,
}: {
    entries: ReasoningTimelineEntry[];
    isLight: boolean;
}) {
    // Last item expanded by default, others collapsed
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
        entries.length > 0 ? new Set([entries[entries.length - 1].id]) : new Set()
    );

    // When a new thought is added, collapse previous and expand the latest
    useEffect(() => {
        if (entries.length > 0) {
            const lastId = entries[entries.length - 1].id;
            setExpandedIds((prev) => (prev.has(lastId) && prev.size === 1 ? prev : new Set([lastId])));
        }
    }, [entries.length, entries[entries.length - 1]?.id]);

    const toggle = useCallback((id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    if (entries.length === 0) return null;

    return (
        <div className="space-y-0">
            <div className="flex items-center gap-1.5 mb-2">
                <Brain className={cn("w-3 h-3", isLight ? "text-blue-600" : "text-blue-400")} />
                <span className={cn(
                    "text-[10px] font-semibold uppercase tracking-wider",
                    isLight ? "text-blue-700" : "text-blue-300"
                )}>
                    Reasoning Timeline
                </span>
            </div>
            <div className="relative pl-4 border-l-2 border-blue-500/20 space-y-1">
                {entries.map((entry, i) => {
                    const isExpanded = expandedIds.has(entry.id);
                    const cleaned = cleanReasoningText(entry.text);
                    const preview = cleaned.length > 120 ? cleaned.slice(0, 120) + "..." : cleaned;
                    return (
                        <motion.div
                            key={entry.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={cn(
                                "relative -left-[17px] rounded-lg border overflow-hidden",
                                isLight ? "bg-slate-50/80 border-slate-200/60" : "bg-white/5 border-white/10"
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => toggle(entry.id)}
                                className={cn(
                                    "w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
                                    isLight ? "hover:bg-slate-100/80" : "hover:bg-white/10"
                                )}
                            >
                                <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500/60 ring-2 ring-blue-500/20" />
                                <span className={cn(
                                    "text-[10px] font-medium truncate flex-1",
                                    isLight ? "text-slate-600" : "text-white/70"
                                )}>
                                    {entry.label || `Thought ${i + 1}`}
                                </span>
                                {isExpanded ? (
                                    <ChevronUp className="w-3 h-3 shrink-0 text-blue-500/60" />
                                ) : (
                                    <ChevronDown className="w-3 h-3 shrink-0 text-blue-500/60" />
                                )}
                            </button>
                            <AnimatePresence initial={false}>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden"
                                    >
                                        <div className={cn(
                                            "px-2.5 py-2 pt-0 text-[11px] font-mono leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto",
                                            isLight ? "text-slate-600" : "text-white/70"
                                        )}>
                                            {cleaned || "(empty)"}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            {!isExpanded && cleaned && (
                                <div className={cn(
                                    "px-2.5 pb-1.5 pt-0 text-[10px] font-mono truncate",
                                    isLight ? "text-slate-500" : "text-white/50"
                                )} title={cleaned}>
                                    {preview}
                                </div>
                            )}
                        </motion.div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Phase-Aware Thinking Display ──

function PhaseIndicator({
    phase,
    isLight,
    isStreaming
}: {
    phase: AgentPhase;
    isLight: boolean;
    isStreaming?: boolean;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.3 }}
            className={cn(
                "flex flex-col gap-3 py-4 px-3",
            )}
        >
            {/* Phase icon + label */}
            <div className="flex items-center justify-center gap-2">
                <motion.div
                    animate={phase.phase === "booting" ? undefined : {
                        scale: [1, 1.1, 1],
                        opacity: [0.7, 1, 0.7],
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className={cn(
                        "p-2 rounded-xl",
                        isLight
                            ? "bg-blue-100 text-blue-600"
                            : "bg-blue-500/15 text-blue-400",
                    )}
                >
                    {phase.icon}
                </motion.div>
                <div className="flex flex-col">
                    <span className={cn(
                        "text-xs font-semibold",
                        isLight ? "text-slate-700" : "text-white/80",
                    )}>
                        {phase.label}
                    </span>
                    {!isStreaming && (
                        <span className={cn(
                            "text-[10px]",
                            isLight ? "text-slate-400" : "text-white/35",
                        )}>
                            {phase.detail}
                        </span>
                    )}
                </div>
            </div>

            {/* Animated pipeline dots */}
            <div className="flex items-center justify-center gap-1.5">
                {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                        key={i}
                        className={cn(
                            "w-1 h-1 rounded-full",
                            isLight ? "bg-blue-400" : "bg-blue-400/60",
                        )}
                        animate={{
                            scale: [0.5, 1.2, 0.5],
                            opacity: [0.3, 1, 0.3],
                        }}
                        transition={{
                            duration: 1.5,
                            repeat: Infinity,
                            ease: "easeInOut",
                            delay: i * 0.15,
                        }}
                    />
                ))}
            </div>
        </motion.div>
    );
}

// ── Compact Phase Bar (shown in header when blocks are visible) ──

function PhaseBar({ phase, isLight }: { phase: AgentPhase; isLight: boolean }) {
    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 border-b",
                isLight
                    ? "bg-blue-50/30 border-blue-100/30"
                    : "bg-blue-500/5 border-blue-500/10",
            )}
        >
            <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className={cn(
                    isLight ? "text-blue-500" : "text-blue-400",
                )}
            >
                {phase.icon}
            </motion.div>
            <span className={cn(
                "text-[10px] font-medium",
                isLight ? "text-blue-600" : "text-blue-400/80",
            )}>
                {phase.detail}
            </span>
        </motion.div>
    );
}

// ── Reasoning Display with animation ──

function ReasoningDisplay({
    reasoning,
    toolInput,
    toolName,
    isLight,
    isStreaming,
}: {
    reasoning?: string;
    toolInput?: string;
    toolName?: string;
    isLight: boolean;
    isStreaming: boolean;
}) {
    const hasReasoning = reasoning && reasoning.trim().length > 0 && !isStreaming;
    const hasInput = toolInput && toolInput.trim().length > 0;

    if (!hasReasoning && !hasInput) return null;

    const label = toolName
        ? `Planning: ${getToolLabel(toolName)}`
        : "Reasoning";

    // Suppress boilerplate reasoning when it's just telling us it's thinking
    const cleanReasoning = reasoning?.trim() || "";
    const isBoilerplate =
        cleanReasoning === "" ||
        cleanReasoning.includes("Reasoning about next steps") ||
        cleanReasoning.toLowerCase().startsWith("thinking") ||
        cleanReasoning.toLowerCase().startsWith("selecting tools") ||
        cleanReasoning.toLowerCase().startsWith("recalling context");

    if (!hasInput && (isBoilerplate || isStreaming)) return null;

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className={cn(
                "px-3 py-2 rounded-lg border",
                isLight
                    ? "bg-slate-50/50 border-slate-200/30 text-slate-600"
                    : "bg-white/5 border-white/10 text-white/60",
            )}
        >
            {hasReasoning && (
                <div className="space-y-1">
                    <p className={cn("text-[10px] font-semibold", isLight ? "text-slate-500" : "text-white/50")}>
                        {label}
                    </p>
                    <p className={cn("text-[11px] leading-relaxed font-mono", isLight ? "text-slate-600" : "text-white/70")}>
                        {reasoning.length > 300 ? reasoning.slice(0, 300) + "..." : reasoning}
                    </p>
                </div>
            )}
            {hasInput && (
                <div className="space-y-1 mt-2">
                    <p className={cn("text-[10px] font-semibold", isLight ? "text-slate-500" : "text-white/50")}>
                        Input:
                    </p>
                    <p className={cn("text-[10px] font-mono truncate", isLight ? "text-slate-500" : "text-white/50")}>
                        {toolInput.length > 150 ? `${toolInput.slice(0, 150)}…` : toolInput}
                    </p>
                </div>
            )}
        </motion.div>
    );
}

// ── Main HybridAgentCard ──

export const HybridAgentCard = React.memo(function HybridAgentCard({
    task,
    blocks,
    title,
    summary,
    streamingReasoning,
    streamingContent,
    reasoningTimeline,
    design,
    compact = false,
    themeCategory = "dark",
    a2uiState,
    onCancel,
    onApprove,
    onReject,
    onAnswer,
    onContinueConversation,
    isActive = false,
}: HybridAgentCardProps) {
    const [timelineExpanded, setTimelineExpanded] = useState(false);
    const isLight = themeCategory === "light";
    const accentColor = design?.accent_color || "#A78BFA";

    const steps = useMemo(() => task?.steps ?? [], [task?.steps]);
    const isRunning = task?.status === "running" || task?.status === "planning";
    const isWaiting = task?.status === "waiting_approval" || task?.status === "waiting_answer";

    const completedSteps = useMemo(() => steps.filter((s) => s.status === "completed").length, [steps]);
    const maxSteps = task?.config?.maxSteps || 10;
    const progress = maxSteps > 0 ? Math.min(100, (completedSteps / maxSteps) * 100) : 0;

    // Find pending approval/answer step
    const pendingApprovalStep = useMemo(
        () => steps.find((s) => s.status === "waiting_approval"),
        [steps],
    );
    const pendingAnswerStep = useMemo(
        () => steps.find((s) => s.status === "waiting_answer"),
        [steps],
    );

    // Latest active step for display (with reasoning)
    const latestStep = useMemo(() => {
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].status === "running" || steps[i].status === "completed") {
                return steps[i];
            }
        }
        return steps[steps.length - 1] || null;
    }, [steps]);

    // Detect current agent phase
    const currentPhase = useMemo(
        () => detectPhase(steps, latestStep, streamingReasoning, isRunning),
        [steps, latestStep, streamingReasoning, isRunning],
    );

    const handleApprove = useCallback(
        (stepId: string) => { if (task) onApprove?.(task.id, stepId); },
        [task, onApprove],
    );
    const handleReject = useCallback(
        (stepId: string) => { if (task) onReject?.(task.id, stepId); },
        [task, onReject],
    );
    const handleAnswer = useCallback(
        (stepId: string, answer: string) => { if (task) onAnswer?.(task.id, stepId, answer); },
        [task, onAnswer],
    );

    // Detect whether A2UI content has been received (A2UI is always active).
    const hasA2UIContent = !!(a2uiState?.rootId && a2uiState?.surfaceId);

    // Collect all A2UI components across all surfaces into a flat array
    const allA2UIComponents = useMemo(() => {
        if (!a2uiState?.componentMap) return [];
        return Object.values(a2uiState.componentMap).flatMap((surfaceMap) =>
            Object.values(surfaceMap || {})
        );
    }, [a2uiState?.componentMap]);

    // A2UI has a ListBlock/DataGrid when we have curated news/info; otherwise we may only have raw Feed.
    const hasA2UIList = useMemo(() => {
        return allA2UIComponents.some((c: any) =>
            c?.component && (
                "ListBlock" in (c.component as object) ||
                "DataGrid" in (c.component as object) ||
                c.component.type === "list_block" ||
                c.component.type === "data_grid"
            )
        );
    }, [allA2UIComponents]);

    // A2UI has actual data to render — when dataModel is empty, A2UIRenderer returns null
    // and we must NOT filter legacy blocks or the card would appear empty on completion
    const a2UIHasData = useMemo(() => {
        if (!a2uiState?.surfaceId || !a2uiState?.dataModel) return false;
        const surfaceData = a2uiState.dataModel[a2uiState.surfaceId];
        if (!surfaceData || typeof surfaceData !== "object") return false;
        return Object.keys(surfaceData).length > 0;
    }, [a2uiState?.surfaceId, a2uiState?.dataModel]);

    // Filter blocks: only show non-empty blocks; suppress redundant or verbose ones.
    // When A2UI has content WITH DATA, exclude legacy blocks that duplicate it (e.g. image_gallery).
    // If A2UI structure exists but dataModel is empty, A2UIRenderer returns null — keep legacy blocks.
    const visibleBlocks = useMemo(() => {
        const hasA2UIGallery = a2UIHasData && allA2UIComponents.some((c: any) =>
            c?.component && ("ImageGallery" in (c.component as object) || c.component.type === "image_gallery")
        );
        const suppressLegacyList = a2UIHasData && hasA2UIList;

        return (blocks || []).filter((b: any) => {
            // Avoid duplicate gallery when A2UI already renders one with real data
            if (hasA2UIGallery && b.type === "image_gallery") return false;

            if (b.type === "callout" && b.content) {
                const content = String(b.content || "").trim();
                const title = String(b.title || "").trim().toLowerCase();
                // Redundant: set_volume OK when we already have a friendly confirmation
                if (content === "OK" && (title === "set_volume" || b._toolName === "set_volume")) return false;
                // Raw Feed dump from rss_reader
                if (/^Feed \(\d+ entries\):/.test(content)) return false;
            }
            if (b.type === "text_block" && b.content) {
                const content = String(b.content || "").trim();
                // Hide raw Feed dump only when A2UI has curated list/grid with data; otherwise show it
                if (suppressLegacyList && /^Feed \(\d+ entries\):/.test(content)) return false;
            }
            if (b.type && b.type !== "callout") return true;
            if (b.type === "callout" && b.content) return true;
            return false;
        });
    }, [blocks, allA2UIComponents, hasA2UIList, a2UIHasData]);

    // Extract a "working message" from A2UI State, legacy blocks, or title/summary
    const currentActionText = React.useMemo(() => {
        if (!isRunning && !isWaiting) return null;

        if (hasA2UIContent && allA2UIComponents.length > 0) {
            const callouts = allA2UIComponents.filter((c: any) => c.component && ("Callout" in (c.component as any) || c.component.type === "callout"));
            if (callouts.length > 0) {
                const props = (callouts[0] as any).component.Callout || (callouts[0] as any).component;
                if (props?.content && props.content !== "OK") return props.content;
            }
        }

        const legacyCallout = visibleBlocks.find(b => b.type === "callout" || (b as any).Callout) as any;
        if (legacyCallout) {
            const content = legacyCallout.content || legacyCallout.Callout?.content || legacyCallout.text;
            if (content && content !== "OK") return content;
        }

        if (currentPhase.detail && currentPhase.detail !== "OK") {
            return currentPhase.detail;
        }

        return null;
    }, [isRunning, isWaiting, hasA2UIContent, allA2UIComponents, visibleBlocks, currentPhase.detail]);

    const statusLabel = task?.status || "running";
    const statusColor = isLight
        ? statusLabel === "waiting_approval" ? "bg-amber-100 text-amber-700"
            : statusLabel === "waiting_answer" ? "bg-violet-100 text-violet-700"
                : "bg-blue-100 text-blue-700"
        : statusLabel === "waiting_approval" ? "bg-amber-500/20 text-amber-400"
            : statusLabel === "waiting_answer" ? "bg-violet-500/20 text-violet-400"
                : "bg-blue-500/20 text-blue-400";

    // Scroll to bottom ref for blocks area
    const blocksEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        blocksEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [visibleBlocks.length]);

    // Header section with optional CardHeader-like summary
    const fontClass = {
        sans: "font-sans",
        mono: "font-mono",
        serif: "font-serif",
    }[design?.text_style || "sans"];

    const isThinking = !!(streamingReasoning && streamingReasoning.length > 0) && isRunning;

    return (
        <motion.div
            className={cn(
                "flex flex-col h-full transition-all duration-700 rounded-xl overflow-hidden",
                fontClass
            )}
            animate={isThinking ? {
                boxShadow: isLight
                    ? `0 0 12px ${design?.accent_color}40, inset 0 0 0 1px ${design?.accent_color}60`
                    : `0 0 15px ${design?.accent_color}35, inset 0 0 0 1px ${design?.accent_color}50`
            } : {
                boxShadow: "0 0 0px transparent, inset 0 0 0 0px transparent"
            }}
        >
            {/* ── Compact Header: Status + Progress ── */}
            <div className={cn(
                "shrink-0 border-b",
                isLight ? "border-slate-200/50" : "border-white/5",
            )}>
                <div className="flex items-center justify-between px-3 py-1.5">
                    <div className="flex items-center gap-2">
                        {(isRunning || isWaiting) && (
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            >
                                <Loader2 className={cn(
                                    "w-3.5 h-3.5",
                                    isLight ? "text-blue-500" : "text-blue-400",
                                )} />
                            </motion.div>
                        )}
                        <span className={cn(
                            "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
                            statusColor,
                        )}>
                            {(isRunning || isWaiting) ? currentPhase.label : statusLabel.replace(/_/g, " ")}
                        </span>
                        {/* Show extracted action text when running; short summary when completed */}
                        {isRunning && currentActionText && (
                            <span className={cn(
                                "text-[11px] truncate max-w-[280px] ml-1",
                                isLight ? "text-slate-600" : "text-white/60",
                            )} title={currentActionText}>
                                {currentActionText.replace(/^(\(i\) |ℹ️ )/, "")}
                            </span>
                        )}
                        {!isRunning && !isWaiting && summary && (
                            <span className={cn(
                                "text-[11px] truncate max-w-[280px] ml-1",
                                isLight ? "text-slate-600" : "text-white/60",
                            )} title={summary}>
                                {summary.length > 80 ? summary.slice(0, 80) + "..." : summary}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {(isRunning || isWaiting) && onCancel && task && (
                            <button
                                onClick={() => onCancel(task.id)}
                                className={cn(
                                    "text-[10px] transition-colors",
                                    isLight ? "text-slate-400 hover:text-red-500" : "text-white/40 hover:text-red-400",
                                )}
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>

                {/* Progress bar: indeterminate sweeping animation always when running */}
                <div className={cn("h-0.5 relative overflow-hidden", isLight ? "bg-slate-100" : "bg-white/5")}>
                    {isRunning && (
                        <motion.div
                            className="absolute inset-0 h-full w-1/2 bg-gradient-to-r from-transparent via-blue-500/60 to-transparent"
                            initial={{ x: "-100%" }}
                            animate={{ x: "200%" }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                    )}
                </div>
            </div>
            {/* ── Phase bar when blocks are visible and agent is running ── */}
            {/* Disabled: The user requested to keep only the compact sweeping header. */}

            {/* ── Dynamic Content Area: Growing Blocks ── */}
            <div className={cn(
                "flex-1 min-h-0 overflow-y-auto overscroll-contain",
                "scrollbar-thin scrollbar-track-transparent",
                isLight
                    ? "scrollbar-thumb-slate-300/30 hover:scrollbar-thumb-slate-400/40"
                    : "scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20",
            )}>
                <div className={compact ? "px-3 py-2 space-y-2" : "px-4 py-3 space-y-3"}>

                    {/* Approval/Answer prompts take priority */}
                    {pendingApprovalStep && (
                        <InlineApproval
                            step={pendingApprovalStep}
                            isLight={isLight}
                            onApprove={handleApprove}
                            onReject={handleReject}
                        />
                    )}
                    {pendingAnswerStep && (
                        <InlineAnswer
                            step={pendingAnswerStep}
                            isLight={isLight}
                            onAnswer={handleAnswer}
                        />
                    )}



                    {/* Progressive blocks: A2UI or legacy */}
                    <AnimatePresence mode="popLayout">
                        <div className={cn(
                            isRunning && currentActionText ? "[&_.a2ui-callout]:hidden" : ""
                        )}>
                            {hasA2UIContent && a2uiState && (
                                <A2UIRenderer
                                    state={a2uiState}
                                    isLight={isLight}
                                    accentColor={accentColor}
                                    compact={compact}
                                />
                            )}

                            {/* Always render legacy blocks too, in case A2UI state lags behind tool execution */}
                            {visibleBlocks.map((block: any, idx: number) => {
                                const content = renderBlock(block, idx, isLight, accentColor);
                                if (!content) return null;
                                return (
                                    <motion.div
                                        key={block._toolStepId || block._toolName || `block-${idx}`}
                                        initial={{ opacity: 0, y: 12, filter: "blur(3px)" }}
                                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                                        exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
                                        transition={{ duration: 0.35, ease: "easeOut" }}
                                        layout
                                    >
                                        {content}
                                    </motion.div>
                                );
                            })}
                        </div>



                        {/* Live content stream (final answer being typed) - suppress if A2UI is active */}
                        {streamingContent && streamingContent.trim().length > 0 && isRunning && !hasA2UIContent && (
                            <motion.div
                                key="live-content"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className={cn(
                                    "p-3 rounded-xl border",
                                    isLight ? "bg-white border-slate-200" : "bg-white/5 border-white/10"
                                )}
                            >
                                <div className={cn("text-xs leading-relaxed", isLight ? "text-slate-700" : "text-white/80")}>
                                    {streamingContent}
                                    <motion.span
                                        animate={{ opacity: [1, 0] }}
                                        transition={{ duration: 0.8, repeat: Infinity }}
                                        className="inline-block w-1 h-3 ml-1 bg-current align-middle"
                                    />
                                </div>
                            </motion.div>
                        )}

                        {/* Skeleton when waiting for first content; PhaseIndicator for other empty states */}
                        {!hasA2UIContent && visibleBlocks.length === 0 && !streamingReasoning && !streamingContent && (
                            isRunning ? (
                                <CardSkeleton key="skeleton" isLight={isLight} compact={compact} />
                            ) : (
                                <PhaseIndicator key="phase" phase={currentPhase} isLight={isLight} isStreaming={false} />
                            )
                        )}
                    </AnimatePresence>

                    {/* Scroll anchor */}
                    <div ref={blocksEndRef} />
                </div>
            </div>

            {/* ── Footer input: continue conversation (only when completed and active) ── */}
            {onContinueConversation && isActive && !isRunning && !isWaiting && (
                <CardContinueInput
                    onSubmit={onContinueConversation}
                    isLight={isLight}
                    compact={compact}
                />
            )}
        </motion.div>
    );
});


