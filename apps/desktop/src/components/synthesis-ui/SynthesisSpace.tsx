import { AnimatePresence, motion } from "framer-motion";
import { SynthesisNode } from "@/types/synthesis";
import { NodeContainer } from "./NodeContainer";
import { NodeCard } from "./NodeCard";
interface SynthesisSpaceProps {
    nodes: SynthesisNode[];
    activeNodeId: string | null;
    onActivate: (id: string) => void;
    onClose: (id: string) => void;
    onMinimize: (id: string) => void;
    onMove: (id: string, position: { x: number; y: number }) => void;
    onToggleGodMode: (id: string) => void;
    showInternalBackdrop?: boolean;
    renderNodes?: boolean;
}

export function SynthesisSpace({
    nodes,
    activeNodeId,
    onActivate,
    onClose,
    onMinimize,
    onMove,
    onToggleGodMode,
    showInternalBackdrop = true,
    renderNodes = true,
}: SynthesisSpaceProps) {
    const activeNodes = nodes.filter((node) => node.status !== "minimized");

    return (
        <div
            className={`fixed inset-0 z-20 w-full h-full overflow-hidden preserve-3d perspective-1000 ${renderNodes ? "pointer-events-auto" : "pointer-events-none"
                }`}
        >
            {showInternalBackdrop ? (
                <>
                    <div className="absolute inset-0 -z-50 bg-[radial-gradient(circle_at_20%_20%,rgba(71,138,255,0.22),transparent_35%),radial-gradient(circle_at_78%_76%,rgba(0,198,156,0.14),transparent_40%),linear-gradient(145deg,#02040f,#030916_45%,#020511_100%)]" />

                    <motion.div
                        className="absolute inset-0 -z-40 opacity-40"
                        animate={{ backgroundPosition: ["0% 0%", "100% 100%", "0% 0%"] }}
                        transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
                        style={{
                            backgroundImage:
                                "radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px), radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
                            backgroundSize: "120px 120px, 90px 90px",
                            backgroundPosition: "0 0, 60px 45px",
                        }}
                    />
                </>
            ) : null}

            {renderNodes ? (
                <AnimatePresence>
                    {activeNodes.map((node) => (
                        <NodeContainer
                            key={node.id}
                            node={node}
                            isActive={node.id === activeNodeId}
                            onActivate={onActivate}
                            onClose={onClose}
                            onMinimize={onMinimize}
                            onMove={onMove}
                            onToggleGodMode={onToggleGodMode}
                        >
                            <NodeCard
                                node={node}
                                isActive={node.id === activeNodeId}
                                onClose={() => onClose(node.id)}
                                onMinimize={() => onMinimize(node.id)}
                                onToggleGodMode={() => onToggleGodMode(node.id)}
                                chrome="none"
                            />
                        </NodeContainer>
                    ))}
                </AnimatePresence>
            ) : null}
        </div>
    );
}
