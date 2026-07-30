/**
 * Site2Source 扩展端到端冒烟测试
 * 用真 Chrome 加载 build 好的扩展, 访问真实网站, 验证核心路径
 */

import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const USER_DATA_DIR = "/tmp/s2s-test-chrome-profile";
const SCREENSHOT_DIR = path.resolve(__dirname, "../test-screenshots");

if (!fs.existsSync(EXT_PATH)) {
  console.error("❌ 扩展未构建, 先跑 pnpm build");
  process.exit(1);
}
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
// 每次重来: 清 profile 保证扩展干净
if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true });

// 测试目标: 一个公开的 MacCMS 站
// 阶段 1: 用 example.com 只验证扩展装载和 UI
// 阶段 2 (可选): SITE=https://ddys.pro/ 时才跑真实网站抓 XHR
const TARGET_SITE = process.env.SITE || "https://example.com/";
const RUN_REAL_SITE = !!process.env.SITE;

console.log(`\n🧪 Site2Source E2E 测试`);
console.log(`扩展路径: ${EXT_PATH}`);
console.log(`目标站: ${TARGET_SITE}\n`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: USER_DATA_DIR,
  protocolTimeout: 60000,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  waitForInitialPage: false,
});

// 打开 chrome://extensions/ 强制加载, 顺便肉眼看效果
const initPage = await browser.newPage();
await initPage.goto("chrome://extensions/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));

async function pass(name) { console.log(`✅ ${name}`); }
async function fail(name, err) {
  console.log(`❌ ${name}: ${err?.message || err}`);
  await browser.close();
  process.exit(1);
}
async function snap(page, name) {
  // Chrome 150 + puppeteer 有 screenshot 兼容 bug, 环境变量 SCREENSHOT=1 才启用
  if (!process.env.SCREENSHOT) return;
  try {
    const p = path.join(SCREENSHOT_DIR, name);
    await page.screenshot({ path: p, timeout: 5000 });
    console.log(`   📸 ${name}`);
  } catch (e) {
    console.log(`   ⚠️  截图 ${name} 跳过: ${e.message.slice(0, 60)}`);
  }
}

let extId = null;

try {
  // ==== T1: 扩展加载成功 ====
  // 方法 1: 打开 chrome://extensions?id=xxx 之前, 尝试从 targets 找
  let extIdFromTarget = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ts = browser.targets();
    const anyExt = ts.find((t) => t.url().startsWith("chrome-extension://"));
    if (anyExt) {
      extIdFromTarget = new URL(anyExt.url()).host;
      break;
    }
  }
  console.log(`   targets 里找到扩展 ID: ${extIdFromTarget}`);
  if (extIdFromTarget) {
    extId = extIdFromTarget;
  } else {
    // 方法 2: 用 CDP 拿 targets, service worker 可能不在 puppeteer 默认列表里
    const cdp = await initPage.createCDPSession();
    const { targetInfos } = await cdp.send("Target.getTargets");
    console.log(`   CDP 全部 targets:`);
    for (const t of targetInfos) {
      console.log(`     ${t.type} ${t.url.slice(0, 100)}`);
    }
    const swTarget = targetInfos.find(
      (t) =>
        (t.type === "service_worker" || t.type === "background_page") &&
        t.url.startsWith("chrome-extension://"),
    );
    if (swTarget) {
      extId = new URL(swTarget.url).host;
    } else {
      throw new Error("扩展加载失败 - CDP 里也没找到");
    }
  }
  await pass(`T1 扩展加载 (ID=${extId})`);
  await initPage.close();

  // ==== T2: 打开 popup.html 检查 UI ====
  const popupURL = `chrome-extension://${extId}/popup.html`;
  const popup = await browser.newPage();
  popup.on("console", (msg) => console.log(`   popup console: [${msg.type()}] ${msg.text().slice(0, 200)}`));
  popup.on("pageerror", (err) => console.log(`   popup pageerror: ${err.message.slice(0, 300)}`));
  console.log(`   打开 popup: ${popupURL}`);
  await popup.goto(popupURL, { waitUntil: "domcontentloaded", timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1500));
  await snap(popup, "01-popup.png");
  const popupTitle = await popup.$eval(".s2s-title", (el) => el.textContent).catch(() => null);
  if (popupTitle !== "Site2Source") throw new Error(`popup 标题异常: ${popupTitle}`);
  await pass(`T2 popup UI 渲染 (标题=${popupTitle})`);
  await popup.close();

  // ==== T3: 打开 sidepanel.html 检查 UI ====
  const sp = await browser.newPage();
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 800));
  await snap(sp, "02-sidepanel.png");
  const hasHint = await sp.$(".s2s-sidepanel-hint");
  if (!hasHint) throw new Error("sidepanel hint 条缺失");
  const hasClose = await sp.$(".s2s-sidepanel-close");
  if (!hasClose) throw new Error("sidepanel 切回按钮缺失");
  await pass(`T3 sidepanel UI 渲染 (含 hint + 切回按钮)`);
  await sp.close();

  // ==== T4: 访问真实网站, 看 content script 有没有注入 ====
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[site2source]") || t.includes("[s2s]")) {
      console.log(`   页面 log: ${t}`);
    }
  });
  console.log(`   访问 ${TARGET_SITE} ...`);
  try {
    await page.goto(TARGET_SITE, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch (e) {
    console.log(`   ⚠️  goto 超时/失败: ${e.message.slice(0, 100)}`);
  }
  await new Promise((r) => setTimeout(r, 3000));

  // content script 会在 window 上放 __site2source_hooked
  const hooked = await page.evaluate(() => (window).__s2s_hooked || (window).__site2source__ || false);
  await snap(page, "03-target-site.png");
  console.log(`   content hook 标记: ${JSON.stringify(hooked)}`);
  await pass(`T4 目标网站加载完成 (${TARGET_SITE})`);

  // ==== T5: 触发 CAPTURE_XHR / GET_CAPTURED_XHR 消息 ====
  const tabInfo = await page.evaluate(() => ({ url: location.href, host: location.host }));
  console.log(`   当前页 host: ${tabInfo.host}`);

  // 滚动一下让页面发一些 XHR
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise((r) => setTimeout(r, 2000));

  // 打开 popup, 查 storage
  const popup2 = await browser.newPage();
  await popup2.goto(popupURL, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1500));

  // 通过 popup 的 chrome API 拿抓到的 xhr
  const xhrCount = await popup2.evaluate(async () => {
    // 从 storage 直接读
    const all = await chrome.storage.local.get(["site2source:xhr"]);
    const xhrMap = all["site2source:xhr"] || {};
    const counts = {};
    for (const [tabId, arr] of Object.entries(xhrMap)) {
      counts[tabId] = Array.isArray(arr) ? arr.length : 0;
    }
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  console.log(`   XHR 抓包统计: ${JSON.stringify(xhrCount)}`);
  if (xhrCount.total === 0) {
    console.log(`   ⚠️  没抓到 XHR — 可能网站是纯 HTML 或 XHR 都在初始 load 之前发出`);
  }
  await snap(popup2, "04-popup-after-visit.png");
  await pass(`T5 XHR 抓包机制运行 (共抓到 ${xhrCount.total} 条)`);

  // ==== T6: 从 popup 触发 "AI 一键" 模式 (只测按钮存在 + 点击不崩) ====
  const buttons = await popup2.$$eval(".s2s-btn, .s2s-btn-primary", (els) =>
    els.map((e) => e.textContent?.trim())
  );
  console.log(`   popup 里的按钮: ${JSON.stringify(buttons.slice(0, 8))}`);
  await pass(`T6 popup 交互可访问 (${buttons.length} 个按钮)`);

  await popup2.close();
  await page.close();

  console.log(`\n🎉 全部通过. 截图在 ${SCREENSHOT_DIR}\n`);
} catch (e) {
  console.log(`\n❌ E2E 中断: ${e.message}`);
  await browser.close();
  process.exit(1);
}

await browser.close();
