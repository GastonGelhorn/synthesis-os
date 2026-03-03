import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

/* ── OpenGraph metadata ── */
export interface OpenGraphData {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    type?: string;
    url?: string;
    locale?: string;
    /** Twitter-specific image (fallback) */
    twitterImage?: string;
    /** Favicon URL */
    favicon?: string;
}

export interface ReadPageResult {
    url: string;
    title: string;
    markdown: string;
    og: OpenGraphData;
}

/* ── SSRF protection ── */
function assertPublicWebUrl(rawUrl: string): URL {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP(S) URLs are allowed");
    }

    const hostname = parsed.hostname.toLowerCase();
    const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
    if (blockedHosts.has(hostname) || hostname.endsWith(".local")) {
        throw new Error("Local/private hosts are blocked");
    }

    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        const [a, b] = hostname.split(".").map((part) => Number(part));
        const isPrivateRange =
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168);
        if (isPrivateRange) {
            throw new Error("Private IP ranges are blocked");
        }
    }

    return parsed;
}

/* ── Extract OpenGraph + Twitter Card meta tags from raw HTML ── */
function extractOpenGraphData(html: string, pageUrl: string): OpenGraphData {
    const og: OpenGraphData = {};

    // Fast regex extraction — avoids full DOM parse just for meta tags
    const metaRegex = /<meta\s+(?:[^>]*?\s)?(?:property|name)\s*=\s*["']([^"']+)["']\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
    // Also match reversed order (content before property)
    const metaRegexReversed = /<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["']\s+(?:[^>]*?\s)?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;

    const processMatch = (property: string, content: string) => {
        const prop = property.toLowerCase().trim();
        const val = content.trim();
        if (!val) return;

        switch (prop) {
            case "og:title": og.title = val; break;
            case "og:description": og.description = val; break;
            case "og:image": og.image = resolveUrl(val, pageUrl); break;
            case "og:site_name": og.siteName = val; break;
            case "og:type": og.type = val; break;
            case "og:url": og.url = val; break;
            case "og:locale": og.locale = val; break;
            case "twitter:image": og.twitterImage = resolveUrl(val, pageUrl); break;
            case "twitter:title": if (!og.title) og.title = val; break;
            case "twitter:description": if (!og.description) og.description = val; break;
        }
    };

    let match: RegExpExecArray | null;
    while ((match = metaRegex.exec(html)) !== null) {
        processMatch(match[1], match[2]);
    }
    while ((match = metaRegexReversed.exec(html)) !== null) {
        processMatch(match[2], match[1]);
    }

    // Extract favicon
    const faviconMatch = html.match(/<link\s+[^>]*rel\s*=\s*["'](?:shortcut )?icon["'][^>]*href\s*=\s*["']([^"']+)["']/i)
        || html.match(/<link\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'](?:shortcut )?icon["']/i);
    if (faviconMatch?.[1]) {
        og.favicon = resolveUrl(faviconMatch[1], pageUrl);
    }

    return og;
}

/* ── Resolve relative URLs to absolute ── */
function resolveUrl(url: string, base: string): string {
    if (!url) return url;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("//")) return `https:${url}`;
    try {
        return new URL(url, base).href;
    } catch {
        return url;
    }
}

/* ── Main page reader ── */
export async function readPageRaw(
    url: string,
    timeoutMs = 15000,
    userAgent?: string,
): Promise<ReadPageResult> {
    const parsedUrl = assertPublicWebUrl(url);

    // Client-side adaptation: use Tauri native webview scraper instead of basic fetch
    // This allows scraping SPAs and JS-heavy sites natively
    let content = "";
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        console.log(`[Shadow Read - Tauri Native] ${parsedUrl.href}`);
        // The invoke call will automatically time out internally or via Rust
        content = await invoke("scrape_url", { url: parsedUrl.href }) as string;
    } catch (e) {
        console.warn(`[Shadow Read] Tauri scrape failed, falling back to fetch for ${parsedUrl.href}:`, e);

        // Fallback to standard fetch
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(parsedUrl.href, {
                signal: controller.signal,
                headers: userAgent ? { "User-Agent": userAgent } : undefined
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            }

            content = await response.text();
        } finally {
            clearTimeout(id);
        }
    }

    // 1. Extract OpenGraph metadata from raw HTML (fast, no full DOM parse needed)
    const og = extractOpenGraphData(content, parsedUrl.href);

    // 2. Parse article content with Readability (using native DOMParser)
    // If the content is purely the innerText from our simple Rust scraper, 
    // wrapping it in a basic HTML structure helps Readability parse it,
    // although our Rust scraper currently returns text directly.
    // For now, we'll try to parse it as HTML.
    const parser = new DOMParser();
    const isProbablyPlainText = !content.includes('<html') && !content.includes('<body');
    const parseableContent = isProbablyPlainText ? `<html><body><article>${content}</article></body></html>` : content;

    const doc = parser.parseFromString(parseableContent, "text/html");
    // Ensure base URI is set so relative links work
    const base = doc.createElement('base');
    base.href = parsedUrl.href;
    doc.head.appendChild(base);

    const reader = new Readability(doc);
    const article = reader.parse();

    if (!article?.content) {
        // Even if Readability fails, we might still have OG data
        if (og.title || og.description) {
            return {
                url: parsedUrl.href,
                title: og.title || "Untitled",
                markdown: og.description || "",
                og,
            };
        }
        throw new Error("Could not parse article content");
    }

    // 3. Convert to Markdown
    const turndownService = new TurndownService();
    const markdown = turndownService.turndown(article.content);
    const trimmed =
        markdown.slice(0, 5000) + (markdown.length > 5000 ? "\n...[Content Truncated]..." : "");

    // 4. Use OG title as fallback / enrichment
    const title = article.title || og.title || "Untitled article";

    return {
        url: parsedUrl.href,
        title,
        markdown: trimmed,
        og,
    };
}
