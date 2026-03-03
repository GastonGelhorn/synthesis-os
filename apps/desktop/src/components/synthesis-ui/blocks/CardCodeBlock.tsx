"use client";

import React, { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, Code2, Image } from "lucide-react";

interface CardCodeBlockProps {
    code: string;
    language?: string;
    isLight?: boolean;
    className?: string;
}

/**
 * Sanitize SVG content for safe inline rendering.
 * Strips <script> tags and event handlers to prevent XSS.
 */
function sanitizeSvg(raw: string): string {
    return raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "");
}

/**
 * Detect if code content is SVG (by language hint or content inspection).
 */
function isSvgContent(code: string, language?: string): boolean {
    if (language?.toLowerCase() === "svg" || language?.toLowerCase() === "xml+svg") return true;
    const trimmed = code.trim();
    return trimmed.startsWith("<svg") && trimmed.includes("</svg>");
}

export const CardCodeBlock = React.memo(function CardCodeBlock({
    code,
    language,
    isLight = false,
    className,
}: CardCodeBlockProps) {
    const [copied, setCopied] = useState(false);
    const [showCode, setShowCode] = useState(false);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [code]);

    const isSvg = useMemo(() => isSvgContent(code, language), [code, language]);
    const sanitizedSvg = useMemo(() => (isSvg ? sanitizeSvg(code) : ""), [isSvg, code]);

    if (!code?.trim()) return null;

    // ── SVG: render inline with toggle to view source ──
    if (isSvg && !showCode) {
        return (
            <div
                className={cn(
                    "relative rounded-xl overflow-hidden border",
                    isLight
                        ? "border-slate-800/10 bg-slate-900/[0.04]"
                        : "border-white/[0.06] bg-white/[0.03]",
                    className,
                )}
            >
                {/* Header bar */}
                <div
                    className={cn(
                        "flex items-center justify-between px-3 py-1.5 border-b",
                        isLight
                            ? "border-slate-800/10 bg-slate-900/[0.03]"
                            : "border-white/[0.04] bg-white/[0.02]",
                    )}
                >
                    <span
                        className={cn(
                            "text-[10px] uppercase tracking-[0.15em] font-medium",
                            isLight ? "text-slate-400" : "text-white/25",
                        )}
                    >
                        svg
                    </span>

                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setShowCode(true)}
                            className={cn(
                                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors",
                                isLight
                                    ? "text-slate-500 hover:bg-slate-900/[0.06]"
                                    : "text-white/35 hover:bg-white/[0.06]",
                            )}
                        >
                            <Code2 size={10} />
                            Source
                        </button>
                        <button
                            onClick={handleCopy}
                            className={cn(
                                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors",
                                isLight
                                    ? "text-slate-500 hover:bg-slate-900/[0.06]"
                                    : "text-white/35 hover:bg-white/[0.06]",
                            )}
                        >
                            {copied ? <Check size={10} /> : <Copy size={10} />}
                            {copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>

                {/* Rendered SVG */}
                <div
                    className="flex items-center justify-center p-4 overflow-hidden [&>svg]:max-w-full [&>svg]:max-h-[400px] [&>svg]:w-auto [&>svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
                />
            </div>
        );
    }

    // ── Regular code (or SVG source view) ──
    return (
        <div
            className={cn(
                "relative rounded-xl overflow-hidden border",
                isLight
                    ? "border-slate-800/10 bg-slate-900/[0.04]"
                    : "border-white/[0.06] bg-white/[0.03]",
                className,
            )}
        >
            {/* Header bar */}
            <div
                className={cn(
                    "flex items-center justify-between px-3 py-1.5 border-b",
                    isLight
                        ? "border-slate-800/10 bg-slate-900/[0.03]"
                        : "border-white/[0.04] bg-white/[0.02]",
                )}
            >
                <span
                    className={cn(
                        "text-[10px] uppercase tracking-[0.15em] font-medium",
                        isLight ? "text-slate-400" : "text-white/25",
                    )}
                >
                    {language || "code"}
                </span>

                <div className="flex items-center gap-1.5">
                    {isSvg && showCode && (
                        <button
                            onClick={() => setShowCode(false)}
                            className={cn(
                                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors",
                                isLight
                                    ? "text-slate-500 hover:bg-slate-900/[0.06]"
                                    : "text-white/35 hover:bg-white/[0.06]",
                            )}
                        >
                            <Image size={10} />
                            Preview
                        </button>
                    )}
                    <button
                        onClick={handleCopy}
                        className={cn(
                            "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-colors",
                            isLight
                                ? "text-slate-500 hover:bg-slate-900/[0.06]"
                                : "text-white/35 hover:bg-white/[0.06]",
                        )}
                    >
                        {copied ? <Check size={10} /> : <Copy size={10} />}
                        {copied ? "Copied" : "Copy"}
                    </button>
                </div>
            </div>

            {/* Code content */}
            <pre
                className={cn(
                    "p-3 overflow-x-auto text-[13px] leading-[1.6] font-mono",
                    isLight ? "text-slate-800" : "text-white/80",
                )}
            >
                <code>{code}</code>
            </pre>
        </div>
    );
});
