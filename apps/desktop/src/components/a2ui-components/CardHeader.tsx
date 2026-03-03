"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardHeaderProps {
    title: string;
    summary?: string;
    accentColor?: string;
    isLight?: boolean;
    compact?: boolean;
    className?: string;
}

export const CardHeader = React.memo(function CardHeader({
    title,
    summary,
    accentColor = "#7BD4FF",
    isLight = false,
    compact = false,
    className,
}: CardHeaderProps) {
    return (
        <div className={cn(compact ? "px-4 pt-4 pb-3" : "px-6 pt-5 pb-4", className)}>
            <div className="flex items-center gap-2 mb-2">
                <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: "var(--synthesis-accent)" }}
                />
                <p className="text-[10px] font-semibold text-theme-muted opacity-40">
                    Synthesis
                </p>
            </div>
            <h3 className="text-lg font-semibold leading-tight tracking-tight text-theme">
                {title}
            </h3>
            {summary && (
                <p className="text-[13px] mt-2 leading-relaxed text-theme-muted">
                    {summary}
                </p>
            )}
        </div>
    );
});
