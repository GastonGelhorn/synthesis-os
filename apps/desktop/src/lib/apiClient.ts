/**
 * apiClient — abstract backend access.
 * In Tauri: uses invoke() directly.
 * In web: uses fetch to HTTP API with JWT.
 */

import { isTauri } from "./tauriBridge";

/**
 * Resolves the API base URL for HTTP requests (auth, sync-state, kernel invoke).
 *
 * - Tauri (desktop app): always http://localhost:3939 (talks to the local kernel,
 *   ignoring VITE_API_BASE so the desktop app never routes to the Mac's LAN IP).
 *
 * - Vite dev server (npm run dev, port ≠ 3939/3940): the page lives on a
 *   different port than the API → needs VITE_API_BASE to reach the backend.
 *
 * - Production browser (iPad / any remote device): the page is served by the
 *   SAME Axum server that hosts the API (port 3939 or 3940). Using
 *   window.location.origin guarantees same-origin requests → no CORS issues
 *   and no dependency on VITE_API_BASE being correct.
 */
function getApiBase(): string {
    if (typeof window !== "undefined" && isTauri()) {
        return "http://localhost:3939";
    }
    // During Vite development the page lives on a different port (5173, etc.)
    // than the backend, so we need the explicit VITE_API_BASE.
    if (import.meta.env?.DEV && import.meta.env?.VITE_API_BASE) {
        return String(import.meta.env.VITE_API_BASE);
    }
    // Production: page is served by Axum → same origin = API origin. Always works.
    if (typeof window !== "undefined") {
        return window.location.origin;
    }
    return "";
}

/**
 * Compute the HTTP fallback URL from an HTTPS base.
 * https://192.168.1.29:3940 → http://192.168.1.29:3939
 */
function httpFallbackBase(base: string): string | null {
    if (!base.startsWith("https://")) return null;
    return base.replace(/^https:/, "http:").replace(/:3940\b/, ":3939");
}

let API_BASE = getApiBase();

/** Expose the resolved base so error screens can show it. */
export function getResolvedApiBase(): string {
    return API_BASE;
}

/** Switch API_BASE to HTTP fallback (called when HTTPS fails on remote devices). */
export function switchToHttpFallback(): boolean {
    const fb = httpFallbackBase(API_BASE);
    if (fb) {
        API_BASE = fb;
        return true;
    }
    return false;
}

export type ApiUser = {
    id: string;
    username: string;
    role: "super_admin" | "admin" | "guest";
    display_name: string;
};

export interface ApiAuthState {
    token: string | null;
    user: ApiUser | null;
    impersonating: ApiUser | null;
}

/** Get token for HTTP requests (from AuthContext or storage). */
let _getToken: (() => string | null) | null = null;
export function setTokenGetter(fn: () => string | null) {
    _getToken = fn;
}
const TOKEN_STORAGE_KEY = "synthesis-auth-token";
function getAuthToken(): string | null {
    const token = _getToken?.();
    if (token) return token;
    if (typeof window === "undefined") return null;
    try {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Get impersonate header value (user id to act as). */
let _getImpersonate: (() => string | null) | null = null;
export function setImpersonateGetter(fn: () => string | null) {
    _getImpersonate = fn;
}

/**
 * Invoke a kernel command. In Tauri uses invoke(); in web uses POST /api/kernel/invoke.
 */
export async function kernelInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<T>(cmd, args);
    }
    const token = getAuthToken();
    if (!token) {
        throw new Error("Not authenticated. Please log in.");
    }
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
    const imp = _getImpersonate?.();
    if (imp) headers["X-Impersonate-User"] = imp;

    const res = await fetch(`${API_BASE}/api/kernel/invoke`, {
        method: "POST",
        headers,
        body: JSON.stringify({ cmd, args: args ?? {} }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
        throw new Error(responseErrorMessage(data) ?? `HTTP ${res.status}`);
    }
    return data as unknown as T;
}

export type SetupStatus = {
    hasUsers: boolean;
    users: Array<{ id: string; username: string; display_name: string }>;
};

function asObject(value: unknown): Record<string, unknown> | null {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function responseErrorMessage(data: unknown): string | null {
    const obj = asObject(data);
    return typeof obj?.error === "string" ? obj.error : null;
}

/**
 * Safely parse JSON from a fetch response. Returns parsed data or throws a descriptive error.
 */
async function safeJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text.trim()) return null;
    try {
        return JSON.parse(text);
    } catch {
        const preview = text.length > 120 ? text.slice(0, 120) + "…" : text;
        throw new Error(
            `The server responded with invalid content (status ${res.status}). ` +
            `Response: ${preview}`
        );
    }
}

/**
 * Get setup status (public, no auth). hasUsers=false => show setup form. hasUsers=true => show user list.
 * Automatically falls back from HTTPS → HTTP if the initial request fails (e.g. untrusted cert on iPad).
 */
export async function apiGetSetupStatus(): Promise<SetupStatus> {
    let lastError: Error | null = null;

    // Try the current API_BASE first, then HTTP fallback if HTTPS
    const bases = [API_BASE];
    const fb = httpFallbackBase(API_BASE);
    if (fb) bases.push(fb);

    for (const base of bases) {
        try {
            const res = await fetch(`${base}/api/auth/setup-status`);
            const data = await safeJson(res);
            if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Failed to get setup status");
            // If we succeeded on a fallback base, switch permanently for this session
            if (base !== API_BASE) {
                API_BASE = base;
                console.info(`[apiClient] Switched API_BASE to ${base} (HTTPS fallback)`);
            }
            const obj = asObject(data);
            return {
                hasUsers: !!obj?.hasUsers,
                users: Array.isArray(obj?.users) ? (obj.users as SetupStatus["users"]) : [],
            };
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e));
            console.warn(`[apiClient] Failed to reach ${base}: ${lastError.message}`);
        }
    }

    throw lastError ?? new Error("Could not connect to the backend");
}

