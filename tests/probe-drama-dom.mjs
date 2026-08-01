// 精细探测剧集页面
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable"); await send("Page.enable");

// URL 不变（还是那部剧）—— 抓 DOM 里可能的剧集/线路区
const info = await send("Runtime.evaluate", {
  expression: `
    (() => {
      // 找 Angular 常用的 selector: app-* / [class*=episode] / [class*=list] 里的 a/li
      const results = {};
      
      // 找类名含 episode/ep/set/juji/anthology 的容器
      const epContainers = Array.from(document.querySelectorAll("*"))
        .filter(el => {
          const c = (el.className || "").toString().toLowerCase();
          return /(episode|juji|set-list|playlist|play-list|anthology|coll-set|ep-list)/.test(c);
        })
        .slice(0, 20);
      results.epContainers = epContainers.map(el => ({
        tag: el.tagName, cls: (el.className||"").toString().slice(0,120), children: el.children.length,
        firstChildText: (el.firstElementChild?.textContent || "").trim().slice(0, 30),
      }));
      
      // 找页面上所有 h4 之后的容器（详情页结构）
      const allH4 = Array.from(document.querySelectorAll("h4, .h4"));
      results.h4Info = allH4.slice(0, 8).map(h => ({
        txt: (h.textContent||"").trim().slice(0,40),
        cls: (h.className||"").toString().slice(0,60),
      }));
      
      // 看 app-* 有哪些
      const angComps = Array.from(document.querySelectorAll("[class*='app-'], [class^='app-']"));
      const compTags = new Set();
      Array.from(document.querySelectorAll("*")).forEach(el => {
        if (el.tagName.toLowerCase().startsWith("app-")) compTags.add(el.tagName.toLowerCase());
      });
      results.appTags = Array.from(compTags).slice(0, 30);
      
      // 找可能的 tab 组：line/route/loops
      const lineContainers = Array.from(document.querySelectorAll("*"))
        .filter(el => /(line|route|source|from-list)/.test((el.className||"").toString().toLowerCase()))
        .slice(0, 10);
      results.lineContainers = lineContainers.map(el => ({
        tag: el.tagName, cls: (el.className||"").toString().slice(0,120), children: el.children.length,
      }));
      
      return results;
    })()
  `, returnByValue: true,
});
console.log(JSON.stringify(info.result?.result?.value, null, 2));
ws.close();
