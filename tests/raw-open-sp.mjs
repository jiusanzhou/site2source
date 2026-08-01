import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const sw = targets.find(t => t.type === "service_worker");
const aiyi = targets.find(t => t.type === "page" && t.url.includes("aiyifan.tv"));
console.log("sw:", sw?.id);
console.log("aiyi:", aiyi?.id);

const ws = new WebSocket(sw.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => { const m=JSON.parse(d.toString()); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id);} });
function send(method, params={}) { const mid=id++; return new Promise(r=>{p.set(mid,r);ws.send(JSON.stringify({id:mid,method,params}));}); }
await send("Runtime.enable");

// 从 sw 里，让 sidepanel 在 aiyifan tab 上打开
// aiyi tab id: 我们需要 chrome tab id, 不是 CDP target id
const r1 = await send("Runtime.evaluate", {
  expression: `(async () => {
    const tabs = await chrome.tabs.query({url: "https://www.aiyifan.tv/*"});
    console.log("tabs:", tabs.length);
    if (tabs.length === 0) return "no-aiyifan-tab";
    const tab = tabs[0];
    try {
      await chrome.sidePanel.open({tabId: tab.id});
      return "opened on tab " + tab.id;
    } catch(e) { return "err: " + e.message; }
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log("result:", r1.result?.value || r1);
ws.close();
