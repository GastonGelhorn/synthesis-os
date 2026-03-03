import { describe, it, expect } from "vitest";
import { tryParsePartialJson } from "../tryParsePartialJson";

describe("tryParsePartialJson", () => {
    it("returns parsed object for valid JSON", () => {
        expect(tryParsePartialJson('{"a":1}')).toEqual({ a: 1 });
        expect(tryParsePartialJson('{"foo":"bar","n":42}')).toEqual({ foo: "bar", n: 42 });
    });

    it("returns null for empty or invalid JSON", () => {
        expect(tryParsePartialJson("")).toBeNull();
        expect(tryParsePartialJson("not json")).toBeNull();
        expect(tryParsePartialJson("{")).toBeNull();
    });

    it("handles multi-line AI SDK stream format", () => {
        const stream = '0:"{"\n0:"title"\n0:": "\n0:"test"}"';
        const result = tryParsePartialJson(stream);
        expect(result).toBeNull(); // partial - may not parse
    });

    it("repairs unclosed brackets when accumulated from stream", () => {
        // Simulate stream format where accumulated becomes partial JSON
        const stream = '0:"{\\"a\\":1,\\"b\\":[2,3"';
        const result = tryParsePartialJson(stream);
        expect(result).toBeTruthy();
    });
});
