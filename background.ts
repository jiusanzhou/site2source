/**
 * Background Service Worker
 * 职责：
 * 1. 抓视频流请求（m3u8/mp4/flv/ts），含 Referer
 * 2. 项目状态持久化（chrome.storage.local）
 * 3. popup 关闭后仍保留数据
 */

import type { CapturedMedia, ProjectState, Message } from "~lib/messages";

const MEDIA_EXT_RE = /\.(m3u8|mp4|flv|ts)(\?|$)/i;
// 旧: 单条 state; 新: 按 host 存的项目库
const STATE_KEY = "site2source:state";           // legacy (仍读, 兼容老版本)
const PROJECTS_KEY = "site2source:projects";     // { [host]: ProjectState }
const ACTIVE_KEY = "site2source:active";         // 当前正在编辑的 host
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

async function getActiveHost(): Promise<string | undefined> {
  const r = await chrome.storage.local.get([ACTIVE_KEY]);
  return r[ACTIVE_KEY];
}

async function setActiveHost(host: string | undefined) {
  if (host) await chrome.storage.local.set({ [ACTIVE_KEY]: host });
  else await chrome.storage.local.remove([ACTIVE_KEY]);
}

async function getAllProjects(): Promise<Record<string, ProjectState>> {
  const r = await chrome.storage.local.get([PROJECTS_KEY, STATE_KEY]);
  const projects: Record<string, ProjectState> = r[PROJECTS_KEY] || {};
  // 兼容旧版本：把 legacy 单条 state 迁移进来
  const legacy: ProjectState | undefined = r[STATE_KEY];
  if (legacy && legacy.site?.host && !projects[legacy.site.host]) {
    projects[legacy.site.host] = legacy;
    await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
    await chrome.storage.local.remove([STATE_KEY]);
  }
  return projects;
}

async function getState(): Promise<ProjectState> {
  const active = await getActiveHost();
  if (!active) return {};
  const projects = await getAllProjects();
  return projects[active] || {};
}

async function mergeState(patch: Partial<ProjectState>): Promise<ProjectState> {
  const projects = await getAllProjects();
  let active = await getActiveHost();

  // 如果 patch 里带 site.host, 就用它做 key (处理"新项目/切换项目"的场景)
  const newHost = patch.site?.host;
  if (newHost && newHost !== active) {
    active = newHost;
    await setActiveHost(active);
  }
  if (!active) return {};

  const cur = projects[active] || {};
  const next: ProjectState = { ...cur, ...patch };
  if (patch.detail) next.detail = { ...(cur.detail || {}), ...patch.detail };
  if (patch.home) next.home = { ...(cur.home || {}), ...patch.home };
  if (patch.baseInfo) next.baseInfo = { ...(cur.baseInfo || {}), ...patch.baseInfo };

  next.updatedAt = Date.now();
  projects[active] = next;
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
  return next;
}

async function resetState() {
  const active = await getActiveHost();
  if (!active) return;
  const projects = await getAllProjects();
  delete projects[active];
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
  await setActiveHost(undefined);
}

async function listProjects(): Promise<Array<ProjectState & { host: string }>> {
  const projects = await getAllProjects();
  return Object.entries(projects)
    .map(([host, s]) => ({ ...s, host }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function switchProject(host: string): Promise<ProjectState> {
  await setActiveHost(host);
  const projects = await getAllProjects();
  return projects[host] || {};
}

async function deleteProject(host: string) {
  const projects = await getAllProjects();
  delete projects[host];
  await chrome.storage.local.set({ [PROJECTS_KEY]: projects });
  const active = await getActiveHost();
  if (active === host) await setActiveHost(undefined);
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

  if (msg.type === "LIST_PROJECTS") {
    listProjects().then((list) => sendResponse({ projects: list }));
    return true;
  }

  if (msg.type === "SWITCH_PROJECT") {
    switchProject(msg.host).then((s) => sendResponse({ state: s }));
    return true;
  }

  if (msg.type === "DELETE_PROJECT") {
    deleteProject(msg.host).then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

console.log("[site2source] background ready (v0.2)");
