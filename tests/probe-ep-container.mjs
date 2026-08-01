// 用当前 aiyifan 剧集页面，跑 inspector.inferDetailInfo 逻辑
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");

// 检验 findEpisodeContainer 是否能选中 .n-media-list
const info = await send("Runtime.evaluate", {
  expression: `
    (() => {
      // 找所有 a 里 text 匹配 /^\\d+$/ 的容器
      const results = [];
      const containers = new Map();
      Array.from(document.querySelectorAll("a")).forEach(a => {
        const txt = (a.textContent||"").trim();
        if (/^\\d{1,3}$/.test(txt) && txt.length <= 3) {
          let p = a.parentElement;
          for (let d=0; d<6 && p; d++) {
            const key = p;
            if (!containers.has(key)) containers.set(key, { aCount: 0, digitACount: 0 });
            containers.get(key).digitACount++;
            p = p.parentElement;
          }
        }
      });
      // 计算每个容器总 a 数
      Array.from(document.querySelectorAll("a")).forEach(a => {
        let p = a.parentElement;
        for (let d=0; d<6 && p; d++) {
          if (containers.has(p)) containers.get(p).aCount++;
          p = p.parentElement;
        }
      });
      // 找 ratio >= 60% 且 count >= 5
      const good = Array.from(containers.entries())
        .map(([el, s]) => ({ el, ...s, ratio: s.digitACount / Math.max(s.aCount, 1) }))
        .filter(x => x.digitACount >= 5 && x.ratio >= 0.6)
        .sort((a,b) => a.el.contains(b.el) ? 1 : -1);
      return good.slice(0, 5).map(x => ({
        tag: x.el.tagName,
        cls: (x.el.className||"").toString().slice(0, 80),
        digitACount: x.digitACount,
        aCount: x.aCount,
        ratio: (x.ratio*100).toFixed(0) + "%",
      }));
    })()
  `, returnByValue: true,
});
console.log("candidates for episode container:");
console.log(JSON.stringify(info.result?.result?.value, null, 2));
ws.close();
