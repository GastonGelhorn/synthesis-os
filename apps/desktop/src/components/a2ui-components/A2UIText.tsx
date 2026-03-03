"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import { A2UITextProps } from "./types";

const TEXT_STYLES_DARK: Record<string, string> = {
    h1: "text-[22px] font-bold tracking-tight text-white/95 bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70 mb-3",
    h2: "text-[17px] font-semibold tracking-tight text-white/95 mb-1.5 mt-2",
    h3: "text-base font-medium tracking-tight text-white/90 mt-1",
    body: "text-[13px] leading-[1.7] text-white/85",
    caption: "text-[10px] font-medium text-white/50",
    quote: "text-[13px] italic leading-[1.7] border-l-[3px] pl-4 text-white/70 border-white/20 bg-white/[0.02] py-1 rounded-r-md",
    mono: "text-[12px] font-mono text-white/80",
    none: "",
};

const TEXT_STYLES_LIGHT: Record<string, string> = {
    h1: "text-[22px] font-bold tracking-tight text-slate-800 bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 mb-3",
    h2: "text-[17px] font-semibold tracking-tight text-slate-800 mb-1.5 mt-2",
    h3: "text-base font-medium tracking-tight text-slate-700 mt-1",
    body: "text-[13px] leading-[1.7] text-slate-700",
    caption: "text-[10px] font-medium text-slate-500",
    quote: "text-[13px] italic leading-[1.7] border-l-[3px] pl-4 text-slate-600 border-slate-300 bg-slate-50 py-1 rounded-r-md",
    mono: "text-[12px] font-mono text-slate-600",
    none: "",
};

const LINK_STYLES_DARK = "text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-400/40 hover:decoration-blue-300/60 transition-colors";
const LINK_STYLES_LIGHT = "text-blue-600 hover:text-blue-700 underline underline-offset-2 decoration-blue-500/40 hover:decoration-blue-600/60 transition-colors";

import { parseTextWithLinks, hasLinkableUrls } from "@/lib/textWithLinks";

/** Parse text content with markdown links [title](url), **bold**, and bare URLs into React elements */
function parseInlineMarkdown(text: string, isLight: boolean): React.ReactNode {
    const linkStyle = isLight ? LINK_STYLES_LIGHT : LINK_STYLES_DARK;
    const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*)/g);

    const result: React.ReactNode[] = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (linkMatch) {
            result.push(
                <a
                    key={`link-${i}`}
                    href={linkMatch[2]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkStyle}
                >
                    {linkMatch[1]}
                </a>
            );
        } else {
            const boldMatch = part.match(/^\*\*(.+)\*\*$/);
            if (boldMatch) {
                result.push(<strong key={`bold-${i}`} className="font-semibold">{boldMatch[1]}</strong>);
            } else if (hasLinkableUrls(part)) {
                result.push(...parseTextWithLinks(part, isLight));
            } else {
                result.push(part);
            }
        }
    }
    return result;
}

export const A2UIText = React.memo(function A2UIText({
    id,
    content,
    style = "body",
    isLight = false,
}: A2UITextProps) {
    const styles = isLight ? TEXT_STYLES_LIGHT : TEXT_STYLES_DARK;
    const hasMarkdown = Boolean(content && (content.includes("](http") || content.includes("**") || hasLinkableUrls(content)));

    const rendered = useMemo(() => {
        if (!content?.trim()) return "";
        if (!hasMarkdown) return content;
        return parseInlineMarkdown(content, isLight);
    }, [content, isLight, hasMarkdown]);

    if (!content?.trim()) return null;

    return (
        <p id={id} className={cn(styles[style] || styles.body)}>
            {rendered}
        </p>
    );
});
