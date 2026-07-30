/**
 * Content Script（V0.2）
 *
 * 三种模式：
 *   1. AUTO_CANDIDATES：自动找列表候选（相似度算法）
 *   2. PICK：用户 hover 页面元素高亮 → 点击确认（用于手动选列表/详情字段）
 *   3. DETAIL_INFO：分析当前详情页，自动推断标题/简介/播放列表
 */

import {
  findListContainers,
  type ListCandidate,
} from "~lib/dom-analyzer";
import { inferBaseInfo } from "~lib/base-inferrer";
import { runOnePlusRule, runDetailRule } from "~lib/rule-runner";
import type {
  Message,
  PickRole,
  SerializedCandidate,
  SerializedSample,
  DetailSpec,
  HomeSpec,
  BaseInfo,
} from "~lib/messages";

export const config = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false,
};

// ==================== 样式注入 ====================

const OVERLAY_ID = "site2source-overlay-container";
const HOVER_ID = "site2source-hover";

const STYLES = `
#${OVERLAY_ID} {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  pointer-events: none;
  z-index: 2147483646;
}
.s2s-hl {
  position: absolute; border: 3px solid; border-radius: 4px;
  pointer-events: none; box-sizing: border-box;
  transition: all 0.1s ease-out;
}
.s2s-hl-label {
  position: absolute; top: -22px; left: 0;
  padding: 2px 8px; color: white; font: 12px/1.4 -apple-system, sans-serif;
  border-radius: 3px 3px 0 0; white-space: nowrap; font-weight: 600;
}
#${HOVER_ID} {
  position: absolute; pointer-events: none; z-index: 2147483647;
  border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.15);
  border-radius: 3px; box-sizing: border-box;
  transition: all 0.05s;
}
#${HOVER_ID}-label {
  position: absolute; top: -22px; left: 0;
  padding: 2px 8px; background: #3b82f6; color: white;
  font: 12px/1.4 -apple-system, sans-serif; border-radius: 3px;
  white-space: nowrap; font-weight: 600;
}
.s2s-pick-cursor, .s2s-pick-cursor * {
  cursor: crosshair !important;
}
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  const s = document.createElement("style");
  s.id = "site2source-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
  stylesInjected = true;
}

function ensureOverlay(): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (!el) {
    ensureStyles();
    el = document.createElement("div");
    el.id = OVERLAY_ID;
    document.body.appendChild(el);
  }
  return el;
}

function clearOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.innerHTML = "";
}

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

function drawHighlight(el: Element, colorIdx: number, label: string) {
  const c = ensureOverlay();
  const r = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.className = "s2s-hl";
  const color = COLORS[colorIdx % COLORS.length];
  Object.assign(div.style, {
    top: `${r.top}px`,
    left: `${r.left}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderColor: color,
  });
  const lb = document.createElement("div");
  lb.className = "s2s-hl-label";
  lb.textContent = label;
  lb.style.background = color;
  div.appendChild(lb);
  c.appendChild(div);
}

// ==================== 状态 ====================

let lastCandidates: ListCandidate[] = [];
let pickMode: PickRole | null = null;
let hoverEl: HTMLDivElement | null = null;
let hoverLabel: HTMLDivElement | null = null;

// ==================== Pick 模式 ====================

function startPickMode(role: PickRole) {
  pickMode = role;
  clearOverlay();
  ensureStyles();
  document.documentElement.classList.add("s2s-pick-cursor");
  ensureHoverElements();
  document.addEventListener("mousemove", onHoverMove, true);
  document.addEventListener("click", onPickClick, true);
  document.addEventListener("keydown", onPickKey, true);
}

function stopPickMode() {
  pickMode = null;
  document.documentElement.classList.remove("s2s-pick-cursor");
  hideHover();
  document.removeEventListener("mousemove", onHoverMove, true);
  document.removeEventListener("click", onPickClick, true);
  document.removeEventListener("keydown", onPickKey, true);
}

