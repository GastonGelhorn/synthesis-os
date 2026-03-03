/**
 * Renders text with clickable URLs.
 * Supports: [title](url), bare https?:// URLs.
 */
import React from "react";

const LINK_STYLES_DARK = "text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-400/40 hover:decoration-blue-300/60 transition-colors";
const LINK_STYLES_LIGHT = "text-blue-600 hover:text-blue-700 underline underline-offset-2 decoration-blue-500/40 hover:decoration-blue-600/60 transition-colors";

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const MD_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

let linkIdCounter = 0;

export function parseTextWithLinks(text: string, isLight: boolean): React.ReactNode[] {
    if (!text?.trim()) return [];

    const linkStyle = isLight ? LINK_STYLES_LIGHT : LINK_STYLES_DARK;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    const re = new RegExp(MD_LINK_REGEX.source, "g");
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(...parseBareUrls(text.slice(lastIndex, match.index), linkStyle));
        }
        parts.push(
            <a
                key={`link-${++linkIdCounter}`}
                href={match[2]}
                target="_blank"
                rel="noopener noreferrer"
                className={linkStyle}
            >
                {match[1]}
            </a>
        );
        lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push(...parseBareUrls(text.slice(lastIndex), linkStyle));
    }

    return parts.length > 0 ? parts : [text];
}

function parseBareUrls(segment: string, linkStyle: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    const urlRe = new RegExp(URL_REGEX.source, "gi");
    let lastIdx = 0;
    let m;
    while ((m = urlRe.exec(segment)) !== null) {
        if (m.index > lastIdx) {
            out.push(segment.slice(lastIdx, m.index));
        }
        out.push(
            <a
                key={`link-${++linkIdCounter}`}
                href={m[0]}
                target="_blank"
                rel="noopener noreferrer"
                className={linkStyle}
            >
                {m[0]}
            </a>
        );
        lastIdx = urlRe.lastIndex;
    }
    if (lastIdx < segment.length) {
        out.push(segment.slice(lastIdx));
    }
    return out.length > 0 ? out : [segment];
}

/** True if text contains URLs (markdown or bare) that should be parsed */
export function hasLinkableUrls(text: string): boolean {
    return Boolean(
        text && (
            /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text) ||
            /https?:\/\/\S+/.test(text)
        )
    );
}
