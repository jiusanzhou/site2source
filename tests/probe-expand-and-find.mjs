// 直接跑 expandCollapsed + findEpisodeContainer 逻辑
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable"); await send("Page.enable");

// 重新加载剧集页面（前面测试可能状态污染）
await send("Page.navigate", { url: "https://www.aiyifan.tv/play/vEQ16j241LF" });
await new Promise(r=>setTimeout(r,7000));

const info = await send("Runtime.evaluate", {
  expression: `
    (async () => {
      // 1. expand
      const triggers = [
        ".player-media-list-trigger",
        ".episode-list-trigger",
        "[class*='episode-trigger' i]",
      ];
      for (const s of triggers) for (const el of document.querySelectorAll(s)) try { el.click(); } catch {}
      await new Promise(r => setTimeout(r, 700));

      // 2. findEpisodeContainer (new logic)
      const EP_TEXT = /^(第[0-9零一二三四五六七八九十百]+[集话回]?|EP?\\d+|\\d{1,3}(-\\d+)?|完结篇|预告|花絮)$/i;
      const allAs = Array.from(document.querySelectorAll("a"));
      const epAs = allAs.filter(a => EP_TEXT.test((a.textContent || "").trim()));
      if (epAs.length < 3) return { found: false, reason: "no ep a", epAs: epAs.length };
      const containerStats = new Map();
      for (const a of epAs) {
        let p = a.parentElement;
        for (let d=0; d<8 && p; d++) {
          if (!containerStats.has(p)) {
            containerStats.set(p, { epCount: 0, totalA: p.querySelectorAll("a").length });
          }
          containerStats.get(p).epCount++;
          p = p.parentElement;
        }
      }
      const cands = [];
      for (const [el, s] of containerStats) {
        if (s.epCount < 3) continue;
        const ratio = s.epCount / Math.max(s.totalA, 1);
        if (ratio < 0.6) continue;
        cands.push({ el, ...s, ratio });
      }
      cands.sort((a,b) => (b.epCount - a.epCount) || (a.totalA - b.totalA) || (b.ratio - a.ratio));
      const best = cands[0]?.el;
      return {
        found: !!best,
        candidates: cands.length,
        top3: cands.slice(0,3).map(c => ({ tag: c.el.tagName, cls: (c.el.className||"").toString().slice(0,80), epCount: c.epCount, totalA: c.totalA })),
        tag: best?.tagName,
        cls: (best?.className||"").toString().slice(0,100),
        childCount: best?.children.length,
        firstA: (best?.querySelector("a")?.textContent||"").trim().slice(0,10),
      };
    })()
  `, awaitPromise: true, returnByValue: true,
});
console.log("result:", JSON.stringify(info.result?.result?.value, null, 2));
ws.close();
