"use client";

import { cn } from "@/lib/utils";

interface SynthesisCardProps {
    front: React.ReactNode;
    back: React.ReactNode;
    flipped?: boolean;
    className?: string;
}

/**
 * 3D-flippable card using pure CSS transforms.
 *
 * Why NOT Framer Motion here: FM applies `transform` via inline styles which
 * conflicts with `transform-style: preserve-3d` on WebKit (Tauri's WebView).
 * The children lose their 3D context and `backface-visibility: hidden` stops
 * working — resulting in a blank white flip.
 *
 * This version uses a CSS transition on `transform` directly, which preserves
 * the 3D hierarchy correctly in all WebKit builds.
 */
export function SynthesisCard({ front, back, flipped = false, className }: SynthesisCardProps) {
    return (
        <div
            className={cn("relative w-full flex-1 min-h-0 flex flex-col", className)}
            style={{ perspective: "1200px" }}
        >
            <div
                className="w-full flex-1 min-h-0 relative flex flex-col"
                style={{
                    transformStyle: "preserve-3d",
                    transition: "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
                    transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
            >
                {/* Front Side */}
                <div
                    className="absolute inset-0 w-full h-full flex flex-col"
                    style={{
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                        zIndex: flipped ? 0 : 1,
                    }}
                >
                    {front}
                </div>

                {/* Back Side */}
                <div
                    className="absolute inset-0 w-full h-full flex flex-col"
                    style={{
                        backfaceVisibility: "hidden",
                        WebkitBackfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        zIndex: flipped ? 1 : 0,
                    }}
                >
                    {back}
                </div>
            </div>
        </div>
    );
}
