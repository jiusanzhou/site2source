/**
 * Background Service Worker
 * 职责：
 * 1. 抓视频流请求（m3u8/mp4/flv/ts），含 Referer
 * 2. 项目状态持久化（chrome.storage.local）
 * 3. popup 关闭后仍保留数据
 */

import type { CapturedMedia, CapturedXHR, ProjectState, Message } from "~lib/messages";
import { guessRoleFromXHR } from "~lib/role-guess";
import { probeM3U8 } from "~lib/m3u8-probe";

const MEDIA_EXT_RE = /\.(m3u8|mp4|flv|ts)(\?|$)/i;
// 判断"可能是 API"的启发式: 路径含常见关键词, 或返回内容是 JSON
const API_URL_RE = /\/(api|json|ajax|data|search|list|category|detail|vod|film|movie|tv|content|feed)/i;
// 排除掉一堆噪音
const API_SKIP_RE = /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|mp4|m3u8|ts|flv)(\?|$)/i;
// 旧: 单条 state; 新: 按 host 存的项目库
const STATE_KEY = "site2source:state";           // legacy (仍读, 兼容老版本)
const PROJECTS_KEY = "site2source:projects";     // { [host]: ProjectState }
const ACTIVE_KEY = "site2source:active";         // 当前正在编辑的 host
const MEDIA_KEY = "site2source:media";
const XHR_KEY = "site2source:xhr";

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

  // m3u8 主动探测加密方式 (后台异步, 不阻塞抓包)
  if (cap.type === "m3u8" && !cap.probe) {
    probeAndUpdate(tabId, cap.url, cap.referer);
  }
}

/** 后台探测 m3u8, 完成后回写到 storage */
async function probeAndUpdate(tabId: number, url: string, referer?: string) {
  try {
    const probe = await probeM3U8(url, referer);
    const all = (await chrome.storage.local.get([MEDIA_KEY]))[MEDIA_KEY] || {};
    const key = String(tabId);
    const arr: CapturedMedia[] = all[key] || [];
    const idx = arr.findIndex((m) => m.url === url);
    if (idx < 0) return;
    arr[idx] = { ...arr[idx], probe };
    all[key] = arr;
    await chrome.storage.local.set({ [MEDIA_KEY]: all });
    console.log(`[s2s] m3u8 probe: ${probe.encryption}${probe.error ? " ("+probe.error+")" : ""} · ${url.slice(0,80)}`);
  } catch (e) {
    console.warn("[s2s] m3u8 probe failed", e);
  }
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
  clearXHRForTab(tabId);
});

// ==================== 注入 main world XHR hook ====================
//
// Plasmo 目前的 content_scripts 无法在 manifest 里可靠登记 world:MAIN 脚本,
// 改用 chrome.scripting.executeScript 手动注入到 page 的 main world.
// 只有当 popup 打开或用户主动"启用抓包"时才注入, 避免污染所有页面.

const injectedTabs = new Set<number>();

async function injectXHRHook(tabId: number) {
  if (injectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: xhrHookFn,
    });
    injectedTabs.add(tabId);
  } catch (e) {
    console.warn("[s2s] inject XHR hook failed", e);
  }
}

/**
 * 会被序列化后注入到 page main world 的函数.
 * 只能用 DOM API + window.postMessage.
 * hook fetch/XHR, 抓到 JSON/text 响应就 postMessage 出来.
 * isolated world 的 inspector.ts 会监听并转发到 background.
 */
