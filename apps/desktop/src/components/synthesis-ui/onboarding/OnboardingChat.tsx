"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { User, Bot, Send, Check, Plus } from "lucide-react";
import type { ConversationMessage } from "@/types/synthesis";
import { cn } from "@/lib/utils";

const ONBOARDING_INITIAL_MESSAGE =
    "Start the profile onboarding: introduce yourself by saying you are going to configure my profile and ask me questions to get to know me better.";

interface OnboardingChatProps {
    history: ConversationMessage[];
    onSend: (message: string) => Promise<void>;
    isLoading: boolean;
    onFinalize: () => void;
}

export function OnboardingChat({ history, onSend, isLoading, onFinalize }: OnboardingChatProps) {
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history]);

    const hasSentInitialRef = useRef(false);
    useEffect(() => {
        if (hasSentInitialRef.current || isLoading) return;
        hasSentInitialRef.current = true;
        void onSend(ONBOARDING_INITIAL_MESSAGE);
    }, [isLoading, onSend]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;
        setInput("");
        void onSend(trimmed);
    };

    return (
        <div className="flex flex-col h-full min-h-0">
            <p className="text-sm text-white/55 leading-relaxed mb-4">
                The system will ask you questions to get to know you. Answer naturally. You can finish whenever you want or keep enriching your profile.
            </p>

            <div
                ref={scrollRef}
                className="flex-1 min-h-[240px] max-h-[320px] overflow-y-auto space-y-4 pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
            >
                {history.length === 0 && !isLoading ? (
                    <div className="flex items-center justify-center py-8 text-white/30">
                        <div className="flex items-center gap-2">
                            <Bot size={18} className="opacity-50" />
                            <span className="text-sm">Starting conversation...</span>
                        </div>
                    </div>
                ) : (
                    history.map((msg, idx) => (
                        <motion.div
                            key={`${msg.timestamp}-${idx}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className={cn(
                                "flex gap-3",
                                msg.role === "user" ? "flex-row-reverse" : "flex-row"
                            )}
                        >
                            <div
                                className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                    msg.role === "user"
                                        ? "bg-white/10 text-white"
                                        : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                )}
                            >
                                {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
                            </div>
                            <div
                                className={cn(
                                    "rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[85%]",
                                    msg.role === "user"
                                        ? "bg-white/10 text-white"
                                        : "bg-white/5 border border-white/10 text-white/90"
                                )}
                            >
                                {msg.content}
                            </div>
                        </motion.div>
                    ))
                )}
                {isLoading && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex gap-3"
                    >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <Bot size={14} />
                        </div>
                        <div className="rounded-2xl px-4 py-3 bg-white/5 border border-white/10">
                            <span className="inline-flex gap-1">
                                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                                <span className="w-2 h-2 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                            </span>
                        </div>
                    </motion.div>
                )}
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Your answer..."
                        disabled={isLoading}
                        className="flex-1 px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 bg-white/5 border border-white/10 outline-none focus:border-blue-400/50 disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="p-3 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-400/30 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send size={18} />
                    </button>
                </div>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={onFinalize}
                        className="flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
                        style={{
                            background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                            color: "#fff",
                            boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
                        }}
                    >
                        <Check size={16} />
                        Finish profile
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            void onSend("Keep enriching my profile, ask me more questions.");
                        }}
                        disabled={isLoading}
                        className="flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-colors"
                    >
                        <Plus size={16} />
                        Continue enriching
                    </button>
                </div>
            </form>
        </div>
    );
}
