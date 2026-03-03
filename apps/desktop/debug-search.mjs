import { chromium } from "playwright";

async function debug() {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        locale: "es-AR",
    });
    const page = await ctx.newPage();

    const q = "receta empanadas argentinas";
    console.log("--- Trying Google ---");
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=es&gl=AR&num=6`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
    });

    const title = await page.title();
    console.log("Page title:", title);
    const url = page.url();
    console.log("Page URL:", url);

    const hasConsent = await page.evaluate(() => {
        const formEl = document.querySelector("form[action*=consent]");
        const btnEl = document.querySelector("#L2AGLb");
        const txt = document.body.innerText.includes("Before you continue");
        return Boolean(formEl) || Boolean(btnEl) || txt;
    });
    console.log("Has consent form:", hasConsent);

    const selectorCounts = await page.evaluate(() => {
        return {
            "div.g": document.querySelectorAll("div.g").length,
            "div.MjjYud": document.querySelectorAll("div.MjjYud").length,
            "a h3": document.querySelectorAll("a h3").length,
            "h3": document.querySelectorAll("h3").length,
            "cite": document.querySelectorAll("cite").length,
        };
    });
    console.log("Selector counts:", JSON.stringify(selectorCounts, null, 2));

    const h3s = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("h3")).slice(0, 8).map(el => {
            const parent = el.closest("a");
            return { text: el.textContent?.trim() || "", href: parent?.href || "" };
        });
    });
    console.log("H3 elements:", JSON.stringify(h3s, null, 2));

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log("Body:", bodyText);

    await browser.close();
}

debug().catch(console.error);
