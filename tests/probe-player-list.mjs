import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");

const info = await send("Runtime.evaluate", {
  expression: `
    (() => {
      const mediaList = document.querySelector("app-player-media-list");
      if (!mediaList) return { has: false };
      // dump 前 3 层子结构
      const walk = (el, depth) => {
        if (depth > 4) return { tag: el.tagName, cls: (el.className||"").toString().slice(0,40), truncated: true };
        return {
          tag: el.tagName,
          cls: (el.className||"").toString().slice(0,80),
          txt: (el.textContent||"").trim().slice(0, 30),
          children: Array.from(el.children).slice(0, 8).map(c => walk(c, depth+1)),
        };
      };
      return {
        has: true,
        selector_check: !!document.querySelector("app-player-media-list a"),
        aCount: document.querySelectorAll("app-player-media-list a, app-player-media-list li, app-player-media-list button").length,
        firstFewLinks: Array.from(document.querySelectorAll("app-player-media-list a, app-player-media-list [class*='item'], app-player-media-list li")).slice(0, 10).map(el => ({
          tag: el.tagName,
          cls: (el.className||"").toString().slice(0,80),
          txt: (el.textContent||"").trim().slice(0, 30),
          href: el.getAttribute("href"),
        })),
        rawStructure: walk(mediaList, 0),
      };
    })()
  `, returnByValue: true,
});
console.log(JSON.stringify(info.result?.result?.value, null, 2).slice(0, 3500));
ws.close();
