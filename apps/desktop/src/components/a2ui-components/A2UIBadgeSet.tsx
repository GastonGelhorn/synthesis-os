"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIBadgeSetProps } from "./types";

export const A2UIBadgeSet = React.memo(function A2UIBadgeSet({
    id,
    badges,
    isLight = false,
}: A2UIBadgeSetProps) {
    if (!badges || badges.length === 0) return null;

    return (
        <div id={id} className="flex flex-wrap gap-1.5">
            {badges.map((badge, i) => (
                <span
                    key={`badge-${i}`}
                    className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wide uppercase border",
                        isLight
                            ? "bg-slate-900/[0.04] text-slate-600 border-slate-900/10"
                            : "bg-white/[0.06] text-white/70 border-white/10"
                    )}
                    style={badge.color ? {
                        backgroundColor: `${badge.color}15`,
                        color: badge.color,
                        borderColor: `${badge.color}30`
                    } : {}}
                >
                    {badge.icon && <span className="text-[10px] opacity-70">{badge.icon}</span>}
                    {badge.label}
                </span>
            ))}
        </div>
    );
});
