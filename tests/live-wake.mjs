// 完整流程 v2: 首页AI分析 → 详情AI分析(测新代码) → 生成 spider
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();

let aiyi = pages.find(p => p.url().includes("aiyifan.tv"));

// 打开 sidepanel: 用扩展 API 从 aiyifan tab context 里调
console.log("[0] wake extension: click extension icon (via chrome API from a normal page)...");
// 无法直接 click icon 打开 sidepanel, 但可以让 sw 起来 —— 打开 chrome-extension 页面被拦截
// 试着让 aiyifan 的 content-script 发消息唤醒 sw
try {
  await aiyi.evaluate(() => {
    // content-script 的 window 环境里可以访问 chrome.runtime
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "GET_STATE" }, (r) => {
        console.log("wake resp:", r);
      });
    }
  });
} catch(e) { console.log("wake err:", e.message); }

await new Promise(r=>setTimeout(r, 2000));

// 现在应该有 sw target
const rs = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const swTarget = rs.find(t => t.type === "service_worker" && t.url.includes(EXT_ID));
console.log("sw?", !!swTarget);

// 让 sw 打开 sidepanel
if (swTarget) {
  // 通过 CDP 直接 attach service_worker 并 evaluate
  const CDP = await import("/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js").then(m => m.default);
  // 用 raw ws
  const WebSocket = (await import("node:events")).EventEmitter; // fallback
  // 简单方式：从 aiyifan 页 sendMessage("OPEN_SIDEPANEL")
  await aiyi.evaluate(async () => {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      const tabs = await new Promise(r => chrome.runtime.sendMessage({type:"GET_STATE"}, r));
      console.log("state:", tabs);
    }
  });
}

// 用 puppeteer 打新 tab 到 sidepanel URL
try {
  const np = await browser.newPage();
  await np.goto(`chrome-extension://${EXT_ID}/sidepanel.html`, { waitUntil: "domcontentloaded" });
  console.log("sidepanel loaded as tab");
  await new Promise(r=>setTimeout(r, 1500));
} catch (e) { console.log("open sp err:", e.message); }

// 列出所有页
const pages2 = await browser.pages();
console.log("pages:");
for (const p of pages2) console.log(" -", p.url().slice(0, 100));

await browser.disconnect();
