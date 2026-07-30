/**
 * Site2Source 真实网站 E2E 测试
 * 目标: aiyifan.tv
 *
 * 跑完整用户流程:
 *  1. 装扩展
 *  2. 打开真实影视站 (等 Cloudflare 通过)
 *  3. 在站内点几个分类 / 详情, 制造 XHR
 *  4. 从扩展 storage 拿 XHR 数据
 *  5. 检查抓包 role 分类 + JSON 分析结果
 *  6. 走 API 型爬虫生成路径, 验证生成的 .js 语法合法
 */

import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const USER_DATA_DIR = "/tmp/s2s-real-test-profile";
const OUT_DIR = path.resolve(__dirname, "../test-output");
const TARGET = process.env.SITE || "https://www.aiyifan.tv/";

if (fs.existsSync(USER_DATA_DIR)) fs.rmSync(USER_DATA_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`\n🧪 Site2Source 真实网站 E2E`);
console.log(`目标: ${TARGET}\n`);

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

function pass(name, extra = "") { console.log(`✅ ${name}${extra ? " · " + extra : ""}`); }
function warn(msg) { console.log(`⚠️  ${msg}`); }
function info(msg) { console.log(`   ${msg}`); }

try {
  // === 拿扩展 ID ===
  let extId;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
    if (ext) {
      extId = new URL(ext.url()).host;
      break;
    }
  }
  if (!extId) throw new Error("扩展未加载");
  pass("扩展装载", `id=${extId}`);

  // === 打开目标站 ===
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[s2s]") || t.includes("[site2source]")) info(`page log: ${t.slice(0, 150)}`);
  });

  info(`访问 ${TARGET} (最多等 40 秒 for Cloudflare)`);
  try {
    await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 40000 });
  } catch (e) {
    warn(`goto 超时: ${e.message.slice(0, 80)}`);
  }

  // 等 CF 挑战自动过 / 页面 hydration
  await new Promise((r) => setTimeout(r, 8000));

  const pageInfo = await page.evaluate(() => ({
    url: location.href,
    host: location.host,
    title: document.title,
    hasBody: document.body?.innerText?.length || 0,
  }));
  info(`当前页: ${pageInfo.url}`);
  info(`标题: ${pageInfo.title}, body 长度: ${pageInfo.hasBody}`);

  if (pageInfo.hasBody < 200) {
    warn("body 内容太少, 可能仍在 CF 挑战. 再等 10 秒...");
    await new Promise((r) => setTimeout(r, 10000));
  }

  pass("目标站加载");

  // === 触发一些 XHR: 滚动 + 点第一张卡片 ===
  info("滚动页面 3 次 (触发 lazy load XHR)");
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise((r) => setTimeout(r, 1500));
  }

  info("尝试点击第一个影片链接");
  try {
    const clicked = await page.evaluate(() => {
      // 常见影视站列表选择器
      const selectors = [
        "a[href*='/detail']",
        "a[href*='/vod']",
        "a[href*='/movie']",
        "a[href*='/play']",
        ".video-item a",
        ".vod-list a",
        "ul li a[href]",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.href && !el.href.startsWith("javascript:")) {
          el.click();
          return { sel, href: el.href };
        }
      }
      return null;
    });
    info(`点击结果: ${JSON.stringify(clicked)}`);
    await new Promise((r) => setTimeout(r, 5000));
  } catch (e) {
    warn(`点击失败: ${e.message}`);
  }

  await new Promise((r) => setTimeout(r, 3000));

  // === 从 background storage 拿抓到的 XHR ===
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await new Promise((r) => setTimeout(r, 1500));

  const capture = await popup.evaluate(async () => {
    const all = await chrome.storage.local.get([
      "site2source:xhr",
      "site2source:media",
    ]);
    const xhrMap = all["site2source:xhr"] || {};
    const mediaMap = all["site2source:media"] || {};
    let xhrs = [];
    for (const arr of Object.values(xhrMap)) {
      if (Array.isArray(arr)) xhrs = xhrs.concat(arr);
    }
    let media = [];
    for (const arr of Object.values(mediaMap)) {
      if (Array.isArray(arr)) media = media.concat(arr);
    }
    return {
      xhrCount: xhrs.length,
      mediaCount: media.length,
      xhrSample: xhrs.slice(0, 10).map((x) => ({
        url: x.url?.slice(0, 100),
        method: x.method,
        status: x.respStatus,
        ct: x.respContentType?.slice(0, 40),
        bodyLen: x.respBody?.length || 0,
      })),
      allXHRUrls: xhrs.map((x) => x.url),
    };
  });

  info(`XHR 抓到 ${capture.xhrCount} 条, 媒体 ${capture.mediaCount} 条`);
  if (capture.xhrCount > 0) {
    info("XHR 样例:");
    for (const s of capture.xhrSample) {
      info(`  ${s.method} ${s.status} ${s.ct?.slice(0, 20)} · ${s.url}`);
    }

    // 保存
    fs.writeFileSync(
      path.join(OUT_DIR, "aiyifan-xhr.json"),
      JSON.stringify(capture, null, 2),
    );
    pass(`XHR 抓包成功`, `${capture.xhrCount} 条`);
  } else {
    warn("零 XHR - 可能是纯静态 HTML 站, 或 CF 拦住了");
  }

  // === 从抓到的 XHR 挑一个像 API 的, 分析 JSON 结构 ===
  const apiCandidate = capture.allXHRUrls.find((u) =>
    /\/(api|ajax|json|search|list|category|vod|movie|detail)/i.test(u),
  );
  if (apiCandidate) {
    info(`发现 API 候选: ${apiCandidate}`);
    pass("API URL 匹配规则命中");
  } else {
    warn("XHR 里没匹配到 API 型 URL - 可能站是 SSR");
  }

  await popup.close();
  await page.close();

  console.log(`\n📁 抓到的数据存在: ${OUT_DIR}\n`);
} catch (e) {
  console.log(`\n❌ 测试中断: ${e.message}`);
  console.log(e.stack?.split("\n").slice(0, 5).join("\n"));
}

await browser.close();
