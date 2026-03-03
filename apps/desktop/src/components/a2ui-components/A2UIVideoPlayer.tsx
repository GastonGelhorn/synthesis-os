"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIVideoPlayerProps } from "./types";

export const A2UIVideoPlayer = React.memo(function A2UIVideoPlayer({
    id,
    url,
    title,
    autoPlay = false,
    isLight = false,
}: A2UIVideoPlayerProps) {
    if (!url?.trim()) return null;

    const isYouTube = url.includes("youtube.com") || url.includes("youtu.be");

    const getYouTubeId = (url: string) => {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
        return match ? match[1] : null;
    };

    return (
        <div id={id} className={cn(
            "w-full rounded-xl overflow-hidden border bg-black aspect-video relative",
            isLight ? "border-slate-800/10" : "border-white/[0.06]"
        )}>
            {isYouTube ? (
                <iframe
                    width="100%"
                    height="100%"
                    src={`https://www.youtube.com/embed/${getYouTubeId(url)}${autoPlay ? "?autoplay=1&mute=1" : ""}`}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0"
                />
            ) : (
                <video
                    controls
                    autoPlay={autoPlay}
                    playsInline
                    className="w-full h-full object-contain"
                >
                    <source src={url} type="video/mp4" />
                    Your browser does not support the video tag.
                </video>
            )}

            {title && !isYouTube && (
                <div className="absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                    <span className="text-white/90 text-xs font-medium drop-shadow-md">{title}</span>
                </div>
            )}
        </div>
    );
});
