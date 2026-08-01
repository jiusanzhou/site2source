import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

const proj = await sp.evaluate(async () => {
  const s = await chrome.storage.local.get(null);
  return s["site2source:projects"]["www.aiyifan.tv"];
});
// 摘 detail、home 顶层字段
console.log("=== Top-level fields ===");
console.log(Object.keys(proj));
console.log("\n=== listSelector ===", proj.listSelector);
console.log("listItemTag:", proj.listItemTag);
console.log("category:", JSON.stringify(proj.category, null, 2));
console.log("search:", JSON.stringify(proj.search, null, 2));
console.log("detail:", JSON.stringify(proj.detail, null, 2));
console.log("play:", JSON.stringify(proj.play, null, 2));

await browser.disconnect();
