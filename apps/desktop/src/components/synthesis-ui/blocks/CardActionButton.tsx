"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ExternalLink, Wand2 } from "lucide-react";
import { useSynthesisCardContext } from "@/context/SynthesisCardContext";

interface CardAction {
    label: string;
    intent: string;
    primary?: boolean;
}

interface CardActionButtonProps {
    action: CardAction;
    isLight?: boolean;
    className?: string;
}

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

export const CardActionButton = React.memo(function CardActionButton({
    action,
    isLight = false,
    className,
}: CardActionButtonProps) {
    const cardCtx = useSynthesisCardContext();
    const isExternal = action.intent.startsWith("http");

    return (
        <button
            className={cn(
                "flex-1 py-2.5 px-3 rounded-xl flex items-center justify-center gap-2",
                "text-xs font-medium transition-all border active:scale-[0.97]",
                action.primary
                    ? isLight
                        ? "text-white bg-slate-900/90 hover:bg-slate-900 border-slate-900/60"
                        : "text-black bg-white/90 hover:bg-white border-white/60"
                    : isLight
                        ? "bg-slate-900/[0.06] hover:bg-slate-900/[0.12] text-slate-700 border-slate-900/[0.1]"
                        : "bg-white/[0.06] hover:bg-white/[0.12] text-white/70 border-white/[0.08]",
                className,
            )}
            onClick={() => dispatchIntent(action.intent, cardCtx?.nodeId ?? null, cardCtx?.originalQuery ?? null)}
        >
            <Wand2 size={12} />
            {action.label}
            {isExternal && <ExternalLink size={11} className="opacity-50" />}
        </button>
    );
});

// ── Action Row (group of buttons) ──

interface CardActionRowProps {
    actions: CardAction[];
    isLight?: boolean;
    className?: string;
}

export const CardActionRow = React.memo(function CardActionRow({
    actions,
    isLight = false,
    className,
}: CardActionRowProps) {
    if (!actions || actions.length === 0) return null;

    return (
        <div className={cn("flex gap-2 pt-2", className)}>
            {actions.map((action, i) => (
                <CardActionButton
                    key={`action-${i}`}
                    action={action}
                    isLight={isLight}
                />
            ))}
        </div>
    );
});
