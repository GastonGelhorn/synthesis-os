"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, RoundedBox, Sparkles, Stars } from "@react-three/drei";
import { AnimatePresence, motion } from "framer-motion";
import { Minimize2, X } from "lucide-react";
import { SynthesisNode } from "@/types/synthesis";
import { useSpatialStore, type SpatialState } from "@/lib/spatial/store";
import { cn } from "@/lib/utils";

interface SpatialBackdrop3DProps {
    nodes: SynthesisNode[];
    activeNodeId: string | null;
    onSelectNode: (id: string) => void;
    onMinimizeNode: (id: string) => void;
    onCloseNode: (id: string) => void;
    onRestoreNode: (id: string) => void;
    onOpen2D: () => void;
}

const FOCUS_POS: [number, number, number] = [-0.9, 0.3, 0.3];
const QUEUE_START_Y = 1.4;
const QUEUE_GAP = 1.3;
const QUEUE_X = 3.2;
const QUEUE_Z = -0.25;
const SHELF_Y = -2.15;
const SHELF_START_X = -0.8;
const SHELF_GAP = 1.45;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

function truncate(text: string, max = 92): string {
    return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function SpatialWindow({
    node,
    position,
    scale,
    active,
    onFocus,
    onClose,
    onMinimize,
    onDragMove,
    onDragEnd,
}: {
    node: SynthesisNode;
    position: [number, number, number];
    scale: [number, number, number];
    active: boolean;
    onFocus: () => void;
    onClose: () => void;
    onMinimize: () => void;
    onDragMove: (position: { x: number; y: number }) => void;
    onDragEnd: (position: { x: number; y: number }) => void;
}) {
    const draggingRef = useRef(false);
    const startRef = useRef({
        x: 0,
        y: 0,
        px: 0,
        py: 0,
    });

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        draggingRef.current = true;
        startRef.current = {
            x: position[0],
            y: position[1],
            px: event.clientX,
            py: event.clientY,
        };
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        const dx = (event.clientX - startRef.current.px) / 120;
        const dy = -(event.clientY - startRef.current.py) / 120;
        onDragMove({
            x: clamp(startRef.current.x + dx, -4.4, 4.4),
            y: clamp(startRef.current.y + dy, -2.3, 2.2),
        });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);

        const dx = (event.clientX - startRef.current.px) / 120;
        const dy = -(event.clientY - startRef.current.py) / 120;
        onDragEnd({
            x: clamp(startRef.current.x + dx, -4.4, 4.4),
            y: clamp(startRef.current.y + dy, -2.3, 2.2),
        });
    };

    return (
        <group position={position} scale={scale}>
            <RoundedBox args={[3.2, 2.1, 0.08]} radius={0.08} smoothness={4}>
                <meshStandardMaterial
                    color={active ? node.content.design.accent_color : "#a3b4cc"}
                    emissive={active ? node.content.design.accent_color : "#2f3c53"}
                    emissiveIntensity={active ? 0.35 : 0.12}
                    metalness={0.42}
                    roughness={0.2}
                    transparent
                    opacity={active ? 0.27 : 0.18}
                />
            </RoundedBox>

            <Html transform distanceFactor={6} position={[0, 0, 0.065]} sprite>
                <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: active ? 1.01 : 1 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    onClick={onFocus}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    className={cn(
                        "w-[300px] rounded-xl border shadow-2xl pointer-events-auto glass-card",
                        active ? "border-cyan-200/45" : "border-white/18",
                    )}
                >
                    <div className="h-9 px-3 border-b border-white/10 flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">
                            {node.type} / {node.spaceId}
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onMinimize();
                                }}
                                className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/70"
                                title="Minimize to shelf"
                            >
                                <Minimize2 size={12} />
                            </button>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onClose();
                                }}
                                className="p-1 rounded bg-rose-500/20 hover:bg-rose-500/35 text-rose-100"
                                title="Close"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </div>

                    <div className="p-3">
                        <p className="text-white text-base font-semibold leading-tight">{truncate(node.title, 56)}</p>
                        <p className="text-white/70 text-sm mt-2 leading-relaxed">
                            {truncate(node.content.summary || node.query, active ? 150 : 100)}
                        </p>
                        <div className="mt-3 flex items-center justify-between">
                            <span className="text-[10px] text-white/50 uppercase tracking-[0.16em]">
                                {active ? "Focus" : "Queue"}
                            </span>
                            <span className="text-[10px] text-cyan-200/80 font-mono">{node.id.slice(0, 8)}</span>
                        </div>
                    </div>
                </motion.div>
            </Html>
        </group>
    );
}

