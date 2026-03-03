"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ShieldOff } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";

/**
 * JarvisButton — floating toggle (bottom-right) to enter/exit Jarvis Mode.
 * When active, hides macOS desktop icons and auto-hides the Dock.
 * Restores everything when deactivated or when the app closes.
 */
export function JarvisButton() {
    const { settings, updateSetting } = useSettings();
    const [loading, setLoading] = useState(false);
    const [hovered, setHovered] = useState(false);

    const isActive = settings.jarvisMode;

    const toggle = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const bridge = await import("@/lib/tauriBridge");
            if (isActive) {
                await bridge.exitJarvisMode();
                updateSetting("jarvisMode", false);
            } else {
                await bridge.enterJarvisMode();
                updateSetting("jarvisMode", true);
            }
        } catch (err) {
            console.warn("Jarvis mode toggle failed:", err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed bottom-5 right-5 z-[12000] flex flex-col items-end gap-2">
            {/* Tooltip on hover */}
            <AnimatePresence>
                {hovered && (
                    <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-medium border whitespace-nowrap glass-card"
                        style={{
                            background: "rgba(0,0,0,0.7)",
                            borderColor: isActive ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.1)",
                            color: isActive ? "#6ee7b7" : "rgba(255,255,255,0.7)",
                        }}
                    >
                        {isActive ? "Exit Jarvis Mode" : "Enter Jarvis Mode"}
                        <span className="ml-1.5 text-[9px] opacity-50">⌘⇧Space</span>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Button */}
            <motion.button
                onClick={toggle}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                disabled={loading}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                className="relative w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 cursor-pointer border shadow-lg"
                style={{
                    background: isActive
                        ? "linear-gradient(135deg, rgba(16,185,129,0.25), rgba(6,78,59,0.4))"
                        : "rgba(255,255,255,0.06)",
                    borderColor: isActive
                        ? "rgba(16,185,129,0.4)"
                        : "rgba(255,255,255,0.08)",
                    backdropFilter: "blur(var(--synthesis-glass-blur, 20px))",
                    WebkitBackdropFilter: "blur(var(--synthesis-glass-blur, 20px))",
                    boxShadow: isActive
                        ? "0 0 20px rgba(16,185,129,0.15), 0 4px 12px rgba(0,0,0,0.3)"
                        : "0 4px 12px rgba(0,0,0,0.3)",
                }}
                aria-label={isActive ? "Exit Jarvis Mode" : "Enter Jarvis Mode"}
            >
                {/* Pulsing ring when active */}
                {isActive && (
                    <motion.div
                        className="absolute inset-0 rounded-2xl border border-emerald-400/30"
                        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}

                {loading ? (
                    <motion.div
                        className="w-5 h-5 border-2 border-white/30 border-t-white/80 rounded-full"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    />
                ) : isActive ? (
                    <Shield size={20} className="text-emerald-400" />
                ) : (
                    <ShieldOff size={20} className="text-white/40" />
                )}
            </motion.button>
        </div>
    );
}
