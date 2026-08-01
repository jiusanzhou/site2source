// 不靠扩展，直接从 aiyifan 页面注入 fetch/XHR hook + 触发搜索
import WebSocket from "/opt/homebrew/lib/node_modules/ws/index.js";

const t = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
const aiT = t.find(x => x.type === "page" && x.url.includes("aiyifan.tv"));
if (!aiT) { console.log("no aiyi tab"); process.exit(1); }

const ws = new WebSocket(aiT.webSocketDebuggerUrl);
await new Promise(r => ws.on("open", r));
let id=1; const p=new Map();
ws.on("message", d => {
  const m = JSON.parse(d.toString());
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
});
function send(m,pp={}) { const i=id++; return new Promise(r=>{p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:pp}));}); }
await send("Runtime.enable");
await send("Page.enable");

// 1. 注入 hook
await send("Runtime.evaluate", {
  expression: `
    window.__probeXhrs = [];
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      const method = args[1]?.method || "GET";
      const body = typeof args[1]?.body === "string" ? args[1].body : "";
      window.__probeXhrs.push({ url, method, body, kind: "fetch" });
      return origFetch.apply(this, args);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u) {
      this.__probeM = m; this.__probeU = u;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
      window.__probeXhrs.push({ url: this.__probeU, method: this.__probeM, body: typeof body === "string" ? body : "", kind: "xhr" });
      return origSend.apply(this, arguments);
    };
    "hooked";
  `,
});
console.log("hooked");

// 2. 清空历史，聚焦输入框，输入关键词，按 Enter
const probe = "寒战";
await send("Runtime.evaluate", { expression: `window.__probeXhrs = [];` });

// 找 input 元素
const focus = await send("Runtime.evaluate", {
  expression: `
    const el = document.querySelector("#search-input");
    if (el) { el.focus(); el.click(); }
    !!el;
  `, returnByValue: true,
});
console.log("focused input:", focus.result?.result?.value);

// 用 CDP 直接输入文本（模拟真键盘，触发 Angular 事件）
for (const ch of probe) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
  await send("Input.dispatchKeyEvent", { type: "keyUp" });
  await new Promise(r=>setTimeout(r,100));
}
// 备胎：直接设 value + 触发 input 事件
await send("Runtime.evaluate", {
  expression: `
    const el = document.querySelector("#search-input");
    if (el && !el.value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      nativeSetter.call(el, "${probe}");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    el?.value;
  `, returnByValue: true,
}).then(r => console.log("input value:", r.result?.result?.value));

await new Promise(r=>setTimeout(r,800));

// 按 Enter
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp",   key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
console.log("pressed enter");

// 等 XHR 出来 + URL 变化
await new Promise(r=>setTimeout(r,4500));

const url = await send("Runtime.evaluate", { expression: `location.href`, returnByValue: true });
console.log("URL after:", url.result?.result?.value);

const xhrs = await send("Runtime.evaluate", { expression: `JSON.stringify(window.__probeXhrs || [])`, returnByValue: true });
const arr = JSON.parse(xhrs.result?.result?.value || "[]");
console.log(`captured ${arr.length} requests:`);
for (const x of arr) {
  const hit = x.url.includes(probe) || x.url.includes(encodeURIComponent(probe)) || (x.body||"").includes(probe);
  console.log(`  [${x.kind}] ${x.method} ${x.url.slice(0, 180)}${hit ? "   <-- HIT" : ""}`);
  if (x.body) console.log(`         body: ${x.body.slice(0,200)}`);
}

ws.close();