function Shelf({
    nodes,
    onRestoreNode,
}: {
    nodes: SynthesisNode[];
    onRestoreNode: (id: string) => void;
}) {
    return (
        <Html fullscreen>
            <div className="pointer-events-none absolute left-[248px] right-8 bottom-24">
                <div className="pointer-events-auto rounded-2xl border border-white/12 glass-node px-3 py-2">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">Shelf</p>
                        <span className="text-[10px] text-white/45">{nodes.length} minimized</span>
                    </div>
                    <div className="flex items-center gap-2 overflow-auto pb-1">
                        {nodes.length === 0 ? (
                            <p className="text-xs text-white/45">Nothing minimized.</p>
                        ) : (
                            nodes.map((node) => (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => onRestoreNode(node.id)}
                                    className="shrink-0 w-[220px] p-2 rounded-lg border border-white/12 text-left glass-node hover:bg-white/[0.05]"
                                >
                                    <p className="text-xs text-white/90 truncate">{node.title}</p>
                                    <p className="text-[10px] text-white/55 truncate mt-1">{node.query}</p>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </Html>
    );
}

function DeskLabels() {
    return (
        <Html fullscreen>
            <div className="pointer-events-none absolute left-[248px] right-8 top-24">
                <div className="grid grid-cols-[minmax(420px,1.38fr)_minmax(320px,1fr)] gap-4">
                    <div className="rounded-2xl border border-cyan-200/20 glass px-4 py-2" style={{ background: "rgba(var(--synthesis-glass-rgb), calc(var(--synthesis-system-glass-alpha, 0.8) * 0.15))" }}>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-100/75">Focus Zone</p>
                        <p className="text-xs text-white/55 mt-1">Primary working window</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 glass px-4 py-2" style={{ background: "rgba(var(--synthesis-glass-rgb), calc(var(--synthesis-system-glass-alpha, 0.8) * 0.12))" }}>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-white/65">Queue Zone</p>
                        <p className="text-xs text-white/50 mt-1">Secondary windows in order</p>
                    </div>
                </div>
            </div>
        </Html>
    );
}

export function SpatialBackdrop3D({
    nodes,
    activeNodeId,
    onSelectNode,
    onMinimizeNode,
    onCloseNode,
    onRestoreNode,
    onOpen2D,
}: SpatialBackdrop3DProps) {
    const visibleNodes = useMemo(() => nodes.filter((node) => node.status !== "minimized"), [nodes]);
    const minimizedNodes = useMemo(() => nodes.filter((node) => node.status === "minimized"), [nodes]);

    const focusedId = useSpatialStore((state: SpatialState) => state.focusedId);
    const queueOrder = useSpatialStore((state: SpatialState) => state.queueOrder);
    const floatingPositions = useSpatialStore((state: SpatialState) => state.floatingPositions);
    const hydrate = useSpatialStore((state: SpatialState) => state.hydrate);
    const focus = useSpatialStore((state: SpatialState) => state.focus);
    const pushToQueue = useSpatialStore((state: SpatialState) => state.pushToQueue);
    const setFloatingPosition = useSpatialStore((state: SpatialState) => state.setFloatingPosition);
    const clearFloatingPosition = useSpatialStore((state: SpatialState) => state.clearFloatingPosition);

    useEffect(() => {
        hydrate(
            visibleNodes.map((node) => node.id),
            activeNodeId,
        );
    }, [hydrate, activeNodeId, visibleNodes]);

    const focusedNodeId = useMemo(
        () => focusedId || activeNodeId || visibleNodes[0]?.id || null,
        [focusedId, activeNodeId, visibleNodes],
    );

    const queueNodes = useMemo(() => {
        const byId = new Map(visibleNodes.map((node) => [node.id, node]));
        const ordered = queueOrder
            .map((id) => byId.get(id))
            .filter((node): node is SynthesisNode => node != null)
            .filter((node) => node.id !== focusedNodeId);

        const rest = visibleNodes.filter(
            (node) => node.id !== focusedNodeId && !ordered.some((candidate) => candidate.id === node.id),
        );
        return [...ordered, ...rest].slice(0, 10);
    }, [visibleNodes, queueOrder, focusedNodeId]);

    const focusedNode = useMemo(
        () => visibleNodes.find((node) => node.id === focusedNodeId) || null,
        [visibleNodes, focusedNodeId],
    );

    const handleFocus = (id: string) => {
        focus(id);
        clearFloatingPosition(id);
        onSelectNode(id);
    };

    return (
        <div className="fixed inset-0 z-[8] pointer-events-auto">
            <Canvas camera={{ position: [0, 0, 8], fov: 52 }} frameloop="always">
                <color attach="background" args={["#020617"]} />
                <fog attach="fog" args={["#020617", 8, 24]} />
                <ambientLight intensity={0.48} />
                <directionalLight position={[6, 7, 4]} intensity={1.05} color="#93c5fd" />
                <pointLight position={[-5, -2, 2]} intensity={0.55} color="#67e8f9" />

                <mesh position={[0, 0.2, -1]}>
                    <icosahedronGeometry args={[1.55, 3]} />
                    <meshStandardMaterial
                        color="#7dd3fc"
                        transparent
                        opacity={0.08}
                        emissive="#38bdf8"
                        emissiveIntensity={0.72}
                        metalness={0.45}
                        roughness={0.16}
                    />
                </mesh>

                <mesh position={[0, 0.2, -1]} rotation={[1.1, 0.25, 0.24]}>
                    <torusGeometry args={[2.45, 0.016, 20, 180]} />
                    <meshStandardMaterial color="#93c5fd" emissive="#60a5fa" emissiveIntensity={0.7} />
                </mesh>

                <Stars radius={120} depth={80} count={1300} factor={3.5} saturation={0.2} fade speed={0.01} />
                <Sparkles count={55} scale={[18, 10, 10]} size={1.55} speed={0.01} color="#7dd3fc" />

                {focusedNode ? (
                    <SpatialWindow
                        key={`focus-${focusedNode.id}`}
                        node={focusedNode}
                        position={[
                            floatingPositions[focusedNode.id]?.x ?? FOCUS_POS[0],
                            floatingPositions[focusedNode.id]?.y ?? FOCUS_POS[1],
                            FOCUS_POS[2],
                        ]}
                        scale={[1.03, 1.03, 1]}
                        active
                        onFocus={() => handleFocus(focusedNode.id)}
                        onClose={() => onCloseNode(focusedNode.id)}
                        onMinimize={() => onMinimizeNode(focusedNode.id)}
                        onDragMove={(position) => setFloatingPosition(focusedNode.id, position)}
                        onDragEnd={(position) => {
                            clearFloatingPosition(focusedNode.id);
                            if (position.y < -1.55) {
                                onMinimizeNode(focusedNode.id);
                                return;
                            }
                            if (position.x > 1.6) {
                                pushToQueue(focusedNode.id);
                                return;
                            }
                            handleFocus(focusedNode.id);
                        }}
                    />
                ) : null}

                {queueNodes.map((node, index) => {
                    const targetX = QUEUE_X;
                    const targetY = QUEUE_START_Y - index * QUEUE_GAP;
                    const targetZ = QUEUE_Z - index * 0.08;

                    return (
                        <SpatialWindow
                            key={`queue-${node.id}`}
                            node={node}
                            position={[
                                floatingPositions[node.id]?.x ?? targetX,
                                floatingPositions[node.id]?.y ?? targetY,
                                targetZ,
                            ]}
                            scale={[0.83, 0.83, 1]}
                            active={false}
                            onFocus={() => handleFocus(node.id)}
                            onClose={() => onCloseNode(node.id)}
                            onMinimize={() => onMinimizeNode(node.id)}
                            onDragMove={(position) => setFloatingPosition(node.id, position)}
                            onDragEnd={(position) => {
                                clearFloatingPosition(node.id);
                                if (position.y < -1.55) {
                                    onMinimizeNode(node.id);
                                    return;
                                }
                                if (position.x < 1.4) {
                                    handleFocus(node.id);
                                } else {
                                    pushToQueue(node.id);
                                }
                            }}
                        />
                    );
                })}

                {minimizedNodes.map((node, index) => (
                    <group
                        key={`shelf-${node.id}`}
                        position={[SHELF_START_X + index * SHELF_GAP, SHELF_Y, -0.8]}
                        scale={[0.52, 0.52, 1]}
                    >
                        <RoundedBox args={[2.3, 0.7, 0.04]} radius={0.06} smoothness={4}>
                            <meshStandardMaterial
                                color="#cbd5e1"
                                emissive="#64748b"
                                emissiveIntensity={0.15}
                                transparent
                                opacity={0.22}
                            />
                        </RoundedBox>
                        <Html transform distanceFactor={6} position={[0, 0, 0.06]} sprite>
                            <button
                                type="button"
                                onClick={() => onRestoreNode(node.id)}
                                className="w-[190px] px-3 py-2 rounded-lg border border-white/15 bg-slate-950/80 text-left hover:bg-slate-900/90"
                            >
                                <p className="text-xs text-white/90 truncate">{node.title}</p>
                                <p className="text-[10px] text-white/55 truncate mt-1">{node.query}</p>
                            </button>
                        </Html>
                    </group>
                ))}

                <DeskLabels />
                <Shelf nodes={minimizedNodes} onRestoreNode={onRestoreNode} />
            </Canvas>

            <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_16%,rgba(34,211,238,0.2),transparent_35%),radial-gradient(circle_at_76%_80%,rgba(59,130,246,0.24),transparent_36%),linear-gradient(180deg,rgba(2,6,23,0.1),rgba(2,6,23,0.5))]" />

            <div className="absolute top-6 right-6 text-[10px] tracking-[0.22em] uppercase text-cyan-200/80 border border-cyan-300/35 bg-cyan-900/20 rounded-full px-3 py-1">
                Spatial OS / Organized
            </div>

            <div className="absolute top-6 right-56 text-[10px] tracking-[0.22em] uppercase text-cyan-100/80 border border-cyan-200/25 bg-slate-900/35 rounded-full px-3 py-1">
                nodes: {visibleNodes.length}
            </div>

            <div className="absolute top-6 right-[320px]">
                <button
                    type="button"
                    onClick={onOpen2D}
                    className="text-xs px-3 py-1.5 rounded-lg bg-cyan-200 text-slate-900 hover:bg-cyan-100 border border-cyan-100/70"
                >
                    Open 2D
                </button>
            </div>
        </div>
    );
}
