import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const OUT = path.resolve(__dirname, "../test-output");

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
});
const p = await browser.newPage();
await p.setViewport({ width: 620, height: 1000 });
const file = "file://" + path.resolve(__dirname, "preview-mock.html");
await p.goto(file, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 500));
const height = await p.evaluate(() => document.body.scrollHeight);
await p.setViewport({ width: 620, height: Math.min(height, 1500) });
await p.screenshot({ path: path.join(OUT, "preview-step-mock.png"), fullPage: true });
await browser.close();
console.log("done");