function ensureHoverElements() {
  if (hoverEl) return;
  hoverEl = document.createElement("div");
  hoverEl.id = HOVER_ID;
  hoverEl.style.display = "none";
  document.body.appendChild(hoverEl);
  hoverLabel = document.createElement("div");
  hoverLabel.id = `${HOVER_ID}-label`;
  hoverEl.appendChild(hoverLabel);
}

function hideHover() {
  if (hoverEl) hoverEl.style.display = "none";
}

function onHoverMove(e: MouseEvent) {
  if (!pickMode) return;
  const target = e.target as Element | null;
  if (!target || target === hoverEl || target === hoverLabel) return;
  if (!(target instanceof Element)) return;

  const r = target.getBoundingClientRect();
  if (!hoverEl || !hoverLabel) return;
  hoverEl.style.display = "block";
  hoverEl.style.top = `${r.top + window.scrollY}px`;
  hoverEl.style.left = `${r.left + window.scrollX}px`;
  hoverEl.style.width = `${r.width}px`;
  hoverEl.style.height = `${r.height}px`;
  hoverLabel.textContent = `${pickRoleLabel(pickMode!)} · ${target.tagName.toLowerCase()}${
    target.className ? "." + String(target.className).split(/\s+/)[0] : ""
  }`;
}

function onPickClick(e: MouseEvent) {
  if (!pickMode) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const target = e.target as Element | null;
  if (!target || !(target instanceof Element)) return;
  const selector = generateStableSelector(target);
  const sample = target.textContent?.trim().slice(0, 80) || "";
  chrome.runtime.sendMessage({
    type: "PICK_RESULT",
    role: pickMode,
    selector,
    sample,
  });
  stopPickMode();
}

function onPickKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    stopPickMode();
    chrome.runtime.sendMessage({ type: "PICK_RESULT", role: pickMode, selector: "", sample: "" });
  }
}

function pickRoleLabel(r: PickRole): string {
  switch (r) {
    case "list": return "选列表容器";
    case "title": return "选标题";
    case "desc": return "选简介";
    case "playTab": return "选播放线路";
    case "playList": return "选剧集容器";
    case "playItem": return "选单集";
    case "playButton": return "选播放按钮";
  }
}

// ==================== 稳定选择器生成 ====================

function generateStableSelector(el: Element): string {
  // 优先级：id > 独特 class > tag + nth-child 路径
  if (el.id && !/^\d/.test(el.id) && !isDynamicId(el.id)) {
    return `#${CSS.escape(el.id)}`;
  }

  // 找有稳定 class 的祖先 + 相对路径
  const path: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < 8) {
    const seg = describeSegment(cur);
    path.unshift(seg);
    // 找到一个有 id 的祖先就停
    if (cur.id && !isDynamicId(cur.id)) {
      path[0] = `#${CSS.escape(cur.id)}`;
      break;
    }
    cur = cur.parentElement;
    depth++;
  }
  return path.join(" > ");
}

function describeSegment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = getStableClasses(el);
  if (cls.length > 0) return `${tag}.${cls.map((c) => CSS.escape(c)).join(".")}`;
  // 用 nth-child 兜底
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }
  }
  return tag;
}

function getStableClasses(el: Element): string[] {
  if (!el.className || typeof el.className !== "string") return [];
  const classes = el.className.trim().split(/\s+/).filter(Boolean);
  return classes.filter((c) => !isDynamicClass(c)).slice(0, 2);
}

function isDynamicId(s: string): boolean {
  // 数字/hash 结尾/太长的一般是自动生成
  return /^[a-z0-9]{8,}$/i.test(s) || /^\d+$/.test(s);
}

function isDynamicClass(s: string): boolean {
  // css-in-js 常见 hash 模式：MuiXxxx-a1b2c3、_1abcDE_、jsx-1234567 之类
  if (s.length > 24) return true;
  if (/-[a-z0-9]{5,}$/i.test(s)) return true;
  if (/^jsx-\d+$/.test(s)) return true;
  if (/^css-[a-z0-9]+$/i.test(s)) return true;
  return false;
}

// ==================== Serialize / Site info ====================

