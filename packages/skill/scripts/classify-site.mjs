#!/usr/bin/env node
/**
 * classify-site.mjs — 分类目标站, 判断能否用本 skill
 *
 * 用法: node scripts/classify-site.mjs <url>
 *
 * 输出:
 *   maccms          — 有 /api.php/provide/vod, 直接 type=1
 *   api-signed      — SPA + 有明显签名 (query 含 vv/sign/token 等)
 *   api-open        — 开放 JSON API, 无签名
 *   static-mirror   — 单份 JSON dump
 *   dom-only        — 纯 SSR HTML, 无 XHR
 *   unsupported     — 其他 (Cloudflare Turnstile 之类)
 */
import { argv } from "node:process";

const url = argv[2];
if (!url) {
  console.error("用法: node scripts/classify-site.mjs <url>");
  process.exit(1);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const headers = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
const base = new URL(url).origin;

async function tryFetch(path, opts = {}) {
  try {
    const r = await fetch(base + path, { headers, ...opts });
    const body = await r.text();
    return { status: r.status, body, headers: Object.fromEntries(r.headers) };
  } catch (e) {
    return { status: 0, body: "", err: e.message };
  }
}

const results = [];

// 1. MacCMS 探测: /api.php/provide/vod
const maccms = await tryFetch("/api.php/provide/vod/?ac=list");
if (maccms.status === 200 && /"class"|"list"|"page"/.test(maccms.body.slice(0, 200))) {
  console.log("✅ maccms");
  console.log("   endpoint:", base + "/api.php/provide/vod");
  console.log("   → 直接给 tvbox 配一条 type=1 即可, 不需要 spider");
  process.exit(0);
}
results.push({ probe: "maccms", status: maccms.status, hit: false });

// 2. 抓首页, 看有没有 CF 拦截
const home = await tryFetch("/", { redirect: "follow" });
if (home.body.includes("error code: 1009")) {
  console.log("⚠️  cloudflare-geo-block");
  console.log("   → 需要挂 cf-proxy (references/proxy-config.md)");
  console.log("   继续分类...");
}
if (home.body.includes("Just a moment") || home.body.includes("cf-challenge")) {
  console.log("❌ unsupported");
  console.log("   Cloudflare Turnstile 挡了首页, 本 skill 处理不了");
  process.exit(2);
}

// 3. 看首页 HTML 特征
const html = home.body;
const hasSPA = /id="__next"|id="app"|id="root"/.test(html) && html.length < 10000;
const hasSSRList = /(vod|film|movie|video|drama).*(list|item)/i.test(html) && html.length > 30000;
const hasXHRHint = /fetch\s*\(|XMLHttpRequest|axios/.test(html);

// 4. 探常见 API 前缀
const apiProbes = [
  "/api/config", "/api/home", "/api/list",
  "/v3/home/config", "/v3/home/getAllVideo",   // aiyifan-style
  "/inc/api", "/data/index.json",              // 静态 mirror
];
for (const p of apiProbes) {
  const r = await tryFetch(p);
  if (r.status === 200 && r.body.trim().startsWith("{")) {
    // 有签名标志?
    const q = new URL(base + p);
    const isSigned = /[?&](vv|sign|token|_sign|signature)=/.test(html) ||
      /vv[a-z0-9]{8,}|sign[a-z0-9]{8,}/.test(html);
    if (isSigned) {
      console.log("✅ api-signed");
      console.log(`   sample endpoint: ${base + p}`);
      console.log("   → 参考 references/example-aiyifan.md 手写 SiteModel");
      process.exit(0);
    } else {
      console.log("✅ api-open");
      console.log(`   sample endpoint: ${base + p}`);
      console.log("   → 参考 references/example-open-api.md");
      process.exit(0);
    }
  }
}

// 5. 单 JSON dump 特征
const staticProbes = ["/data/index.json", "/data.json", "/data/all.json"];
for (const p of staticProbes) {
  const r = await tryFetch(p);
  if (r.status === 200 && r.body.length > 10000 && r.body.trim().startsWith("[")) {
    console.log("✅ static-mirror");
    console.log(`   dump: ${base + p} (${r.body.length}b)`);
    console.log("   → 参考 references/example-static-mirror.md");
    process.exit(0);
  }
}

// 6. Fallback
if (hasSSRList) {
  console.log("⚠️  dom-only (可能)");
  console.log("   首页有 SSR 内容但没找到 JSON API");
  console.log("   → 本 skill 不擅长, 建议用 browser-act 手抓");
} else if (hasSPA) {
  console.log("⚠️  spa-uncertain");
  console.log("   是 SPA 但没探到明显 API, 需要人肉打开 DevTools 抓包");
  console.log("   → 得到 curl/HAR 后再回来分类");
} else {
  console.log("❌ unsupported");
  console.log("   没识别出模式, 建议先手动打开 DevTools 观察");
}
process.exit(3);
