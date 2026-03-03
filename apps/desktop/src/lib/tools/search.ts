export interface SearchResult {
    title: string;
    link: string;
    snippet: string;
}

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* ═══════════════════════════════════════════════════════════════════
 *  NATIVE SEARCH (Zero Cost, No API Keys)
 *  Uses DuckDuckGo HTML + Instant Answer via Tauri Webviews
 * ═══════════════════════════════════════════════════════════════════ */



/* ═══════════════════════════════════════════════════════════════════
 *  DDG INSTANT ANSWER + HTML FETCH (free, no API key needed)
 * ═══════════════════════════════════════════════════════════════════ */

async function tryDDGInstantAnswer(query: string, maxItems: number): Promise<SearchResult[]> {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

        let data: any;
        try {
            const res = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error("Fetch failed");
            data = await res.json();
        } catch (fetchErr) {
            console.warn(`[Search] DDG Instant Answer fetch failed (CORS?), trying Tauri...`);
            try {
                const { invoke } = await import("@tauri-apps/api/core");
                const rawJson = await invoke("scrape_url", { url }) as string;
                data = JSON.parse(rawJson);
            } catch (tauriErr) {
                return [];
            }
        }

        const results: SearchResult[] = [];

        if (data.AbstractText && data.AbstractURL) {
            results.push({ title: data.Heading || query, link: data.AbstractURL, snippet: data.AbstractText.slice(0, 300) });
        }

        if (data.Answer && !results.length) {
            results.push({
                title: query,
                link: data.AnswerURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                snippet: typeof data.Answer === "string" ? data.Answer : JSON.stringify(data.Answer),
            });
        }

        if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics.slice(0, maxItems - results.length)) {
                if (topic.FirstURL && topic.Text) {
                    results.push({ title: topic.Text.slice(0, 100), link: topic.FirstURL, snippet: topic.Text.slice(0, 300) });
                }
            }
        }

        if (results.length > 0) console.log(`[Search] DDG Instant Answer: ${results.length} results`);
        return results.slice(0, maxItems);
    } catch (err) {
        console.warn("[Search] DDG Instant Answer failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

async function tryDDGHTMLFetch(query: string, maxItems: number): Promise<SearchResult[]> {
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        let html = "";
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            html = await invoke("scrape_url", { url }) as string;
        } catch (e) {
            console.warn("[Search] Tauri wrapper failed, trying native fetch:", e);
            const res = await fetch(url, {
                headers: { "User-Agent": CHROME_UA, "Accept": "text/html" },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) return [];
            html = await res.text();
        }

        if (!html) return [];
        const results: SearchResult[] = [];
        const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
        const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

        const links: { href: string; title: string }[] = [];
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const href = match[1].replace(/&amp;/g, "&");
            const title = match[2].replace(/<[^>]+>/g, "").trim();
            if (href && title) links.push({ href, title });
        }

        const snippets: string[] = [];
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
        }

        for (let i = 0; i < Math.min(links.length, maxItems); i++) {
            let finalUrl = links[i].href;
            try {
                const parsed = new URL(finalUrl.startsWith("//") ? `https:${finalUrl}` : finalUrl);
                const uddg = parsed.searchParams.get("uddg");
                if (uddg) finalUrl = decodeURIComponent(uddg);
            } catch { /* keep original */ }
            results.push({ title: links[i].title, link: finalUrl, snippet: snippets[i] || "" });
        }

        if (results.length > 0) console.log(`[Search] DDG HTML Fetch: ${results.length} results`);
        return filterResults(results);
    } catch (err) {
        console.warn("[Search] DDG HTML Fetch failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

/* ═══════════════════════════════════════════════════════════════════
 *  MAIN SEARCH FUNCTION
 *  Chain: DDG API → DDG HTML → SearXNG → Google scrape
 * ═══════════════════════════════════════════════════════════════════ */

export async function searchWebRaw(
    query: string,
    limit = 6,
    timeoutMs = 15000,
    userAgent?: string,
    searchEngine?: string,
    searxngUrl?: string,
): Promise<SearchResult[]> {
    if (!query.trim()) return [];

    const maxItems = Math.max(1, Math.min(limit, 10));

    console.log(`[Search] Starting search for: "${query.slice(0, 80)}"`);

    // 1. DDG Instant Answer (fast, limited)
    console.log("[Search] Trying DDG Instant Answer API...");
    const ddgApi = await tryDDGInstantAnswer(query, maxItems);
    if (ddgApi.length > 0) return ddgApi;

    // 2. DDG HTML Fetch (often blocked)
    console.log("[Search] Trying DDG HTML Fetch...");
    const ddgHtml = await tryDDGHTMLFetch(query, maxItems);
    if (ddgHtml.length > 0) return ddgHtml;

    // 3. SearXNG public instances (privacy-respecting meta-search)
    console.log("[Search] Trying SearXNG public instances...");
    const searx = await trySearXNG(query, maxItems);
    if (searx.length > 0) return searx;

    // 4. Google scrape via Tauri (last resort, most reliable)
    console.log("[Search] Trying Google scrape via Tauri...");
    const google = await tryGoogleScrape(query, maxItems);
    if (google.length > 0) return google;

    console.warn("[Search] All search methods returned 0 results.");
    return [];
}

/* ═══════════════════════════════════════════════════════════════════
 *  SEARXNG PUBLIC INSTANCES (Meta-Search → aggregates Google/Bing/DDG)
 * ═══════════════════════════════════════════════════════════════════ */

const SEARXNG_INSTANCES = [
    "https://search.sapti.me",
    "https://searx.be",
    "https://search.bus-hit.me",
    "https://priv.au",
    "https://searxng.ch",
];

async function trySearXNG(query: string, maxItems: number): Promise<SearchResult[]> {
    for (const instance of SEARXNG_INSTANCES) {
        try {
            const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=auto`;

            let data: any;
            try {
                // Next.js dev server has CORS restrictions, but Tauri fetch doesn't
                const res = await fetch(url, {
                    headers: { "Accept": "application/json" },
                    signal: AbortSignal.timeout(6000),
                });
                if (!res.ok) throw new Error("Fetch failed");
                data = await res.json();
            } catch (fetchErr) {
                // Fallback to Tauri Rust backend which ignores CORS
                console.warn(`[Search] SearXNG fetch failed (CORS?), trying Tauri for ${instance}`);
                try {
                    const { invoke } = await import("@tauri-apps/api/core");
                    const rawJson = await invoke("scrape_url", { url }) as string;
                    data = JSON.parse(rawJson);
                } catch (tauriErr) {
                    continue;
                }
            }

            if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) continue;

            const results: SearchResult[] = [];
            for (const item of data.results.slice(0, maxItems)) {
                if (!item.url || !item.title) continue;
                results.push({
                    title: item.title,
                    link: item.url,
                    snippet: item.content || "",
                });
            }

            if (results.length > 0) {
                console.log(`[Search] SearXNG (${instance}): ${results.length} results`);
                return filterResults(results);
            }
        } catch { continue; }
    }
    return [];
}

/* ═══════════════════════════════════════════════════════════════════
 *  GOOGLE SCRAPE VIA TAURI (Last resort — most reliable)
 * ═══════════════════════════════════════════════════════════════════ */

async function tryGoogleScrape(query: string, maxItems: number): Promise<SearchResult[]> {
    try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=es&num=${maxItems + 2}`;

        let html = "";
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            html = await invoke("scrape_url", { url }) as string;
        } catch {
            // Fallback: direct fetch (may be blocked by Google)
            const res = await fetch(url, {
                headers: { "User-Agent": CHROME_UA, "Accept": "text/html", "Accept-Language": "es-ES,es;q=0.9" },
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) return [];
            html = await res.text();
        }

        if (!html || html.length < 1000) return [];

        const results: SearchResult[] = [];

        // Google search results parsing — multiple patterns
        // Pattern 1: <a href="/url?q=..." — standard desktop results
        const linkRegex = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>/gi;
        let match;
        const links: string[] = [];
        while ((match = linkRegex.exec(html)) !== null) {
            const decoded = decodeURIComponent(match[1]);
            if (decoded.startsWith("http") && !decoded.includes("google.com") && !decoded.includes("accounts.google")) {
                links.push(decoded);
            }
        }

        // Pattern 2: Extract titles via <h3> tags
        const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
        const titles: string[] = [];
        while ((match = h3Regex.exec(html)) !== null) {
            const clean = match[1].replace(/<[^>]+>/g, "").trim();
            if (clean) titles.push(clean);
        }

        // Pattern 3: Snippets from spans with specific data attributes
        const spanRegex = /<span[^>]*>(?!<)([\s\S]{30,300}?)<\/span>/gi;
        const snippets: string[] = [];
        while ((match = spanRegex.exec(html)) !== null) {
            const clean = match[1].replace(/<[^>]+>/g, "").trim();
            if (clean.length > 40 && !clean.includes("function") && !clean.includes("{")) {
                snippets.push(clean);
            }
        }

        for (let i = 0; i < Math.min(links.length, maxItems); i++) {
            results.push({
                title: titles[i] || `Result ${i + 1}`,
                link: links[i],
                snippet: snippets[i] || "",
            });
        }

        if (results.length > 0) console.log(`[Search] Google scrape: ${results.length} results`);
        return filterResults(results);
    } catch (err) {
        console.warn("[Search] Google scrape failed:", err instanceof Error ? err.message : err);
        return [];
    }
}

/* ── Utilities ── */

function filterResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
        if (!r.title || !r.link || r.title === "Untitled result") return false;
        if (!r.link.startsWith("http")) return false;
        if (r.link.includes("bing.com/ck/") || r.link.includes("duckduckgo.com") || r.link.includes("google.com/search")) return false;
        if (r.link.includes("accounts.google") || r.link.includes("google.com/sorry") || r.link.includes("support.google")) return false;
        try {
            const u = new URL(r.link);
            const key = u.hostname + u.pathname;
            if (seen.has(key)) return false;
            seen.add(key);
        } catch { return false; }
        return true;
    });
}