function serializeCandidates(cs: ListCandidate[]): SerializedCandidate[] {
  return cs.map((c) => {
    const firstChild = c.element.children[0];
    const itemTag = firstChild ? firstChild.tagName.toLowerCase() : "*";
    return {
      selector: c.selector,
      childCount: c.childCount,
      similarity: c.similarity,
      score: c.score,
      itemTag,
      samples: c.samples.map((s): SerializedSample => ({
        name: s.name,
        pic: s.pic,
        url: s.url,
        remarks: s.remarks,
      })),
    };
  });
}

function extractSiteInfo() {
  return {
    url: location.href,
    host: location.host,
    baseURL: location.origin,
    siteName: cleanSiteName(document.title),
  };
}

function cleanSiteName(t: string): string {
  const seps = [" - ", " | ", " – ", " — ", "|", "_"];
  for (const sep of seps) {
    const idx = t.indexOf(sep);
    if (idx > 0) return t.slice(0, idx).trim();
  }
  return t.trim();
}

// ==================== 详情页信息推断 ====================

function inferDetailInfo(): DetailSpec {
  const spec: DetailSpec = { detailURL: location.href };

  // 标题：h1（含中文的最长）
  const h1s = Array.from(document.querySelectorAll("h1"));
  const bestH1 = h1s
    .filter((h) => /[\u4e00-\u9fff]/.test(h.textContent || ""))
    .sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
  if (bestH1) spec.titleSelector = generateStableSelector(bestH1);

  // 简介：找一段较长的中文文本（≥ 30 字，包含标点）
  const paras = Array.from(document.querySelectorAll("p, div, span"));
  const bestDesc = paras
    .filter((p) => {
      const t = (p.textContent || "").trim();
      return t.length > 30 && t.length < 500 && /[\u4e00-\u9fff]/.test(t) && /[，。！？]/.test(t);
    })
    .sort((a, b) => (b.textContent || "").length - (a.textContent || "").length)[0];
  if (bestDesc) spec.descSelector = generateStableSelector(bestDesc);

  // 播放线路 tab：一组 a 元素，text 包含 "线路"/"云"/"tv"/数字
  const tabsCandidates = findGroupOf("a", (a) => {
    const txt = (a.textContent || "").trim();
    return /(线路|优酷|腾讯|爱奇艺|iqiyi|qq|youku|云\d+|\d+云)/.test(txt);
  });
  if (tabsCandidates) spec.playTabSelector = tabsCandidates;

  // 剧集列表容器：一组 a 元素、text 短、多个（3+）
  const epsContainer = findEpisodeContainer();
  if (epsContainer) {
    spec.playListSelector = generateStableSelector(epsContainer);
    // 单集用第一个 a
    const firstA = epsContainer.querySelector("a");
    if (firstA) spec.playItemSelector = firstA.tagName.toLowerCase();
  }

  return spec;
}

function findGroupOf(tagName: string, filter: (el: Element) => boolean): string | undefined {
  // 找到包含至少 2 个满足条件的兄弟节点的父元素
  const all = Array.from(document.querySelectorAll(tagName));
  const buckets = new Map<Element, Element[]>();
  for (const el of all) {
    if (!filter(el)) continue;
    const p = el.parentElement;
    if (!p) continue;
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p)!.push(el);
  }
  let bestParent: Element | null = null;
  let bestCount = 1;
  for (const [p, items] of buckets) {
    if (items.length > bestCount) {
      bestCount = items.length;
      bestParent = p;
    }
  }
  if (!bestParent) return undefined;
  return generateStableSelector(bestParent);
}

