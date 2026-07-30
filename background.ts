/**
 * Background Service Worker
 * 职责：
 * 1. 抓视频流请求（m3u8/mp4/flv/ts），含 Referer
 * 2. 项目状态持久化（chrome.storage.local）
 * 3. popup 关闭后仍保留数据
 */

import type { CapturedMedia, ProjectState, Message } from "~lib/messages";

const MEDIA_EXT_RE = /\.(m3u8|mp4|flv|ts)(\?|$)/i;
const STATE_KEY = "site2source:state";
const MEDIA_KEY = "site2source:media";

function detectMediaType(url: string): string | null {
  const m = url.match(MEDIA_EXT_RE);
  return m ? m[1].toLowerCase() : null;
}

// ==================== 媒体抓取 ====================

// Referer 需要从 onSendHeaders 拿；先在 onBeforeRequest 记 requestId，再在 onSendHeaders 补 Referer
const pendingByRequest = new Map<string, CapturedMedia>();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const t = detectMediaType(details.url);
    if (!t) return;
    pendingByRequest.set(details.requestId, {
      url: details.url,
      type: t,
      timestamp: Date.now(),
    });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onSendHeaders.addListener(
  async (details) => {
    if (details.tabId < 0) return;
    const cap = pendingByRequest.get(details.requestId);
    if (!cap) return;
    pendingByRequest.delete(details.requestId);

    for (const h of details.requestHeaders || []) {
      if (h.name.toLowerCase() === "referer") {
        cap.referer = h.value;
        break;
      }
    }

    // 存到 storage（按 tabId 分组）
    await appendMedia(details.tabId, cap);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

async function appendMedia(tabId: number, cap: CapturedMedia) {
  const all = (await chrome.storage.local.get([MEDIA_KEY]))[MEDIA_KEY] || {};
  const key = String(tabId);
  const arr: CapturedMedia[] = all[key] || [];
  if (arr.some((m) => m.url === cap.url)) return; // dedup
  arr.push(cap);
  if (arr.length > 100) arr.shift();
  all[key] = arr;
  await chrome.storage.local.set({ [MEDIA_KEY]: all });

  chrome.action.setBadgeText({ tabId, text: String(arr.length) });
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
}

async function getMediaForTab(tabId: number): Promise<CapturedMedia[]> {
  const all = (await chrome.storage.local.get([MEDIA_KEY]))[MEDIA_KEY] || {};
  return all[String(tabId)] || [];
}

async function clearMediaForTab(tabId: number) {
  const all = (await chrome.storage.local.get([MEDIA_KEY]))[MEDIA_KEY] || {};
  delete all[String(tabId)];
  await chrome.storage.local.set({ [MEDIA_KEY]: all });
  chrome.action.setBadgeText({ tabId, text: "" });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearMediaForTab(tabId);
});

// ==================== 项目状态持久化 ====================

async function getState(): Promise<ProjectState> {
  const data = await chrome.storage.local.get([STATE_KEY]);
  return data[STATE_KEY] || {};
}

async function mergeState(patch: Partial<ProjectState>) {
  const cur = await getState();
  const next = { ...cur, ...patch };
  // detail 是嵌套的 → merge
  if (patch.detail) {
    next.detail = { ...(cur.detail || {}), ...patch.detail };
  }
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function resetState() {
  await chrome.storage.local.remove([STATE_KEY]);
}

// ==================== 消息中转 ====================

chrome.runtime.onMessage.addListener((msg: Message | any, _sender, sendResponse) => {
  if (!msg?.type) return false;

  if (msg.type === "GET_CAPTURED_MEDIA") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return sendResponse({ media: [] });
      sendResponse({ media: await getMediaForTab(tabId) });
    });
    return true;
  }

  if (msg.type === "CLEAR_CAPTURED_MEDIA") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId != null) await clearMediaForTab(tabId);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "SAVE_STATE") {
    mergeState(msg.state).then((next) => sendResponse({ state: next }));
    return true;
  }

  if (msg.type === "GET_STATE") {
    getState().then((s) => sendResponse({ state: s }));
    return true;
  }

  if (msg.type === "RESET_STATE") {
    resetState().then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

console.log("[site2source] background ready (v0.2)");
