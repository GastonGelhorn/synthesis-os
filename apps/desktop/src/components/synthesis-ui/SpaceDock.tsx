import React, { useMemo } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
    Briefcase,
    Gamepad2,
    FlaskConical,
    Settings,
    Clock,
    FileEdit,
    Terminal,
    Code2,
    Music,
    Image as ImageIcon,
    MessageSquare,
    Search,
    BookOpen,
    Database,
    Cpu
} from "lucide-react";
import { SpaceId, WidgetKind } from "@/types/synthesis";
import { cn } from "@/lib/utils";
import { useSettings } from "@/context/SettingsContext";
import { GlassContainer } from "./GlassContainer";

/* ─── Space Definitions ─── */
interface SpaceDef {
    id: SpaceId;
    label: string;
    icon: React.ComponentType<any>;
    color: string;
    glow: string;
}

const SPACES: SpaceDef[] = [
    {
        id: "work",
        label: "Work",
        icon: Briefcase,
        color: "#60a5fa",
        glow: "rgba(96, 165, 250, 0.35)",
    },
    {
        id: "entertainment",
        label: "Play",
        icon: Gamepad2,
        color: "#f472b6",
        glow: "rgba(244, 114, 182, 0.35)",
    },
    {
        id: "research",
        label: "Research",
        icon: FlaskConical,
        color: "#34d399",
        glow: "rgba(52, 211, 153, 0.35)",
    },
];

/* ─── Context Tools Definitions ─── */
interface ContextTool {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: () => void;
    color?: string;
}

/* ─── Space Item (Vertical) ─── */
function SpaceItem({
    space,
    isActive,
    nodeCount,
    iconSize,
    onClick,
}: {
    space: SpaceDef;
    isActive: boolean;
    nodeCount: number;
    iconSize: number;
    onClick: () => void;
}) {
    const Icon = space.icon;
    return (
        <motion.button
            onClick={onClick}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.95 }}
            className="relative group flex items-center justify-start w-full"
        >
            <motion.div
                className="absolute left-[-12px] w-1.5 h-9 rounded-r-full bg-white"
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{
                    opacity: isActive ? 1 : 0,
                    scaleY: isActive ? 1 : 0,
                    backgroundColor: space.color
                }}
                transition={{ duration: 0.3 }}
            />

            <motion.div
                className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 relative z-10",
                    isActive ? "glass shadow-lg" : "hover:bg-white/5"
                )}
                animate={isActive ? {
                    borderColor: "rgba(255, 255, 255, 0.35)",
                    boxShadow: "0 0 10px var(--synthesis-accent-glow)",
                } : {
                    borderColor: "rgba(255, 255, 255, 0.08)",
                }}
            >
                <div className={isActive ? "text-white" : "text-white/35 group-hover:text-white/70"}>
                    <Icon size={iconSize} strokeWidth={1.5} />
                </div>

                {nodeCount > 0 && (
                    <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold border border-white/20"
                        style={{
                            background: space.color,
                            color: "#000",
                        }}
                    >
                        {nodeCount}
                    </motion.div>
                )}
            </motion.div>

            <div className="dock-tooltip z-20">
                {space.label}
            </div>
        </motion.button>
    );
}

/* ─── Context Tool Item ─── */
const ContextToolItem = React.forwardRef<HTMLButtonElement, { tool: ContextTool }>(
    function ContextToolItem({ tool }, ref) {
        return (
            <motion.button
                ref={ref}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
                whileHover={{ x: 2, backgroundColor: "rgba(255,255,255,0.06)" }}
                whileTap={{ scale: 0.95 }}
                className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5 group relative"
                onClick={tool.action}
            >
                <span className="text-white/35 group-hover:text-white/70 transition-colors" style={{ color: tool.color }}>
                    {tool.icon}
                </span>
                <div className="dock-tooltip z-30">
                    {tool.label}
                </div>
            </motion.button>
        );
    }
);

/* ─── Main Component ─── */
interface SpaceDockProps {
    activeSpaceId: SpaceId;
    nodeCountBySpace: Record<SpaceId, number>;
    onSelectSpace: (id: SpaceId) => void;
    onOpenSettings?: () => void;
    onSpawnWidget?: (kind: WidgetKind) => void;
    onToggleRecall?: () => void;
    onToggleChat?: () => void;
    onSynthesize?: (query: string) => void;
    onFocusInput?: () => void;
    onToggleHUD?: () => void;
}

/**
 * SpaceDock: Uses the reusable GlassContainer for hyper-realistic glass aesthetics.
 */
