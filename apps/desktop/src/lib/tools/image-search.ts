import { fetch } from "@tauri-apps/plugin-http";

/**
 * Image search via DDG i.js API and Bing HTML (no API keys needed).
 */

const IMAGE_HOST_BLOCKLIST = new Set([
    "localhost", "127.0.0.1", "imgur.com", "i.imgur.com",
    "placeholder.com", "placehold.co",
]);

function isValidImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (!parsed.protocol.startsWith("https")) return false;
        const host = parsed.hostname.toLowerCase();
        if (IMAGE_HOST_BLOCKLIST.has(host) || host.endsWith(".local")) return false;
        if (/^10\.|^127\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

export interface ImageSearchResult {
    imageUrls: string[];
}

/**
 * Search for images via DDG i.js API and Bing HTML.
 */
export async function searchImagesRaw(
    query: string,
    limit = 6,
    timeoutMs = 15000,
    userAgent?: string,
): Promise<ImageSearchResult> {
    if (!query.trim()) return { imageUrls: [] };

    const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    // Helper: fetch with timeout (AbortSignal.timeout not supported by Tauri HTTP plugin)
    async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...opts, signal: controller.signal });
        } finally {
            clearTimeout(timer);
        }
    }

    // DDG internal image API (i.js) — returns JSON, no JS rendering needed
    try {
        // Step 1: Get a vqd token from DDG search page
        const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
        const searchRes = await fetchWithTimeout(searchUrl, {
            headers: { "User-Agent": CHROME_UA },
        });

        if (searchRes.ok) {
            const html = await searchRes.text();
            // Extract vqd token from the HTML
            const vqdMatch = html.match(/vqd=["']([^"']+)["']/i)
                || html.match(/vqd=([\d-]+)/i)
                || html.match(/vqd%3D([\d-]+)/i);

            if (vqdMatch) {
                const vqd = vqdMatch[1];
                // Step 2: Query the internal i.js API for image results
                const apiUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&p=1&s=0&u=bing&f=,,,,,&l=us-en&vqd=${vqd}`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: {
                        "User-Agent": CHROME_UA,
                        "Referer": "https://duckduckgo.com/",
                    },
                });

                if (apiRes.ok) {
                    const data = await apiRes.json();
                    if (data.results && Array.isArray(data.results)) {
                        const urls = data.results
                            .map((r: { image?: string }) => r.image)
                            .filter((url: string | undefined): url is string => !!url && isValidImageUrl(url))
                            .slice(0, limit);

                        if (urls.length > 0) {
                            console.log(`[Image Search] DDG i.js API: ${urls.length} results`);
                            return { imageUrls: urls };
                        }
                    }
                }
            } else {
                console.warn("[Image Search] Could not extract vqd token from DDG HTML");
            }
        }
    } catch (err) {
        console.warn("[Image Search] DDG i.js fallback failed:", err instanceof Error ? err.message : err);
    }

    // Fallback 2: Try direct Bing image search HTML scrape
    try {
        const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
        const res = await fetchWithTimeout(bingUrl, {
            headers: { "User-Agent": CHROME_UA },
        });

        if (res.ok) {
            const html = await res.text();
            // Bing embeds image URLs in murl attributes
            const murlRegex = /murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/gi;
            const urls: string[] = [];
            let match;
            while ((match = murlRegex.exec(html)) !== null && urls.length < limit) {
                const decoded = match[1].replace(/&amp;/g, "&");
                if (isValidImageUrl(decoded)) {
                    urls.push(decoded);
                }
            }

            if (urls.length > 0) {
                console.log(`[Image Search] Bing HTML: ${urls.length} results`);
                return { imageUrls: Array.from(new Set(urls)).slice(0, limit) };
            }
        }
    } catch (err) {
        console.warn("[Image Search] Bing fallback failed:", err instanceof Error ? err.message : err);
    }

    console.warn("[Image Search] No images found for:", query);
    return { imageUrls: [] };
}
