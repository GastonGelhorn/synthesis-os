"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AlertCircle, X, RotateCcw, Zap } from "lucide-react";

interface ToastProps {
    message: string;
    details?: string;
    onDismiss: () => void;
    onRetry?: () => void;
    duration?: number;
    variant?: "error" | "ephemeral";
}

const VARIANT_STYLES = {
    error: {
        border: "border-rose-400/20",
        icon: AlertCircle,
        iconColor: "text-rose-400",
        textColor: "text-rose-200",
        detailColor: "text-rose-200/50",
        retryBg: "bg-rose-400/15 hover:bg-rose-400/25 text-rose-300",
    },
    ephemeral: {
        border: "border-violet-400/20",
        icon: Zap,
        iconColor: "text-violet-400",
        textColor: "text-white",
        detailColor: "text-white/50",
        retryBg: "", // no retry for ephemeral
    },
};

export function Toast({
    message,
    details,
    onDismiss,
    onRetry,
    duration = 8000,
    variant = "error",
}: ToastProps) {
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    const effectiveDuration = variant === "ephemeral" ? (duration || 5000) : duration;

    useEffect(() => {
        const timer = setTimeout(() => onDismissRef.current(), effectiveDuration);
        return () => clearTimeout(timer);
    }, [effectiveDuration]);

    const style = VARIANT_STYLES[variant] || VARIANT_STYLES.error;
    const Icon = style.icon;

    return (
        <motion.div
            initial={{ opacity: 0, y: -20, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, x: 20, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="pointer-events-auto max-w-sm w-full"
        >
            <div className={`glass-elevated rounded-xl p-3.5 ${style.border}`}>
                <div className="flex items-start gap-3">
                    <div className="shrink-0 mt-0.5">
                        <Icon size={16} className={style.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${style.textColor}`}>{message}</p>
                        {details && (
                            <p className={`text-[11px] mt-1 font-mono truncate ${style.detailColor}`}>{details}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {onRetry && variant === "error" && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className={`p-1.5 rounded-lg transition-colors ${style.retryBg}`}
                                title="Retry"
                            >
                                <RotateCcw size={13} />
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 transition-colors"
                        >
                            <X size={13} />
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
