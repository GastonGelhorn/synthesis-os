import { useState, useEffect } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface AgentStatusEvent {
    process_id: string;
    state: "STARTING" | "THINKING" | "ACTING" | "COMPLETE" | "ERROR";
    details: string;
}

export function useSynthesisOsEvents() {
    const [activeAgents, setActiveAgents] = useState<Record<string, AgentStatusEvent>>({});
    const [latestEvent, setLatestEvent] = useState<AgentStatusEvent | null>(null);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;

        const setupListener = async () => {
            try {
                unlisten = await listen<AgentStatusEvent>("agent-status-update", (event) => {
                    const payload = event.payload;
                    setLatestEvent(payload);
                    setActiveAgents((prev) => ({
                        ...prev,
                        [payload.process_id]: payload,
                    }));
                });
                console.log("[SynthesisOS] Listening for agent-status-update events");
            } catch (err) {
                console.error("[SynthesisOS] Failed to setup agent event listener:", err);
            }
        };

        setupListener();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    return { activeAgents, latestEvent };
}
