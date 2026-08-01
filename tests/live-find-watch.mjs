import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));

await aiyi.goto("https://www.aiyifan.tv/", { waitUntil: "domcontentloaded" });
await new Promise(r=>setTimeout(r, 3500));

const links = await aiyi.evaluate(() => {
  const rec = document.querySelector("div.rec-track");
  if (!rec) return { err: "no rec-track" };
  const as = rec.querySelectorAll("a[href]");
  const uniq = [...new Set([...as].map(a=>a.href))].slice(0, 10);
  return { count: as.length, samples: uniq };
});
console.log(JSON.stringify(links, null, 2));

// 从 links[0] 深入
const sampleWatch = (await aiyi.evaluate(() => {
  const rec = document.querySelector("div.rec-track");
  const as = rec?.querySelectorAll("a[href*='/watch']") || [];
  return as[0]?.href || null;
}));
console.log("first watch link:", sampleWatch);
await browser.disconnect();
