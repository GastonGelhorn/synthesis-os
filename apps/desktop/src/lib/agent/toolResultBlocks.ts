/**
 * Maps tool execution results to rich UI blocks for persistent card content.
 * Each block includes _toolName for deduplication and optional _isToolError for failure states.
 */

/** Base fields present on all tool result blocks */
interface ToolResultBlockBase {
    _toolName: string;
    _isToolError?: boolean;
    _stepIndex?: number;
}

type TextBlockStyle = "h1" | "h2" | "body" | "caption" | "quote" | "none";

export type ToolResultBlock =
    | (ToolResultBlockBase & { type: "callout"; variant: "info" | "success" | "error" | "warning"; title?: string; content: string })
    | (ToolResultBlockBase & { type: "text_block"; style: TextBlockStyle; content: string })
    | (ToolResultBlockBase & { type: "list_block"; items: Array<{ title: string; description?: string; isChecked?: boolean }> })
    | (ToolResultBlockBase & { type: "stats_row"; stats: Array<{ label: string; value: string }> })
    | (ToolResultBlockBase & { type: "data_grid"; items: Array<Record<string, string>> })
    | (ToolResultBlockBase & { type: "image_gallery"; images: Array<{ url: string; alt?: string }> })
    | (ToolResultBlockBase & { type: "code_block"; language: string; code: string })
    | (ToolResultBlockBase & { type: "link_preview"; url: string });

/**
 * Build a rich UI block from tool result data.
 * Maps tool types to appropriate block renderings.
 * These blocks are final-quality and will persist as permanent card content.
 */
