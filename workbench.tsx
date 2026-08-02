/**
 * v0.22 Workbench — role 卡片布局 (替代 v0.21 的 step 状态机)
 *
 * 结构:
 *   Header (站点 / 项目切换 / 设置)
 *   CaptureSummary (sticky, XHR / 媒体统计 + drawer)
 *   5 张 RoleCard (home / category / search / detail / play)
 *   ActionBar (完成度 dots + 生成/重置)
 *   PreviewDrawer (点生成后弹)
 *
 * 保留所有 v0.21 的能力: AI 分析 / 手动点选 / 试运行 / URL 模板 / 项目管理 / 设置.
 * 只是入口从 step 按钮改成了 role card 里的操作按钮.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  BaseInfo,
  CapturedMedia,
  CapturedXHR,
  DetailSpec,
  HomeSpec,
  MediaProbe,
  ProjectState,
  SerializedSample,
  SiteInfo,
  PickRole,
} from "~lib/messages";
import { isPlayable } from "~lib/m3u8-probe";
import {
  generateAPIDrpySpider,
  generateDrpySpider,
  generateTVBoxJSON,
  type APIGenerateInput,
} from "~lib/drpy-generator";
import type { DetailRuleResult, OnePlusRuleResult } from "~lib/rule-runner";
import { uploadToGist } from "~lib/gist-uploader";
import {
  askAIDetail,
  askAIList,
  askAITemplate,
  hasAIConfig,
  trimHTML,
} from "~lib/ai-helper";
import {
  copyToClipboard,
  downloadText,
  openInPlayer,
  sendToActiveTab,
  sendToBackground,
  shortURL,
  summarizeDetail,
  summarizeTestResult,
} from "~lib/popup-helpers";
import {
  DetailField,
  ProjectsPanel,
  SettingsPanel,
  type RoleName,
} from "~popup/components";
import { ApiPanel } from "~popup/api-panel";
import { CaptureSummary } from "~popup/capture-summary";
import { RoleCard, type RoleStatus } from "~popup/role-card";
import { ActionBar } from "~popup/action-bar";
import { PreviewDrawer, type PreviewArtifact } from "~popup/preview-drawer";
import { URLTemplateEditor, type TemplateConfig } from "~popup/url-template-editor";
import { SiteModelEditor } from "./sitemodel/editor";
import "./popup.css";

// ==================== helpers ====================

function ProbeBadge({ probe }: { probe: MediaProbe }) {
  const meta = isPlayable(probe.encryption);
  const colors: Record<string, string> = {
    "none": "#16a34a",
    "aes-128": "#0284c7",
    "sample-aes": "#dc2626",
    "widevine": "#dc2626",
    "playready": "#dc2626",
    "custom": "#d97706",
    "unknown": "#6b7280",
  };
  const labels: Record<string, string> = {
    "none": "✅ 无",
    "aes-128": "🔓 AES",
    "sample-aes": "🔒 SAE",
    "widevine": "🔒 WV",
    "playready": "🔒 PR",
    "custom": "⚠️ 自定义",
    "unknown": "❔",
  };
  return (
    <span
      title={meta.reason + (probe.keyURI ? "\nkey: " + probe.keyURI : "")}
      className="s2s-probe-badge"
      style={{ background: colors[probe.encryption] || "#6b7280" }}
    >
      {labels[probe.encryption] || probe.encryption}
      {probe.segmentCount ? ` · ${probe.segmentCount}段` : ""}
    </span>
  );
}

function isInSidePanel(): boolean {
  try {
    return window.location.pathname.includes("sidepanel");
  } catch {
    return false;
  }
}

function normalizeAPIURLForCate(url: string): string {
  return url
    .replace(/([?&](?:type|tid|cid|cat|category|class)=)[^&]+/i, "$1{cate}")
    .replace(/([?&](?:page|p|pg|pageNo|page_num)=)\d+/i, "$1{page}")
    .replace(/\/(\w+type|category)\/(\d+)/i, "/$1/{cate}");
}

// ==================== component ====================

export function Workbench() {
  // --- 核心状态 ---
  const [state, setState] = useState<ProjectState>({});
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [xhrs, setXHRs] = useState<CapturedXHR[]>([]);
  const [activeCard, setActiveCard] = useState<RoleName | null>(null);

  // --- 模态 ---
  const [showSettings, setShowSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showSiteModel, setShowSiteModel] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [templateEditor, setTemplateEditor] = useState<{
    initial: TemplateConfig;
  } | null>(null);
  const [pendingAPIExport, setPendingAPIExport] = useState<any>(null);

  // --- 副状态 ---
  const [notice, setNotice] = useState<string>("");
  const [aiStatus, setAIStatus] = useState<{ loading: boolean; msg?: string }>({
    loading: false,
  });
  const [testResult, setTestResult] = useState<OnePlusRuleResult | null>(null);
  const [detailTestResult, setDetailTestResult] = useState<DetailRuleResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [projects, setProjects] = useState<Array<ProjectState & { host: string }>>([]);
  const [previewArtifact, setPreviewArtifact] = useState<PreviewArtifact | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    loading: boolean;
    result?: { ok: boolean; spiderURL?: string; gistURL?: string; error?: string };
  }>({ loading: false });

  /** 用户从 CaptureSummary 抽屉里把某条 XHR 标为某 role, 存本地以便调 API 生成 */
  const [roleXHRs, setRoleXHRs] = useState<Partial<Record<RoleName, CapturedXHR>>>({});

  // ==================== 生命周期 ====================

  const loadState = useCallback(async () => {
    const res = await sendToBackground<{ state: ProjectState }>({ type: "GET_STATE" });
    if (res?.state) setState(res.state);
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const refreshCapture = useCallback(async () => {
    const [m, x] = await Promise.all([
      sendToBackground<{ media: CapturedMedia[] }>({ type: "GET_CAPTURED_MEDIA" }),
      sendToBackground<{ xhr: CapturedXHR[] }>({ type: "GET_CAPTURED_XHR" }),
    ]);
    if (m) setMedia(m.media || []);
    if (x) setXHRs(x.xhr || []);
  }, []);

  useEffect(() => {
    refreshCapture();
    const t = setInterval(refreshCapture, 1500);
    return () => clearInterval(t);
  }, [refreshCapture]);

  useEffect(() => {
    const listener = (msg: any) => {
      if (msg?.type === "PICK_RESULT") {
        handlePickResult(msg.role, msg.selector, msg.sample);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ==================== 保存 / 重置 ====================

  async function saveState(patch: Partial<ProjectState>, opts?: { replace?: Array<"detail" | "home" | "baseInfo"> }) {
    const r = await sendToBackground<{ state: ProjectState }>({
      type: "SAVE_STATE",
      state: patch,
      replace: opts?.replace,
    });
    if (r?.state) setState(r.state);
  }

  const resetAll = async () => {
    await sendToBackground({ type: "RESET_STATE" });
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    await sendToBackground({ type: "CLEAR_CAPTURED_XHR" });
    sendToActiveTab({ type: "STOP_INSPECT" });
    setState({});
    setMedia([]);
    setXHRs([]);
    setRoleXHRs({});
    setTestResult(null);
    setDetailTestResult(null);
    setPreviewArtifact(null);
    setShowPreview(false);
    setUploadStatus({ loading: false });
    setActiveCard(null);
  };

  // ==================== 点选 (共享) ====================

  const startPick = (role: PickRole) => {
    sendToActiveTab({ type: "START_PICK", role });
    if (!isInSidePanel()) window.close();
  };

  const handlePickResult = async (role: PickRole, selector: string, _sample?: string) => {
    if (!selector) return;
    if (role === "list") {
      await saveState({ listSelector: selector, listItemTag: "*" });
      setActiveCard("home");
    } else {
      const detail = { ...(state.detail || {}) };
      if (role === "title") detail.titleSelector = selector;
      else if (role === "desc") detail.descSelector = selector;
      else if (role === "playTab") detail.playTabSelector = selector;
      else if (role === "playList") detail.playListSelector = selector;
      else if (role === "playItem") detail.playItemSelector = selector;
      await saveState({ detail });
      setActiveCard("detail");
    }
  };

  const editDetailField = async (
    field:
      | "titleSelector"
      | "picSelector"
      | "descSelector"
      | "playTabSelector"
      | "playListSelector",
    val: string,
  ) => {
    const next: DetailSpec = { ...(state.detail || {}), [field]: val };
    await sendToBackground({ type: "SAVE_STATE", state: { detail: next } });
    setState((s) => ({ ...s, detail: next }));
    setDetailTestResult(null);
  };

  // ==================== 分析: 规则 + AI ====================

  const analyzeCurrentPage = async () => {
    setAIStatus({ loading: true, msg: "规则分析中..." });
    setNotice("");
    const [listRes, homeRes] = await Promise.all([
      sendToActiveTab<{
        site: SiteInfo;
        candidates: any[];
        baseInfo?: BaseInfo;
      }>({ type: "GET_CANDIDATES" }),
      sendToActiveTab<{ site: SiteInfo; spec: HomeSpec }>({ type: "GET_HOME_INFO" }),
    ]);
    setAIStatus({ loading: false });
    if (!listRes) {
      setNotice("无法与页面通信, 请刷新页面后重试");
      return;
    }
    const patch: Partial<ProjectState> = { site: listRes.site };
    if (homeRes?.spec) patch.home = homeRes.spec;
    if (listRes.baseInfo) patch.baseInfo = listRes.baseInfo;
    // 若只有一个候选, 直接采用
    if (listRes.candidates.length >= 1) {
      const c = listRes.candidates[0];
      patch.listSelector = c.selector;
      patch.listItemTag = c.itemTag;
      patch.listSamples = c.samples;
      patch.listMeta = { childCount: c.childCount, similarity: c.similarity };
    } else {
      setNotice(`未找到影片列表, 试试"手动选"或"AI 分析"`);
    }
    await saveState(patch);
    setActiveCard("home");
  };

  const askAIForList = async () => {
    if (!(await hasAIConfig())) {
      alert("请先在 ⚙ 设置里填 API Key");
      return;
    }
    setAIStatus({ loading: true, msg: "抓页面 HTML..." });
    const snap = await sendToActiveTab<{ html: string; url: string; title: string }>({
      type: "GET_HTML_SNAPSHOT",
    });
    if (!snap?.html) {
      setAIStatus({ loading: false, msg: "抓 HTML 失败" });
      return;
    }
    setAIStatus({ loading: true, msg: "AI 分析列表..." });
    const result = await askAIList(trimHTML(snap.html), snap.url, {
      listContainerSelector: state.listSelector,
      listItemTag: state.listItemTag,
    });
    if (result.errors?.length) {
      setAIStatus({ loading: false, msg: `❌ ${result.errors[0]}` });
      return;
    }
    if (!result.listContainerSelector) {
      setAIStatus({ loading: false, msg: "AI 没找到明确的影片列表" });
      return;
    }
    const patch: Partial<ProjectState> = {
      listSelector: result.listContainerSelector,
      listItemTag: result.listItemTag || "*",
    };
    const detailSamp = await sendToActiveTab<{ samples: SerializedSample[] }>({
      type: "GET_SAMPLES",
      selector: result.listContainerSelector,
      itemTag: result.listItemTag || "*",
    });
    if (detailSamp?.samples) patch.listSamples = detailSamp.samples;
    const rebase = await sendToActiveTab<{ baseInfo: BaseInfo }>({
      type: "RECOMPUTE_BASE",
      selector: result.listContainerSelector,
    });
    if (rebase?.baseInfo) patch.baseInfo = rebase.baseInfo;
    await saveState(patch);
    setTestResult(null);
    setAIStatus({
      loading: false,
      msg: `✅ ${result.listContainerSelector}${result.reasoning ? " — " + result.reasoning : ""}`,
    });
  };

  const askAIForDetail = async () => {
    if (!(await hasAIConfig())) {
      alert("请先在 ⚙ 设置里填 API Key");
      return;
    }
    setAIStatus({ loading: true, msg: "抓页面 HTML..." });
    const snap = await sendToActiveTab<{ html: string; url: string; title: string }>({
      type: "GET_HTML_SNAPSHOT",
    });
    if (!snap?.html) {
      setAIStatus({ loading: false, msg: "抓 HTML 失败" });
      return;
    }
    setAIStatus({ loading: true, msg: "AI 分析详情..." });
    const result = await askAIDetail(trimHTML(snap.html), snap.url, state.detail);
    if (result.errors?.length) {
      setAIStatus({ loading: false, msg: `❌ ${result.errors[0]}` });
      return;
    }
    const patch: DetailSpec = { ...(state.detail || {}) };
    let updates = 0;
    (
      [
        "titleSelector",
        "picSelector",
        "descSelector",
        "playTabSelector",
        "playListSelector",
      ] as const
    ).forEach((k) => {
      const v = result[k as keyof typeof result] as string | undefined;
      if (v && !patch[k]) {
        patch[k] = v;
        updates++;
      } else if (v && patch[k] && patch[k] !== v) {
        if (confirm(`${k} 已有 "${patch[k]}"\nAI 建议 "${v}"\n覆盖吗?`)) {
          patch[k] = v;
          updates++;
        }
      }
    });
    await sendToBackground({ type: "SAVE_STATE", state: { detail: patch } });
    setState((s) => ({ ...s, detail: patch }));
    setDetailTestResult(null);
    setAIStatus({
      loading: false,
      msg:
        updates > 0
          ? `✅ 更新 ${updates} 个字段${result.reasoning ? ": " + result.reasoning : ""}`
          : "AI 没找到能补的字段",
    });
  };

  // ==================== 试运行 ====================

  const runListTest = async () => {
    if (!state.listSelector) return;
    setTesting(true);
    const listExpr = `${state.listSelector} ${state.listItemTag || "*"}`;
    const rule = `${listExpr};*[title],img&&alt,text;img&&data-original||data-src||src;.*?(HD[0-9]*|4K|更新至第?.+?集|第.+?集|全.+?集|完结|连载|BD|超清|高清|\\d{4}).*?;a&&href`;
    const res = await sendToActiveTab<{ result: OnePlusRuleResult }>({
      type: "TEST_RULE",
      rule,
    });
    setTesting(false);
    if (res?.result) setTestResult(res.result);
  };

  const runDetailTest = async () => {
    if (!state.detail) return;
    setTesting(true);
    const res = await sendToActiveTab<{ result: DetailRuleResult }>({
      type: "TEST_DETAIL_RULE",
      input: {
        titleSelector: state.detail.titleSelector,
        picSelector: state.detail.picSelector,
        descSelector: state.detail.descSelector,
        playFromSelector: state.detail.playTabSelector,
        playListSelector: state.detail.playListSelector,
      },
    });
    setTesting(false);
    if (res?.result) setDetailTestResult(res.result);
  };

  const startManualPick = () => {
    sendToActiveTab({ type: "START_PICK", role: "list" });
    if (!isInSidePanel()) window.close();
  };

  const learnDetail = async () => {
    setAIStatus({ loading: true, msg: "学习详情页..." });
    const res = await sendToActiveTab<{ site: SiteInfo; spec: DetailSpec }>({
      type: "GET_DETAIL_INFO",
    });
    setAIStatus({ loading: false });
    if (!res) {
      setNotice("无法通信, 页面可能还没就绪");
      return;
    }
    await saveState({ detail: res.spec }, { replace: ["detail"] });
    setActiveCard("detail");
  };

  // ==================== XHR mark ====================

  const markXHRAs = async (xhr: CapturedXHR, role: RoleName) => {
    setRoleXHRs((prev) => ({ ...prev, [role]: xhr }));
    // 同时把 role 塞回后端的抓包记录里 (更新 xhr.role)
    // 为了简单起见, 这里只更新前端本地 xhrs 显示
    setXHRs((prev) =>
      prev.map((x) => (x.url === xhr.url && x.method === xhr.method ? { ...x, role } : x)),
    );
    // 对 home / detail / search 尝试把 URL 存进 state.home / state.detail 作为提示
    if (role === "home") {
      await saveState({ home: { ...(state.home || {}), searchAction: state.home?.searchAction } });
    }
    setNotice(`已把这条 XHR 标为 ${role}, 用"生成"按钮或 🕸 API 面板导出`);
    setTimeout(() => setNotice(""), 3000);
    setActiveCard(role);
  };

  const clearXHR = async () => {
    await sendToBackground({ type: "CLEAR_CAPTURED_XHR" });
    setXHRs([]);
    setRoleXHRs({});
  };

  const clearMedia = async () => {
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    setMedia([]);
  };

  // ==================== 项目切换 ====================

  const loadProjects = useCallback(async () => {
    const r = await sendToBackground<{
      projects: Array<ProjectState & { host: string }>;
    }>({ type: "LIST_PROJECTS" });
    if (r) setProjects(r.projects);
  }, []);

  const switchToProject = async (host: string) => {
    const r = await sendToBackground<{ state: ProjectState }>({
      type: "SWITCH_PROJECT",
      host,
    });
    if (r?.state) {
      setState(r.state);
      setTestResult(null);
      setDetailTestResult(null);
      setActiveCard(null);
      setShowProjects(false);
    }
  };

  const deleteProject = async (host: string) => {
    await sendToBackground({ type: "DELETE_PROJECT", host });
    await loadProjects();
    if (state.site?.host === host) {
      setState({});
      setActiveCard(null);
    }
  };

  const newProject = async () => {
    await sendToBackground({ type: "RESET_STATE" });
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    await sendToBackground({ type: "CLEAR_CAPTURED_XHR" });
    sendToActiveTab({ type: "STOP_INSPECT" });
    setState({});
    setTestResult(null);
    setDetailTestResult(null);
    setActiveCard(null);
    setShowProjects(false);
  };

  // ==================== 生成 ====================

  const buildArtifacts = (): PreviewArtifact | null => {
    if (!state.site) return null;
    if (!state.listSelector) {
      alert("至少要有列表容器才能生成 Spider (点首页卡的 [规则分析] 或 [AI 分析])");
      return null;
    }
    const s = state.site;
    const input = {
      siteName: s.siteName || s.host,
      baseURL: s.baseURL,
      host: s.host,
      baseInfo: state.baseInfo,
      listSelector: state.listSelector,
      itemSelector: state.listItemTag || "*",
      cardCount: state.listMeta?.childCount || 0,
      similarity: state.listMeta?.similarity || 0,
      samples: state.listSamples || [],
      detail: state.detail,
      home: state.home,
      media,
    };
    const spider = generateDrpySpider(input);
    const spiderName = "spider_" + s.host.replace(/[.:]/g, "_") + ".js";
    const tvbox = generateTVBoxJSON(input, "./" + spiderName);
    return { spider, spiderName, tvbox };
  };

  const doGenerate = () => {
    const a = buildArtifacts();
    if (!a) return;
    setPreviewArtifact(a);
    setShowPreview(true);
  };

  const doDownload = () => {
    const a = previewArtifact;
    if (!a) return;
    downloadText(a.spiderName, a.spider, "text/javascript");
    downloadText("tvbox.json", a.tvbox, "application/json");
    setNotice("✅ 已下载 spider + tvbox.json");
    setTimeout(() => setNotice(""), 2500);
  };

  const doUpload = async () => {
    const a = previewArtifact || buildArtifacts();
    if (!a || !state.site) return;
    setUploadStatus({ loading: true });
    const res = await uploadToGist(
      state.site.siteName || state.site.host,
      state.site.host,
      a.spider,
      a.tvbox,
    );
    setUploadStatus({ loading: false, result: res });
    if (res.ok && res.spiderURL) {
      await saveState({ gistURL: res.spiderURL });
    }
  };

  // ==================== 进度计算 ====================

  const roleStatus: Record<RoleName, RoleStatus> = {
    home:
      state.listSelector || state.home?.searchAction || roleXHRs.home
        ? "ok"
        : "empty",
    category:
      state.home?.categories && state.home.categories.length > 0
        ? "ok"
        : roleXHRs.category
          ? "partial"
          : "empty",
    search:
      state.home?.searchAction || roleXHRs.search
        ? "ok"
        : "empty",
    detail:
      state.detail?.titleSelector || state.detail?.playListSelector
        ? "ok"
        : roleXHRs.detail
          ? "partial"
          : "empty",
    play: media.some((m) => m.type === "m3u8" || m.type === "mp4")
      ? "ok"
      : "empty",
  };

  const canGenerate = !!state.site && !!state.listSelector;

  const toggleCard = (r: RoleName) => setActiveCard((c) => (c === r ? null : r));

  // ==================== 渲染 ====================

  return (
    <div className="s2s-workbench">
      <header className="s2s-header">
        <span className="s2s-logo">🎬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s2s-title">Site2Source</div>
          <div className="s2s-sub" title={state.site?.host || ""}>
            {state.site?.host || "TVBox 源生成器"}
          </div>
        </div>
        {!isInSidePanel() && (
          <button
            className="s2s-btn-mini"
            onClick={async () => {
              try {
                await sendToBackground({ type: "OPEN_SIDEPANEL", remember: true });
                window.close();
              } catch (e) {
                alert("打开侧边栏失败: " + (e as any).message);
              }
            }}
            title="打开侧边栏"
          >
            📌
          </button>
        )}
        <button
          className="s2s-btn-mini"
          onClick={() => setShowApi(true)}
          title="API 抓包 (老面板)"
        >
          🕸
        </button>
        <button
          className="s2s-btn-mini"
          onClick={() => setShowSiteModel(true)}
          title="SiteModel 编辑器 — SPA+签名站的 spider 生成"
        >
          🧬
        </button>
        <button
          className="s2s-btn-mini"
          onClick={() => {
            loadProjects();
            setShowProjects(true);
          }}
          title="项目列表"
        >
          📁
        </button>
        <button className="s2s-btn-mini" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </header>

      {/* Sticky 抓包区 */}
      <CaptureSummary
        xhrs={xhrs}
        media={media}
        onMarkAs={markXHRAs}
        onClearXHR={clearXHR}
        onClearMedia={clearMedia}
      />

      {notice && <div className="s2s-notice">{notice}</div>}

      {/* Role 卡片区 */}
      <div className="s2s-cards">
        {/* 空 site 提示 */}
        {!state.site && (
          <div className="s2s-empty-hero">
            <div className="s2s-empty-hero-title">👋 从当前页开始</div>
            <p className="s2s-tip">
              打开一个影视站的首页 / 分类 / 详情页, 然后点下方任一 role 卡片操作.
            </p>
            <div className="s2s-actions">
              <button
                className="s2s-btn s2s-btn-primary"
                onClick={analyzeCurrentPage}
                disabled={aiStatus.loading}
              >
                {aiStatus.loading ? aiStatus.msg || "..." : "🔎 规则分析当前页"}
              </button>
              <button
                className="s2s-btn s2s-btn-ghost"
                onClick={askAIForList}
                disabled={aiStatus.loading}
                title="用 AI 识别列表容器"
              >
                🤖 AI 分析
              </button>
            </div>
          </div>
        )}

        {/* Home */}
        <RoleCard
          role="home"
          status={roleStatus.home}
          expanded={activeCard === "home"}
          onToggle={() => toggleCard("home")}
          summary={
            state.listSelector ? (
              <>
                容器: <code>{shortURL(state.listSelector, 40)}</code>
                {state.listMeta && (
                  <span className="s2s-tip-dim">
                    {" "}
                    · {state.listMeta.childCount} 项
                  </span>
                )}
              </>
            ) : undefined
          }
          emptyHint={
            <>
              打开首页/分类页后, 点 <b>规则分析</b> 或 <b>AI 分析</b> 找列表容器,
              也可以在顶部 <b>抓包区</b> 找一条 XHR 点"标记为首页".
            </>
          }
          actions={
            <>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={analyzeCurrentPage}
                disabled={aiStatus.loading}
              >
                🔎 规则分析
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={askAIForList}
                disabled={aiStatus.loading}
              >
                🤖 AI 分析
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={startManualPick}
              >
                🖱 手动点选
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={runListTest}
                disabled={testing || !state.listSelector}
              >
                {testing ? "..." : "🧪 试运行"}
              </button>
            </>
          }
        >
          {state.listSamples && state.listSamples.length > 0 && (
            <div className="s2s-samples-mini">
              {state.listSamples.slice(0, 3).map((s, i) => (
                <div key={i} className="s2s-sample-mini">
                  · {s.name || "<无标题>"}
                </div>
              ))}
            </div>
          )}
          {testResult && (
            <div className="s2s-role-test">
              <b>🧪 {testResult.count} 项</b>{" "}
              <span className="s2s-tip-dim">{summarizeTestResult(testResult)}</span>
            </div>
          )}
          {aiStatus.msg && !aiStatus.loading && activeCard === "home" && (
            <div
              className={`s2s-notice ${aiStatus.msg.startsWith("❌") ? "s2s-notice-err" : ""}`}
              style={{ marginTop: 6 }}
            >
              {aiStatus.msg}
            </div>
          )}
        </RoleCard>

        {/* Category */}
        <RoleCard
          role="category"
          status={roleStatus.category}
          expanded={activeCard === "category"}
          onToggle={() => toggleCard("category")}
          summary={
            state.home?.categories && state.home.categories.length > 0 ? (
              <>已识别 {state.home.categories.length} 个分类</>
            ) : roleXHRs.category ? (
              <>已标记 XHR: {shortURL(roleXHRs.category.url, 40)}</>
            ) : undefined
          }
          emptyHint={
            <>
              在顶部抓包区找一条 URL 里带 <code>category</code> / <code>type=</code>{" "}
              的 XHR 点"标记为分类", 或走 🕸 API 面板导出.
            </>
          }
          actions={
            <>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={async () => {
                  const res = await sendToActiveTab<{ spec: HomeSpec }>({
                    type: "GET_HOME_INFO",
                  });
                  if (res?.spec) await saveState({ home: res.spec });
                }}
              >
                🔎 重新学习首页
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={() => setShowApi(true)}
              >
                🕸 打开 API 面板
              </button>
            </>
          }
        >
          {state.home?.categories && state.home.categories.length > 0 && (
            <div className="s2s-cat-list">
              {state.home.categories.slice(0, 12).map((c, i) => (
                <span key={i} className="s2s-cat-tag">
                  {c.name}
                </span>
              ))}
              {state.home.categories.length > 12 && (
                <span className="s2s-tip-dim">
                  ...共 {state.home.categories.length} 个
                </span>
              )}
            </div>
          )}
        </RoleCard>

        {/* Search */}
        <RoleCard
          role="search"
          status={roleStatus.search}
          expanded={activeCard === "search"}
          onToggle={() => toggleCard("search")}
          summary={
            state.home?.searchAction ? (
              <>
                接口: <code>{shortURL(state.home.searchAction, 40)}</code>
              </>
            ) : roleXHRs.search ? (
              <>已标记 XHR: {shortURL(roleXHRs.search.url, 40)}</>
            ) : undefined
          }
          emptyHint={
            <>
              在站内搜一下东西, 抓包会捕到搜索请求. 在顶部抽屉里给它点"标记为搜索".
            </>
          }
          actions={
            <>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={async () => {
                  const res = await sendToActiveTab<{ spec: HomeSpec }>({
                    type: "GET_HOME_INFO",
                  });
                  if (res?.spec) await saveState({ home: res.spec });
                }}
              >
                🔎 重新学习首页
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={() => setShowApi(true)}
              >
                🕸 打开 API 面板
              </button>
            </>
          }
        >
          {state.home?.searchAction && (
            <div className="s2s-info-row">
              <span className="s2s-info-label">搜索 form action:</span>
              <code>{state.home.searchAction}</code>
            </div>
          )}
        </RoleCard>

        {/* Detail */}
        <RoleCard
          role="detail"
          status={roleStatus.detail}
          expanded={activeCard === "detail"}
          onToggle={() => toggleCard("detail")}
          summary={
            state.detail?.titleSelector || state.detail?.playListSelector ? (
              <>
                {state.detail?.titleSelector && (
                  <span className="s2s-tag">标题 ✓</span>
                )}
                {state.detail?.playListSelector && (
                  <span className="s2s-tag">剧集 ✓</span>
                )}
                {state.detail?.descSelector && <span className="s2s-tag">简介 ✓</span>}
              </>
            ) : undefined
          }
          emptyHint={
            <>
              打开一部影片的详情页, 点 <b>规则学习</b> 或 <b>AI 分析</b> 让扩展识别标题
              / 简介 / 剧集列表.
            </>
          }
          actions={
            <>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={learnDetail}
                disabled={aiStatus.loading}
              >
                🔎 规则学习
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={askAIForDetail}
                disabled={aiStatus.loading}
              >
                🤖 AI 分析
              </button>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={runDetailTest}
                disabled={testing || !state.detail?.titleSelector}
              >
                {testing ? "..." : "🧪 试运行"}
              </button>
            </>
          }
        >
          {state.detail && (
            <div className="s2s-detail-grid">
              <DetailField
                label="标题"
                selector={state.detail.titleSelector}
                sample={detailTestResult?.title}
                onPick={() => startPick("title")}
                onEdit={(v) => editDetailField("titleSelector", v)}
              />
              <DetailField
                label="封面"
                selector={state.detail.picSelector}
                sample={detailTestResult?.pic}
                onPick={() => startPick("desc")}
                onEdit={(v) => editDetailField("picSelector", v)}
              />
              <DetailField
                label="简介"
                selector={state.detail.descSelector}
                sample={
                  detailTestResult?.desc?.slice(0, 60) +
                  (detailTestResult && detailTestResult.desc.length > 60 ? "..." : "")
                }
                onPick={() => startPick("desc")}
                onEdit={(v) => editDetailField("descSelector", v)}
              />
              <DetailField
                label="播放线路"
                selector={state.detail.playTabSelector}
                sample={detailTestResult?.playFrom.join(" / ")}
                onPick={() => startPick("playTab")}
                onEdit={(v) => editDetailField("playTabSelector", v)}
              />
              <DetailField
                label="剧集列表"
                selector={state.detail.playListSelector}
                sample={
                  detailTestResult && detailTestResult.playURL.length > 0
                    ? `${detailTestResult.playURL[0].episodes.length} 集`
                    : undefined
                }
                onPick={() => startPick("playList")}
                onEdit={(v) => editDetailField("playListSelector", v)}
              />
            </div>
          )}
          {detailTestResult && (
            <div className="s2s-role-test">
              <b>🧪 {summarizeDetail(detailTestResult)}</b>
              {detailTestResult.errors && (
                <div className="s2s-tip-dim" style={{ fontSize: 11 }}>
                  ⚠️ {detailTestResult.errors.join("; ")}
                </div>
              )}
            </div>
          )}
          {aiStatus.msg && !aiStatus.loading && activeCard === "detail" && (
            <div
              className={`s2s-notice ${aiStatus.msg.startsWith("❌") ? "s2s-notice-err" : ""}`}
              style={{ marginTop: 6 }}
            >
              {aiStatus.msg}
            </div>
          )}
        </RoleCard>

        {/* Play */}
        <RoleCard
          role="play"
          status={roleStatus.play}
          expanded={activeCard === "play"}
          onToggle={() => toggleCard("play")}
          summary={
            media.length > 0 ? (
              <>
                抓到 <b>{media.length}</b> 条流
                {media[0]?.probe && (
                  <span className="s2s-tip-dim"> · 首条 {media[0].probe.encryption}</span>
                )}
              </>
            ) : undefined
          }
          emptyHint={
            <>
              在网页上<b>点播放</b>, 扩展会自动抓 m3u8 / mp4. 抓到就自动派生成 🟢.
            </>
          }
          actions={
            <>
              <button
                className="s2s-btn s2s-btn-ghost s2s-btn-xs"
                onClick={clearMedia}
                disabled={media.length === 0}
              >
                🗑 清空
              </button>
            </>
          }
        >
          {media.length === 0 ? (
            <p className="s2s-tip s2s-tip-dim" style={{ margin: 0 }}>
              还没抓到媒体流.
            </p>
          ) : (
            <div className="s2s-media-list">
              {media.slice(-5).map((m, i) => (
                <div key={i} className="s2s-media-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="s2s-media-head">
                      <span className="s2s-media-type">{m.type}</span>
                      {m.probe && <ProbeBadge probe={m.probe} />}
                    </div>
                    <div className="s2s-media-url" title={m.url}>
                      {shortURL(m.url, 42)}
                    </div>
                  </div>
                  <div className="s2s-media-actions">
                    <button
                      className="s2s-btn-mini"
                      onClick={() => copyToClipboard(m.url)}
                      title="复制"
                    >
                      📋
                    </button>
                    <button
                      className="s2s-btn-mini"
                      onClick={() => openInPlayer(m.url)}
                      title="播放"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </RoleCard>
      </div>

      {/* 底部动作条 */}
      <ActionBar
        progress={roleStatus}
        canGenerate={canGenerate}
        onGenerate={doGenerate}
        onReset={resetAll}
        onCardClick={(r) => setActiveCard(r)}
      />

      {/* ==================== 模态 ==================== */}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showSiteModel && <SiteModelEditor onClose={() => setShowSiteModel(false)} />}
      {showProjects && (
        <ProjectsPanel
          projects={projects}
          activeHost={state.site?.host}
          onSwitch={switchToProject}
          onDelete={deleteProject}
          onNew={newProject}
          onClose={() => setShowProjects(false)}
        />
      )}
      {showApi && (
        <ApiPanel
          onClose={() => setShowApi(false)}
          onExport={(cfg) => {
            const site = state.site;
            if (!site) {
              alert("先分析下当前页, 让扩展知道站点信息");
              return;
            }
            setPendingAPIExport(cfg);
            setTemplateEditor({
              initial: {
                homeURL: normalizeAPIURLForCate(cfg.home.url),
                detailURL: cfg.detail
                  ? cfg.detail.url.replace(
                      /(\?|&|\/)(id|vod_id|movie_id)[=/]?([^&/?]+)/i,
                      (_m, p1, p2) => `${p1}${p2}={id}`,
                    )
                  : undefined,
                searchURL: cfg.search
                  ? cfg.search.url.replace(
                      /(\?|&)(wd|keyword|q|search)=[^&]+/i,
                      "$1$2={wd}",
                    )
                  : undefined,
                categories: [],
              },
            });
            setShowApi(false);
          }}
        />
      )}
      {templateEditor && (
        <URLTemplateEditor
          initial={templateEditor.initial}
          onAIRefine={async (current) => {
            const r = await sendToBackground<any>({ type: "GET_CAPTURED_XHR" });
            const xhrList = (r?.xhr || []).map((x: any) => ({
              url: x.url,
              method: x.method,
            }));
            const sample = pendingAPIExport?.home?.respBody?.slice(0, 800);
            const result = await askAITemplate(xhrList, current, sample);
            if (result.errors?.length) {
              alert("AI 补正失败: " + result.errors.join("; "));
              return null;
            }
            return {
              homeURL: result.homeURL || current.homeURL,
              detailURL:
                current.detailURL !== undefined
                  ? result.detailURL || current.detailURL
                  : undefined,
              searchURL:
                current.searchURL !== undefined
                  ? result.searchURL || current.searchURL
                  : undefined,
              categories:
                result.categories && result.categories.length > 0
                  ? result.categories
                  : current.categories,
            };
          }}
          onCancel={() => {
            setTemplateEditor(null);
            setPendingAPIExport(null);
          }}
          onOK={(cfg) => {
            const site = state.site!;
            const raw = pendingAPIExport;
            const apiInput: APIGenerateInput = {
              siteName: site.siteName,
              host: site.host.replace(/^https?:\/\//, ""),
              home: {
                urlTemplate: cfg.homeURL,
                method: raw.home.method as any,
                reqBody: raw.home.reqBody,
                listPath: raw.home.listPath || "$",
                fields: raw.home.fields || {},
              },
              detail:
                cfg.detailURL && raw.detail
                  ? {
                      urlTemplate: cfg.detailURL,
                      method: raw.detail.method as any,
                      fields: raw.detail.fields || {},
                      playSnippet: raw.detail.playSnippet,
                    }
                  : undefined,
              search:
                cfg.searchURL && raw.search
                  ? {
                      urlTemplate: cfg.searchURL,
                      method: raw.search.method as any,
                      listPath: raw.search.listPath || "$",
                      fields: raw.search.fields || {},
                    }
                  : undefined,
              categories: cfg.categories,
            };
            const spider = generateAPIDrpySpider(apiInput);
            downloadText(`${apiInput.host}.js`, spider, "text/javascript");
            alert(`✅ 已下载 API 型爬虫: ${apiInput.host}.js`);
            setTemplateEditor(null);
            setPendingAPIExport(null);
          }}
        />
      )}
      {showPreview && previewArtifact && (
        <PreviewDrawer
          artifact={previewArtifact}
          state={state}
          media={media}
          uploadStatus={uploadStatus}
          onDownload={doDownload}
          onUpload={doUpload}
          onClose={() => setShowPreview(false)}
        />
      )}

      <footer className="s2s-footer">v0.22 · Site2Source</footer>
    </div>
  );
}

export default Workbench;
