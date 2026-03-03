"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UISeparatorProps } from "./types";

export const A2UISeparator = React.memo(function A2UISeparator({
    id,
    label,
    isLight = false,
}: A2UISeparatorProps) {
    if (label) {
        return (
            <div id={id} className="flex items-center gap-3 py-1">
                <div
                    className={cn(
                        "flex-1 h-px",
                        isLight ? "bg-slate-900/[0.08]" : "bg-white/[0.06]",
                    )}
                />
                <span
                    className={cn(
                        "text-[10px] uppercase tracking-[0.2em] shrink-0",
                        isLight ? "text-slate-400" : "text-white/25",
                    )}
                >
                    {label}
                </span>
                <div
                    className={cn(
                        "flex-1 h-px",
                        isLight ? "bg-slate-900/[0.08]" : "bg-white/[0.06]",
                    )}
                />
            </div>
        );
    }

    return (
        <div
            id={id}
            className={cn(
                "h-px w-full",
                isLight
                    ? "bg-gradient-to-r from-transparent via-slate-400/20 to-transparent"
                    : "bg-gradient-to-r from-transparent via-white/[0.06] to-transparent"
            )}
        />
    );
});
