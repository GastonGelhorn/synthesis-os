"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UIToggleProps } from "./types";

export const A2UIToggle = React.memo(function A2UIToggle({
    id,
    checked,
    label,
    isLight = false,
    accentColor = "#7BD4FF",
}: A2UIToggleProps) {
    const [isOn, setIsOn] = useState(checked || false);

    const handleToggle = () => {
        const nextState = !isOn;
        setIsOn(nextState);
        window.dispatchEvent(new CustomEvent("a2ui:toggle_change", {
            detail: { id, checked: nextState }
        }));
    };

    return (
        <div id={id} className="flex items-center justify-between gap-3 w-full py-2">
            <span className={cn(
                "text-sm font-medium",
                isLight ? "text-slate-800" : "text-white/90"
            )}>
                {label}
            </span>
            <button
                type="button"
                onClick={handleToggle}
                className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2",
                    isOn
                        ? (isLight ? "bg-slate-900 focus:ring-slate-900" : "")
                        : (isLight ? "bg-slate-200 focus:ring-slate-400" : "bg-white/10 focus:ring-white/20"),
                    isLight ? "focus:ring-offset-white" : "focus:ring-offset-slate-900"
                )}
                style={isOn && !isLight ? { backgroundColor: accentColor, "--tw-ring-color": accentColor } as React.CSSProperties : {}}
            >
                <span
                    aria-hidden="true"
                    className={cn(
                        "pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                        isOn ? "translate-x-1.5" : "-translate-x-1.5"
                    )}
                />
            </button>
        </div>
    );
});
