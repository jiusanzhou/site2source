import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = targets.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);} });
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");

const r = await send("Runtime.evaluate", {
  expression: `JSON.stringify([...document.querySelectorAll("h1,h2,h3,h4,h5,h6,.h1,.h2,.h3,.h4,.h5,.h6")].filter(el => {
    const t=(el.textContent||"").trim();
    return t.length>=2 && t.length<=60 && /[\\u4e00-\\u9fff]/.test(t);
  }).slice(0,10).map((el,i)=>({
    i, tag: el.tagName, cls: el.className.slice(0,50), txt: (el.textContent||"").trim().slice(0,50), y: el.getBoundingClientRect().top
  })))`,
  returnByValue: true,
});
console.log(JSON.stringify(JSON.parse(r.result.result.value), null, 2));
ws.close();
