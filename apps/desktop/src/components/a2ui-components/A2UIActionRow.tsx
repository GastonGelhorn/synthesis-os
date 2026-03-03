"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, Wand2 } from "lucide-react";
import { A2UIActionRowProps } from "./types";
import { useSynthesisCardContext } from "@/context/SynthesisCardContext";

function dispatchIntent(intent: string, sourceNodeId: string | null, originalQuery: string | null) {
    if (intent.startsWith("http")) {
        window.open(intent, "_blank", "noopener,noreferrer");
        return;
    }
    window.dispatchEvent(new CustomEvent("synthesis:intent", {
        detail: {
            intent,
            sourceNodeId: sourceNodeId ?? undefined,
            originalQuery: originalQuery && originalQuery.trim() ? originalQuery.trim() : undefined,
        },
    }));
}

export const A2UIActionRow = React.memo(function A2UIActionRow({
    id,
    actions,
    isLight = false,
}: A2UIActionRowProps) {
    const cardCtx = useSynthesisCardContext();
    if (!actions || actions.length === 0) return null;

    return (
        <div id={id} className="flex gap-2 pt-2">
            {actions.map((action, i) => {
                const isExternal = action.intent.startsWith("http");

                return (
                    <button
                        key={`${id}-action-${i}`}
                        className={cn(
                            "flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2",
                            "text-xs font-medium transition-all border active:scale-[0.97]",
                            action.primary
                                ? isLight
                                    ? "text-white bg-slate-900/90 hover:bg-slate-900 border-slate-900/60"
                                    : "text-black bg-white/90 hover:bg-white border-white/60"
                                : isLight
                                    ? "bg-slate-900/[0.06] hover:bg-slate-900/[0.12] text-slate-700 border-slate-900/[0.1]"
                                    : "bg-white/[0.06] hover:bg-white/[0.12] text-white/70 border-white/[0.08]"
                        )}
                        onClick={() => dispatchIntent(action.intent, cardCtx?.nodeId ?? null, cardCtx?.originalQuery ?? null)}
                    >
                        {/* Optionally use the icon prop if passed, fallback to Wand2 */}
                        <Wand2 size={12} className={action.icon ? "hidden" : "block"} />
                        {action.label}
                        {isExternal && <ExternalLink size={11} className="opacity-50" />}
                    </button>
                );
            })}
        </div>
    );
});
