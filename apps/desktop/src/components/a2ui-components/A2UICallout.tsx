"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { A2UICalloutProps } from "./types";
import { parseTextWithLinks, hasLinkableUrls } from "@/lib/textWithLinks";

const VARIANT_CONFIG: Record<string, {
    icon: typeof Info;
    borderDark: string;
    borderLight: string;
    bgDark: string;
    bgLight: string;
    iconDark: string;
    iconLight: string;
}> = {
    info: {
        icon: Info,
        borderDark: "border-blue-400/20",
        borderLight: "border-blue-500/25",
        bgDark: "bg-blue-400/[0.06]",
        bgLight: "bg-blue-500/[0.06]",
        iconDark: "text-blue-400/70",
        iconLight: "text-blue-600",
    },
    warning: {
        icon: AlertTriangle,
        borderDark: "border-amber-400/20",
        borderLight: "border-amber-500/25",
        bgDark: "bg-amber-400/[0.06]",
        bgLight: "bg-amber-500/[0.06]",
        iconDark: "text-amber-400/70",
        iconLight: "text-amber-600",
    },
    success: {
        icon: CheckCircle2,
        borderDark: "border-emerald-400/20",
        borderLight: "border-emerald-500/25",
        bgDark: "bg-emerald-400/[0.06]",
        bgLight: "bg-emerald-500/[0.06]",
        iconDark: "text-emerald-400/70",
        iconLight: "text-emerald-600",
    },
    error: {
        icon: XCircle,
        borderDark: "border-red-400/20",
        borderLight: "border-red-500/25",
        bgDark: "bg-red-400/[0.06]",
        bgLight: "bg-red-500/[0.06]",
        iconDark: "text-red-400/70",
        iconLight: "text-red-600",
    },
};

export const A2UICallout = React.memo(function A2UICallout({
    id,
    content,
    variant = "info",
    title,
    isLight = false,
}: A2UICalloutProps) {
    if (!content?.trim()) return null;

    const contentRendered = useMemo(
        () => (hasLinkableUrls(content) ? parseTextWithLinks(content, isLight) : content),
        [content, isLight],
    );

    const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info;
    const Icon = config.icon;

    return (
        <div
            id={id}
            className={cn(
                "flex gap-3 rounded-xl p-3 border",
                "a2ui-callout",
                isLight
                    ? cn(config.borderLight, config.bgLight)
                    : cn(config.borderDark, config.bgDark)
            )}
        >
            <Icon
                size={16}
                className={cn(
                    "shrink-0 mt-0.5",
                    isLight ? config.iconLight : config.iconDark,
                )}
            />
            <div className="flex-1 min-w-0">
                {title && (
                    <p
                        className={cn(
                            "text-xs font-semibold mb-0.5",
                            isLight ? "text-slate-800" : "text-white/85",
                        )}
                    >
                        {title}
                    </p>
                )}
                <p
                    className={cn(
                        "text-xs leading-relaxed",
                        isLight ? "text-slate-700" : "text-white/65",
                    )}
                >
                    {contentRendered}
                </p>
            </div>
        </div>
    );
});
