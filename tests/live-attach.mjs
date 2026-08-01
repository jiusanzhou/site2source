/**
 * 附加到 live 会话, 打开 sidepanel 截图看状态
 */
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../test-output");

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:19222",
  defaultViewport: null,
  targetFilter: (t) => true, // 包含 service_worker
});

// 先通过 CDP HTTP 拿 ext id
const rs = await fetch("http://127.0.0.1:19222/json/list").then(r => r.json());
const extRec = rs.find(t => t.url && t.url.startsWith("chrome-extension://"));
const extId = new URL(extRec.url).host;
console.log("ext id:", extId);

// 打开 sidepanel.html 页面 (直接以扩展页方式打开)
const pages = await browser.pages();
const p = pages[0]; // aiyifan
// 先等几秒抓包
await new Promise(r => setTimeout(r, 3000));

// 用扩展 API 打开 sidepanel 在这个 tab 上
// 但从外面调 API 不方便, 直接新开一个页面加载 sidepanel.html 也能看
const spPage = await browser.newPage();
await spPage.setViewport({ width: 500, height: 900 });
await spPage.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 2000));
await spPage.screenshot({ path: `${OUT}/v22-live-empty.png`, fullPage: true });
console.log("saved v22-live-empty");

// 让 aiyifan 触发几个 XHR — 等 5 秒
await p.bringToFront();
await new Promise(r => setTimeout(r, 5000));

// 再截一张 sidepanel
await spPage.bringToFront();
await spPage.reload({ waitUntil: "domcontentloaded" });
await new Promise(r => setTimeout(r, 2000));
await spPage.screenshot({ path: `${OUT}/v22-live-with-xhr.png`, fullPage: true });
console.log("saved v22-live-with-xhr");

await browser.disconnect();
