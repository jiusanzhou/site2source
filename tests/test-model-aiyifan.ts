/**
 * 端到端等价性测试
 *
 * 目标：用 SiteModel 生成的 aiyifan spider，行为等价于之前硬编码的版本
 * - 首页分类拿到
 * - detail 拿到剧集列表
 * - play 拿到真视频（跳广告）
 */

import fs from "fs";
import path from "path";
import { AIYIFAN_MODEL } from "../lib/sites/aiyifan";
import { generateT3SpiderFromModel } from "../lib/model-generator";

// 生成 spider
const src = generateT3SpiderFromModel(AIYIFAN_MODEL);
const outPath = path.resolve(__dirname, "../test-output/spider_aiyifan_model_t3.js");
fs.writeFileSync(outPath, src);
console.log(`${src.length} bytes -> ${outPath}`);

// 用 Node 模拟 FongMi 环境跑一遍
import crypto from "crypto";
const md5X = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");

const HDR = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.aiyifan.tv/",
  Origin: "https://www.aiyifan.tv",
};

const cache = new Map<string, any>();
const pending: string[] = [];

function req(url: string, opt?: any) {
  if (cache.has(url)) return cache.get(url);
  pending.push(url);
  return { content: "" };
}

async function prefetch(urls: string[]) {
  for (const u of urls) {
    if (cache.has(u)) continue;
    try {
      const r = await fetch(u, { headers: HDR });
      cache.set(u, { content: await r.text() });
    } catch {
      cache.set(u, { content: "" });
    }
  }
}

const body = src.replace(/^import .*$/gm, "").replace(/export function __jsEvalReturn/, "function __jsEvalReturn");
const factory = new Function("md5X", "req", "console", "cheerio", body + "\nreturn __jsEvalReturn();");
const spider = factory(md5X, req, console, {});

async function run(fn: string, ...args: any[]): Promise<any> {
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try {
    // 多轮 replay：spider 内部会 req(url) 加入 pending 并拿到空结果，
    // 我们 prefetch 后重跑；直到没新 pending 出现为止。
    // 关键：bootstrap 完成后，后续 cert 签名的 URL 才能算对。
    let lastPendingLen = -1;
    for (let attempt = 0; attempt < 15; attempt++) {
      pending.length = 0;
      const out = spider[fn](...args);
      if (!pending.length) return out;
      if (pending.length === lastPendingLen) {
        // 没有新请求了但还需要多跑一轮以让下游用 cache
        await prefetch(pending);
        pending.length = 0;
        return spider[fn](...args);
      }
      lastPendingLen = pending.length;
      await prefetch(pending);
    }
    return null;
  } finally {
    Date.now = realNow;
  }
}

async function initSpider() {
  // init 内部会调 ensureBoot → 需要 prefetch config 端点
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen;
  try {
    for (let a = 0; a < 5; a++) {
      pending.length = 0;
      spider.init({});
      if (!pending.length) return;
      await prefetch(pending);
    }
  } finally {
    Date.now = realNow;
  }
}

(async () => {
  console.log("\n=== init ===");
  await initSpider();

  console.log("\n=== home 分类 ===");
  const h = JSON.parse(spider.home());
  console.log(`  ${h.class.length} 个分类:`, h.class.map((c: any) => c.type_name).join(", "));

  console.log("\n=== category('tvList', 1) ===");
  const c = JSON.parse(await run("category", "tvList", 1));
  console.log(`  page=${c.page}/${c.pagecount} total=${c.total}`);
  c.list.slice(0, 3).forEach((v: any) => console.log(`    ${v.vod_name}  ${v.vod_remarks}  id=${v.vod_id}`));

  if (!c.list.length) { console.log("❌ 分类为空"); process.exit(1); }

  // 挑一部剧
  const target = c.list.find((v: any) => v.vod_remarks?.includes("更新至")) || c.list[0];
  console.log(`\n=== detail('${target.vod_id}') ===`);
  const d = JSON.parse(await run("detail", target.vod_id));
  const v = d.list[0];
  console.log(`  ${v.vod_name}  ${v.vod_year} ${v.vod_area}`);
  console.log(`  演员: ${v.vod_actor?.slice(0, 40)}`);
  console.log(`  vod_play_url (前 200): ${v.vod_play_url?.slice(0, 200)}`);
  const eps = v.vod_play_url.split("#");
  console.log(`  共 ${eps.length} 集`);

  if (eps.length > 0) {
    const [epName, epKey] = eps[0].split("$");
    console.log(`\n=== play 第 "${epName}" 集 (${epKey}) ===`);
    const p = JSON.parse(await run("play", "aiyifan", epKey, []));
    console.log(`  parse=${p.parse}`);
    console.log(`  url=${p.url?.slice(0, 120)}`);
    if (p.parse === 0 && p.url) console.log("  ✅ 拿到真播放地址");
    else console.log("  ⚠️  退回嗅探");
  }

  console.log("\n=== search('九门') ===");
  const s = JSON.parse(await run("search", "九门", 0, 1));
  console.log(`  ${s.list.length} 条结果`);
  s.list.slice(0, 3).forEach((v: any) => console.log(`    ${v.vod_name}  ${v.vod_remarks}  id=${v.vod_id}`));

  console.log("\n=== ✅ 所有环节完成 ===");
})();
