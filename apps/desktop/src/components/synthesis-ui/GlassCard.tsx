"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
    children: ReactNode;
    className?: string;
    onClose?: () => void;
    variant?: "default" | "minimal" | "alert";
    title?: string;
    delay?: number;
}

export const GlassCard = ({
    children,
    className,
    onClose,
    variant = "default",
    title,
    delay = 0
}: GlassCardProps) => {
    return (
        <div
            className={className}
            style={{
                backdropFilter: "blur(20px) saturate(150%)",
                WebkitBackdropFilter: "blur(20px) saturate(150%)",
                background: "rgba(255, 255, 255, 0.05)",
                border: "0.5px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 16,
                boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
        >
            <motion.div
                initial={{ opacity: 0, y: 30, scale: 0.8, filter: "blur(20px)", skewX: 5 }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", skewX: 0 }}
                exit={{ opacity: 0, y: -20, scale: 0.95, filter: "blur(10px)" }}
                transition={{
                    duration: 0.6,
                    delay,
                    type: "spring",
                    stiffness: 260,
                    damping: 20
                }}
                className={cn(
                    "relative overflow-hidden group select-none transition-all duration-500",
                    variant === "alert" && "border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]"
                )}
            >
                {/* Border Sweep Effect */}
                <motion.div
                    className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent z-20 pointer-events-none"
                    initial={{ left: "-100%" }}
                    animate={{ left: "100%" }}
                    transition={{ duration: 2, delay: delay + 0.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 3 }}
                />

                {/* Ambient Glow/Gradient */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity duration-700" />

                {/* Header / Close Button */}
                {
                    (title || onClose) && (
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 relative z-10">
                            {title && (
                                <h3 className="text-[11px] font-semibold text-theme opacity-60 font-sans">
                                    {title}
                                </h3>
                            )}
                            {onClose && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onClose();
                                    }}
                                    className="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors ml-auto"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    )
                }

                {/* Content */}
                <div className="p-4 relative z-10 overflow-y-auto max-h-[inherit]">
                    {children}
                </div>
            </motion.div>
        </div>
    );
};
