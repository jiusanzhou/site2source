// 用 headless chromium 打开 aiyifan 首页，直接跑 detect 逻辑（复刻 inspector 的搜索识别）
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

// 找系统里的 chromium
const paths = [
  "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const fs = await import("node:fs");
const exe = paths.find(p => fs.existsSync(p));
if (!exe) { console.log("no chrome"); process.exit(1); }

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("https://www.aiyifan.tv/", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

const result = await page.evaluate(() => {
  const isSearchInput = (i) => {
    const n = (i.name || "").toLowerCase();
    const t = (i.type || "").toLowerCase();
    const p = (i.placeholder || "").toLowerCase();
    const id = (i.id || "").toLowerCase();
    const cls = (i.className || "").toLowerCase();
    const aria = (i.getAttribute("aria-label") || "").toLowerCase();
    return (
      t === "search" ||
      (n && /(wd|keyword|q|search|s|key|word)/.test(n)) ||
      /search|搜索|查找|关键词/.test(p) ||
      /search|搜索/.test(aria) ||
      /(^|[\s_-])(search|srch)([\s_-]|$)/.test(id) ||
      /(^|\s)(search|srch)(\s|$)/.test(cls)
    );
  };

  const forms = Array.from(document.querySelectorAll("form"));
  const formInputs = forms.flatMap(f => Array.from(f.querySelectorAll("input")).filter(isSearchInput));
  const allInputs = Array.from(document.querySelectorAll("input")).filter(isSearchInput);
  const roleSearchboxes = Array.from(document.querySelectorAll('[role="searchbox"]'));

  const describe = (el) => ({
    tag: el.tagName,
    type: el.type,
    name: el.name,
    placeholder: el.placeholder,
    id: el.id,
    cls: el.className,
    ariaLabel: el.getAttribute("aria-label"),
    rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x|0, y: r.y|0, w: r.width|0, h: r.height|0 }; })(),
    parent: el.parentElement?.tagName + "." + (el.parentElement?.className||"").slice(0,60),
  });

  return {
    formInputs: formInputs.map(describe),
    allSearchInputs: allInputs.map(describe),
    roleSearchboxes: roleSearchboxes.map(describe),
    totalInputs: document.querySelectorAll("input").length,
    totalForms: forms.length,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
