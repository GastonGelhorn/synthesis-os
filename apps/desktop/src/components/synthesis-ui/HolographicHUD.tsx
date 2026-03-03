"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Wifi, Disc, Layers, Clock } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";
import type { SpaceId } from "@/types/synthesis";

interface HolographicHUDProps {
    spaceId: SpaceId;
    nodeCount: number;
    activeSynthCount: number;
    agentMetrics?: {
        tasksStarted: number;
        tasksCompleted: number;
        avgStepsPerTask: number;
    } | null;
}

export function HolographicHUD({
    spaceId,
    nodeCount,
    activeSynthCount,
    agentMetrics,
}: HolographicHUDProps) {
    const { settings } = useSettings();
    const [time, setTime] = useState<Date | null>(null);
    const [mounted, setMounted] = useState(false);

    // Hydration fix
    useEffect(() => {
        setMounted(true);
        setTime(new Date());
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Mock resource stats (random fluctuation for "alive" feel)
    const [stats, setStats] = useState({ cpu: 12, mem: 34, net: 45 });
    useEffect(() => {
        const interval = setInterval(() => {
            setStats({
                cpu: 10 + Math.floor(Math.random() * 20),
                mem: 30 + Math.floor(Math.random() * 10),
                net: 40 + Math.floor(Math.random() * 30),
            });
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    if (!mounted || !time) return null;

    const isLight = settings.theme === "light";
    const accentColor = isLight ? "#3b82f6" : "#60a5fa"; // Blueish accent
    const warningColor = isLight ? "#ef4444" : "#f87171";

    const formatTime = (date: Date) => {
        return new Intl.DateTimeFormat("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(date);
    };

    const formatSeconds = (date: Date) => {
        return date.getSeconds().toString().padStart(2, "0");
    };

    const formatDay = (date: Date) => {
        return new Intl.DateTimeFormat("en-US", {
            weekday: "short",
            day: "numeric",
            month: "short",
        }).format(date).toUpperCase();
    };

    const agentStatus = activeSynthCount > 0 ? "SYNTHESIZING" : "STANDBY";
    const agentColor = activeSynthCount > 0 ? warningColor : accentColor;

    return (
        <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            className="fixed top-6 left-1/2 z-[500] pointer-events-none select-none flex flex-col items-center gap-4"
        >
            {/* Main HUD Panel */}
            <div className={cn(
                "relative rounded-lg overflow-hidden border transition-colors duration-500 glass",
                isLight
                    ? "border-black/10 shadow-lg shadow-blue-500/5"
                    : "border-white/10 shadow-lg shadow-blue-500/10"
            )}>
                {/* Scanline effect */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
                    style={{
                        backgroundImage: "linear-gradient(to bottom, transparent 50%, black 50%)",
                        backgroundSize: "100% 4px"
                    }}
                />

                <div className="px-4 py-2 flex flex-row items-center gap-5">
                    {/* Clock Section */}
                    <div className="flex items-center gap-3">
                        <Activity size={12} className={cn("animate-pulse", isLight ? "text-blue-500/50" : "text-blue-400/50")} />
                        <div className="flex items-baseline gap-1">
                            <span className={cn("text-lg font-mono font-bold tracking-tighter", isLight ? "text-black/80" : "text-white/90")}>
                                {formatTime(time)}
                            </span>
                            <span className={cn("text-[9px] font-mono", isLight ? "text-blue-600" : "text-blue-400")}>
                                {formatSeconds(time)}
                            </span>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-4 bg-current opacity-10" />

                    {/* System Stats Section */}
                    <div className="flex flex-row items-center gap-4 text-[9px] font-mono">
                        <div className="flex items-center gap-1.5">
                            <Cpu size={11} className="opacity-50" />
                            <div className="w-10 h-1 bg-current opacity-20 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-current"
                                    animate={{ width: `${stats.cpu}%` }}
                                    transition={{ type: "spring", bounce: 0, duration: 1 }}
                                />
                            </div>
                            <span className="w-6 text-right opacity-70">{stats.cpu}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Disc size={11} className="opacity-50" />
                            <div className="w-10 h-1 bg-current opacity-20 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-current"
                                    animate={{ width: `${stats.mem}%` }}
                                    transition={{ type: "spring", bounce: 0, duration: 1 }}
                                />
                            </div>
                            <span className="w-6 text-right opacity-70">{stats.mem}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Wifi size={11} className="opacity-50" />
                            <span className="opacity-70">{stats.net}ms</span>
                        </div>
                        <div className="flex items-center gap-1.5 border-l border-white/5 pl-3">
                            <Layers size={11} className="opacity-50" />
                            <span className="opacity-70">{nodeCount}</span>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="w-px h-4 bg-current opacity-10" />

                    {/* Space & Agent Status Section */}
                    <div className="flex items-center gap-3">
                        <span className={cn("text-[9px] uppercase font-bold tracking-widest", isLight ? "text-black/50" : "text-white/50")}>
                            {spaceId}
                        </span>
                        <span className={cn("text-[8px] px-2 py-0.5 rounded-full font-bold",
                            activeSynthCount > 0
                                ? "bg-amber-500/20 text-amber-500 animate-pulse border border-amber-500/30"
                                : isLight ? "bg-black/5 text-black/40 border border-black/10" : "bg-white/10 text-white/40 border border-white/10"
                        )}>
                            {agentStatus}
                        </span>
                    </div>
                </div>
            </div>

            {/* Agent Metrics (Optional - if available) */}
            <AnimatePresence>
                {agentMetrics && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                            "text-[9px] font-mono p-2 rounded border glass",
                            isLight
                                ? "border-black/5 text-black/60"
                                : "border-white/5 text-white/60"
                        )}
                    >
                        <div className="flex gap-3">
                            <span>TASK: {agentMetrics.tasksCompleted}/{agentMetrics.tasksStarted}</span>
                            <span>AVG: {agentMetrics.avgStepsPerTask.toFixed(1)} steps</span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

        </motion.div>
    );
}
