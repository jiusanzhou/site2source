/**
 * 验证器煤矿测试 — 复现 aiyifan 那晚"8 密钥 vs 4 密钥"bug
 *
 * 目的：证明如果验证器早存在，那 90 分钟的坑不会出现
 */

import crypto from "crypto";
import { verifySignMode, verifyAll, type SignSample } from "../lib/sign-verifier";
import type { SignMode } from "../lib/site-model";

const md5 = (s: string) => crypto.createHash("md5").update(s, "utf8").digest("hex");

// 真实的 8 密钥
const REAL_PKS = [
  "version001", "vers1on001", "vers1on00i", "bersion001",
  "vcrsion001", "versi0n001", "versio_001", "version0o1",
];

// 生成 30 组样本（模拟从 CDP 抓来）
function genSamples(count: number): SignSample[] {
  const samples: SignSample[] = [];
  const queries = [
    "cinema=1&page=1&size=100&region=SG",
    "cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id=vEQ16j241LF&region=SG",
    "cinema=1&vid=oPm83Nu39BE&lsk=1&taxis=0&cid=0,1,4",
    "cinema=1&id=Gy9JCLumfJE&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1",
    "tags=%E4%B9%9D%E9%97%A8&orderby=4&page=1&size=20&desc=0&isserial=-1&istitle=true",
  ];
  for (let i = 0; i < count; i++) {
    const q = queries[i % queries.length];
    // 用不同时间戳制造覆盖 8 个索引的样本
    const pub = String(1785000000000 + i * 137);
    const pk = REAL_PKS[Number(pub) % 8];
    const vv = md5(pub + "&" + q.toLowerCase() + "&" + pk);
    samples.push({ url: `x?${q}&vv=${vv}&pub=${pub}`, query: q, expected_sign: vv, expected_pub: pub });
  }
  return samples;
}

// 场景 A: 用户第一版 —— 只有 4 个密钥（模拟"抄少了")
const MODE_4KEYS: SignMode = {
  name: "timestamp-v1(4密钥错版)",
  vars: {
    pub: { kind: "timestamp" },
    query_lower: { kind: "query_lower" },
    pk: {
      kind: "key_table",
      table: REAL_PKS.slice(0, 4), // 只有前 4 个
      index: "Number(pub) % 4",
    },
  },
  formula: "{pub}&{query_lower}&{pk}",
  algorithm: "md5",
  attach: { vv: "{sign}", pub: "{pub}" },
};

// 场景 B: 用户第二版 —— 8 个密钥完整版
const MODE_8KEYS: SignMode = {
  ...MODE_4KEYS,
  name: "timestamp-v2(8密钥正确版)",
  vars: {
    ...MODE_4KEYS.vars,
    pk: {
      kind: "key_table",
      table: REAL_PKS,
      index: "Number(pub) % 8",
    },
  },
};

// 场景 C: 索引公式写错（比如忘了 % 8）
const MODE_BADIDX: SignMode = {
  ...MODE_8KEYS,
  name: "timestamp-v3(索引错版)",
  vars: {
    ...MODE_8KEYS.vars,
    pk: {
      kind: "key_table",
      table: REAL_PKS,
      index: "Number(pub) % 3", // 错了
    },
  },
};

const samples = genSamples(30);
console.log(`\n=== 生成 ${samples.length} 组样本（覆盖 8 个 % 8 索引）===\n`);

const results = verifyAll([MODE_4KEYS, MODE_8KEYS, MODE_BADIDX], samples);
for (const r of results) {
  console.log(`\n【${r.mode_name}】`);
  console.log(`  通过率: ${r.passed}/${r.total} (${(r.pass_rate * 100).toFixed(1)}%)`);
  for (const d of r.diagnostics) console.log(`  ${d}`);
}

console.log("\n=== 关键断言 ===");
const v4 = results[0], v8 = results[1], vbad = results[2];
console.log(`4 密钥版通过率: ${(v4.pass_rate * 100).toFixed(0)}% (期望 ~50%)`);
console.log(`8 密钥版通过率: ${(v8.pass_rate * 100).toFixed(0)}% (期望 100%)`);
console.log(`索引错版通过率: ${(vbad.pass_rate * 100).toFixed(0)}% (期望 <50%)`);

if (v4.pass_rate >= 0.4 && v4.pass_rate <= 0.6 && v8.pass_rate === 1) {
  console.log("\n✅ 验证器正确工作！");
  console.log("  4 密钥版能被诊断出'密钥表可能是一半'");
  console.log("  8 密钥版全绿");
} else {
  console.log("\n❌ 验证器逻辑有问题");
  process.exit(1);
}
