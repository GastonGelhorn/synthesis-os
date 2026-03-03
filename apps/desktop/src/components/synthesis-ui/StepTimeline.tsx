"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Search,
    Globe,
    Code,
    StickyNote,
    Timer,
    Send,
    BookOpen,
    ShieldAlert,
    Brain,
    ChevronDown,
    ChevronRight,
    RotateCcw,
    Clock,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentStep, AgentStepStatus } from "@/lib/agent/types";

interface StepTimelineProps {
    steps: AgentStep[];
    detailed?: boolean;
    onRetryFromStep?: (stepIndex: number) => void;
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
    web_search: <Search className="w-3.5 h-3.5" />,
    read_page: <Globe className="w-3.5 h-3.5" />,
    web_scrape: <Globe className="w-3.5 h-3.5" />,
    http_request: <Send className="w-3.5 h-3.5" />,
    search_images: <Search className="w-3.5 h-3.5" />,
    summarize_url: <BookOpen className="w-3.5 h-3.5" />,
    file_write: <Code className="w-3.5 h-3.5" />,
    file_append: <Code className="w-3.5 h-3.5" />,
    file_read_full: <BookOpen className="w-3.5 h-3.5" />,
    dir_list: <BookOpen className="w-3.5 h-3.5" />,
    storage_create: <StickyNote className="w-3.5 h-3.5" />,
    storage_write: <StickyNote className="w-3.5 h-3.5" />,
    storage_read: <StickyNote className="w-3.5 h-3.5" />,
    storage_list: <StickyNote className="w-3.5 h-3.5" />,
    storage_delete: <StickyNote className="w-3.5 h-3.5" />,
    storage_rollback: <StickyNote className="w-3.5 h-3.5" />,
    email_list: <BookOpen className="w-3.5 h-3.5" />,
    calendar_today: <BookOpen className="w-3.5 h-3.5" />,
    calendar_create: <BookOpen className="w-3.5 h-3.5" />,
    reminders_list: <CheckCircle2 className="w-3.5 h-3.5" />,
    reminders_add: <CheckCircle2 className="w-3.5 h-3.5" />,
    contacts_search: <Search className="w-3.5 h-3.5" />,
    generate_code: <Code className="w-3.5 h-3.5" />,
    summarize_nodes: <BookOpen className="w-3.5 h-3.5" />,
    create_note: <StickyNote className="w-3.5 h-3.5" />,
    set_timer: <Timer className="w-3.5 h-3.5" />,
};

const STATUS_COLORS: Record<string, { text: string; bg: string; line: string }> = {
    pending: { text: "text-white/40", bg: "bg-white/10", line: "bg-white/10" },
    running: { text: "text-blue-400", bg: "bg-blue-500/20", line: "bg-blue-500/40" },
    completed: { text: "text-emerald-400", bg: "bg-emerald-500/20", line: "bg-emerald-500/40" },
    failed: { text: "text-red-400", bg: "bg-red-500/20", line: "bg-red-500/40" },
    waiting_approval: { text: "text-amber-400", bg: "bg-amber-500/20", line: "bg-amber-500/40" },
    waiting_answer: { text: "text-violet-400", bg: "bg-violet-500/20", line: "bg-violet-500/40" },
    skipped: { text: "text-white/30", bg: "bg-white/5", line: "bg-white/10" },
};

const DEFAULT_STEP_COLORS = { text: "text-white/40", bg: "bg-white/10", line: "bg-white/10" };

