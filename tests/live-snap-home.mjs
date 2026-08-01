import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../test-output");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:19222",
  defaultViewport: null,
  targetFilter: (t) => true,
});
const rs = await fetch("http://127.0.0.1:19222/json/list").then(r => r.json());
const extRec = rs.find(t => t.url && t.url.startsWith("chrome-extension://"));
const extId = new URL(extRec.url).host;

// 直接新开一个 sidepanel 页看现在 state
const spPage = await browser.newPage();
await spPage.setViewport({ width: 500, height: 950 });
await spPage.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 1500));

// 尝试展开 home 卡
await spPage.evaluate(() => {
  const cards = document.querySelectorAll(".s2s-role-card-header");
  for (const c of cards) {
    const t = c.textContent || "";
    if (t.includes("首页") || t.includes("home")) { c.click(); break; }
  }
});
await new Promise(r => setTimeout(r, 800));
await spPage.screenshot({ path: `${OUT}/v22-home-expanded.png`, fullPage: true });
console.log("saved");
await browser.disconnect();
