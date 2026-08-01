// 从 preview drawer 里拿 spider 内容
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

// preview drawer 里应该有代码显示；找 pre/code with spider content
const artifacts = await sp.evaluate(() => {
  // 尝试从 React state 拿 —— 找 previewArtifact
  // 简单点：找 body 里所有 pre / textarea
  const pres = [...document.querySelectorAll("pre, textarea")].map(el => ({
    tag: el.tagName, len: (el.value||el.innerText||"").length, sample: (el.value||el.innerText||"").slice(0, 200)
  }));
  return pres;
});
console.log("pre/textarea:", JSON.stringify(artifacts, null, 2));

// tabs 有 spider.js / tvbox.json — 试着点 spider.js tab
await sp.evaluate(() => {
  const btns = [...document.querySelectorAll("button, a, [role='tab'], [class*='tab']")];
  const t = btns.find(b => (b.innerText||"").trim().toLowerCase() === "spider.js");
  console.log("tab btn?", t?.innerText);
  if (t) t.click();
});
await new Promise(r=>setTimeout(r, 800));

const afterTab = await sp.evaluate(() => {
  const pres = [...document.querySelectorAll("pre, textarea, code")].filter(el => (el.value||el.innerText||"").length > 500);
  return pres.map(el => ({tag: el.tagName, len: (el.value||el.innerText||"").length, sample: (el.value||el.innerText||"").slice(0, 500)}));
});
console.log("after tab:", JSON.stringify(afterTab, null, 2));

// 拿全文
const full = await sp.evaluate(() => {
  const pres = [...document.querySelectorAll("pre, textarea, code")].filter(el => (el.value||el.innerText||"").length > 500);
  if (pres.length === 0) return null;
  const best = pres.sort((a,b)=> (b.value||b.innerText||"").length - (a.value||a.innerText||"").length)[0];
  return best.value || best.innerText;
});
if (full) {
  fs.writeFileSync("test-output/spider_www_aiyifan_tv.js", full);
  console.log(`saved spider (${full.length} bytes)`);
}
await browser.disconnect();
