import { analyzeJSON } from "../lib/json-analyzer";
import { generateAPIDrpySpider } from "../lib/drpy-generator";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.resolve(__dirname, "../test-output/aiyifan-response.json"), "utf8");
const data = JSON.parse(raw);

console.log("=== 真 analyzer 跑 aiyifan 响应 ===\n");
const fields = analyzeJSON(data);
console.log(`总共识别出 ${fields.length} 个字段:\n`);
for (const f of fields.slice(0, 30)) {
  console.log(`  ${f.kind.padEnd(8)} ${f.path.padEnd(50)} conf=${f.confidence.toFixed(2)} sample=${(f.sample || "").slice(0, 60)}`);
}

// 找列表 + 影视字段
const list = fields.find((f) => f.kind === "list");
const titles = fields.filter((f) => f.kind === "title");
const pics = fields.filter((f) => f.kind === "pic");
const ids = fields.filter((f) => f.kind === "id");

console.log(`\n=== 关键字段挑选 ===`);
console.log(`列表: ${list?.path} (${list?.count} 项)`);
console.log(`标题候选: ${titles.map((t) => t.path).join(", ")}`);
console.log(`图片候选: ${pics.map((p) => p.path).join(", ")}`);
console.log(`ID 候选: ${ids.map((i) => i.path).join(", ")}`);

// 生成一个 Drpy 试试
if (list && titles.length > 0) {
  console.log(`\n=== 生成 Drpy ===`);

  // 只保留列表相对路径的字段 (从 $.data.info[*].guessYouLike[*].title 得到 title)
  const listPath = list.path;
  const relative = (fullPath: string): string => {
    // 从 fullPath 去掉 listPath[*] 前缀
    if (fullPath.startsWith(listPath + "[*]")) {
      return fullPath.slice(listPath.length + 3); // 跳过 "[*]"
    }
    return fullPath;
  };

  const spider = generateAPIDrpySpider({
    host: "www.aiyifan.tv",
    siteName: "爱壹帆",
    home: {
      urlTemplate: "https://upload.aiyifan.tv/api/home/getIndexVideo?cinema=1&size=16",
      method: "GET",
      listPath: listPath,
      fields: {
        id: titles[0] ? relative(titles[0].path.replace("title", "link")) : ".link",
        name: relative(titles[0].path),
        pic: pics[0] ? relative(pics[0].path) : "",
      },
    },
    categories: [
      { name: "推荐", value: "1" },
      { name: "热门", value: "2" },
    ],
  });

  fs.writeFileSync(path.resolve(__dirname, "../test-output/aiyifan-spider.js"), spider);
  console.log(`\n生成的 spider 存到 test-output/aiyifan-spider.js (${spider.length} 字节)`);
  console.log(`\n前 40 行:`);
  console.log(spider.split("\n").slice(0, 40).join("\n"));

  // 语法校验
  try {
    new Function(spider);
    console.log(`\n✅ spider 语法合法`);
  } catch (e) {
    console.log(`\n❌ spider 语法错: ${e.message}`);
  }
}
