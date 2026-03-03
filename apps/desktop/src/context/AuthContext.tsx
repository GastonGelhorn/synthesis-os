"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiLogin, apiListUsers, apiMe, setTokenGetter, setImpersonateGetter, type ApiUser } from "@/lib/apiClient";

const TOKEN_KEY = "synthesis-auth-token";

interface AuthContextType {
    token: string | null;
    user: ApiUser | null;
    impersonating: ApiUser | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (username: string, password: string) => Promise<void>;
    loginWithSession: (token: string, user: ApiUser) => void;
    logout: () => void;
    impersonate: (user: ApiUser | null) => void;
    refreshUser: () => Promise<void>;
    listUsers: () => Promise<ApiUser[]>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [token, setToken] = useState<string | null>(() => {
        if (typeof window === "undefined") return null;
        return localStorage.getItem(TOKEN_KEY);
    });
    const [user, setUser] = useState<ApiUser | null>(null);
    const [impersonating, setImpersonatingState] = useState<ApiUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setTokenGetter(() => token);
    }, [token]);

    useEffect(() => {
        setImpersonateGetter(() => (impersonating ? impersonating.id : null));
    }, [impersonating]);

    const refreshUser = useCallback(async () => {
        if (!token) {
            setUser(null);
            setIsLoading(false);
            return;
        }
        try {
            const u = await apiMe();
            setUser(u);
        } catch {
            setToken(null);
            localStorage.removeItem(TOKEN_KEY);
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    }, [token]);

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    const login = useCallback(async (username: string, password: string) => {
        const { token: t, user: u } = await apiLogin(username, password);
        setToken(t);
        localStorage.setItem(TOKEN_KEY, t);
        setUser(u);
        setImpersonatingState(null);
    }, []);

    const loginWithSession = useCallback((t: string, u: ApiUser) => {
        setToken(t);
        localStorage.setItem(TOKEN_KEY, t);
        setUser(u);
        setImpersonatingState(null);
    }, []);

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
        setImpersonatingState(null);
        localStorage.removeItem(TOKEN_KEY);
    }, []);

    const impersonate = useCallback((u: ApiUser | null) => {
        setImpersonatingState(u);
    }, []);

    const listUsers = useCallback(async () => {
        try {
            return await apiListUsers();
        } catch {
            return [];
        }
    }, []);

    const value: AuthContextType = {
        token,
        user,
        impersonating,
        isLoading,
        isAuthenticated: !!user,
        login,
        loginWithSession,
        logout,
        impersonate,
        refreshUser,
        listUsers,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
