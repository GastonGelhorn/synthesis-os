/**
 * NodeContainer: frame with drag, position, and its own chrome (close, minimize, god mode).
 * Used by SynthesisSpace. When wrapping NodeCard, pass chrome="none" to NodeCard to avoid
 * duplicate title bars. WorkspaceView uses NodeCard directly without NodeContainer.
 */
import { useEffect, useState } from "react";
import { animate, motion, PanInfo, useMotionValue } from "framer-motion";
import { ShieldCheck, X, Minus, FileJson } from "lucide-react";
import { SynthesisNode } from "@/types/synthesis";
import { cn } from "@/lib/utils";
import { SynthesisCard } from "./SynthesisCard";
import { useSettings } from "@/context/SettingsContext";

interface NodeContainerProps {
    node: SynthesisNode;
    isActive: boolean;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onMinimize: (id: string) => void;
    onMove: (id: string, position: { x: number; y: number }) => void;
    onToggleGodMode: (id: string) => void;
    children: React.ReactNode;
}

export function NodeContainer({
    node,
    isActive,
    onActivate,
    onClose,
    onMinimize,
    onMove,
    onToggleGodMode,
    children,
}: NodeContainerProps) {
    const { settings } = useSettings();
    const [isHovered, setIsHovered] = useState(false);
    const x = useMotionValue(node.position.x);
    const y = useMotionValue(node.position.y);
    const tilt = ((node.createdAt % 9) - 4) * 0.35;

    useEffect(() => {
        const xAnim = animate(x, node.position.x, {
            type: "spring",
            stiffness: 220,
            damping: 26,
        });
        const yAnim = animate(y, node.position.y, {
            type: "spring",
            stiffness: 220,
            damping: 26,
        });
        return () => {
            xAnim.stop();
            yAnim.stop();
        };
    }, [node.position.x, node.position.y, x, y]);

    const onDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        onMove(node.id, {
            x: x.get() + info.velocity.x * 0.03,
            y: y.get() + info.velocity.y * 0.03,
        });
    };

    return (
        <motion.div
            drag
            dragMomentum
            dragElastic={0.08}
            whileDrag={{ scale: 1.012, cursor: "grabbing" }}
            onDragStart={() => onActivate(node.id)}
            onDragEnd={onDragEnd}
            onClick={() => onActivate(node.id)}
            onHoverStart={() => setIsHovered(true)}
            onHoverEnd={() => setIsHovered(false)}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{
                opacity: 1,
                scale: isActive ? 1.02 : 1,
                rotateZ: isActive ? 0 : tilt,
                zIndex: isActive ? 600 : node.zIndex,
            }}
            style={{
                x,
                y,
                width: node.dimension?.w || 340,
                height: node.dimension?.h || 420,
                borderRadius: 24,
            }}
            className={cn(
                "absolute cursor-grab active:cursor-grabbing glass-node",
                "overflow-hidden border transition-all duration-500 ease-out",
                isActive && "glass-node-active",
            )}
        >
            <div className={`h-9 shrink-0 flex items-center px-3 justify-between select-none border-b border-white/5 ${settings.theme === "light" ? "bg-black/[0.04]" : "bg-white/[0.04]"}`}>
                <div className="flex gap-1.5 items-center shrink-0">
                    <button
                        onClick={(event) => { event.stopPropagation(); onClose(node.id); }}
                        title="Close"
                        className="w-[18px] h-[18px] rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/90 flex items-center justify-center transition-colors shadow-sm border border-red-400/20"
                    >
                        <X size={10} strokeWidth={2.5} className="text-red-900/70" />
                    </button>
                    <button
                        onClick={(event) => { event.stopPropagation(); onMinimize(node.id); }}
                        title="Minimize"
                        className="w-[18px] h-[18px] rounded-full bg-[#febc2e] hover:bg-[#febc2e]/90 flex items-center justify-center transition-colors shadow-sm border border-amber-500/25"
                    >
                        <Minus size={10} strokeWidth={2.5} className="text-amber-900/60" />
                    </button>
                </div>
                <div className="text-[10px] font-mono text-white/40 uppercase tracking-[0.23em] truncate px-3 min-w-0">
                    {node.title}
                </div>
                <div
                    className={cn(
                        "text-[10px] text-white/50 flex items-center gap-1.5 shrink-0 transition-opacity",
                        isActive || isHovered ? "opacity-100" : "opacity-70",
                    )}
                >
                    <button
                        onClick={(event) => { event.stopPropagation(); onToggleGodMode(node.id); }}
                        title={node.isGodMode ? "Back to content" : "View JSON"}
                        className={cn(
                            "p-1 rounded-md transition-colors",
                            node.isGodMode ? "bg-white/10 text-white/90" : "text-white/50 hover:text-white/80 hover:bg-white/5",
                        )}
                    >
                        <FileJson size={11} />
                    </button>
                    <ShieldCheck size={11} />
                    {node.spaceId}
                </div>
            </div>

            <div className="relative w-full h-full overflow-hidden">
                <SynthesisCard
                    flipped={Boolean(node.isGodMode)}
                    front={<div className="w-full h-full">{children}</div>}
                    back={
                        <div className="w-full h-full bg-black/75 border border-emerald-400/20 text-emerald-200 p-4 overflow-auto">
                            <p className="text-xs tracking-[0.22em] uppercase mb-3 text-emerald-300/80">
                                God Mode / Trace
                            </p>
                            <p className="text-[11px] mb-4 text-emerald-200/80">Intent: {node.query}</p>
                            {node.content.logs?.length ? (
                                <div className="mb-4">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/70 mb-2">Logs</p>
                                    <ul className="space-y-1 text-[11px]">
                                        {node.content.logs.map((line, index) => (
                                            <li key={index} className="text-emerald-200/80">
                                                {line}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                            {node.content.sources?.length ? (
                                <div className="mb-4">
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/70 mb-2">Sources</p>
                                    <ul className="space-y-1 text-[11px]">
                                        {node.content.sources.map((source, index) => (
                                            <li key={index} className="truncate text-emerald-100/70">
                                                {source}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}

                            <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/70 mb-2">Payload</p>
                            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-emerald-100/80">
                                {JSON.stringify(node.content, null, 2)}
                            </pre>
                        </div>
                    }
                />
            </div>
        </motion.div>
    );
}