function findEpisodeContainer(): Element | null {
  // 找有 3+ 个 <a> 子孙、a text 短（≤ 10）、多个 a 的公共父级
  const all = Array.from(document.querySelectorAll("ul, div, ol"));
  let best: Element | null = null;
  let bestScore = 0;
  for (const c of all) {
    const as = Array.from(c.querySelectorAll(":scope > * > a, :scope > a"));
    if (as.length < 3) continue;
    const shortText = as.filter((a) => (a.textContent || "").trim().length <= 12).length;
    const ratio = shortText / as.length;
    if (ratio < 0.7) continue;
    const score = as.length * ratio;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ==================== 首页 / 分类识别 ====================

/** 常见影视分类词（用于识别分类导航） */
const CATEGORY_KEYWORDS = [
  "电影", "电视剧", "综艺", "动漫", "动画", "纪录片", "短剧",
  "港剧", "台剧", "日剧", "韩剧", "美剧", "英剧",
  "喜剧", "动作", "爱情", "科幻", "恐怖", "悬疑", "战争", "剧情",
  "movie", "tv", "drama", "anime", "variety", "show",
];

function inferHomeInfo(): HomeSpec {
  const spec: HomeSpec = {};

  // 1. 分类导航：找一批 <a>，text 命中分类词，公共父级
  const links = Array.from(document.querySelectorAll("a"));
  const catLinks: { name: string; url: string; el: HTMLAnchorElement }[] = [];
  for (const a of links) {
    const txt = (a.textContent || "").trim();
    if (!txt || txt.length > 6) continue;
    if (CATEGORY_KEYWORDS.some((kw) => txt.includes(kw) || txt.toLowerCase() === kw)) {
      const href = a.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) continue;
      catLinks.push({ name: txt, url: new URL(href, location.href).toString(), el: a });
    }
  }

  // 找一个公共父级，包含最多分类链接
  if (catLinks.length >= 2) {
    const parentCount = new Map<Element, typeof catLinks>();
    for (const link of catLinks) {
      let p: Element | null = link.el.parentElement;
      let depth = 0;
      while (p && depth < 5) {
        if (!parentCount.has(p)) parentCount.set(p, []);
        parentCount.get(p)!.push(link);
        p = p.parentElement;
        depth++;
      }
    }
    // 取包含最多分类且节点最深的父级
    let bestParent: Element | null = null;
    let bestCount = 0;
    for (const [p, items] of parentCount) {
      // dedup
      const uniq = Array.from(new Map(items.map((i) => [i.name, i])).values());
      if (uniq.length > bestCount) {
        bestCount = uniq.length;
        bestParent = p;
      }
    }
    if (bestParent && bestCount >= 2) {
      const finalCats = catLinks.filter((c) => bestParent!.contains(c.el));
      // dedup by name
      const seen = new Set<string>();
      spec.categories = finalCats
        .filter((c) => {
          if (seen.has(c.name)) return false;
          seen.add(c.name);
          return true;
        })
        .slice(0, 20)
        .map((c) => ({ name: c.name, url: c.url }));

      // 尝试识别 URL pattern：找到 URL 里的分类 id
      spec.categoryURLPattern = inferCategoryPattern(spec.categories);
    }
  }

  // 2. 搜索识别：找 <form> 里有 input[name=wd|keyword|q|search|s]
  const forms = Array.from(document.querySelectorAll("form"));
  for (const f of forms) {
    const inputs = Array.from(f.querySelectorAll("input"));
    const searchInput = inputs.find((i) => {
      const n = (i.name || "").toLowerCase();
      const t = (i.type || "").toLowerCase();
      const p = (i.placeholder || "").toLowerCase();
      return (
        (n && /(wd|keyword|q|search|s|key|word)/.test(n)) ||
        t === "search" ||
        /search|搜索|查找|关键词/.test(p)
      );
    });
    if (searchInput) {
      const action = f.getAttribute("action") || location.pathname;
      const method = (f.getAttribute("method") || "get").toLowerCase();
      const param = searchInput.name || "wd";
      try {
        const actionURL = new URL(action, location.href);
        if (method === "get") {
          spec.searchAction = `${actionURL.origin}${actionURL.pathname}?${param}={wd}`;
        } else {
          spec.searchAction = actionURL.toString();
        }
        spec.searchParam = param;
        break;
      } catch {}
    }
  }

  return spec;
}

/** 从一批分类 URL 里推断路径模板，如 /vodtype/1.html → /vodtype/{class}.html */
function inferCategoryPattern(cats: { name: string; url: string }[]): string | undefined {
  if (cats.length < 2) return undefined;
  const paths = cats.map((c) => {
    try { return new URL(c.url).pathname; } catch { return c.url; }
  });
  // 找出所有 path 里第一个不同的数字段
  const segments = paths.map((p) => p.split("/").filter(Boolean));
  const minLen = Math.min(...segments.map((s) => s.length));
  let diffIdx = -1;
  for (let i = 0; i < minLen; i++) {
    const vals = new Set(segments.map((s) => s[i]));
    if (vals.size > 1) {
      // 检查是不是纯数字或"数字.html"
      const allNumeric = Array.from(vals).every((v) => /^\d+(\.html?)?$/.test(v));
      if (allNumeric) {
        diffIdx = i;
        break;
      }
    }
  }
  if (diffIdx === -1) return undefined;

  const template = segments[0].slice();
  const original = template[diffIdx];
  // 保留 .html 后缀
  const ext = original.match(/\.html?$/i);
  template[diffIdx] = ext ? `{class}${ext[0]}` : "{class}";
  return "/" + template.join("/");
}


// ==================== 消息路由 ====================

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "GET_CANDIDATES") {
    lastCandidates = findListContainers(document);
    clearOverlay();
    lastCandidates.forEach((c, i) => {
      drawHighlight(
        c.element,
        i,
        `#${i + 1} · ${c.childCount} 项 · ${(c.similarity * 100).toFixed(0)}%`
      );
    });
    // base 用得分最高的候选容器来推断（更准）
    const topContainer = lastCandidates[0]?.element;
    const baseInfo: BaseInfo = inferBaseInfo(topContainer);
    sendResponse({
      site: extractSiteInfo(),
      candidates: serializeCandidates(lastCandidates),
      baseInfo,
    });
    return true;
  }

  if (msg.type === "HIGHLIGHT_ELEMENT") {
    clearOverlay();
    try {
      const el = document.querySelector(msg.selector);
      if (el) {
        drawHighlight(el, 3, "已选");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch {}
    return false;
  }

  if (msg.type === "RECOMPUTE_BASE") {
    let root: Element | null = null;
    try { root = document.querySelector(msg.selector); } catch {}
    const baseInfo = inferBaseInfo(root);
    sendResponse({ baseInfo });
    return true;
  }

  if (msg.type === "TEST_RULE") {
    const result = runOnePlusRule(document, msg.rule);
    sendResponse({ result });
    return true;
  }

  if (msg.type === "TEST_DETAIL_RULE") {
    const result = runDetailRule(document, msg.input);
    sendResponse({ result });
    return true;
  }

  if (msg.type === "STOP_INSPECT") {
    clearOverlay();
    stopPickMode();
    return false;
  }

  if (msg.type === "START_PICK") {
    startPickMode(msg.role);
    return false;
  }

  if (msg.type === "STOP_PICK") {
    stopPickMode();
    return false;
  }

  if (msg.type === "GET_DETAIL_INFO") {
    const spec = inferDetailInfo();
    // 可视化：把推断出的字段高亮
    clearOverlay();
    if (spec.titleSelector) tryHighlight(spec.titleSelector, 0, "标题");
    if (spec.descSelector) tryHighlight(spec.descSelector, 1, "简介");
    if (spec.playTabSelector) tryHighlight(spec.playTabSelector, 2, "线路");
    if (spec.playListSelector) tryHighlight(spec.playListSelector, 3, "剧集");
    sendResponse({ site: extractSiteInfo(), spec });
    return true;
  }

  if (msg.type === "GET_HOME_INFO") {
    const spec = inferHomeInfo();
    sendResponse({ site: extractSiteInfo(), spec });
    return true;
  }

  return false;
});

function tryHighlight(sel: string, colorIdx: number, label: string) {
  try {
    const el = document.querySelector(sel);
    if (el) drawHighlight(el, colorIdx, label);
  } catch {}
}

console.log("[site2source] content script ready (v0.2)");
