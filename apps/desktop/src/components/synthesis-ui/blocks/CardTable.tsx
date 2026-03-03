"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface CardTableProps {
    headers: string[];
    rows: string[][];
    isLight?: boolean;
    className?: string;
}

export const CardTable = React.memo(function CardTable({
    headers,
    rows,
    isLight = false,
    className,
}: CardTableProps) {
    if (!headers?.length || !rows?.length) return null;

    return (
        <div
            className={cn(
                "rounded-xl overflow-hidden border",
                isLight ? "border-slate-800/10" : "border-white/[0.06]",
                className,
            )}
        >
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr
                            className={cn(
                                "border-b",
                                isLight
                                    ? "border-slate-800/10 bg-slate-900/[0.04]"
                                    : "border-white/[0.06] bg-white/[0.03]",
                            )}
                        >
                            {headers.map((h, i) => (
                                <th
                                    key={`th-${i}`}
                                    className={cn(
                                        "px-3 py-2 text-left text-[10px] uppercase tracking-[0.15em] font-semibold",
                                        isLight ? "text-slate-500" : "text-white/35",
                                    )}
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) => (
                            <tr
                                key={`tr-${ri}`}
                                className={cn(
                                    "border-b last:border-b-0 transition-colors",
                                    isLight
                                        ? "border-slate-800/[0.05] hover:bg-slate-900/[0.02]"
                                        : "border-white/[0.03] hover:bg-white/[0.02]",
                                )}
                            >
                                {row.map((cell, ci) => (
                                    <td
                                        key={`td-${ri}-${ci}`}
                                        className={cn(
                                            "px-3 py-2 text-xs",
                                            isLight ? "text-slate-700" : "text-white/70",
                                        )}
                                    >
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
