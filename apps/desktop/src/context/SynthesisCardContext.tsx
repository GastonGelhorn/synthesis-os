"use client";

import React, { createContext, useContext } from "react";

interface SynthesisCardContextValue {
    nodeId: string;
    originalQuery: string;
}

const SynthesisCardContext = createContext<SynthesisCardContextValue | null>(null);

/** Provides card identity and original query so intent clicks preserve context. */
export function SynthesisCardNodeIdProvider({
    nodeId,
    originalQuery,
    children,
}: {
    nodeId: string;
    originalQuery: string;
    children: React.ReactNode;
}) {
    const value: SynthesisCardContextValue = { nodeId, originalQuery };
    return (
        <SynthesisCardContext.Provider value={value}>
            {children}
        </SynthesisCardContext.Provider>
    );
}

export function useSynthesisCardNodeId(): string | null {
    const ctx = useContext(SynthesisCardContext);
    return ctx?.nodeId ?? null;
}

export function useSynthesisCardContext(): SynthesisCardContextValue | null {
    return useContext(SynthesisCardContext);
}
