"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { A2UIImageProps } from "./types";

export const A2UIImage = React.memo(function A2UIImage({
    id,
    url,
    caption,
    aspectRatio = "auto",
    isLight = false,
}: A2UIImageProps) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    if (error || !url?.trim()) return null;

    const aspectClass = {
        auto: "aspect-auto max-h-80",
        video: "aspect-video",
        square: "aspect-square",
        panorama: "aspect-[21/9]",
    }[aspectRatio];

    return (
        <div
            id={id}
            className={cn(
                "relative w-full rounded-xl overflow-hidden group",
                isLight ? "bg-slate-900/[0.03]" : "bg-white/[0.03]"
            )}
        >
            {!loaded && (
                <div className={cn(
                    "absolute inset-0 animate-pulse rounded-xl",
                    isLight ? "bg-slate-200/50" : "bg-white/5",
                )} />
            )}

            <img
                src={url}
                alt={caption || "A2UI Image"}
                className={cn(
                    "w-full object-cover transition-all duration-500",
                    aspectClass,
                    loaded ? "opacity-100" : "opacity-0",
                    "group-hover:scale-[1.02] transition-transform duration-700",
                )}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
            />

            {caption && loaded && (
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 pointer-events-none">
                    <p className={cn(
                        "text-xs",
                        isLight ? "text-slate-100/85" : "text-white/70",
                    )}>{caption}</p>
                </div>
            )}
        </div>
    );
});
