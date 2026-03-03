"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    X, FileText, Link2, Search, Clock, Sparkles, Music,
    Globe, MessageSquare, Newspaper, ChefHat, Layout, Bot,
} from "lucide-react";
import { SynthesisNode, NodeType, SpaceId } from "@/types/synthesis";
import { cn } from "@/lib/utils";
import { useSettings } from "@/context/SettingsContext";

/* ─── Constants ─── */

const SPACE_COLORS: Record<SpaceId, string> = {
    work: "#60a5fa",
    entertainment: "#f472b6",
    research: "#34d399",
};

const SPACE_LABELS: Record<SpaceId, string> = {
    work: "Work",
    entertainment: "Play",
    research: "Research",
};

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    agent_task: { label: "Agent", color: "#a78bfa", icon: <Bot size={10} /> },
    browser: { label: "Browser", color: "#34d399", icon: <Globe size={10} /> },
    chat: { label: "Chat", color: "#38bdf8", icon: <MessageSquare size={10} /> },
    widget: { label: "Widget", color: "#818cf8", icon: <Layout size={10} /> },
    recipe: { label: "Recipe", color: "#fb923c", icon: <ChefHat size={10} /> },
    news: { label: "News", color: "#22d3ee", icon: <Newspaper size={10} /> },
};

function getNodeIcon(type: string) {
    switch (type) {
        case "note": return <FileText size={14} />;
        case "agent_task": return <Sparkles size={14} />;
        case "media_player": return <Music size={14} />;
        case "chat": return <MessageSquare size={14} />;
        case "news": return <Newspaper size={14} />;
        case "recipe": return <ChefHat size={14} />;
        default: return <Link2 size={14} />;
    }
}

function getNodeIconColor(type: string, isLight: boolean) {
    switch (type) {
        case "note": return "text-amber-400/80";
        case "agent_task": return "text-violet-400/80";
        case "media_player": return "text-pink-400/80";
        case "chat": return "text-cyan-400/80";
        case "news": return "text-teal-400/80";
        case "recipe": return "text-orange-400/80";
        default: return isLight ? "text-black/40" : "text-white/40";
    }
}

/* ─── Component ─── */

interface RecallViewProps {
    isOpen: boolean;
    onClose: () => void;
    nodes: SynthesisNode[];
    onActivateNode: (id: string) => void;
}

