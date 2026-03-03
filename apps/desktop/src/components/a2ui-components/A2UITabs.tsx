"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UITabsProps } from "./types";
import { LayoutGroup, motion } from "framer-motion";

export const A2UITabs = React.memo(function A2UITabs({
    id,
    tabs,
    activeTabId,
    isLight = false,
}: A2UITabsProps) {
    // If an initial activeTabId is passed, use it, else pick the first tab
    const [active, setActive] = useState(activeTabId || (tabs?.[0]?.id ?? ""));

    if (!tabs || tabs.length === 0) return null;

    return (
        <div id={id} className="w-full">
            <LayoutGroup id={`tabs-${id}`}>
                <div
                    className={cn(
                        "flex overflow-x-auto hide-scrollbar gap-2 p-1 rounded-xl w-fit max-w-full border",
                        isLight ? "bg-slate-900/[0.03] border-slate-800/10" : "bg-white/[0.03] border-white/[0.06]"
                    )}
                >
                    {tabs.map((tab) => {
                        const isActive = active === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActive(tab.id)}
                                className={cn(
                                    "relative px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap",
                                    isActive
                                        ? isLight ? "text-slate-900" : "text-white"
                                        : isLight ? "text-slate-500 hover:text-slate-700 hover:bg-slate-900/[0.02]" : "text-white/50 hover:text-white/80 hover:bg-white/[0.02]"
                                )}
                            >
                                {isActive && (
                                    <motion.div
                                        layoutId="active-tab-indicator"
                                        className={cn(
                                            "absolute inset-0 rounded-lg shadow-sm",
                                            isLight ? "bg-white border border-slate-200" : "bg-white/10 border border-white/10"
                                        )}
                                        initial={false}
                                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                                    />
                                )}
                                <span className="relative z-10 flex items-center gap-1.5">
                                    {tab.icon && <span className="text-[10px]">{tab.icon}</span>}
                                    {tab.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </LayoutGroup>

            {/* Container for active tab content -> to be filled by A2UIRenderer rendering children of the tab explicitly */}
            {/* Typically, A2UI will place the content for the active tab inside a `Row` or `Column` sibling depending on data design.
                If A2UI models it hierarchically, we would need to render children here.
                For now, A2UITabs just renders the interactive navigators, and emits an event or expects full DOM re-generation by LLM based on states.
                To make it frontend-interactive, typically we just emit a client-side intent to let A2UIRenderer switch the active surface. */}
        </div>
    );
});
