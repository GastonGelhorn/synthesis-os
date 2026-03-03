"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

interface CanvasPoint {
    label: string;
    value: number;
    color?: string;
}

interface CardCanvasProps {
    points: CanvasPoint[];
    title?: string;
    canvasType?: "bar" | "line";
    accentColor?: string;
    isLight?: boolean;
    className?: string;
}

export const CardCanvas = React.memo(function CardCanvas({
    points,
    title,
    canvasType = "bar",
    accentColor = "#7BD4FF",
    isLight = false,
    className,
}: CardCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const normalized = useMemo(() => {
        const safe = points
            .filter((p) => Number.isFinite(p.value))
            .slice(0, 12);
        return safe;
    }, [points]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || normalized.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth || 560;
        const cssHeight = 180;
        canvas.width = Math.floor(cssWidth * dpr);
        canvas.height = Math.floor(cssHeight * dpr);

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const fg = isLight ? "rgba(15,23,42,0.80)" : "rgba(255,255,255,0.82)";
        const muted = isLight ? "rgba(15,23,42,0.14)" : "rgba(255,255,255,0.14)";
        const grid = isLight ? "rgba(15,23,42,0.08)" : "rgba(255,255,255,0.08)";

        const w = cssWidth;
        const h = cssHeight;
        const padL = 28;
        const padR = 10;
        const padT = 12;
        const padB = 24;
        const plotW = Math.max(10, w - padL - padR);
        const plotH = Math.max(10, h - padT - padB);

        const values = normalized.map((p) => p.value);
        const minVal = Math.min(0, ...values);
        const maxVal = Math.max(...values, 1);
        const span = Math.max(1, maxVal - minVal);

        const yFor = (v: number) => padT + (maxVal - v) / span * plotH;

        ctx.clearRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padT + (plotH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(padL, y);
            ctx.lineTo(w - padR, y);
            ctx.stroke();
        }

        // Axis baseline
        ctx.strokeStyle = muted;
        ctx.beginPath();
        ctx.moveTo(padL, padT + plotH);
        ctx.lineTo(w - padR, padT + plotH);
        ctx.stroke();

        if (canvasType === "line") {
            const stepX = normalized.length > 1 ? plotW / (normalized.length - 1) : plotW;
            const pathPoints = normalized.map((p, i) => ({
                x: padL + stepX * i,
                y: yFor(p.value),
                color: p.color || accentColor,
            }));

            ctx.lineWidth = 2;
            ctx.strokeStyle = accentColor;
            ctx.beginPath();
            pathPoints.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.stroke();

            pathPoints.forEach((p) => {
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fill();
            });
        } else {
            const gap = 6;
            const barW = Math.max(6, (plotW - gap * (normalized.length - 1)) / Math.max(1, normalized.length));
            normalized.forEach((p, i) => {
                const x = padL + i * (barW + gap);
                const y = yFor(p.value);
                const barH = padT + plotH - y;
                const radius = 4;

                ctx.fillStyle = p.color || accentColor;
                roundRect(ctx, x, y, barW, Math.max(1, barH), radius);
                ctx.fill();
            });
        }

        // X labels (sample every N labels when crowded)
        const labelStep = Math.max(1, Math.ceil(normalized.length / 6));
        ctx.fillStyle = fg;
        ctx.font = "10px ui-sans-serif, system-ui, -apple-system";
        ctx.textAlign = "center";
        normalized.forEach((p, i) => {
            if (i % labelStep !== 0 && i !== normalized.length - 1) return;
            const x = canvasType === "line"
                ? (normalized.length > 1 ? padL + (plotW / (normalized.length - 1)) * i : padL + plotW / 2)
                : padL + (plotW / Math.max(1, normalized.length)) * i + (plotW / Math.max(1, normalized.length)) / 2;
            ctx.fillText(p.label.slice(0, 10), x, h - 8);
        });
    }, [normalized, canvasType, accentColor, isLight]);

    if (normalized.length === 0) return null;

    return (
        <div
            className={cn(
                "rounded-xl border p-3",
                isLight ? "border-slate-800/10 bg-slate-900/[0.02]" : "border-white/[0.06] bg-white/[0.02]",
                className,
            )}
        >
            {title ? (
                <p className={cn("text-[11px] mb-2 font-semibold", isLight ? "text-slate-700" : "text-white/80")}>
                    {title}
                </p>
            ) : null}
            <canvas ref={canvasRef} className="w-full h-[180px] block rounded-lg" />
        </div>
    );
});

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}
