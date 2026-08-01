// 本地生成 spider: 读扩展 storage → 调 drpy-generator → 写文件
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// 1) 唤醒 sw 拉 state
const t0 = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t0.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
{
  const ws = new WebSocket(aiT.webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));
  let id=1; const p=new Map();
  ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
  function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
  await send("Page.enable"); await send("Page.reload");
  await new Promise(r=>setTimeout(r,4500));
  ws.close();
}
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const swT = t.find(x => x.type === "service_worker");
if (!swT) { console.log("no sw"); process.exit(1); }

const ws = new WebSocket(swT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const pending=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");
const r = await send("Runtime.evaluate", {
  expression: `(async () => { return await chrome.storage.local.get(null); })()`,
  awaitPromise: true, returnByValue: true,
});
const storage = r.result?.result?.value || {};
ws.close();

const proj = storage["site2source:projects"]?.["www.aiyifan.tv"];
if (!proj) { console.log("no project"); process.exit(1); }

// 2) media 也拿
const mediaAll = storage["site2source:media"] || {};
const media = [];
for (const tid of Object.keys(mediaAll)) media.push(...(mediaAll[tid] || []));

// 3) 通过临时 esbuild bundle 本地跑 generator
const genSrc = `
import { generateDrpySpider, generateTVBoxJSON } from "../lib/drpy-generator";

const proj = ${JSON.stringify(proj)};
const media = ${JSON.stringify(media)};

const input = {
  siteName: proj.site?.siteName || "aiyifan",
  baseURL: proj.baseInfo?.pageBase || "https://" + (proj.site?.host || "www.aiyifan.tv"),
  host: proj.site?.host || "www.aiyifan.tv",
  baseInfo: proj.baseInfo,
  listSelector: proj.listSelector || "",
  itemSelector: proj.listItemTag || "*",
  cardCount: (proj.listSamples || []).length || 0,
  similarity: proj.listMeta?.similarity || 100,
  samples: proj.listSamples || [],
  detail: proj.detail,
  home: proj.home,
  media,
};

const spider = generateDrpySpider(input);
const spiderName = "spider_" + input.host.replace(/[.:]/g, "_") + ".js";
const tvbox = generateTVBoxJSON(input, "./" + spiderName);
console.log("SPIDER_START");
console.log(spider);
console.log("SPIDER_END");
console.log("TVBOX_START");
console.log(tvbox);
console.log("TVBOX_END");
`;

const tmpFile = path.resolve("tests/_gen.ts");
fs.mkdirSync("test-output", { recursive: true });
fs.writeFileSync(tmpFile, genSrc);

const proc = spawn("npx", ["tsx", tmpFile], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
let out = "", err = "";
proc.stdout.on("data", d => out += d.toString());
proc.stderr.on("data", d => err += d.toString());
await new Promise(r => proc.on("close", r));
if (err) console.log("stderr:", err.slice(0, 500));

const spider = out.split("SPIDER_START\n")[1]?.split("\nSPIDER_END")[0];
const tvbox = out.split("TVBOX_START\n")[1]?.split("\nTVBOX_END")[0];
if (spider) {
  fs.writeFileSync("test-output/spider_www_aiyifan_tv_v2.js", spider);
  console.log("saved spider (" + spider.length + " bytes)");
}
if (tvbox) {
  fs.writeFileSync("test-output/tvbox_v2.json", tvbox);
  console.log("saved tvbox (" + tvbox.length + " bytes)");
}
fs.unlinkSync(tmpFile);
