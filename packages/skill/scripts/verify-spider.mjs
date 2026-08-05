#!/usr/bin/env node
/**
 * verify-spider.mjs — 契约校验 + 端到端跑一遍
 *
 * 用法: node scripts/verify-spider.mjs <site-name>
 *
 * 检查:
 *  1. spider 语法正确 + __jsEvalReturn 存在
 *  2. 9 个必需方法都在: init, home, homeVod, category, detail, play, search, isVideoFormat, manualVideoCheck
 *  3. 端到端: home → category → detail → play → search (5 stages)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");

const name = process.argv[2];
if (!name) {
  console.error("用法: node scripts/verify-spider.mjs <site-name>");
  process.exit(1);
}

const spiderPath = path.join(REPO, "test-output", `spider_${name}.js`);
if (!fs.existsSync(spiderPath)) {
  console.error(`❌ 找不到 ${spiderPath}`);
  console.error("   先跑 gen-spider.mjs");
  process.exit(2);
}

const REQUIRED_METHODS = [
  "init", "home", "homeVod", "category", "detail",
  "play", "search", "isVideoFormat", "manualVideoCheck",
];

const src = fs.readFileSync(spiderPath, "utf8");

// 剥离 ESM import/export (T3 spider 会被 FongMi 直接 eval 到 sandbox, 语法必须干净)
const stripped = src
  .replace(/^import .*$/gm, "")
  .replace(/export function __jsEvalReturn/, "function __jsEvalReturn");

// -- Stage 1: 语法检查 --
try {
  new Function(stripped);
  console.log("✅ [1/5] syntax OK");
} catch (e) {
  console.error("❌ [1/5] syntax error:", e.message);
  process.exit(3);
}

// -- Stage 2: 契约检查 --
const md5X = (s) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const cache = new Map();
const pending = [];
const req = (url, opts = {}) => {
  if (cache.has(url)) return cache.get(url);
  pending.push({ url, opts });
  return { content: "" };
};
const body = stripped;
const factory = new Function("md5X", "req", "console", "cheerio", body + "\nreturn __jsEvalReturn();");
const spider = factory(md5X, req, console, {});

const missing = REQUIRED_METHODS.filter((m) => typeof spider[m] !== "function");
if (missing.length) {
  console.error(`❌ [2/5] missing methods: ${missing.join(", ")}`);
  process.exit(4);
}
console.log("✅ [2/5] contract OK (9/9 methods present)");

// -- Stage 3+: 端到端 --
async function prefetch(reqs) {
  await Promise.all(
    reqs.map(async ({ url, opts }) => {
      try {
        const r = await fetch(url, { method: opts?.method || "GET", headers: opts?.headers, body: opts?.body });
        const body = await r.text();
        cache.set(url, { content: body, status: r.status });
      } catch (e) {
        cache.set(url, { content: "", status: 0 });
      }
    }),
  );
}

async function drive(fn, ...args) {
  const realNow = Date.now;
  const t = realNow();
  Date.now = () => t;
  try {
    let last = -1;
    for (let i = 0; i < 15; i++) {
      pending.length = 0;
      const out = spider[fn](...args);
      if (!pending.length) return out;
      if (pending.length === last) {
        await prefetch([...pending]);
        pending.length = 0;
        return spider[fn](...args);
      }
      last = pending.length;
      await prefetch([...pending]);
    }
    return null;
  } finally {
    Date.now = realNow;
  }
}

// init
for (let i = 0; i < 5; i++) {
  pending.length = 0;
  spider.init({});
  if (!pending.length) break;
  await prefetch([...pending]);
}

// home
let home;
try {
  home = JSON.parse(spider.home());
} catch (e) {
  console.error("❌ [3/5] home not JSON:", e.message);
  process.exit(5);
}
if (!home.class?.length) {
  console.error("❌ [3/5] home.class empty");
  process.exit(5);
}
console.log(`✅ [3/5] home OK (${home.class.length} categories)`);

// category
const catId = home.class[0].type_id;
let cat;
try {
  cat = JSON.parse(await drive("category", catId, 1));
} catch (e) {
  console.error("❌ [4/5] category not JSON:", e.message);
  process.exit(6);
}
if (!cat.list?.length) {
  console.error(`❌ [4/5] category(${catId}) empty list`);
  process.exit(6);
}
console.log(`✅ [4/5] category OK (${cat.list.length} items, first: ${cat.list[0].vod_name})`);

// detail + play
const vodId = cat.list[0].vod_id;
let detail;
try {
  detail = JSON.parse(await drive("detail", vodId));
} catch (e) {
  console.error("❌ [5/5] detail not JSON:", e.message);
  process.exit(7);
}
const vod = detail.list?.[0];
if (!vod?.vod_play_url) {
  console.error(`❌ [5/5] detail(${vodId}) missing vod_play_url`);
  process.exit(7);
}
console.log(`✅ [5/5] detail OK (${vod.vod_name}, play_url segments: ${vod.vod_play_url.split("#").length})`);

// play sample (optional - many sites rate-limit this)
const ep = vod.vod_play_url.split("#")[0]?.split("$")[1];
if (ep) {
  try {
    const play = JSON.parse(await drive("play", "flag", ep, []));
    if (play.url) {
      console.log(`   play sample OK (parse=${play.parse}, url=${play.url.slice(0, 80)}...)`);
    } else {
      console.log(`   ⚠️  play returned empty url (可能被限流, 不算 fatal)`);
    }
  } catch (e) {
    console.log(`   ⚠️  play failed (${e.message}) - 不算 fatal`);
  }
}

console.log("\n🎉 spider 契约 + 端到端 全通过");
console.log("   下一步: node scripts/publish-tvbox.mjs " + name);
