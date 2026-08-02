// site2source-ext — 生成 aiyifan tvbox 配置 + validator 校验
//
// 用法: npx tsx tests/gen-aiyifan-tvbox.ts
//
// 这个文件示范如何用 spider-utils 里的 validator 保证生成的 tvbox 配置
// 不踩已知坑位.

import fs from "fs";
import path from "path";
import { TVBOX_OFFICIAL_FLAGS, validateTVBoxConfig } from "../lib/spider-utils";

const cfg = {
  spider: "",
  sites: [
    {
      key: "aiyifan_api",
      name: "爱壹帆(API)",
      type: 3,
      api: "http://10.0.2.2:8899/spider_aiyifan_api_t3.js",
      searchable: 1,
      quickSearch: 1,
      filterable: 0,
    },
  ],
  parses: [
    {
      name: "Web",
      type: 3,
      url: "Web",
    },
  ],
  // ⚠️  不含 "aiyifan" — 详见 docs/SPIDER-PITFALLS.md P0
  flags: TVBOX_OFFICIAL_FLAGS,
  ijk: [],
  ads: [],
};

// 生成前校验
const warnings = validateTVBoxConfig(cfg);
if (warnings.length) {
  console.error("❌ tvbox 配置校验失败:");
  warnings.forEach((w) => console.error("  " + w));
  process.exit(1);
} else {
  console.log("✅ tvbox 配置校验通过");
}

const out = path.resolve(__dirname, "../test-output/tvbox_aiyifan.json");
fs.writeFileSync(out, JSON.stringify(cfg, null, 2));
console.log(`写入: ${out}`);
