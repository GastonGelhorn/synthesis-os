/**
 * Lightweight in-memory metrics collector for agent tasks.
 * Displayed in the debug overlay when settings.debugMode is true.
 */

import type { AgentMetrics } from "./types";

let metrics: AgentMetrics = {
    tasksStarted: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    avgStepsPerTask: 0,
    avgDurationMs: 0,
    toolCallCounts: {},
    toolSuccessRates: {},
    approvalRate: 0,
};

// Internal accumulators
let totalSteps = 0;
let totalDuration = 0;
let totalApprovalRequests = 0;
let totalApproved = 0;
let toolCallTotal: Record<string, number> = {};
let toolCallSuccess: Record<string, number> = {};

export function recordTaskStarted(): void {
    metrics.tasksStarted++;
}

export function recordTaskCompleted(steps: number, durationMs: number): void {
    metrics.tasksCompleted++;
    totalSteps += steps;
    totalDuration += durationMs;
    metrics.avgStepsPerTask = metrics.tasksCompleted > 0 ? totalSteps / metrics.tasksCompleted : 0;
    metrics.avgDurationMs = metrics.tasksCompleted > 0 ? totalDuration / metrics.tasksCompleted : 0;
}

export function recordTaskFailed(): void {
    metrics.tasksFailed++;
}

export function recordToolCall(toolId: string, success: boolean): void {
    toolCallTotal[toolId] = (toolCallTotal[toolId] || 0) + 1;
    if (success) {
        toolCallSuccess[toolId] = (toolCallSuccess[toolId] || 0) + 1;
    }
    metrics.toolCallCounts = { ...toolCallTotal };
    metrics.toolSuccessRates = Object.fromEntries(
        Object.entries(toolCallTotal).map(([id, total]) => [
            id,
            total > 0 ? (toolCallSuccess[id] || 0) / total : 0,
        ]),
    );
}

export function recordApprovalRequest(approved: boolean): void {
    totalApprovalRequests++;
    if (approved) totalApproved++;
    metrics.approvalRate = totalApprovalRequests > 0 ? totalApproved / totalApprovalRequests : 0;
}

export function getMetrics(): Readonly<AgentMetrics> {
    return { ...metrics };
}

export function resetMetrics(): void {
    metrics = {
        tasksStarted: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        avgStepsPerTask: 0,
        avgDurationMs: 0,
        toolCallCounts: {},
        toolSuccessRates: {},
        approvalRate: 0,
    };
    totalSteps = 0;
    totalDuration = 0;
    totalApprovalRequests = 0;
    totalApproved = 0;
    toolCallTotal = {};
    toolCallSuccess = {};
}
