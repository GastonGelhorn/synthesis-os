/**
 * Tool approval policy engine.
 *
 * Evaluates whether a tool call should be allowed, blocked, or requires approval.
 * Also provides audit logging for sensitive operations.
 */

import type { ToolEntry, ToolPolicy, PolicyDecision } from "./types";

/* ─── Default Policies ─── */

const DEFAULT_POLICIES: ToolPolicy[] = [
    // Web / Research
    { toolId: "http_request", requiresApproval: true, allowedDomains: [], maxCallsPerTask: 10, auditLog: true },
    { toolId: "web_search", requiresApproval: false, maxCallsPerTask: 15, auditLog: false },
    { toolId: "read_page", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "web_scrape", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "summarize_url", requiresApproval: false, maxCallsPerTask: 15, auditLog: false },
    { toolId: "search_images", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "youtube_search", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "rss_reader", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "weather", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },

    // Knowledge / Utilities
    { toolId: "calculate", requiresApproval: false, maxCallsPerTask: 50, auditLog: false },
    { toolId: "currency_convert", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "define_word", requiresApproval: false, maxCallsPerTask: 30, auditLog: false },
    { toolId: "translate", requiresApproval: false, maxCallsPerTask: 50, auditLog: false },
    { toolId: "current_time", requiresApproval: false, maxCallsPerTask: 30, auditLog: false },
    { toolId: "qr_code", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },

    // System / macOS controls
    { toolId: "clipboard_read", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "clipboard_write", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "notify", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "open_app", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "say_tts", requiresApproval: true, maxCallsPerTask: 5, auditLog: false },
    { toolId: "take_screenshot", requiresApproval: true, maxCallsPerTask: 3, auditLog: true },
    { toolId: "search_files", requiresApproval: false, maxCallsPerTask: 15, auditLog: false },
    { toolId: "set_timer", requiresApproval: false, maxCallsPerTask: 5, auditLog: false },
    { toolId: "get_system_info", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "get_spatial_bounds", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "get_volume", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "set_volume", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "get_brightness", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "set_brightness", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "toggle_dark_mode", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "get_battery", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "get_wifi", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },

    // macOS app integrations
    { toolId: "notes_list", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "notes_read", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "notes_create", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "email_list", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "calendar_today", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "calendar_create", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "reminders_list", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "reminders_add", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "contacts_search", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "music_play", requiresApproval: true, maxCallsPerTask: 10, auditLog: false },
    { toolId: "music_pause", requiresApproval: true, maxCallsPerTask: 10, auditLog: false },
    { toolId: "music_next", requiresApproval: true, maxCallsPerTask: 10, auditLog: false },
    { toolId: "finder_open", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "finder_trash", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "safari_tabs", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },

    // LSFS storage
    { toolId: "storage_read", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "storage_list", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "storage_versions", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "storage_write", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "storage_create", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "storage_delete", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "storage_rollback", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },

    // Real filesystem
    { toolId: "read_file", requiresApproval: false, maxCallsPerTask: 20, auditLog: false },
    { toolId: "file_read_full", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "dir_list", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "file_write", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "file_append", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "file_move", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },
    { toolId: "file_copy", requiresApproval: true, maxCallsPerTask: 20, auditLog: true },

    // Legacy aliases (for compatibility with older stored settings)
    { toolId: "system_info", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "file_manager", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "email_reader", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "clipboard", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "spotlight_search", requiresApproval: false, maxCallsPerTask: 15, auditLog: false },
    { toolId: "desktop_screenshot", requiresApproval: true, maxCallsPerTask: 3, auditLog: true },
    { toolId: "volume_brightness", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "battery_info", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "wifi_info", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "dark_mode", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "calendar", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "contacts", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "reminders", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "finder", requiresApproval: true, maxCallsPerTask: 10, auditLog: true },
    { toolId: "music", requiresApproval: true, maxCallsPerTask: 10, auditLog: false },
    { toolId: "notes", requiresApproval: true, maxCallsPerTask: 10, auditLog: false },
    { toolId: "screenshot_url", requiresApproval: true, maxCallsPerTask: 5, auditLog: true },
    { toolId: "image_description", requiresApproval: false, maxCallsPerTask: 10, auditLog: false },
    { toolId: "generate_code", requiresApproval: true, maxCallsPerTask: 3, auditLog: true },
    { toolId: "summarize_nodes", requiresApproval: false, maxCallsPerTask: 5, auditLog: false },
];

/* ─── Audit Log ─── */

