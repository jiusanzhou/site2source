import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const spT = targets.find(t => t.type === "page" && t.url.endsWith("sidepanel.html"));
const ws = new WebSocket(spT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);} });
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: `JSON.stringify({url:location.href, btns: [...document.querySelectorAll("button")].map(b=>(b.innerText||"").trim())})`, returnByValue: true });
console.log(JSON.parse(r.result.result.value));
ws.close();