export function buildRichBlockFromToolResult(
    toolName: string,
    toolInput: string,
    resultText: string,
    success: boolean,
): ToolResultBlock | null {
    if (!success) {
        return {
            type: "callout",
            variant: "error",
            title: `${toolName} failed`,
            content: resultText.slice(0, 200),
            _toolName: toolName,
            _isToolError: true,
        };
    }

    switch (toolName) {
        case "web_search": {
            const lines = resultText.split("\n").filter((l) => l.trim());

            if (lines.length > 1) {
                const items = lines.slice(0, 8).map((line) => {
                    const titleMatch = line.match(/^([^-\\(\\)]+)[-\s]*(.*)$/);
                    const title = titleMatch?.[1]?.trim() || line.slice(0, 60);
                    const snippet = titleMatch?.[2]?.trim() || "";
                    return {
                        title: title.slice(0, 80),
                        description: snippet.slice(0, 100),
                    };
                });
                return { type: "list_block", items, _toolName: toolName };
            }

            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 600),
                _toolName: toolName,
            };
        }

        case "read_page":
        case "summarize_url": {
            const urlMatch = toolInput.match(/https?:\/\/[^\s]+/);
            const url = urlMatch?.[0] || toolInput.slice(0, 100);

            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 800),
                _toolName: toolName,
            };
        }

        case "weather": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            let statsStartIdx = 0;
            if (lines.length > 0 && !lines[0].includes(":")) {
                statsStartIdx = 1;
                // Location line - we merge into stats or body below
            }

            const stats = lines
                .slice(statsStartIdx, statsStartIdx + 4)
                .map((line) => {
                    const parts = line.split(":");
                    return {
                        label: (parts[0] || "").trim().slice(0, 20),
                        value: (parts.slice(1).join(":") || "").trim().slice(0, 30),
                    };
                })
                .filter((s) => s.label && s.value);

            if (stats.length > 0) {
                return { type: "stats_row", stats, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "email_reader": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            if (lines.length > 3) {
                const emails: Array<{ sender: string; subject: string; date: string }> = [];
                for (let i = 0; i < Math.min(lines.length - 1, 8); i += 2) {
                    emails.push({
                        sender: (lines[i] || "").slice(0, 50),
                        subject: (lines[i + 1] || "").slice(0, 80),
                        date: new Date().toLocaleDateString(),
                    });
                }
                if (emails.length > 0) {
                    return { type: "data_grid", items: emails, _toolName: toolName };
                }
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 600),
                _toolName: toolName,
            };
        }

        case "calendar": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            if (lines.length > 1) {
                const items = lines.slice(0, 8).map((line) => {
                    const timeMatch = line.match(/(\d{1,2}:\d{2})\s*[-]?\s*(.+)/);
                    const time = timeMatch?.[1] || "";
                    const title = timeMatch?.[2] || line;
                    return { title: title.slice(0, 80), description: time.slice(0, 10) };
                });
                return { type: "list_block", items, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 600),
                _toolName: toolName,
            };
        }

        case "search_images": {
            const urlRegex = /https?:\/\/[^\s"']+\.(?:jpg|jpeg|png|gif|webp)/gi;
            const rawUrls = resultText.match(urlRegex) || [];
            const urls = [...new Set(rawUrls)];
            if (urls.length > 0) {
                return {
                    type: "image_gallery",
                    images: urls.slice(0, 6).map((url) => ({ url, alt: toolInput })),
                    _toolName: toolName,
                };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "notes": {
            if (resultText.includes("\n") && resultText.length > 200) {
                return {
                    type: "text_block",
                    style: "body",
                    content: resultText.slice(0, 800),
                    _toolName: toolName,
                };
            }
            const noteLines = resultText.split("\n").filter((l) => l.trim());
            if (noteLines.length > 1) {
                return {
                    type: "list_block",
                    items: noteLines.slice(0, 10).map((note) => ({ title: note.slice(0, 80) })),
                    _toolName: toolName,
                };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "contacts":
        case "contacts_search": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            const items = lines.slice(0, 8).map((line) => {
                const parts = line.split(/[\s,|]+/);
                const name = parts[0] || "";
                const email = parts.slice(1).join(" ") || "";
                return { name: name.slice(0, 50), contact: email.slice(0, 100) };
            });
            if (items.length > 0) {
                return { type: "data_grid", items, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "reminders":
        case "reminders_list": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            if (lines.length > 0) {
                return {
                    type: "list_block",
                    items: lines.slice(0, 10).map((reminder) => ({
                        title: reminder.slice(0, 80),
                        isChecked: reminder.includes("x") || reminder.includes("✓"),
                    })),
                    _toolName: toolName,
                };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "youtube_search": {
            const lines = resultText.split("\n").filter((l) => l.trim());
            const items = lines.slice(0, 8).map((line) => {
                const parts = line.split(/\s+by\s+|[\s]*[-]\s*/);
                return {
                    title: (parts[0] || "").slice(0, 80),
                    channel: (parts[1] || "").slice(0, 50),
                };
            });
            if (items.length > 0) {
                return { type: "data_grid", items, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "define_word": {
            const word = toolInput.trim().slice(0, 50);
            const lines = resultText.split("\n").filter((l) => l.trim());
            return {
                type: "text_block",
                style: "body",
                content: `${word}\n\n${lines.join("\n")}`.slice(0, 600),
                _toolName: toolName,
            };
        }

        case "translate": {
            return {
                type: "callout",
                variant: "info",
                title: "Translation",
                content: resultText.slice(0, 300),
                _toolName: toolName,
            };
        }

        case "currency_convert": {
            const lines = resultText.split("\n").filter((l) => l.includes(":"));
            const stats = lines
                .slice(0, 3)
                .map((line) => {
                    const parts = line.split(":");
                    return {
                        label: (parts[0] || "").trim().slice(0, 20),
                        value: (parts.slice(1).join(":") || "").trim().slice(0, 30),
                    };
                })
                .filter((s) => s.label && s.value);
            if (stats.length > 0) {
                return { type: "stats_row", stats, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "system_info":
        case "battery_info":
        case "wifi_info": {
            const sysLines = resultText.split("\n").filter((l) => l.includes(":"));
            const sysStats = sysLines
                .slice(0, 6)
                .map((line) => {
                    const parts = line.split(":");
                    return {
                        label: (parts[0] || "").trim().slice(0, 20),
                        value: (parts.slice(1).join(":") || "").trim().slice(0, 30),
                    };
                })
                .filter((s) => s.label && s.value);
            if (sysStats.length > 0) {
                return { type: "stats_row", stats: sysStats, _toolName: toolName };
            }
            return {
                type: "text_block",
                style: "body",
                content: resultText.slice(0, 400),
                _toolName: toolName,
            };
        }

        case "calculate": {
            return {
                type: "code_block",
                language: "text",
                code: resultText.slice(0, 500),
                _toolName: toolName,
            };
        }

        case "generate_code": {
            return {
                type: "code_block",
                language: "javascript",
                code: resultText.slice(0, 1500),
                _toolName: toolName,
            };
        }

        case "remember":
        case "core_memory_append":
        case "core_memory_replace": {
            return {
                type: "callout",
                variant: "success",
                title: "Memory Updated",
                content: resultText.slice(0, 300),
                _toolName: toolName,
            };
        }

        default: {
            if (resultText.length > 100) {
                return {
                    type: "text_block",
                    style: "body",
                    content: resultText.slice(0, 500),
                    _toolName: toolName,
                };
            }
            return {
                type: "callout",
                variant: "success",
                title: toolName,
                content: resultText.slice(0, 200),
                _toolName: toolName,
            };
        }
    }
}
