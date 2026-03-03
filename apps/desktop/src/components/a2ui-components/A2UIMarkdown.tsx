"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { A2UIMarkdownProps } from "./types";
import ReactMarkdown from "react-markdown";

// Assuming we have react-markdown installed. If not, this is a placeholder. 
// A2UI uses this as a rich text fallback when atomic components aren't enough.

export const A2UIMarkdown = React.memo(function A2UIMarkdown({
    id,
    content,
    isLight = false,
}: A2UIMarkdownProps) {
    if (!content) return null;

    return (
        <div
            id={id}
            className={cn(
                "w-full prose prose-sm max-w-none prose-p:leading-[1.7] prose-p:text-[13px]",
                isLight
                    ? "prose-slate prose-headings:text-slate-800 prose-headings:font-bold prose-headings:tracking-tight prose-a:text-blue-600 prose-p:text-slate-700 prose-li:marker:text-slate-400"
                    : "prose-invert prose-slate prose-headings:text-white/95 prose-headings:font-bold prose-headings:tracking-tight prose-a:text-[#7BD4FF] prose-p:text-white/85 prose-li:text-white/85 prose-strong:text-white prose-li:marker:text-white/50"
            )}
        >
            <ReactMarkdown>{content}</ReactMarkdown>
        </div>
    );
});
