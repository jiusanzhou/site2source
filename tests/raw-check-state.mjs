// 唤醒 sw + 查真实 storage
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

// step 1: wake sw via aiyi tab reload
const t0 = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t0.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
{
  const ws = new WebSocket(aiT.webSocketDebuggerUrl);
  await new Promise(r => ws.on("open", r));
  let id=1; const p=new Map();
  ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
  function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
  await send("Page.enable");
  await send("Page.reload");
  await new Promise(r=>setTimeout(r,4000));
  ws.close();
}

// step 2: 查 sw
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const swT = t.find(x => x.type === "service_worker");
console.log("sw?", !!swT);
if (!swT) process.exit(1);

const ws = new WebSocket(swT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");
const r = await send("Runtime.evaluate", {
  expression: `(async () => { const s = await chrome.storage.local.get(null); return s; })()`,
  awaitPromise: true, returnByValue: true,
});
const st = r.result?.result?.value;
console.log("storage keys:", Object.keys(st || {}));
if (st) {
  const proj = st["site2source:projects"]?.["www.aiyifan.tv"];
  console.log("project.detail:", JSON.stringify(proj?.detail, null, 2));
  console.log("project.listSelector:", proj?.listSelector);
  console.log("project.home?.categories.length:", (proj?.home?.categories||[]).length);
  console.log("xhr count:", (st["site2source:xhr"]||[]).length);
  console.log("media count:", (st["site2source:media"]||[]).length);
}
ws.close();
