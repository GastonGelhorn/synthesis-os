"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Music, CloudSun, Calendar, Loader2, X } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/context/SettingsContext";

/* ─── Public types (still exported for compatibility) ─── */

export type WidgetType = "music" | "weather" | "calendar" | "custom";

export interface EphemeralWidget {
    id: string;
    type: WidgetType;
    data?: any;
    title?: string;
    createdAt: number;
}

/* ─── Static widget definitions (always visible) ─── */

interface WidgetDef {
    type: WidgetType;
    label: string;
    Icon: typeof Music;
    color: string;
    glow: string;
    bg: string;
    border: string;
}

const WIDGET_DEFS: WidgetDef[] = [
    {
        type: "weather",
        label: "Weather",
        Icon: CloudSun,
        color: "#fbbf24",
        glow: "rgba(251, 191, 36, 0.3)",
        bg: "rgba(251, 191, 36, 0.08)",
        border: "rgba(251, 191, 36, 0.2)",
    },
    {
        type: "music",
        label: "Music",
        Icon: Music,
        color: "#34d399",
        glow: "rgba(52, 211, 153, 0.3)",
        bg: "rgba(52, 211, 153, 0.08)",
        border: "rgba(52, 211, 153, 0.2)",
    },
    {
        type: "calendar",
        label: "Calendar",
        Icon: Calendar,
        color: "#a78bfa",
        glow: "rgba(167, 139, 250, 0.3)",
        bg: "rgba(167, 139, 250, 0.08)",
        border: "rgba(167, 139, 250, 0.2)",
    },
];

/* ─── Props ─── */

interface GenerativeZoneProps {
    /** Ephemeral widget data pushed by agents/commands (optional — panels work without it) */
    widgets?: EphemeralWidget[];
    onDismiss?: (id: string) => void;
    /** Master toggle from settings.widgetsEnabled */
    enabled?: boolean;
}

/* ═══════════════════════════════════════════════════
   GenerativeZone
   ═══════════════════════════════════════════════════ */

export const GenerativeZone = ({
    widgets = [],
    onDismiss,
    enabled = true,
}: GenerativeZoneProps) => {
    const { settings } = useSettings();
    const [openTypes, setOpenTypes] = useState<Set<WidgetType>>(new Set());
    const [activeType, setActiveType] = useState<WidgetType | null>(null);

    // Compute icon row left offset dynamically based on userName length
    // Base 318px covers the brand pill without a username.
    // Each char of userName adds ~7px (10px font + tracking), plus ~10px for the separator.
    const iconRowLeft = settings.userName
        ? 318 + 10 + Math.min(settings.userName.length * 7, 160)
        : 318;

    const toggleOpen = useCallback((type: WidgetType) => {
        setOpenTypes(prev => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });
        setActiveType(type);
    }, []);

    const closePanel = useCallback((type: WidgetType) => {
        setOpenTypes(prev => {
            const next = new Set(prev);
            next.delete(type);
            return next;
        });
    }, []);

    if (!enabled) return null;

    return (
        <>
            {/* ── Always-visible icon row: right of SYNTHESIS OS logo ── */}
            <div className="fixed top-[23px] z-[1001] flex flex-row items-center gap-1" style={{ left: iconRowLeft }}>
                {/* Separator dot */}
                <div className="w-px h-4 bg-white/[0.06] mr-1" />

                {WIDGET_DEFS.map((def, index) => {
                    const hasData = widgets.some(w => w.type === def.type);
                    return (
                        <WidgetTrigger
                            key={def.type}
                            def={def}
                            index={index}
                            isOpen={openTypes.has(def.type)}
                            hasData={hasData}
                            onToggle={() => toggleOpen(def.type)}
                        />
                    );
                })}
            </div>

            {/* ── Floating panels ── */}
            <AnimatePresence>
                {WIDGET_DEFS.filter(d => openTypes.has(d.type)).map((def, index) => {
                    const widgetData = widgets.find(w => w.type === def.type);
                    return (
                        <FloatingWidgetPanel
                            key={def.type}
                            def={def}
                            data={widgetData?.data}
                            index={index}
                            onClose={() => closePanel(def.type)}
                            zIndex={activeType === def.type ? 1510 : 1500 + index}
                            onActivate={() => setActiveType(def.type)}
                        />
                    );
                })}
            </AnimatePresence>
        </>
    );
};

