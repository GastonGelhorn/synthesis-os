"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UIInputProps } from "./types";

export const A2UIInput = React.memo(function A2UIInput({
    id,
    value,
    placeholder,
    type = "text",
    label,
    isLight = false,
}: A2UIInputProps) {
    const [currentValue, setCurrentValue] = useState(value || "");

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
            <input
                type={type}
                value={currentValue}
                onChange={(e) => {
                    setCurrentValue(e.target.value);
                    window.dispatchEvent(new CustomEvent("a2ui:input_change", {
                        detail: { id, value: e.target.value }
                    }));
                }}
                placeholder={placeholder}
                className={cn(
                    "w-full px-3 py-2 rounded-xl text-sm border outline-none transition-all focus:ring-2 focus:border-transparent",
                    isLight
                        ? "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-slate-300"
                        : "bg-white/[0.03] border-white/10 text-white placeholder:text-white/30 focus:ring-white/20"
                )}
            />
        </div>
    );
});
