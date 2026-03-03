"use client";

import { useState, useEffect } from "react";
import { CloudSun, Thermometer, Wind, Droplets } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

interface WeatherData {
    temp: string;
    condition: string;
    humidity: string;
    wind: string;
    location: string;
}

export function WeatherWidget() {
    const { settings } = useSettings();
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isLight = settings.theme === "light";

    useEffect(() => {
        async function fetchWeather() {
            try {
                const res = await fetch("https://wttr.in/?format=j1", {
                    headers: { "Accept": "application/json" },
                });
                if (!res.ok) throw new Error("Failed to fetch weather");
                const data = await res.json();
                const current = data.current_condition?.[0];
                const area = data.nearest_area?.[0];
                if (current) {
                    setWeather({
                        temp: `${current.temp_C}`,
                        condition: current.weatherDesc?.[0]?.value || "Unknown",
                        humidity: `${current.humidity}%`,
                        wind: `${current.windspeedKmph} km/h`,
                        location: area?.areaName?.[0]?.value || "Unknown",
                    });
                }
            } catch {
                setError("Could not load weather data");
            } finally {
                setLoading(false);
            }
        }
        void fetchWeather();
    }, []);

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-[180px]">
                <p className={cn("text-sm animate-pulse", isLight ? "text-black/30" : "text-white/30")}>
                    Loading weather...
                </p>
            </div>
        );
    }

    if (error || !weather) {
        return (
            <div className="p-6 flex flex-col items-center justify-center min-h-[180px]">
                <CloudSun size={32} className={isLight ? "text-black/20" : "text-white/20"} />
                <p className={cn("text-sm mt-2", isLight ? "text-black/40" : "text-white/40")}>
                    {error || "Weather unavailable"}
                </p>
            </div>
        );
    }

    return (
        <div className="p-6 min-h-[180px]">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <p className={cn("text-4xl font-light", isLight ? "text-black/80" : "text-white/80")}>
                        {weather.temp}<span className={cn("text-xl", isLight ? "text-black/30" : "text-white/30")}>°C</span>
                    </p>
                    <p className={cn("text-sm mt-1", isLight ? "text-black/50" : "text-white/50")}>
                        {weather.condition}
                    </p>
                </div>
                <CloudSun size={48} className={isLight ? "text-black/15" : "text-white/15"} />
            </div>
            <div className={cn("grid grid-cols-3 gap-3 pt-3 border-t", isLight ? "border-black/[0.06]" : "border-white/[0.06]")}>
                <div className="text-center">
                    <Droplets size={14} className={cn("mx-auto mb-1", isLight ? "text-black/25" : "text-white/25")} />
                    <p className={cn("text-[11px] font-mono", isLight ? "text-black/60" : "text-white/60")}>{weather.humidity}</p>
                    <p className={cn("text-[9px]", isLight ? "text-black/25" : "text-white/25")}>Humidity</p>
                </div>
                <div className="text-center">
                    <Wind size={14} className={cn("mx-auto mb-1", isLight ? "text-black/25" : "text-white/25")} />
                    <p className={cn("text-[11px] font-mono", isLight ? "text-black/60" : "text-white/60")}>{weather.wind}</p>
                    <p className={cn("text-[9px]", isLight ? "text-black/25" : "text-white/25")}>Wind</p>
                </div>
                <div className="text-center">
                    <Thermometer size={14} className={cn("mx-auto mb-1", isLight ? "text-black/25" : "text-white/25")} />
                    <p className={cn("text-[11px] font-mono", isLight ? "text-black/60" : "text-white/60")}>{weather.location}</p>
                    <p className={cn("text-[9px]", isLight ? "text-black/25" : "text-white/25")}>Location</p>
                </div>
            </div>
        </div>
    );
}
