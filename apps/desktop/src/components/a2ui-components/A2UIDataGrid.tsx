"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIDataGridProps } from "./types";

export const A2UIDataGrid = React.memo(function A2UIDataGrid({
    id,
    items,
    isLight = false,
}: A2UIDataGridProps) {
    if (!items || items.length === 0) return null;

    // By default, let's use 2 columns, but we could make this dynamic based on item count or length.
    const columns = 2;
    const colClass = {
        1: "grid-cols-1",
        2: "grid-cols-2",
        3: "grid-cols-3",
    }[columns];

    return (
        <div id={id} className={cn("grid gap-2", colClass)}>
            {items.map((item, i) => (
                <div
                    key={`${id}-dg-${i}`}
                    className={cn(
                        "rounded-xl p-3 transition-colors border flex flex-col gap-1",
                        isLight
                            ? "border-slate-800/10 bg-slate-900/[0.03] hover:bg-slate-900/[0.06]"
                            : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]",
                    )}
                >
                    <span className={cn(
                        "text-[10px] uppercase tracking-[0.15em] flex items-center gap-1",
                        isLight ? "text-slate-500" : "text-white/35",
                    )}>
                        {/* We could render the icon here if provided */}
                        {item.icon && <span>{item.icon}</span>}
                        {item.label}
                    </span>
                    <span className={cn(
                        "text-sm font-medium break-words",
                        isLight ? "text-slate-800" : "text-white/90",
                    )}>
                        {item.value}
                    </span>
                </div>
            ))}
        </div>
    );
});
