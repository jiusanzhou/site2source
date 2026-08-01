// 观测搜索结果页 DOM 结构
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable"); await send("Page.enable");

await send("Page.navigate", { url: "https://www.aiyifan.tv/search/%E5%AF%92%E6%88%98" });
await new Promise(r=>setTimeout(r,6000));

const info = await send("Runtime.evaluate", {
  expression: `
    (() => {
      // 找看起来是"结果卡"的容器
      const cardCandidates = new Map();
      const links = Array.from(document.querySelectorAll("a[href*='/play/']"));
      for (const a of links) {
        let p = a.parentElement;
        for (let d=0; d<5 && p; d++) {
          if (!cardCandidates.has(p)) cardCandidates.set(p, { cnt: 0 });
          cardCandidates.get(p).cnt++;
          p = p.parentElement;
        }
      }
      const good = Array.from(cardCandidates.entries())
        .filter(([_,s]) => s.cnt >= 3 && s.cnt <= 50)
        .map(([el,s]) => ({
          tag: el.tagName,
          cls: (el.className||"").toString().slice(0, 80),
          cnt: s.cnt,
          childCnt: el.children.length,
        }))
        .sort((a,b) => b.cnt - a.cnt)
        .slice(0, 8);
      return {
        totalPlayLinks: links.length,
        title: document.title,
        candidates: good,
      };
    })()
  `, returnByValue: true,
});
console.log(JSON.stringify(info.result?.result?.value, null, 2));
ws.close();
