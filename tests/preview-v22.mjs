import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PROFILE = "/tmp/s2s-preview-v22";
const OUT = path.resolve(__dirname, "../test-output");

if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  protocolTimeout: 120000,
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
  if (ext) {
    extId = new URL(ext.url()).host;
    break;
  }
}
console.log("id:", extId);

const p2 = await browser.newPage();
p2.on("pageerror", (err) => console.log("[pageerror]", err.message));
p2.on("console", (m) => {
  const t = m.type();
  if (t === "error" || t === "warning") console.log(`[console ${t}]`, m.text());
});
await p2.setViewport({ width: 420, height: 900 });
await p2.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));

// Verify the DOM actually rendered
const info = await p2.evaluate(() => ({
  hasWorkbench: !!document.querySelector(".s2s-workbench"),
  cardCount: document.querySelectorAll(".s2s-role-card").length,
  bodyText: document.body.innerText.slice(0, 200),
}));
console.log("dom info:", JSON.stringify(info));

// Warm up screenshot pipeline (first CDP capture sometimes hangs on load).
try {
  await p2.screenshot({ path: "/tmp/warmup-v22.png", timeout: 15000 });
} catch (e) {
  console.log("warmup screenshot err:", e.message);
}

try {
  await p2.screenshot({ path: path.join(OUT, "v22-workbench.png"), timeout: 30000 });
  console.log("v22-workbench ok");
} catch (e) {
  console.log("screenshot 1 err:", e.message);
}

// expand first card
await p2.evaluate(() => {
  const h = document.querySelectorAll(".s2s-role-card-header");
  if (h[0]) h[0].click();
});
await new Promise((r) => setTimeout(r, 500));

try {
  await p2.screenshot({ path: path.join(OUT, "v22-workbench-expanded.png"), timeout: 30000 });
  console.log("v22-workbench-expanded ok");
} catch (e) {
  console.log("screenshot 2 err:", e.message);
}

await browser.close();
