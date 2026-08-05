#!/usr/bin/env node
/**
 * publish-tvbox.mjs — 把 spider 发布到 jiusanzhou/tvbox 仓库
 *
 * 用法:
 *   node scripts/publish-tvbox.mjs <site-name> [--repo owner/name] [--message "..."] [--dry-run]
 *
 * 流程:
 *   1. clone / update local mirror
 *   2. 拷贝 spider.js → sites/<name>/spider.js
 *   3. 写 sites/<name>/meta.json (从 test-output/tvbox_<name>.json + 站点定义合并)
 *   4. 检查 secret 是否泄漏 (spider 里含 Bearer/API-Key)
 *   5. 跑 pnpm build (重新打包 tvbox.json)
 *   6. git commit + push (触发 GH Pages)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const opts = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [];
    }),
);

if (!name) {
  console.error("用法: node scripts/publish-tvbox.mjs <site-name> [--repo owner/name] [--message '...'] [--dry-run]");
  process.exit(1);
}

const repo = opts.repo || "jiusanzhou/tvbox";
const dryRun = !!opts["dry-run"];
const message = opts.message || `chore: update ${name} spider`;

// 检查产物
const spiderSrc = path.join(REPO_ROOT, "test-output", `spider_${name}.js`);
const fragmentSrc = path.join(REPO_ROOT, "test-output", `tvbox_${name}.json`);
for (const p of [spiderSrc, fragmentSrc]) {
  if (!fs.existsSync(p)) {
    console.error(`❌ 找不到 ${p}`);
    console.error("   先跑 gen-spider.mjs + verify-spider.mjs");
    process.exit(2);
  }
}

const spiderText = fs.readFileSync(spiderSrc, "utf8");

// 🔒 Secret 泄漏检查
const secretPatterns = [
  { re: /Authorization:\s*['"]Bearer\s+([A-Za-z0-9_\-]{16,})['"]/, name: "Bearer token" },
  { re: /['"]([A-Za-z0-9]{32,})['"].*?(?:api[_-]?key|apikey|token)/i, name: "API key" },
  { re: /['"]sk-[A-Za-z0-9]{20,}['"]/, name: "OpenAI-style secret" },
];
const leaked = [];
for (const { re, name: n } of secretPatterns) {
  const m = spiderText.match(re);
  if (m) leaked.push({ type: n, sample: (m[1] || m[0]).slice(0, 24) + "..." });
}

if (leaked.length && !opts["allow-secret"]) {
  console.error("🔒 spider 里可能含 secret:");
  for (const l of leaked) console.error(`   - ${l.type}: ${l.sample}`);
  console.error("");
  console.error(`目标仓库 ${repo} 大概率是 PUBLIC. Secret 一旦推上去就永远公开.`);
  console.error("");
  console.error("三个选项:");
  console.error("  1. 换个低权限 secret 后重新 gen, 再发布");
  console.error("  2. 加 --allow-secret 强推 (承担被抓取盗刷风险)");
  console.error("  3. 取消发布");
  process.exit(3);
}

// clone / update mirror
const mirrorPath = path.join(REPO_ROOT, ".tvbox-mirror");
if (!fs.existsSync(mirrorPath)) {
  console.log(`克隆 ${repo}...`);
  const r = spawnSync("gh", ["repo", "clone", repo, mirrorPath, "--", "--depth", "50"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(4);
} else {
  console.log("更新 mirror...");
  spawnSync("git", ["-C", mirrorPath, "fetch", "--depth", "50"], { stdio: "inherit" });
  spawnSync("git", ["-C", mirrorPath, "reset", "--hard", "origin/main"], { stdio: "inherit" });
}

// 拷贝
const siteDir = path.join(mirrorPath, "sites", name);
fs.mkdirSync(siteDir, { recursive: true });

fs.copyFileSync(spiderSrc, path.join(siteDir, "spider.js"));
console.log(`  spider.js: ${spiderText.length}b`);

// 写 meta.json (从 fragment 生成)
const fragment = JSON.parse(fs.readFileSync(fragmentSrc, "utf8"));
const meta = {
  key: fragment.key,
  name: fragment.name,
  type: fragment.type,
  spider: `sites/${name}/spider.js`,
  searchable: fragment.searchable,
  quickSearch: fragment.quickSearch,
  filterable: fragment.filterable,
  categories: fragment.categories,
  source: fragment.source,
  note: fragment.note,
  probes: [fragment.source].filter(Boolean),
};
fs.writeFileSync(path.join(siteDir, "meta.json"), JSON.stringify(meta, null, 2));
console.log(`  meta.json`);

// README (简单)
const readmePath = path.join(siteDir, "README.md");
if (!fs.existsSync(readmePath)) {
  fs.writeFileSync(
    readmePath,
    `# ${meta.name}\n\n${meta.note}\n\n源站: ${meta.source}\n`,
  );
}

// 尝试跑 pnpm build (repo 自己的 build)
const hasBuild = fs.existsSync(path.join(mirrorPath, "scripts", "build.mjs"));
if (hasBuild) {
  console.log("跑 pnpm build (重新打包 tvbox.json)...");
  const r = spawnSync("pnpm", ["build"], { cwd: mirrorPath, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("❌ pnpm build 失败");
    process.exit(5);
  }
} else {
  console.log("⚠️  仓库没有 scripts/build.mjs, 跳过重打包");
}

// git
if (dryRun) {
  console.log("\n[dry-run] 未提交, 查看变更:");
  spawnSync("git", ["-C", mirrorPath, "status", "-sb"], { stdio: "inherit" });
  process.exit(0);
}

spawnSync("git", ["-C", mirrorPath, "add", "-A"], { stdio: "inherit" });
const statusR = spawnSync("git", ["-C", mirrorPath, "status", "--porcelain"], { encoding: "utf8" });
if (!statusR.stdout.trim()) {
  console.log("\n无变更, 不推送");
  process.exit(0);
}

spawnSync("git", ["-C", mirrorPath, "commit", "-m", message], { stdio: "inherit" });
spawnSync("git", ["-C", mirrorPath, "push", "origin", "main"], { stdio: "inherit" });

console.log("\n🚀 已推送到 GitHub, GH Pages 一般 30s-2min 内生效");
console.log(`   订阅地址: https://zoe.im/tvbox/tvbox.json (或按你的 CNAME)`);
console.log(`   备用: https://cdn.jsdelivr.net/gh/${repo}@main/tvbox.json`);
