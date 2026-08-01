// 从 aiyifan tab content-script 发消息唤醒 sw
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = targets.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
if (!aiT) { console.log("no aiyi"); process.exit(1); }
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");

// Content-script isolated world 已经注入过，但要找到它的 execution context
// Simplest: 直接 dispatch DOM event, content-script 有监听 window.postMessage or 直接从 main world 触发
// 但 content-script 用 chrome.runtime.onMessage 收 —— 从外部 tab 页不能直接调
// Workaround: 让页面 reload, content-script 会重新 attach + sw 会被 wake
console.log("reloading aiyi to wake sw + inject content-script...");
await send("Page.enable");
await send("Page.reload");
await new Promise(r=>setTimeout(r,5000));

// 现在看有没有 sw
const t2 = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
for (const t of t2) console.log(" ", t.type, "|", t.url.slice(0,90));
ws.close();
