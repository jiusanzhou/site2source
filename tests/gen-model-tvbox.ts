// tvbox config 指向新 spider
//
// 用法（挂 cf-proxy 版本）:
//   node --env-file=.env node_modules/.bin/tsx tests/gen-model-tvbox.ts
// 或（无 proxy 版本，海外环境）:
//   npx tsx tests/gen-model-tvbox.ts
import fs from "fs";
import path from "path";
import { makeAiyifanModel } from "../lib/sites/aiyifan";
import { generateT3SpiderFromModel } from "../lib/model-generator";

// 手动读 .env（避免装 dotenv）
try {
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
} catch {}

const withProxy = !!process.env.AIYIFAN_PROXY_TOKEN;
const model = makeAiyifanModel({ withProxy });
console.log(`生成 aiyifan spider，proxy=${withProxy ? "on (" + process.env.AIYIFAN_PROXY_BASE + ")" : "off"}`);

const src = generateT3SpiderFromModel(model);
const jsPath = path.resolve(__dirname, "../test-output/spider_aiyifan_model_t3.js");
fs.writeFileSync(jsPath, src);
console.log(`spider ${src.length} bytes -> ${jsPath}`);

const config = {
  spider: "",
  sites: [
    {
      key: "aiyifan_model",
      name: "爱壹帆(Model)",
      type: 3,
      api: "http://10.0.2.2:8899/spider_aiyifan_model_t3.js",
      searchable: 1,
      quickSearch: 1,
      filterable: 0,
    },
  ],
  parses: [{ name: "Web", type: 3, url: "Web" }],
  flags: ["aiyifan", "youku", "qq", "iqiyi", "qiyi", "letv", "sohu", "tudou", "pptv", "mgtv", "wasu", "bilibili", "renrenmi"],
  ijk: [],
  ads: [],
};
const cfgPath = path.resolve(__dirname, "../test-output/tvbox_aiyifan_model.json");
fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
console.log(`config -> ${cfgPath}`);
