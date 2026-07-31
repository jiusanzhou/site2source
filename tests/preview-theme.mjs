import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PROFILE = "/tmp/s2s-theme-preview";
const OUT = path.resolve(__dirname, "../test-output");

if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
  defaultViewport: { width: 1280, height: 900 },
});

let extId;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
  if (ext) { extId = new URL(ext.url()).host; break; }
}
console.log("扩展 id:", extId);

// 打开 popup 截图
const p = await browser.newPage();
await p.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1500));
await p.setViewport({ width: 420, height: 700 });
await p.screenshot({ path: path.join(OUT, "theme-popup.png"), fullPage: true });
console.log("saved theme-popup.png");

// 侧栏
await p.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1500));
await p.setViewport({ width: 420, height: 900 });
await p.screenshot({ path: path.join(OUT, "theme-sidepanel.png"), fullPage: true });
console.log("saved theme-sidepanel.png");

await browser.close();
