import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const spT = targets.find(t => t.type === "page" && t.url.endsWith("sidepanel.html"));
const ws = new WebSocket(spT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);} });
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
async function evalExp(e) { const r=await send("Runtime.evaluate",{expression:e,returnByValue:true}); return r.result?.result?.value; }
await send("Runtime.enable");

console.log("before click 📄, buttons count:", await evalExp(`document.querySelectorAll("button").length`));

// 点 📄
const r1 = await evalExp(`(() => {
  const b = [...document.querySelectorAll("button")].find(x => (x.innerText||"").trim() === "📄");
  if (!b) return "not-found";
  b.click();
  return "clicked, disabled=" + b.disabled;
})()`);
console.log("click 📄:", r1);

await new Promise(r=>setTimeout(r,800));
console.log("after click, buttons count:", await evalExp(`document.querySelectorAll("button").length`));
const list = await evalExp(`JSON.stringify([...document.querySelectorAll("button")].map(b=>(b.innerText||"").trim().slice(0,20)))`);
console.log("all btns:", list);

ws.close();