export function SpaceDock({
    activeSpaceId,
    nodeCountBySpace,
    onSelectSpace,
    onOpenSettings,
    onSpawnWidget,
    onToggleRecall,
    onToggleChat,
    onSynthesize,
    onFocusInput,
    onToggleHUD
}: SpaceDockProps) {
    const { settings } = useSettings();
    const iconSizeMap = {
        small: { space: 16, tool: 14 },
        medium: { space: 18, tool: 16 },
        large: { space: 22, tool: 18 },
    };
    const sizes = iconSizeMap[settings.sidebarIconSize || "medium"];

    const contextTools = useMemo<ContextTool[]>(() => {
        switch (activeSpaceId) {
            case "work":
                return [
                    { id: "code", label: "Editor", icon: <Code2 size={sizes.tool} />, action: () => onSpawnWidget?.("notes"), color: "#60a5fa" },
                    { id: "term", label: "Term", icon: <Terminal size={sizes.tool} />, action: () => onSynthesize?.("open a terminal session"), color: "#a78bfa" },
                    { id: "notes", label: "Notes", icon: <FileEdit size={sizes.tool} />, action: () => onSpawnWidget?.("notes"), color: "#fbbf24" },
                ];
            case "entertainment":
                return [
                    { id: "music", label: "Music", icon: <Music size={sizes.tool} />, action: () => onSynthesize?.("play some music"), color: "#f472b6" },
                    { id: "img", label: "Gallery", icon: <ImageIcon size={sizes.tool} />, action: () => onSynthesize?.("show my recent images"), color: "#c084fc" },
                    { id: "chat", label: "Social", icon: <MessageSquare size={sizes.tool} />, action: () => onToggleChat?.(), color: "#38bdf8" },
                ];
            case "research":
                return [
                    { id: "web", label: "Browser", icon: <Search size={sizes.tool} />, action: () => onFocusInput?.(), color: "#34d399" },
                    { id: "docs", label: "Library", icon: <BookOpen size={sizes.tool} />, action: () => onSynthesize?.("list my notes"), color: "#fb923c" },
                    { id: "data", label: "Data", icon: <Database size={sizes.tool} />, action: () => onSynthesize?.("show system info"), color: "#22d3ee" },
                ];
            default:
                return [];
        }
    }, [activeSpaceId, onSpawnWidget, onSynthesize, onFocusInput, onToggleChat, sizes]);

    return (
        <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 50, delay: 0.2 }}
            className="fixed left-2 top-40 z-[3000] flex flex-col gap-6"
        >
            <GlassContainer
                className="flex flex-col items-center py-2"
                style={{ width: 58, height: 590 }}
                borderRadius={24}
                blur="6px"
                saturation="150%"
                isFloating={true}
            >
                <nav className="flex flex-col gap-3 w-full px-2">
                    {/* Spaces */}
                    <div className="flex flex-col gap-2.5">
                        {SPACES.map((space) => (
                            <SpaceItem
                                key={space.id}
                                space={space}
                                isActive={space.id === activeSpaceId}
                                nodeCount={nodeCountBySpace[space.id] || 0}
                                iconSize={sizes.space}
                                onClick={() => onSelectSpace(space.id)}
                            />
                        ))}
                    </div>

                    {/* Dynamic Divider */}
                    <motion.div
                        className="w-full h-px bg-white/10 my-1"
                        layout
                    />

                    {/* Adaptive Context Tools */}
                    <div className="flex flex-col gap-2 min-h-[132px]">
                        <LayoutGroup>
                            <AnimatePresence mode="popLayout" initial={false}>
                                {contextTools.map((tool) => (
                                    <ContextToolItem key={`${activeSpaceId}-${tool.id}`} tool={tool} />
                                ))}
                            </AnimatePresence>
                        </LayoutGroup>
                    </div>

                    {/* Divider */}
                    <div className="w-full h-px bg-white/10 my-1" />

                    {/* System Utilities */}
                    <div className="flex flex-col gap-2.5">
                        <motion.button
                            onClick={onToggleChat}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Open chat"
                            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5 group relative"
                        >
                            <MessageSquare size={sizes.tool} className="text-violet-400 group-hover:text-violet-300 transition-colors" />
                            <div className="dock-tooltip">
                                Chat
                            </div>
                        </motion.button>
                        <motion.button
                            onClick={onToggleRecall}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Open recall history"
                            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5 group relative"
                        >
                            <Clock size={sizes.tool} className="text-emerald-400 group-hover:text-emerald-300 transition-colors" />
                            <div className="dock-tooltip">
                                Recall
                            </div>
                        </motion.button>
                        <motion.button
                            onClick={onOpenSettings}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="Open settings"
                            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5 group relative"
                        >
                            <Settings size={sizes.tool} className="text-white/35 group-hover:text-white/70 transition-colors" />
                            <div className="dock-tooltip">
                                Settings
                            </div>
                        </motion.button>
                        <motion.button
                            onClick={onToggleHUD}
                            whileHover={{ x: 2 }}
                            whileTap={{ scale: 0.95 }}
                            aria-label="System stats"
                            className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors hover:bg-white/5 group relative"
                        >
                            <Cpu size={sizes.tool} className="text-white/35 group-hover:text-white/70 transition-colors" />
                            <div className="dock-tooltip">
                                System Stats
                            </div>
                        </motion.button>
                    </div>
                </nav>
            </GlassContainer>
        </motion.div>
    );
}
