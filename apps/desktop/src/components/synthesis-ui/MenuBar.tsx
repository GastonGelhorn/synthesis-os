"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Orbit, Activity, Globe2, Cpu } from "lucide-react";
import { SpaceId } from "@/types/synthesis";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { useSystemStatus } from "@/hooks/useSystemStatus";
import { cn } from "@/lib/utils";

const SPACE_COLORS: Record<SpaceId, { primary: string; secondary: string; glow: string }> = {
    work: { primary: "#60a5fa", secondary: "#818cf8", glow: "rgba(96, 165, 250, 0.4)" },
    entertainment: { primary: "#f472b6", secondary: "#c084fc", glow: "rgba(244, 114, 182, 0.4)" },
    research: { primary: "#34d399", secondary: "#22d3ee", glow: "rgba(52, 211, 153, 0.4)" },
};

const SPACE_LABELS: Record<SpaceId, string> = {
    work: "Work",
    entertainment: "Play",
    research: "Research",
};

const APP_VERSION = "v0.9.4";
interface MenuBarProps {
    spaceId: SpaceId;
    nodeCount?: number;
    isLoading?: boolean;
    activeSynthCount?: number;
}

export function MenuBar({
    spaceId,
    nodeCount = 0,
    isLoading = false,
    activeSynthCount = 0,
}: MenuBarProps) {
    const { user } = useAuth();
    const { settings } = useSettings();
    const displayName =
        settings.userName && settings.userName !== "User"
            ? settings.userName
            : user?.display_name ?? "";
    const colors = SPACE_COLORS[spaceId];
    const status = useSystemStatus();
    const [expanded, setExpanded] = useState(false);
    const pillRef = useRef<HTMLDivElement>(null);
    const reduceMotion = useReducedMotion();

    const handleBlur = () => {
        setTimeout(() => {
            if (pillRef.current && !pillRef.current.contains(document.activeElement)) {
                setExpanded(false);
            }
        }, 0);
    };

    const isLight = settings.theme === "light";
    const sepClass = isLight ? "bg-black/10" : "bg-white/10";
    const muteLabel = settings.notifSound ? "Sound on" : "Muted";

    return (
        <>
            {/* Top Left: Brand Widget */}
            <motion.div
                initial={{ opacity: 0, x: -20, y: -20 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="fixed top-6 left-6 z-[1100] flex items-center gap-3 select-none"
            >
                <div className="relative group cursor-default">
                    <motion.div
                        className="w-8 h-8 rounded-full blur-md absolute inset-0 opacity-40 group-hover:opacity-60 transition-opacity duration-500"
                        style={{ background: colors.primary }}
                    />
                    <div
                        className="relative w-8 h-8 rounded-full flex items-center justify-center glass border-theme"
                    >
                        <motion.div
                            animate={{ rotate: isLoading ? 360 : 0 }}
                            transition={isLoading ? { duration: 2.5, repeat: Infinity, ease: "linear" } : {}}
                        >
                            <Orbit size={14} className="text-theme opacity-90" strokeWidth={2} />
                        </motion.div>
                    </div>
                </div>
                <div
                    className="px-3 py-1.5 rounded-full flex items-baseline gap-1.5 glass border-theme"
                >
                    <span className="text-xs font-semibold tracking-tight text-theme opacity-90">Synthesis</span>
                    <span className="text-xs font-bold tracking-tight accent-tint">
                        OS
                    </span>
                    <div className={cn("w-px h-3", sepClass, "mx-1")} />
                    <span className="text-[10px] font-medium opacity-80" style={{ color: colors.primary }}>
                        {SPACE_LABELS[spaceId]}
                    </span>
                    {displayName && (
                        <>
                            <div className={cn("w-px h-3", sepClass, "mx-1")} />
                            <span className="text-[10px] tracking-wide text-theme-muted">
                                {displayName}
                            </span>
                        </>
                    )}
                </div>
            </motion.div>

            {/* Top Right: Dynamic Morphing Pill */}
            <motion.div
                initial={{ opacity: 0, x: 20, y: -20 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
                className="fixed top-6 right-6 z-[1110] select-none"
            >
                <motion.div
                    ref={pillRef}
                    tabIndex={0}
                    role="region"
                    aria-label={`System status. ${expanded ? "Expanded" : "Collapsed"}. Time ${status.time}. ${status.networkLabel}.`}
                    onMouseEnter={() => setExpanded(true)}
                    onMouseLeave={() => setExpanded(false)}
                    onFocus={() => setExpanded(true)}
                    onBlur={handleBlur}
                    className={cn(
                        "relative glass-elevated rounded-full flex items-center overflow-hidden cursor-default transition-all",
                        status.isCritical ? "border-amber-500/50" : "border-theme"
                    )}
                >
                    {/* Subtle space tint overlay */}
                    {!status.isCritical && (
                        <span
                            className="pointer-events-none absolute inset-0 rounded-full z-0 opacity-30"
                            style={{
                                background: `linear-gradient(135deg, ${colors.primary}08 0%, transparent 50%, ${colors.secondary}06 100%)`,
                            }}
                        />
                    )}
                    {status.isCritical && !reduceMotion && (
                        <motion.span
                            className="pointer-events-none absolute inset-0 rounded-full z-0"
                            style={{ boxShadow: "inset 0 0 0 1px rgba(251,191,36,0.4), 0 0 16px rgba(251,191,36,0.25)" }}
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        />
                    )}
                    {/* Passive: always visible core */}
                    <div className="relative z-10 flex items-center gap-2 px-3 py-1.5 shrink-0">
                        {isLoading ? (
                            <>
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping" style={{ backgroundColor: colors.primary }} />
                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colors.primary }} />
                                </span>
                                <Activity size={10} style={{ color: colors.primary }} className="animate-pulse" />
                                <span className="text-[10px] font-semibold tracking-wide" style={{ color: colors.primary }}>
                                    Synthesizing
                                </span>
                            </>
                        ) : (
                            <>
                                {!status.isCritical && (
                                    <span
                                        className="rounded-full shrink-0"
                                        style={{ width: 6, height: 6, background: colors.primary, boxShadow: `0 0 8px ${colors.primary}` }}
                                        title="Relay active"
                                    />
                                )}
                                <span className="text-sm font-semibold tabular-nums tracking-tight" style={{ color: isLight ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.95)" }}>
                                    {status.time}
                                </span>
                                {status.isCritical && (
                                    <>
                                        <span className={cn("text-[10px]", isLight ? "text-black/40" : "text-white/40")}>•</span>
                                        <span className="text-[10px] font-semibold text-amber-400">
                                            {!status.online ? "Offline" : "Low battery"}
                                        </span>
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    {/* Expandable section */}
                    <motion.div
                        className="relative z-10 flex items-center gap-3 min-w-0 overflow-hidden"
                        style={{
                            borderLeft: `1px solid ${isLight ? "rgba(0,0,0,0.08)" : `rgba(255,255,255,0.08)`}`,
                            boxShadow: isLight ? "none" : `inset 12px 0 16px -12px ${colors.primary}20`,
                        }}
                        initial={false}
                        animate={{ maxWidth: expanded ? 420 : 0, opacity: expanded ? 1 : 0 }}
                        transition={{ duration: reduceMotion ? 0.1 : 0.28, ease: "easeInOut" }}
                    >
                        <div className="flex items-center gap-3 pl-3 pr-2 py-1.5 whitespace-nowrap">
                            <span
                                className="text-[10px] font-medium tracking-wide"
                                style={{
                                    color: status.online ? (status.connectionHint === "slow" ? "#fbbf24" : isLight ? "#059669" : "#34d399") : (isLight ? "#b91c1c" : "#f87171"),
                                }}
                            >
                                {status.networkLabel}
                            </span>
                            {status.batteryLabel != null && (
                                <>
                                    <div className={cn("w-px h-3", sepClass)} />
                                    <span
                                        className="text-[10px] font-medium tracking-wide"
                                        style={{
                                            color: status.battery?.level != null && status.battery.level <= 0.1 && !status.battery.charging ? (isLight ? "#b91c1c" : "#f87171") : (isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.7)"),
                                        }}
                                    >
                                        {status.batteryLabel}
                                    </span>
                                </>
                            )}
                            <div className={cn("w-px h-3", sepClass)} />
                            <span className={cn("text-[10px] font-medium tracking-wide", isLight ? "text-black/50" : "text-white/50")} title="Notifications">
                                {muteLabel}
                            </span>
                            {activeSynthCount > 1 && (
                                <>
                                    <div className={cn("w-px h-3", sepClass)} />
                                    <span className="text-[10px] font-medium tracking-wide" style={{ color: colors.primary }}>
                                        {activeSynthCount} active
                                    </span>
                                </>
                            )}
                            <div className={cn("w-px h-3", sepClass)} />
                            <div className="flex items-center gap-1.5" title="Version">
                                <Cpu size={10} style={{ color: isLight ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.4)" }} />
                                <span className={cn("text-[10px] font-mono tracking-wide", isLight ? "text-black/40" : "text-white/40")}>{APP_VERSION}</span>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            </motion.div>
        </>
    );
}
