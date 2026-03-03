"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardSeparatorProps {
    label?: string;
    isLight?: boolean;
    className?: string;
}

export const CardSeparator = React.memo(function CardSeparator({
    label,
    isLight = false,
    className,
}: CardSeparatorProps) {
    if (label) {
        return (
            <div className={cn("flex items-center gap-3 py-1", className)}>
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
            className={cn(
                "h-px w-full",
                isLight
                    ? "bg-gradient-to-r from-transparent via-slate-400/20 to-transparent"
                    : "bg-gradient-to-r from-transparent via-white/[0.06] to-transparent",
                className,
            )}
        />
    );
});
