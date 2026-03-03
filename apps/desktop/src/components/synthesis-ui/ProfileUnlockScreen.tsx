"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Orbit } from "lucide-react";
import { useProfile } from "@/context/ProfileContext";
import { verifyPin } from "@/lib/pinHash";

const UNLOCKED_KEY = "synthesis-unlocked-profiles";

function getUnlockedIds(): Set<string> {
    try {
        const raw = sessionStorage.getItem(UNLOCKED_KEY);
        if (raw) {
            const arr = JSON.parse(raw) as string[];
            return new Set(Array.isArray(arr) ? arr : []);
        }
    } catch { /* ignore */ }
    return new Set();
}

function setUnlockedStorage(profileId: string) {
    try {
        const ids = getUnlockedIds();
        ids.add(profileId);
        sessionStorage.setItem(UNLOCKED_KEY, JSON.stringify([...ids]));
    } catch { /* ignore */ }
}

export function ProfileUnlockScreen() {
    const { profiles, activeProfileId } = useProfile();
    const [pin, setPin] = useState("");
    const [error, setError] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [unlockedIds, setUnlockedIds] = useState<Set<string>>(getUnlockedIds);
    const inputRef = useRef<HTMLInputElement>(null);

    const activeProfile = profiles.find((p) => p.id === activeProfileId);
    const needsUnlock =
        activeProfile?.passwordHash && !unlockedIds.has(activeProfile.id);

    useEffect(() => {
        if (needsUnlock) {
            const t = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(t);
        }
    }, [needsUnlock]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProfile?.passwordHash || !pin.trim()) return;
        setError("");
        setVerifying(true);
        try {
            const ok = await verifyPin(pin, activeProfile.passwordHash);
            if (ok) {
                setUnlockedStorage(activeProfile.id);
                setUnlockedIds((prev) => new Set([...prev, activeProfile.id]));
                setPin("");
            } else {
                setError("Incorrect PIN");
            }
        } catch {
            setError("Error verifying PIN");
        } finally {
            setVerifying(false);
        }
    };

    if (!needsUnlock) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[8000]"
                style={{
                    background: "rgba(4, 8, 20, 0.72)",
                    backdropFilter: "blur(var(--synthesis-glass-blur, 12px))",
                }}
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 280, damping: 26 }}
                className="fixed inset-0 z-[8001] flex items-center justify-center p-4"
            >
                <div
                    className="w-full max-w-sm rounded-3xl border border-white/10 overflow-hidden glass-card"
                    style={{
                        boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06) inset",
                    }}
                >
                    <div
                        className="h-px w-full"
                        style={{ background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.5), transparent)" }}
                    />
                    <div className="px-8 py-10">
                        <div className="flex items-center gap-3 mb-6">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center border border-white/10"
                                style={{ background: "rgba(30,35,55,0.8)" }}
                            >
                                <Lock size={20} className="text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-white/90">Perfil bloqueado</p>
                                <p className="text-xs text-white/50">{activeProfile?.displayName}</p>
                            </div>
                        </div>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-xs text-white/60 mb-1.5">PIN</label>
                                <input
                                    ref={inputRef}
                                    type="password"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    autoComplete="off"
                                    value={pin}
                                    onChange={(e) => {
                                        setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
                                        setError("");
                                    }}
                                    placeholder="Enter your PIN"
                                    disabled={verifying}
                                    className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 bg-white/5 border border-white/10 outline-none focus:border-blue-400/50 font-mono tracking-[0.3em] text-center"
                                />
                                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
                            </div>
                            <button
                                type="submit"
                                disabled={!pin || pin.length < 4 || verifying}
                                className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all disabled:opacity-40"
                                style={{
                                    background: pin.length >= 4
                                        ? "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)"
                                        : "rgba(255,255,255,0.06)",
                                    color: pin.length >= 4 ? "#fff" : "rgba(255,255,255,0.25)",
                                }}
                            >
                                {verifying ? (
                                    <Orbit size={16} className="animate-spin" />
                                ) : (
                                    "Unlock"
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </motion.div>
        </AnimatePresence>
    );
}