/* ═══════════════════════════════════════
   WidgetTrigger — icon button in top bar
   ═══════════════════════════════════════ */

const WidgetTrigger = ({
    def,
    index,
    isOpen,
    hasData,
    onToggle,
}: {
    def: WidgetDef;
    index: number;
    isOpen: boolean;
    hasData: boolean;
    onToggle: () => void;
}) => {
    const [hovered, setHovered] = useState(false);
    const IconComp = def.Icon;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35, delay: index * 0.06, type: "spring", stiffness: 400, damping: 25 }}
            className="relative"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Glow */}
            <motion.div
                className="absolute inset-0 rounded-full -z-10"
                animate={{ opacity: hovered || isOpen ? 0.5 : 0, scale: hovered ? 1.6 : 1 }}
                transition={{ duration: 0.25 }}
                style={{
                    background: `radial-gradient(circle, ${def.glow} 0%, transparent 70%)`,
                    filter: "blur(10px)",
                }}
            />

            {/* Button */}
            <motion.button
                onClick={onToggle}
                style={{
                    background: isOpen
                        ? def.bg
                        : hovered
                            ? "rgba(var(--synthesis-glass-rgb), 0.45)"
                            : "rgba(var(--synthesis-glass-rgb), 0.2)",
                    borderColor: isOpen
                        ? def.border
                        : hovered
                            ? "rgba(255, 255, 255, 0.12)"
                            : "rgba(255, 255, 255, 0.05)",
                    boxShadow: isOpen
                        ? `0 0 14px ${def.glow}, 0 0 0 1px ${def.border} inset`
                        : "none",
                }}
                className={cn(
                    "relative w-8 h-8 rounded-full flex items-center justify-center",
                    "border transition-all duration-200 glass",
                )}
                title={`${isOpen ? "Close" : "Open"} ${def.label}`}
                aria-label={`${isOpen ? "Close" : "Open"} ${def.label} widget`}
            >
                <IconComp
                    size={15}
                    style={{
                        color: isOpen
                            ? def.color
                            : hovered
                                ? def.color
                                : "rgba(255,255,255,0.35)",
                    }}
                    className="transition-colors duration-200"
                />

                {/* Active indicator dot */}
                {isOpen && (
                    <motion.div
                        layoutId={`active-${def.type}`}
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
                        style={{ background: def.color, boxShadow: `0 0 6px ${def.color}` }}
                    />
                )}

                {/* Data-available pulse ring (when agent pushed data) */}
                {hasData && !isOpen && (
                    <motion.div
                        className="absolute inset-0 rounded-full border"
                        style={{ borderColor: def.color }}
                        animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    />
                )}
            </motion.button>

            {/* Tooltip */}
            <AnimatePresence>
                {hovered && (
                    <motion.div
                        initial={{ opacity: 0, y: -2, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -2, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute top-full mt-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap z-50 pointer-events-none"
                    >
                        <div
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium tracking-wide border"
                            style={{
                                background: "rgba(16, 20, 34, 0.9)",
                                backdropFilter: "blur(12px)",
                                borderColor: "rgba(255,255,255,0.08)",
                                color: def.color,
                            }}
                        >
                            {def.label}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

/* ═══════════════════════════════════════════════
   FloatingWidgetPanel — draggable glass panel
   ═══════════════════════════════════════════════ */

const PANEL_OFFSETS: Record<WidgetType, { x: number; y: number }> = {
    weather: { x: 218, y: 68 },
    music: { x: 258, y: 68 },
    calendar: { x: 298, y: 68 },
    custom: { x: 338, y: 68 },
};

const FloatingWidgetPanel = ({
    def,
    data,
    index,
    onClose,
    zIndex,
    onActivate,
}: {
    def: WidgetDef;
    data?: any;
    index: number;
    onClose: () => void;
    zIndex: number;
    onActivate: () => void;
}) => {
    const constraintsRef = useRef<HTMLDivElement>(null);
    const pos = PANEL_OFFSETS[def.type] || { x: 218 + index * 40, y: 68 };

    return (
        <>
            <div ref={constraintsRef} className="fixed inset-0 pointer-events-none z-[1400]" />

            <motion.div
                drag
                dragMomentum={false}
                dragConstraints={constraintsRef}
                dragElastic={0.05}
                initial={{ opacity: 0, scale: 0.85, y: -10, filter: "blur(10px)" }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)", zIndex }}
                exit={{ opacity: 0, scale: 0.9, y: -8, filter: "blur(8px)" }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="fixed pointer-events-auto cursor-grab active:cursor-grabbing"
                style={{ top: pos.y, left: pos.x }}
                onPointerDown={onActivate}
            >
                <div
                    className="relative rounded-2xl overflow-hidden glass-card"
                    style={{
                        borderColor: def.border,
                        boxShadow: `0 12px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 0 30px ${def.glow}`,
                        minWidth: 260,
                    }}
                >
                    {/* Top edge glow */}
                    <div
                        className="absolute inset-x-0 top-0 h-px z-20 pointer-events-none"
                        style={{ background: `linear-gradient(90deg, transparent 5%, ${def.color}60 50%, transparent 95%)` }}
                    />

                    {/* Header */}
                    <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                        <def.Icon size={14} style={{ color: def.color }} />
                        <span className="text-xs font-medium tracking-wide flex-1" style={{ color: def.color }}>
                            {def.label}
                        </span>
                        <button
                            onClick={(e) => { e.stopPropagation(); onClose(); }}
                            className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
                            aria-label="Close panel"
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <X size={12} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-3" onPointerDown={(e) => { onActivate(); e.stopPropagation(); }}>
                        <WidgetContent type={def.type} data={data} def={def} />
                    </div>
                </div>
            </motion.div>
        </>
    );
};

/* ═══════════════════════════════════════
   WidgetContent — renders actual data
   ═══════════════════════════════════════ */

interface WeatherState {
    temp: string;
    condition: string;
    location: string;
    humidity?: string;
    wind?: string;
}

const WidgetContent = ({
    type,
    data,
    def,
}: {
    type: WidgetType;
    data?: any;
    def: WidgetDef;
}) => {
    const [progress, setProgress] = useState(30);
    const [time, setTime] = useState(new Date());
    const [weatherData, setWeatherData] = useState<WeatherState | null>(null);
    const [weatherLoading, setWeatherLoading] = useState(true);

    // Music progress
    useEffect(() => {
        if (type === "music" && data?.title) {
            const interval = setInterval(() => setProgress(p => (p >= 100 ? 0 : p + 0.2)), 100);
            return () => clearInterval(interval);
        }
    }, [type, data?.title]);

    // Calendar clock
    useEffect(() => {
        if (type === "calendar") {
            const interval = setInterval(() => setTime(new Date()), 1000);
            return () => clearInterval(interval);
        }
    }, [type]);

    // Weather fetch
    useEffect(() => {
        if (type !== "weather") return;
        if (data?.temp) {
            setWeatherData({
                temp: data.temp, condition: data.condition || "Unknown",
                location: data.location || "Your Location",
                humidity: data.humidity, wind: data.wind,
            });
            setWeatherLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("https://wttr.in/?format=j1", { headers: { Accept: "application/json" } });
                if (!res.ok) throw new Error("Failed");
                const json = await res.json();
                if (cancelled) return;
                const cur = json.current_condition?.[0];
                const area = json.nearest_area?.[0];
                if (cur) {
                    setWeatherData({
                        temp: cur.temp_C,
                        condition: cur.weatherDesc?.[0]?.value || "Unknown",
                        location: area?.areaName?.[0]?.value || "Unknown",
                        humidity: cur.humidity ? `${cur.humidity}%` : undefined,
                        wind: cur.windspeedKmph ? `${cur.windspeedKmph} km/h` : undefined,
                    });
                }
            } catch {
                if (!cancelled) setWeatherData({ temp: "--", condition: "Unavailable", location: "Unknown" });
            } finally {
                if (!cancelled) setWeatherLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [type, data]);

    switch (type) {
        case "music": {
            const title = data?.title as string | undefined;
            const artist = data?.artist as string | undefined;
            const hasData = Boolean(title);
            return (
                <div className="flex items-center gap-3 min-w-[220px]">
                    <motion.div
                        className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: def.bg, border: `1px solid ${def.border}`, boxShadow: `0 0 14px ${def.glow}` }}
                        animate={hasData ? { scale: [1, 1.06, 1] } : {}}
                        transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <Music size={18} style={{ color: def.color }} />
                    </motion.div>
                    <div className="flex-1 min-w-0">
                        <p className="text-white/90 text-sm font-medium truncate">{title || "Now Playing"}</p>
                        <p className="text-white/40 text-[10px] uppercase tracking-wider mt-0.5 truncate">{artist || "No track info"}</p>
                        {hasData ? (
                            <div className="h-[3px] w-full bg-white/10 rounded-full mt-2.5 overflow-hidden">
                                <motion.div className="h-full rounded-full" style={{ width: `${progress}%`, background: def.color }} />
                            </div>
                        ) : (
                            <p className="text-white/20 text-[10px] mt-2 italic">Ask: &ldquo;play some music&rdquo;</p>
                        )}
                    </div>
                </div>
            );
        }

        case "weather":
            return (
                <div className="flex items-center gap-3 min-w-[200px]">
                    <motion.div animate={{ y: [0, -3, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
                        <CloudSun size={32} style={{ color: def.color }} />
                    </motion.div>
                    {weatherLoading ? (
                        <div className="flex items-center gap-2">
                            <Loader2 size={14} className="animate-spin text-white/40" />
                            <span className="text-xs text-white/40">Loading...</span>
                        </div>
                    ) : (
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-3xl font-light text-white/90 tracking-tighter leading-none">
                                    {weatherData?.temp ?? "--"}&deg;
                                </span>
                                <span className="text-[10px] text-white/40 uppercase tracking-wide">
                                    {weatherData?.condition ?? ""}
                                </span>
                            </div>
                            <p className="text-[10px] text-white/30 mt-1 truncate">{weatherData?.location ?? ""}</p>
                            {(weatherData?.humidity || weatherData?.wind) && (
                                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/25">
                                    {weatherData?.humidity && <span>Humidity {weatherData.humidity}</span>}
                                    {weatherData?.wind && <span>Wind {weatherData.wind}</span>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );

        case "calendar": {
            const events = data?.events as Array<{ title: string; time: string; color?: string }> | undefined;
            return (
                <div className="min-w-[220px]">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                        <span className="text-base font-mono text-white/85 leading-none">
                            {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                        <span className="text-[10px] text-white/30 uppercase tracking-wider">
                            {time.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                    </div>
                    {events && events.length > 0 ? (
                        <div className="space-y-2 max-h-[150px] overflow-y-auto">
                            {events.slice(0, 4).map((evt, i) => (
                                <div key={i} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.04]">
                                    <div className="w-0.5 h-5 rounded-full shrink-0" style={{ backgroundColor: evt.color || def.color }} />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-white/80 text-xs font-medium truncate">{evt.title}</p>
                                        <p className="text-white/30 text-[10px]">{evt.time}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-3">
                            <Calendar className="mx-auto mb-1.5 text-white/10" size={20} />
                            <p className="text-white/20 text-[10px] italic">Ask: &ldquo;What&apos;s on my calendar?&rdquo;</p>
                        </div>
                    )}
                </div>
            );
        }

        default:
            return <div className="min-w-[180px] text-white/60 text-xs">{data?.content || "Widget"}</div>;
    }
};
