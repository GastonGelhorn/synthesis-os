"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UITimelineProps } from "./types";

export const A2UITimeline = React.memo(function A2UITimeline({
    id,
    events,
    isLight = false,
    accentColor = "#7BD4FF",
}: A2UITimelineProps) {
    if (!events || events.length === 0) return null;

    return (
        <div id={id} className="relative pl-3 flex flex-col gap-4">
            {events.map((ev, i) => {
                const isLast = i === events.length - 1;
                const isActive = ev.status === "active";
                const isDone = ev.status === "done";
                const isPending = ev.status === "pending" || (!isActive && !isDone);

                return (
                    <div key={`timeline-${i}`} className="relative pl-6">
                        {/* Vertical line connecting nodes */}
                        {!isLast && (
                            <div
                                className={cn(
                                    "absolute top-5 left-[-3px] bottom-[-20px] w-0.5",
                                    isDone || isActive
                                        ? (isLight ? "bg-slate-300" : "bg-white/20")
                                        : (isLight ? "bg-slate-100" : "bg-white/5")
                                )}
                            />
                        )}

                        {/* Status Node */}
                        <div
                            className={cn(
                                "absolute top-1 left-[-7px] w-2.5 h-2.5 rounded-full ring-4 shadow-sm",
                                isActive
                                    ? "" // Handled via style prop below
                                    : isDone
                                        ? (isLight ? "bg-slate-400 ring-slate-100" : "bg-white/50 ring-white/5")
                                        : (isLight ? "bg-slate-200 ring-slate-50" : "bg-white/10 ring-transparent")
                            )}
                            style={isActive ? { backgroundColor: accentColor, boxShadow: `0 0 0 4px ${accentColor}40` } : {}}
                        />

                        {/* Content */}
                        <div className="flex flex-col gap-0.5">
                            <span className={cn(
                                "text-[10px] font-medium tracking-wide",
                                isActive || isDone
                                    ? (isLight ? "text-slate-500" : "text-white/50")
                                    : (isLight ? "text-slate-400" : "text-white/30")
                            )}>
                                {ev.timestamp}
                            </span>
                            <span className={cn(
                                "text-sm",
                                isActive
                                    ? "font-semibold " + (isLight ? "text-slate-900" : "text-white")
                                    : isDone
                                        ? "font-medium " + (isLight ? "text-slate-700" : "text-white/70")
                                        : "font-medium " + (isLight ? "text-slate-400" : "text-white/40")
                            )}>
                                {ev.title}
                            </span>
                            {ev.description && (
                                <p className={cn(
                                    "text-xs leading-relaxed mt-1",
                                    isActive || isDone
                                        ? (isLight ? "text-slate-600" : "text-white/60")
                                        : (isLight ? "text-slate-400" : "text-white/30")
                                )}>
                                    {ev.description}
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});
