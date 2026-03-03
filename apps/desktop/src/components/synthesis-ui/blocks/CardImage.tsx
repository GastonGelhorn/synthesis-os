"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

interface CardImageProps {
    src: string;
    alt?: string;
    caption?: string;
    className?: string;
    aspectRatio?: "auto" | "video" | "square";
    isLight?: boolean;
    onClick?: () => void;
}

export const CardImage = React.memo(function CardImage({
    src,
    alt = "",
    caption,
    className,
    aspectRatio = "auto",
    isLight = false,
    onClick,
}: CardImageProps) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    if (error || !src?.trim()) return null;

    const aspectClass = {
        auto: "aspect-auto max-h-80",
        video: "aspect-video",
        square: "aspect-square",
    }[aspectRatio];

    return (
        <div
            className={cn(
                "relative w-full rounded-xl overflow-hidden group",
                isLight ? "bg-slate-900/[0.03]" : "bg-white/[0.03]",
                onClick && "cursor-pointer",
                className,
            )}
            onClick={onClick}
        >
            {/* Loading skeleton */}
            {!loaded && (
                <div className={cn(
                    "absolute inset-0 animate-pulse rounded-xl",
                    isLight ? "bg-slate-200/50" : "bg-white/5",
                )} />
            )}

            <img
                src={src}
                alt={alt || caption || "Image"}
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
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
                    <p className={cn(
                        "text-xs",
                        isLight ? "text-slate-100/85" : "text-white/70",
                    )}>{caption}</p>
                </div>
            )}
        </div>
    );
});
