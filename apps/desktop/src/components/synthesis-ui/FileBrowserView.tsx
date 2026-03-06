"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence, useMotionValue, useDragControls } from "framer-motion";
import {
    X,
    Minus,
    Maximize2,
    Minimize2,
    Folder,
    FileText,
    ChevronRight,
    HardDrive,
    RefreshCw,
    ArrowUp,
} from "lucide-react";
import { kernelInvoke } from "@/lib/apiClient";

interface StorageEntry {
    name: string;
    is_dir: boolean;
    size: number;
    modified: number;
    version?: number;
}

interface FileBrowserViewProps {
    isOpen: boolean;
    onClose: () => void;
}

const WINDOW_WIDTH = 720;
const WINDOW_HEIGHT = 480;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;

function formatBytes(bytes: number): string {
    if (bytes === 0) return "--";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
    if (!ts) return "--";
    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function FileBrowserView({ isOpen, onClose }: FileBrowserViewProps) {
    const [path, setPath] = useState("/");
    const [entries, setEntries] = useState<StorageEntry[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [isMaximized, setIsMaximized] = useState(false);
    const [windowSize, setWindowSize] = useState({ w: WINDOW_WIDTH, h: WINDOW_HEIGHT });
    const dragControls = useDragControls();
    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const loadList = useCallback(async (dirPath: string) => {
        setLoading(true);
        setError(null);
        setFileContent(null);
        setSelectedFile(null);
        try {
            const list = (await kernelInvoke<unknown[]>("list_storage", { path: dirPath })) as Array<{
                name?: string;
                is_dir?: boolean;
                size?: number;
                modified?: number;
                version?: number;
            }>;
            setEntries(
                Array.isArray(list)
                    ? list.map((e) => ({
                        name: e.name ?? "",
                        is_dir: e.is_dir ?? false,
                        size: e.size ?? 0,
                        modified: e.modified ?? 0,
                        version: e.version,
                    }))
                    : [],
            );
        } catch (e) {
            setError(String(e));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) void loadList(path);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, path]);

    const readFile = useCallback(async (fileName: string) => {
        setSelectedFile(fileName);
        setFileContent(null);
        try {
            const fullPath = path === "/" ? `/${fileName}` : `${path}/${fileName}`.replace(/\/+/g, "/");
            const text = (await kernelInvoke<string>("read_storage", { path: fullPath })) as string;
            setFileContent(text);
        } catch (e) {
            setFileContent(`Error reading file: ${e}`);
        }
    }, [path]);

    const navigateTo = useCallback((dirName: string) => {
        const next = path === "/" ? `/${dirName}` : `${path}/${dirName}`.replace(/\/+/g, "/");
        setPath(next);
    }, [path]);

    const navigateUp = useCallback(() => {
        if (path === "/") return;
        const parent = path.split("/").filter(Boolean).slice(0, -1).join("/") || "/";
        setPath(parent.startsWith("/") ? parent : `/${parent}`);
    }, [path]);

    const pathSegments = useMemo(() => {
        const parts = path.split("/").filter(Boolean);
        return [{ label: "Storage", path: "/" }, ...parts.map((p, i) => ({
            label: p,
            path: "/" + parts.slice(0, i + 1).join("/"),
        }))];
    }, [path]);

    const sortedEntries = useMemo(() => {
        const dirs = entries.filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name));
        const files = entries.filter((e) => !e.is_dir).sort((a, b) => a.name.localeCompare(b.name));
        return [...dirs, ...files];
    }, [entries]);

    const getDims = useCallback(() => {
        if (isMaximized) {
            const w = typeof window !== "undefined" ? Math.min(window.innerWidth - 48, 960) : WINDOW_WIDTH;
            const h = typeof window !== "undefined" ? Math.min(window.innerHeight - 48, 700) : WINDOW_HEIGHT;
            return { w, h };
        }
        return windowSize;
    }, [isMaximized, windowSize]);

    useEffect(() => {
        if (!isOpen) return;
        const { w, h } = getDims();
        const left = typeof window !== "undefined" ? (window.innerWidth - w) / 2 : 0;
        const top = typeof window !== "undefined" ? (window.innerHeight - h) / 2 : 0;
        x.set(left);
        y.set(top);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, isMaximized]);

    const handleDragEnd = useCallback(() => {
        const { w, h } = getDims();
        const maxX = typeof window !== "undefined" ? window.innerWidth - w : 0;
        const maxY = typeof window !== "undefined" ? window.innerHeight - h : 0;
        x.set(Math.max(0, Math.min(maxX, x.get())));
        y.set(Math.max(0, Math.min(maxY, y.get())));
    }, [getDims, x, y]);

    const width = isMaximized ? "min(96vw, 960px)" : windowSize.w;
    const height = isMaximized ? "min(88vh, 700px)" : windowSize.h;

    const handleResizeStart = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = windowSize.w;
        const startH = windowSize.h;
        const onMove = (ev: PointerEvent) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            setWindowSize({
                w: Math.max(MIN_WIDTH, Math.min(typeof window !== "undefined" ? window.innerWidth - 48 : 960, startW + dx)),
                h: Math.max(MIN_HEIGHT, Math.min(typeof window !== "undefined" ? window.innerHeight - 48 : 700, startH + dy)),
            });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [windowSize]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    drag
                    dragControls={dragControls}
                    dragListener={false}
                    dragMomentum={false}
                    onDragEnd={handleDragEnd}
                    style={{
                        position: "fixed",
                        left: 0,
                        top: 0,
                        x,
                        y,
                        width,
                        height,
                        maxWidth: "96vw",
                        maxHeight: "88vh",
                        zIndex: 2002,
                    }}
                    className="overflow-hidden flex flex-col border border-theme glass-system-panel rounded-xl"
                >
                    {/* Title bar */}
                    <div
                        className="px-4 py-2.5 flex items-center gap-2.5 border-b border-theme cursor-grab active:cursor-grabbing select-none shrink-0"
                        onPointerDown={(e) => {
                            if ((e.target as HTMLElement).closest("button")) return;
                            dragControls.start(e);
                        }}
                    >
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onClose(); }}
                                title="Close"
                                className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/90 flex items-center justify-center transition-colors shadow-sm"
                            >
                                <X size={8} strokeWidth={2.5} className="text-red-900/70" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onClose(); }}
                                title="Minimize"
                                className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/90 flex items-center justify-center transition-colors shadow-sm"
                            >
                                <Minus size={8} strokeWidth={2.5} className="text-amber-900/60" />
                            </button>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setIsMaximized((m) => !m); }}
                                title={isMaximized ? "Restore" : "Maximize"}
                                className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/90 flex items-center justify-center transition-colors shadow-sm"
                            >
                                {isMaximized
                                    ? <Minimize2 size={8} strokeWidth={2.5} className="text-green-900/70" />
                                    : <Maximize2 size={8} strokeWidth={2.5} className="text-green-900/70" />}
                            </button>
                        </div>
                        <div className="flex items-center gap-1.5 ml-2">
                            <HardDrive size={14} className="text-amber-400" />
                            <span className="text-[12px] font-medium text-theme">Storage</span>
                        </div>
                        <div className="flex-1" />
                        <button
                            type="button"
                            onClick={() => void loadList(path)}
                            title="Refresh"
                            className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
                        >
                            <RefreshCw size={12} className={`text-theme-muted ${loading ? "animate-spin" : ""}`} />
                        </button>
                    </div>

                    {/* Path bar */}
                    <div className="px-3 py-1.5 flex items-center gap-1 border-b border-theme bg-white/[0.02] shrink-0 overflow-x-auto">
                        {path !== "/" && (
                            <button
                                type="button"
                                onClick={navigateUp}
                                className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/5 shrink-0"
                            >
                                <ArrowUp size={12} className="text-theme-muted" />
                            </button>
                        )}
                        {pathSegments.map((seg, i) => (
                            <React.Fragment key={seg.path}>
                                {i > 0 && <ChevronRight size={10} className="text-theme-muted/50 shrink-0" />}
                                <button
                                    type="button"
                                    onClick={() => setPath(seg.path)}
                                    className={`text-[11px] px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors shrink-0 ${
                                        i === pathSegments.length - 1
                                            ? "text-theme font-medium"
                                            : "text-theme-muted"
                                    }`}
                                >
                                    {seg.label}
                                </button>
                            </React.Fragment>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 flex overflow-hidden">
                        {/* File list */}
                        <div className={`flex-1 flex flex-col overflow-hidden ${fileContent !== null ? "border-r border-theme" : ""}`}>
                            {/* Column headers */}
                            <div className="flex items-center px-3 py-1.5 border-b border-theme bg-white/[0.02] text-[10px] text-theme-muted uppercase tracking-wider font-medium shrink-0">
                                <span className="flex-1">Name</span>
                                <span className="w-20 text-right">Size</span>
                                <span className="w-36 text-right">Modified</span>
                            </div>

                            {/* Entries */}
                            <div className="flex-1 overflow-y-auto">
                                {error && (
                                    <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
                                )}
                                {!loading && sortedEntries.length === 0 && !error && (
                                    <div className="flex flex-col items-center justify-center h-full gap-3 text-theme-muted py-12">
                                        <HardDrive size={32} className="opacity-20" />
                                        <p className="text-[12px]">
                                            {path === "/" ? "Storage is empty" : "Folder is empty"}
                                        </p>
                                        <p className="text-[10px] opacity-60 max-w-[240px] text-center">
                                            {path === "/"
                                                ? "Agents create files here when using storage tools."
                                                : "No files in this directory."}
                                        </p>
                                    </div>
                                )}
                                {sortedEntries.map((entry) => (
                                    <button
                                        key={entry.name}
                                        type="button"
                                        onClick={() => entry.is_dir ? navigateTo(entry.name) : void readFile(entry.name)}
                                        className={`w-full flex items-center px-3 py-1.5 text-left hover:bg-white/[0.04] transition-colors group ${
                                            selectedFile === entry.name ? "bg-white/[0.06]" : ""
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            {entry.is_dir
                                                ? <Folder size={14} className="text-amber-400 shrink-0" />
                                                : <FileText size={14} className="text-theme-muted shrink-0" />}
                                            <span className="text-[12px] text-theme truncate">
                                                {entry.name}
                                            </span>
                                        </div>
                                        <span className="w-20 text-right text-[11px] text-theme-muted tabular-nums">
                                            {entry.is_dir ? "--" : formatBytes(entry.size)}
                                        </span>
                                        <span className="w-36 text-right text-[11px] text-theme-muted tabular-nums">
                                            {formatDate(entry.modified)}
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* Status bar */}
                            <div className="px-3 py-1 border-t border-theme bg-white/[0.02] flex items-center shrink-0">
                                <span className="text-[10px] text-theme-muted">
                                    {loading ? "Loading..." : `${sortedEntries.length} item${sortedEntries.length !== 1 ? "s" : ""}`}
                                </span>
                            </div>
                        </div>

                        {/* Preview pane */}
                        {fileContent !== null && (
                            <div className="w-[280px] shrink-0 flex flex-col overflow-hidden">
                                <div className="px-3 py-1.5 border-b border-theme bg-white/[0.02] flex items-center justify-between shrink-0">
                                    <span className="text-[11px] font-medium text-theme truncate">{selectedFile}</span>
                                    <button
                                        type="button"
                                        onClick={() => { setFileContent(null); setSelectedFile(null); }}
                                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/5"
                                    >
                                        <X size={10} className="text-theme-muted" />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-3">
                                    <pre className="text-[11px] text-theme font-mono whitespace-pre-wrap break-words leading-relaxed">
                                        {fileContent}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Resize handle */}
                    {!isMaximized && (
                        <div
                            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
                            onPointerDown={handleResizeStart}
                        >
                            <svg
                                viewBox="0 0 16 16"
                                className="w-full h-full text-theme-muted/30"
                            >
                                <path d="M14 16L16 14M10 16L16 10M6 16L16 6" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
