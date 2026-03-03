"use client";

import { cn } from "@/lib/utils";

/** Skeleton placeholder for settings section while loading. */
export function SectionSkeleton() {
    return (
        <div className="py-4 space-y-6 animate-pulse">
            <div className="h-4 w-32 rounded bg-white/10" />
            <div className="space-y-3">
                <div className="h-12 w-full rounded-lg bg-white/10" />
                <div className="h-12 w-full rounded-lg bg-white/10" />
                <div className="h-12 w-3/4 rounded-lg bg-white/10" />
            </div>
        </div>
    );
}
