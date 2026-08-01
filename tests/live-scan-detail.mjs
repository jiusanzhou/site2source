// 深度探查 aiyifan detail 页的关键组件
import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:19222", defaultViewport: null });
const pages = await browser.pages();
const aiyi = pages.find(p => p.url().includes("aiyifan.tv"));

console.log("at:", aiyi.url());

// 全面扫描: 找出所有可能的 tabs 和 episode list
const scan = await aiyi.evaluate(() => {
  const out = {};

  // 1) 找所有 a[href] 少text 集群
  const allA = [...document.querySelectorAll("a")];
  const shortAs = allA.filter(a => {
    const t = (a.innerText || "").trim();
    return t.length > 0 && t.length <= 8;
  });
  // groupby parent
  const groups = new Map();
  for (const a of shortAs) {
    const p = a.parentElement;
    if (!p) continue;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(a);
  }
  const sortedGroups = [...groups.entries()].filter(([p, arr]) => arr.length >= 3).sort((a,b) => b[1].length - a[1].length).slice(0, 8);
  out.aGroups = sortedGroups.map(([p, arr]) => ({
    parentTag: p.tagName,
    parentCls: p.className.slice(0, 80),
    aCount: arr.length,
    sampleTexts: arr.slice(0, 8).map(a => a.innerText.trim()),
    sampleHrefs: arr.slice(0, 3).map(a => a.href.slice(0, 80)),
  }));

  // 2) 找 span/div 集群，可能剧集用了非 a 元素
  for (const tag of ["span", "li", "button"]) {
    const els = [...document.querySelectorAll(tag)].filter(el => {
      const t = (el.innerText||"").trim();
      return t.length > 0 && t.length <= 8 && /\d/.test(t);
    });
    const gs = new Map();
    for (const el of els) {
      const p = el.parentElement;
      if (!p) continue;
      if (!gs.has(p)) gs.set(p, []);
      gs.get(p).push(el);
    }
    const top = [...gs.entries()].filter(([p, arr]) => arr.length >= 3).sort((a,b) => b[1].length - a[1].length).slice(0, 3);
    out[tag + "Groups"] = top.map(([p, arr]) => ({
      parentTag: p.tagName,
      parentCls: p.className.slice(0, 80),
      count: arr.length,
      samples: arr.slice(0, 8).map(el => el.innerText.trim()),
    }));
  }

  // 3) 全页面找含 "第X集" 或数字的短文本群
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const episodeLikeTexts = [];
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.textContent || "").trim();
    if (/^第[0-9零一二三四五六七八九十]+集$|^[0-9]{1,3}$|^EP\d+$/i.test(t)) {
      const parent = node.parentElement;
      episodeLikeTexts.push({
        text: t,
        parentTag: parent?.tagName,
        parentCls: parent?.className?.slice(0, 60),
        grandTag: parent?.parentElement?.tagName,
        grandCls: parent?.parentElement?.className?.slice(0, 60),
      });
    }
  }
  out.episodeLike = episodeLikeTexts.slice(0, 20);

  // 4) 找简介元素（含 "剧情" "简介" 附近的 p/div）
  const descHints = [];
  for (const el of document.querySelectorAll("p, div")) {
    const t = (el.innerText || "").trim();
    if (t.length < 40 || t.length > 500) continue;
    if (!/[\u4e00-\u9fff]/.test(t)) continue;
    // 判定"叶子文本"：直接文本节点长度占比
    const directText = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
    const ratio = directText.length / t.length;
    if (ratio < 0.5) continue; // 主要是嵌套文本
    descHints.push({
      tag: el.tagName,
      cls: el.className.slice(0, 60),
      textLen: t.length,
      directRatio: Math.round(ratio*100),
      sample: t.slice(0, 100),
    });
  }
  out.descCandidates = descHints.slice(0, 5);

  return out;
});

console.log(JSON.stringify(scan, null, 2));
await browser.disconnect();
