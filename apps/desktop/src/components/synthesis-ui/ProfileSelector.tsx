"use client";

import { useProfile } from "@/context/ProfileContext";
import { ChevronDown, User } from "lucide-react";

export function ProfileSelector() {
    const { profiles, activeProfileId, setActiveProfile } = useProfile();
    const activeProfile = profiles.find((p) => p.id === activeProfileId);

    if (profiles.length <= 1) return null;

    return (
        <div className="flex items-center gap-2">
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 shrink-0"
                style={{ color: "var(--synthesis-accent)" }}
            >
                <User size={16} />
            </div>
            <div className="relative">
                <select
                    value={activeProfileId ?? ""}
                    onChange={(e) => setActiveProfile(e.target.value || null)}
                    className="bg-theme-surface border border-theme text-theme rounded-lg pl-3 pr-8 py-1.5 text-[12px] font-medium outline-none cursor-pointer appearance-none hover:bg-theme-surface-hover"
                >
                    {profiles.map((p) => (
                        <option key={p.id} value={p.id} className="bg-theme-surface text-theme">
                            {p.displayName}
                        </option>
                    ))}
                </select>
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-theme-muted">
                    <ChevronDown size={10} />
                </div>
            </div>
        </div>
    );
}
