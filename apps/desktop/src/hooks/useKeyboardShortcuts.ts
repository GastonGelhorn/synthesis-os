"use client";

import { useEffect } from "react";
import { SpaceId } from "@/types/synthesis";

const SPACES: SpaceId[] = ["work", "entertainment", "research"];

interface ShortcutHandlers {
    onFocusInput: () => void;
    onCloseActiveNode: () => void;
    onSwitchSpace: (spaceId: SpaceId) => void;
    onCloseSettings: () => void;
    onOpenSettings: () => void;
    onToggleGodMode: () => void;
    onMinimizeAll: () => void;
    onToggleFocusMode?: () => void;
    onExitFocusMode?: () => void;
    isFocusMode?: boolean;
    isSettingsOpen: boolean;
    settings?: import("@/types/settings").SynthesisSettings;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isMeta = e.metaKey || e.ctrlKey;

            // Escape -- close settings, or exit focus mode
            if (e.key === "Escape") {
                if (handlers.isSettingsOpen) {
                    e.preventDefault();
                    handlers.onCloseSettings();
                } else if (handlers.isFocusMode) {
                    e.preventDefault();
                    handlers.onExitFocusMode?.();
                }
                return;
            }

            if (!isMeta) return;

            switch (e.key.toLowerCase()) {
                case "k":
                    e.preventDefault();
                    handlers.onFocusInput();
                    break;

                case "w":
                    e.preventDefault();
                    handlers.onCloseActiveNode();
                    break;

                case "g":
                    e.preventDefault();
                    handlers.onToggleGodMode();
                    break;

                case ",":
                    e.preventDefault();
                    if (handlers.isSettingsOpen) {
                        handlers.onCloseSettings();
                    } else {
                        handlers.onOpenSettings();
                    }
                    break;

                case "m":
                    e.preventDefault();
                    handlers.onMinimizeAll();
                    break;


                case "f":
                    // Cmd+Shift+F for focus mode
                    if (e.shiftKey) {
                        e.preventDefault();
                        handlers.onToggleFocusMode?.();
                    }
                    break;

                case "1":
                case "2":
                case "3":
                case "4":
                case "5":
                case "6":
                case "7":
                case "8":
                case "9":
                    const index = parseInt(e.key) - 1;
                    if (handlers.settings?.spaces && handlers.settings.spaces[index]) {
                        e.preventDefault();
                        handlers.onSwitchSpace(handlers.settings.spaces[index].id);
                    }
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handlers]);
}
