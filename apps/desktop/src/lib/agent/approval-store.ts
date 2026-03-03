import { recordApprovalRequest } from "./metrics";

export interface ApprovalRequest {
    resolver: (approved: boolean) => void;
    taskId: string;
    stepId: string;
    toolId: string;
    toolInput: string;
    createdAt: number;
}

const pendingApprovals = new Map<string, ApprovalRequest>();
export const APPROVAL_TTL_MS = 2 * 60 * 1000; // 2 minutes (was 5 min — too long)

function cleanupStaleApprovals(): void {
    const now = Date.now();
    for (const [key, val] of Array.from(pendingApprovals.entries())) {
        if (now - val.createdAt > APPROVAL_TTL_MS) {
            val.resolver(false);
            pendingApprovals.delete(key);
        }
    }
}

export function registerPendingApproval(
    taskId: string,
    stepId: string,
    toolId: string,
    toolInput: string,
): Promise<boolean> {
    cleanupStaleApprovals();
    return new Promise<boolean>((resolve) => {
        const timeoutId = setTimeout(() => {
            const pending = pendingApprovals.get(stepId);
            if (!pending) return;
            pending.resolver(false);
            pendingApprovals.delete(stepId);
        }, APPROVAL_TTL_MS);
        pendingApprovals.set(stepId, {
            resolver: (approved: boolean) => {
                clearTimeout(timeoutId);
                resolve(approved);
            },
            taskId,
            stepId,
            toolId,
            toolInput,
            createdAt: Date.now(),
        });
    });
}

export function resolvePendingApproval(
    taskId: string,
    stepId: string,
    approved: boolean,
): { ok: true } | { ok: false; status: number; error: string } {
    cleanupStaleApprovals();
    const pending = pendingApprovals.get(stepId);
    if (!pending) {
        return {
            ok: false,
            status: 404,
            error: "No pending approval found for this step. It may have expired.",
        };
    }
    if (pending.taskId !== taskId) {
        return {
            ok: false,
            status: 400,
            error: "Task ID mismatch",
        };
    }
    recordApprovalRequest(approved);
    pending.resolver(approved);
    pendingApprovals.delete(stepId);
    return { ok: true };
}

export function getPendingApprovalCount(): number {
    cleanupStaleApprovals();
    return pendingApprovals.size;
}
