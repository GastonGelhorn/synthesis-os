import { z } from "zod";

/**
 * Schema for the LLM's "next action" decision in the agent loop.
 * The LLM chooses one of: call a tool, give a final answer, or ask the user.
 * 
 * NOTE: We use a flat object instead of a discriminatedUnion to ensure 
 * maximum compatibility with OpenAI's "Structured Outputs" mode (the reasoning 
 * models o1/o3 can be picky about root-level unions).
 */
export const AgentActionSchema = z.object({
    action: z.enum(["tool_call", "final_answer", "ask_user"])
        .describe("The next step to take. Use 'tool_call' to execute a tool, 'final_answer' when the task is complete, or 'ask_user' if you need clarification (not permission)."),

    // Fields for tool_call
    tool: z.string()
        .describe("The tool ID to invoke (empty string if action is not 'tool_call')."),
    input: z.string()
        .describe("The input to pass to the tool (empty string if action is not 'tool_call')."),

    // Fields for ask_user
    question: z.string()
        .describe("The clarifying question to ask the user (empty string if action is not 'ask_user')."),
    options: z.array(z.string())
        .describe("Suggested buttons for the user (empty array if not needed)."),

    // Shared field
    reasoning: z.string()
        .describe("Brief explanation of the decision or the final conclusion."),

    // Response type classification — determines how the UI renders the result
    response_type: z.enum(["ephemeral", "informative", "conversational", "creative"])
        .describe(
            "How the response should be rendered. " +
            "'ephemeral': Quick facts, confirmations, time, greetings — shown as a brief toast that auto-dismisses. " +
            "'informative': Structured data, research results, weather, emails — full card with data blocks. " +
            "'conversational': Opinions, explanations, brainstorming, follow-ups — chat-style response. " +
            "'creative': Long-form writing, stories, code, essays — rich detailed card."
        ),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;
