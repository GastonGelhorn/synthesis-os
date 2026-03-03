"use client";

import { useState, useEffect } from "react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

export function ClockWidget() {
    const { settings } = useSettings();
    const [time, setTime] = useState(new Date());
    const isLight = settings.theme === "light";

    useEffect(() => {
        const interval = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    const hours = time.getHours().toString().padStart(2, "0");
    const minutes = time.getMinutes().toString().padStart(2, "0");
    const seconds = time.getSeconds().toString().padStart(2, "0");
    const dateStr = time.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
    });

    return (
        <div className="p-6 flex flex-col items-center justify-center min-h-[200px]">
            <div className={cn("text-5xl font-light tracking-[0.1em] font-mono", isLight ? "text-black/80" : "text-white/80")}>
                {hours}
                <span className="animate-pulse">:</span>
                {minutes}
                <span className={cn("text-2xl ml-1", isLight ? "text-black/30" : "text-white/30")}>{seconds}</span>
            </div>
            <p className={cn("text-sm mt-3 font-light", isLight ? "text-black/40" : "text-white/40")}>
                {dateStr}
            </p>
            <p className={cn("text-[10px] mt-1 font-mono", isLight ? "text-black/25" : "text-white/25")}>
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
        </div>
    );
}
