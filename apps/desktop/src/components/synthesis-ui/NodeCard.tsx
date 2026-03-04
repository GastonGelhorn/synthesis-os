"use client";

import React, { useCallback, useState, useRef, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Copy, Check, Download, FileText, FileJson, Link2, X, Minus } from "lucide-react";
import { SynthesisNode } from "@/types/synthesis";
import { useSettings } from "@/context/SettingsContext";
import { SynthesisCardNodeIdProvider } from "@/context/SynthesisCardContext";
import { SynthesisCard } from "./SynthesisCard";
import { WidgetRenderer } from "./widgets";
import { ThinkingCard } from "./ThinkingCard";
import { CardSkeleton } from "./CardSkeleton";

const HybridAgentCard = React.lazy(() => import("./HybridAgentCard").then(m => ({ default: m.HybridAgentCard })));
import { StepTimeline } from "./StepTimeline";
import { GlassContainer } from "./GlassContainer";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/audio";
import { exportAsMarkdown, exportAsJSON, copyToClipboard, downloadAsFile } from "@/lib/export";

interface NodeCardProps {
    node: SynthesisNode;
    isActive: boolean;
    presentationState?: "focus" | "background";
    depthIndex?: number;
    onClose: () => void;
    onMinimize: () => void;
    onToggleGodMode: () => void;
    onStartLink?: () => void;
    isLinkTarget?: boolean;
    task?: import("@/lib/agent/types").AgentTask;
    onApproveStep?: (taskId: string, stepId: string) => void;
    onRejectStep?: (taskId: string, stepId: string) => void;
    onAnswerStep?: (taskId: string, stepId: string, answer: string) => void;
    onCancelTask?: (taskId: string) => void;
    /** Pointer down handler for the title bar — used by DraggableWindow to initiate drag */
    onTitleBarPointerDown?: (e: React.PointerEvent) => void;
    /** Called when user submits from card footer to continue conversation; receives nodeId and message */
    onContinueFromCard?: (nodeId: string, message: string) => void;
    /**
     * Chrome visibility: "full" (default) shows title bar with close, minimize, export, god mode.
     * Use "none" when NodeCard is wrapped by NodeContainer (SynthesisSpace) to avoid duplicate chrome.
     */
    chrome?: "full" | "none";
}

