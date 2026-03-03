"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UISkeletonProps } from "./types";

export const A2UISkeleton = React.memo(function A2UISkeleton({
    id,
    type = "text",
    lines = 3,
    isLight = false,
}: A2UISkeletonProps) {
    const baseClass = cn(
        "animate-pulse rounded",
        isLight ? "bg-slate-200" : "bg-white/10"
    );

    switch (type) {
        case "card":
            return (
                <div id={id} className={cn("w-full h-32 rounded-xl", baseClass)} />
            );
        case "avatar":
            return (
                <div id={id} className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-full shrink-0", baseClass)} />
                    <div className="flex flex-col gap-2 flex-1">
                        <div className={cn("h-3 w-1/3", baseClass)} />
                        <div className={cn("h-3 w-1/4", baseClass)} />
                    </div>
                </div>
            );
        case "image":
            return (
                <div id={id} className={cn("w-full aspect-video rounded-xl", baseClass)} />
            );
        case "text":
        default:
            return (
                <div id={id} className="flex flex-col gap-2 w-full py-1">
                    {Array.from({ length: lines }).map((_, i) => (
                        <div
                            key={i}
                            className={cn(
                                "h-3",
                                baseClass,
                                i === lines - 1 ? "w-2/3" : "w-full"
                            )}
                        />
                    ))}
                </div>
            );
    }
});
