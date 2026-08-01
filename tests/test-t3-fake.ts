import { generateT3Spider } from "../lib/t3-spider-generator";
import fs from "fs";
import path from "path";

// 用本地 fixture 站验证「非 CSR 站」的完整流程
// 站点跑在宿主 8877，模拟器里用 10.0.2.2
const spider = generateT3Spider({
  siteName: "测试影视",
  host: "http://10.0.2.2:8877",
  categories: [
    { name: "首页", url: "/" },
    { name: "电影", url: "/index.html" },
  ],
  listSelector: "div.module-list a.module-item",
  searchRoute: "/search.html?wd={wd}",
  searchListSelector: "div.module-list a.module-item",
  media: [],
  isPureCSR: false,
});

const out = path.resolve(__dirname, "../test-output/spider_fake_t3.js");
fs.writeFileSync(out, spider);
console.log(`${spider.length} bytes -> ${out}`);
