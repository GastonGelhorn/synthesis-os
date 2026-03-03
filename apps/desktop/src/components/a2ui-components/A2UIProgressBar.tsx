"use client";

import React from "react";
import { cn, hexToRgba } from "@/lib/utils";
import { A2UIProgressBarProps } from "./types";

export const A2UIProgressBar = React.memo(function A2UIProgressBar({
    id,
    value,
    label,
    color,
    accentColor = "#7BD4FF",
    isLight = false,
}: A2UIProgressBarProps) {
    // Disabled as per user request to only keep the top sweeping progress bar
    return null;
});
