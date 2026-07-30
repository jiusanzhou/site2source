/**
 * 用真的 json-analyzer 分析抓到的 aiyifan 响应
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESP_FILE = path.resolve(__dirname, "../test-output/aiyifan-response.json");

// 用 tsx 加载 ts 文件
execSync(`npx --yes tsx ${__dirname}/analyze-with-real-analyzer-runner.ts`, {
  stdio: "inherit",
});
