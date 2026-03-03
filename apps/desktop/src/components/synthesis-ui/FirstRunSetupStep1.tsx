"use client";

import React, { useState } from "react";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { SYNTHESIS_DEFAULT_WALLPAPER } from "@/lib/backgrounds";

const FIRST_RUN_SETUP_KEY = "first-run-setup";

interface FirstRunSetupStep1Props {
    onSubmit: (username: string, password: string, displayName: string) => Promise<void>;
}

export function FirstRunSetupStep1({ onSubmit }: FirstRunSetupStep1Props) {
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSubmitting(true);
        try {
            await onSubmit(
                username.trim(),
                password,
                displayName.trim() || username.trim()
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Setup failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="min-h-screen flex items-center justify-center"
            style={{
                backgroundColor: "#050505",
            }}
        >
            <div
                className="absolute inset-0"
                style={{
                    background: "rgba(4, 8, 20, 0.4)",
                    backdropFilter: "blur(12px)",
                }}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 280, damping: 26 }}
                className="relative w-full max-w-lg mx-auto rounded-3xl border border-white/10 overflow-hidden glass-card p-8 m-4"
                style={{
                    boxShadow: "0 40px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 60px rgba(96,165,250,0.08)",
                }}
            >
                <div
                    className="h-px w-full mb-8"
                    style={{ background: "linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.5) 40%, rgba(129,140,248,0.5) 60%, transparent 100%)" }}
                />
                <div className="flex items-center gap-3 mb-6">
                    <div
                        className="w-9 h-9 rounded-full flex items-center justify-center border border-white/10"
                        style={{ background: "linear-gradient(135deg, #60a5fa, #818cf8)" }}
                    />
                    <div>
                        <p className="text-xs font-semibold tracking-[0.18em] text-white/90">SYNTHESIS OS</p>
                        <p className="text-[10px] tracking-[0.1em] text-white/35 mt-px">Step 1 of 3</p>
                    </div>
                </div>

                <h1 className="text-2xl font-semibold text-white/95 leading-snug mb-2">
                    Create your account
                </h1>
                <p className="text-sm text-white/60 mb-6">
                    Create the administrator account to get started.
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-white/70 mb-1.5">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 placeholder-white/30 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20"
                            placeholder="admin"
                            autoComplete="username"
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-white/70 mb-1.5">Display name</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 placeholder-white/30 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20"
                            placeholder="Your name"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-white/70 mb-1.5">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-xl text-sm text-white bg-white/5 border border-white/10 placeholder-white/30 focus:outline-none focus:border-blue-400/50 focus:ring-1 focus:ring-blue-400/20"
                            placeholder=""
                            autoComplete="new-password"
                            required
                        />
                    </div>
                    {error && <div className="text-sm text-red-400">{error}</div>}
                    <motion.button
                        type="submit"
                        disabled={submitting}
                        whileTap={!submitting ? { scale: 0.97 } : {}}
                        className="w-full py-3 px-6 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all mt-6"
                        style={{
                            background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
                            color: "#fff",
                            boxShadow: "0 4px 20px rgba(59,130,246,0.35)",
                            opacity: submitting ? 0.7 : 1,
                            cursor: submitting ? "not-allowed" : "pointer",
                        }}
                    >
                        {submitting ? "Creating..." : "Continue"}
                        <ArrowRight size={14} className="opacity-80" />
                    </motion.button>
                </form>
            </motion.div>
        </div>
    );
}

export { FIRST_RUN_SETUP_KEY as FIRST_RUN_SETUP_SESSION_KEY };
