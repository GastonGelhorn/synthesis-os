"use client";

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";

type TextStyle = "h1" | "h2" | "body" | "caption" | "quote" | "none";

interface CardTextProps {
    content: string;
    style?: TextStyle;
    isLight?: boolean;
    className?: string;
}

const TEXT_STYLES_DARK: Record<TextStyle, string> = {
    h1: "text-xl leading-tight font-semibold tracking-tight text-theme",
    h2: "text-base font-semibold tracking-tight text-theme-secondary",
    body: "text-sm leading-[1.7] text-theme-muted",
    caption: "text-[10px] font-semibold text-theme-muted opacity-40",
    quote: "text-sm italic leading-[1.7] border-l-2 pl-4 text-theme-muted opacity-80 border-theme",
    none: "",
};

const TEXT_STYLES_LIGHT: Record<TextStyle, string> = {
    h1: "text-xl leading-tight font-semibold tracking-tight text-theme",
    h2: "text-base font-semibold tracking-tight text-theme-secondary",
    body: "text-sm leading-[1.7] text-theme-muted",
    caption: "text-[10px] font-semibold text-theme-muted opacity-50",
    quote: "text-sm italic leading-[1.7] border-l-2 pl-4 text-theme-muted opacity-80 border-theme",
    none: "",
};

const LINK_STYLES_DARK = "text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-400/40 hover:decoration-blue-300/60 transition-colors";
const LINK_STYLES_LIGHT = "text-blue-600 hover:text-blue-700 underline underline-offset-2 decoration-blue-500/40 hover:decoration-blue-600/60 transition-colors";

/** Parse text content with markdown links [title](url) and **bold** into React elements */
function parseInlineMarkdown(text: string, isLight: boolean): React.ReactNode[] {
    const linkStyle = isLight ? LINK_STYLES_LIGHT : LINK_STYLES_DARK;
    // Match markdown links [text](url) and bold **text**
    const parts = text.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*)/g);

    return parts.map((part, i) => {
        // Markdown link
        const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
        if (linkMatch) {
            return (
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
        }
        // Bold
        const boldMatch = part.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
            return <strong key={`bold-${i}`} className="font-semibold">{boldMatch[1]}</strong>;
        }
        return part;
    });
}

export const CardText = React.memo(function CardText({
    content,
    style = "body",
    isLight = false,
    className,
}: CardTextProps) {
    const styles = isLight ? TEXT_STYLES_LIGHT : TEXT_STYLES_DARK;

    // Check if content has markdown features that need parsing
    const hasMarkdown = Boolean(content && (content.includes("](http") || content.includes("**")));

    const rendered = useMemo(() => {
        if (!content?.trim()) return "";
        if (!hasMarkdown) return content;
        return parseInlineMarkdown(content, isLight);
    }, [content, isLight, hasMarkdown]);

    if (!content?.trim()) return null;

    return (
        <p className={cn(styles[style] || styles.body, className)}>
            {rendered}
        </p>
    );
});
