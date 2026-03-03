"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface CardLinkPreviewProps {
    url: string;
    title: string;
    description?: string;
    isLight?: boolean;
    className?: string;
}

export const CardLinkPreview = React.memo(function CardLinkPreview({
    url,
    title,
    description,
    isLight = false,
    className,
}: CardLinkPreviewProps) {
    if (!url?.trim()) return null;

    let hostname = "";
    try {
        hostname = new URL(url).hostname.replace("www.", "");
    } catch {
        hostname = url.slice(0, 30);
    }

    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "flex items-start gap-3 rounded-xl p-3 border transition-colors group",
                isLight
                    ? "border-slate-800/10 bg-slate-900/[0.03] hover:bg-slate-900/[0.06]"
                    : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]",
                className,
            )}
        >
            {/* Favicon placeholder */}
            <div
                className={cn(
                    "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5",
                    isLight ? "bg-slate-900/[0.06]" : "bg-white/[0.06]",
                )}
            >
                <img
                    src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                    alt=""
                    className="w-4 h-4"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span
                        className={cn(
                            "text-sm font-medium truncate",
                            isLight ? "text-slate-800" : "text-white/90",
                        )}
                    >
                        {title}
                    </span>
                    <ExternalLink
                        size={11}
                        className={cn(
                            "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                            isLight ? "text-slate-400" : "text-white/30",
                        )}
                    />
                </div>
                <span
                    className={cn(
                        "text-[10px] tracking-wide",
                        isLight ? "text-slate-400" : "text-white/25",
                    )}
                >
                    {hostname}
                </span>
                {description && (
                    <p
                        className={cn(
                            "text-xs mt-1 line-clamp-2 leading-relaxed",
                            isLight ? "text-slate-600" : "text-white/50",
                        )}
                    >
                        {description}
                    </p>
                )}
            </div>
        </a>
    );
});
