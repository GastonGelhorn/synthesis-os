"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Orbit, ArrowRight } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

export function WelcomeScreen() {
    const { settings, updateSetting } = useSettings();
    const [visible, setVisible] = useState(false);
    const [name, setName] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Show only when settings are hydrated and no userName is set
    useEffect(() => {
        if (settings.userName === "") {
            // Small delay so the workspace loads first (nicer UX)
            const t = setTimeout(() => {
                setVisible(true);
                setTimeout(() => inputRef.current?.focus(), 120);
            }, 400);
            return () => clearTimeout(t);
        }
    }, [settings.userName]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        setSubmitting(true);
        // Brief pause for the animation to feel intentional
        setTimeout(() => {
            updateSetting("userName", trimmed);
            setVisible(false);
        }, 180);
    };

    return (
        <AnimatePresence>
            {visible && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        key="welcome-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4 }}
                        className="fixed inset-0 z-[8000]"
                        style={{
                            background: "rgba(4, 8, 20, 0.72)",
                            backdropFilter: "blur(var(--synthesis-glass-blur, 12px))"
                        }}
                    />

                    {/* Panel */}
                    <motion.div
                        key="welcome-panel"
                        initial={{ opacity: 0, scale: 0.94, y: 24 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.94, y: 16 }}
                        transition={{ type: "spring", stiffness: 280, damping: 26, delay: 0.08 }}
                        className="fixed inset-0 z-[8001] flex items-center justify-center pointer-events-none"
                    >
                        <div
                            className="pointer-events-auto w-full max-w-sm mx-4 rounded-3xl border border-white/10 overflow-hidden glass-card"
                            style={{
                                boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 60px rgba(96,165,250,0.08)",
                            }}
                        >
                            {/* Top glow strip */}
                            <div
                                className="h-px w-full"
                                style={{ background: "linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.5) 40%, rgba(129,140,248,0.5) 60%, transparent 100%)" }}
                            />

                            <div className="px-8 py-10">
                                {/* Logo */}
                                <div className="flex items-center gap-3 mb-8">
                                    <div className="relative w-9 h-9">
                                        <div
                                            className="absolute inset-0 rounded-full blur-md opacity-50"
                                            style={{ background: "linear-gradient(135deg, #60a5fa, #818cf8)" }}
                                        />
                                        <div
                                            className="relative w-9 h-9 rounded-full flex items-center justify-center border border-white/10"
                                            style={{ background: "rgba(30,35,55,0.8)" }}
                                        >
                                            <Orbit size={16} className="text-blue-400" strokeWidth={1.8} />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs font-semibold tracking-[0.18em] text-white/90">SYNTHESIS OS</p>
                                        <p className="text-[10px] tracking-[0.1em] text-white/35 mt-px">Zero-Browser Interface</p>
                                    </div>
                                </div>

                                {/* Heading */}
                                <h1 className="text-2xl font-semibold text-white/95 leading-snug mb-1.5">
                                    Welcome
                                </h1>
                                <p className="text-sm text-white/45 mb-8 leading-relaxed">
                                    What is your name? We will use it to personalize your experience.
                                </p>

                                {/* Form */}
                                <form onSubmit={handleSubmit} className="space-y-3">
                                    <div className="relative">
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="Your name…"
                                            maxLength={40}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all"
                                            style={{
                                                background: "rgba(255,255,255,0.05)",
                                                border: "1px solid rgba(255,255,255,0.1)",
                                                boxShadow: name.trim() ? "0 0 0 1px rgba(96,165,250,0.4)" : undefined,
                                            }}
                                            onFocus={(e) => {
                                                e.target.style.borderColor = "rgba(96,165,250,0.5)";
                                                e.target.style.boxShadow = "0 0 0 3px rgba(96,165,250,0.12)";
                                            }}
                                            onBlur={(e) => {
                                                e.target.style.borderColor = "rgba(255,255,255,0.1)";
                                                e.target.style.boxShadow = "none";
                                            }}
                                        />
                                    </div>

                                    <motion.button
                                        type="submit"
                                        disabled={!name.trim() || submitting}
                                        whileTap={name.trim() ? { scale: 0.97 } : {}}
                                        className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all duration-200"
                                        style={{
                                            background: name.trim()
                                                ? "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)"
                                                : "rgba(255,255,255,0.06)",
                                            color: name.trim() ? "#fff" : "rgba(255,255,255,0.25)",
                                            cursor: name.trim() ? "pointer" : "default",
                                            boxShadow: name.trim() ? "0 4px 20px rgba(59,130,246,0.35)" : "none",
                                        }}
                                    >
                                        {submitting ? (
                                            <Orbit size={14} className="animate-spin opacity-70" />
                                        ) : (
                                            <>
                                                Enter
                                                <ArrowRight size={14} className="opacity-80" />
                                            </>
                                        )}
                                    </motion.button>
                                </form>
                            </div>
                        </div>
                    </motion.div>
                </>
            )
            }
        </AnimatePresence >
    );
}
