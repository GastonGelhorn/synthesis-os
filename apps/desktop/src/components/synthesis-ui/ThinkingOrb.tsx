"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface ThinkingOrbProps {
    phase: "thinking" | "ready" | "listening" | "replying";
    color?: string;
    size?: number;
    className?: string;
}

export function ThinkingOrb({ phase, color = "#a78bfa", size = 24, className }: ThinkingOrbProps) {
    if (phase === "ready") {
        return (
            <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute inset-0 rounded-full opacity-20"
                    style={{ backgroundColor: color }}
                />
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="w-full h-full rounded-full border-2 border-current flex items-center justify-center"
                    style={{ borderColor: color }}
                >
                    <div className="w-[40%] h-[40%] rounded-full opacity-80" style={{ backgroundColor: color }} />
                </motion.div>
            </div>
        );
    }

    if (phase === "listening") {
        return (
            <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
                <motion.div
                    className="absolute inset-0 rounded-full opacity-20"
                    style={{ backgroundColor: color }}
                    animate={{
                        scale: [1, 1.4, 1],
                        opacity: [0.1, 0.3, 0.1],
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
                <motion.div
                    className="w-[60%] h-[60%] rounded-full opacity-60"
                    style={{ backgroundColor: color }}
                    animate={{
                        scale: [1, 0.8, 1],
                    }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
            </div>
        );
    }

    if (phase === "replying") {
        return (
            <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
                <motion.div
                    className="absolute inset-0 rounded-full border border-dashed opacity-50"
                    style={{ borderColor: color }}
                    animate={{
                        rotate: 360,
                    }}
                    transition={{
                        duration: 1,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                />
                <motion.div
                    className="w-[30%] h-[30%] rounded-full"
                    style={{ backgroundColor: color }}
                    animate={{
                        scale: [1, 1.5, 1],
                        opacity: [1, 0.5, 1],
                    }}
                    transition={{
                        duration: 0.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
            </div>
        );
    }

    return (
        <div className={cn("relative flex items-center justify-center", className)} style={{ width: size, height: size }}>
            {/* Core */}
            <motion.div
                className="absolute w-[40%] h-[40%] rounded-full blur-[2px]"
                style={{ backgroundColor: color }}
                animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.8, 1, 0.8],
                }}
                transition={{
                    duration: 2,
                    ease: "easeInOut",
                    repeat: Infinity,
                }}
            />

            {/* Inner Ring */}
            <motion.div
                className="absolute inset-0 rounded-full border opacity-40"
                style={{ borderColor: color }}
                animate={{
                    rotate: 360,
                    scale: [1, 0.9, 1],
                }}
                transition={{
                    rotate: { duration: 8, ease: "linear", repeat: Infinity },
                    scale: { duration: 3, ease: "easeInOut", repeat: Infinity },
                }}
            />

            {/* Outer Organic Shape */}
            <motion.div
                className="absolute -inset-[20%] opacity-20 mix-blend-screen"
                style={{
                    background: `radial-gradient(circle at center, ${color}, transparent 70%)`,
                    borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%",
                }}
                animate={{
                    rotate: [0, 360],
                    borderRadius: [
                        "40% 60% 70% 30% / 40% 50% 60% 50%",
                        "60% 40% 30% 70% / 60% 50% 40% 50%",
                        "40% 60% 70% 30% / 40% 50% 60% 50%",
                    ],
                }}
                transition={{
                    duration: 4,
                    ease: "linear",
                    repeat: Infinity,
                }}
            />

            {/* Particles/Satellite */}
            <motion.div
                className="absolute w-1 h-1 rounded-full"
                style={{ backgroundColor: color, top: 0, transformOrigin: `center ${size / 2 + 4}px` }}
                animate={{ rotate: 360 }}
                transition={{ duration: 3, ease: "linear", repeat: Infinity }}
            />
        </div>
    );
}
