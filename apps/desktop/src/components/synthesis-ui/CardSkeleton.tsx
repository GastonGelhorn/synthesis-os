"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardSkeletonProps {
    isLight?: boolean;
    compact?: boolean;
}

/** Reusable skeleton for cards while content loads. Shimmer effect, title + 2-3 text lines. */
export const CardSkeleton = React.memo(function CardSkeleton({
    isLight = false,
    compact = false,
}: CardSkeletonProps) {
    const baseClass = cn(
        "animate-pulse rounded",
        isLight ? "bg-slate-200" : "bg-white/10"
    );
    return (
        <div className={cn("w-full h-full flex flex-col p-4 gap-4", compact && "p-3 gap-3")}>
            <div className={cn("h-5 w-3/4", baseClass)} />
            <div className="flex flex-col gap-2">
                <div className={cn("h-3 w-full", baseClass)} />
                <div className={cn("h-3 w-full", baseClass)} />
                <div className={cn("h-3 w-2/3", baseClass)} />
            </div>
        </div>
    );
});
