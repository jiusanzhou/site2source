// 从 e2e-real-site 抓的 XHR 里挑一条完整跑一遍我们的分析 pipeline
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const USER_DATA_DIR = "/tmp/s2s-real-test-profile"; // 复用上一次的 profile
const OUT_DIR = path.resolve(__dirname, "../test-output");
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: USER_DATA_DIR,
  protocolTimeout: 60000,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    "--no-first-run",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
  defaultViewport: { width: 1280, height: 800 },
});

let extId;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
  if (ext) { extId = new URL(ext.url()).host; break; }
}
console.log(`扩展 ID: ${extId}`);

// 打开 aiyifan.tv 制造 XHR
const page = await browser.newPage();
console.log("访问 aiyifan.tv...");
try {
  await page.goto("https://www.aiyifan.tv/", { waitUntil: "domcontentloaded", timeout: 30000 });
} catch (e) {
  console.log("goto 超时, 继续");
}
await new Promise((r) => setTimeout(r, 8000));
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise((r) => setTimeout(r, 1500));
}
try {
  await page.evaluate(() => {
    const a = document.querySelector("a[href*='/movie'], a[href*='/list'], a[href*='/detail']");
    if (a) a.click();
  });
  await new Promise((r) => setTimeout(r, 5000));
} catch {}

// 走 API 抓包分析 pipeline
const popup = await browser.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 1500));

const result = await popup.evaluate(async () => {
  const all = await chrome.storage.local.get(["site2source:xhr"]);
  const xhrMap = all["site2source:xhr"] || {};
  let xhrs = [];
  for (const arr of Object.values(xhrMap)) if (Array.isArray(arr)) xhrs = xhrs.concat(arr);

  // 找一个 getIndexVideo/Search 的响应
  const listAPI = xhrs.find((x) => /getIndexVideo|getAllVideo|list.Search/i.test(x.url));
  if (!listAPI) return { error: "no list api found", total: xhrs.length };

  return {
    total: xhrs.length,
    picked: {
      url: listAPI.url,
      method: listAPI.method,
      status: listAPI.respStatus,
      ct: listAPI.respContentType,
      bodyLen: listAPI.respBody?.length || 0,
      body: listAPI.respBody,
      truncated: listAPI.respTruncated,
    },
  };
});

if (result.error) {
  console.log(`❌ ${result.error}, 抓到 ${result.total} 条 XHR`);
} else {
  console.log(`\n📊 挑选的 API: ${result.picked.url}`);
  console.log(`   method=${result.picked.method} status=${result.picked.status}`);
  console.log(`   body=${result.picked.bodyLen} bytes truncated=${result.picked.truncated}`);

  // 保存响应体
  fs.writeFileSync(path.join(OUT_DIR, "aiyifan-response.json"), result.picked.body);
  console.log(`\n💾 响应体存到 test-output/aiyifan-response.json`);

  // 先在 popup 里直接跑我们的 json-analyzer
  const analysis = await popup.evaluate(async (body) => {
    // 动态加载 analyzer (它是纯函数, 可以从 storage.local eval)
    // 更简单: 我们直接 fetch 它
    const src = await fetch(chrome.runtime.getURL("static/background/index.js")).then(r => r.text()).catch(() => null);
    if (!src) return { error: "no source" };

    // json-analyzer 逻辑: 走个简单版
    let data;
    try { data = JSON.parse(body); } catch { return { error: "not json" }; }

    // 找列表数组
    const fields = [];
    const visit = (obj, pathStr, depth) => {
      if (depth > 4 || obj == null) return;
      if (Array.isArray(obj)) {
        if (obj.length > 0 && typeof obj[0] === "object" && obj[0] != null) {
          fields.push({ path: pathStr, kind: "list", len: obj.length, sampleKeys: Object.keys(obj[0]).slice(0, 20) });
        }
        return;
      }
      if (typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          visit(v, pathStr ? `${pathStr}.${k}` : `$.${k}`, depth + 1);
        }
      }
    };
    visit(data, "", 0);
    return { topKeys: Object.keys(data).slice(0, 10), fields };
  }, result.picked.body);

  console.log(`\n📊 顶层 keys: ${JSON.stringify(analysis.topKeys)}`);
  console.log(`\n📊 检测到的数组字段:`);
  for (const f of analysis.fields || []) {
    console.log(`   ${f.path} · ${f.len} 项 · keys: ${JSON.stringify(f.sampleKeys?.slice(0, 12))}`);
  }
}

await browser.close();
