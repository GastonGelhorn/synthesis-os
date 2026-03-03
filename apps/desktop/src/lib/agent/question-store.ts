/**
 * Question Store -- holds pending agent questions waiting for user answers.
 * Same pattern as approval-store but resolves with a string (user's answer).
 */

export interface PendingQuestion {
    resolver: (answer: string) => void;
    taskId: string;
    stepId: string;
    question: string;
    createdAt: number;
}

const pendingQuestions = new Map<string, PendingQuestion>();
export const QUESTION_TTL_MS = 90 * 1000; // 90 seconds timeout (was 5 min — too long, user loses context)

function cleanupStaleQuestions(): void {
    const now = Date.now();
    for (const [key, val] of Array.from(pendingQuestions.entries())) {
        if (now - val.createdAt > QUESTION_TTL_MS) {
            val.resolver("__TIMEOUT__"); // Resolve with sentinel on timeout
            pendingQuestions.delete(key);
        }
    }
}

/**
 * Register a pending question and return a promise that resolves
 * when the user submits their answer via the answer endpoint.
 */
export function registerPendingQuestion(
    taskId: string,
    stepId: string,
    question: string,
): Promise<string> {
    cleanupStaleQuestions();
    return new Promise<string>((resolve) => {
        const timeoutId = setTimeout(() => {
            const pending = pendingQuestions.get(stepId);
            if (!pending) return;
            pending.resolver("__TIMEOUT__"); // Distinct sentinel — not empty string
            pendingQuestions.delete(stepId);
        }, QUESTION_TTL_MS);
        pendingQuestions.set(stepId, {
            resolver: (answer: string) => {
                clearTimeout(timeoutId);
                resolve(answer);
            },
            taskId,
            stepId,
            question,
            createdAt: Date.now(),
        });
    });
}

/**
 * Resolve a pending question with the user's answer.
 */
export function resolvePendingQuestion(
    taskId: string,
    stepId: string,
    answer: string,
): { ok: true } | { ok: false; status: number; error: string } {
    cleanupStaleQuestions();
    const pending = pendingQuestions.get(stepId);
    if (!pending) {
        return {
            ok: false,
            status: 404,
            error: "No pending question found for this step. It may have expired.",
        };
    }
    if (pending.taskId !== taskId) {
        return {
            ok: false,
            status: 400,
            error: "Task ID mismatch",
        };
    }
    pending.resolver(answer);
    pendingQuestions.delete(stepId);
    return { ok: true };
}

export function getPendingQuestionCount(): number {
    cleanupStaleQuestions();
    return pendingQuestions.size;
}
