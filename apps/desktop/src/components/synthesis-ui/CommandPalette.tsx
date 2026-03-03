"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Search,
    Layers,
    Settings,
    Eye,
    Minus,
    Globe2,
    FileText,
    Sparkles,
    Briefcase,
    Gamepad2,
    FlaskConical,
    Command,
} from "lucide-react";
import { SynthesisNode, SpaceId } from "@/types/synthesis";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

interface CommandItem {
    id: string;
    label: string;
    description?: string;
    icon: React.ReactNode;
    shortcut?: string;
    category: "action" | "node" | "space" | "settings";
    action: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    nodes: SynthesisNode[];
    onActivateNode: (id: string) => void;
    onSwitchSpace: (spaceId: SpaceId) => void;
    onOpenSettings: () => void;
    onToggleGodMode: () => void;
    onMinimizeAll: () => void;
    onSearch: (query: string) => void;
    onSpawnEphemeral: (type: "music" | "weather" | "calendar") => void;
    onToggleFocusMode?: () => void;
}

function fuzzyMatch(text: string, query: string): number {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    if (lower.includes(q)) return q.length / lower.length + 0.5;
    let qi = 0;
    let score = 0;
    for (let i = 0; i < lower.length && qi < q.length; i++) {
        if (lower[i] === q[qi]) {
            score += 1;
            qi++;
        }
    }
    return qi === q.length ? score / lower.length : 0;
}

