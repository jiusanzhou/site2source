/**
 * SiteModel 自动推理测试 — 用真实的 aiyifan XHR 数据
 *
 * 目标: 验证 inferSiteModel 能从纯抓包数据推出接近 AIYIFAN_MODEL 的草稿
 * (不追求完全一致 — 签名算法和 bootstrap 需要人工确认)
 */

import { inferSiteModel } from "../lib/model-inferrer";
import type { CapturedXHR } from "../lib/messages";
import crypto from "crypto";

const md5 = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const HDR = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.aiyifan.tv/",
  Origin: "https://www.aiyifan.tv",
};

const PKS = [
  "version001", "vers1on001", "vers1on00i", "bersion001",
  "vcrsion001", "versi0n001", "versio_001", "version0o1",
];

async function tsFetch(base: string, path: string, query: string): Promise<CapturedXHR> {
  const pub = String(Date.now() + Math.floor(Math.random() * 1000));
  const pk = PKS[Number(pub) % 8];
  const vv = md5(pub + "&" + query.toLowerCase() + "&" + pk);
  const url = `${base}/${path}?${query}&vv=${vv}&pub=${pub}`;
  try {
    const r = await fetch(url, { headers: HDR });
    const body = await r.text();
    return {
      url, method: "GET", timestamp: Date.now(),
      pageURL: "https://www.aiyifan.tv/",
      respStatus: r.status,
      respContentType: r.headers.get("content-type") || "",
      respBody: body.length > 50000 ? body.slice(0, 50000) : body,
      respTruncated: body.length > 50000,
    };
  } catch (e: any) {
    return { url, method: "GET", timestamp: Date.now(), respStatus: 0, respBody: "" };
  }
}

(async () => {
  console.log("=== 抓 aiyifan 真实 XHR（模拟浏览器几次浏览）===\n");
  const xhrs: CapturedXHR[] = [];

  // 首页
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/home/config", "cinema=1"));
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/home/getAllVideo", "cinema=1&page=1&size=10&region=SG"));
  await new Promise((r) => setTimeout(r, 300));

  // 详情
  for (const id of ["vEQ16j241LF", "oPm83Nu39BE"]) {
    xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/video/detail",
      `cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id=${id}&region=SG`));
    await new Promise((r) => setTimeout(r, 200));
  }

  // 剧集列表
  xhrs.push(await tsFetch("https://m10.aiyifan.tv", "v3/video/languagesplaylist",
    "cinema=1&id=vEQ16j241LF&lsk=1&taxis=0&cid=0,1,4,137"));

  // 搜索
  xhrs.push(await tsFetch("https://rankv21.aiyifan.tv", "v3/list/briefsearch",
    "tags=%E4%B9%9D%E9%97%A8&orderby=4&page=1&size=20&desc=0&isserial=-1&istitle=true"));

  console.log(`采集完成: ${xhrs.length} 条 XHR\n`);
  console.log("响应状态:");
  xhrs.forEach((x) => console.log(`  ${x.respStatus}  ${x.method} ${new URL(x.url).host}${new URL(x.url).pathname}`));

  // 运行推理
  console.log("\n=== 运行 inferSiteModel ===\n");
  const result = inferSiteModel(xhrs, "https://www.aiyifan.tv");

  console.log("【Hints】");
  result.hints.forEach((h) => console.log(" ", h));

  console.log("\n【签名参数】");
  result.signParams.forEach((s) => console.log(`  ${s.key} = ${s.value.slice(0, 30)}${s.value.length > 30 ? "..." : ""}  → ${s.guess} (${s.reason})`));

  console.log("\n【端点候选】");
  for (const c of result.candidates) {
    console.log(`  [${c.roleGuess}] ${c.host}${c.path}`);
    console.log(`    调用: ${c.samples.length} 次`);
    console.log(`    参数: ${[...c.paramFreq.keys()].join(", ")}`);
    if (c.responseFields.listPath) console.log(`    list: ${c.responseFields.listPath}`);
    if (c.responseFields.itemFields?.length) console.log(`    字段: ${c.responseFields.itemFields.slice(0, 8).join(", ")}${c.responseFields.itemFields.length > 8 ? "..." : ""}`);
  }

  console.log("\n【推理出的 SiteModel】");
  const m = result.model;
  console.log(`  name: ${m.name}`);
  console.log(`  bases: ${JSON.stringify(m.bases)}`);
  console.log(`  signing 模式数: ${m.signing?.modes.length || 0}`);
  m.signing?.modes.forEach((sm) => {
    console.log(`    - ${sm.name}: formula=${sm.formula} attach=${JSON.stringify(sm.attach)}`);
  });
  console.log(`  endpoints (${m.endpoints.length}):`);
  m.endpoints.forEach((e) => console.log(`    - ${e.name}: ${e.base}/${e.path}  ?${e.query.slice(0, 60)}${e.query.length > 60 ? "..." : ""}  sign=${e.sign_mode}`));
  console.log(`  mappings vod_id: ${JSON.stringify(m.mappings.vod_id)}`);
  console.log(`  mappings vod_name: ${JSON.stringify(m.mappings.vod_name)}`);
  console.log(`  categories: ${m.categories.length}`);

  // 保存草稿供后续对比
  const fs = await import("fs");
  const path = await import("path");
  fs.writeFileSync(
    path.resolve(__dirname, "../test-output/inferred-aiyifan-draft.json"),
    JSON.stringify(m, null, 2),
  );
  console.log("\n草稿保存到 test-output/inferred-aiyifan-draft.json");
})();
