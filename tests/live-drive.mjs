// 完整驱动 aiyifan → 通过扩展生成 spider 全流程测试
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";
const CDP = "http://127.0.0.1:19222";

async function main() {
  const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
  const pages = await browser.pages();
  console.log("pages:");
  for (const p of pages) console.log(" -", p.url().slice(0, 100));

  const aiyi = pages.find((p) => p.url().includes("aiyifan.tv"));
  const sidepanel = pages.find((p) => p.url().includes(EXT_ID) && p.url().includes("sidepanel"));

  if (!aiyi) throw new Error("aiyifan page not found");
  if (!sidepanel) throw new Error("sidepanel not found");

  // 1) 先把 aiyifan 切到首页
  console.log("\n[1] navigate aiyifan → home");
  await aiyi.goto("https://www.aiyifan.tv/", { waitUntil: "networkidle2", timeout: 30000 }).catch(e=>console.log(e.message));
  await new Promise(r => setTimeout(r, 2500));
  console.log("aiyifan at:", aiyi.url());

  // 2) 读一下 sidepanel 里的 storage（当前项目状态）
  console.log("\n[2] dump extension storage");
  const state = await sidepanel.evaluate(async () => {
    const s = await chrome.storage.local.get(null);
    return s;
  });
  console.log("storage keys:", Object.keys(state));
  const proj = state.currentProject || Object.values(state).find(v => v && v.host);
  console.log("current project?:", proj ? { host: proj.host, listSel: proj.listSelector } : "none");

  // 3) 列出 sidepanel 现在所有按钮
  console.log("\n[3] sidepanel buttons");
  const btns = await sidepanel.evaluate(() => {
    return Array.from(document.querySelectorAll("button")).map((b,i) => ({
      i, text: (b.innerText||"").trim().slice(0,40), disabled: b.disabled,
      visible: b.offsetParent !== null
    }));
  });
  console.log(JSON.stringify(btns, null, 2));

  // 4) 截个图看现状
  await sidepanel.screenshot({ path: "test-output/drive-01-init.png" });
  console.log("saved: test-output/drive-01-init.png");

  await browser.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
