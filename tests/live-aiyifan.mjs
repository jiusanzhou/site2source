/**
 * 装 v0.22 扩展打开 aiyifan.tv, 让用户能实际操作
 * (headless=false, 你直接看窗口)
 */
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PROFILE = "/tmp/s2s-live-test";

if (!fs.existsSync(PROFILE)) fs.mkdirSync(PROFILE, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch,ExtensionDeveloperModeWarning",
    "--enable-features=ExtensionsMenuInAppMenu",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1400,900",
    "--remote-debugging-port=19222",
  ],
});

// 等扩展就绪
let extId;
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 300));
  const ext = browser.targets().find(t => t.url().startsWith("chrome-extension://"));
  if (ext) { extId = new URL(ext.url()).host; break; }
}
console.log("Ext ID:", extId);
console.log("CDP: http://127.0.0.1:19222");

const [p] = await browser.pages();
await p.goto("https://www.aiyifan.tv", { waitUntil: "domcontentloaded", timeout: 30000 });
console.log("aiyifan opened");

// 挂着不退, 让用户手动操作
setInterval(() => {}, 60000);
