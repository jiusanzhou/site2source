import { analyzeHarvest } from "../lib/spa-harvester";
import fs from "fs";

const raw = JSON.parse(fs.readFileSync("/tmp/aiyifan-raw.json", "utf8"));
console.log(`analyzing ${raw.length} full responses\n`);

const result = analyzeHarvest(raw);
console.log(`found ${result.length} video-list endpoints:\n`);
for (const r of result) {
  console.log(`✅ ${r.url.replace("https://", "")}`);
  console.log(`   items: ${r.itemCount} | listPath: "${r.fieldMap?.listPath}"`);
  console.log(`   title=${r.fieldMap?.title} image=${r.fieldMap?.image} key=${r.fieldMap?.key} remarks=${r.fieldMap?.remarks} cat=${r.fieldMap?.category}`);
  console.log(`   sample: ${r.sample.slice(0, 160)}`);
  console.log();
}
