"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { hexToRgba } from "@/lib/utils";

interface ProgressItem {
    label: string;
    value: number; // 0-100
    color?: string;
}

interface CardProgressBarProps {
    items: ProgressItem[];
    accentColor?: string;
    isLight?: boolean;
    className?: string;
}

export const CardProgressBar = React.memo(function CardProgressBar({
    items,
    accentColor = "#7BD4FF",
    isLight = false,
    className,
}: CardProgressBarProps) {
    // Disabled as per user request to only keep the top sweeping progress bar
    return null;
});
