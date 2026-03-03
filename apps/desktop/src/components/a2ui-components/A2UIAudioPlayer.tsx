"use client";

import React, { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { A2UIAudioPlayerProps } from "./types";
import { Play, Pause, Volume2, Music } from "lucide-react";

export const A2UIAudioPlayer = React.memo(function A2UIAudioPlayer({
    id,
    url,
    title = "Audio snippet",
    artist,
    autoPlay = false,
    isLight = false,
    accentColor = "#7BD4FF",
}: A2UIAudioPlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(autoPlay);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (autoPlay && audioRef.current) {
            audioRef.current.play().catch(console.error);
        }
    }, [autoPlay]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(console.error);
        }
        setIsPlaying(!isPlaying);
    };

    const handleTimeUpdate = () => {
        if (!audioRef.current) return;
        setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100 || 0);
    };

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        if (audioRef.current && audioRef.current.duration) {
            audioRef.current.currentTime = (val / 100) * audioRef.current.duration;
            setProgress(val);
        }
    };

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    if (!url) return null;

    return (
        <div id={id} className={cn(
            "w-full rounded-xl p-3 border flex flex-col gap-3 transition-colors",
            isLight ? "bg-slate-900/[0.03] border-slate-800/10" : "bg-white/[0.04] border-white/10 shadow-lg shadow-black/20"
        )}>
            <audio
                ref={audioRef}
                src={url}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onEnded={() => setIsPlaying(false)}
            />

            <div className="flex items-center gap-3">
                <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    isLight ? "bg-slate-200 text-slate-500" : "bg-white/10 text-white/50"
                )}>
                    {isPlaying ? (
                        <div className="flex items-end justify-center gap-0.5 h-4 w-4">
                            <span className={cn("w-1 rounded-sm animate-pulse", isLight ? "bg-slate-500" : "bg-white")} style={{ height: "40%" }} />
                            <span className={cn("w-1 rounded-sm animate-pulse", isLight ? "bg-slate-500" : "bg-white")} style={{ animationDelay: "150ms", height: "100%" }} />
                            <span className={cn("w-1 rounded-sm animate-pulse", isLight ? "bg-slate-500" : "bg-white")} style={{ animationDelay: "300ms", height: "60%" }} />
                        </div>
                    ) : (
                        <Music size={18} />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <h4 className={cn("text-sm font-semibold truncate", isLight ? "text-slate-800" : "text-white/90")}>{title}</h4>
                    {artist && (
                        <p className={cn("text-xs truncate", isLight ? "text-slate-500" : "text-white/50")}>{artist}</p>
                    )}
                </div>

                <button
                    onClick={togglePlay}
                    className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95",
                        isLight ? "bg-slate-900 text-white shadow-sm" : "bg-white text-black shadow-md"
                    )}
                >
                    {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
                </button>
            </div>

            <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className={isLight ? "text-slate-500" : "text-white/40"}>{formatTime(audioRef.current?.currentTime || 0)}</span>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={progress}
                    onChange={handleSeek}
                    className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-black/10 disabled:opacity-50"
                    style={{
                        background: `linear-gradient(to right, ${accentColor} ${progress}%, ${isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'} ${progress}%)`
                    }}
                />
                <span className={isLight ? "text-slate-500" : "text-white/40"}>{formatTime(duration)}</span>
            </div>
        </div>
    );
});
