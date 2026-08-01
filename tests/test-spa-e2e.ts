import { analyzeHarvest } from "../lib/spa-harvester";
import { bridgeToAPISpider } from "../lib/spa-bridge";
import { generateAPIDrpySpider } from "../lib/drpy-generator";
import fs from "fs";
import path from "path";

const raw = JSON.parse(fs.readFileSync("/tmp/aiyifan-raw.json", "utf8"));
const endpoints = analyzeHarvest(raw);
console.log(`harvested ${endpoints.length} endpoints, primary: ${endpoints[0]?.url}\n`);

// aiyifan 的分类（从之前 mainMenu 学到的）
const categories = [
  { name: "国产剧", value: "0,1,4" },
  { name: "电影", value: "0,1,3" },
  { name: "综艺", value: "0,1,5" },
  { name: "动漫", value: "0,1,6" },
];

const bridged = bridgeToAPISpider(endpoints, {
  siteName: "爱壹帆",
  host: "https://www.aiyifan.tv",
  categories,
  detailRoute: "https://www.aiyifan.tv/play/{id}",
  media: [],
});

if (!bridged) {
  console.log("bridge failed");
  process.exit(1);
}

console.log("=== warnings ===");
bridged.warnings.forEach(w => console.log("  ⚠️  " + w));

console.log("\n=== APIGenerateInput ===");
console.log("home.urlTemplate:", bridged.input.home.urlTemplate);
console.log("home.listPath:  ", bridged.input.home.listPath);
console.log("home.fields:    ", JSON.stringify(bridged.input.home.fields));

const spider = generateAPIDrpySpider(bridged.input);
const out = path.resolve(__dirname, "../test-output/spider_aiyifan_api.js");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, spider);
console.log(`\n=== generated spider: ${spider.length} bytes → ${out} ===`);
console.log(spider.slice(0, 1800));

console.log("\n=== 签名检测 ===");
console.log("requiresSignature:", bridged.requiresSignature);
console.log("signatureParams:", bridged.signatureParams);
