// 从 aiyifan 首页找一部剧集 URL
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
if (!aiT) { console.log("no aiyi tab"); process.exit(1); }

const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable"); await send("Page.enable");

// 去电视剧列表
await send("Page.navigate", { url: "https://www.aiyifan.tv/drama" });
await new Promise(r=>setTimeout(r,5000));

// 找页面上前 5 个链接
const r = await send("Runtime.evaluate", {
  expression: `
    const anchors = Array.from(document.querySelectorAll("a[href*='/play/'], a[href*='/watch']"));
    anchors.slice(0, 10).map(a => ({
      href: a.href,
      text: (a.textContent || "").trim().slice(0, 40),
    }));
  `, returnByValue: true,
});
const links = r.result?.result?.value || [];
console.log("URL:", (await send("Runtime.evaluate",{expression:"location.href",returnByValue:true})).result.result.value);
for (const l of links) console.log(" -", l.href, "|", l.text);
ws.close();
