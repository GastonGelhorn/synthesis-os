"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { AnimatePresence, motion, PanInfo, useMotionValue, animate, useDragControls } from "framer-motion";
import { Upload } from "lucide-react";
import { SynthesisEdge, SynthesisNode, SpaceId } from "@/types/synthesis";
import { useSettings } from "@/context/SettingsContext";
import { NodeCard } from "./NodeCard";
import { ErrorBoundary } from "./ErrorBoundary";
import { EdgeRenderer } from "./EdgeRenderer";
import { GlassContainer } from "./GlassContainer";
import { SYNTHESIS_BACKGROUND_PRESET_BY_ID } from "@/lib/backgrounds";
import { clampPositionToViewport } from "@/lib/positioning";
import { hexToRgba, cn } from "@/lib/utils";

/* ─── Space accent colors ─── */
const SPACE_COLORS: Record<SpaceId, { primary: string; secondary: string; glow: string }> = {
    work: {
        primary: "#60a5fa",
        secondary: "#818cf8",
        glow: "rgba(96, 165, 250, 0.25)",
    },
    entertainment: {
        primary: "#f472b6",
        secondary: "#c084fc",
        glow: "rgba(244, 114, 182, 0.25)",
    },
    research: {
        primary: "#34d399",
        secondary: "#22d3ee",
        glow: "rgba(52, 211, 153, 0.25)",
    },
};
const NEUTRAL_COLORS = {
    primary: "#ffffff",
    secondary: "#f0f0f0",
    glow: "rgba(255, 255, 255, 0.15)",
};

const WINDOW_LAYOUT_ID = (id: string) => `node-shell-${id}`;
const AUTO_STACK_OFFSETS = [
    { x: -420, y: -130 },
    { x: 420, y: -130 },
    { x: -470, y: 115 },
    { x: 470, y: 115 },
    { x: 0, y: -250 },
    { x: 0, y: 235 },
    { x: -680, y: -10 },
    { x: 680, y: -10 },
];

function ScrollArcIcon({ direction = "left" }: { direction?: "left" | "right" }) {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="opacity-90"
            aria-hidden
        >
            <g transform={direction === "right" ? "translate(24,0) scale(-1,1)" : undefined}>
                <path d="M14 4c-4.2 2.8-6.4 5.6-6.4 8s2.2 5.2 6.4 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M18 6c-2.8 2-4.2 4-4.2 6s1.4 4 4.2 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
                <path d="M9.4 12h-2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
            </g>
        </svg>
    );
}

