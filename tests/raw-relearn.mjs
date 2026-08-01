// 完整流程 v2 (raw CDP)：切详情 → 清老 detail → 规则学习 → 验证
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const EXT_ID = "pckceojdgcfiodeonckfgngdlpbecail";

class RawCDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.on("open", res);
      this.ws.on("error", rej);
    });
    this.ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.id && this.pending.has(m.id)) {
        const {res, rej} = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      }
    });
  }
  async send(method, params={}) {
    await this.ready;
    const mid = this.id++;
    return new Promise((res, rej) => {
      this.pending.set(mid, {res, rej});
      this.ws.send(JSON.stringify({id: mid, method, params}));
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error("eval: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    return r.result?.value;
  }
  close() { this.ws.close(); }
}

async function main() {
  const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
  const spT = targets.find(t => t.type === "page" && t.url.endsWith("sidepanel.html"));
  const aiT = targets.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
  if (!spT || !aiT) throw new Error("missing targets");
  console.log("sp:", spT.id);
  console.log("aiyi:", aiT.id);

  const sp = new RawCDP(spT.webSocketDebuggerUrl);
  const aiyi = new RawCDP(aiT.webSocketDebuggerUrl);
  await sp.send("Runtime.enable");
  await aiyi.send("Runtime.enable");
  await aiyi.send("Page.enable");

  // 1) aiyifan 切详情页
  console.log("\n[1] nav aiyifan → /play/Na5mm0pFZzP");
  await aiyi.send("Page.navigate", { url: "https://www.aiyifan.tv/play/Na5mm0pFZzP" });
  await new Promise(r=>setTimeout(r, 6000));
  const cur = await aiyi.eval(`location.href`);
  console.log("aiyi at:", cur);

  // 2) 清 detail
  console.log("\n[2] clear old detail via replace");
  const clearRes = await sp.eval(`new Promise(r => chrome.runtime.sendMessage({type:"SAVE_STATE", state:{detail:{}}, replace:["detail"]}, r))`, true);
  console.log("clear:", JSON.stringify(clearRes).slice(0, 100));

  // 3) 点 detail 卡（📄）+ 规则学习
  console.log("\n[3] expand detail card + click 规则学习");
  await sp.eval(`void [...document.querySelectorAll("button")].find(b => (b.innerText||"").trim()==="📄")?.click()`);
  await new Promise(r=>setTimeout(r, 1500));
  const btns = await sp.eval(`JSON.stringify([...document.querySelectorAll("button")].map(b=>(b.innerText||"").trim()))`);
  console.log("btns:", btns);
  const clk = await sp.eval(`(() => { const b=[...document.querySelectorAll("button")].find(b=>(b.innerText||"").includes("规则学习")); if(b){b.click();return "OK"} return "not-found"; })()`);
  console.log("clicked:", clk);
  await new Promise(r=>setTimeout(r, 4000));

  // 4) 读新的 detail
  const detail = await sp.eval(`(async () => { const s = await chrome.storage.local.get(null); return s["site2source:projects"]["www.aiyifan.tv"]?.detail; })()`, true);
  console.log("\n=== NEW detail ===");
  console.log(JSON.stringify(detail, null, 2));

  // 5) 逐字段验证
  console.log("\n=== Validation ===");
  async function verify(sel, label) {
    if (!sel) { console.log(`⚪ ${label}: (empty)`); return; }
    const info = await aiyi.eval(`(() => { try { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return {hit:false}; return {hit:true, tag:el.tagName, cls:el.className.slice(0,60), txt:(el.innerText||el.textContent||"").trim().slice(0,120)}; } catch(e){return {err:e.message}} })()`);
    console.log(`   ${label}:`);
    console.log(`     sel: ${sel.slice(0,100)}`);
    console.log(`     → ${JSON.stringify(info)}`);
  }
  await verify(detail?.titleSelector, "title");
  await verify(detail?.descSelector, "desc");
  await verify(detail?.playTabSelector, "playTab (should be empty for movies)");
  await verify(detail?.playListSelector, "playList (should be empty for movies)");
  console.log(`   playItem: ${detail?.playItemSelector || "(empty)"}`);

  sp.close();
  aiyi.close();
}
main().catch(e => { console.error(e); process.exit(1); });