export interface AuditEntry {
    timestamp: number;
    taskId: string;
    toolId: string;
    input: string;
    decision: "allowed" | "blocked" | "approval_required";
    reason?: string;
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 500;

export function getAuditLog(): readonly AuditEntry[] {
    return auditLog;
}

export function clearAuditLog(): void {
    auditLog.length = 0;
}

function logAudit(entry: AuditEntry): void {
    auditLog.push(entry);
    if (auditLog.length > MAX_AUDIT_ENTRIES) {
        auditLog.shift();
    }
}

/* ─── Tool Call Counter (per-task rate limiting) ─── */

/** Stores per-task tool call counts along with creation timestamp for leak protection */
interface TaskCountEntry {
    counts: Map<string, number>;
    createdAt: number;
}

const taskToolCounts = new Map<string, TaskCountEntry>();

/** Fix #8: Maximum age for a task entry before it's considered stale (10 minutes) */
const TASK_COUNTS_TTL_MS = 10 * 60 * 1000;
/** Fix #8: Maximum number of tracked tasks to prevent unbounded growth */
const MAX_TRACKED_TASKS = 50;

/** Fix #8: Remove stale entries and enforce max size */
function cleanupTaskCounts(): void {
    const now = Date.now();
    for (const [taskId, entry] of Array.from(taskToolCounts.entries())) {
        if (now - entry.createdAt > TASK_COUNTS_TTL_MS) {
            taskToolCounts.delete(taskId);
        }
    }
    // If still over limit, remove oldest entries
    if (taskToolCounts.size > MAX_TRACKED_TASKS) {
        const sorted = Array.from(taskToolCounts.entries())
            .sort((a, b) => a[1].createdAt - b[1].createdAt);
        const toRemove = sorted.slice(0, sorted.length - MAX_TRACKED_TASKS);
        for (const [taskId] of toRemove) {
            taskToolCounts.delete(taskId);
        }
    }
}

export function recordToolCall(taskId: string, toolId: string): void {
    if (!taskToolCounts.has(taskId)) {
        cleanupTaskCounts(); // Clean up before adding new entries
        taskToolCounts.set(taskId, { counts: new Map(), createdAt: Date.now() });
    }
    const entry = taskToolCounts.get(taskId)!;
    entry.counts.set(toolId, (entry.counts.get(toolId) || 0) + 1);
}

export function getToolCallCount(taskId: string, toolId: string): number {
    return taskToolCounts.get(taskId)?.counts.get(toolId) || 0;
}

export function clearTaskCounts(taskId: string): void {
    taskToolCounts.delete(taskId);
}

/* ─── Domain Check for http_request ─── */

function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
    if (allowedDomains.length === 0) return true; // Empty = all allowed
    try {
        const host = new URL(url).hostname.toLowerCase();
        return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
    } catch {
        return false;
    }
}

function parseHttpInput(input: string): { url: string; method: string } | null {
    try {
        const raw = JSON.parse(input) as { url?: string; method?: string };
        if (typeof raw.url === "string" && raw.url.trim()) {
            return {
                url: raw.url.trim(),
                method: (raw.method || "GET").toUpperCase(),
            };
        }
    } catch {
        // Raw URL fallback
    }
    if (input.startsWith("http://") || input.startsWith("https://")) {
        return { url: input.trim(), method: "GET" };
    }
    return null;
}

/* ─── Smart Approval: detect read-only operations that don't need approval ─── */

/**
 * Checks if a tool invocation is a read-only operation (safe to auto-approve).
 * Write/create/delete operations still require approval.
 */
function isReadOnlyOperation(toolId: string, input: string): boolean {
    // Parse the input to check for action type
    let parsedAction: string | undefined;
    try {
        const parsed = JSON.parse(input);
        parsedAction = parsed.action?.toLowerCase?.() || parsed.operation?.toLowerCase?.();
    } catch {
        // input might be plain text — treat as read-only for known read tools
    }

    // Tools that are ALWAYS read-only (no destructive actions possible)
    const alwaysReadOnly = new Set([
        "email_list", "notes_list", "notes_read", "calendar_today",
        "reminders_list", "contacts_search", "safari_tabs",
        "get_battery", "get_wifi", "get_system_info", "get_spatial_bounds",
        "search_files", "weather", "currency_convert", "define_word",
        "calculate", "summarize_url", "youtube_search", "rss_reader",
        "web_search", "read_page", "web_scrape", "current_time",
        "read_file", "storage_read", "storage_list", "storage_versions",
        // legacy
        "email_reader", "contacts", "battery_info", "wifi_info",
        "system_info", "spotlight_search", "image_description", "summarize_nodes",
    ]);
    if (alwaysReadOnly.has(toolId)) return true;

    // Tools with mixed read/write — check the action
    const writeActions = new Set([
        "create", "write", "delete", "trash", "send", "move",
        "complete", "toggle", "set", "play", "pause", "skip", "close",
    ]);

    if (parsedAction && writeActions.has(parsedAction)) {
        return false; // This is a write operation
    }

    // For these tools, default to read-only if action is "list", "read", "search", "get", or unspecified
    const readFirstTools = new Set([
        "notes", "calendar", "reminders", "finder", "safari_tabs",
        "music", "clipboard", "file_manager",
    ]);
    if (readFirstTools.has(toolId)) {
        if (!parsedAction) return true; // No action specified = probably a read
        const readActions = new Set(["list", "read", "search", "get", "today", "upcoming", "status", "info", "current"]);
        return readActions.has(parsedAction);
    }

    return false;
}

