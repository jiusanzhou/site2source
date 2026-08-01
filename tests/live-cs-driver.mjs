// 用 content-script 环境: aiyifan tab 已注入了扩展 content-script
// 可以通过 chrome.runtime.sendMessage 唤醒 sw 并驱动一切
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url() === "https://www.aiyifan.tv/play/Na5mm0pFZzP" || p.url().includes("/play/"));

if (!aiyi) throw new Error("no aiyifan play page");
console.log("driving via aiyifan tab:", aiyi.url());

// content-script 的 world 是 ISOLATED，直接 evaluateOnNewDocument 或 evaluate 走 main world
// 但 chrome.runtime 在 content-script 里可用 —— page.evaluateHandle 拿不到

// 换方式: 直接 executeAsync 到 content-script 世界？
// puppeteer 里 page.evaluate 默认在 main world，看不到 chrome.runtime
// 需要在 content-script isolated world 里执行

// 试着找已注入的 content script 世界: 用 Runtime.executionContextsCreated 或者读所有 execution contexts
const cdp = await aiyi.target().createCDPSession();
await cdp.send("Runtime.enable");
const contexts = new Map();
cdp.on("Runtime.executionContextCreated", (e) => {
  contexts.set(e.context.id, e.context);
  console.log("ctx:", e.context.id, e.context.name, e.context.auxData?.type);
});
// force
await aiyi.reload({ waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 3500));
console.log("all contexts:");
for (const [id, ctx] of contexts) console.log(" ", id, "|", ctx.name, "|", JSON.stringify(ctx.auxData));

// content-script isolated world 名字通常 "extension-content-script" or "isolated_x"
// puppeteer 有 API: page.executionContexts() ? or _frameManager
// 简单点：evaluate 一段代码，但用 --isolatedWorldId
// 或者直接: 在 content-script 里注册的 message listener 可以从 page world postMessage 触发
// 更简单：找到 content-script 的 context id, 用 Runtime.evaluate 指定 contextId
const csCtx = [...contexts.values()].find(c => c.name && (c.name.includes("Plasmo") || c.name.includes("scripts/inspector") || c.auxData?.type === "isolated"));
console.log("cs ctx:", csCtx);

if (csCtx) {
  const r = await cdp.send("Runtime.evaluate", {
    contextId: csCtx.id,
    expression: `chrome.runtime.sendMessage({type:"GET_STATE"}, r => console.log("STATE:", JSON.stringify(r).slice(0,300)))`,
    awaitPromise: true,
    returnByValue: true,
  }).catch(e => ({err: e.message}));
  console.log("sendMessage result:", r);
}
await browser.disconnect();
