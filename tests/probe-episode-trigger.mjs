import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);}});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");

// 找剧集展开按钮 —— 通常 hover 或 click 才出
const info = await send("Runtime.evaluate", {
  expression: `
    (() => {
      // 找播放列表触发器
      const trigger = document.querySelector(".player-media-list-trigger");
      if (trigger) {
        trigger.click();
      }
      return { clicked: !!trigger };
    })()
  `, returnByValue: true,
});
console.log("trigger click:", info.result?.result?.value);
await new Promise(r=>setTimeout(r,3000));

// 再查
const after = await send("Runtime.evaluate", {
  expression: `
    (() => {
      const items = Array.from(document.querySelectorAll("app-player-media-list *")).filter(el => {
        const t = (el.textContent||"").trim();
        return t && t.length < 15 && el.children.length === 0;
      }).slice(0, 20);
      return items.map(el => ({
        tag: el.tagName,
        cls: (el.className||"").toString().slice(0, 60),
        txt: (el.textContent||"").trim(),
        parentCls: (el.parentElement?.className||"").toString().slice(0, 80),
      }));
    })()
  `, returnByValue: true,
});
console.log("after trigger:");
console.log(JSON.stringify(after.result?.result?.value, null, 2));

// 看 v3/video/languagesplaylist API 抓 body / 找一部真剧
const langlist = await send("Runtime.evaluate", {
  expression: `fetch("https://m10.aiyifan.tv/v3/video/languagesplaylist?cinema=1&vid=vEQ16j241LF&lsk=1&taxis=0&cid=0,1,4,137").then(r=>r.text()).then(t => t.slice(0, 800)).catch(e => "err: " + e)`,
  awaitPromise: true, returnByValue: true,
});
console.log("\nlanguagesplaylist:", langlist.result?.result?.value);

ws.close();
