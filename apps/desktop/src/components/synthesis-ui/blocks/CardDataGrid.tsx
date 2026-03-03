"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface DataGridItem {
    label: string;
    value: string;
    icon?: string | null;
}

interface CardDataGridProps {
    items: DataGridItem[];
    isLight?: boolean;
    columns?: 1 | 2 | 3;
    className?: string;
}

export const CardDataGrid = React.memo(function CardDataGrid({
    items,
    isLight = false,
    columns = 2,
    className,
}: CardDataGridProps) {
    if (!items || items.length === 0) return null;

    const colClass = {
        1: "grid-cols-1",
        2: "grid-cols-2",
        3: "grid-cols-3",
    }[columns];

    return (
        <div className={cn("grid gap-2", colClass, className)}>
            {items.map((item, i) => (
                <div
                    key={`dg-${i}`}
                    className={cn(
                        "rounded-xl p-3 transition-colors border flex flex-col gap-1",
                        isLight
                            ? "border-slate-800/10 bg-slate-900/[0.03] hover:bg-slate-900/[0.06]"
                            : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]",
                    )}
                >
                    <span className={cn(
                        "text-[10px] uppercase tracking-[0.15em]",
                        isLight ? "text-slate-500" : "text-white/35",
                    )}>
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
