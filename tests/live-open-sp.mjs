import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
let pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));

// 用 popup.html 打开一个页面 —— 它也是扩展的一部分，不是特权的
console.log("open popup.html as tab to wake sw...");
const p2 = await browser.newPage();
try {
  await p2.goto(`chrome-extension://${EXT_ID}/popup.html`, { waitUntil: "domcontentloaded", timeout: 5000 });
  console.log("popup loaded");
} catch (e) { console.log("popup err:", e.message); }
await new Promise(r=>setTimeout(r, 1500));

pages = await browser.pages();
for (const p of pages) console.log(" -", p.type ? p.type() : "?", p.url().slice(0, 100));

await browser.disconnect();
