"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SynthesisEdge, SynthesisNode } from "@/types/synthesis";
import { useSettings } from "@/context/SettingsContext";

interface EdgeRendererProps {
    edges: SynthesisEdge[];
    nodes: SynthesisNode[];
    linkMode: string | null;
    onRemoveEdge: (edgeId: string) => void;
}

function getNodeCenter(node: SynthesisNode): { x: number; y: number } {
    const w = Math.min(node.dimension?.w || 400, 520);
    const h = node.dimension?.h || 300;
    return {
        x: node.position.x + w / 2,
        y: node.position.y + h / 2,
    };
}

function buildCurvePath(
    src: { x: number; y: number },
    tgt: { x: number; y: number },
): string {
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const curvature = Math.min(dist * 0.3, 120);

    // Control points offset perpendicular to the line for a gentle arc
    const mx = (src.x + tgt.x) / 2;
    const my = (src.y + tgt.y) / 2;
    const nx = -dy / (dist || 1);
    const ny = dx / (dist || 1);
    const cx = mx + nx * curvature * 0.25;
    const cy = my + ny * curvature * 0.25;

    return `M ${src.x} ${src.y} Q ${cx} ${cy} ${tgt.x} ${tgt.y}`;
}

export function EdgeRenderer({ edges, nodes, linkMode, onRemoveEdge }: EdgeRendererProps) {
    const { settings } = useSettings();
    const nodeMap = useMemo(() => {
        const m = new Map<string, SynthesisNode>();
        for (const n of nodes) m.set(n.id, n);
        return m;
    }, [nodes]);

    const visibleEdges = useMemo(() => {
        return edges
            .map((edge) => {
                const src = nodeMap.get(edge.sourceId);
                const tgt = nodeMap.get(edge.targetId);
                if (!src || !tgt) return null;
                if (src.status === "minimized" || tgt.status === "minimized") return null;
                return { edge, src, tgt };
            })
            .filter(Boolean) as { edge: SynthesisEdge; src: SynthesisNode; tgt: SynthesisNode }[];
    }, [edges, nodeMap]);

    if (visibleEdges.length === 0 && !linkMode) return null;

    const isLight = settings.theme === "light";
    const strokeColor = isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.18)";
    const glowColor = isLight ? "rgba(100,130,255,0.12)" : "rgba(140,160,255,0.2)";

    return (
        <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 750 }}
        >
            <defs>
                <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>

            <AnimatePresence>
                {visibleEdges.map(({ edge, src, tgt }) => {
                    const srcCenter = getNodeCenter(src);
                    const tgtCenter = getNodeCenter(tgt);
                    const d = buildCurvePath(srcCenter, tgtCenter);
                    const midX = (srcCenter.x + tgtCenter.x) / 2;
                    const midY = (srcCenter.y + tgtCenter.y) / 2;

                    return (
                        <motion.g
                            key={edge.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={settings.animations ? { duration: 0.4 } : { duration: 0 }}
                        >
                            {/* Glow line */}
                            <path
                                d={d}
                                fill="none"
                                stroke={glowColor}
                                strokeWidth={4}
                                filter="url(#edge-glow)"
                            />
                            {/* Main line */}
                            <path
                                d={d}
                                fill="none"
                                stroke={strokeColor}
                                strokeWidth={1.5}
                                strokeDasharray="6 4"
                            />
                            {/* Delete hitbox (invisible wide path for click) */}
                            <path
                                d={d}
                                fill="none"
                                stroke="transparent"
                                strokeWidth={16}
                                className="pointer-events-auto cursor-pointer"
                                onClick={() => onRemoveEdge(edge.id)}
                            >
                                <title>Click to remove connection</title>
                            </path>
                            {/* Label */}
                            {edge.label && (
                                <text
                                    x={midX}
                                    y={midY - 8}
                                    textAnchor="middle"
                                    className={`text-[10px] ${isLight ? "fill-black/40" : "fill-white/40"}`}
                                >
                                    {edge.label}
                                </text>
                            )}
                        </motion.g>
                    );
                })}
            </AnimatePresence>

            {/* Link mode indicator: pulsing ring around source node */}
            {linkMode && (() => {
                const sourceNode = nodeMap.get(linkMode);
                if (!sourceNode) return null;
                const center = getNodeCenter(sourceNode);
                return (
                    <motion.circle
                        cx={center.x}
                        cy={center.y}
                        r={40}
                        fill="none"
                        stroke="rgba(140, 160, 255, 0.5)"
                        strokeWidth={2}
                        initial={{ r: 20, opacity: 0 }}
                        animate={{ r: 40, opacity: [0.6, 0.2, 0.6] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                    />
                );
            })()}
        </svg>
    );
}
