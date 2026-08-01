import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));
console.log("at:", aiyi.url());
await aiyi.setViewport({ width: 1400, height: 900 });
await aiyi.screenshot({ path: "test-output/drive-03-aiyifan-page.png", fullPage: false });

// 提取实际的关键元素结构
const info = await aiyi.evaluate(() => {
  const walk = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      tag: el.tagName,
      text: el.innerText?.slice(0,80),
      attrs: Array.from(el.attributes).map(a=>a.name+"="+(a.value||"").slice(0,40))
    };
  };
  // 尝试识别标题、简介、剧集、播放线路
  const candidates = {
    title_h1: walk("h1"), title_h2: walk("h2"), title_h4: walk("h4"),
    title_class_h4_h4: walk(".h4.h4"),
    videoInfo: walk("app-video-info"),
    tabsScope: [...document.querySelectorAll(".tab, .tabs, [class*='tab'], [class*='play-list'], [class*='playList'], [class*='episode']")]
      .slice(0,10).map(el=>({tag:el.tagName, cls:el.className, txt:(el.innerText||"").slice(0,50)})),
    iframeCount: document.querySelectorAll("iframe").length,
    iframeSrc: [...document.querySelectorAll("iframe")].map(i=>i.src).slice(0,3),
    imgWithData: [...document.querySelectorAll("img[data-src], img[data-original], img[data-echo]")].slice(0,3).map(i=>({src:i.src, ds:i.getAttribute("data-src"), do:i.getAttribute("data-original")})),
  };
  return candidates;
});
console.log(JSON.stringify(info, null, 2));
await browser.disconnect();
