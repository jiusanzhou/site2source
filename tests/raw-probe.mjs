import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";
const targets = await fetch("http://127.0.0.1:19222/json/list").then(r => r.json());
console.log("all pages:");
for (const t of targets) if (t.type === "page") console.log(" -", t.id, "|", t.url);

// 尝试 attach 到每个 sidepanel target
for (const t of targets.filter(x => x.url.includes("sidepanel"))) {
  console.log("\ntrying:", t.id);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  try {
    await new Promise((res, rej) => {
      ws.on("open", res);
      ws.on("error", rej);
      setTimeout(() => rej(new Error("timeout")), 3000);
    });
    let id = 1, pending = new Map();
    ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }});
    function send(method, params={}) { const mid = id++; return new Promise(r => { pending.set(mid, r); ws.send(JSON.stringify({id:mid, method, params})); }); }
    await Promise.race([send("Runtime.enable"), new Promise((_,r)=>setTimeout(()=>r(new Error("timeout enable")), 3000))]);
    const r = await Promise.race([
      send("Runtime.evaluate", { expression: "JSON.stringify({url:location.href, hasCr:typeof chrome!=='undefined', hasRt: typeof chrome!=='undefined' && !!chrome.runtime, sw: chrome?.runtime?.id})", returnByValue: true }),
      new Promise((_,r)=>setTimeout(()=>r(new Error("timeout eval")), 5000))
    ]);
    console.log("  →", r.result?.value || r);
  } catch(e) { console.log("  err:", e.message); }
  ws.close();
}
