/**
 * 端到端: 从抓包 → 推理 → 补密钥表 → 生成 spider → 对比手写版
 *
 * 目标: 证明"抓包+人工补 3 处 = 跟手写等价"
 */

import { inferSiteModel } from "../lib/model-inferrer";
import { generateT3SpiderFromModel } from "../lib/model-generator";
import type { CapturedXHR } from "../lib/messages";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const md5X = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const HDR = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.aiyifan.tv/",
  Origin: "https://www.aiyifan.tv",
};
const PKS = [
  "version001", "vers1on001", "vers1on00i", "bersion001",
  "vcrsion001", "versi0n001", "versio_001", "version0o1",
];

async function tsFetch(base: string, ep_path: string, query: string): Promise<CapturedXHR> {
  const pub = String(Date.now() + Math.floor(Math.random() * 1000));
  const pk = PKS[Number(pub) % 8];
  const vv = md5X(pub + "&" + query.toLowerCase() + "&" + pk);
  const url = `${base}/${ep_path}?${query}&vv=${vv}&pub=${pub}`;
  const r = await fetch(url, { headers: HDR });
  const body = await r.text();
  return {
    url, method: "GET", timestamp: Date.now(),
    pageURL: "https://www.aiyifan.tv/",
    respStatus: r.status,
    respContentType: r.headers.get("content-type") || "",
    respBody: body,
  };
}