/* ─── Policy Evaluation ─── */

export function evaluatePolicy(
    tool: ToolEntry,
    input: string,
    taskId: string,
    globalApprovalRequired: boolean,
    customPolicies?: ToolPolicy[],
): PolicyDecision {
    const policies = customPolicies || DEFAULT_POLICIES;
    const policy = policies.find((p) => p.toolId === tool.id);

    // Check rate limit
    if (policy?.maxCallsPerTask) {
        const count = getToolCallCount(taskId, tool.id);
        if (count >= policy.maxCallsPerTask) {
            const entry: AuditEntry = {
                timestamp: Date.now(),
                taskId,
                toolId: tool.id,
                input: input.slice(0, 200),
                decision: "blocked",
                reason: `Rate limit exceeded: ${count}/${policy.maxCallsPerTask} calls`,
            };
            if (policy.auditLog) logAudit(entry);
            return {
                allowed: false,
                requiresApproval: false,
                reason: `Tool "${tool.id}" has reached its limit of ${policy.maxCallsPerTask} calls per task`,
            };
        }
    }

    // Check domain restrictions for http_request
    const httpInput = tool.id === "http_request" ? parseHttpInput(input) : null;
    if (httpInput && policy?.allowedDomains?.length) {
        if (!isDomainAllowed(httpInput.url, policy.allowedDomains)) {
            const entry: AuditEntry = {
                timestamp: Date.now(),
                taskId,
                toolId: tool.id,
                input: input.slice(0, 200),
                decision: "blocked",
                reason: "Domain not in allowlist",
            };
            if (policy?.auditLog) logAudit(entry);
            return {
                allowed: false,
                requiresApproval: false,
                reason: "Domain not in the allowed list for HTTP requests",
            };
        }
    }

    // Determine if approval is needed
    const isSafeHttpRead =
        tool.id === "http_request" &&
        httpInput !== null &&
        (httpInput.method === "GET" || httpInput.method === "HEAD");

    // Smart approval: read-only operations are auto-approved
    const isReadOnly = isReadOnlyOperation(tool.id, input);

    const needsApproval =
        globalApprovalRequired ||
        (!isReadOnly && !isSafeHttpRead && (
            tool.requiresApproval ||
            (policy?.requiresApproval ?? false)
        ));

    if (isReadOnly && !globalApprovalRequired) {
        console.log(`[Policy] Auto-approved read-only: ${tool.id} (input: ${input.slice(0, 60)}...)`);
    }

    const decision: PolicyDecision = {
        allowed: true,
        requiresApproval: needsApproval,
    };

    if (policy?.auditLog) {
        logAudit({
            timestamp: Date.now(),
            taskId,
            toolId: tool.id,
            input: input.slice(0, 200),
            decision: needsApproval ? "approval_required" : "allowed",
        });
    }

    return decision;
}

/**
 * Get the default policies for reference/display in settings.
 */
export function getDefaultPolicies(): readonly ToolPolicy[] {
    return DEFAULT_POLICIES;
}

/**
 * Alpha-phase kernel-gated destructive tools.
 * These are enforced at the Rust kernel level (approval_gate.rs) regardless
 * of frontend policy settings. The user MUST explicitly approve these before execution.
 */
export const KERNEL_GATED_DESTRUCTIVE_TOOLS = new Set([
    "finder_trash", "file_write", "file_append", "file_move", "file_copy",
    "storage_delete", "storage_write", "storage_create", "storage_rollback",
    "http_request", "notes_create", "calendar_create", "reminders_add",
    "open_app", "clipboard_write", "set_volume", "set_brightness",
    "toggle_dark_mode", "say_tts", "music_play", "music_pause", "music_next",
]);