function xhrHookFn() {
  if ((window as any).__s2s_xhr_hooked) return;
  (window as any).__s2s_xhr_hooked = true;

  const MAX_RESP = 50000;
  const IGNORE_RE = /\.(js|css|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|mp4|m3u8|ts|flv|mp3)(\?|$)/i;

  const report = (payload: any) => {
    try {
      window.postMessage({ __s2s_xhr: true, payload }, "*");
    } catch {}
  };

  const truncate = (s: string) => {
    if (!s) return { body: "", truncated: false };
    if (s.length > MAX_RESP) return { body: s.slice(0, MAX_RESP), truncated: true };
    return { body: s, truncated: false };
  };

  // fetch hook
  const origFetch = window.fetch;
  window.fetch = async function (input: any, init?: any) {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = init?.method || (typeof input === "object" ? input.method : "GET") || "GET";
    const reqBody = init?.body
      ? typeof init.body === "string"
        ? init.body
        : "[binary]"
      : undefined;

    if (IGNORE_RE.test(url)) return origFetch(input, init);

    const resp = await origFetch(input, init);
    try {
      const clone = resp.clone();
      const ct = clone.headers.get("content-type") || "";
      if (/json|xml|text/i.test(ct)) {
        const text = await clone.text();
        const t = truncate(text);
        report({
          url,
          method,
          reqBody,
          respStatus: resp.status,
          respContentType: ct,
          respBody: t.body,
          respTruncated: t.truncated,
          timestamp: Date.now(),
          pageURL: location.href,
        });
      }
    } catch {}
    return resp;
  };

  // XHR hook
  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;
  const origSetHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (method: string, url: string) {
    (this as any).__s2s_method = method;
    (this as any).__s2s_url = url;
    (this as any).__s2s_headers = {};
    // @ts-ignore
    return origOpen.apply(this, arguments);
  };
  XHR.prototype.setRequestHeader = function (k: string, v: string) {
    ((this as any).__s2s_headers = (this as any).__s2s_headers || {})[k] = v;
    // @ts-ignore
    return origSetHeader.apply(this, arguments);
  };
  XHR.prototype.send = function (body?: any) {
    const self = this as any;
    const url = self.__s2s_url || "";
    if (!IGNORE_RE.test(url)) {
      this.addEventListener("load", function () {
        try {
          const ct = self.getResponseHeader("content-type") || "";
          if (/json|xml|text/i.test(ct)) {
            const t = truncate(typeof self.responseText === "string" ? self.responseText : "");
            report({
              url,
              method: self.__s2s_method || "GET",
              reqHeaders: self.__s2s_headers,
              reqBody: typeof body === "string" ? body : undefined,
              respStatus: self.status,
              respContentType: ct,
              respBody: t.body,
              respTruncated: t.truncated,
              timestamp: Date.now(),
              pageURL: location.href,
            });
          }
        } catch {}
      });
    }
    // @ts-ignore
    return origSend.apply(this, arguments);
  };

  console.log("[s2s] XHR/fetch hook installed (main world, via bg inject)");
}

// 每次页面加载时自动注入 (但 chrome:// / about: 之类的会失败, 静默忽略)
chrome.webNavigation?.onCommitted?.addListener?.((details) => {
  if (details.frameId !== 0) return;
  if (!/^https?:/.test(details.url)) return;
  injectedTabs.delete(details.tabId); // 页面重载, 清标记
  injectXHRHook(details.tabId);
});

// 兜底: tabs.onUpdated
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "loading") return;
  if (!tab.url || !/^https?:/.test(tab.url)) return;
  injectedTabs.delete(tabId);
  injectXHRHook(tabId);
});

// ==================== XHR / API 抓取 ====================
//
// background 只能看到 URL + 请求头, 拿不到响应体。
// 完整流程: content script hook 页面的 fetch/XHR, 把 URL + body 发到 background 存起来。
// popup 读取列表, 需要重播时向 content script 发 REPLAY_XHR 消息, 由 page 侧真实请求。

async function appendXHR(tabId: number, xhr: CapturedXHR) {
  const all = (await chrome.storage.local.get([XHR_KEY]))[XHR_KEY] || {};
  const key = String(tabId);
  const arr: CapturedXHR[] = all[key] || [];
  // dedup: 相同 method + url + body 只留一条
  const sig = `${xhr.method}::${xhr.url}::${xhr.reqBody || ""}`;
  const existing = arr.findIndex((x) => `${x.method}::${x.url}::${x.reqBody || ""}` === sig);
  if (existing >= 0) {
    // 更新时间戳 + 响应
    arr[existing] = { ...arr[existing], ...xhr };
  } else {
    arr.push(xhr);
    if (arr.length > 200) arr.shift();
  }
  all[key] = arr;
  await chrome.storage.local.set({ [XHR_KEY]: all });
}

async function getXHRForTab(tabId: number): Promise<CapturedXHR[]> {
  const all = (await chrome.storage.local.get([XHR_KEY]))[XHR_KEY] || {};
  return all[String(tabId)] || [];
}

async function clearXHRForTab(tabId: number) {
  const all = (await chrome.storage.local.get([XHR_KEY]))[XHR_KEY] || {};
  delete all[String(tabId)];
  await chrome.storage.local.set({ [XHR_KEY]: all });
}

