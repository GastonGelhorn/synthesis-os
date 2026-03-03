"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UIDatePickerProps } from "./types";

export const A2UIDatePicker = React.memo(function A2UIDatePicker({
    id,
    date,
    label,
    isLight = false,
}: A2UIDatePickerProps) {
    const [currentDate, setCurrentDate] = useState(date || "");

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
                type="date"
                value={currentDate.split('T')[0]} // Handle ISO strings roughly
                onChange={(e) => {
                    setCurrentDate(e.target.value);
                    window.dispatchEvent(new CustomEvent("a2ui:date_change", {
                        detail: { id, value: e.target.value }
                    }));
                }}
                className={cn(
                    "w-full px-3 py-2 rounded-xl text-sm border outline-none transition-all focus:ring-2 focus:border-transparent",
                    isLight
                        ? "bg-white border-slate-200 text-slate-800 focus:ring-slate-300"
                        : "bg-white/[0.03] border-white/10 text-white focus:ring-white/20",
                    // Hide the default calendar icon slightly custom ways or style it
                    // WebKit specific pseudo element styling usually goes in global css
                )}
            />
        </div>
    );
});
