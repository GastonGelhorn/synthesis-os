"use client";

import { WidgetKind } from "@/types/synthesis";
import { ClockWidget } from "./ClockWidget";
import { CalculatorWidget } from "./CalculatorWidget";
import { NotesWidget } from "./NotesWidget";
import { TimerWidget } from "./TimerWidget";
import { WeatherWidget } from "./WeatherWidget";

interface WidgetRendererProps {
    kind: WidgetKind;
    nodeId: string;
}

export function WidgetRenderer({ kind, nodeId }: WidgetRendererProps) {
    switch (kind) {
        case "clock":
            return <ClockWidget />;
        case "calculator":
            return <CalculatorWidget />;
        case "notes":
            return <NotesWidget nodeId={nodeId} />;
        case "timer":
            return <TimerWidget />;
        case "weather":
            return <WeatherWidget />;
        default:
            return null;
    }
}

export const WIDGET_DEFINITIONS: Array<{
    kind: WidgetKind;
    label: string;
    icon: string;
    width: number;
    height: number;
}> = [
    { kind: "clock", label: "Clock", icon: "Clock", width: 280, height: 240 },
    { kind: "calculator", label: "Calculator", icon: "Calculator", width: 260, height: 380 },
    { kind: "notes", label: "Notes", icon: "FileEdit", width: 320, height: 340 },
    { kind: "timer", label: "Timer", icon: "Timer", width: 280, height: 320 },
    { kind: "weather", label: "Weather", icon: "CloudSun", width: 300, height: 280 },
];
