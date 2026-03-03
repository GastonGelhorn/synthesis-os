"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { A2UIListProps } from "./types";
import { parseTextWithLinks, hasLinkableUrls } from "@/lib/textWithLinks";

export const A2UIList = React.memo(function A2UIList({
    id,
    items,
    ordered = false,
    isLight = false,
}: A2UIListProps) {
    if (!items || items.length === 0) return null;

    return (
        <div id={id} className="flex flex-col gap-3 my-2">
            {items.map((item, i) => (
                <div
                    key={`${id}-li-${i}`}
                    className={cn(
                        "flex items-start gap-3 text-[13px] leading-[1.7]",
                        isLight ? "text-slate-700" : "text-white/85",
                    )}
                >
                    <span
                        className={cn(
                            "shrink-0 mt-0.5 w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold shadow-sm backdrop-blur-md",
                            isLight
                                ? "bg-slate-100 text-slate-500 border border-slate-200"
                                : "bg-white/5 text-white/80 border border-white/10 ring-1 ring-white/5",
                        )}
                    >
                        {item.icon ? (
                            <span>{item.icon}</span>
                        ) : (
                            ordered ? `${i + 1}` : "•"
                        )}
                    </span>
                    <span className="break-words mt-0.5 flex-1">
                        {hasLinkableUrls(item.text) ? parseTextWithLinks(item.text, isLight) : item.text}
                    </span>
                </div>
            ))}
        </div>
    );
});
