"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface StatItem {
    label: string;
    value: string;
    trend?: "up" | "down" | "neutral";
}

interface CardStatsRowProps {
    stats: StatItem[];
    isLight?: boolean;
    className?: string;
}

export const CardStatsRow = React.memo(function CardStatsRow({
    stats,
    isLight = false,
    className,
}: CardStatsRowProps) {
    if (!stats || stats.length === 0) return null;

    const trendColors = {
        up: "text-emerald-400",
        down: "text-red-400",
        neutral: isLight ? "text-slate-500" : "text-white/40",
    };

    const trendArrow = {
        up: "\u2191",
        down: "\u2193",
        neutral: "",
    };

    return (
        <div className={cn("flex gap-2", className)}>
            {stats.map((stat, i) => (
                <div
                    key={`stat-${i}`}
                    className={cn(
                        "flex-1 rounded-xl p-3 text-center border",
                        isLight
                            ? "border-slate-800/10 bg-slate-900/[0.03]"
                            : "border-white/[0.06] bg-white/[0.03]",
                    )}
                >
                    <div className="flex items-center justify-center gap-1">
                        <span
                            className={cn(
                                "text-xl font-semibold tracking-tight",
                                isLight ? "text-slate-900" : "text-white",
                            )}
                        >
                            {stat.value}
                        </span>
                        {stat.trend && stat.trend !== "neutral" && (
                            <span className={cn("text-xs font-medium", trendColors[stat.trend])}>
                                {trendArrow[stat.trend]}
                            </span>
                        )}
                    </div>
                    <span
                        className={cn(
                            "text-[10px] uppercase tracking-[0.15em] mt-1 block",
                            isLight ? "text-slate-500" : "text-white/35",
                        )}
                    >
                        {stat.label}
                    </span>
                </div>
            ))}
        </div>
    );
});
