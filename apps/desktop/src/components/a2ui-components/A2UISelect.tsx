"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UISelectProps } from "./types";
import { ChevronDown } from "lucide-react";

export const A2UISelect = React.memo(function A2UISelect({
    id,
    value,
    options,
    label,
    isLight = false,
}: A2UISelectProps) {
    const [currentValue, setCurrentValue] = useState(value || (options?.[0]?.value ?? ""));

    if (!options || options.length === 0) return null;

    return (
        <div id={id} className="flex flex-col gap-1.5 w-full">
            {label && (
                <label className={cn(
                    "text-[10px] font-semibold tracking-wide uppercase px-1",
                    isLight ? "text-slate-500" : "text-white/40"
                )}>
                    {label}
                </label>
            )}
            <div className="relative">
                <select
                    value={currentValue}
                    onChange={(e) => {
                        setCurrentValue(e.target.value);
                        window.dispatchEvent(new CustomEvent("a2ui:select_change", {
                            detail: { id, value: e.target.value }
                        }));
                    }}
                    className={cn(
                        "w-full px-3 py-2 rounded-xl text-sm border outline-none transition-all appearance-none cursor-pointer focus:ring-2 focus:border-transparent",
                        isLight
                            ? "bg-white border-slate-200 text-slate-800 focus:ring-slate-300"
                            : "bg-white/[0.03] border-white/10 text-white focus:ring-white/20"
                    )}
                >
                    {options.map((opt) => (
                        <option key={opt.value} value={opt.value} className={cn(isLight ? "text-black" : "text-black")}>
                            {opt.label}
                        </option>
                    ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    <ChevronDown size={14} className={cn(isLight ? "text-slate-500" : "text-white/40")} />
                </div>
            </div>
        </div>
    );
});