function mixHexWithWhite(hex: string, ratio: number): string {
    const clean = hex.replace("#", "");
    if (clean.length !== 6) return hex;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const mix = (channel: number) => Math.round(channel + (255 - channel) * ratio);
    return `#${[mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

interface WorkspaceViewProps {
    nodes: SynthesisNode[];
    activeNodeId: string | null;
    spaceId: SpaceId;
    spaceLabel: string;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onMinimize: (id: string) => void;
    onMove: (id: string, position: { x: number; y: number }) => void;
    onResize?: (id: string, dimension: { w: number; h: number }) => void;
    onToggleGodMode: (id: string) => void;
    edges: SynthesisEdge[];
    linkMode: string | null;
    onStartLink: (id: string) => void;
    onCompleteLink: (id: string) => void;
    onCancelLink: () => void;
    onRemoveEdge: (edgeId: string) => void;
    onDropUrl?: (url: string) => void;
    onDropFile?: (file: File) => void;
    getTaskForNode?: (nodeId: string) => import("@/lib/agent/types").AgentTask | undefined;
    getTaskById?: (taskId: string) => import("@/lib/agent/types").AgentTask | undefined;
    onApproveStep?: (taskId: string, stepId: string) => void;
    onRejectStep?: (taskId: string, stepId: string) => void;
    onAnswerStep?: (taskId: string, stepId: string, answer: string) => void;
    onCancelTask?: (taskId: string) => void;
    onContinueFromCard?: (nodeId: string, message: string) => void;
}

export function WorkspaceView({
    nodes,
    activeNodeId,
    spaceId,
    spaceLabel,
    onActivate,
    onClose,
    onMinimize,
    onMove,
    onResize,
    onToggleGodMode,
    edges,
    linkMode,
    onStartLink,
    onCompleteLink,
    onCancelLink,
    onRemoveEdge,
    onDropUrl,
    onDropFile,
    getTaskForNode,
    getTaskById,
    onApproveStep,
    onRejectStep,
    onAnswerStep,
    onCancelTask,
    onContinueFromCard,
}: WorkspaceViewProps) {
    const { settings } = useSettings();

    const activeSpaceNodes = useMemo(
        () => nodes.filter((n) => n.spaceId === spaceId),
        [nodes, spaceId],
    );

    const inactiveSpaceNodes = useMemo(
        () => nodes.filter((n) => n.spaceId !== spaceId),
        [nodes, spaceId],
    );

    const isInProgressAgentTask = useCallback(
        (node: SynthesisNode) =>
            node.type === "agent_task" &&
            (node.status === "synthesizing" ||
                node.taskStatus === "planning" ||
                node.taskStatus === "running" ||
                node.taskStatus === "waiting_approval" ||
                node.taskStatus === "waiting_answer"),
        [],
    );

    const activeNodes = useMemo(
        () =>
            activeSpaceNodes
                .filter(
                    (n) =>
                        n.status !== "minimized" &&
                        !(n.status === "synthesizing" && n.type !== "agent_task"),
                )
                .sort((a, b) => a.zIndex - b.zIndex),
        [activeSpaceNodes, isInProgressAgentTask],
    );

    const minimizedNodes = useMemo(
        () => activeSpaceNodes.filter((n) => n.status === "minimized").sort((a, b) => b.updatedAt - a.updatedAt),
        [activeSpaceNodes],
    );
    const resolvedActiveNodeId = useMemo(() => {
        if (activeNodes.length === 0) return null;
        if (activeNodeId && activeNodes.some((node) => node.id === activeNodeId)) return activeNodeId;
        return activeNodes[activeNodes.length - 1]?.id ?? null;
    }, [activeNodeId, activeNodes]);
    const inactiveDepthById = useMemo(() => {
        const ranked = activeNodes
            .filter((node) => node.id !== resolvedActiveNodeId)
            .sort((a, b) => b.zIndex - a.zIndex);
        return new Map(ranked.map((node, index) => [node.id, index]));
    }, [activeNodes, resolvedActiveNodeId]);
    const visibleMinimizedNodes = useMemo(() => minimizedNodes.slice(0, 8), [minimizedNodes]);
    const hiddenMinimizedCount = minimizedNodes.length - visibleMinimizedNodes.length;
    const premiumSpring = useMemo(
        () =>
            settings.animations
                ? ({ type: "spring", stiffness: 300, damping: 30, mass: 0.85 } as const)
                : ({ duration: 0 } as const),
        [settings.animations],
    );
    const pillsViewportRef = useRef<HTMLDivElement | null>(null);
    const [isPillStripHovered, setIsPillStripHovered] = useState(false);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 });
    const colors = useMemo(() => {
        if (!settings.adaptiveColor) return NEUTRAL_COLORS;
        if (settings.accentSource === "space") return SPACE_COLORS[spaceId];
        if (settings.accentSource === "content") {
            // Use the accent color from the topmost active node if available
            const topNode = activeNodes[activeNodes.length - 1];
            if (topNode?.content?.design?.accent_color) {
                const c = topNode.content.design.accent_color;
                return { primary: c, secondary: c, glow: `${c}40` };
            }
            return SPACE_COLORS[spaceId]; // fallback
        }
        const custom = settings.customAccentColor || SPACE_COLORS[spaceId].primary;
        return {
            primary: custom,
            secondary: mixHexWithWhite(custom, 0.18),
            glow: hexToRgba(custom, 0.26),
        };
    }, [settings.adaptiveColor, settings.accentSource, settings.customAccentColor, spaceId, activeNodes]);

    const backgroundPreset = useMemo(() => {
        return SYNTHESIS_BACKGROUND_PRESET_BY_ID[settings.backgroundPreset] ?? SYNTHESIS_BACKGROUND_PRESET_BY_ID["synthesis-default"];
    }, [settings.backgroundPreset]);
    const isMediaBackground = backgroundPreset.kind === "image" || backgroundPreset.kind === "video";
    const backgroundSaturation = 0.75 + ((settings.glassSaturation - 80) / 120) * 1.65;
    const dynamicMotionLayer = useMemo(() => {
        switch (backgroundPreset.id) {
            case "liquid-blob":
                return "radial-gradient(38% 34% at 18% 24%, rgba(96,165,250,0.28) 0%, transparent 70%), radial-gradient(40% 36% at 78% 76%, rgba(129,140,248,0.24) 0%, transparent 72%), radial-gradient(30% 30% at 62% 24%, rgba(56,189,248,0.18) 0%, transparent 74%)";
            case "aurora-borealis":
                return "radial-gradient(50% 42% at 12% 20%, rgba(34,197,94,0.24) 0%, transparent 70%), radial-gradient(55% 45% at 84% 14%, rgba(56,189,248,0.2) 0%, transparent 74%), radial-gradient(42% 40% at 70% 74%, rgba(129,140,248,0.18) 0%, transparent 75%)";
            case "mesh-gradient":
                return "radial-gradient(46% 46% at 22% 24%, rgba(192,132,252,0.26) 0%, transparent 72%), radial-gradient(48% 48% at 74% 72%, rgba(96,165,250,0.24) 0%, transparent 72%), radial-gradient(40% 40% at 65% 20%, rgba(34,211,238,0.16) 0%, transparent 74%)";
            case "neon-grid":
                return "linear-gradient(90deg, rgba(34,211,238,0.12) 1px, transparent 1px), linear-gradient(0deg, rgba(56,189,248,0.12) 1px, transparent 1px)";
            case "deep-ocean":
                return "radial-gradient(50% 38% at 16% 18%, rgba(34,211,238,0.18) 0%, transparent 70%), radial-gradient(55% 45% at 76% 78%, rgba(59,130,246,0.16) 0%, transparent 74%)";
            case "geometric-shapes":
                return "linear-gradient(125deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%), linear-gradient(42deg, rgba(96,165,250,0.15) 0%, rgba(96,165,250,0) 60%)";
            case "sunset-haze":
                return "radial-gradient(45% 35% at 20% 20%, rgba(251,146,60,0.2) 0%, transparent 70%), radial-gradient(45% 35% at 80% 70%, rgba(244,114,182,0.18) 0%, transparent 72%)";
            case "polar-night":
                return "radial-gradient(50% 42% at 18% 20%, rgba(34,211,238,0.14) 0%, transparent 70%), radial-gradient(45% 40% at 74% 80%, rgba(99,102,241,0.18) 0%, transparent 72%)";
            case "violet-fog":
                return "radial-gradient(45% 42% at 24% 28%, rgba(167,139,250,0.24) 0%, transparent 72%), radial-gradient(40% 38% at 76% 72%, rgba(192,132,252,0.22) 0%, transparent 72%)";
            case "matrix-wave":
                return "repeating-linear-gradient(90deg, rgba(34,197,94,0.1) 0, rgba(34,197,94,0.1) 1px, transparent 1px, transparent 16px)";
            default:
                return "radial-gradient(45% 40% at 20% 20%, rgba(96,165,250,0.18) 0%, transparent 72%), radial-gradient(45% 40% at 80% 75%, rgba(129,140,248,0.16) 0%, transparent 72%)";
        }
    }, [backgroundPreset.id]);

    useEffect(() => {
        const updateViewport = () => {
            setViewportSize({ width: window.innerWidth, height: window.innerHeight });
        };
        updateViewport();
        window.addEventListener("resize", updateViewport);
        return () => window.removeEventListener("resize", updateViewport);
    }, []);

    const clampToAutoBounds = useCallback(
        (x: number, y: number, w: number, h: number) => {
            const sideMargin = 24;
            const topInset = 86;
            const bottomInset = 126;
            const maxX = Math.max(sideMargin, viewportSize.width - w - sideMargin);
            const maxY = Math.max(topInset, viewportSize.height - h - bottomInset);
            return {
                x: Math.max(sideMargin, Math.min(x, maxX)),
                y: Math.max(topInset, Math.min(y, maxY)),
            };
        },
        [viewportSize.height, viewportSize.width],
    );

    const focusAnchor = useMemo(
        () => ({
            x: viewportSize.width * 0.52,
            y: viewportSize.height * 0.48,
        }),
        [viewportSize.height, viewportSize.width],
    );

    const autoTargetById = useMemo(() => {
        const targets = new Map<string, { x: number; y: number }>();
        const activeNode = resolvedActiveNodeId
            ? activeNodes.find((node) => node.id === resolvedActiveNodeId)
            : undefined;

        if (activeNode) {
            const focused = clampToAutoBounds(
                focusAnchor.x - activeNode.dimension.w / 2,
                focusAnchor.y - activeNode.dimension.h / 2,
                activeNode.dimension.w,
                activeNode.dimension.h,
            );
            targets.set(activeNode.id, focused);
        }

        const inactiveNodes = activeNodes
            .filter((node) => node.id !== resolvedActiveNodeId)
            .sort((a, b) => b.zIndex - a.zIndex);

        inactiveNodes.forEach((node, index) => {
            const base = AUTO_STACK_OFFSETS[index % AUTO_STACK_OFFSETS.length];
            const ring = Math.floor(index / AUTO_STACK_OFFSETS.length);
            const spread = 1 + ring * 0.26;
            const target = clampToAutoBounds(
                focusAnchor.x + base.x * spread - node.dimension.w / 2,
                focusAnchor.y + base.y * spread - node.dimension.h / 2 + ring * 8,
                node.dimension.w,
                node.dimension.h,
            );
            targets.set(node.id, target);
        });

        return targets;
    }, [activeNodes, clampToAutoBounds, focusAnchor.x, focusAnchor.y, resolvedActiveNodeId]);

    // Re-clamp nodes on window resize
    useEffect(() => {
        const handleResize = () => {
            activeNodes.forEach((node) => {
                const clamped = clampPositionToViewport(
                    node.position.x,
                    node.position.y,
                    node.dimension.w,
                    node.dimension.h,
                    window.innerWidth,
                    window.innerHeight
                );
                if (clamped.x !== node.position.x || clamped.y !== node.position.y) {
                    onMove(node.id, clamped);
                }
            });
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [activeNodes, onMove]);

    useEffect(() => {
        if (!resolvedActiveNodeId) return;
        const activeNode = activeNodes.find((node) => node.id === resolvedActiveNodeId);
        const focusedTarget = autoTargetById.get(resolvedActiveNodeId);
        if (!activeNode || !focusedTarget) return;
        if (Math.abs(activeNode.position.x - focusedTarget.x) < 2 && Math.abs(activeNode.position.y - focusedTarget.y) < 2) return;
        onMove(resolvedActiveNodeId, focusedTarget);
    }, [activeNodes, autoTargetById, onMove, resolvedActiveNodeId]);

    const handleMinimize = useCallback(
        (id: string) => {
            onMinimize(id);
        },
        [onMinimize],
    );

    const handleClose = useCallback(
        (id: string) => {
            onClose(id);
        },
        [onClose],
    );

    const handleRestore = useCallback(
        (id: string) => {
            onActivate(id);
        },
        [onActivate],
    );

    // --- Drag & Drop ---
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (dragCounterRef.current === 1) setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0;
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragOver(false);

        // Check for URL in text/plain or text/uri-list
        const urlText = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
        const urlMatch = urlText.trim().match(/^https?:\/\/\S+$/i);

        if (urlMatch && onDropUrl) {
            onDropUrl(urlMatch[0]);
            return;
        }

        // Check for files
        if (e.dataTransfer.files.length > 0 && onDropFile) {
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                onDropFile(e.dataTransfer.files[i]);
            }
            return;
        }

        // Fallback: treat any dropped text as a query
        if (urlText.trim() && onDropUrl) {
            onDropUrl(urlText.trim());
        }
    }, [onDropUrl, onDropFile]);

    const updatePillScrollState = useCallback(() => {
        const el = pillsViewportRef.current;
        if (!el) return;
        const left = el.scrollLeft > 2;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
        setCanScrollLeft(left);
        setCanScrollRight(right);
    }, []);

    const scrollPills = useCallback((direction: "left" | "right") => {
        const el = pillsViewportRef.current;
        if (!el) return;
        const amount = Math.max(160, Math.round(el.clientWidth * 0.28));
        el.scrollBy({
            left: direction === "left" ? -amount : amount,
            behavior: settings.animations ? "smooth" : "auto",
        });
    }, [settings.animations]);

    useEffect(() => {
        const el = pillsViewportRef.current;
        if (!el) return;
        updatePillScrollState();
        const onScroll = () => updatePillScrollState();
        el.addEventListener("scroll", onScroll, { passive: true });
        const onResize = () => updatePillScrollState();
        window.addEventListener("resize", onResize);
        return () => {
            el.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
        };
    }, [updatePillScrollState, visibleMinimizedNodes.length, hiddenMinimizedCount]);

    return (
        <div
            role="main"
            aria-label={`${spaceLabel} workspace`}
            className="fixed inset-0 top-0 z-20 select-none"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                    window.getSelection()?.removeAllRanges();
                }
            }}
        >
            {/* ── Drop zone overlay ── */}
            <AnimatePresence>
                {isDragOver && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 z-[1500] flex items-center justify-center pointer-events-none"
                        style={{ background: settings.theme === "light" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)" }}
                    >
                        <motion.div
                            initial={{ scale: 0.9, y: 10 }}
                            animate={{ scale: 1, y: 0 }}
                            className={`flex flex-col items-center gap-3 px-12 py-10 rounded-3xl border-2 border-dashed ${settings.theme === "light"
                                ? "border-blue-400/50 bg-blue-50/60"
                                : "border-blue-400/40 bg-blue-950/40"
                                } glass-elevated`}
                        >
                            <Upload size={32} className={settings.theme === "light" ? "text-blue-500/70" : "text-blue-400/70"} />
                            <p className={`text-sm font-medium ${settings.theme === "light" ? "text-black/60" : "text-white/60"}`}>
                                Drop URL or file to synthesize
                            </p>
                            <p className={`text-xs ${settings.theme === "light" ? "text-black/30" : "text-white/30"}`}>
                                URLs, text files, images, Markdown
                            </p>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Ambient background ── */}
            <div className="absolute inset-0 -z-10 overflow-hidden">
                <div
                    className="absolute inset-0"
                    style={{ filter: `saturate(${backgroundSaturation})` }}
                >
                    <div
                        className="absolute inset-0"
                        style={{ background: isMediaBackground ? "var(--synthesis-bg, #060a1a)" : backgroundPreset.base }}
                    />

                    {(backgroundPreset.kind === "image" || backgroundPreset.kind === "video") && backgroundPreset.mediaUrl && (
                        <div
                            className="absolute inset-0"
                            style={{
                                backgroundImage: backgroundPreset.kind === "image" ? `url(${backgroundPreset.mediaUrl})` : undefined,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                                opacity: 1,
                            }}
                        >
                            {backgroundPreset.kind === "video" && (
                                <video
                                    key={backgroundPreset.id}
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                    preload="metadata"
                                    poster={backgroundPreset.posterUrl}
                                    className="w-full h-full object-cover"
                                >
                                    <source src={backgroundPreset.mediaUrl} type="video/mp4" />
                                </video>
                            )}
                        </div>
                    )}

                    {backgroundPreset.pattern && !isMediaBackground && (
                        <div
                            className="absolute inset-0 opacity-35"
                            style={{
                                backgroundImage: backgroundPreset.pattern,
                                backgroundSize: "48px 48px, 48px 48px",
                            }}
                        />
                    )}

                    {backgroundPreset.kind === "dynamic" && settings.animations && (
                        <motion.div
                            className="absolute inset-0"
                            style={{
                                background: dynamicMotionLayer,
                                backgroundSize: backgroundPreset.id === "neon-grid" || backgroundPreset.id === "matrix-wave"
                                    ? "52px 52px, 52px 52px"
                                    : "170% 170%",
                                opacity: 0.45,
                                mixBlendMode: "screen",
                            }}
                            animate={{
                                backgroundPosition: ["0% 0%", "100% 90%", "0% 0%"],
                                rotate: backgroundPreset.id === "neon-grid" ? [0, 0.5, 0] : 0,
                                scale: [1, 1.04, 1],
                            }}
                            transition={{ duration: 24, repeat: Infinity, ease: "easeInOut" }}
                        />
                    )}

                    {settings.backgroundOverlay && (
                        <div
                            className="absolute inset-0"
                            style={{
                                background: isMediaBackground
                                    ? settings.theme === "light"
                                        ? "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(15,23,42,0.06) 45%, rgba(15,23,42,0.18) 100%)"
                                        : "linear-gradient(180deg, rgba(4,8,20,0.08) 0%, rgba(4,8,20,0.28) 45%, rgba(3,5,12,0.5) 100%)"
                                    : settings.theme === "light"
                                        ? "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(0,0,0,0.06) 100%)"
                                        : "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(9,12,24,0.28) 45%, rgba(3,5,12,0.68) 100%)",
                            }}
                        />
                    )}

                    {/* Space-colored ambient gradients */}
                    {settings.glassTint && (
                        <motion.div
                            key={`bg-${spaceId}`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: settings.animations ? 1.5 : 0 }}
                            className="absolute inset-0"
                            style={{
                                background: `
                                    radial-gradient(ellipse 80% 60% at 10% 15%, ${hexToRgba(colors.primary, isMediaBackground ? 0.14 : 0.2)} 0%, transparent 65%),
                                    radial-gradient(ellipse 70% 55% at 90% 80%, ${hexToRgba(colors.secondary, isMediaBackground ? 0.1 : 0.15)} 0%, transparent 60%),
                                    radial-gradient(ellipse 55% 40% at 30% 80%, ${hexToRgba(settings.glassTintColor, isMediaBackground ? 0.08 : 0.16)} 0%, transparent 72%),
                                    radial-gradient(ellipse 65% 50% at 78% 20%, ${hexToRgba(settings.glassTintColor, isMediaBackground ? 0.06 : 0.12)} 0%, transparent 68%)
                                `,
                            }}
                        />
                    )}

                    {/* Star field */}
                    {settings.starField && (
                        <div
                            className={`absolute inset-0 ${settings.theme === "light" ? "opacity-30" : "opacity-70"}`}
                            style={{
                                backgroundImage: settings.theme === "light"
                                    ? "radial-gradient(1.5px 1.5px at 20px 30px, rgba(0,0,0,0.1), transparent), radial-gradient(1px 1px at 40px 70px, rgba(0,0,0,0.08), transparent), radial-gradient(1.2px 1.2px at 80px 10px, rgba(0,0,0,0.06), transparent)"
                                    : "radial-gradient(1.5px 1.5px at 20px 30px, rgba(255,255,255,0.2), transparent), radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.15), transparent), radial-gradient(1.2px 1.2px at 80px 10px, rgba(255,255,255,0.1), transparent)",
                                backgroundSize: "120px 120px, 160px 160px, 200px 200px",
                            }}
                        />
                    )}

                    {/* Subtle dot grid */}
                    {!isMediaBackground && (
                        <div
                            className="absolute inset-0 opacity-[0.04]"
                            style={{
                                backgroundImage: settings.theme === "light"
                                    ? "radial-gradient(circle, rgba(0,0,0,0.3) 1px, transparent 1px)"
                                    : "radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)",
                                backgroundSize: "60px 60px",
                            }}
                        />
                    )}

                    {settings.noiseGrain > 0 && (
                        <div
                            className="absolute inset-0 pointer-events-none"
                            style={{
                                opacity: Math.min(0.22, settings.noiseGrain / 120),
                                mixBlendMode: settings.theme === "light" ? "multiply" : "screen",
                                backgroundImage:
                                    "radial-gradient(circle at 12% 24%, rgba(255,255,255,0.85) 0.5px, transparent 0.7px), radial-gradient(circle at 72% 68%, rgba(255,255,255,0.65) 0.5px, transparent 0.7px), radial-gradient(circle at 48% 42%, rgba(255,255,255,0.55) 0.5px, transparent 0.7px)",
                                backgroundSize: "3px 3px, 4px 4px, 5px 5px",
                            }}
                        />
                    )}
                </div>

                {/* Node context tint */}
                {activeNodes[activeNodes.length - 1] && (
                    <motion.div
                        key={activeNodes[activeNodes.length - 1].id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: settings.animations ? 2.5 : 0 }}
                        className="absolute inset-0"
                        style={{
                            background: `radial-gradient(ellipse 50% 40% at 50% 30%, ${activeNodes[activeNodes.length - 1].content.design.accent_color}15 0%, transparent 70%)`,
                        }}
                    />
                )}

            </div>

                {/* ── Minimized nodes strip ── */}
                {minimizedNodes.length > 0 && (
                    <div
                        className="pointer-events-none absolute top-[22px] left-0 right-0 z-[700]"
                        style={{
                            paddingLeft: "clamp(520px, 33vw, 720px)",
                            paddingRight: "188px",
                        }}
                    >
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={premiumSpring}
                            className="pointer-events-auto relative h-[34px] w-full"
                            onMouseEnter={() => setIsPillStripHovered(true)}
                            onMouseLeave={() => setIsPillStripHovered(false)}
                        >
                            <div className="relative h-full flex items-center gap-1.5">
                                <div
                                    ref={pillsViewportRef}
                                    className="flex-1 min-w-0 h-full overflow-x-auto overflow-y-visible no-scrollbar"
                                >
                                    <div className="h-full w-max flex items-center gap-1.5 pr-1.5">
                                        <AnimatePresence initial={false}>
                                            {visibleMinimizedNodes.map((node) => {
                                                const ageMs = Date.now() - node.updatedAt;
                                                const isRecent = ageMs < 60_000;
                                                const isStale = ageMs > 15 * 60_000;
                                                return (
                                                    <motion.div
                                                        key={node.id}
                                                        layoutId={WINDOW_LAYOUT_ID(node.id)}
                                                        initial={false}
                                                        transition={premiumSpring}
                                                        whileHover={settings.animations ? { y: -1, scale: 1.01 } : undefined}
                                                        className={cn(
                                                            "h-[30px] shrink-0 rounded-full border transition-colors inline-flex",
                                                            settings.theme === "light"
                                                                ? "border-black/[0.18] hover:border-violet-500/45"
                                                                : "border-white/[0.22] hover:border-violet-300/55",
                                                            isRecent && (
                                                                settings.theme === "light"
                                                                    ? "border-sky-500/45"
                                                                    : "border-sky-300/55"
                                                            ),
                                                            isStale && (
                                                                settings.theme === "light"
                                                                    ? "border-amber-600/35"
                                                                    : "border-amber-300/45"
                                                            ),
                                                        )}
                                                    >
                                                        <GlassContainer
                                                            className="h-[30px] inline-flex"
                                                            borderRadius={999}
                                                            blur="6px"
                                                            saturation="150%"
                                                            isFloating={true}
                                                        >
                                                            <button
                                                                onClick={() => handleRestore(node.id)}
                                                                className={cn(
                                                                    "h-[30px] px-3 inline-flex items-center text-[10.5px] font-medium max-w-[220px] truncate",
                                                                    settings.theme === "light" ? "text-black/85" : "text-white/90",
                                                                )}
                                                                title={`Restore: ${node.title}`}
                                                            >
                                                                {node.title || "Untitled"}
                                                            </button>
                                                        </GlassContainer>
                                                    </motion.div>
                                                );
                                            })}
                                        </AnimatePresence>
                                    </div>
                                </div>

                                {hiddenMinimizedCount > 0 && (
                                    <div className={cn(
                                        "h-[30px] shrink-0 rounded-full border inline-flex",
                                        settings.theme === "light"
                                            ? "border-black/[0.22]"
                                            : "border-white/[0.28]",
                                    )}>
                                        <GlassContainer
                                            className="h-[30px] inline-flex"
                                            borderRadius={999}
                                            blur="6px"
                                            saturation="150%"
                                            isFloating={true}
                                        >
                                            <span className={cn(
                                                "h-[30px] px-2.5 inline-flex items-center text-[9px] font-semibold",
                                                settings.theme === "light" ? "text-black/70" : "text-white/82",
                                            )}>
                                                +{hiddenMinimizedCount}
                                            </span>
                                        </GlassContainer>
                                    </div>
                                )}
                            </div>

                            <AnimatePresence initial={false}>
                                {isPillStripHovered && (canScrollLeft || canScrollRight) && (
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: settings.animations ? 0.16 : 0 }}
                                        className="pointer-events-none absolute inset-y-0 -left-8 -right-8"
                                    >
                                        <button
                                            onClick={() => scrollPills("left")}
                                            disabled={!canScrollLeft}
                                            className={cn(
                                                "pointer-events-auto absolute left-0 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full glass flex items-center justify-center transition-opacity",
                                                canScrollLeft
                                                    ? (settings.theme === "light" ? "text-black/70" : "text-white/80")
                                                    : "opacity-30 cursor-default",
                                            )}
                                            aria-label="Scroll minimized pills left"
                                        >
                                            <ScrollArcIcon direction="left" />
                                        </button>
                                        <button
                                            onClick={() => scrollPills("right")}
                                            disabled={!canScrollRight}
                                            className={cn(
                                                "pointer-events-auto absolute right-0 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full glass flex items-center justify-center transition-opacity",
                                                canScrollRight
                                                    ? (settings.theme === "light" ? "text-black/70" : "text-white/80")
                                                    : "opacity-30 cursor-default",
                                            )}
                                            aria-label="Scroll minimized pills right"
                                        >
                                            <ScrollArcIcon direction="right" />
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    </div>
                )}

                {/* ── Canvas — all draggable windows ── */}
                <div
                    className="absolute inset-0 overflow-hidden"
                    onClick={linkMode ? (e) => { if (e.target === e.currentTarget) onCancelLink(); } : undefined}
                >
                    {/* Edge SVG overlay */}
                    <EdgeRenderer
                        edges={edges}
                        nodes={nodes}
                        linkMode={linkMode}
                        onRemoveEdge={onRemoveEdge}
                    />

                    <AnimatePresence>
                        {activeNodes.map((node) => (
                            <DraggableWindow
                                key={node.id}
                                node={node}
                                layoutId={WINDOW_LAYOUT_ID(node.id)}
                                isActive={node.id === resolvedActiveNodeId}
                                depthIndex={inactiveDepthById.get(node.id) ?? 0}
                                targetPosition={autoTargetById.get(node.id)}
                                animationsEnabled={settings.animations}
                                onActivate={() => {
                                    if (linkMode && linkMode !== node.id) {
                                        onCompleteLink(node.id);
                                    } else {
                                        onActivate(node.id);
                                    }
                                }}
                                onClose={() => handleClose(node.id)}
                                onMinimize={() => handleMinimize(node.id)}
                                onMove={(pos) => onMove(node.id, pos)}
                                onResize={(id, dim) => onResize?.(id, dim)}
                                onToggleGodMode={() => onToggleGodMode(node.id)}
                                onStartLink={() => onStartLink(node.id)}
                                linkMode={linkMode}
                                getTaskForNode={getTaskForNode}
                                getTaskById={getTaskById}
                                onApproveStep={onApproveStep}
                                onRejectStep={onRejectStep}
                                onAnswerStep={onAnswerStep}
                                onCancelTask={onCancelTask}
                                onContinueFromCard={onContinueFromCard}
                            />
                        ))}
                    </AnimatePresence>

                    {/* Keep inactive-space cards mounted (hidden) to avoid remount on space switch */}
                    {inactiveSpaceNodes.length > 0 && (
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 overflow-hidden"
                            style={{ visibility: "hidden", contain: "strict" }}
                        >
                            {inactiveSpaceNodes.map((node) => (
                                <DraggableWindow
                                    key={node.id}
                                    node={node}
                                    layoutId={`${WINDOW_LAYOUT_ID(node.id)}-inactive`}
                                    isActive={false}
                                    depthIndex={0}
                                    targetPosition={node.position}
                                    animationsEnabled={false}
                                    onActivate={() => {}}
                                    onClose={() => {}}
                                    onMinimize={() => {}}
                                    onMove={() => {}}
                                    onToggleGodMode={() => {}}
                                    onStartLink={() => {}}
                                    linkMode={null}
                                    getTaskForNode={getTaskForNode}
                                    getTaskById={getTaskById}
                                    onApproveStep={onApproveStep}
                                    onRejectStep={onRejectStep}
                                    onAnswerStep={onAnswerStep}
                                    onCancelTask={onCancelTask}
                                    onContinueFromCard={onContinueFromCard}
                                />
                            ))}
                        </div>
                    )}

                </div>
        </div>
    );
}

/* ─── Resize direction types ─── */
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_CURSORS: Record<ResizeDir, string> = {
    n: "cursor-ns-resize", s: "cursor-ns-resize",
    e: "cursor-ew-resize", w: "cursor-ew-resize",
    ne: "cursor-nesw-resize", sw: "cursor-nesw-resize",
    nw: "cursor-nwse-resize", se: "cursor-nwse-resize",
};

const MIN_W = 280;
const MAX_W = 1200;
const MIN_H = 180;

/* ─── Draggable Window ─── */

function DraggableWindow({
    node,
    layoutId,
    isActive,
    depthIndex,
    targetPosition,
    animationsEnabled,
    onActivate,
    onClose,
    onMinimize,
    onMove,
    onToggleGodMode,
    onStartLink,
    linkMode,
    getTaskForNode,
    getTaskById,
    onApproveStep,
    onRejectStep,
    onAnswerStep,
    onCancelTask,
    onResize,
    onContinueFromCard,
}: {
    node: SynthesisNode;
    layoutId: string;
    isActive: boolean;
    depthIndex: number;
    targetPosition?: { x: number; y: number };
    animationsEnabled: boolean;
    onActivate: () => void;
    onClose: () => void;
    onMinimize: () => void;
    onMove: (pos: { x: number; y: number }) => void;
    onToggleGodMode: () => void;
    onStartLink: () => void;
    linkMode: string | null;
    getTaskForNode?: (nodeId: string) => import("@/lib/agent/types").AgentTask | undefined;
    getTaskById?: (taskId: string) => import("@/lib/agent/types").AgentTask | undefined;
    onApproveStep?: (taskId: string, stepId: string) => void;
    onRejectStep?: (taskId: string, stepId: string) => void;
    onAnswerStep?: (taskId: string, stepId: string, answer: string) => void;
    onCancelTask?: (taskId: string) => void;
    onResize?: (id: string, dimension: { w: number; h: number }) => void;
    onContinueFromCard?: (nodeId: string, message: string) => void;
}) {
    const { settings } = useSettings();
    const dragControls = useDragControls();
    const x = useMotionValue(node.position.x);
    const y = useMotionValue(node.position.y);
    const w = useMotionValue(node.dimension?.w || 400);
    const h = useMotionValue(node.dimension?.h || 300);

    // Resize state
    const resizeRef = useRef<{
        dir: ResizeDir;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
        startNodeX: number;
        startNodeY: number;
    } | null>(null);
    const [isResizing, setIsResizing] = useState(false);

    // Spring config based on animation quality
    const springConfig = {
        high: { stiffness: 400, damping: 30 },
        medium: { stiffness: 250, damping: 40 },
        low: { stiffness: 150, damping: 50 },
    }[settings.animationQuality];

    // Sync to automatic target (or persisted position when no target)
    const targetX = targetPosition?.x ?? node.position.x;
    const targetY = targetPosition?.y ?? node.position.y;
    const posKey = `${targetX}-${targetY}`;
    useEffect(() => {
        if (Math.abs(x.get() - targetX) > 2 || Math.abs(y.get() - targetY) > 2) {
            animate(x, targetX, animationsEnabled ? { type: "spring", ...springConfig } : { duration: 0 });
            animate(y, targetY, animationsEnabled ? { type: "spring", ...springConfig } : { duration: 0 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posKey, animationsEnabled, settings.animationQuality, targetX, targetY]);

    const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const rawX = x.get() + info.velocity.x * 0.04;
        const rawY = y.get() + info.velocity.y * 0.04;
        const clamped = clampPositionToViewport(
            rawX,
            rawY,
            w.get(),
            h.get(),
            typeof window !== "undefined" ? window.innerWidth : 1920,
            typeof window !== "undefined" ? window.innerHeight : 1080,
        );
        onMove({ x: clamped.x, y: clamped.y });
    };

    // Title bar triggers drag (only from the title bar, like a real OS)
    const handleTitleBarPointerDown = useCallback((e: React.PointerEvent) => {
        // Don't start drag if clicking on buttons (close/minimize/god mode)
        if ((e.target as HTMLElement).closest("button")) return;
        onActivate();
        dragControls.start(e);
    }, [onActivate, dragControls]);

    // ── Resize: start on any edge/corner ──
    const startResize = useCallback((dir: ResizeDir) => (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onActivate();
        resizeRef.current = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            startW: w.get(),
            startH: h.get(),
            startNodeX: x.get(),
            startNodeY: y.get(),
        };
        setIsResizing(true);
    }, [onActivate, w, h, x, y]);

    useLayoutEffect(() => {
        if (!isResizing || !resizeRef.current) return;

        const snap = resizeRef.current;
        const maxH = window.innerHeight * 0.9;

        const handlePointerMove = (e: PointerEvent) => {
            const dx = e.clientX - snap.startX;
            const dy = e.clientY - snap.startY;
            const dir = snap.dir;

            let newW = snap.startW;
            let newH = snap.startH;
            let newX = snap.startNodeX;
            let newY = snap.startNodeY;

            // East (right edge)
            if (dir === "e" || dir === "se" || dir === "ne") {
                newW = Math.max(MIN_W, Math.min(MAX_W, snap.startW + dx));
            }
            // West (left edge) — moves position too
            if (dir === "w" || dir === "sw" || dir === "nw") {
                const dw = Math.max(MIN_W, Math.min(MAX_W, snap.startW - dx));
                newX = snap.startNodeX + (snap.startW - dw);
                newW = dw;
            }
            // South (bottom edge)
            if (dir === "s" || dir === "se" || dir === "sw") {
                newH = Math.max(MIN_H, Math.min(maxH, snap.startH + dy));
            }
            // North (top edge) — moves position too
            if (dir === "n" || dir === "ne" || dir === "nw") {
                const dh = Math.max(MIN_H, Math.min(maxH, snap.startH - dy));
                newY = snap.startNodeY + (snap.startH - dh);
                newH = dh;
            }

            w.set(newW);
            h.set(newH);
            x.set(newX);
            y.set(newY);
        };

        const handlePointerUp = () => {
            setIsResizing(false);
            onResize?.(node.id, { w: w.get(), h: h.get() });
            onMove({ x: x.get(), y: y.get() });
            resizeRef.current = null;
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);

        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerup", handlePointerUp);
        };
    }, [isResizing, w, h, x, y, node.id, onResize, onMove]);

    // Edge thickness for invisible hit areas
    const EDGE = 5; // px
    const CORNER = 14; // px
    const inactiveScale = Math.max(0.84, 0.9 - depthIndex * 0.018);
    const inactiveYOffset = 14;
    const windowZIndex = isActive ? 620 : Math.max(360, 520 - depthIndex);

    return (
        <motion.div
            drag={isActive}
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragElastic={0.05}
            onDragEnd={handleDragEnd}
            onPointerDown={onActivate}
            initial={false}
            animate={{
                zIndex: windowZIndex,
                scale: isActive ? 1 : inactiveScale,
                opacity: 1,
                translateY: isActive ? 0 : inactiveYOffset,
                filter: "none",
            }}
            transition={animationsEnabled ? { type: "spring", stiffness: 300, damping: 30, mass: 0.85 } : { duration: 0 }}
            style={{
                x,
                y,
                width: w,
                height: h,
                willChange: settings.gpuAccel ? "transform" : "auto",
            }}
            className="absolute top-0 left-0"
        >
            <motion.div
                layoutId={layoutId}
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={
                    animationsEnabled
                        ? { type: "spring", stiffness: 300, damping: 30, mass: 0.85 }
                        : { duration: 0 }
                }
                style={{
                    boxShadow: isActive
                        ? "0 34px 92px rgba(0,0,0,0.46), 0 10px 24px rgba(0,0,0,0.24)"
                        : "0 12px 30px rgba(0,0,0,0.24)",
                }}
                className="relative h-full flex flex-col rounded-2xl overflow-hidden"
            >
                <ErrorBoundary label={`Card: ${node.title}`}>
                    <NodeCard
                        node={node}
                        isActive={isActive}
                        presentationState={isActive ? "focus" : "background"}
                        depthIndex={depthIndex}
                        onClose={onClose}
                        onMinimize={onMinimize}
                        onToggleGodMode={onToggleGodMode}
                        onStartLink={onStartLink}
                        isLinkTarget={linkMode !== null && linkMode !== node.id}
                        task={(node.taskId && getTaskById) ? getTaskById(node.taskId) : getTaskForNode?.(node.id)}
                        onApproveStep={onApproveStep}
                        onRejectStep={onRejectStep}
                        onAnswerStep={onAnswerStep}
                        onCancelTask={onCancelTask}
                        onTitleBarPointerDown={handleTitleBarPointerDown}
                        onContinueFromCard={onContinueFromCard}
                    />
                </ErrorBoundary>

                {/* ── Invisible resize hit areas: 4 edges + 4 corners ── */}
                {/* Edges — inset by CORNER so they don't overlap corner zones */}
                <div onPointerDown={startResize("n")} className={RESIZE_CURSORS.n} style={{ position: "absolute", top: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE, zIndex: 1000 }} />
                <div onPointerDown={startResize("s")} className={RESIZE_CURSORS.s} style={{ position: "absolute", bottom: -EDGE / 2, left: CORNER, right: CORNER, height: EDGE, zIndex: 1000 }} />
                <div onPointerDown={startResize("w")} className={RESIZE_CURSORS.w} style={{ position: "absolute", top: CORNER, left: -EDGE / 2, bottom: CORNER, width: EDGE, zIndex: 1000 }} />
                <div onPointerDown={startResize("e")} className={RESIZE_CURSORS.e} style={{ position: "absolute", top: CORNER, right: -EDGE / 2, bottom: CORNER, width: EDGE, zIndex: 1000 }} />
                {/* Corners */}
                <div onPointerDown={startResize("nw")} className={RESIZE_CURSORS.nw} style={{ position: "absolute", top: -EDGE / 2, left: -EDGE / 2, width: CORNER, height: CORNER, zIndex: 1001 }} />
                <div onPointerDown={startResize("ne")} className={RESIZE_CURSORS.ne} style={{ position: "absolute", top: -EDGE / 2, right: -EDGE / 2, width: CORNER, height: CORNER, zIndex: 1001 }} />
                <div onPointerDown={startResize("sw")} className={RESIZE_CURSORS.sw} style={{ position: "absolute", bottom: -EDGE / 2, left: -EDGE / 2, width: CORNER, height: CORNER, zIndex: 1001 }} />
                <div onPointerDown={startResize("se")} className={RESIZE_CURSORS.se} style={{ position: "absolute", bottom: -EDGE / 2, right: -EDGE / 2, width: CORNER, height: CORNER, zIndex: 1001 }} />
            </motion.div>
        </motion.div>
    );
}
