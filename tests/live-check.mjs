import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));
console.log("at:", aiyi.url());

// 硬重载
await aiyi.reload({ waitUntil: "domcontentloaded" });
await new Promise(r=>setTimeout(r, 4000));

// 现在应该注入了 content-script; 看所有 contexts
const cdp = await aiyi.target().createCDPSession();
await cdp.send("Runtime.enable");
const ctxs = [];
cdp.on("Runtime.executionContextCreated", (e) => ctxs.push(e.context));
await new Promise(r=>setTimeout(r, 500));
console.log("known contexts (after enable):", ctxs.map(c=>c.name));

// 或者直接看 sw 状态
const rs = await fetch("http://127.0.0.1:19222/json/list").then(r=>r.json());
console.log("all targets:");
for (const t of rs) console.log(" -", t.type, "|", t.url.slice(0, 90));

await browser.disconnect();
