// wake sw + print home.categories
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const t0 = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t0.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
if (aiT) {
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
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");
const r = await send("Runtime.evaluate", {
  expression: `(async () => { const s = await chrome.storage.local.get("site2source:projects"); return s["site2source:projects"]?.["www.aiyifan.tv"]?.home; })()`,
  awaitPromise: true, returnByValue: true,
});
const home = r.result?.result?.value || {};
console.log("categoryURLPattern:", home.categoryURLPattern);
console.log("searchAction:", home.searchAction);
console.log("categories:");
for (const c of (home.categories||[])) console.log(" -", c.name, "|", c.url);
ws.close();
