"use client";

import React from "react";
import { SYNTHESIS_DEFAULT_WALLPAPER } from "@/lib/backgrounds";

interface BootScreenProps {
    message?: string;
}

export function BootScreen({ message = "Zero-Browser Interface" }: BootScreenProps) {
    return (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center pointer-events-auto"
            style={{
                backgroundColor: "#050505",
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}
        >
            <div className="relative w-full h-full flex items-center justify-center animate-boot-entry z-10">
                {/* 
                    LEFTSIDE: Logo & Spinner
                    Anchored to 55% right (shifts logical center to the left)
                */}
                <div className="absolute right-[55%] mr-4 flex items-center">
                    <div className="relative w-12 h-12 shrink-0">
                        <div
                            className="absolute inset-0 rounded-full blur-xl opacity-60"
                            style={{ background: "linear-gradient(135deg, #60a5fa, #818cf8)" }}
                        />
                        <div
                            className="relative w-12 h-12 rounded-full flex items-center justify-center border border-white/10"
                            style={{ background: "rgba(30,35,55,0.8)", backdropFilter: "blur(10px)" }}
                        >
                            <div className="synthesis-spinner" />
                        </div>
                    </div>
                </div>

                {/* 
                    RIGHTSIDE: System Name & Status
                    Anchored to 45% left (shifts logical center to the left)
                */}
                <div className="absolute left-[45%] ml-4 flex flex-col justify-center">
                    <h2 className="text-xl font-light tracking-[0.2em] text-white/90 m-0 whitespace-nowrap">
                        SYNTHESIS <span className="text-blue-400/80">OS</span>
                    </h2>
                    <div className="h-4 flex items-center overflow-visible">
                        <p className="text-[10px] tracking-[0.3em] text-white/30 uppercase m-0 whitespace-nowrap min-w-[200px]">
                            {message}
                        </p>
                    </div>
                </div>
            </div>
            <style>{`
                .synthesis-spinner {
                    width: 20px;
                    height: 20px;
                    border: 2px solid rgba(255,255,255,0.2);
                    border-top-color: #60a5fa;
                    border-radius: 50%;
                    animation: synthesis-spin 1s linear infinite;
                }
                .animate-boot-entry {
                    animation: boot-fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                @keyframes synthesis-spin { to { transform: rotate(360deg); } }
                @keyframes boot-fade-in {
                    from { opacity: 0; transform: scale(0.98); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