export function NodeCard({
    node,
    isActive,
    presentationState = "focus",
    depthIndex = 0,
    onClose,
    onMinimize,
    onToggleGodMode,
    onStartLink,
    isLinkTarget,
    task,
    onApproveStep,
    onRejectStep,
    onAnswerStep,
    onCancelTask,
    onTitleBarPointerDown,
    onContinueFromCard,
    chrome = "full",
}: NodeCardProps) {
    const { settings } = useSettings();
    const [hoverRotate, setHoverRotate] = useState({ x: 0, y: 0 });
    const [copied, setCopied] = useState(false);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const [exportCopied, setExportCopied] = useState<string | null>(null);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!exportMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setExportMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [exportMenuOpen]);

    const handleExport = useCallback(async (format: "markdown" | "json" | "download-md") => {
        if (format === "download-md") {
            const md = exportAsMarkdown(node);
            const safeTitle = node.title.replace(/[^a-zA-Z0-9-_ ]/g, "").slice(0, 50);
            downloadAsFile(md, `${safeTitle}.md`, "text/markdown");
            setExportCopied("download-md");
        } else if (format === "markdown") {
            const md = exportAsMarkdown(node);
            await copyToClipboard(md);
            setExportCopied("markdown");
        } else {
            const json = exportAsJSON(node);
            await copyToClipboard(json);
            setExportCopied("json");
        }
        if (settings.soundEffects) playSound("success", settings.volume);
        setTimeout(() => {
            setExportCopied(null);
            setExportMenuOpen(false);
        }, 1500);
    }, [node, settings.soundEffects, settings.volume]);

    const design = node.content.design || {
        accent_color: "#7BD4FF",
        glass_opacity: 0.4,
        text_style: "sans" as const,
        vibe: "cosmic",
    };

    const textVibrancy = 1 + settings.textVibrancy / 160;
    const textShadow = settings.textShadowStrength > 0
        ? settings.theme === "light"
            ? `0 0 ${Math.round(settings.textShadowStrength / 8)}px rgba(255,255,255,${(settings.textShadowStrength / 100) * 0.55})`
            : `0 0 ${Math.round(settings.textShadowStrength / 8)}px rgba(0,0,0,${(settings.textShadowStrength / 100) * 0.45})`
        : "none";

    const handleCopyJson = useCallback(() => {
        const json = JSON.stringify(node.content, null, 2);
        navigator.clipboard.writeText(json).then(() => {
            setCopied(true);
            if (settings.soundEffects) playSound("success", settings.volume);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
            // Fallback: select the text
            const pre = document.querySelector("[data-god-payload]");
            if (pre) {
                const range = document.createRange();
                range.selectNodeContents(pre);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
        });
    }, [node.content, settings.soundEffects, settings.volume]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isActive) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const rotateY = ((e.clientX - centerX) / rect.width) * 3;
        const rotateX = -((e.clientY - centerY) / rect.height) * 2;

        const effectScale = settings.animationQuality === "high" ? 1 : settings.animationQuality === "medium" ? 0.5 : 0;
        setHoverRotate({ x: rotateX * effectScale, y: rotateY * effectScale });
    };

    const handleMouseLeave = () => {
        setHoverRotate({ x: 0, y: 0 });
    };
    const isFocusSurface = presentationState === "focus";
    const normalizedDepth = Math.min(depthIndex, 6);
    const windowShell = (
        <div
            className={cn(
                "overflow-hidden transition-all duration-300 flex flex-col h-full",
                isFocusSurface
                    ? "glass-node window-surface window-surface--focus border-theme"
                    : "window-liquid-shell",
                isFocusSurface && isLinkTarget && "ring-2 ring-blue-400/50 ring-offset-0",
            )}
        >
            {/* Title bar — drag handle (hidden when chrome="none" to avoid duplication with NodeContainer) */}
            {chrome !== "none" && (
                <div
                    onPointerDown={onTitleBarPointerDown}
                    className={cn(
                        settings.compactMode ? "h-8 px-3" : "h-9 px-3.5",
                        "window-chrome shrink-0 flex items-center justify-between select-none cursor-grab active:cursor-grabbing",
                        isFocusSurface ? "window-chrome--focus" : "window-chrome--background",
                    )}
                >
                    <div className="flex gap-1.5 items-center shrink-0">
                        <button
                            onClick={() => {
                                if (settings.soundEffects) playSound("click", settings.volume);
                                onClose();
                            }}
                            title="Close"
                            className={cn(
                                "window-chrome-button h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                settings.theme === "light"
                                    ? "text-black/65 hover:text-black/85 hover:bg-black/[0.08]"
                                    : "text-white/70 hover:text-white/95 hover:bg-white/[0.1]",
                            )}
                        >
                            <X size={10} strokeWidth={2.6} />
                        </button>
                        <button
                            onClick={() => {
                                if (settings.soundEffects) playSound("click", settings.volume);
                                onMinimize();
                            }}
                            title="Minimize"
                            className={cn(
                                "window-chrome-button h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                settings.theme === "light"
                                    ? "text-black/65 hover:text-black/85 hover:bg-black/[0.08]"
                                    : "text-white/70 hover:text-white/95 hover:bg-white/[0.1]",
                            )}
                        >
                            <Minus size={11} strokeWidth={2.6} />
                        </button>
                    </div>
                    <div className={cn(
                        "text-[11px] font-semibold truncate px-4 max-w-[60%] select-none pointer-events-none",
                        settings.theme === "light" ? "text-black/78" : "text-white/86",
                    )}>
                        {node.title}
                    </div>
                    <div className={`text-[10px] ${settings.theme === "light" ? "text-black/52" : "text-white/58"} flex items-center gap-1`}>
                        {onStartLink && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onStartLink(); }}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    settings.theme === "light" ? "hover:bg-black/[0.08]" : "hover:bg-white/[0.1]",
                                )}
                                title="Link to another node"
                            >
                                <Link2 size={11} />
                            </button>
                        )}
                        <div className="relative" ref={exportMenuRef}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setExportMenuOpen(!exportMenuOpen); }}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    settings.theme === "light" ? "hover:bg-black/[0.08]" : "hover:bg-white/[0.1]",
                                )}
                                title="Export"
                                aria-label="Export node content"
                                aria-expanded={exportMenuOpen}
                            >
                                <Download size={11} />
                            </button>
                            <AnimatePresence>
                                {exportMenuOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                        transition={{ duration: 0.12 }}
                                        className={cn(
                                            "absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden py-1 min-w-[160px] glass-elevated border-theme",
                                        )}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onClick={() => void handleExport("markdown")}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors",
                                                settings.theme === "light" ? "text-black/70 hover:bg-black/[0.04]" : "text-white/70 hover:bg-white/[0.04]",
                                            )}
                                        >
                                            <FileText size={11} />
                                            {exportCopied === "markdown" ? "Copied!" : "Copy as Markdown"}
                                        </button>
                                        <button
                                            onClick={() => void handleExport("json")}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors",
                                                settings.theme === "light" ? "text-black/70 hover:bg-black/[0.04]" : "text-white/70 hover:bg-white/[0.04]",
                                            )}
                                        >
                                            <FileJson size={11} />
                                            {exportCopied === "json" ? "Copied!" : "Copy as JSON"}
                                        </button>
                                        <button
                                            onClick={() => void handleExport("download-md")}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors",
                                                settings.theme === "light" ? "text-black/70 hover:bg-black/[0.04]" : "text-white/70 hover:bg-white/[0.04]",
                                            )}
                                        >
                                            <Download size={11} />
                                            {exportCopied === "download-md" ? "Downloaded!" : "Download .md"}
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        {settings.godMode && (
                            <button
                                onClick={(e) => { e.stopPropagation(); if (settings.soundEffects) playSound("click", settings.volume); onToggleGodMode(); }}
                                className={cn(
                                    "p-1.5 rounded-md transition-colors",
                                    node.isGodMode
                                        ? (settings.theme === "light" ? "bg-black/[0.09] text-black/85" : "bg-white/[0.12] text-white/90")
                                        : (settings.theme === "light" ? "hover:bg-black/[0.08] text-black/55 hover:text-black/82" : "hover:bg-white/[0.1] text-white/55 hover:text-white/86"),
                                )}
                                title={node.isGodMode ? "Back to content" : "View JSON"}
                            >
                                <FileJson size={11} />
                            </button>
                        )}
                        <span className={cn(
                            "flex items-center gap-1.5 pl-1 font-semibold lowercase",
                            settings.theme === "light" ? "text-black/58" : "text-white/68",
                        )}>
                            <ShieldCheck size={10} />
                            {node.type}
                        </span>
                    </div>
                </div>
            )}

            <div className="relative flex-1 min-h-0 flex flex-col">
                <div
                    className={`relative z-10 flex-1 min-h-0 flex flex-col ${settings.compactMode ? "text-[0.96em]" : ""}`}
                    style={{ filter: `saturate(${textVibrancy})`, textShadow }}
                >
                    <SynthesisCard
                        flipped={Boolean(node.isGodMode)}
                        front={
                            <SynthesisCardNodeIdProvider nodeId={node.id} originalQuery={node.query || ""}>
                                <div className={cn(
                                    "w-full h-full min-h-0 overflow-y-auto overscroll-contain",
                                    isActive ? "select-text" : "select-none",
                                    "scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent hover:scrollbar-thumb-white/30",
                                    "transform-gpu translate-z-0", // Force layer and fix WebKit scroll bug
                                    settings.compactMode && "text-[0.97em]"
                                )} style={{
                                    WebkitOverflowScrolling: "touch",
                                    ...(settings.lazyLoad ? { contentVisibility: "auto", containIntrinsicSize: "auto 360px" } : {})
                                }}>
                                    {node.type === "widget" && node.widgetKind ? (
                                        <WidgetRenderer kind={node.widgetKind} nodeId={node.id} />
                                    ) : node.status === "synthesizing" && node.type !== "agent_task" && !node.content.summary && (!node.content.blocks || node.content.blocks.length === 0) ? (
                                        <ThinkingCard
                                            query={node.query}
                                            steps={node.content.logs || []}
                                        />
                                    ) : (
                                        <Suspense fallback={<CardSkeleton compact={settings.compactMode} isLight={settings.theme === "light"} />}>
                                            <HybridAgentCard
                                                task={task}
                                                blocks={node.content.blocks || []}
                                                title={node.title}
                                                summary={node.content.summary || ""}
                                                design={node.content.design}
                                                compact={settings.compactMode}
                                                themeCategory={settings.theme}
                                                streamingReasoning={node.content.streamingReasoning}
                                                streamingContent={node.content.streamingContent}
                                                reasoningTimeline={node.content.reasoningTimeline}
                                                a2uiState={node.content.a2uiState as import("@/lib/a2ui").A2UIState | null | undefined}
                                                onCancel={onCancelTask}
                                                onApprove={onApproveStep}
                                                onReject={onRejectStep}
                                                onAnswer={onAnswerStep}
                                                onContinueConversation={onContinueFromCard ? (msg) => onContinueFromCard(node.id, msg) : undefined}
                                                isActive={isActive}
                                                sources={node.content.sources || undefined}
                                                showSourceLinks={settings.sourceLinks}
                                            />
                                        </Suspense>
                                    )}
                                </div>
                            </SynthesisCardNodeIdProvider>
                        }
                        back={
                            <div className={cn(
                                "w-full h-full overflow-y-auto overscroll-contain transform-gpu translate-z-0",
                                isActive ? "select-text" : "select-none",
                                "scrollbar-thin scrollbar-thumb-emerald-500/20 scrollbar-track-transparent hover:scrollbar-thumb-emerald-500/30 bg-black/80 text-emerald-200 p-5"
                            )} style={{ WebkitOverflowScrolling: "touch" }}>
                                {/* Header with copy button */}
                                <div className="flex items-center justify-between mb-4">
                                    <p className="text-[10px] font-medium text-emerald-400/70">
                                        {node.type === "agent_task" ? "Agent trace" : "Internal trace"}
                                    </p>
                                    <button
                                        onClick={handleCopyJson}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[10px] text-emerald-300/80 hover:text-emerald-200 transition-all"
                                        title="Copy full JSON payload"
                                    >
                                        <AnimatePresence mode="wait" initial={false}>
                                            {copied ? (
                                                <motion.span key="check" initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                                                    <Check size={10} /> Copied
                                                </motion.span>
                                            ) : (
                                                <motion.span key="copy" initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="flex items-center gap-1">
                                                    <Copy size={10} /> Copy JSON
                                                </motion.span>
                                            )}
                                        </AnimatePresence>
                                    </button>
                                </div>

                                <p className="text-xs mb-4 text-emerald-200/70">
                                    <span className="text-emerald-400/50">Query:</span> {node.query}
                                </p>

                                {/* Streaming Reasoning */}
                                {node.content.streamingReasoning && (
                                    <div className="mb-4">
                                        <p className="text-[10px] font-medium text-emerald-400/50 mb-2 flex items-center gap-1.5">
                                            Live Reasoning
                                            {node.status === "synthesizing" && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            )}
                                        </p>
                                        <p className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed text-emerald-200/80">
                                            {node.content.streamingReasoning}
                                        </p>
                                    </div>
                                )}

                                {/* Agent task: show step timeline */}
                                {node.type === "agent_task" && task && task.steps.length > 0 ? (
                                    <div className="mb-4">
                                        <StepTimeline
                                            steps={task.steps}
                                            detailed={true}
                                        />
                                    </div>
                                ) : node.content.logs?.length ? (
                                    <div className="mb-4">
                                        <p className="text-[10px] font-medium text-emerald-400/50 mb-2">Logs</p>
                                        <div className="space-y-1">
                                            {node.content.logs?.map((line, i) => (
                                                <p key={i} className="text-[11px] font-mono text-emerald-200/60">
                                                    <span className="text-emerald-500/40 mr-2">{`>`}</span>
                                                    {line}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {settings.sourceLinks && node.content.sources?.length ? (
                                    <div className="mb-4">
                                        <p className="text-[10px] font-medium text-emerald-400/50 mb-2">Sources</p>
                                        <div className="space-y-1">
                                            {node.content.sources?.map((src, i) => (
                                                <p key={i} className="text-[11px] font-mono text-emerald-100/50 truncate">{src}</p>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}

                                {/* Raw JSON (collapsible for agent tasks) */}
                                <details className={node.type === "agent_task" ? "mt-4" : ""}>
                                    <summary className="text-[10px] font-medium text-emerald-400/50 cursor-pointer hover:text-emerald-400/70 transition-colors mb-2">
                                        Raw payload
                                    </summary>
                                    <pre
                                        data-god-payload
                                        className="text-[10px] leading-relaxed whitespace-pre-wrap break-words text-emerald-100/60 font-mono select-text cursor-text"
                                    >
                                        {JSON.stringify(node.content, null, 2)}
                                    </pre>
                                </details>
                            </div>
                        }
                    />
                </div>
            </div>
        </div>
    );

    return (
        <motion.div
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            animate={{
                rotateX: hoverRotate.x,
                rotateY: hoverRotate.y,
            }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="perspective-1000 h-full"
            style={
                {
                    "--accent-glow": `${design.accent_color}25`,
                    "--window-depth": String(normalizedDepth),
                } as React.CSSProperties
            }
        >
            {isFocusSurface ? (
                windowShell
            ) : (
                <GlassContainer
                    className={cn("h-full w-full", isLinkTarget && "ring-2 ring-blue-400/50 ring-offset-0")}
                    style={{
                        background: "linear-gradient(165deg, rgba(var(--synthesis-glass-rgb), 0.52) 0%, rgba(var(--synthesis-bg-secondary-rgb), 0.48) 100%)",
                        border: "1px solid rgba(var(--synthesis-glass-border-rgb), 0.24)",
                        boxShadow: `
                            inset 1px 1px 1px rgba(255, 255, 255, 0.2),
                            inset -1px -1px 1px rgba(0, 0, 0, 0.05),
                            0 10px 30px -10px rgba(0, 0, 0, 0.15),
                            0 30px 60px -15px rgba(0, 0, 0, 0.1)
                        `,
                    }}
                    borderRadius={24}
                    blur="6px"
                    saturation="150%"
                    brightness="90%"
                    showNoise={true}
                    showDynamicLight={true}
                    isFloating={true}
                >
                    {windowShell}
                </GlassContainer>
            )}
        </motion.div>
    );
}
