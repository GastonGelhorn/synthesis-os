#!/usr/bin/env node
/**
 * Downloads wallpaper images from Unsplash and saves them to public/wallpapers/.
 * Run from repo root: node scripts/download-wallpapers.mjs
 * Requires: npm install node-fetch (or use built-in fetch in Node 18+)
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(__dirname, "..", "apps", "desktop", "public", "wallpapers");

const WALLPAPERS = {
  landscape: [
    { url: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=85", file: "01-sequoia.jpg" },
    { url: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1920&q=85", file: "02-tahoe.jpg" },
    { url: "https://images.unsplash.com/photo-1500673922987-e212871fec22?w=1920&q=85", file: "03-sonoma.jpg" },
    { url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=85", file: "04-goa.jpg" },
    { url: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1920&q=85", file: "05-mountain-dawn.jpg" },
    { url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=85", file: "06-forest.jpg" },
    { url: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=85", file: "07-alps.jpg" },
    { url: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=1920&q=85", file: "08-valley.jpg" },
    { url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=85", file: "09-beach.jpg" },
  ],
  cityscape: [
    { url: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1920&q=85", file: "01-dubai.jpg" },
    { url: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=85", file: "02-la.jpg" },
    { url: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1920&q=85", file: "03-london.jpg" },
    { url: "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1920&q=85", file: "04-ny-night.jpg" },
    { url: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=1920&q=85", file: "05-city-lights.jpg" },
    { url: "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1920&q=85", file: "06-skyscraper.jpg" },
    { url: "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1920&q=85", file: "07-skyline.jpg" },
    { url: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1920&q=85", file: "08-city-night.jpg" },
    { url: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1920&q=85", file: "09-tokyo.jpg" },
  ],
  underwater: [
    { url: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1920&q=85", file: "01-coral.jpg" },
    { url: "https://images.unsplash.com/photo-1518467166778-b88f373ffec7?w=1920&q=85", file: "02-deep-blue.jpg" },
    { url: "https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1920&q=85", file: "03-kelp.jpg" },
    { url: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1920&q=85", file: "04-ocean.jpg" },
    { url: "https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=1920&q=85", file: "05-reef.jpg" },
    { url: "https://images.unsplash.com/photo-1493558103817-58b2924bce98?w=1920&q=85", file: "06-underwater.jpg" },
    { url: "https://images.unsplash.com/photo-1484318571209-661cf29a69c3?w=1920&q=85", file: "07-sea-life.jpg" },
    { url: "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=1920&q=85", file: "08-tropical.jpg" },
    { url: "https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=1920&q=85", file: "09-water.jpg" },
  ],
  abstract: [
    { url: "https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1920&q=85", file: "01-gradient.jpg" },
    { url: "https://images.unsplash.com/photo-1579546929662-711aa81148cf?w=1920&q=85", file: "02-blur.jpg" },
    { url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1920&q=85", file: "03-mesh.jpg" },
    { url: "https://images.unsplash.com/photo-1557682260-96773eb01377?w=1920&q=85", file: "04-pastel.jpg" },
    { url: "https://images.unsplash.com/photo-1557682268-e3955ed5d83f?w=1920&q=85", file: "05-abstract.jpg" },
    { url: "https://images.unsplash.com/photo-1557683304-673a23048d34?w=1920&q=85", file: "06-aurora.jpg" },
    { url: "https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&q=85", file: "07-geometry.jpg" },
    { url: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=85", file: "08-wave.jpg" },
    { url: "https://images.unsplash.com/photo-1579546929662-711aa81148cf?w=1920&q=85", file: "09-soft.jpg" },
  ],
};

async function download(url, filepath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  writeFileSync(filepath, Buffer.from(buf));
}

async function main() {
  for (const [category, items] of Object.entries(WALLPAPERS)) {
    const dir = join(OUT_ROOT, category);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const { url, file } of items) {
      const filepath = join(dir, file);
      try {
        process.stdout.write(`Downloading ${category}/${file} ... `);
        await download(url, filepath);
        console.log("OK");
      } catch (err) {
        console.log("FAIL:", err.message);
      }
    }
  }
  console.log("Done. Wallpapers saved to public/wallpapers/");
}

main();
