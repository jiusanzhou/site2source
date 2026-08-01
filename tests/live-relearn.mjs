import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null, targetFilter: () => true });

// aiyi
const targets = browser.targets();
const aiyiT = targets.find(t => t.type() === "page" && t.url().includes("aiyifan.tv/play"));
const aiyi = await aiyiT.page();
console.log("aiyi:", aiyi.url());

// 新开 sidepanel tab (workaround: 只有 newPage().goto 能进 chrome-extension URL)
const sp = await browser.newPage();
await sp.setViewport({ width: 500, height: 900 });
await sp.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise(r=>setTimeout(r, 2000));
console.log("sp:", sp.url());

// 清老 detail
console.log("[1] clear old detail");
await sp.evaluate(async () => {
  return new Promise(r => chrome.runtime.sendMessage({type: "SAVE_STATE", state: {detail: {}}, replace: ["detail"]}, r));
});
await new Promise(r=>setTimeout(r, 500));

console.log("[2] reload aiyifan");
await aiyi.reload({ waitUntil: "domcontentloaded" });
await new Promise(r=>setTimeout(r, 4500));

console.log("[3] click detail + 规则学习");
await sp.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(b => (b.innerText||"").trim() === "📄");
  b?.click();
});
await new Promise(r=>setTimeout(r, 600));
const clicked = await sp.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find(b => (b.innerText||"").includes("规则学习"));
  if (b) { b.click(); return "OK"; } return "not-found";
});
console.log("clicked:", clicked);
await new Promise(r=>setTimeout(r, 4000));

const proj = await sp.evaluate(async () => {
  const s = await chrome.storage.local.get(null);
  return s["site2source:projects"]["www.aiyifan.tv"];
});
console.log("\n=== NEW detail ===");
console.log(JSON.stringify(proj.detail, null, 2));

console.log("\n=== Validation ===");
async function verify(sel, label) {
  if (!sel) return console.log(`⚪ ${label}: (empty)`);
  const r = await aiyi.evaluate((s) => {
    try {
      const el = document.querySelector(s);
      if (!el) return { hit: false };
      return { hit: true, tag: el.tagName, txt: (el.innerText || el.textContent || "").trim().slice(0, 120), cls: el.className.slice(0,60) };
    } catch(e) { return { err: e.message }; }
  }, sel);
  console.log(`   ${label}: ${sel.slice(0,80)}`);
  console.log(`     → ${JSON.stringify(r)}`);
}
await verify(proj.detail?.titleSelector, "title");
await verify(proj.detail?.descSelector, "desc");
await verify(proj.detail?.playTabSelector, "playTab");
await verify(proj.detail?.playListSelector, "playList");
console.log(`   playItem: ${proj.detail?.playItemSelector || "(empty)"}`);

await browser.disconnect();
