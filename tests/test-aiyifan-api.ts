import { generateAiyifanT3Spider } from "../lib/aiyifan-api-spider";
import fs from "fs";
import path from "path";
const s = generateAiyifanT3Spider();
const out = path.resolve(__dirname, "../test-output/spider_aiyifan_api_t3.js");
fs.writeFileSync(out, s);
console.log(`${s.length} bytes -> ${out}`);
