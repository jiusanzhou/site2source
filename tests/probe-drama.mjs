// 打开一部剧集页面，抓 tabs/lists 结构 + 观测 m3u8 请求
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
const reqs = [];
ws.on("message", d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); return; }
  if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    const type = m.params.type;
    if (type === "Media" || type === "XHR" || type === "Fetch" || /\.(m3u8|ts|mp4)(\?|$)/.test(r.url)) {
      reqs.push({ url: r.url, method: r.method, type });
    }
  }
});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");

const url = "https://www.aiyifan.tv/play/vEQ16j241LF";
console.log("nav:", url);
await send("Page.navigate", { url });
await new Promise(r=>setTimeout(r,10000));

const domInfo = await send("Runtime.evaluate", {
  expression: `
    (() => {
      const epCandidates = Array.from(document.querySelectorAll("a, button, li, div"))
        .filter(el => {
          const t = (el.textContent || "").trim();
          return t.length < 15 && /^(第.{1,3}集|EP\\d+|\\d+集?|\\d+$)/.test(t);
        }).slice(0, 40);
      const tabCandidates = Array.from(document.querySelectorAll("a, button, li, div, span"))
        .filter(el => {
          const t = (el.textContent || "").trim();
          return t.length < 15 && /^(云\\d+|BD云|优酷|腾讯视频|爱奇艺|iqiyi|qq视频|mgtv|芒果|线路|路线)/.test(t);
        }).slice(0, 20);
      const desc = (el) => ({
        tag: el.tagName,
        cls: (el.className||"").toString().slice(0, 80),
        txt: (el.textContent||"").trim().slice(0, 30),
        parent: el.parentElement?.tagName + "." + (el.parentElement?.className||"").toString().slice(0, 60),
      });
      return {
        epCount: epCandidates.length,
        eps: epCandidates.slice(0, 12).map(desc),
        tabCount: tabCandidates.length,
        tabs: tabCandidates.map(desc),
        title: document.title,
      };
    })()
  `, returnByValue: true,
});
const u = await send("Runtime.evaluate",{expression:"location.href",returnByValue:true});
console.log("URL now:", u.result.result.value);
console.log("DOM:", JSON.stringify(domInfo.result?.result?.value, null, 2));

await send("Runtime.evaluate", {
  expression: `
    const sels = [".vjs-big-play-button", ".plyr__control--overlaid", "[class*='play-btn' i]", "[class*='play-button' i]", ".vg-play", "[aria-label*='play' i]", "button[title*='播放']"];
    let clicked = 0;
    for (const s of sels) for (const b of document.querySelectorAll(s)) { try { b.click(); clicked++; } catch {} }
    const v = document.querySelector("video"); if (v) try { v.play(); } catch {}
    clicked;
  `, returnByValue: true,
}).then(r => console.log("play buttons:", r.result?.result?.value));

await new Promise(r=>setTimeout(r,10000));

console.log(`\n--- ${reqs.length} req ---`);
const uniq = new Map();
for (const r of reqs) {
  try {
    const u2 = new URL(r.url);
    const key = u2.origin + u2.pathname.replace(/[a-f0-9]{16,}/g,"*").replace(/\d{3,}/g,"*");
    if (!uniq.has(key)) uniq.set(key, r);
  } catch {}
}
for (const r of Array.from(uniq.values()).slice(0, 20)) console.log(`  [${r.type}] ${r.method} ${r.url.slice(0, 200)}`);

const mediaReqs = reqs.filter(r => /\.(m3u8|ts|mp4)(\?|$)/.test(r.url));
console.log(`\n--- ${mediaReqs.length} media ---`);
for (const r of mediaReqs.slice(0, 5)) console.log(`  ${r.url.slice(0, 250)}`);

ws.close();
