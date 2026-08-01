// 步骤 1：先把 aiyifan 切到一个详情页（不是 /play 播放页，是 /watch）
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();

const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));
const sp = pages.find(p => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

// 1) 先去首页找一个 watch 链接
console.log("[1] navigate home");
await aiyi.goto("https://www.aiyifan.tv/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e=>console.log("nav err:", e.message));
await new Promise(r=>setTimeout(r, 3000));

const detailURL = await aiyi.evaluate(() => {
  const a = document.querySelector('a[href*="/watch"]') || document.querySelector('a[href*="/play"]');
  return a ? a.href : null;
});
console.log("found detail URL:", detailURL);

if (detailURL) {
  console.log("[2] navigate to detail");
  await aiyi.goto(detailURL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(e=>console.log("nav err:", e.message));
  await new Promise(r=>setTimeout(r, 4000));
  console.log("aiyifan now at:", aiyi.url());

  // 页面上文章标题
  const info = await aiyi.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1,h2,h3,h4')?.innerText?.slice(0,80),
    imgs: document.querySelectorAll('img').length,
    videos: document.querySelectorAll('video').length,
    iframes: document.querySelectorAll('iframe').length,
  }));
  console.log("page info:", JSON.stringify(info));
}

await browser.disconnect();
