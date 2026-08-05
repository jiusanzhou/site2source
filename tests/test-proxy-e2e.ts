/**
 * 端到端: 生成的 aiyifan spider 通过 cf-proxy 拿数据（模拟国内环境的最终链路）
 *
 * 验证点：
 *  1. init/bootstrap 能通
 *  2. home 能拿到分类
 *  3. category 能出列表
 *  4. detail 能出剧集
 *  5. play 能拿到 m3u8/mp4
 *  6. 所有 req URL 都走了 notes-edge.pages.dev
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// 加载 .env
try {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch {}

const md5X = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");
const HDR_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// 全局记录: 所有实际访问的 URL
const accessLog: { url: string; via: string; status: number; bodyLen: number }[] = [];
const cache = new Map<string, any>();
// 保存 pending 请求的完整信息（含 header）
const pending: { url: string; opts: any }[] = [];

// FongMi 环境的 req() 模拟：同步风格 + 内部预取
function req(url: string, opts: any = {}) {
  if (cache.has(url)) {
    const c = cache.get(url);
    return c;
  }
  pending.push({ url, opts });
  return { content: "" };
}

async function prefetch(reqs: { url: string; opts: any }[]) {
  const done = await Promise.all(
    reqs.map(async ({ url, opts }) => {
      try {
        const finalHdr = opts?.headers || {};
        const r = await fetch(url, {
          method: opts?.method || "GET",
          headers: finalHdr as any,
          body: opts?.body,
        });
        const body = await r.text();
        const via = url.includes("notes-edge.pages.dev") ? "🌐 CF-PROXY" : "🔗 直连";
        accessLog.push({ url, via, status: r.status, bodyLen: body.length });
        return { url, res: { content: body, status: r.status } };
      } catch (e: any) {
        accessLog.push({ url, via: "❌", status: 0, bodyLen: 0 });
        return { url, res: { content: "", status: 0 } };
      }
    }),
  );
  for (const { url, res } of done) cache.set(url, res);
}

// 加载生成的 spider
const src = fs.readFileSync(
  path.resolve(__dirname, "../test-output/spider_aiyifan_model_t3.js"),
  "utf8",
);
// 剥掉 import/export 让 Node vm 能吃
const body = src
  .replace(/^import .*$/gm, "")
  .replace(/export function __jsEvalReturn/, "function __jsEvalReturn");

// 从 spider 里嗅 HDR，作为 prefetch 的头
function extractHdr(): Record<string, string> {
  const m = src.match(/var HDR = (\{[\s\S]*?\n\});/);
  if (!m) return { "User-Agent": HDR_UA };
  try {
    // eslint-disable-next-line no-new-func
    return new Function("return " + m[1])();
  } catch {
    return { "User-Agent": HDR_UA };
  }
}
const HDR = extractHdr();

const factory = new Function(
  "md5X",
  "req",
  "console",
  "cheerio",
  body + "\nreturn __jsEvalReturn();",
);
const spider: any = factory(md5X, req, console, {});

async function driveTurn(fn: string, ...args: any[]): Promise<any> {
  // FongMi 模式: 多次调用，直到 pending 为空（req 是同步的，靠预取补数据）
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
        // 稳定但没解决，再取一次
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

(async () => {
  console.log("=== 端到端: aiyifan spider through cf-proxy ===\n");

  // init（跑 bootstrap）
  console.log("① init + bootstrap");
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
  console.log(`   accessLog 目前 ${accessLog.length} 条`);

  // home
  console.log("\n② home (分类)");
  const home = JSON.parse(spider.home());
  console.log(`   ${home.class.length} 分类: ${home.class.slice(0, 5).map((c: any) => c.type_name).join(", ")}...`);

  // category
  console.log("\n③ category(filmList, page=1)");
  const c = JSON.parse(await driveTurn("category", "filmList", 1));
  console.log(`   ${c.list?.length || 0} 项, total=${c.total}`);
  if (c.list?.length) console.log(`   第一部: ${c.list[0].vod_name} (id=${c.list[0].vod_id})`);

  const target = c.list?.[0];

  // detail
  if (target) {
    console.log(`\n④ detail(${target.vod_id})`);
    const d = JSON.parse(await driveTurn("detail", target.vod_id));
    const vod = d.list?.[0];
    if (vod) {
      const eps = (vod.vod_play_url || "").split("#");
      console.log(`   ${vod.vod_name}, 剧集数=${eps.length}, 首集=${eps[0]}`);

      // play
      const ep0 = eps[0]?.split("$")[1];
      if (ep0) {
        console.log(`\n⑤ play(${ep0})`);
        const p = JSON.parse(await driveTurn("play", "aiyifan", ep0, []));
        console.log(`   parse=${p.parse}, url=${(p.url || "").slice(0, 100)}`);
      }
    }
  }

  // search
  console.log("\n⑥ search('九门')");
  const s = JSON.parse(await driveTurn("search", "九门", 0, 1));
  console.log(`   ${s.list?.length || 0} 结果`);

  // 打印访问日志
  console.log("\n=== 访问日志 ===");
  let cfProxyCount = 0, directCount = 0;
  for (const log of accessLog) {
    const suffix = log.status === 200 ? "✅" : `⚠️  HTTP ${log.status}`;
    console.log(`   ${log.via}  ${log.url.slice(0, 120)}  ${suffix}  ${log.bodyLen}b`);
    if (log.via.includes("CF-PROXY")) cfProxyCount++;
    else if (log.via.includes("直连")) directCount++;
  }

  console.log("\n=== 统计 ===");
  console.log(`   经 CF-PROXY: ${cfProxyCount}`);
  console.log(`   直连:       ${directCount}`);
  console.log(`   失败:       ${accessLog.filter((l) => l.status !== 200).length}`);

  if (directCount > 0) {
    console.log("\n⚠️  警告: 还有直连请求, proxy 没生效或者有的端点漏挂");
  } else {
    console.log("\n✅ 所有 API 请求都走 CF-PROXY");
  }
})();
