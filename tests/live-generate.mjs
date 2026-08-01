// 试试直接点 "🔍 生成并预览" 看会怎样
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

// 关掉所有已展开的卡（点空白处），先看当前
console.log("[1] click 生成并预览");
const r = await sp.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const gen = btns.find(b => (b.innerText||"").includes("生成并预览"));
  console.log("gen btn?", gen?.innerText);
  if (gen) { gen.click(); return "clicked"; }
  return "not-found";
});
console.log("clicked:", r);

await new Promise(r => setTimeout(r, 2500));

// 是否有 preview drawer 弹出
const info = await sp.evaluate(() => {
  const drawers = document.querySelectorAll("[class*='drawer'], [class*='Drawer'], [class*='modal'], [class*='Modal']");
  const notices = document.querySelectorAll("[class*='notice'], [class*='toast'], [class*='alert']");
  return {
    drawers: [...drawers].map(el=>({cls:el.className, text:(el.innerText||"").slice(0,200)})),
    notices: [...notices].map(el=>({cls:el.className, text:(el.innerText||"").slice(0,200)})),
    // 找所有含 "spider" "artifact" 内容的元素
    codeBlocks: [...document.querySelectorAll("pre, code")].map(el=>({tag:el.tagName, text:(el.innerText||"").slice(0,150)})).slice(0,5)
  };
});
console.log(JSON.stringify(info, null, 2));

await sp.screenshot({ path: "test-output/drive-04-generate.png", fullPage: true });
console.log("saved test-output/drive-04-generate.png");

await browser.disconnect();
