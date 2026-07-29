/**
 * Content Script：注入到目标网页，负责：
 * 1. DOM 相似度分析
 * 2. 候选列表高亮
 * 3. 用户点击选择
 */

import {
  findListContainers,
  type ListCandidate,
} from "~lib/dom-analyzer";
import type {
  Message,
  SerializedCandidate,
  SerializedSample,
} from "~lib/messages";

// Plasmo content script config
export const config = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
};

// ==================== 高亮 overlay 管理 ====================

const OVERLAY_ID = "site2source-overlay";
const OVERLAY_STYLES = `
#${OVERLAY_ID}-container {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 2147483646;
}
.site2source-highlight {
  position: absolute;
  border: 3px solid;
  border-radius: 4px;
  pointer-events: none;
  transition: all 0.2s;
  box-sizing: border-box;
}
.site2source-highlight-label {
  position: absolute;
  top: -24px;
  left: 0;
  padding: 2px 8px;
  color: white;
  font: 12px/1.4 -apple-system, sans-serif;
  border-radius: 2px;
  white-space: nowrap;
  font-weight: 600;
}
`;

let overlayContainer: HTMLDivElement | null = null;

function ensureOverlay() {
  if (overlayContainer) return overlayContainer;
  const style = document.createElement("style");
  style.textContent = OVERLAY_STYLES;
  document.head.appendChild(style);

  overlayContainer = document.createElement("div");
  overlayContainer.id = `${OVERLAY_ID}-container`;
  document.body.appendChild(overlayContainer);
  return overlayContainer;
}

function clearOverlay() {
  if (overlayContainer) {
    overlayContainer.innerHTML = "";
  }
}

const CANDIDATE_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#3b82f6", // blue
];

function highlightCandidate(el: Element, idx: number, label: string) {
  const c = ensureOverlay();
  const rect = el.getBoundingClientRect();
  const div = document.createElement("div");
  div.className = "site2source-highlight";
  const color = CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length];
  div.style.borderColor = color;
  div.style.top = `${rect.top}px`;
  div.style.left = `${rect.left}px`;
  div.style.width = `${rect.width}px`;
  div.style.height = `${rect.height}px`;

  const lb = document.createElement("div");
  lb.className = "site2source-highlight-label";
  lb.textContent = label;
  lb.style.background = color;
  div.appendChild(lb);
  c.appendChild(div);
}

// ==================== 状态 ====================

let lastCandidates: ListCandidate[] = [];

function serializeCandidates(cs: ListCandidate[]): SerializedCandidate[] {
  return cs.map((c) => {
    // 计算 itemTag
    const firstChild = c.element.children[0];
    const itemTag = firstChild ? firstChild.tagName.toLowerCase() : "*";
    return {
      selector: c.selector,
      childCount: c.childCount,
      similarity: c.similarity,
      score: c.score,
      itemTag,
      samples: c.samples.map(
        (s): SerializedSample => ({
          name: s.name,
          pic: s.pic,
          url: s.url,
          remarks: s.remarks,
        })
      ),
    };
  });
}

function extractSiteInfo() {
  return {
    url: location.href,
    host: location.host,
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

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  if (msg.type === "GET_CANDIDATES") {
    lastCandidates = findListContainers(document);
    // 高亮所有候选
    clearOverlay();
    lastCandidates.forEach((c, i) => {
      highlightCandidate(
        c.element,
        i,
        `#${i + 1} · ${c.childCount} 项 · ${(c.similarity * 100).toFixed(0)}%`
      );
    });
    sendResponse({
      site: extractSiteInfo(),
      candidates: serializeCandidates(lastCandidates),
    });
    return true;
  }

  if (msg.type === "HIGHLIGHT_ELEMENT") {
    clearOverlay();
    try {
      const el = document.querySelector(msg.selector);
      if (el) {
        highlightCandidate(el, 0, "选中");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (e) {
      console.warn("[site2source] bad selector:", msg.selector);
    }
    return false;
  }

  if (msg.type === "STOP_INSPECT") {
    clearOverlay();
    return false;
  }

  return false;
});

// 让 popup 知道 content script 已就绪
console.log("[site2source] content script ready");
