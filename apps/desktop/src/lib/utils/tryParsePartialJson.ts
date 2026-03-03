/**
 * Try to parse a partial JSON text stream into an object.
 * Returns null if the text can't be parsed yet.
 * Used for AI SDK text-stream protocol lines (e.g. "0:\"chunk\"").
 */
export function tryParsePartialJson(text: string): Record<string, unknown> | null {
    try {
        return JSON.parse(text) as Record<string, unknown>;
    } catch {
        // Not valid JSON yet
    }

    const lines = text.split("\n").filter((l) => l.trim());
    let accumulated = "";
    for (const line of lines) {
        const match = line.match(/^(\d+):(.*)$/);
        if (match) {
            const type = match[1];
            const data = match[2];
            if (type === "0") {
                try {
                    accumulated += JSON.parse(data) as string;
                } catch {
                    accumulated += data;
                }
            }
        }
    }

    if (!accumulated) return null;

    try {
        return JSON.parse(accumulated) as Record<string, unknown>;
    } catch {
        let repaired = accumulated;
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/]/g) || []).length;

        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";

        try {
            return JSON.parse(repaired) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
}
