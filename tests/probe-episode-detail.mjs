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
      const btns = Array.from(document.querySelectorAll("a.media-button"));
      // 检查是否有多个"分组"（线路/清晰度/字幕）
      // dump 前 4 个 button 和它们的祖先几层
      const first = btns[0];
      const trail = [];
      if (first) {
        let cur = first.parentElement;
        for (let i=0; i<6 && cur; i++) {
          trail.push({ tag: cur.tagName, cls: (cur.className||"").toString().slice(0,80) });
          cur = cur.parentElement;
        }
      }
      // 有几个 container 装了 .media-button
      const containers = new Set();
      btns.forEach(b => {
        let p = b.parentElement;
        while (p && !p.className?.toString?.().match(/media-btn/)) p = p.parentElement;
        if (p) containers.add(p.parentElement);
      });
      // 找所有含"线路/云/BD/优酷"的 tab
      const tabs = Array.from(document.querySelectorAll("app-player-media-list a, app-player-media-list button, app-player-media-list li, app-player-media-list [class*='tab' i]"))
        .filter(el => {
          const t = (el.textContent||"").trim();
          return t.length < 15 && /(云\\d+|BD|线路|优酷|腾讯|iqiyi|mgtv|1080p|720p|标清|高清)/.test(t);
        });
      return {
        btnCount: btns.length,
        trail,
        containerCount: containers.size,
        tabs: tabs.map(el => ({ tag: el.tagName, cls: (el.className||"").toString().slice(0,80), txt: (el.textContent||"").trim().slice(0,20) })),
        // 剧集第一个的完整 selector
        firstHref: first?.getAttribute("href"),
        firstText: (first?.textContent || "").trim(),
      };
    })()
  `, returnByValue: true,
});
console.log(JSON.stringify(info.result?.result?.value, null, 2));
ws.close();