/** 判断一条 URL 是否"值得记录为 API 候选" */
function isLikelyAPI(url: string, contentType?: string): boolean {
  if (API_SKIP_RE.test(url)) return false;
  if (contentType && /json|xml|text/i.test(contentType)) return true;
  if (API_URL_RE.test(url)) return true;
  return false;
}

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

async function mergeState(patch: Partial<ProjectState>, opts?: { replace?: Array<"detail" | "home" | "baseInfo"> }): Promise<ProjectState> {
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
  const replace = new Set(opts?.replace || []);
  if (patch.detail) {
    next.detail = replace.has("detail") ? { ...patch.detail } : { ...(cur.detail || {}), ...patch.detail };
  }
  if (patch.home) {
    next.home = replace.has("home") ? { ...patch.home } : { ...(cur.home || {}), ...patch.home };
  }
  if (patch.baseInfo) {
    next.baseInfo = replace.has("baseInfo") ? { ...patch.baseInfo } : { ...(cur.baseInfo || {}), ...patch.baseInfo };
  }

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

  if (msg.type === "CAPTURE_XHR") {
    // content script hook 到一个 XHR, 让 background 判断是否值得存
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = _sender.tab?.id ?? tabs[0]?.id;
      if (tabId == null) return sendResponse({ ok: false });
      const xhr: CapturedXHR = msg.xhr;
      if (isLikelyAPI(xhr.url, xhr.respContentType)) {
        if (!xhr.roleGuess) {
          const g = guessRoleFromXHR(xhr);
          if (g) xhr.roleGuess = g;
        }
        await appendXHR(tabId, xhr);
        // 更新 badge (媒体 + XHR 合计)
        const media = await getMediaForTab(tabId);
        const total = media.length + (await getXHRForTab(tabId)).length;
        chrome.action.setBadgeText({ tabId, text: String(total) });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "GET_CAPTURED_XHR") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return sendResponse({ xhr: [] });
      sendResponse({ xhr: await getXHRForTab(tabId) });
    });
    return true;
  }

  if (msg.type === "LEARN_SEARCH_FROM_XHR") {
    // 从当前 tab 抓包的 XHR 里筛出搜索 API：
    //   1) URL 含 keyword/search/find/query 词
    //   2) URL param 或 body 里含 probeKeyword 字符串
    //   3) 生成一个 searchAction 模板（{wd} 占位）
    const probe = (msg.probeKeyword || "").trim();
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId == null) return sendResponse({ ok: false, reason: "no-tab" });
      const xhrs = await getXHRForTab(tabId);
      const encodedProbe = probe ? encodeURIComponent(probe) : "";
      const candidates: Array<{ url: string; method: string; param?: string; score: number; template: string; matchMode: "url" | "body" }> = [];
      for (const x of xhrs) {
        if (!x?.url) continue;
        let score = 0;
        let hitParam: string | undefined;
        let template = "";
        let matchMode: "url" | "body" = "url";
        try {
          const u = new URL(x.url);
          // URL path 含关键词
          if (/(search|find|query|s\/|keyword|suggest)/i.test(u.pathname)) score += 3;
          // URL param 命中
          for (const [k, v] of u.searchParams.entries()) {
            if (probe && (v === probe || v === encodedProbe || v.includes(probe))) {
              hitParam = k;
              score += 5;
              const clone = new URL(u.toString());
              clone.searchParams.set(k, "{wd}");
              // 保留 origin + path + 替换后 querystring
              template = clone.origin + clone.pathname + "?" + Array.from(clone.searchParams.entries())
                .map(([kk, vv]) => `${kk}=${vv === "{wd}" ? "**" : encodeURIComponent(vv)}`)
                .join("&");
              matchMode = "url";
            }
            if (/(wd|keyword|q|search|word|key|query)/i.test(k) && !hitParam) {
              hitParam = k;
              score += 2;
            }
          }
          // path 里含 probe 值本身
          if (probe && u.pathname.includes(probe)) {
            score += 4;
            template = u.origin + u.pathname.replace(probe, "**") + (u.search || "");
            matchMode = "url";
          }
          if (probe && u.pathname.includes(encodedProbe)) {
            score += 4;
            template = u.origin + u.pathname.replace(encodedProbe, "**") + (u.search || "");
            matchMode = "url";
          }
          // body 里含 probe
          if (probe && x.reqBody && x.reqBody.includes(probe)) {
            score += 4;
            template = x.url + ";post";
            matchMode = "body";
          }
        } catch { continue; }
        if (score > 0) {
          if (!template) {
            // 兜底：如果只匹到 param 名，把它填成 {wd}
            try {
              const u = new URL(x.url);
              if (hitParam) {
                u.searchParams.set(hitParam, "**");
                template = u.origin + u.pathname + "?" + Array.from(u.searchParams.entries()).map(([kk, vv]) => `${kk}=${vv}`).join("&");
              } else {
                template = x.url;
              }
            } catch {}
          }
          candidates.push({ url: x.url, method: x.method, param: hitParam, score, template, matchMode });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      sendResponse({
        ok: true,
        candidates: candidates.slice(0, 5),
        best: best ? { searchAction: best.template, searchParam: best.param, method: best.method, matchMode: best.matchMode } : undefined,
      });
    });
    return true;
  }

  if (msg.type === "CLEAR_CAPTURED_XHR") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId != null) await clearXHRForTab(tabId);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "REPLAY_XHR") {
    // 在 background 里重播抓到的请求 (带上原 headers + body)
    (async () => {
      try {
        const req = msg.xhr as CapturedXHR;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.reqHeaders || {})) {
          // 过滤 fetch 禁止设置的 header (Host/Origin/... 由浏览器接管)
          if (/^(host|origin|referer|content-length|cookie)$/i.test(k)) continue;
          headers[k] = v;
        }
        // Referer 用页面 URL, credentials 用 include 让浏览器带 cookie
        const res = await fetch(req.url, {
          method: req.method,
          headers,
          body: req.method === "POST" || req.method === "PUT" ? req.reqBody || null : undefined,
          credentials: "include",
        });
        const contentType = res.headers.get("content-type") || "";
        const text = await res.text();
        sendResponse({
          ok: res.ok,
          status: res.status,
          contentType,
          body: text.slice(0, 100000), // 100KB 限
          truncated: text.length > 100000,
        });
      } catch (e: any) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
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
    mergeState(msg.state, { replace: msg.replace }).then((next) => sendResponse({ state: next }));
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

// ==================== Side Panel ====================

const PREFER_SIDEPANEL_KEY = "s2s:preferSidepanel";

/**
 * 根据用户偏好决定点扩展图标弹啥.
 * 默认: sidepanel (v0.20+: 主流程都在侧栏, popup 只做信息展示 + 快捷入口)
 * 用户可以在 popup 里显式切回 popup 模式.
 */
async function refreshActionBehavior() {
  const r = await chrome.storage.local.get([PREFER_SIDEPANEL_KEY]);
  // 默认 true: 未设置过 = 侧栏优先
  const prefer = r[PREFER_SIDEPANEL_KEY] === undefined ? true : !!r[PREFER_SIDEPANEL_KEY];
  if (prefer) {
    // 点扩展图标直接开 sidepanel
    chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
    chrome.action.setPopup?.({ popup: "" }).catch(() => {});
  } else {
    chrome.sidePanel.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});
    chrome.action.setPopup?.({ popup: "popup.html" }).catch(() => {});
  }
}
refreshActionBehavior();

// 变化时同步 (popup 里切了偏好后)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[PREFER_SIDEPANEL_KEY]) {
    refreshActionBehavior();
  }
});

// popup 发消息触发打开侧边栏
chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === "OPEN_SIDEPANEL") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab?.windowId) {
        sendResponse({ ok: false });
        return;
      }
      // sidePanel.open 只能在用户手势的直接响应下调用
      // 从 popup 内消息里调用属于用户手势, 有效
      chrome.sidePanel
        .open({ tabId: tab.id, windowId: tab.windowId })
        .then(async () => {
          // 记住偏好: 用户主动打开过一次 sidepanel, 之后默认走 sidepanel
          if (msg.remember) {
            await chrome.storage.local.set({ [PREFER_SIDEPANEL_KEY]: true });
          }
          sendResponse({ ok: true });
        })
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    });
    return true;
  }

  if (msg?.type === "SET_UI_PREFERENCE") {
    // popup 里切换偏好
    chrome.storage.local
      .set({ [PREFER_SIDEPANEL_KEY]: !!msg.preferSidepanel })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
});
