// 重载扩展 —— 通过 chrome.runtime.reload() 从 sidepanel 里发起
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

console.log("reloading extension...");
try {
  await sp.evaluate(() => chrome.runtime.reload());
} catch (e) {
  console.log("(reload triggered, page context died)", e.message);
}
await browser.disconnect();
console.log("done, wait a few sec then re-attach");
