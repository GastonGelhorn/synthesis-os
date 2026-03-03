import { describe, it, expect } from "vitest";
import { buildRichBlockFromToolResult } from "../toolResultBlocks";

describe("buildRichBlockFromToolResult", () => {
    it("returns error callout on success=false", () => {
        const block = buildRichBlockFromToolResult("web_search", "q", "Something failed", false);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("callout");
        expect((block as { variant?: string }).variant).toBe("error");
        expect((block as { title?: string }).title).toContain("failed");
        expect(block?._toolName).toBe("web_search");
    });

    it("returns list_block for web_search with multiple results", () => {
        const resultText = "Title 1 - Snippet 1\nTitle 2 - Snippet 2\nTitle 3";
        const block = buildRichBlockFromToolResult("web_search", "q", resultText, true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("list_block");
        expect((block as { items?: unknown[] }).items?.length).toBe(3);
        expect(block?._toolName).toBe("web_search");
    });

    it("returns text_block for web_search with single result", () => {
        const block = buildRichBlockFromToolResult("web_search", "q", "Single result here", true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("text_block");
        expect((block as { content?: string }).content).toBe("Single result here");
    });

    it("returns stats_row for weather with key:value lines", () => {
        const resultText = "Location\nTemp: 20C\nHumidity: 50%";
        const block = buildRichBlockFromToolResult("weather", "london", resultText, true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("stats_row");
        expect((block as { stats?: Array<{ label: string; value: string }> }).stats?.length).toBeGreaterThan(0);
    });

    it("returns callout for translate tool", () => {
        const block = buildRichBlockFromToolResult("translate", "hello", "hello", true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("callout");
        expect((block as { title?: string }).title).toBe("Translation");
    });

    it("returns code_block for calculate tool", () => {
        const block = buildRichBlockFromToolResult("calculate", "2+2", "4", true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("code_block");
        expect((block as { code?: string }).code).toBe("4");
    });

    it("returns callout for memory tools", () => {
        const block = buildRichBlockFromToolResult("remember", "key", "Stored value", true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("callout");
        expect((block as { variant?: string }).variant).toBe("success");
    });

    it("returns text_block for unknown tool with long result", () => {
        const longResult = "x".repeat(150);
        const block = buildRichBlockFromToolResult("unknown_tool", "in", longResult, true);
        expect(block).not.toBeNull();
        expect(block?.type).toBe("text_block");
    });
});
