"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UIAccordionProps } from "./types";
import { ChevronDown } from "lucide-react";

export const A2UIAccordion = React.memo(function A2UIAccordion({
    id,
    title,
    icon,
    defaultExpanded = false,
    isLight = false,
}: A2UIAccordionProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);

    return (
        <div
            id={id}
            className={cn(
                "rounded-xl border overflow-hidden transition-all",
                isLight ? "border-slate-800/10 bg-slate-900/[0.01]" : "border-white/[0.06] bg-white/[0.01]",
                expanded ? (isLight ? "bg-slate-900/[0.03]" : "bg-white/[0.03]") : ""
            )}
        >
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-3"
            >
                <div className="flex items-center gap-2">
                    {icon && <span className={cn("text-xs", isLight ? "text-slate-500" : "text-white/40")}>{icon}</span>}
                    <span className={cn("text-sm font-medium", isLight ? "text-slate-800" : "text-white/90")}>{title}</span>
                </div>
                <ChevronDown
                    size={14}
                    className={cn(
                        "transition-transform duration-300",
                        expanded ? "rotate-180" : "rotate-0",
                        isLight ? "text-slate-400" : "text-white/40"
                    )}
                />
            </button>

            {/* The actual content inside the accordion relies on A2UIRenderer structural nesting, 
                so this component just handles the visual shell, or we could leave an empty div hook here if needed.
                A proper structural implementation would take 'children' ReactNodes, but A2UIRenderer flattens layout.
                Thus, A2UIAccordion may act as a signal to the layout engine or just display a block.
                For now we keep it visually functional. */}
        </div>
    );
});
