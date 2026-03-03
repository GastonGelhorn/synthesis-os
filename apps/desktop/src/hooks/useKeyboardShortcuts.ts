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
                    e.preventDefault();
                    handlers.onSwitchSpace(SPACES[0]);
                    break;

                case "2":
                    e.preventDefault();
                    handlers.onSwitchSpace(SPACES[1]);
                    break;

                case "3":
                    e.preventDefault();
                    handlers.onSwitchSpace(SPACES[2]);
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handlers]);
}
