import type { SpaceId } from "@/types/synthesis";

/* ─── Task Status ─── */

export type AgentTaskStatus =
    | "planning"
    | "running"
    | "waiting_approval"
    | "waiting_answer"
    | "completed"
    | "failed"
    | "cancelled";

/* ─── Step Types ─── */

export type AgentStepType =
    | "tool_call"
    | "llm_reasoning"
    | "approval_request"
    | "question_for_user"
    | "final_answer";

export type AgentStepStatus =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "waiting_approval"
    | "waiting_answer"
    | "skipped";

/* ─── Approval ─── */

export interface ApprovalState {
    required: boolean;
    status: "pending" | "approved" | "rejected";
    reason?: string;
    decidedAt?: number;
}

/* ─── Tool Execution Result ─── */

export interface ToolExecResult {
    success: boolean;
    data?: Record<string, unknown>;
    text?: string;
    sources?: string[];
    images?: string[];
    error?: string;
    durationMs: number;
}

/* ─── Agent Step ─── */

export type ResponseType = "ephemeral" | "informative" | "conversational" | "creative";

export interface AgentStep {
    id: string;
    taskId: string;
    index: number;
    type: AgentStepType;
    status: AgentStepStatus;
    toolName?: string;
    toolInput?: string;
    toolResult?: ToolExecResult;
    reasoning?: string;
    approval?: ApprovalState;
    startedAt?: number;
    completedAt?: number;
    options?: string[];
    error?: string;
    responseType?: ResponseType;
}

/* ─── Agent Config ─── */

export interface AgentConfig {
    maxSteps: number;
    timeoutMs: number;
    requireApproval: boolean;
    aiProvider?: "ollama" | "openai" | "anthropic" | "groq" | "gemini";
    aiModel?: string;
    openaiApiKey?: string;
    ollamaEndpoint?: string;
    anthropicApiKey?: string;
    groqApiKey?: string;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
    maxSteps: 10,
    timeoutMs: 120_000,
    requireApproval: false,
};

/* ─── Agent Task ─── */

export interface AgentTask {
    id: string;
    nodeId: string;
    query: string;
    spaceId: SpaceId;
    status: AgentTaskStatus;
    steps: AgentStep[];
    config: AgentConfig;
    createdAt: number;
    updatedAt: number;
}

/* ─── SSE Event Types ─── */

export type AgentSSEEvent =
    | { type: "task_started"; taskId: string; query: string }
    | { type: "step_started"; step: AgentStep }
    | { type: "step_progress"; stepId: string; taskId: string; reasoning?: string; toolInput?: string }
    | { type: "step_completed"; step: AgentStep }
    | { type: "step_failed"; step: AgentStep; error: string }
    | { type: "approval_required"; step: AgentStep }
    | { type: "question_for_user"; step: AgentStep; question: string; options?: string[] }
    | { type: "final_answer"; step: AgentStep; responseType?: ResponseType }
    | { type: "task_completed"; taskId: string; totalSteps: number; durationMs: number }
    | { type: "task_failed"; taskId: string; error: string }
    | { type: "task_cancelled"; taskId: string }
    | {
        type: "card_generated";
        card: {
            type?: string;
            title?: string;
            summary?: string;
            suggested_width?: number;
            suggested_height?: number;
            design?: { accent_color?: string; vibe?: string; text_style?: string; glass_opacity?: number };
            blocks?: Array<Record<string, unknown>>;
        };
        sources?: string[];
    }
    | { type: "ephemeral_response"; text: string; query: string; taskId: string }
    | { type: "conversation_message"; text: string; query: string; taskId: string };

/* ─── Tool Entry (for the registry) ─── */

export interface ToolContext {
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    log: (message: string) => void;
    timeout: number;
    userAgent: string;
    scrapeEnabled: boolean;
}

export interface ToolEntry {
    id: string;
    name: string;
    description: string;
    parameters: string;
    requiresApproval: boolean;
    execute: (input: string, ctx: ToolContext) => Promise<ToolExecResult>;
}

/* ─── Tool Policy ─── */

export interface ToolPolicy {
    toolId: string;
    requiresApproval: boolean;
    allowedDomains?: string[];
    maxCallsPerTask?: number;
    auditLog: boolean;
}

export interface PolicyDecision {
    allowed: boolean;
    requiresApproval: boolean;
    reason?: string;
}

/* ─── Metrics ─── */

export interface AgentMetrics {
    tasksStarted: number;
    tasksCompleted: number;
    tasksFailed: number;
    avgStepsPerTask: number;
    avgDurationMs: number;
    toolCallCounts: Record<string, number>;
    toolSuccessRates: Record<string, number>;
    approvalRate: number;
}
