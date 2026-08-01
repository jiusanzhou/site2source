// 1) aiyifan 跳到 /play/<id>
// 2) 在 sidepanel 里点 detail 卡 → 学习详情页
// 3) 等待 storage 更新
// 4) 打印新的 detail
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

const detailURL = "https://www.aiyifan.tv/play/Na5mm0pFZzP";
console.log("[1] nav detail:", detailURL);
await aiyi.goto(detailURL, { waitUntil: "domcontentloaded" }).catch(e=>console.log("nav err:", e.message));
await new Promise(r=>setTimeout(r, 5000));
console.log("at:", aiyi.url());

console.log("[2] click detail role card '📄'");
await sp.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const d = btns.find(b => (b.innerText||"").trim() === "📄");
  d?.click();
});
await new Promise(r=>setTimeout(r, 500));

const btnList = await sp.evaluate(() => [...document.querySelectorAll("button")]
  .map((b,i)=>({i, text:(b.innerText||"").trim(), disabled:b.disabled, visible:b.offsetParent!==null})));
const relevant = btnList.filter(b => b.text.includes("学习") || b.text.includes("AI") || b.text.includes("详情"));
console.log("[3] relevant buttons:", JSON.stringify(relevant, null, 2));

const clicked = await sp.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const learn = btns.find(b => (b.innerText||"").includes("规则学习"));
  if (learn) { learn.click(); return "规则学习"; }
  return "not-found";
});
console.log("[4] clicked:", clicked);

console.log("[5] wait for AI learn (25s)...");
await new Promise(r=>setTimeout(r, 25000));

const proj = await sp.evaluate(async () => {
  const s = await chrome.storage.local.get(null);
  return s["site2source:projects"]["www.aiyifan.tv"];
});
console.log("=== new detail ===");
console.log(JSON.stringify(proj.detail, null, 2));

await sp.screenshot({ path: "test-output/drive-02-detail.png", fullPage: true });
console.log("saved test-output/drive-02-detail.png");

await browser.disconnect();
