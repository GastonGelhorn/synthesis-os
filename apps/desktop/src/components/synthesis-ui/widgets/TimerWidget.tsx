"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

export function TimerWidget() {
    const { settings } = useSettings();
    const [elapsed, setElapsed] = useState(0);
    const [running, setRunning] = useState(false);
    const [mode, setMode] = useState<"stopwatch" | "countdown">("stopwatch");
    const [countdownTarget, setCountdownTarget] = useState(300); // 5 min default
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isLight = settings.theme === "light";

    useEffect(() => {
        if (running) {
            intervalRef.current = setInterval(() => {
                setElapsed((prev) => {
                    if (mode === "countdown" && prev >= countdownTarget) {
                        setRunning(false);
                        return countdownTarget;
                    }
                    return prev + 1;
                });
            }, 1000);
        } else if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [running, mode, countdownTarget]);

    const displayTime = mode === "countdown" ? Math.max(0, countdownTarget - elapsed) : elapsed;
    const hours = Math.floor(displayTime / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((displayTime % 3600) / 60).toString().padStart(2, "0");
    const seconds = (displayTime % 60).toString().padStart(2, "0");

    const handleReset = useCallback(() => {
        setRunning(false);
        setElapsed(0);
    }, []);

    const presets = [60, 300, 600, 1800];

    return (
        <div className="p-6 flex flex-col items-center justify-center min-h-[220px]">
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => { setMode("stopwatch"); handleReset(); }}
                    className={cn(
                        "px-3 py-1 rounded-lg text-[10px] font-medium transition-all",
                        mode === "stopwatch"
                            ? "bg-blue-500/20 text-blue-300"
                            : isLight ? "text-black/40 hover:text-black/60" : "text-white/40 hover:text-white/60",
                    )}
                >
                    Stopwatch
                </button>
                <button
                    onClick={() => { setMode("countdown"); handleReset(); }}
                    className={cn(
                        "px-3 py-1 rounded-lg text-[10px] font-medium transition-all",
                        mode === "countdown"
                            ? "bg-violet-500/20 text-violet-300"
                            : isLight ? "text-black/40 hover:text-black/60" : "text-white/40 hover:text-white/60",
                    )}
                >
                    Timer
                </button>
            </div>

            <div className={cn("text-4xl font-mono font-light tracking-[0.08em]", isLight ? "text-black/80" : "text-white/80")}>
                {hours}:{minutes}:{seconds}
            </div>

            {mode === "countdown" && !running && elapsed === 0 && (
                <div className="flex gap-2 mt-3">
                    {presets.map((s) => (
                        <button
                            key={s}
                            onClick={() => setCountdownTarget(s)}
                            className={cn(
                                "px-2 py-1 rounded text-[10px] transition-all",
                                countdownTarget === s
                                    ? "bg-violet-500/20 text-violet-300"
                                    : isLight ? "bg-black/[0.04] text-black/40" : "bg-white/[0.04] text-white/40",
                            )}
                        >
                            {s >= 3600 ? `${s / 3600}h` : s >= 60 ? `${s / 60}m` : `${s}s`}
                        </button>
                    ))}
                </div>
            )}

            <div className="flex gap-3 mt-5">
                <button
                    onClick={() => setRunning(!running)}
                    className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                        running
                            ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                            : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30",
                    )}
                >
                    {running ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                    onClick={handleReset}
                    className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                        isLight ? "bg-black/[0.04] text-black/40 hover:bg-black/[0.08]" : "bg-white/[0.04] text-white/40 hover:bg-white/[0.08]",
                    )}
                >
                    <RotateCcw size={16} />
                </button>
            </div>
        </div>
    );
}
