// 探测：填入关键词 + 按 Enter，观测 URL 变化 + fetch XHR
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const exe = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
if (!fs.existsSync(exe)) { console.log("no chrome"); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: exe, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();

const requests = [];
page.on("request", req => {
  const url = req.url();
  if (url.includes("aiyifan.tv") || url.includes("api") || url.includes("search")) {
    if (req.resourceType() === "xhr" || req.resourceType() === "fetch" || req.resourceType() === "document") {
      requests.push({ url, method: req.method(), type: req.resourceType() });
    }
  }
});

await page.goto("https://www.aiyifan.tv/", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log("=== initial URL:", page.url());
const before = requests.length;

// 输入 + Enter
await page.click("#search-input");
await page.keyboard.type("寒战");
await new Promise(r => setTimeout(r, 500));
await page.keyboard.press("Enter");
await new Promise(r => setTimeout(r, 4000));

console.log("=== after enter URL:", page.url());
console.log("=== new requests since keypress:");
for (const r of requests.slice(before)) {
  console.log(" ", r.type.padEnd(9), r.method, r.url);
}
await browser.close();
