"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ListItem {
    text: string;
    icon?: string | null;
}

interface CardListProps {
    items: ListItem[];
    ordered?: boolean;
    isLight?: boolean;
    className?: string;
}

export const CardList = React.memo(function CardList({
    items,
    ordered = false,
    isLight = false,
    className,
}: CardListProps) {
    if (!items || items.length === 0) return null;

    return (
        <div className={cn("flex flex-col gap-1.5", className)}>
            {items.map((item, i) => (
                <div
                    key={`li-${i}`}
                    className={cn(
                        "flex items-start gap-2.5 text-sm leading-relaxed",
                        isLight ? "text-slate-700" : "text-white/75",
                    )}
                >
                    <span
                        className={cn(
                            "shrink-0 mt-1.5 text-[10px] font-medium",
                            isLight ? "text-slate-400" : "text-white/30",
                        )}
                    >
                        {ordered ? `${i + 1}.` : "•"}
                    </span>
                    <span className="break-words">{item.text}</span>
                </div>
            ))}
        </div>
    );
});