export function CommandPalette({
    isOpen,
    onClose,
    nodes,
    onActivateNode,
    onSwitchSpace,
    onOpenSettings,
    onToggleGodMode,
    onMinimizeAll,
    onSearch,
    onSpawnEphemeral,
    onToggleFocusMode,
}: CommandPaletteProps) {
    const { settings } = useSettings();
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const isLight = settings.theme === "light";

    // Build command list
    const commands = useMemo<CommandItem[]>(() => {
        const items: CommandItem[] = [
            {
                id: "action:settings",
                label: "Open Settings",
                icon: <Settings size={14} />,
                shortcut: "Cmd+,",
                category: "action",
                action: () => { onOpenSettings(); onClose(); },
            },
            {
                id: "action:godmode",
                label: "Toggle God Mode",
                icon: <Eye size={14} />,
                shortcut: "Cmd+G",
                category: "action",
                action: () => { onToggleGodMode(); onClose(); },
            },
            {
                id: "action:minimize",
                label: "Minimize All Nodes",
                icon: <Minus size={14} />,
                shortcut: "Cmd+M",
                category: "action",
                action: () => { onMinimizeAll(); onClose(); },
            },
            {
                id: "action:focus",
                label: "Toggle Focus Mode",
                description: "Hide chrome, center on your work",
                icon: <Eye size={14} />,
                shortcut: "\u21E7\u2318F",
                category: "action",
                action: () => { onToggleFocusMode?.(); onClose(); },
            },
            {
                id: "debug:spawn-music",
                label: "Spawn Music Widget (Demo)",
                icon: <Sparkles size={14} className="text-emerald-400" />,
                category: "action",
                action: () => { onSpawnEphemeral("music"); onClose(); },
            },
            {
                id: "debug:spawn-weather",
                label: "Spawn Weather Widget (Demo)",
                icon: <Sparkles size={14} className="text-amber-400" />,
                category: "action",
                action: () => { onSpawnEphemeral("weather"); onClose(); },
            },
            {
                id: "debug:spawn-calendar",
                label: "Spawn Calendar Widget (Demo)",
                icon: <Sparkles size={14} className="text-purple-400" />,
                category: "action",
                action: () => { onSpawnEphemeral("calendar"); onClose(); },
            },
            {
                id: "space:work",
                label: "Switch to Work",
                icon: <Briefcase size={14} />,
                shortcut: "Cmd+1",
                category: "space",
                action: () => { onSwitchSpace("work"); onClose(); },
            },
            {
                id: "space:entertainment",
                label: "Switch to Play",
                icon: <Gamepad2 size={14} />,
                shortcut: "Cmd+2",
                category: "space",
                action: () => { onSwitchSpace("entertainment"); onClose(); },
            },
            {
                id: "space:research",
                label: "Switch to Research",
                icon: <FlaskConical size={14} />,
                shortcut: "Cmd+3",
                category: "space",
                action: () => { onSwitchSpace("research"); onClose(); },
            },
        ];

        // Add existing nodes
        for (const node of nodes.filter((n) => n.status !== "synthesizing")) {
            items.push({
                id: `node:${node.id}`,
                label: node.title,
                description: `${node.type} in ${node.spaceId}`,
                icon: <FileText size={14} />,
                category: "node",
                action: () => { onActivateNode(node.id); onClose(); },
            });
        }

        return items;
    }, [
        nodes,
        onActivateNode,
        onClose,
        onOpenSettings,
        onSwitchSpace,
        onToggleGodMode,
        onMinimizeAll,
        onSpawnEphemeral,
        onToggleFocusMode,
    ]);

    // Filtered and scored results
    const results = useMemo(() => {
        if (!query.trim()) return commands;
        return commands
            .map((item) => ({
                item,
                score: Math.max(
                    fuzzyMatch(item.label, query),
                    fuzzyMatch(item.description || "", query),
                ),
            }))
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((r) => r.item);
    }, [commands, query]);

    // Reset on open
    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Keyboard navigation
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[selectedIndex]) {
                    results[selectedIndex].action();
                } else if (query.trim()) {
                    onSearch(query.trim());
                    onClose();
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        },
        [results, selectedIndex, query, onSearch, onClose],
    );

    // Scroll selected item into view
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const selected = list.children[selectedIndex] as HTMLElement;
        if (selected) {
            selected.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    // Reset index when query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[3000] bg-black/50 backdrop-blur-sm"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: -20 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        className="fixed top-[20%] left-1/2 -translate-x-1/2 z-[3001] w-[520px] max-h-[400px] flex flex-col rounded-2xl overflow-hidden"
                        style={{
                            background: isLight ? "rgba(240, 242, 248, 0.97)" : "rgba(10, 12, 28, 0.97)",
                            backdropFilter: "blur(var(--synthesis-glass-blur, 40px))",
                            border: isLight ? "1px solid rgba(0,0,0,0.08)" : "1px solid rgba(255,255,255,0.08)",
                            boxShadow: isLight
                                ? "0 25px 50px rgba(0,0,0,0.1)"
                                : "0 25px 50px rgba(0,0,0,0.5)",
                        }}
                    >
                        {/* Search input */}
                        <div className={cn(
                            "flex items-center gap-3 px-4 py-3 border-b",
                            isLight ? "border-black/[0.06]" : "border-white/[0.06]",
                        )}>
                            <Command size={14} className={isLight ? "text-black/30" : "text-white/30"} />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a command or search..."
                                className={cn(
                                    "flex-1 bg-transparent border-none outline-none text-sm font-light",
                                    isLight ? "text-black placeholder-black/30" : "text-white placeholder-white/30",
                                )}
                            />
                            <kbd className={cn(
                                "text-[9px] font-mono px-1.5 py-0.5 rounded",
                                isLight ? "bg-black/[0.06] text-black/30" : "bg-white/[0.06] text-white/30",
                            )}>
                                ESC
                            </kbd>
                        </div>

                        {/* Results */}
                        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5 max-h-[300px]">
                            {results.length === 0 && query.trim() ? (
                                <button
                                    onClick={() => { onSearch(query.trim()); onClose(); }}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                        isLight ? "hover:bg-black/[0.04]" : "hover:bg-white/[0.04]",
                                    )}
                                >
                                    <Sparkles size={14} className="text-violet-400" />
                                    <div>
                                        <p className={cn("text-sm", isLight ? "text-black/80" : "text-white/80")}>
                                            Synthesize &ldquo;{query}&rdquo;
                                        </p>
                                        <p className={cn("text-[10px]", isLight ? "text-black/30" : "text-white/30")}>
                                            Run a new synthesis with this query
                                        </p>
                                    </div>
                                </button>
                            ) : (
                                results.map((item, index) => (
                                    <button
                                        key={item.id}
                                        onClick={item.action}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors",
                                            index === selectedIndex
                                                ? isLight ? "bg-black/[0.06]" : "bg-white/[0.06]"
                                                : isLight ? "hover:bg-black/[0.03]" : "hover:bg-white/[0.03]",
                                        )}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <span className={isLight ? "text-black/40" : "text-white/40"}>
                                            {item.icon}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className={cn("text-[12px] truncate", isLight ? "text-black/80" : "text-white/80")}>
                                                {item.label}
                                            </p>
                                            {item.description && (
                                                <p className={cn("text-[10px] truncate", isLight ? "text-black/30" : "text-white/30")}>
                                                    {item.description}
                                                </p>
                                            )}
                                        </div>
                                        {item.shortcut && (
                                            <kbd className={cn(
                                                "text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0",
                                                isLight ? "bg-black/[0.06] text-black/25" : "bg-white/[0.06] text-white/25",
                                            )}>
                                                {item.shortcut}
                                            </kbd>
                                        )}
                                    </button>
                                ))
                            )}
                        </div>

                        {/* Footer hint */}
                        <div className={cn(
                            "px-4 py-2 border-t flex items-center gap-4",
                            isLight ? "border-black/[0.04]" : "border-white/[0.04]",
                        )}>
                            <span className={cn("text-[9px] font-mono", isLight ? "text-black/25" : "text-white/25")}>
                                ↑↓ navigate
                            </span>
                            <span className={cn("text-[9px] font-mono", isLight ? "text-black/25" : "text-white/25")}>
                                ↵ select
                            </span>
                            <span className={cn("text-[9px] font-mono", isLight ? "text-black/25" : "text-white/25")}>
                                esc close
                            </span>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
