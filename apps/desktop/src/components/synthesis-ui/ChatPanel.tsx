"use client";

import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageSquare, User, Bot, Sparkles, Send } from "lucide-react";
import { SynthesisNode, ConversationMessage, SpaceId } from "@/types/synthesis";
import { cn } from "@/lib/utils";

export type ChatHistorySource = "os" | "node" | "space";

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    activeSpaceId: SpaceId;
    history: ConversationMessage[];
    historySource?: ChatHistorySource;
    focusedNode?: SynthesisNode | null;
    onSubmit?: (message: string, nodeId?: string, forceMode?: "os" | "task") => void;
}

export function ChatPanel({ isOpen, onClose, activeSpaceId, history, historySource = "space", focusedNode = null, onSubmit }: ChatPanelProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [inputValue, setInputValue] = useState("");

    // Auto-scroll to bottom
    useEffect(() => {
        if (isOpen && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [isOpen, history]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop (transparent, allows clicking through to left side potentially, but let's blocking for focus) */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[1200] bg-black/10 backdrop-blur-[1px]"
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ x: "100%", opacity: 0.5 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="fixed right-0 top-0 bottom-0 w-full max-w-md z-[1210] glass-card border-l border-theme flex flex-col shadow-2xl"
                    >
                        {/* Header */}
                        <div
                            className="flex items-center justify-between p-6 border-b border-theme"
                            style={{ background: "rgba(var(--synthesis-glass-rgb), calc(var(--synthesis-system-glass-alpha, 0.8) * 0.4))" }}
                        >
                            <div className="flex items-center gap-3">
                                <div
                                    className="p-2 rounded-lg bg-theme-muted text-theme"
                                    style={{ color: "var(--synthesis-accent)" }}
                                >
                                    <MessageSquare size={20} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold tracking-tight text-theme">
                                        {historySource === "os"
                                            ? "OS"
                                            : focusedNode
                                                ? `Context: ${focusedNode.title || focusedNode.content?.title || "Card"}`
                                                : "Thread"}
                                    </h2>
                                    <p className="text-sm text-theme-muted opacity-60 capitalize">
                                        {historySource === "os"
                                            ? "System chat"
                                            : focusedNode
                                                ? (focusedNode.content?.summary ?? "")
                                                : `${activeSpaceId} Context`}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Messages Area */}
                        <div
                            ref={scrollRef}
                            className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent select-text"
                        >
                            {history.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-white/30 space-y-4">
                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                                        <Sparkles size={24} className="opacity-50" />
                                    </div>
                                    <p className="text-sm">No conversation history yet.</p>
                                </div>
                            ) : (
                                history.map((msg, idx) => (
                                    <motion.div
                                        key={`${msg.timestamp}-${idx}`}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: idx * 0.05 }}
                                        className={cn(
                                            "flex gap-4 max-w-full",
                                            msg.role === "user" ? "flex-row-reverse" : "flex-row"
                                        )}
                                    >
                                        {/* Avatar */}
                                        <div
                                            className={cn(
                                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
                                                msg.role === "user"
                                                    ? "bg-white/10 border-white/20 text-white"
                                                    : "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                                            )}
                                        >
                                            {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
                                        </div>

                                        {/* Bubble */}
                                        <div
                                            className={cn(
                                                "rounded-2xl p-4 text-sm leading-relaxed max-w-[85%]",
                                                msg.role === "user"
                                                    ? "bg-theme-muted text-theme"
                                                    : "bg-theme-surface border border-theme text-theme-secondary shadow-lg"
                                            )}
                                        >
                                            {msg.content}
                                            <div className={cn(
                                                "text-[10px] mt-2 opacity-30 select-none",
                                                msg.role === "user" ? "text-right" : "text-left"
                                            )}>
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </div>

                        {/* Footer / Input */}
                        <div className="p-4 border-t border-white/10 bg-white/5">
                            {onSubmit ? (
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        const trimmed = inputValue.trim();
                                        if (trimmed) {
                                            onSubmit(trimmed, focusedNode?.id, historySource === "os" ? "os" : undefined);
                                            setInputValue("");
                                        }
                                    }}
                                    className="flex items-center gap-2"
                                >
                                    <input
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        placeholder="Continue the conversation..."
                                        className={cn(
                                            "flex-1 px-3 py-2 rounded-xl border outline-none transition-colors text-sm",
                                            "bg-white/5 border-white/10 text-white placeholder:text-white/40",
                                            "focus:border-white/30 focus:ring-1 focus:ring-white/10",
                                        )}
                                        aria-label="Message"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!inputValue.trim()}
                                        className={cn(
                                            "p-2 rounded-xl transition-colors shrink-0",
                                            "bg-white/10 text-white/80 hover:bg-white/20",
                                            "disabled:opacity-30 disabled:cursor-not-allowed",
                                        )}
                                        aria-label="Send"
                                    >
                                        <Send size={18} />
                                    </button>
                                </form>
                            ) : (
                                <p className="text-xs text-white/30 text-center">
                                    Use the main input bar to continue the conversation.
                                </p>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