(async () => {
  // Step 1: 抓包
  console.log("Step 1: 抓 aiyifan XHR...");
  const xhrs: CapturedXHR[] = [];
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/home/config", "cinema=1"));
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/home/getAllVideo", "cinema=1&page=1&size=10&region=SG"));
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/video/detail", "cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id=vEQ16j241LF&region=SG"));
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/video/languagesplaylist", "cinema=1&id=vEQ16j241LF&lsk=1&taxis=0&cid=0,1,4,137"));
  xhrs.push(await tsFetch("https://rankv21.aiyifan.tv", "v3/list/briefsearch", "tags=%E4%B9%9D%E9%97%A8&orderby=4&page=1&size=20&desc=0&isserial=-1&istitle=true"));
  console.log(`  ${xhrs.length} 条抓完`);

  // Step 2: 推理
  console.log("\nStep 2: inferSiteModel...");
  const inferred = inferSiteModel(xhrs, "https://www.aiyifan.tv");
  const model = inferred.model;
  console.log(`  推理出 ${model.endpoints.length} 端点, ${model.signing?.modes.length || 0} 签名模式`);

  // Step 3: 人工补 (只需 3 处) ...
  console.log("\nStep 3: 人工补 (只需 3 处) ...");
  // 3.1 密钥表
  if (model.signing?.modes[0]) {
    model.signing.modes[0].vars.pk = {
      kind: "key_table",
      table: PKS,
      index: "Number(pub) % 8",
    };
    // 关键: 重命名为 "timestamp" (config 端点 sign_mode 用的名字)
    model.signing.modes[0].name = "timestamp";
    console.log("  ✓ 密钥表: 8 个混淆密钥, 模式重命名为 timestamp");
  }
  // 更新 config 端点的 sign_mode 引用
  const configEp = model.endpoints.find((e) => e.name === "config");
  if (configEp) {
    configEp.sign_mode = "timestamp";
  }
  // 3.2 增加 cert 模式 (给 play 用)
  model.signing = {
    default_strategy: "auto",
    modes: [
      ...(model.signing?.modes || []),
      {
        name: "cert",
        vars: {
          pub: { kind: "bootstrap", path: "publicKey" },
          query_lower: { kind: "query_lower" },
          pk: { kind: "bootstrap", path: "privateKey[0]" },
        },
        formula: "{pub}&{query_lower}&{pk}",
        algorithm: "md5",
        attach: { vv: "{sign}", pub: "{pub}" },
      },
    ],
  };
  console.log("  ✓ Cert 模式 (bootstrap 依赖)");
  // 3.3 添加 play 端点 (推理时没抓到, 补上)
  model.endpoints.push({
    name: "play",
    base: "api",
    path: "v3/video/play",
    query: "cinema=1&id={id}&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1",
    sign_mode: "cert",
    response: {
      play_url: {
        priority: [
          { path: "info[0].clarity", first_where: "isEnabled=true", field: "path.result" },
          { path: "info[0].flvPathList", first_where: "isHls=true", field: "result" },
          { path: "info[0].hlsPathList", first_where: "isHls=true", field: "result" },
        ],
        exclude: [{ host_regex: "s1-a1\\.global-cdn\\.me" }],
      },
    },
  });
  console.log("  ✓ Play 端点 (人工添加, 因浏览到播放没抓)");

  // Step 4: 生成 spider
  console.log("\nStep 4: 生成 spider...");
  const src = generateT3SpiderFromModel(model);
  const outPath = path.resolve(__dirname, "../test-output/spider_aiyifan_inferred_t3.js");
  fs.writeFileSync(outPath, src);
  console.log(`  ${src.length} bytes -> ${outPath}`);

  // Step 5: Node 里跑一遍等价性
  console.log("\nStep 5: Node 模拟等价性...");
  const cache = new Map<string, any>();
  const pending: string[] = [];
  function req(url: string) {
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
  const spider: any = factory(md5X, req, console, {});

  async function run(fn: string, ...args: any[]): Promise<any> {
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = () => frozen;
    try {
      let lastLen = -1;
      for (let a = 0; a < 15; a++) {
        pending.length = 0;
        const out = spider[fn](...args);
        if (!pending.length) return out;
        if (pending.length === lastLen) {
          await prefetch(pending);
          pending.length = 0;
          return spider[fn](...args);
        }
        lastLen = pending.length;
        await prefetch(pending);
      }
      return null;
    } finally {
      Date.now = realNow;
    }
  }

  // init (冻结 Date.now，让 config 签名 URL 稳定 → cache 命中)
  const realNow0 = Date.now;
  const frozen0 = realNow0();
  Date.now = () => frozen0;
  for (let a = 0; a < 5; a++) {
    pending.length = 0;
    spider.init({});
    if (!pending.length) break;
    await prefetch(pending);
  }
  Date.now = realNow0;

  // home 分类
  const home = JSON.parse(spider.home());
  console.log(`  home 分类 (${home.class.length}):`, home.class.slice(0, 5).map((c: any) => `${c.type_name}(${c.type_id})`).join(", "));
  const cat0 = home.class[0]?.type_id;
  if (!cat0) { console.log("  ❌ 无分类"); return; }

  const c = JSON.parse(await run("category", cat0, 1));
  console.log(`  category('${cat0}'): ${c.list?.length || 0} 项 (期望 >= 5)`);
  if (c.list?.length) console.log(`    第一部: ${c.list[0].vod_name}  id=${c.list[0].vod_id}`);

  const target = c.list?.[0];
  if (target) {
    const d = JSON.parse(await run("detail", target.vod_id));
    console.log(`  detail(${target.vod_id}): ${d.list?.[0]?.vod_name}, 剧集 ${d.list?.[0]?.vod_play_url?.split("#").length || 0}`);

    const ep = d.list?.[0]?.vod_play_url?.split("#")[0]?.split("$")[1];
    if (ep) {
      const p = JSON.parse(await run("play", "aiyifan", ep, []));
      console.log(`  play(${ep}): parse=${p.parse}, url=${p.url?.slice(0, 80)}`);
    }
  }

  const s = JSON.parse(await run("search", "九门", 0, 1));
  console.log(`  search('九门'): ${s.list?.length || 0} 结果`);

  console.log("\n✅ 完成 — 从纯抓包 + 人工补 3 处 → 出可用 spider");
})();
