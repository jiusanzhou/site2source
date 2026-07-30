/**
 * 用 Node vm 加载生成的 spider, 模拟 Drpy 环境, 喂真实响应, 看结果
 */
import fs from "fs";
import vm from "vm";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPIDER = path.resolve(__dirname, "../test-output/aiyifan-spider.js");
const RESP = path.resolve(__dirname, "../test-output/aiyifan-response.json");

const spiderCode = fs.readFileSync(SPIDER, "utf8");
const respBody = fs.readFileSync(RESP, "utf8");

console.log("=== 模拟 Drpy 环境跑 spider ===\n");

// 构造 Drpy 环境
const globalThis_ = {
  console,
  JSON,
  Array,
  Object,
  String,
  Number,
  Boolean,
  Math,
  Date,
  RegExp,
  Error,
  Promise,
  setTimeout,
  encodeURIComponent,
  decodeURIComponent,
};

const ctx = vm.createContext({
  globalThis: globalThis_,
  console,
  JSON,
  // Drpy 提供的
  log: (...args) => console.log("[Drpy log]", ...args),
  request: async (url) => {
    console.log(`[Drpy request] ${url}`);
    // 模拟: 无论 URL, 都返回抓到的响应
    return respBody;
  },
  Object,
  Array,
  Promise,
});

try {
  vm.runInContext(spiderCode, ctx);
  const rule = globalThis_.rule || ctx.globalThis?.rule;
  console.log(`rule 加载成功: ${rule?.title}`);
  console.log(`class_name: ${rule?.class_name}`);
  console.log(`class_url: ${rule?.class_url}`);
  console.log(`url: ${rule?.url}`);

  console.log(`\n--- 调用 一级(fyclass=1, fypage=1) ---`);
  const videos = await rule["一级"].call(rule, "1", 1, {});
  console.log(`\n✅ 返回 ${videos.length} 个 vod:\n`);
  for (const v of videos.slice(0, 5)) {
    console.log(`  id: ${v.vod_id}`);
    console.log(`  name: ${v.vod_name}`);
    console.log(`  pic: ${v.vod_pic?.slice(0, 80)}`);
    console.log(`  remarks: ${v.vod_remarks}`);
    console.log(`  ---`);
  }

  if (videos.length === 0) {
    console.log(`❌ 空列表 — 说明相对路径没对`);
  } else if (!videos[0].vod_name) {
    console.log(`❌ 有列表但没标题 — fields 相对路径错`);
  } else {
    console.log(`\n🎉 完整跑通 end-to-end!`);
  }
} catch (e) {
  console.log(`\n❌ 执行错: ${e.message}`);
  console.log(e.stack?.split("\n").slice(0, 5).join("\n"));
}
