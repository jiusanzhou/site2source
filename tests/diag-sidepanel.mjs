import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PROFILE = "/tmp/s2s-sidepanel-diag";

if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, userDataDir: PROFILE,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
  defaultViewport: { width: 1280, height: 900 },
});

let extId;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
  if (ext) { extId = new URL(ext.url()).host; break; }
}

const p = await browser.newPage();
await p.setViewport({ width: 600, height: 900 });
await p.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1000));

const dims = await p.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      sel, width: cs.width, minWidth: cs.minWidth, maxWidth: cs.maxWidth,
      rectW: el.getBoundingClientRect().width,
    };
  };
  return {
    body: q("body"),
    root: q(".s2s-sidepanel-root"),
    popup: q(".s2s-popup"),
    s2sroot: q(".s2s-root"),
    workbench: q(".s2s-sidepanel-root .s2s-root"),
    firstChild: q(".s2s-sidepanel-root > *:not(.s2s-sidepanel-hint)"),
  };
});
console.log(JSON.stringify(dims, null, 2));

await browser.close();
