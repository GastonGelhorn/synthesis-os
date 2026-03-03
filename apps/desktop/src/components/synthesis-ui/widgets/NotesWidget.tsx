"use client";

import { useState, useEffect, useCallback } from "react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

interface NotesWidgetProps {
    nodeId: string;
}

const NOTES_STORAGE_PREFIX = "synthesis-widget-notes-";

export function NotesWidget({ nodeId }: NotesWidgetProps) {
    const { settings } = useSettings();
    const [text, setText] = useState("");
    const [saved, setSaved] = useState(false);
    const isLight = settings.theme === "light";

    useEffect(() => {
        const stored = localStorage.getItem(`${NOTES_STORAGE_PREFIX}${nodeId}`);
        if (stored) setText(stored);
    }, [nodeId]);

    const handleChange = useCallback((value: string) => {
        setText(value);
        localStorage.setItem(`${NOTES_STORAGE_PREFIX}${nodeId}`, value);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
    }, [nodeId]);

    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

    return (
        <div className="p-4 flex flex-col min-h-[240px]">
            <textarea
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Start typing your notes..."
                className={cn(
                    "flex-1 bg-transparent border-none outline-none resize-none text-sm font-light leading-relaxed min-h-[180px]",
                    isLight ? "text-black/80 placeholder-black/25" : "text-white/80 placeholder-white/25",
                )}
            />
            <div className={cn("flex items-center justify-between pt-2 border-t mt-2", isLight ? "border-black/[0.06]" : "border-white/[0.06]")}>
                <span className={cn("text-[10px] font-mono", isLight ? "text-black/25" : "text-white/25")}>
                    {wordCount} words
                </span>
                {saved && (
                    <span className="text-[10px] text-emerald-400/70 font-mono">saved</span>
                )}
            </div>
        </div>
    );
}
