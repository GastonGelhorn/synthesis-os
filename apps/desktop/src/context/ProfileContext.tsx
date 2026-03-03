"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useSettings } from "@/context/SettingsContext";
import { hashPin } from "@/lib/pinHash";

const PROFILES_STORAGE_KEY = "synthesis-profiles";
const ACTIVE_PROFILE_KEY = "synthesis-active-profile";

export interface SynthesisProfile {
    id: string;
    displayName: string;
    createdAt: number;
    /** Stored hash (salt:hash) for PIN; if set, profile requires unlock */
    passwordHash?: string;
}

interface ProfileContextType {
    profiles: SynthesisProfile[];
    activeProfileId: string | null;
    setActiveProfile: (id: string | null) => void;
    createProfile: (displayName: string) => SynthesisProfile;
    deleteProfile: (id: string) => void;
    renameProfile: (id: string, displayName: string) => void;
    setProfilePin: (id: string, pin: string) => Promise<void>;
    clearProfilePin: (id: string) => void;
    /** Clear all profiles (for first-run onboarding). */
    clearAllProfilesForFirstRun: () => void;
    /** True when profile list has been loaded from storage */
    isHydrated: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

function loadProfiles(): SynthesisProfile[] {
    try {
        const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as SynthesisProfile[];
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch { /* ignore */ }
    return [];
}

function saveProfiles(profiles: SynthesisProfile[]): void {
    try {
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    } catch { /* ignore */ }
}

function loadActiveProfileId(): string | null {
    try {
        return localStorage.getItem(ACTIVE_PROFILE_KEY);
    } catch {
        return null;
    }
}

function saveActiveProfileId(id: string | null): void {
    try {
        if (id) {
            localStorage.setItem(ACTIVE_PROFILE_KEY, id);
        } else {
            localStorage.removeItem(ACTIVE_PROFILE_KEY);
        }
    } catch { /* ignore */ }
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
    const { settings } = useSettings();
    const [profiles, setProfiles] = useState<SynthesisProfile[]>([]);
    const [activeProfileId, setActiveProfileIdState] = useState<string | null>(null);
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        const loaded = loadProfiles();
        let effectiveProfiles = loaded;
        let activeId = loadActiveProfileId();

        if (effectiveProfiles.length === 0) {
            setIsHydrated(true);
            return;
        }

        setProfiles(effectiveProfiles);

        if (activeId && effectiveProfiles.some((p) => p.id === activeId)) {
            setActiveProfileIdState(activeId);
        } else {
            const first = effectiveProfiles[0].id;
            setActiveProfileIdState(first);
            saveActiveProfileId(first);
        }

        setIsHydrated(true);
    }, []);

    const setActiveProfile = useCallback((id: string | null) => {
        setActiveProfileIdState(id);
        saveActiveProfileId(id);
    }, []);

    const createProfile = useCallback((displayName: string): SynthesisProfile => {
        const profile: SynthesisProfile = {
            id: uuidv4(),
            displayName: displayName.trim() || "Usuario",
            createdAt: Date.now(),
        };
        setProfiles((prev) => {
            const next = [...prev, profile];
            saveProfiles(next);
            return next;
        });
        setActiveProfile(profile.id);
        return profile;
    }, [setActiveProfile]);

    const deleteProfile = useCallback((id: string) => {
        setProfiles((prev) => {
            const next = prev.filter((p) => p.id !== id);
            saveProfiles(next);
            if (activeProfileId === id && next.length > 0) {
                setActiveProfile(next[0].id);
            } else if (next.length === 0) {
                setActiveProfile(null);
            }
            return next;
        });
    }, [activeProfileId, setActiveProfile]);

    const renameProfile = useCallback((id: string, displayName: string) => {
        setProfiles((prev) => {
            const next = prev.map((p) =>
                p.id === id ? { ...p, displayName: displayName.trim() || p.displayName } : p
            );
            saveProfiles(next);
            return next;
        });
    }, []);

    const setProfilePin = useCallback(async (id: string, pin: string) => {
        const hash = await hashPin(pin);
        setProfiles((prev) => {
            const next = prev.map((p) =>
                p.id === id ? { ...p, passwordHash: hash } : p
            );
            saveProfiles(next);
            return next;
        });
    }, []);

    const clearProfilePin = useCallback((id: string) => {
        setProfiles((prev) => {
            const next = prev.map((p) =>
                p.id === id ? { ...p, passwordHash: undefined } : p
            );
            saveProfiles(next);
            return next;
        });
    }, []);

    const clearAllProfilesForFirstRun = useCallback(() => {
        setProfiles([]);
        setActiveProfileIdState(null);
        try {
            localStorage.removeItem(PROFILES_STORAGE_KEY);
            localStorage.removeItem(ACTIVE_PROFILE_KEY);
        } catch { /* ignore */ }
    }, []);

    const value = useMemo<ProfileContextType>(
        () => ({
            profiles,
            activeProfileId,
            setActiveProfile,
            createProfile,
            deleteProfile,
            renameProfile,
            setProfilePin,
            clearProfilePin,
            clearAllProfilesForFirstRun,
            isHydrated,
        }),
        [profiles, activeProfileId, setActiveProfile, createProfile, deleteProfile, renameProfile, setProfilePin, clearProfilePin, clearAllProfilesForFirstRun, isHydrated],
    );

    return (
        <ProfileContext.Provider value={value}>
            {children}
        </ProfileContext.Provider>
    );
}

export function useProfile(): ProfileContextType {
    const ctx = useContext(ProfileContext);
    if (!ctx) {
        throw new Error("useProfile must be used within ProfileProvider");
    }
    return ctx;
}
