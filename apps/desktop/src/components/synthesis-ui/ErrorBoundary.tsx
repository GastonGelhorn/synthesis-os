"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: React.ReactNode;
    /** Optional label shown in the error card (e.g. "NodeCard") */
    label?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

/**
 * Generic Error Boundary for Synthesis UI components.
 * Catches render errors in children and shows a glassmorphic error card
 * instead of crashing the entire application.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="rounded-xl border border-rose-500/20 glass-node p-4 flex flex-col items-center gap-3 min-h-[120px] justify-center">
                    <AlertTriangle size={20} className="text-rose-400" />
                    <p className="text-sm text-rose-200/80 text-center">
                        {this.props.label ? `${this.props.label} crashed` : "Something went wrong"}
                    </p>
                    <p className="text-[11px] text-white/30 font-mono text-center max-w-[280px] truncate">
                        {this.state.error?.message || "Unknown error"}
                    </p>
                    <button
                        type="button"
                        onClick={this.handleReset}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-xs transition-colors"
                        aria-label="Retry rendering this component"
                    >
                        <RotateCcw size={12} />
                        Retry
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
