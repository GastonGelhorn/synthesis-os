"use client";

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Orbit, ArrowRight } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { useProfile } from "@/context/ProfileContext";
import { hasValidLLMConnection } from "@/lib/onboarding/hasValidLLM";
import { loadUserProfile, saveUserProfile } from "@/lib/context/userProfile";
import { OnboardingLLMSetup } from "./OnboardingLLMSetup";
import { OnboardingChat } from "./OnboardingChat";
import { SYNTHESIS_DEFAULT_WALLPAPER } from "@/lib/backgrounds";
import { FIRST_RUN_SETUP_SESSION_KEY } from "@/components/synthesis-ui/FirstRunSetupStep1";
import type { ConversationMessage } from "@/types/synthesis";

const ONBOARDING_INITIAL_MESSAGE =
    "Start the profile onboarding: introduce yourself by saying you are going to configure my profile and ask me questions to get to know me better.";

function inferNameFromHistory(history: ConversationMessage[]): string {
    const userReplies = history.filter(
        (m) => m.role === "user" && m.content.trim() !== ONBOARDING_INITIAL_MESSAGE
    );
    const firstReply = userReplies[0]?.content?.trim();
    if (!firstReply) return "User";
    if (firstReply.length <= 40 && !firstReply.includes(".") && !firstReply.includes("?")) {
        return firstReply;
    }
    return "User";
}

/** Try to extract name from core memory user profile (e.g. "- User's name is Gaston" or "Name: X") */
function extractNameFromProfileText(text: string): string | null {
    if (!text || !text.trim()) return null;
    const lower = text.toLowerCase();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
        const m = line.match(/^(?:-\s*)?(?:name|nombre|user'?s?\s+name|se\s+llama)[:\s]+(.+)$/i);
        if (m) {
            const name = m[1].trim().replace(/^["']|["']$/g, "");
            if (name.length > 0 && name.length <= 40) return name;
        }
        if (line.startsWith("- ") && line.length <= 45 && !line.includes(".") && !line.includes("?")) {
            const candidate = line.slice(2).trim();
            if (candidate.length >= 2 && candidate.length <= 40) return candidate;
        }
    }
    return null;
}

interface OnboardingWizardProps {
    getOsHistory: () => ConversationMessage[];
    onOsQuery: (value: string) => Promise<void>;
    isLoading: boolean;
}

export function OnboardingWizard({ getOsHistory, onOsQuery, isLoading }: OnboardingWizardProps) {
    const { settings, updateSetting } = useSettings();
    const { profiles, createProfile } = useProfile();
    const [visible, setVisible] = useState(false);
    const [step, setStep] = useState<0 | 1>(0);
    const llmValidRef = useRef(false);

    const needsOnboarding = profiles.length === 0;
    const hasLLM = hasValidLLMConnection(settings);
    const isFirstRun = typeof sessionStorage !== "undefined" && sessionStorage.getItem(FIRST_RUN_SETUP_SESSION_KEY) === "account-done";

    useEffect(() => {
        if (needsOnboarding) {
            const t = setTimeout(() => setVisible(true), 400);
            return () => clearTimeout(t);
        }
    }, [needsOnboarding]);

    useEffect(() => {
        if (hasLLM && step === 0 && !isFirstRun) {
            setStep(1);
        }
    }, [hasLLM, step, isFirstRun]);

    const handleLLMValid = (valid: boolean) => {
        llmValidRef.current = valid;
    };

    const handleFinalize = async () => {
        let name = inferNameFromHistory(getOsHistory());
        try {
            const summary = await invoke<string>("get_user_profile_summary");
            const fromCore = extractNameFromProfileText(summary);
            if (fromCore) name = fromCore;
        } catch {
            // Not in Tauri or command failed; keep name from history
        }
        createProfile(name);
        updateSetting("userName", name);
        const profile = loadUserProfile();
        profile.name = name;
        saveUserProfile(profile);
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem(FIRST_RUN_SETUP_SESSION_KEY);
        }
        setVisible(false);
    };

    if (!visible || !needsOnboarding) return null;

    return (
        <AnimatePresence>
            <motion.div
                key="onboarding-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="fixed inset-0 z-[10000] bg-cover bg-center bg-no-repeat"
                style={{
                    backgroundColor: "#050505",
                }}
            >
                <div
                    className="absolute inset-0"
                    style={{
                        background: "rgba(4, 8, 20, 0.4)",
                        backdropFilter: "blur(var(--synthesis-glass-blur, 12px))",
                    }}
                />
            </motion.div>

            <motion.div
                key="onboarding-panel"
                initial={{ opacity: 0, scale: 0.94, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 16 }}
                transition={{ type: "spring", stiffness: 280, damping: 26, delay: 0.08 }}
                className="fixed inset-0 z-[8001] flex items-center justify-center pointer-events-none p-4"
            >
                <div
                    className="pointer-events-auto w-full max-w-lg mx-auto rounded-3xl border border-white/10 overflow-hidden glass-card"
                    style={{
                        boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 60px rgba(96,165,250,0.08)",
                    }}
                >
                    <div
                        className="h-px w-full"
                        style={{ background: "linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.5) 40%, rgba(129,140,248,0.5) 60%, transparent 100%)" }}
                    />

                    <div className="px-8 py-10">
                        <div className="flex items-center gap-3 mb-6">
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

                        <AnimatePresence mode="wait">
                            {step === 0 ? (
                                <motion.div
                                    key="step-0"
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 12 }}
                                    transition={{ duration: 0.25 }}
                                >
                                    <h1 className="text-2xl font-semibold text-white/95 leading-snug mb-2">
                                        {isFirstRun ? "Step 2 of 3: Set up your AI connection" : "Welcome"}
                                    </h1>
                                    <OnboardingLLMSetup onValid={handleLLMValid} />
                                    <div className="mt-8 flex justify-end">
                                        <motion.button
                                            onClick={() => hasValidLLMConnection(settings) && setStep(1)}
                                            disabled={!hasValidLLMConnection(settings)}
                                            whileTap={hasValidLLMConnection(settings) ? { scale: 0.97 } : {}}
                                            className="py-3 px-6 rounded-xl text-sm font-medium flex items-center gap-2 transition-all"
                                            style={{
                                                background: hasValidLLMConnection(settings)
                                                    ? "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)"
                                                    : "rgba(255,255,255,0.06)",
                                                color: hasValidLLMConnection(settings) ? "#fff" : "rgba(255,255,255,0.25)",
                                                cursor: hasValidLLMConnection(settings) ? "pointer" : "default",
                                                boxShadow: hasValidLLMConnection(settings) ? "0 4px 20px rgba(59,130,246,0.35)" : "none",
                                            }}
                                        >
                                            Next
                                            <ArrowRight size={14} className="opacity-80" />
                                        </motion.button>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="step-1"
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 12 }}
                                    transition={{ duration: 0.25 }}
                                    className="min-h-[400px] flex flex-col"
                                >
                                    <h1 className="text-2xl font-semibold text-white/95 leading-snug mb-1">
                                        {isFirstRun ? "Step 3 of 3: Create your profile" : "Create your profile"}
                                    </h1>
                                    <OnboardingChat
                                        history={getOsHistory()}
                                        onSend={onOsQuery}
                                        isLoading={isLoading}
                                        onFinalize={handleFinalize}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
