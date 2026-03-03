"use client";

import { useEffect, useState, useMemo } from "react";

const LOW_BATTERY_THRESHOLD = 0.1;

interface BatteryManager {
    level: number;
    charging: boolean;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

interface NetworkInformation {
    effectiveType?: string;
    downlink?: number;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
}

export type ConnectionHint = "online" | "offline" | "slow";

export interface BatteryState {
    level: number;
    charging: boolean;
}

export interface SystemStatusState {
    time: string;
    battery: BatteryState | null;
    online: boolean;
    connectionHint: ConnectionHint;
    networkLabel: string;
    batteryLabel: string | null;
    isCritical: boolean;
}

function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function getNetworkLabel(online: boolean, connectionHint: ConnectionHint): string {
    if (!online) return "Offline";
    if (connectionHint === "slow") return "Slow connection";
    return "Online";
}

function getBatteryLabel(battery: BatteryState | null): string | null {
    if (!battery) return null;
    if (battery.charging) return "Charging";
    if (battery.level <= LOW_BATTERY_THRESHOLD) return "Low battery";
    return `${Math.round(battery.level * 100)}% Power`;
}

export function useSystemStatus(): SystemStatusState {
    const [time, setTime] = useState(() => formatTime(new Date()));
    const [battery, setBattery] = useState<BatteryState | null>(null);
    const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
    const [connectionHint, setConnectionHint] = useState<ConnectionHint>("online");

    useEffect(() => {
        const tick = () => setTime(formatTime(new Date()));
        tick();
        const interval = setInterval(tick, 60_000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const nav = typeof navigator !== "undefined" ? navigator : null;
        const bat = (nav as Navigator & { getBattery?: () => Promise<BatteryManager> }).getBattery;
        if (typeof bat !== "function") return;

        let mounted = true;
        let batteryCleanup: (() => void) | undefined;
        bat()
            .then((b) => {
                if (!mounted) return;
                const update = () => {
                    setBattery({ level: b.level, charging: b.charging });
                };
                update();
                b.addEventListener("levelchange", update);
                b.addEventListener("chargingchange", update);
                batteryCleanup = () => {
                    b.removeEventListener("levelchange", update);
                    b.removeEventListener("chargingchange", update);
                };
            })
            .catch(() => {
                if (mounted) setBattery(null);
            });

        return () => {
            mounted = false;
            batteryCleanup?.();
        };
    }, []);

    useEffect(() => {
        const onOnline = () => setOnline(true);
        const onOffline = () => {
            setOnline(false);
            setConnectionHint("offline");
        };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    useEffect(() => {
        const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
        if (!conn) return;

        const update = () => {
            if (!navigator.onLine) {
                setConnectionHint("offline");
                return;
            }
            const effectiveType = conn.effectiveType;
            const downlink = conn.downlink ?? 0;
            if (effectiveType === "slow-2g" || effectiveType === "2g" || downlink < 0.5) {
                setConnectionHint("slow");
            } else {
                setConnectionHint("online");
            }
        };
        update();
        conn.addEventListener("change", update);
        return () => conn.removeEventListener("change", update);
    }, []);

    const networkLabel = useMemo(() => getNetworkLabel(online, connectionHint), [online, connectionHint]);
    const batteryLabel = useMemo(() => getBatteryLabel(battery), [battery]);
    const isCritical = useMemo(() => {
        if (!online) return true;
        if (battery && battery.level <= LOW_BATTERY_THRESHOLD && !battery.charging) return true;
        return false;
    }, [online, battery]);

    return {
        time,
        battery,
        online,
        connectionHint,
        networkLabel,
        batteryLabel,
        isCritical,
    };
}
