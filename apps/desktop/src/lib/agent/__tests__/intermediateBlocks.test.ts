import { describe, it, expect } from "vitest";
import { buildIntermediateBlock, getToolMeta } from "../intermediateBlocks";
import type { AgentStep } from "../types";

describe("getToolMeta", () => {
    it("returns metadata for web_search", () => {
        const meta = getToolMeta("web_search");
        expect(meta.label).toBe("Web Search");
        expect(meta.category).toBe("web");
        expect(meta.icon).toBeDefined();
    });

    it("returns metadata for weather", () => {
        const meta = getToolMeta("weather");
        expect(meta.label).toBeDefined();
        expect(meta.category).toBeDefined();
    });

    it("returns fallback for unknown tool", () => {
        const meta = getToolMeta("unknown_tool_xyz");
        expect(meta.label).toBe("Unknown Tool Xyz");
        expect(meta.icon).toBeDefined();
    });

    it("describeInput works for web_search with query", () => {
        const meta = getToolMeta("web_search");
        expect(meta.describeInput).toBeDefined();
        const desc = meta.describeInput!('{"query":"test"}');
        expect(desc).toContain("test");
    });
});

describe("buildIntermediateBlock", () => {
    it("returns null for non-tool_call step", () => {
        const step: AgentStep = {
            id: "s1",
            taskId: "t1",
            index: 0,
            type: "llm_reasoning",
            status: "completed",
        };
        expect(buildIntermediateBlock(step)).toBeNull();
    });

    it("returns null when toolName is missing", () => {
        const step: AgentStep = {
            id: "s1",
            taskId: "t1",
            index: 0,
            type: "tool_call",
            status: "running",
        };
        expect(buildIntermediateBlock(step)).toBeNull();
    });

    it("returns running callout for tool_call with status running", () => {
        const step: AgentStep = {
            id: "s1",
            taskId: "t1",
            index: 0,
            type: "tool_call",
            status: "running",
            toolName: "web_search",
            toolInput: '{"query":"foo"}',
        };
        const block = buildIntermediateBlock(step);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("callout");
        expect(block?._isIntermediate).toBe(true);
        expect(block?._toolStepId).toBe("s1");
        expect(block?._toolName).toBe("web_search");
        expect(block?.variant).toBe("info");
    });

    it("returns completed success callout for completed tool with success", () => {
        const step: AgentStep = {
            id: "s2",
            taskId: "t1",
            index: 1,
            type: "tool_call",
            status: "completed",
            toolName: "weather",
            toolInput: "london",
            toolResult: { success: true, text: "20C sunny", durationMs: 100 },
        };
        const block = buildIntermediateBlock(step);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("callout");
        expect(block?.variant).toBe("success");
        expect(block?._toolName).toBe("weather");
    });

    it("returns error callout for completed tool with failure", () => {
        const step: AgentStep = {
            id: "s3",
            taskId: "t1",
            index: 2,
            type: "tool_call",
            status: "completed",
            toolName: "web_search",
            toolInput: "q",
            toolResult: { success: false, error: "Network error", durationMs: 500 },
        };
        const block = buildIntermediateBlock(step);
        expect(block).not.toBeNull();
        expect(block?.variant).toBe("error");
        expect(block?.content).toContain("Network error");
    });

    it("returns error callout for failed step", () => {
        const step: AgentStep = {
            id: "s4",
            taskId: "t1",
            index: 3,
            type: "tool_call",
            status: "failed",
            toolName: "read_page",
            toolInput: "https://example.com",
            error: "Timeout",
        };
        const block = buildIntermediateBlock(step);
        expect(block).not.toBeNull();
        expect(block?.variant).toBe("error");
        expect(block?.content).toContain("Timeout");
    });
});
