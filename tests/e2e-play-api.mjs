/**
 * Site2Source E2E: 抓 aiyifan 详情/播放 API
 * 目的: 补齐播放链接生成
 */

import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const USER_DATA_DIR = "/tmp/s2s-play-test-profile";
const OUT_DIR = path.resolve(__dirname, "../test-output");

if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n🎬 抓 aiyifan 播放 API\n`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: USER_DATA_DIR,
  protocolTimeout: 90000,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  defaultViewport: { width: 1280, height: 800 },
});

function info(msg) { console.log(`   ${msg}`); }
function pass(msg) { console.log(`✅ ${msg}`); }

try {
  // 等扩展 id
  let extId;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
    if (ext) { extId = new URL(ext.url()).host; break; }
  }
  if (!extId) throw new Error("扩展未加载");
  pass(`扩展 ID: ${extId}`);

  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[s2s]")) info(`page: ${t.slice(0,150)}`);
  });

  info("打开首页...");
  await page.goto("https://www.aiyifan.tv/", { waitUntil: "domcontentloaded", timeout: 40000 });
  await new Promise((r) => setTimeout(r, 8000));

  // 找一个 /watch?v=xxx 链接点进去
  info("找并点击详情链接 /watch?v=xxx");
  const clicked = await page.evaluate(() => {
    const a = document.querySelector("a[href*='/watch?v=']");
    if (!a) return null;
    const href = a.href;
    a.click();
    return href;
  });
  info(`点击了: ${clicked}`);
  if (!clicked) throw new Error("没找到详情链接");

  await new Promise((r) => setTimeout(r, 8000));  // 等详情页 + play API

  info(`详情页 URL: ${page.url()}`);

  // 尝试点播放按钮触发 play API
  info("找并点击播放按钮");
  await page.evaluate(() => {
    const btns = document.querySelectorAll("button, [role='button'], .play, .btn-play, [class*='play']");
    for (const b of btns) {
      const text = (b.textContent || "").trim();
      if (/播放|play|观看/i.test(text) || b.className?.includes?.("play")) {
        b.click();
        return;
      }
    }
    // 尝试点视频区域
    const video = document.querySelector("video, .video-player, .player");
    if (video) video.click();
  });
  await new Promise((r) => setTimeout(r, 5000));

  // 拿完整 XHR (含 body)
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1500));

  const full = await popup.evaluate(async () => {
    const all = await chrome.storage.local.get(["site2source:xhr", "site2source:media"]);
    const xhrMap = all["site2source:xhr"] || {};
    const mediaMap = all["site2source:media"] || {};
    let xhrs = [];
    for (const arr of Object.values(xhrMap)) if (Array.isArray(arr)) xhrs = xhrs.concat(arr);
    let media = [];
    for (const arr of Object.values(mediaMap)) if (Array.isArray(arr)) media = media.concat(arr);
    return { xhrs, media };
  });

  info(`总共 ${full.xhrs.length} XHR, ${full.media.length} media`);

  // 筛出 play 相关
  const playXHR = full.xhrs.filter((x) => /play|detail|video/i.test(x.url || ""));
  info(`play/detail XHR: ${playXHR.length} 条`);

  for (const x of playXHR) {
    console.log(`\n--- ${x.method} ${x.respStatus} ${x.url}`);
    console.log(`   req headers keys: ${Object.keys(x.reqHeaders || {}).join(",").slice(0,120)}`);
    if (x.reqBody) console.log(`   reqBody: ${x.reqBody.slice(0, 300)}`);
    if (x.respBody) console.log(`   respBody[:400]: ${x.respBody.slice(0, 400)}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "aiyifan-play-xhr.json"),
    JSON.stringify({ xhrs: full.xhrs, media: full.media }, null, 2));
  pass(`保存 aiyifan-play-xhr.json`);

  await popup.close();
} catch (e) {
  console.log(`\n❌ ${e.message}`);
  console.log(e.stack?.split("\n").slice(0, 5).join("\n"));
}

await browser.close();
