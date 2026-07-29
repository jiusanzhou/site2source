/**
 * Background Service Worker
 * 负责：
 * 1. 抓当前 tab 的视频流请求（m3u8/mp4/flv）
 * 2. 跨 tab 保存状态
 */

import type { CapturedMedia } from "~lib/messages";

const MEDIA_EXT_RE = /\.(m3u8|mp4|flv|ts)(\?|$)/i;
const MEDIA_CT_RE =
  /(application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|video\/|application\/octet-stream)/i;

// 按 tabId 存储抓到的媒体流
const captureMap = new Map<number, CapturedMedia[]>();

function isMediaURL(url: string): string | null {
  const m = url.match(MEDIA_EXT_RE);
  if (m) return m[1].toLowerCase();
  return null;
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const type = isMediaURL(details.url);
    if (!type) return;

    const arr = captureMap.get(details.tabId) || [];
    // 去重
    if (arr.some((m) => m.url === details.url)) return;
    arr.push({
      url: details.url,
      type,
      timestamp: Date.now(),
      sourceTabURL: "", // fill below
    });
    // 限制最多 50 条
    if (arr.length > 50) arr.shift();
    captureMap.set(details.tabId, arr);

    // 更新 badge
    chrome.action.setBadgeText({
      tabId: details.tabId,
      text: String(arr.length),
    });
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
  },
  { urls: ["<all_urls>"] }
);

// tab 关闭清理
chrome.tabs.onRemoved.addListener((tabId) => {
  captureMap.delete(tabId);
});

// popup 拉数据
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_CAPTURED_MEDIA") {
    // 拿当前活动 tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) {
        sendResponse({ media: [] });
        return;
      }
      const arr = captureMap.get(tabId) || [];
      sendResponse({ media: arr });
    });
    return true; // async response
  }

  if (msg?.type === "CLEAR_CAPTURED_MEDIA") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId != null) {
        captureMap.delete(tabId);
        chrome.action.setBadgeText({ tabId, text: "" });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

console.log("[site2source] background ready");
