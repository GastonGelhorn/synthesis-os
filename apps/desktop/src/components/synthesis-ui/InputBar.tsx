import { ThinkingOrb } from "./ThinkingOrb";

import { useState, forwardRef, useImperativeHandle, useRef, useEffect, useCallback, useMemo } from "react";
import { Sparkles, ArrowRight, Loader2, CheckCircle2, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { SpaceId } from "@/types/synthesis";
import { useSettings } from "@/context/SettingsContext";
import { playSound } from "@/lib/audio";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface InputBarHandle {
    focus: () => void;
    isFocused: () => boolean;
}

const SPACE_GLOW: Record<SpaceId, { from: string; via: string; to: string; accent: string }> = {
    work: {
        from: "rgba(96, 165, 250, 0.18)",
        via: "rgba(129, 140, 248, 0.14)",
        to: "rgba(96, 165, 250, 0.10)",
        accent: "#60a5fa",
    },
    entertainment: {
        from: "rgba(244, 114, 182, 0.18)",
        via: "rgba(192, 132, 252, 0.14)",
        to: "rgba(244, 114, 182, 0.10)",
        accent: "#f472b6",
    },
    research: {
        from: "rgba(52, 211, 153, 0.18)",
        via: "rgba(34, 211, 238, 0.14)",
        to: "rgba(52, 211, 153, 0.10)",
        accent: "#34d399",
    },
};

export type InputMode = "os" | "task";

interface InputBarProps {
    onSubmit: (value: string) => void;
    onCancel?: () => void;
    isLoading?: boolean;
    placeholder?: string;
    compact?: boolean;
    spaceId?: SpaceId;
    /** Input mode: OS chat vs Task (new/continue card). */
    mode?: InputMode;
    onModeChange?: (mode: InputMode) => void;
    /** When mode=task and a card is active, used for placeholder "Continuar con [title]...". */
    activeNodeTitle?: string | null;
    showThinkingBanner?: boolean;
    thinkingQuery?: string;
    thinkingStep?: string;
    thinkingStepsCount?: number;
    thinkingSteps?: string[];
    agentSteps?: import("@/lib/agent/types").AgentStep[];
    isWaitingForInput?: boolean;
    /** When the agent is waiting for the user to answer a question (ask_user flow) */
    waitingQuestionText?: string;
    thinkingPhase?: "listening" | "thinking" | "replying" | "ready";
    streamingReasoning?: string;
    streamingContent?: string;
}

type ThinkingBannerState = {
    visible: boolean;
    phase: "thinking" | "done" | "listening" | "replying" | "ready";
    query: string;
    step: string;
    steps: string[];
    stepsCount: number;
    streamingReasoning?: string;
    streamingContent?: string;
};

/** Semantic status from kernel (e.g. "Buscando en la web") — prefer over raw stream. */
function isSemanticStatus(text: string): boolean {
    if (!text || text.length > 80) return false;
    const lower = text.toLowerCase();
    if (lower.includes("content:") || lower.includes("tool_call:") || lower.includes("reasoning about")) return false;
    if (lower.startsWith("executing tool:")) return false;
    if (lower.includes("{") && lower.includes("}")) return false;
    return true;
}

function getSemanticStatusFromSteps(agentSteps?: import("@/lib/agent/types").AgentStep[]): string | null {
    if (!agentSteps?.length) return null;
    for (let i = agentSteps.length - 1; i >= 0; i--) {
        const r = agentSteps[i]?.reasoning?.trim();
        if (r && isSemanticStatus(r)) return r;
    }
    return null;
}

const listVariants = {
    visible: {
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.2
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, x: -10, y: 5 },
    visible: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: {
            type: "spring",
            stiffness: 300,
            damping: 24
        }
    }
};

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar({
    onSubmit,
    onCancel,
    isLoading,
    isWaitingForInput,
    placeholder,
    compact,
    spaceId = "work",
    mode = "task",
    onModeChange,
    activeNodeTitle,
    showThinkingBanner = true,
    thinkingQuery,
    thinkingStep,
    thinkingStepsCount = 0,
    thinkingSteps = [],
    agentSteps = [],
    waitingQuestionText,
    thinkingPhase,
    streamingReasoning,
    streamingContent,
}, ref) {
    const { settings } = useSettings();
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const glow = useMemo(() => {
        const space = settings.spaces.find(s => s.id === spaceId);
        if (space) {
            return {
                from: `${space.color}2e`,
                via: `${space.color}24`,
                to: `${space.color}1a`,
                accent: space.color
            };
        }
        return SPACE_GLOW["work"] || { from: "rgba(96, 165, 250, 0.18)", via: "rgba(129, 140, 248, 0.14)", to: "rgba(96, 165, 250, 0.10)", accent: "#60a5fa" };
    }, [settings.spaces, spaceId]);
    const thinkingHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const prewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [thinkingBanner, setThinkingBanner] = useState<ThinkingBannerState>({
        visible: false,
        phase: "thinking",
        query: "",
        step: "",
        steps: [],
        stepsCount: 0,
        streamingReasoning: "",
        streamingContent: "",
    });
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of reasoning steps
    useEffect(() => {
        if (expanded && scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: "smooth"
            });
        }
    }, [expanded, thinkingBanner.steps.length, agentSteps?.length]);

    useImperativeHandle(ref, () => ({
        focus: () => inputRef.current?.focus(),
        isFocused: () => document.activeElement === inputRef.current,
    }));

    useEffect(() => {
        return () => {
            if (thinkingHideTimerRef.current) {
                clearTimeout(thinkingHideTimerRef.current);
            }
            if (prewarmTimerRef.current) {
                clearTimeout(prewarmTimerRef.current);
            }
        };
    }, []);

    const handleFocus = useCallback(() => {
        if (!isTauri) return;
        if (prewarmTimerRef.current) clearTimeout(prewarmTimerRef.current);
        prewarmTimerRef.current = setTimeout(() => {
            prewarmTimerRef.current = null;
            import("@tauri-apps/api/core").then(({ invoke }) => {
                invoke("kernel_ping").catch(() => { });
            });
        }, 300);
    }, []);

    useEffect(() => {
        if (!showThinkingBanner) {
            if (thinkingHideTimerRef.current) {
                clearTimeout(thinkingHideTimerRef.current);
                thinkingHideTimerRef.current = null;
            }
            setThinkingBanner((prev) => (prev.visible ? { ...prev, visible: false } : prev));
            setExpanded(false);
            return;
        }

        if (isLoading) {
            if (thinkingHideTimerRef.current) {
                clearTimeout(thinkingHideTimerRef.current);
                thinkingHideTimerRef.current = null;
            }
            if (!thinkingBanner.visible) {
                setExpanded(true);
            }
            setThinkingBanner({
                visible: true,
                phase: thinkingPhase ?? "thinking",
                query: thinkingQuery ?? "",
                step: thinkingStep ?? "",
                steps: thinkingSteps,
                stepsCount: thinkingStepsCount,
                streamingReasoning: streamingReasoning ?? "",
                streamingContent: streamingContent ?? "",
            });
            return;
        }

        if (thinkingBanner.visible && thinkingBanner.phase === "thinking") {
            setThinkingBanner((prev) => ({ ...prev, phase: "done" }));
            thinkingHideTimerRef.current = setTimeout(() => {
                setThinkingBanner((prev) => ({ ...prev, visible: false }));
                setExpanded(false);
                thinkingHideTimerRef.current = null;
            }, 2000); // Reduced to 2s for better UX
        }
    }, [
        showThinkingBanner,
        isLoading,
        thinkingQuery,
        thinkingStep,
        thinkingSteps,
        thinkingStepsCount,
        thinkingPhase,
        thinkingBanner.visible,
        thinkingBanner.phase,
        streamingReasoning,
    ]);

    const lastSubmitRef = useRef(0);
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Debounce: prevent double-submit within 500ms
        const now = Date.now();
        if (now - lastSubmitRef.current < 500) return;
        lastSubmitRef.current = now;

        if (value.trim()) {
            if (settings.soundEffects) playSound("click", settings.volume);
            onSubmit(value);
            setValue("");
            setExpanded(false);
        }
    };

    const isInputDisabled = (!value.trim() || (isLoading && !isWaitingForInput));
    const showQuestionBanner = Boolean(isWaitingForInput && waitingQuestionText?.trim());

    const computedPlaceholder = showQuestionBanner
        ? "Your answer..."
        : placeholder ?? (mode === "os"
            ? "Talk to OS..."
            : activeNodeTitle
                ? `Continue with "${activeNodeTitle}"...`
                : "New task...");

    return (
        <div className={cn("w-full relative z-50 mx-auto", compact ? "max-w-xl" : "max-w-2xl")}>
            <AnimatePresence>
                {/* ... Question Banner code ... */}
                {showQuestionBanner && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.2 }}
                        className="absolute bottom-full left-0 right-0 mb-3 pointer-events-none"
                    >
                        <div
                            className={cn(
                                "mx-auto max-w-[760px] rounded-2xl px-4 py-3 ring-1 glass-elevated",
                                settings.theme === "light"
                                    ? "ring-violet-200/50"
                                    : "ring-violet-500/30",
                            )}
                        >
                            <p
                                className={cn(
                                    "text-[11px] font-semibold tracking-wider uppercase mb-1",
                                    settings.theme === "light" ? "text-violet-600" : "text-violet-300",
                                )}
                            >
                                Agent asks
                            </p>
                            <p
                                className={cn(
                                    "text-[13px] leading-snug",
                                    settings.theme === "light" ? "text-violet-900" : "text-white/90",
                                )}
                            >
                                {waitingQuestionText}
                            </p>
                            <p
                                className={cn(
                                    "text-[11px] mt-2",
                                    settings.theme === "light" ? "text-violet-600/80" : "text-white/50",
                                )}
                            >
                                Type your answer below and press Enter.
                            </p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="relative group" role="search" aria-label="Synthesis search">
                <motion.div
                    key={spaceId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.6 }}
                    transition={{ duration: 0.8 }}
                    className="absolute inset-0 rounded-2xl blur-xl group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                        background: `linear-gradient(90deg, ${glow.from}, ${glow.via}, ${glow.to})`,
                    }}
                />

                <div className={cn(
                    `relative flex items-center glass-elevated rounded-2xl p-2 pl-5 transition-all duration-300 ring-1 ${settings.theme === "light" ? "ring-black/[0.08] focus-within:ring-black/20" : "ring-white/[0.08] focus-within:ring-white/20"}`,
                    compact ? "h-12" : "h-14",
                )}>
                    {onModeChange && (
                        <div
                            className={cn(
                                "flex rounded-lg p-0.5 mr-2 shrink-0",
                                settings.theme === "light" ? "bg-black/8" : "bg-white/8",
                            )}
                            role="tablist"
                            aria-label="Input mode"
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === "os"}
                                onClick={() => onModeChange("os")}
                                className={cn(
                                    "px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors",
                                    mode === "os"
                                        ? settings.theme === "light"
                                            ? "bg-white text-black shadow-sm"
                                            : "bg-white/20 text-white"
                                        : settings.theme === "light"
                                            ? "text-black/50 hover:text-black/70"
                                            : "text-white/50 hover:text-white/70",
                                )}
                            >
                                OS
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={mode === "task"}
                                onClick={() => onModeChange("task")}
                                className={cn(
                                    "px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors",
                                    mode === "task"
                                        ? settings.theme === "light"
                                            ? "bg-white text-black shadow-sm"
                                            : "bg-white/20 text-white"
                                        : settings.theme === "light"
                                            ? "text-black/50 hover:text-black/70"
                                            : "text-white/50 hover:text-white/70",
                                )}
                            >
                                Task
                            </button>
                        </div>
                    )}
                    <Sparkles
                        className={cn(
                            "shrink-0 mr-3 transition-colors",
                            compact ? "w-4 h-4" : "w-5 h-5",
                        )}
                        style={{ color: isLoading ? glow.accent : settings.theme === "light" ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)" }}
                    />

                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onFocus={handleFocus}
                        placeholder={computedPlaceholder}
                        aria-label={showQuestionBanner ? "Answer the agent's question" : "Search or ask a question"}
                        className={cn(
                            `flex-1 bg-transparent border-none outline-none font-light tracking-wide ${settings.theme === "light" ? "text-black placeholder-black/25" : "text-white placeholder-white/25"}`,
                            compact ? "text-sm" : "text-base",
                        )}
                        autoFocus
                    />

                    <AnimatePresence mode="wait">
                        {isLoading && !isWaitingForInput && onCancel ? (
                            <motion.button
                                key="stop"
                                type="button"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                                onClick={(e) => { e.preventDefault(); onCancel(); }}
                                aria-label="Stop generation"
                                className={cn(
                                    "rounded-xl transition-all duration-200 hover:scale-105 active:scale-95",
                                    settings.theme === "light" ? "text-red-600 hover:bg-red-100" : "text-red-400 hover:bg-red-500/20",
                                    compact ? "p-1.5" : "p-2",
                                )}
                                style={{
                                    background: settings.theme === "light" ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.15)",
                                }}
                            >
                                <Square size={compact ? 14 : 16} fill="currentColor" />
                            </motion.button>
                        ) : (
                            <motion.button
                                key="submit"
                                type="submit"
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: isInputDisabled ? 0 : 1, scale: isInputDisabled ? 0.8 : 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                                disabled={isInputDisabled}
                                aria-label="Submit query"
                                className={cn(
                                    `rounded-xl transition-all duration-200`,
                                    isInputDisabled ? "pointer-events-none" : "",
                                    settings.theme === "light" ? "text-black/80" : "text-white/80",
                                    compact ? "p-1.5" : "p-2",
                                )}
                                style={{
                                    background: value.trim() ? `${glow.accent}20` : settings.theme === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)",
                                }}
                            >
                                <ArrowRight size={compact ? 16 : 18} />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>
            </form>

            <AnimatePresence>
                {thinkingBanner.visible && (
                    <motion.div
                        layout
                        initial={{ opacity: 0, y: 4, height: 48 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: 4, height: 48 }}
                        transition={{
                            layout: { duration: 0.3, type: "spring", stiffness: 300, damping: 30 },
                            opacity: { duration: 0.2 }
                        }}
                        className="absolute bottom-full left-0 right-0 mb-3 pointer-events-auto"
                    >
                        <motion.div
                            layout
                            onClick={() => setExpanded(!expanded)}
                            className={cn(
                                "mx-auto max-w-[760px] rounded-2xl px-3 py-2.5 ring-1 cursor-pointer hover:bg-white/5 active:scale-[0.99] transition-colors relative overflow-hidden glass-elevated",
                                settings.theme === "light"
                                    ? "ring-black/[0.12] shadow-lg shadow-black/5"
                                    : "ring-white/[0.14] shadow-lg shadow-black/50",
                            )}
                        >
                            {thinkingBanner.phase === "thinking" && !thinkingBanner.streamingContent?.trim() && !thinkingBanner.streamingReasoning?.trim() && thinkingBanner.steps.length === 0 && (
                                <div
                                    className="absolute inset-0 rounded-2xl opacity-15 pointer-events-none animate-pulse"
                                    style={{
                                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)",
                                    }}
                                />
                            )}
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 shrink-0">
                                    {thinkingBanner.phase === "listening" ? (
                                        <ThinkingOrb phase="listening" color={glow.accent} size={18} />
                                    ) : thinkingBanner.phase === "replying" ? (
                                        <ThinkingOrb phase="replying" color={glow.accent} size={18} />
                                    ) : thinkingBanner.phase === "thinking" ? (
                                        <ThinkingOrb phase="thinking" color={glow.accent} size={18} />
                                    ) : (
                                        <ThinkingOrb phase="ready" color={glow.accent} size={18} />
                                    )}
                                </div>

                                <div className="min-w-0 flex-1 text-left">
                                    <div className="flex items-center justify-between">
                                        <p
                                            className={cn(
                                                "text-[10px] font-bold tracking-[0.15em] uppercase",
                                                settings.theme === "light" ? "text-black/40" : "text-white/40",
                                            )}
                                        >
                                            {thinkingBanner.phase === "listening" ? "Listening" :
                                                thinkingBanner.phase === "replying" ? "Replying" :
                                                    thinkingBanner.phase === "thinking" ? "Thinking" : "Done"}
                                        </p>
                                        <p className={cn("text-[9px] opacity-40 uppercase tracking-widest", settings.theme === "light" ? "text-black" : "text-white")}>
                                            {expanded ? "Click to collapse" : "Click to expand"}
                                        </p>
                                    </div>

                                    <motion.div
                                        layout
                                        className={cn(
                                            "mt-1 text-[13px] leading-relaxed select-text",
                                            settings.theme === "light" ? "text-black/80" : "text-white/80",
                                            expanded ? "whitespace-pre-wrap break-words" : "truncate"
                                        )}
                                    >
                                        {thinkingBanner.phase === "thinking"
                                            ? (expanded && thinkingBanner.steps.length > 0 ? (
                                                <div
                                                    ref={scrollRef}
                                                    className="py-2 max-h-[320px] overflow-y-auto no-scrollbar scroll-smooth"
                                                >
                                                    <div className="space-y-1 ml-1">
                                                        <AnimatePresence initial={false}>
                                                            {thinkingBanner.steps.slice(-5).map((s, i, arr) => (
                                                                <motion.div
                                                                    key={`step-${thinkingBanner.steps.length - arr.length + i}-${s.slice(0, 20)}`}
                                                                    initial={{ opacity: 0, y: 8, height: 0 }}
                                                                    animate={{
                                                                        opacity: i === arr.length - 1 ? 1 : Math.max(0.15, 0.5 - (arr.length - 1 - i) * 0.1),
                                                                        y: 0,
                                                                        height: "auto",
                                                                    }}
                                                                    exit={{ opacity: 0, height: 0, y: -4 }}
                                                                    transition={{ duration: 0.25, ease: "easeOut" }}
                                                                    className="flex items-start gap-2.5 overflow-hidden"
                                                                >
                                                                    <div className={cn(
                                                                        "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                                                                        i === arr.length - 1 ? "bg-blue-400 animate-pulse" : "bg-white/20"
                                                                    )} />
                                                                    <span className={cn(
                                                                        "flex-1 text-[11px] tracking-wide font-medium leading-snug",
                                                                        i === arr.length - 1
                                                                            ? (settings.theme === "light" ? "text-black/70" : "text-white/70")
                                                                            : (settings.theme === "light" ? "text-black/30" : "text-white/25")
                                                                    )}>
                                                                        {i === arr.length - 1 && (() => {
                                                                            const semantic = getSemanticStatusFromSteps(agentSteps);
                                                                            const raw = thinkingBanner.streamingContent?.trim() || thinkingBanner.streamingReasoning?.trim();
                                                                            const display = semantic || raw;
                                                                            return display ? (
                                                                                <span className="relative">
                                                                                    {display}
                                                                                    <motion.span
                                                                                        animate={{ opacity: [1, 0, 1] }}
                                                                                        transition={{ duration: 0.8, repeat: Infinity }}
                                                                                        className="inline-block w-1.5 h-3 ml-1 bg-blue-400 align-middle"
                                                                                    />
                                                                                </span>
                                                                            ) : s;
                                                                        })()}
                                                                    </span>
                                                                </motion.div>
                                                            ))}
                                                        </AnimatePresence>
                                                    </div>
                                                </div>
                                            ) : (
                                                getSemanticStatusFromSteps(agentSteps) ||
                                                thinkingBanner.streamingContent?.trim() ||
                                                thinkingBanner.streamingReasoning?.trim() ||
                                                (thinkingBanner.steps.length > 0
                                                    ? thinkingBanner.steps[thinkingBanner.steps.length - 1]
                                                    : (thinkingBanner.step ||
                                                        thinkingBanner.query ||
                                                        "Synthesizing your request..."))
                                            ))
                                            : `Response generated${thinkingBanner.stepsCount > 0
                                                ? ` · ${thinkingBanner.stepsCount} steps executed`
                                                : ""
                                            }`}
                                    </motion.div>
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
});