/**
 * Reset to setup: clear all users. super_admin only. Caller should logout after.
 */
export async function apiResetToSetup(): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/api/auth/reset-to-setup`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Reset failed");
}

/**
 * Create first user (super_admin). Only works when no users exist.
 */
export async function apiSetup(username: string, password: string, displayName?: string): Promise<{ token: string; user: ApiUser }> {
    const res = await fetch(`${API_BASE}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, display_name: displayName || username }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Setup failed");
    const obj = asObject(data);
    if (!obj || typeof obj.token !== "string" || !obj.user) throw new Error("Setup failed");
    return { token: obj.token, user: obj.user as ApiUser };
}

/**
 * Login and return user + token.
 */
export async function apiLogin(username: string, password: string): Promise<{ token: string; user: ApiUser }> {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });
    const data = await safeJson(res);
    if (!res.ok) {
        throw new Error(responseErrorMessage(data) ?? "Login failed");
    }
    const obj = asObject(data);
    if (!obj || typeof obj.token !== "string" || !obj.user) throw new Error("Login failed");
    return { token: obj.token, user: obj.user as ApiUser };
}

/**
 * Get current user (validates token).
 */
export async function apiMe(): Promise<ApiUser> {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
    };
    const imp = _getImpersonate?.();
    if (imp) headers["X-Impersonate-User"] = imp;

    const res = await fetch(`${API_BASE}/api/auth/me`, { headers });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Session invalid");
    const obj = asObject(data);
    if (!obj) throw new Error("Session invalid");
    return obj as unknown as ApiUser;
}

/**
 * List users (super_admin only).
 */
export async function apiListUsers(): Promise<ApiUser[]> {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
    };
    const res = await fetch(`${API_BASE}/api/users`, { headers });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Forbidden");
    if (Array.isArray(data)) return data as ApiUser[];
    const obj = asObject(data);
    return Array.isArray(obj?.users) ? (obj.users as ApiUser[]) : [];
}

/** Sync state payload for cross-device: settings + workspace (nodes, edges, conversationHistory, osConversationHistory, tasks). */
export type SyncState = {
    settings?: Record<string, unknown> | null;
    workspace?: {
        activeSpaceId?: string;
        nodes?: unknown[];
        edges?: unknown[];
        conversationHistory?: Record<string, unknown[]>;
        osConversationHistory?: unknown[];
        tasks?: unknown[];
    } | null;
};

/**
 * GET /api/user/sync-state - fetch settings and workspace for the logged-in user (cross-device).
 */
export async function apiGetSyncState(): Promise<SyncState> {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/api/user/sync-state`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Failed to get sync state");
    const obj = asObject(data);
    return {
        settings: (asObject(obj?.settings) as Record<string, unknown> | null) ?? null,
        workspace: (asObject(obj?.workspace) as SyncState["workspace"] | null) ?? null,
    };
}

/**
 * PUT /api/user/sync-state - persist settings and/or workspace for the logged-in user.
 */
export async function apiPutSyncState(payload: { settings?: Record<string, unknown>; workspace?: Record<string, unknown> }): Promise<void> {
    const token = getAuthToken();
    if (!token) throw new Error("Not authenticated");
    const res = await fetch(`${API_BASE}/api/user/sync-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(responseErrorMessage(data) ?? "Failed to save sync state");
}

/** URL for SSE kernel events (agent/synthesis). Token in query so EventSource works from remote clients. */
export function getKernelEventsUrl(taskId: string): string | null {
    const token = getAuthToken();
    if (!token) return null;
    return `${API_BASE}/api/kernel/events?task_id=${encodeURIComponent(taskId)}&token=${encodeURIComponent(token)}`;
}

/** Fire-and-forget PUT sync state with keepalive (for pagehide/visibility so request can outlive the page). */
export function apiPutSyncStateKeepalive(payload: { settings?: Record<string, unknown>; workspace?: Record<string, unknown> }): void {
    const token = getAuthToken();
    if (!token) return;
    fetch(`${API_BASE}/api/user/sync-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => { });
}