export function RecallView({ isOpen, onClose, nodes, onActivateNode }: RecallViewProps) {
    const { settings } = useSettings();
    const isLight = settings.theme === "light";
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTypeFilter, setActiveTypeFilter] = useState<NodeType | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    // Focus search when panel opens
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => searchRef.current?.focus(), 300);
        } else {
            setSearchQuery("");
            setActiveTypeFilter(null);
        }
    }, [isOpen]);

    // Filtered + sorted nodes
    const filteredNodes = useMemo(() => {
        let result = [...nodes];

        if (activeTypeFilter) {
            result = result.filter(n => n.type === activeTypeFilter);
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            result = result.filter(n => {
                const title = (n.title || "").toLowerCase();
                const query = (n.query || "").toLowerCase();
                const summary = (n.content?.summary || "").toLowerCase();
                const type = (n.type || "").toLowerCase();
                return title.includes(q) || query.includes(q) || summary.includes(q) || type.includes(q);
            });
        }

        return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }, [nodes, searchQuery, activeTypeFilter]);

    // Type counts (unfiltered, for pill badges)
    const typeCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        nodes.forEach(n => { counts[n.type] = (counts[n.type] || 0) + 1; });
        return counts;
    }, [nodes]);

    // Group by space + date
    const groupedNodes = useMemo(() => {
        const groups: Record<string, { nodes: SynthesisNode[]; spaceId: SpaceId }> = {};
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const yesterday = today - 86400000;

        filteredNodes.forEach(node => {
            const date = node.updatedAt;
            let dateKey = "Earlier";
            if (date >= today) dateKey = "Today";
            else if (date >= yesterday) dateKey = "Yesterday";
            else {
                dateKey = new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            }

            const groupKey = `${dateKey}|||${node.spaceId}`;
            if (!groups[groupKey]) groups[groupKey] = { nodes: [], spaceId: node.spaceId };
            groups[groupKey].nodes.push(node);
        });

        const datePriority = (d: string) => d === "Today" ? 0 : d === "Yesterday" ? 1 : 2;

        const keys = Object.keys(groups).sort((a, b) => {
            const [dateA] = a.split("|||");
            const [dateB] = b.split("|||");
            const pa = datePriority(dateA);
            const pb = datePriority(dateB);
            if (pa !== pb) return pa - pb;
            return a.localeCompare(b);
        });

        return keys.map(key => {
            const [dateLabel, spaceId] = key.split("|||");
            const group = groups[key];
            return {
                label: `${dateLabel} \u2014 ${SPACE_LABELS[spaceId as SpaceId] || spaceId}`,
                spaceColor: SPACE_COLORS[spaceId as SpaceId] || "#888",
                items: group.nodes,
            };
        });
    }, [filteredNodes]);

    const hasFilters = searchQuery.trim() !== "" || activeTypeFilter !== null;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className={cn(
                            "fixed inset-0 z-[1200]",
                            isLight ? "bg-black/20 backdrop-blur-sm" : "bg-black/40 backdrop-blur-md",
                        )}
                    />

                    {/* Timeline Panel */}
                    <motion.div
                        initial={{ x: "100%", opacity: 0.5 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: "100%", opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className={cn(
                            "fixed right-0 top-0 bottom-0 w-full max-w-md z-[1210] border-l flex flex-col",
                            isLight
                                ? "bg-white/90 border-black/[0.08] shadow-xl"
                                : "glass-card rounded-none border-white/10",
                        )}
                        style={isLight ? { backdropFilter: "blur(var(--synthesis-glass-blur, 30px))" } : undefined}
                    >
                        {/* Header */}
                        <div className={cn(
                            "flex items-center justify-between p-6 border-b",
                            isLight ? "border-black/[0.06]" : "border-white/10",
                        )}>
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <h2 className={cn("text-xl font-medium", isLight ? "text-black/85" : "text-white")}>
                                        Recall
                                    </h2>
                                    <p className={cn("text-sm", isLight ? "text-black/40" : "text-white/40")}>
                                        Semantic Memory Timeline
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className={cn(
                                    "p-2 rounded-full transition-colors",
                                    isLight ? "hover:bg-black/[0.06] text-black/40 hover:text-black/70" : "hover:bg-white/10 text-white/60 hover:text-white",
                                )}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search + Filters */}
                        <div className={cn("p-4 border-b", isLight ? "border-black/[0.04]" : "border-white/5")}>
                            <div className="relative">
                                <Search className={cn(
                                    "absolute left-3 top-1/2 -translate-y-1/2",
                                    isLight ? "text-black/25" : "text-white/30",
                                )} size={16} />
                                <input
                                    ref={searchRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search memory..."
                                    className={cn(
                                        "w-full rounded-xl py-2 pl-10 pr-4 text-sm transition-colors focus:outline-none",
                                        isLight
                                            ? "bg-black/[0.04] border border-black/[0.08] text-black placeholder-black/30 focus:border-emerald-500/50"
                                            : "bg-black/20 border border-white/10 text-white placeholder-white/30 focus:border-emerald-500/50",
                                    )}
                                />
                            </div>

                            {/* Type filter pills */}
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {Object.entries(TYPE_META).map(([type, { label, color, icon }]) => {
                                    const count = typeCounts[type] || 0;
                                    if (count === 0) return null;
                                    const isActive = activeTypeFilter === type;
                                    return (
                                        <motion.button
                                            key={type}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setActiveTypeFilter(isActive ? null : type as NodeType)}
                                            className={cn(
                                                "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border",
                                                isActive
                                                    ? "border-white/20"
                                                    : isLight
                                                        ? "border-black/[0.06] bg-black/[0.03] text-black/40 hover:text-black/60 hover:bg-black/[0.06]"
                                                        : "border-white/5 bg-white/[0.03] text-white/40 hover:text-white/60 hover:bg-white/[0.06]",
                                            )}
                                            style={isActive ? { borderColor: `${color}40`, backgroundColor: `${color}15`, color } : undefined}
                                        >
                                            {icon}
                                            {label}
                                            <span className="opacity-50">({count})</span>
                                        </motion.button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-0 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent select-text">
                            {groupedNodes.length === 0 ? (
                                <div className={cn("text-center py-20", isLight ? "text-black/30" : "text-white/30")}>
                                    <Clock size={48} className="mx-auto mb-4 opacity-20" />
                                    <p>{hasFilters ? "No matching memories" : "No memories found"}</p>
                                    {hasFilters && (
                                        <button
                                            onClick={() => { setSearchQuery(""); setActiveTypeFilter(null); }}
                                            className="mt-3 text-xs text-emerald-400/60 hover:text-emerald-400 transition-colors"
                                        >
                                            Clear filters
                                        </button>
                                    )}
                                </div>
                            ) : (
                                groupedNodes.map((group) => (
                                    <div key={group.label} className="relative">
                                        {/* Group header with space color dot */}
                                        <div className={cn(
                                            "sticky top-0 z-10 backdrop-blur-xl border-y py-1.5 px-6 flex items-center gap-2",
                                            isLight
                                                ? "bg-white/70 border-black/[0.04]"
                                                : "bg-black/20 border-white/5",
                                        )}>
                                            <span
                                                className="w-2 h-2 rounded-full shrink-0"
                                                style={{ backgroundColor: group.spaceColor }}
                                            />
                                            <h3 className={cn(
                                                "text-[10px] font-bold uppercase tracking-widest",
                                                isLight ? "text-emerald-600/80" : "text-emerald-400/90",
                                            )}>
                                                {group.label}
                                            </h3>
                                            <span className={cn("text-[9px] ml-auto", isLight ? "text-black/20" : "text-white/20")}>
                                                {group.items.length}
                                            </span>
                                        </div>
                                        <div className="space-y-0.5 py-2">
                                            {group.items.map((node) => (
                                                <motion.button
                                                    key={node.id}
                                                    layoutId={`recall-${node.id}`}
                                                    onClick={() => {
                                                        onActivateNode(node.id);
                                                        onClose();
                                                    }}
                                                    className={cn(
                                                        "w-full text-left py-3 px-6 transition-all group relative flex items-start gap-4 border-b last:border-0",
                                                        isLight
                                                            ? "hover:bg-black/[0.03] border-black/[0.03]"
                                                            : "hover:bg-white/5 border-white/[0.03]",
                                                    )}
                                                    whileHover={{ x: 4 }}
                                                >
                                                    <div className={cn(
                                                        "mt-0.5 p-1.5 rounded-md shrink-0 transition-colors",
                                                        isLight ? "bg-black/[0.04] group-hover:bg-black/[0.07]" : "bg-white/5 group-hover:bg-white/10",
                                                        getNodeIconColor(node.type, isLight),
                                                    )}>
                                                        {getNodeIcon(node.type)}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-baseline justify-between gap-2 mb-0.5">
                                                            <span className={cn(
                                                                "text-sm font-medium transition-colors truncate",
                                                                isLight ? "text-black/80 group-hover:text-black" : "text-white/80 group-hover:text-white",
                                                            )}>
                                                                {node.title || node.content?.title || "Untitled Node"}
                                                            </span>
                                                            <span className={cn(
                                                                "text-[10px] font-mono shrink-0",
                                                                isLight ? "text-black/20" : "text-white/20",
                                                            )}>
                                                                {new Date(node.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                            </span>
                                                        </div>
                                                        <p className={cn(
                                                            "text-xs transition-colors line-clamp-1 font-light",
                                                            isLight ? "text-black/40 group-hover:text-black/60" : "text-white/40 group-hover:text-white/60",
                                                        )}>
                                                            {node.content?.summary || node.query || "No content"}
                                                        </p>
                                                    </div>
                                                </motion.button>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Footer stats */}
                        <div className={cn(
                            "px-6 py-3 border-t text-[10px] tracking-wider uppercase",
                            isLight ? "border-black/[0.04] text-black/25" : "border-white/5 text-white/20",
                        )}>
                            {filteredNodes.length} of {nodes.length} memories
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
