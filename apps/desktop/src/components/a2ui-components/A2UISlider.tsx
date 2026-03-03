"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UISliderProps } from "./types";

export const A2UISlider = React.memo(function A2UISlider({
    id,
    value,
    min = 0,
    max = 100,
    step = 1,
    label,
    isLight = false,
    accentColor = "#7BD4FF",
}: A2UISliderProps) {
    const [currentValue, setCurrentValue] = useState(value);

    // Calculate percentage for gradient background
    const percentage = Math.max(0, Math.min(100, ((currentValue - min) / (max - min)) * 100));

    return (
        <div id={id} className="flex flex-col gap-2 w-full py-1">
            {label && (
                <div className="flex items-center justify-between">
                    <span className={cn(
                        "text-xs font-semibold tracking-wide",
                        isLight ? "text-slate-600" : "text-white/60"
                    )}>
                        {label}
                    </span>
                    <span className={cn(
                        "text-[10px] font-mono",
                        isLight ? "text-slate-400" : "text-white/40"
                    )}>
                        {currentValue}
                    </span>
                </div>
            )}
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={currentValue}
                onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCurrentValue(val);
                }}
                onMouseUp={() => {
                    window.dispatchEvent(new CustomEvent("a2ui:slider_change", {
                        detail: { id, value: currentValue }
                    }));
                }}
                onTouchEnd={() => {
                    window.dispatchEvent(new CustomEvent("a2ui:slider_change", {
                        detail: { id, value: currentValue }
                    }));
                }}
                className={cn(
                    "w-full h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2",
                    isLight
                        ? "bg-slate-200 focus:ring-slate-300 focus:ring-offset-white"
                        : "bg-white/10 focus:ring-white/20 focus:ring-offset-slate-900"
                )}
                style={{
                    background: `linear-gradient(to right, ${accentColor} ${percentage}%, ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'} ${percentage}%)`
                }}
            />
            {/* Styles for range thumb rely on global or custom CSS, but basic Webkit works with standard tailwind resets */}
        </div>
    );
});
