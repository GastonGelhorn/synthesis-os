"use client";

import React from "react";
import { motion, useMotionValue, useMotionTemplate } from "framer-motion";
import { cn } from "@/lib/utils";

interface GlassContainerProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    borderRadius?: number;
    blur?: string;
    saturation?: string;
    brightness?: string;
    showNoise?: boolean;
    showDynamicLight?: boolean;
    isFloating?: boolean;
}

/**
 * GlassContainer: A reusable component providing the hyper-realistic "Apple-style" 
 * glass effect with dynamic lighting, physical texture, and optional visionOS-style floating.
 */
export function GlassContainer({
    children,
    className,
    style,
    borderRadius = 24,
    blur = "15px", // Tuned for a thinner default lens
    saturation = "180%",
    brightness = "90%",
    showNoise = true,
    showDynamicLight = true,
    isFloating = true,
}: GlassContainerProps) {
    const mouseX = useMotionValue(-1000);
    const mouseY = useMotionValue(-1000);

    function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
        if (!showDynamicLight) return;
        const { left, top } = currentTarget.getBoundingClientRect();
        mouseX.set(clientX - left);
        mouseY.set(clientY - top);
    }

    function handleMouseLeave() {
        if (!showDynamicLight) return;
        mouseX.set(-1000);
        mouseY.set(-1000);
    }

    return (
        <motion.div
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={cn("relative overflow-hidden", className)}
            style={{
                borderRadius: `${borderRadius}px`,

                // 1. Transparent Refraction
                backdropFilter: `blur(${blur}) saturate(${saturation}) brightness(${brightness})`,
                WebkitBackdropFilter: `blur(${blur}) saturate(${saturation}) brightness(${brightness})`,

                // 2. Translucent Material
                background: "linear-gradient(105deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.05) 100%)",

                // 3. Multi-layered Volumetric Shadows (Refinadas estilo VisionOS)
                boxShadow: isFloating
                    ? `
                        inset 1px 1px 1px rgba(255, 255, 255, 0.2),
                        inset -1px -1px 1px rgba(0, 0, 0, 0.05),
                        0 10px 30px -10px rgba(0, 0, 0, 0.15),
                        0 30px 60px -15px rgba(0, 0, 0, 0.1) 
                    ` /* Sombra dispersa, elegante y casi imperceptible */
                    : `
                        inset 1px 1px 1px rgba(255, 255, 255, 0.4),
                        inset -1px -1px 1px rgba(0, 0, 0, 0.05),
                        0 15px 35px -10px rgba(0, 0, 0, 0.2)
                    `, /* Sombra más pegada al fondo */
                ...style
            }}
        >
            {showDynamicLight && (
                <>
                    {/* Dynamic border light (CSS mask trick) */}
                    <motion.div
                        className="absolute inset-0 z-0 pointer-events-none"
                        style={{
                            borderRadius: `${borderRadius}px`,
                            padding: "1px",
                            background: useMotionTemplate`
                                radial-gradient(
                                    120px circle at ${mouseX}px ${mouseY}px,
                                    rgba(255, 255, 255, 0.55), 
                                    transparent 100%
                                )
                            `,
                            WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                            WebkitMaskComposite: "source-out",
                            maskComposite: "exclude",
                        }}
                    />

                    {/* Dynamic surface light */}
                    <motion.div
                        className="absolute inset-0 z-0 pointer-events-none"
                        style={{
                            borderRadius: `${borderRadius}px`,
                            background: useMotionTemplate`
                                radial-gradient(
                                    150px circle at ${mouseX}px ${mouseY}px,
                                    rgba(255, 255, 255, 0.06),
                                    transparent 100%
                                )
                            `,
                        }}
                    />
                </>
            )}

            {showNoise && (
                <div
                    className="absolute inset-0 pointer-events-none opacity-[0.03] mix-blend-overlay z-0"
                    style={{
                        borderRadius: `${borderRadius}px`,
                        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                    }}
                />
            )}

            <div className="relative z-10 w-full h-full">
                {children}
            </div>
        </motion.div>
    );
}