"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { apiGetSetupStatus, apiSetup, getResolvedApiBase, type SetupStatus } from "@/lib/apiClient";
import { FirstRunSetupStep1, FIRST_RUN_SETUP_SESSION_KEY } from "@/components/synthesis-ui/FirstRunSetupStep1";
import { SYNTHESIS_DEFAULT_WALLPAPER } from "@/lib/backgrounds";

const LOGIN_BG_STYLE: React.CSSProperties = {
    backgroundColor: "#050505",
};

export function LoginView() {
    const { login, loginWithSession, isLoading } = useAuth();
    const { clearAllProfilesForFirstRun } = useProfile();
    const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
    const [loadingStatus, setLoadingStatus] = useState(true);
    const [setupStatusError, setSetupStatusError] = useState<string>("");
    const [selectedUser, setSelectedUser] = useState<{ id: string; username: string; display_name: string } | null>(null);
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        apiGetSetupStatus()
            .then((s) => {
                setSetupStatusError("");
                setSetupStatus(s);
            })
            .catch((e) => {
                setSetupStatus(null);
                setSetupStatusError(e instanceof Error ? e.message : "Could not connect to the backend");
            })
            .finally(() => setLoadingStatus(false));
    }, []);

    const retrySetupStatus = () => {
        setLoadingStatus(true);
        setSetupStatusError("");
        apiGetSetupStatus()
            .then((s) => {
                setSetupStatusError("");
                setSetupStatus(s);
            })
            .catch((e) => {
                setSetupStatus(null);
                setSetupStatusError(e instanceof Error ? e.message : "Could not connect to the backend");
            })
            .finally(() => setLoadingStatus(false));
    };

    const handleSetupSubmit = async (username: string, pw: string, displayName: string) => {
        const { token, user } = await apiSetup(username, pw, displayName);
        clearAllProfilesForFirstRun();
        if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(FIRST_RUN_SETUP_SESSION_KEY, "account-done");
        }
        loginWithSession(token, user);
    };

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUser) return;
        setError("");
        setSubmitting(true);
        try {
            await login(selectedUser.username, password);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Invalid password");
        } finally {
            setSubmitting(false);
        }
    };

    const handleUserClick = (u: { id: string; username: string; display_name: string }) => {
        setSelectedUser(u);
        setPassword("");
        setError("");
    };

    const handleBack = () => {
        setSelectedUser(null);
        setPassword("");
        setError("");
    };

    if (isLoading || loadingStatus) {
        return (
            <div
                className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat"
                style={LOGIN_BG_STYLE}
            >
                <div className="absolute inset-0 bg-black/60" />
                <div className="relative text-white/60">Loading...</div>
            </div>
        );
    }

    if (setupStatusError) {
        const apiBase = getResolvedApiBase();
        const isHttps = apiBase.startsWith("https://");
        return (
            <div className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat" style={LOGIN_BG_STYLE}>
                <div className="absolute inset-0 bg-black/60" />
                <div className="relative w-full max-w-lg rounded-2xl bg-white/5 border border-white/10 p-8 shadow-xl backdrop-blur-xl m-4 text-white">
                    <h1 className="text-xl font-semibold mb-2 text-center">SynthesisOS</h1>
                    <p className="text-sm text-white/70 text-center mb-4">
                        Could not connect to the backend on the Mac.
                    </p>
                    <div className="text-xs text-white/40 bg-white/5 rounded-lg p-3 mb-4 space-y-1.5">
                        <div><span className="text-white/60">URL:</span> {apiBase || "(empty)"}</div>
                        <div><span className="text-white/60">Error:</span> {setupStatusError}</div>
                    </div>
                    <div className="text-xs text-white/50 mb-6 space-y-1">
                        <p>Check that:</p>
                        <p className="pl-3">1. SynthesisOS is open on the Mac.</p>
                        <p className="pl-3">2. You are on the same Wi-Fi network.</p>
                        {isHttps && (
                            <p className="pl-3">3. The HTTPS certificate is generated. If it still fails, try HTTP on port 3939.</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={retrySetupStatus}
                        className="w-full py-2.5 rounded-lg bg-[var(--synthesis-accent)] text-white font-medium hover:opacity-90 transition-opacity"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!setupStatus?.hasUsers) {
        return <FirstRunSetupStep1 onSubmit={handleSetupSubmit} />;
    }

    return (
        <div
            className="min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat"
            style={LOGIN_BG_STYLE}
        >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div className="relative w-full max-w-md rounded-2xl bg-white/5 border border-white/10 p-8 shadow-xl backdrop-blur-xl m-4">
                <h1 className="text-xl font-semibold text-white mb-6 text-center">SynthesisOS</h1>

                {selectedUser ? (
                    <form onSubmit={handleLoginSubmit} className="space-y-4">
                        <button
                            type="button"
                            onClick={handleBack}
                            className="text-sm text-white/60 hover:text-white mb-2"
                        >
                            Back
                        </button>
                        <div className="flex flex-col items-center gap-4 mb-6">
                            <div className="w-20 h-20 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center">
                                <span className="text-2xl font-semibold text-white">
                                    {(selectedUser.display_name || selectedUser.username)[0]?.toUpperCase() || "?"}
                                </span>
                            </div>
                            <span className="text-lg font-medium text-white">{selectedUser.display_name || selectedUser.username}</span>
                        </div>
                        <div>
                            <label className="block text-sm text-white/70 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--synthesis-accent)]"
                                placeholder=""
                                autoComplete="current-password"
                                autoFocus
                                required
                            />
                        </div>
                        {error && <div className="text-sm text-red-400">{error}</div>}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full py-2.5 rounded-lg bg-[var(--synthesis-accent)] text-white font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                            {submitting ? "Signing in..." : "Sign in"}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-6">
                        <p className="text-sm text-white/70 text-center">Select a user</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {setupStatus.users.map((u) => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => handleUserClick(u)}
                                    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all"
                                >
                                    <div className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                                        <span className="text-lg font-semibold text-white">
                                            {(u.display_name || u.username)[0]?.toUpperCase() || "?"}
                                        </span>
                                    </div>
                                    <span className="text-sm text-white truncate w-full text-center">
                                        {u.display_name || u.username}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
