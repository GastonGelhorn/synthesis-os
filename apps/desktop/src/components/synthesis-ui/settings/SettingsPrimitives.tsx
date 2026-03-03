"use client";

import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

export function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!enabled)}
            className="group relative w-10 h-[22px] rounded-full transition-all duration-300 ring-offset-2 focus:ring-2 ring-theme/20 outline-none"
            style={{
                background: enabled ? "var(--synthesis-accent)" : "rgba(255,255,255,0.08)",
                boxShadow: enabled ? "0 0 10px var(--synthesis-accent-glow)" : "inset 0 1px 2px rgba(0,0,0,0.2)",
            }}
        >
            <motion.div
                animate={{ x: enabled ? 20 : 2 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-md border-0.5 border-black/5"
            />
        </button>
    );
}

export function Slider({
    value,
    onChange,
    min = 0,
    max = 100,
    color = "var(--synthesis-accent)",
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    color?: string;
}) {
    const pct = ((value - min) / (max - min)) * 100;
    return (
        <div className="relative w-full h-1.5 rounded-full bg-theme-muted group/slider">
            <div
                className="absolute top-0 left-0 h-full rounded-full"
                style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}dd)`
                }}
            />
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md border border-black/5 pointer-events-none transition-transform group-hover/slider:scale-110 active:scale-95"
                style={{ left: `calc(${pct}% - 8px)` }}
            />
        </div>
    );
}

export function Select({ value, options, onChange }: { value: string; options: { label: string; value: string }[]; onChange: (v: string) => void }) {
    const safeOptions = Array.isArray(options) ? options : [];
    return (
        <div className="relative group/select">
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="bg-theme-surface border border-theme text-theme rounded-lg px-3 pr-8 py-1.5 text-[11px] font-medium outline-none transition-all cursor-pointer appearance-none hover:bg-theme-surface-hover hover:border-theme-secondary focus:ring-2 focus:ring-theme/20"
            >
                {safeOptions.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-theme-surface text-theme">
                        {opt.label}
                    </option>
                ))}
            </select>
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-theme-muted group-hover/select:text-theme transition-colors">
                <ChevronDown size={10} />
            </div>
        </div>
    );
}

export function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between py-3 border-b border-theme last:border-0">
            <div className="flex-1 pr-4">
                <p className="text-[12px] text-theme font-medium">{label}</p>
                {description && (
                    <p className="text-[10px] text-theme-muted mt-0.5 leading-relaxed">{description}</p>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
