// 完整流程 v3：完全绕过 sidepanel UI，直接通过 sw 触发 GET_DETAIL_INFO
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";

class RawCDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.on("open", res); this.ws.on("error", rej); });
    this.ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&this.pending.has(m.id)){const {res,rej}=this.pending.get(m.id);this.pending.delete(m.id);if(m.error)rej(new Error(m.error.message));else res(m.result);}});
  }
  async send(method, params={}) { await this.ready; const mid=this.id++; return new Promise((res,rej)=>{this.pending.set(mid,{res,rej});this.ws.send(JSON.stringify({id:mid,method,params}));}); }
  async eval(expr, awaitPromise=false) { const r=await this.send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise}); if(r.exceptionDetails) throw new Error("eval: "+r.exceptionDetails.text+" "+(r.exceptionDetails.exception?.description||"")); return r.result?.value; }
  close() { this.ws.close(); }
}

async function main() {
  const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
  const swT = targets.find(t => t.type === "service_worker" && t.url.includes(EXT_ID));
  const aiT = targets.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
  if (!swT) throw new Error("no sw");
  if (!aiT) throw new Error("no aiyi");
  console.log("sw:", swT.id.slice(0,20));
  console.log("aiyi:", aiT.id.slice(0,20));

  const sw = new RawCDP(swT.webSocketDebuggerUrl);
  const aiyi = new RawCDP(aiT.webSocketDebuggerUrl);
  await sw.send("Runtime.enable");
  await aiyi.send("Runtime.enable");
  await aiyi.send("Page.enable");

  // 1) 让 aiyifan 到 detail 页
  console.log("\n[1] nav aiyifan → /play/Na5mm0pFZzP");
  await aiyi.send("Page.navigate", { url: "https://www.aiyifan.tv/play/Na5mm0pFZzP" });
  await new Promise(r=>setTimeout(r, 6500));
  console.log("aiyi at:", await aiyi.eval("location.href"));

  // 2) 通过 sw 清 detail
  console.log("\n[2] clear old detail (via sw → SAVE_STATE)");
  const clr = await sw.eval(`(async () => {
    // sw 内直接调 chrome.storage 也行, 但这里走 SAVE_STATE 消息保持一致
    const s = await chrome.storage.local.get("site2source:projects");
    const projs = s["site2source:projects"] || {};
    if (projs["www.aiyifan.tv"]) projs["www.aiyifan.tv"].detail = {};
    await chrome.storage.local.set({"site2source:projects": projs});
    return "cleared";
  })()`, true);
  console.log("clr:", clr);

  // 3) 直接从 sw 让 content-script 跑 GET_DETAIL_INFO
  console.log("\n[3] send GET_DETAIL_INFO to aiyi tab");
  const learnRes = await sw.eval(`(async () => {
    const tabs = await chrome.tabs.query({url: "https://www.aiyifan.tv/*"});
    if (tabs.length === 0) return {err:"no tab"};
    const tabId = tabs[0].id;
    return await chrome.tabs.sendMessage(tabId, { type: "GET_DETAIL_INFO" });
  })()`, true);
  console.log("learn res:", JSON.stringify(learnRes, null, 2));

  // 4) 保存
  if (learnRes && learnRes.spec) {
    await sw.eval(`(async () => {
      const s = await chrome.storage.local.get("site2source:projects");
      const projs = s["site2source:projects"] || {};
      projs["www.aiyifan.tv"] = projs["www.aiyifan.tv"] || {};
      projs["www.aiyifan.tv"].detail = ${JSON.stringify(learnRes.spec)};
      projs["www.aiyifan.tv"].updatedAt = Date.now();
      await chrome.storage.local.set({"site2source:projects": projs});
    })()`, true);
    console.log("saved");
  }

  // 5) 验证
  console.log("\n=== Validation ===");
  const detail = learnRes?.spec || {};
  async function verify(sel, label) {
    if (!sel) { console.log(`⚪ ${label}: (empty)`); return; }
    const info = await aiyi.eval(`(() => { try { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return {hit:false}; return {hit:true, tag:el.tagName, cls:el.className.slice(0,60), txt:(el.innerText||el.textContent||"").trim().slice(0,120)}; } catch(e){return {err:e.message}} })()`);
    console.log(`   ${label}:`);
    console.log(`     sel: ${sel.slice(0,100)}`);
    console.log(`     → ${JSON.stringify(info)}`);
  }
  await verify(detail.titleSelector, "title");
  await verify(detail.descSelector, "desc");
  await verify(detail.playTabSelector, "playTab (should be empty for movie)");
  await verify(detail.playListSelector, "playList (should be empty for movie)");
  console.log(`   playItem: ${detail.playItemSelector || "(empty)"}`);

  sw.close(); aiyi.close();
}
main().catch(e => { console.error(e); process.exit(1); });
