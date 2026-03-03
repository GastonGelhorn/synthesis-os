"use client";

import { useState, useCallback } from "react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

export function CalculatorWidget() {
    const { settings } = useSettings();
    const [display, setDisplay] = useState("0");
    const [expression, setExpression] = useState("");
    const isLight = settings.theme === "light";

    const handlePress = useCallback((val: string) => {
        if (val === "C") {
            setDisplay("0");
            setExpression("");
        } else if (val === "=") {
            try {
                const sanitized = expression.replace(/[^0-9+\-*/.() ]/g, "");
                const result = new Function(`return (${sanitized})`)() as number;
                setDisplay(String(Number(result.toFixed(10))));
                setExpression(String(Number(result.toFixed(10))));
            } catch {
                setDisplay("Error");
                setExpression("");
            }
        } else if (val === "DEL") {
            const newExpr = expression.slice(0, -1) || "";
            setExpression(newExpr);
            setDisplay(newExpr || "0");
        } else {
            const newExpr = expression === "0" && !isNaN(Number(val)) ? val : expression + val;
            setExpression(newExpr);
            setDisplay(newExpr);
        }
    }, [expression]);

    const buttons = [
        ["C", "DEL", "/", "*"],
        ["7", "8", "9", "-"],
        ["4", "5", "6", "+"],
        ["1", "2", "3", "="],
        ["0", ".", "", ""],
    ];

    return (
        <div className="p-4 min-h-[280px]">
            <div className={cn(
                "text-right text-2xl font-mono px-3 py-4 rounded-xl mb-3 overflow-hidden",
                isLight ? "bg-black/[0.04] text-black/80" : "bg-white/[0.04] text-white/80",
            )}>
                <p className={cn("text-[10px] text-right h-4 mb-1", isLight ? "text-black/30" : "text-white/30")}>{expression || " "}</p>
                <p className="truncate">{display}</p>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
                {buttons.flat().filter(Boolean).map((btn) => (
                    <button
                        key={btn}
                        onClick={() => handlePress(btn)}
                        className={cn(
                            "h-10 rounded-xl text-sm font-medium transition-all",
                            btn === "=" ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30" :
                            ["+", "-", "*", "/"].includes(btn)
                                ? isLight ? "bg-black/[0.06] text-black/60 hover:bg-black/[0.1]" : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1]"
                                : btn === "C" || btn === "DEL"
                                ? isLight ? "bg-red-500/10 text-red-500/70 hover:bg-red-500/20" : "bg-red-500/10 text-red-400/70 hover:bg-red-500/20"
                                : isLight ? "bg-black/[0.03] text-black/70 hover:bg-black/[0.06]" : "bg-white/[0.03] text-white/70 hover:bg-white/[0.06]",
                        )}
                    >
                        {btn}
                    </button>
                ))}
            </div>
        </div>
    );
}
