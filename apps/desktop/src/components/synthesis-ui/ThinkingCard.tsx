"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, Zap, Globe, Sparkles, CheckCircle2 } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

interface ThinkingCardProps {
    query: string;
    steps: string[];
}

/** Map step text to a contextual icon */
function getStepIcon(step: string) {
    const s = step.toLowerCase();
    if (s.includes("intent") || s.includes("classif")) return Zap;
    if (s.includes("search") || s.includes("web") || s.includes("scraping")) return Globe;
    if (s.includes("generat") || s.includes("card")) return Sparkles;
    if (s.includes("complete") || s.includes("done") || s.includes("cache")) return CheckCircle2;
    return null;
}

export function ThinkingCard({ query, steps }: ThinkingCardProps) {
    const { settings } = useSettings();
    const isLight = settings.theme === "light";
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new steps arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [steps.length]);

    return (
        <div className="w-full h-full flex flex-col">
            {/* Title bar */}
            <div className={`h-10 ${isLight ? "bg-black/[0.04] border-black/[0.08]" : "bg-white/[0.04] border-white/[0.08]"} border-b flex items-center px-3.5 justify-between select-none shrink-0`}>
                <div className="flex gap-2 items-center">
                    <div className="w-3 h-3 rounded-full bg-violet-400/60 animate-pulse ring-1 ring-violet-400/20" />
                    <div className="w-3 h-3 rounded-full bg-violet-400/30 ring-1 ring-violet-400/10" />
                    <div className="w-3 h-3 rounded-full bg-violet-400/30 ring-1 ring-violet-400/10" />
                </div>
                <div className={`text-[10px] font-mono ${isLight ? "text-black/40" : "text-white/40"} uppercase tracking-[0.2em] truncate px-4 max-w-[60%]`}>
                    Synthesizing...
                </div>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                >
                    <Loader2 size={12} className={isLight ? "text-black/25" : "text-white/25"} />
                </motion.div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
                {/* Query echo */}
                <div className="flex items-start gap-3 shrink-0">
                    <motion.div
                        animate={{ scale: [1, 1.15, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <Brain size={18} className="text-violet-400 mt-0.5" />
                    </motion.div>
                    <div className="min-w-0">
                        <p className={`text-[11px] font-medium ${isLight ? "text-black/50" : "text-white/50"}`}>
                            Processing query
                        </p>
                        <p className={`text-sm mt-0.5 truncate ${isLight ? "text-black/80" : "text-white/80"}`}>
                            &ldquo;{query}&rdquo;
                        </p>
                    </div>
                </div>

                {/* Animated pulse bar */}
                <div className="relative h-1 rounded-full overflow-hidden bg-violet-500/10 shrink-0">
                    <motion.div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500/60 via-violet-400 to-violet-500/60 rounded-full"
                        animate={{ x: ["-100%", "200%"] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        style={{ width: "50%" }}
                    />
                </div>

                {/* Steps — always visible, scrollable, new lines appear below */}
                <div
                    ref={scrollRef}
                    className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-violet-500/20 scrollbar-track-transparent space-y-1"
                >
                    {steps.map((step, i) => {
                        const Icon = getStepIcon(step);
                        const isLatest = i === steps.length - 1;

                        return (
                            <motion.div
                                key={`${i}-${step}`}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, ease: "easeOut" }}
                                className={`flex items-start gap-2 py-0.5 ${
                                    isLatest
                                        ? ""
                                        : isLight ? "opacity-60" : "opacity-50"
                                }`}
                            >
                                {/* Step indicator */}
                                <div className="mt-[3px] shrink-0">
                                    {Icon ? (
                                        <Icon
                                            size={11}
                                            className={isLatest ? "text-violet-400" : isLight ? "text-black/30" : "text-white/30"}
                                        />
                                    ) : (
                                        <div className={`w-[6px] h-[6px] rounded-full mt-[2px] ${
                                            isLatest
                                                ? "bg-violet-400 ring-2 ring-violet-400/20"
                                                : isLight ? "bg-black/20" : "bg-white/20"
                                        }`} />
                                    )}
                                </div>

                                {/* Step text */}
                                <p className={`text-[11px] leading-[1.5] font-mono ${
                                    isLatest
                                        ? isLight ? "text-black/70" : "text-emerald-200/80"
                                        : isLight ? "text-black/40" : "text-white/35"
                                }`}>
                                    {step}
                                </p>
                            </motion.div>
                        );
                    })}

                    {/* Active thinking indicator at the bottom */}
                    {steps.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0.3, 0.7, 0.3] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                            className="flex items-center gap-1.5 pt-1"
                        >
                            <div className="w-1 h-1 rounded-full bg-violet-400" />
                            <div className="w-1 h-1 rounded-full bg-violet-400/60" />
                            <div className="w-1 h-1 rounded-full bg-violet-400/30" />
                        </motion.div>
                    )}
                </div>
            </div>
        </div>
    );
}