function StepIcon({ status }: { status: AgentStepStatus }) {
    switch (status) {
        case "running": return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
        case "completed": return <CheckCircle2 className="w-3.5 h-3.5" />;
        case "failed": return <XCircle className="w-3.5 h-3.5" />;
        case "waiting_approval": return <ShieldAlert className="w-3.5 h-3.5" />;
        case "skipped": return <ChevronRight className="w-3.5 h-3.5" />;
        default: return <ChevronDown className="w-3.5 h-3.5" />;
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function DetailedStep({
    step,
    isLast,
    onRetry,
}: {
    step: AgentStep;
    isLast: boolean;
    onRetry?: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const colors = (step.status && STATUS_COLORS[step.status]) || DEFAULT_STEP_COLORS;
    const icon = step.toolName ? TOOL_ICONS[step.toolName] || <Brain className="w-3.5 h-3.5" /> : <Brain className="w-3.5 h-3.5" />;
    const duration = step.startedAt && step.completedAt
        ? formatDuration(step.completedAt - step.startedAt)
        : null;

    return (
        <div className="relative flex gap-3">
            {/* Timeline line */}
            {!isLast && (
                <div className={cn("absolute left-[11px] top-7 bottom-0 w-px", colors.line)} />
            )}

            {/* Status dot */}
            <div className={cn("flex items-center justify-center w-6 h-6 rounded-full shrink-0 mt-0.5", colors.bg, colors.text)}>
                <StepIcon status={step.status} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                    >
                        <span className={cn("opacity-60", colors.text)}>{icon}</span>
                        <span className={cn("text-xs font-semibold", colors.text)}>
                            {step.toolName || (step.type && String(step.type).replace(/_/g, " ")) || "Step"}
                        </span>
                        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                            <ChevronDown className="w-3 h-3 text-white/30" />
                        </motion.div>
                    </button>
                    {duration && (
                        <span className="flex items-center gap-1 text-[10px] text-white/30">
                            <Clock className="w-2.5 h-2.5" />
                            {duration}
                        </span>
                    )}
                    {step.startedAt && (
                        <span className="text-[10px] text-white/20">
                            {formatTimestamp(step.startedAt)}
                        </span>
                    )}
                    {onRetry && (step.status === "failed" || step.status === "completed") && (
                        <button
                            onClick={onRetry}
                            className="flex items-center gap-1 text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors ml-auto"
                            title="Retry from this step"
                        >
                            <RotateCcw className="w-3 h-3" />
                            Retry
                        </button>
                    )}
                </div>

                {/* Reasoning (always shown) */}
                {step.reasoning && (
                    <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
                        {step.reasoning}
                    </p>
                )}

                {/* Expandable details */}
                <AnimatePresence>
                    {expanded && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                        >
                            <div className="mt-2 space-y-2">
                                {/* Tool input */}
                                {step.toolInput && (
                                    <div className="rounded-lg bg-white/5 p-2">
                                        <span className="text-[10px] text-white/30 uppercase tracking-wider">Input</span>
                                        <pre className="text-[11px] text-white/60 font-mono mt-1 whitespace-pre-wrap break-all">
                                            {step.toolInput.length > 500 ? step.toolInput.slice(0, 500) + "..." : step.toolInput}
                                        </pre>
                                    </div>
                                )}

                                {/* Tool result */}
                                {step.toolResult && (
                                    <div className={cn(
                                        "rounded-lg p-2",
                                        step.toolResult.success ? "bg-emerald-500/5" : "bg-red-500/5",
                                    )}>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-white/30 uppercase tracking-wider">Result</span>
                                            {step.toolResult.success ? (
                                                <Zap className="w-3 h-3 text-emerald-400/60" />
                                            ) : (
                                                <XCircle className="w-3 h-3 text-red-400/60" />
                                            )}
                                            <span className="text-[10px] text-white/20 ml-auto">
                                                {formatDuration(step.toolResult.durationMs)}
                                            </span>
                                        </div>
                                        {step.toolResult.text && (
                                            <pre className="text-[11px] text-white/50 font-mono mt-1 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                                                {step.toolResult.text.length > 1000
                                                    ? step.toolResult.text.slice(0, 1000) + "\n... (truncated)"
                                                    : step.toolResult.text}
                                            </pre>
                                        )}
                                        {step.toolResult.error && (
                                            <p className="text-[11px] text-red-400/80 font-mono mt-1">
                                                {step.toolResult.error}
                                            </p>
                                        )}
                                        {step.toolResult.sources && step.toolResult.sources.length > 0 && (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {step.toolResult.sources.map((s, i) => (
                                                    <a
                                                        key={i}
                                                        href={s}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[10px] text-blue-400/60 hover:text-blue-400 underline truncate max-w-[200px]"
                                                    >
                                                        {s}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Error */}
                                {step.error && !step.toolResult?.error && (
                                    <div className="rounded-lg bg-red-500/5 p-2">
                                        <span className="text-[10px] text-red-400/60 uppercase tracking-wider">Error</span>
                                        <p className="text-[11px] text-red-400/80 mt-1">{step.error}</p>
                                    </div>
                                )}

                                {/* Approval info */}
                                {step.approval && (
                                    <div className="rounded-lg bg-amber-500/5 p-2">
                                        <span className="text-[10px] text-amber-400/60 uppercase tracking-wider">Approval</span>
                                        <p className="text-[11px] text-white/50 mt-1">
                                            Status: <span className={cn(
                                                "font-semibold",
                                                step.approval.status === "approved" ? "text-emerald-400" :
                                                step.approval.status === "rejected" ? "text-red-400" :
                                                "text-amber-400",
                                            )}>{step.approval.status}</span>
                                            {step.approval.decidedAt && (
                                                <span className="text-white/20 ml-2">
                                                    at {formatTimestamp(step.approval.decidedAt)}
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

export const StepTimeline = React.memo(function StepTimeline({ steps, detailed = false, onRetryFromStep }: StepTimelineProps) {
    if (steps.length === 0) {
        return (
            <div className="flex items-center justify-center py-6">
                <span className="text-xs text-white/30">No steps recorded</span>
            </div>
        );
    }

    // Compute summary metrics
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const failedSteps = steps.filter((s) => s.status === "failed").length;
    const toolCalls = steps.filter((s) => s.type === "tool_call").length;
    const totalDuration = steps.reduce((acc, s) => {
        if (s.startedAt && s.completedAt) return acc + (s.completedAt - s.startedAt);
        return acc;
    }, 0);

    return (
        <div>
            {/* Metrics bar */}
            {detailed && (
                <div className="flex items-center gap-4 mb-4 pb-3 border-b border-white/5">
                    <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />
                        <span className="text-[10px] text-white/40">{completedSteps} completed</span>
                    </div>
                    {failedSteps > 0 && (
                        <div className="flex items-center gap-1.5">
                            <XCircle className="w-3 h-3 text-red-400/60" />
                            <span className="text-[10px] text-white/40">{failedSteps} failed</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-blue-400/60" />
                        <span className="text-[10px] text-white/40">{toolCalls} tool calls</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                        <Clock className="w-3 h-3 text-white/30" />
                        <span className="text-[10px] text-white/40">{formatDuration(totalDuration)}</span>
                    </div>
                </div>
            )}

            {/* Steps */}
            <div className="space-y-0">
                {steps.map((step, i) => (
                    <DetailedStep
                        key={step.id}
                        step={step}
                        isLast={i === steps.length - 1}
                        onRetry={onRetryFromStep ? () => onRetryFromStep(step.index) : undefined}
                    />
                ))}
            </div>
        </div>
    );
});
