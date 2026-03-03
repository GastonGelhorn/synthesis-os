/**
 * Browser instance stub.
 * Playwright has been removed. All web operations use fetch-based alternatives:
 *  - Web scraping: fetch + DOMParser + Readability
 *  - Screenshots: thum.io API
 *  - YouTube search: Invidious API / HTML scrape
 *  - Image search: DDG i.js API / Bing HTML
 */

export async function getBrowser(): Promise<never> {
    throw new Error(
        "Playwright is not available. This app runs as a static client (Tauri/browser). " +
        "Use fetch-based alternatives instead."
    );
}

export async function closeBrowser(): Promise<void> {
    // No-op
}
