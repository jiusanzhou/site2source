import { useEffect, useState, useCallback } from "react";
import type {
  BaseInfo,
  CapturedMedia,
  DetailSpec,
  HomeSpec,
  ProjectState,
  SerializedCandidate,
  SerializedSample,
  SiteInfo,
  PickRole,
} from "~lib/messages";
import {
  generateDrpySpider,
  generateAPIDrpySpider,
  generateTVBoxJSON,
  type APIGenerateInput,
} from "~lib/drpy-generator";
import { runOnePlusRule, type OnePlusRuleResult, type DetailRuleResult } from "~lib/rule-runner";
import { uploadToGist } from "~lib/gist-uploader";
import { askAIDetail, askAIList, trimHTML, hasAIConfig } from "~lib/ai-helper";
import {
  sendToActiveTab,
  sendToBackground,
  downloadText,
  shortURL,
  copyToClipboard,
  openInPlayer,
  summarizeTestResult,
  summarizeDetail,
} from "~lib/popup-helpers";
import {
  BasePanel,
  DetailField,
  ProgressBar,
  ProjectsPanel,
  SampleCard,
  SettingsPanel,
  type Step,
} from "~popup/components";
import { ApiPanel } from "~popup/api-panel";
import "./popup.css";

// ==================== component ====================

/** 把抓到的 URL 里的具体 type/page 参数替换成 {cate}/{page} 占位符 */
function normalizeAPIURLForCate(url: string): string {
  return url
    // type/tid/cid = 数字 → {cate}
    .replace(/([?&](?:type|tid|cid|cat|category|class)=)[^&]+/i, "$1{cate}")
    // page/p = 数字 → {page}
    .replace(/([?&](?:page|p|pg|pageNo|page_num)=)\d+/i, "$1{page}")
    // 路径里的 /vodtype/1.html
    .replace(/\/(\w+type|category)\/(\d+)/i, "/$1/{cate}");
}

function Popup() {
  const [step, setStep] = useState<Step>("start");
  const [state, setState] = useState<ProjectState>({});
  const [candidates, setCandidates] = useState<SerializedCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [projects, setProjects] = useState<Array<ProjectState & { host: string }>>([]);
  const [testResult, setTestResult] = useState<OnePlusRuleResult | null>(null);
  const [detailTestResult, setDetailTestResult] = useState<DetailRuleResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    loading: boolean;
    result?: { ok: boolean; spiderURL?: string; gistURL?: string; error?: string };
  }>({ loading: false });

  const loadState = useCallback(async () => {
    const res = await sendToBackground<{ state: ProjectState }>({ type: "GET_STATE" });
    if (res?.state) {
      setState(res.state);
      if (res.state.listSelector) setStep("listReview");
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  const refreshMedia = useCallback(async () => {
    const r = await sendToBackground<{ media: CapturedMedia[] }>({ type: "GET_CAPTURED_MEDIA" });
    if (r) setMedia(r.media);
  }, []);

  useEffect(() => {
    refreshMedia();
    const t = setInterval(refreshMedia, 1500);
    return () => clearInterval(t);
  }, [refreshMedia]);

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

  async function saveState(patch: Partial<ProjectState>) {
    const r = await sendToBackground<{ state: ProjectState }>({
      type: "SAVE_STATE",
      state: patch,
    });
    if (r?.state) setState(r.state);
  }

  const analyzeCurrentPage = async () => {
    setLoading(true);
    setNotice("");
    const [listRes, homeRes] = await Promise.all([
      sendToActiveTab<{
        site: SiteInfo;
        candidates: SerializedCandidate[];
        baseInfo?: BaseInfo;
      }>({ type: "GET_CANDIDATES" }),
      sendToActiveTab<{ site: SiteInfo; spec: HomeSpec }>({ type: "GET_HOME_INFO" }),
    ]);
    setLoading(false);
    if (!listRes) {
      setNotice("无法与页面通信，请刷新页面后重试");
      return;
    }
    setCandidates(listRes.candidates);
    const patch: Partial<ProjectState> = { site: listRes.site };
    if (homeRes?.spec) patch.home = homeRes.spec;
    if (listRes.baseInfo) patch.baseInfo = listRes.baseInfo;
    await saveState(patch);
    if (listRes.candidates.length === 0) {
      setNotice(`未找到影片列表。可以试试"手动选"按钮。`);
      return;
    }
    setStep("listPick");
    if (listRes.candidates.length === 1) pickCandidate(0);
  };

  const pickCandidate = async (i: number) => {
    setSelectedIdx(i);
    const c = candidates[i];
    sendToActiveTab({ type: "HIGHLIGHT_ELEMENT", selector: c.selector });
    // 用真实选中的容器重算 base（更准）
    const rebase = await sendToActiveTab<{ baseInfo: BaseInfo }>({
      type: "RECOMPUTE_BASE",
      selector: c.selector,
    });
    const patch: Partial<ProjectState> = {
      listSelector: c.selector,
      listItemTag: c.itemTag,
      listSamples: c.samples,
      listMeta: { childCount: c.childCount, similarity: c.similarity },
    };
    if (rebase?.baseInfo) {
      // 保留旧的 overrideBase（用户可能已经手工改过）
      patch.baseInfo = {
        ...rebase.baseInfo,
        overrideBase: state.baseInfo?.overrideBase,
      };
    }
    await saveState(patch);
    setStep("listReview");
  };

  const setOverrideBase = async (val: string) => {
    if (!state.baseInfo) return;
    await saveState({
      baseInfo: { ...state.baseInfo, overrideBase: val || undefined },
    });
  };

  const startManualPick = () => {
    sendToActiveTab({ type: "START_PICK", role: "list" });
    window.close();
  };

  const learnDetail = async () => {
    setLoading(true);
    const res = await sendToActiveTab<{ site: SiteInfo; spec: DetailSpec }>({
      type: "GET_DETAIL_INFO",
    });
    setLoading(false);
    if (!res) {
      setNotice("无法通信，可能这个页面还没就绪");
      return;
    }
    await saveState({ detail: res.spec });
    setStep("detail");
  };

  const relearnHome = async () => {
    setLoading(true);
    const res = await sendToActiveTab<{ spec: HomeSpec }>({ type: "GET_HOME_INFO" });
    setLoading(false);
    if (res?.spec) await saveState({ home: res.spec });
  };

  const startPick = (role: PickRole) => {
    sendToActiveTab({ type: "START_PICK", role });
    window.close();
  };

  const handlePickResult = async (role: PickRole, selector: string, sample: string) => {
    if (!selector) return;
    if (role === "list") {
      await saveState({ listSelector: selector, listItemTag: "*" });
      setStep("listReview");
    } else {
      const detail = { ...(state.detail || {}) };
      if (role === "title") detail.titleSelector = selector;
      else if (role === "desc") detail.descSelector = selector;
      else if (role === "playTab") detail.playTabSelector = selector;
      else if (role === "playList") detail.playListSelector = selector;
      else if (role === "playItem") detail.playItemSelector = selector;
      await saveState({ detail });
      setStep("detail");
    }
  };

  const buildArtifacts = () => {
    if (!state.site || !state.listSelector) return null;
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
    downloadText(a.spiderName, a.spider, "text/javascript");
    downloadText("tvbox.json", a.tvbox, "application/json");
    setStep("done");
  };

  const doUploadToGist = async () => {
    const a = buildArtifacts();
    if (!a || !state.site) return;
    setUploadStatus({ loading: true });
    const res = await uploadToGist(
      state.site.siteName || state.site.host,
      state.site.host,
      a.spider,
      a.tvbox
    );
    setUploadStatus({ loading: false, result: res });
    if (res.ok && res.spiderURL) {
      await saveState({ gistURL: res.spiderURL });
      setStep("done");
    }
  };

  const resetAll = async () => {
    await sendToBackground({ type: "RESET_STATE" });
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    sendToActiveTab({ type: "STOP_INSPECT" });
    setState({});
    setCandidates([]);
    setSelectedIdx(null);
    setMedia([]);
    setTestResult(null);
    setUploadStatus({ loading: false });
    setStep("start");
  };

  // ==================== 试运行 ====================
  const runTest = async () => {
    if (!state.listSelector) return;
    setTesting(true);
    // 用当前状态生成 spider 里那个一级规则字符串
    const listExpr = `${state.listSelector} ${state.listItemTag || "*"}`;
    const rule = `${listExpr};*[title],img&&alt,text;img&&data-original||data-src||src;.*?(HD[0-9]*|4K|更新至第?.+?集|第.+?集|全.+?集|完结|连载|BD|超清|高清|\\d{4}).*?;a&&href`;
    const res = await sendToActiveTab<{ result: OnePlusRuleResult }>({
      type: "TEST_RULE",
      rule,
    });
    setTesting(false);
    if (res?.result) setTestResult(res.result);
  };

  // 详情页试运行 —— 用当前 detail 字段选择器实际提取
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

  // 手工编辑详情字段（inline 改选择器）
  const editDetailField = async (
    field: "titleSelector" | "picSelector" | "descSelector" | "playTabSelector" | "playListSelector",
    val: string,
  ) => {
    const next: DetailSpec = { ...(state.detail || {}), [field]: val };
    await sendToBackground({ type: "SAVE_STATE", state: { detail: next } });
    setState((s) => ({ ...s, detail: next }));
    setDetailTestResult(null);   // 清掉旧结果, 下一次点试运行才重跑
  };

  // AI 辅助识别 —— 抓当前页 HTML → 发给 DeepSeek → 反填到 detail
  const [aiStatus, setAIStatus] = useState<{ loading: boolean; msg?: string }>({ loading: false });

  const askAIForDetail = async () => {
    const okKey = await hasAIConfig();
    if (!okKey) {
      alert("请先在 ⚙ 设置里填 OpenRouter API Key");
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
    setAIStatus({ loading: true, msg: "AI 分析中..." });
    const trimmed = trimHTML(snap.html);
    const result = await askAIDetail(trimmed, snap.url, state.detail);
    if (result.errors?.length) {
      setAIStatus({ loading: false, msg: `❌ ${result.errors[0]}` });
      return;
    }
    // 只覆盖 AI 建议且原来没值 或原来有值但 AI 给了不同答案时问用户
    const patch: DetailSpec = { ...(state.detail || {}) };
    let updates = 0;
    (["titleSelector", "picSelector", "descSelector", "playTabSelector", "playListSelector"] as const).forEach((k) => {
      const v = result[k as keyof typeof result] as string | undefined;
      if (v && !patch[k]) {
        patch[k] = v;
        updates++;
      } else if (v && patch[k] && patch[k] !== v) {
        // 已有值, 让用户决定是否覆盖
        if (confirm(`${k} 已有 "${patch[k]}"\nAI 建议 "${v}"\n要用 AI 的吗？`)) {
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
      msg: updates > 0
        ? `✅ AI 更新了 ${updates} 个字段${result.reasoning ? ": " + result.reasoning : ""}`
        : "AI 没找到能补的字段",
    });
  };

  // AI 识别列表容器 - 用户点了 AI 但自动分析找不到列表时用
  const askAIForList = async () => {
    if (!(await hasAIConfig())) {
      alert("请先在 ⚙ 设置里填 OpenRouter API Key");
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
    setAIStatus({ loading: true, msg: "AI 分析列表结构..." });
    const result = await askAIList(trimHTML(snap.html), snap.url, {
      listContainerSelector: state.listSelector,
      listItemTag: state.listItemTag,
    });
    if (result.errors?.length) {
      setAIStatus({ loading: false, msg: `❌ ${result.errors[0]}` });
      return;
    }
    if (!result.listContainerSelector) {
      setAIStatus({ loading: false, msg: "AI 也没找到明确的影片列表" });
      return;
    }
    // 应用 AI 建议 + 重采样
    const patch: Partial<ProjectState> = {
      listSelector: result.listContainerSelector,
      listItemTag: result.listItemTag || "*",
    };
    await sendToBackground({ type: "SAVE_STATE", state: patch });
    // 重新采样 3 张卡片 + 重算 base
    const detail = await sendToActiveTab<{ samples: SerializedSample[] }>({
      type: "GET_SAMPLES",
      selector: result.listContainerSelector,
      itemTag: result.listItemTag || "*",
    });
    if (detail?.samples) {
      patch.listSamples = detail.samples;
    }
    const baseInfo = await sendToActiveTab<{ baseInfo: BaseInfo }>({
      type: "RECOMPUTE_BASE",
      selector: result.listContainerSelector,
    });
    if (baseInfo?.baseInfo) patch.baseInfo = baseInfo.baseInfo;
    await sendToBackground({ type: "SAVE_STATE", state: patch });
    setState((s) => ({ ...s, ...patch }));
    setTestResult(null);
    setStep("listReview");
    setAIStatus({
      loading: false,
      msg: `✅ AI 定位: ${result.listContainerSelector}${result.reasoning ? " — " + result.reasoning : ""}`,
    });
  };

  // 🚀 AI 一键模式：从 start 页触发, 让 AI 尽可能填齐当前页的字段
  const runAIAutoPilot = async () => {
    if (!(await hasAIConfig())) {
      alert("请先在 ⚙ 设置里填 OpenRouter API Key");
      return;
    }
    setAIStatus({ loading: true, msg: "🚀 抓页面 HTML..." });
    const snap = await sendToActiveTab<{ html: string; url: string; title: string }>({
      type: "GET_HTML_SNAPSHOT",
    });
    if (!snap?.html) {
      setAIStatus({ loading: false, msg: "抓 HTML 失败" });
      return;
    }

    // 先当作详情页试 (影片详情页信息量更大, 也顺带能得到列表结构)
    setAIStatus({ loading: true, msg: "🤖 AI 分析页面类型..." });
    const trimmed = trimHTML(snap.html);

    // 并发跑列表识别 + 详情识别, 之后按结果决定当前页是啥
    const [listRes, detailRes] = await Promise.all([
      askAIList(trimmed, snap.url),
      askAIDetail(trimmed, snap.url),
    ]);

    // 存 site info (如果没有)
    if (!state.site) {
      const site: SiteInfo = {
        siteName: snap.title,
        host: new URL(snap.url).origin,
        baseURL: snap.url,
        pageURL: snap.url,
      };
      await sendToBackground({ type: "SAVE_STATE", state: { site } });
      setState((s) => ({ ...s, site }));
    }

    const patch: Partial<ProjectState> = {};

    // 列表结果
    if (listRes.listContainerSelector) {
      patch.listSelector = listRes.listContainerSelector;
      patch.listItemTag = listRes.listItemTag || "*";
      const detail = await sendToActiveTab<{ samples: SerializedSample[] }>({
        type: "GET_SAMPLES",
        selector: listRes.listContainerSelector,
        itemTag: listRes.listItemTag || "*",
      });
      if (detail?.samples) patch.listSamples = detail.samples;
      const baseInfo = await sendToActiveTab<{ baseInfo: BaseInfo }>({
        type: "RECOMPUTE_BASE",
        selector: listRes.listContainerSelector,
      });
      if (baseInfo?.baseInfo) patch.baseInfo = baseInfo.baseInfo;
    }

    // 详情结果
    if (detailRes.titleSelector || detailRes.playListSelector) {
      const detailSpec: DetailSpec = {
        ...(state.detail || {}),
        detailURL: snap.url,
        titleSelector: detailRes.titleSelector,
        picSelector: detailRes.picSelector,
        descSelector: detailRes.descSelector,
        playTabSelector: detailRes.playTabSelector,
        playListSelector: detailRes.playListSelector,
      };
      patch.detail = detailSpec;
    }

    if (Object.keys(patch).length === 0) {
      setAIStatus({ loading: false, msg: "❌ AI 认为这不是影片站的列表/详情页" });
      return;
    }

    await sendToBackground({ type: "SAVE_STATE", state: patch });
    setState((s) => ({ ...s, ...patch }));

    // 决定停在哪一步
    if (patch.listSelector && !patch.detail?.titleSelector) {
      setStep("listReview");
      setAIStatus({
        loading: false,
        msg: `✅ 找到列表容器。点进一部影片详情页, 再点 🤖 让 AI 补详情。`,
      });
    } else if (patch.detail?.titleSelector) {
      setStep("detail");
      setAIStatus({
        loading: false,
        msg: `✅ AI 完成识别${listRes.reasoning ? ": " + listRes.reasoning : ""}${detailRes.reasoning ? " · " + detailRes.reasoning : ""}`,
      });
    } else if (patch.listSelector) {
      setStep("listReview");
      setAIStatus({ loading: false, msg: "✅ 找到列表容器" });
    }
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
      setStep(r.state.listSelector ? "listReview" : "start");
      setTestResult(null);
      setShowProjects(false);
    }
  };

  const deleteProject = async (host: string) => {
    await sendToBackground({ type: "DELETE_PROJECT", host });
    await loadProjects();
    if (state.site?.host === host) {
      setState({});
      setStep("start");
    }
  };

  const newProject = async () => {
    await sendToBackground({ type: "RESET_STATE" });
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    sendToActiveTab({ type: "STOP_INSPECT" });
    setState({});
    setTestResult(null);
    setStep("start");
    setShowProjects(false);
  };

  // ==================== 渲染 ====================

  const detailFieldsFilled = state.detail
    ? [
        state.detail.titleSelector && "标题",
        state.detail.descSelector && "简介",
        state.detail.playTabSelector && "线路",
        state.detail.playListSelector && "剧集",
      ].filter(Boolean)
    : [];

  return (
    <div className="s2s-root">
      <header className="s2s-header">
        <span className="s2s-logo">🎬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s2s-title">Site2Source</div>
          <div className="s2s-sub">{state.site?.host || "TVBox 源生成器"}</div>
        </div>
        <button
          className="s2s-btn-mini"
          onClick={() => setShowApi(true)}
          title="API 抓包"
        >🕸</button>
        <button
          className="s2s-btn-mini"
          onClick={() => {
            loadProjects();
            setShowProjects(true);
          }}
          title="项目列表"
        >📁</button>
        <button className="s2s-btn-mini" onClick={() => setShowSettings(true)}>⚙</button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showApi && (
        <ApiPanel
          onClose={() => setShowApi(false)}
          onExport={(cfg) => {
            // 用 API 型规则生成器直接吐出 spider, 下载
            const site = state.site;
            if (!site) {
              alert("先在起始页 🔎 分析一下, 让扩展知道站点信息");
              return;
            }
            const apiInput: APIGenerateInput = {
              siteName: site.siteName,
              host: site.host.replace(/^https?:\/\//, ""),
              home: {
                urlTemplate: normalizeAPIURLForCate(cfg.home.url),
                method: cfg.home.method as any,
                reqBody: cfg.home.reqBody,
                listPath: cfg.home.listPath || "$",
                fields: cfg.home.fields || {},
              },
              detail: cfg.detail ? {
                urlTemplate: cfg.detail.url.replace(/(\?|&)(id|vod_id|movie_id)=[^&]+/i, "$1$2={id}"),
                method: cfg.detail.method as any,
                fields: cfg.detail.fields || {},
              } : undefined,
              search: cfg.search ? {
                urlTemplate: cfg.search.url.replace(/(\?|&)(wd|keyword|q|search)=[^&]+/i, "$1$2={wd}"),
                method: cfg.search.method as any,
                listPath: cfg.search.listPath || "$",
                fields: cfg.search.fields || {},
              } : undefined,
            };
            const spider = generateAPIDrpySpider(apiInput);
            downloadText(`${apiInput.host}.js`, spider, "text/javascript");
            alert(`✅ 已下载 API 型爬虫: ${apiInput.host}.js\n\n可以直接上传到 Gist 或放到 TVBox 里测试。`);
          }}
        />
      )}
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

      {notice && <div className="s2s-notice">{notice}</div>}

      <ProgressBar current={step} state={state} />

      {/* 顶部：识别到的分类/搜索标签 */}
      {state.home && (state.home.categories?.length || state.home.searchAction) && step !== "start" && (
        <div className="s2s-home-summary">
          {state.home.categories && state.home.categories.length > 0 && (
            <span className="s2s-badge">
              📚 {state.home.categories.length} 分类
            </span>
          )}
          {state.home.searchAction && <span className="s2s-badge">🔍 搜索</span>}
          {state.home.categoryURLPattern && <span className="s2s-badge">🔗 URL 模板</span>}
        </div>
      )}

      {step === "start" && (
        <section className="s2s-section">
          <p className="s2s-tip">
            打开影视网站的<b>首页 / 分类页 / 详情页</b>都行，然后：
          </p>
          <button
            className="s2s-btn s2s-btn-primary"
            onClick={runAIAutoPilot}
            disabled={aiStatus.loading}
            title="AI 自动分析当前页, 尽可能填齐字段"
          >
            {aiStatus.loading ? aiStatus.msg || "..." : "🚀 AI 一键完成"}
          </button>
          <p className="s2s-tip s2s-tip-dim" style={{ margin: "6px 0" }}>
            —— 或者用规则识别 ——
          </p>
          <button className="s2s-btn s2s-btn-ghost" onClick={analyzeCurrentPage} disabled={loading}>
            {loading ? "分析中..." : "🔎 规则分析"}
          </button>
          <div className="s2s-actions" style={{ marginTop: 8 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={startManualPick}>
              手动选列表容器
            </button>
          </div>
          <p className="s2s-tip s2s-tip-dim" style={{ marginTop: 12 }}>
            💡 一键模式最省事,规则模式最省钱,手动模式最精准。
          </p>
          {aiStatus.msg && !aiStatus.loading && (
            <div className={`s2s-notice ${aiStatus.msg.startsWith("❌") ? "s2s-notice-err" : ""}`} style={{ marginTop: 8 }}>
              {aiStatus.msg}
            </div>
          )}
        </section>
      )}

      {step === "listPick" && (
        <section className="s2s-section">
          <div className="s2s-section-title">找到 {candidates.length} 个候选：</div>
          <div className="s2s-candidates">
            {candidates.map((c, i) => (
              <div
                key={i}
                className={`s2s-candidate ${selectedIdx === i ? "selected" : ""}`}
                onClick={() => pickCandidate(i)}
              >
                <div className="s2s-candidate-header">
                  <span className="s2s-candidate-badge" data-idx={i}>#{i + 1}</span>
                  <span className="s2s-candidate-selector">{c.selector}</span>
                </div>
                <div className="s2s-candidate-meta">
                  {c.childCount} 项 · 相似度 {(c.similarity * 100).toFixed(0)}%
                </div>
                {c.samples.slice(0, 2).map((s, j) => (
                  <div key={j} className="s2s-sample">· {s.name || "<无标题>"}</div>
                ))}
              </div>
            ))}
          </div>
          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={startManualPick}>
              都不对？手动选
            </button>
          </div>
        </section>
      )}

      {step === "listReview" && state.site && state.listSelector && (
        <section className="s2s-section">
          <div className="s2s-section-title">✅ 列表已选</div>
          <div className="s2s-info-row">
            <span className="s2s-info-label">容器：</span>
            <code>{state.listSelector}</code>
          </div>
          {state.listMeta && (
            <div className="s2s-info-row">
              <span className="s2s-info-label">规模：</span>
              {state.listMeta.childCount} 项 · {(state.listMeta.similarity * 100).toFixed(0)}%
            </div>
          )}
          {state.listSamples && state.listSamples.length > 0 && (
            <div className="s2s-samples">
              {state.listSamples.slice(0, 3).map((s, i) => (
                <SampleCard key={i} s={s} />
              ))}
            </div>
          )}

          {/* Base 分析卡片 */}
          {state.baseInfo && (
            <BasePanel
              info={state.baseInfo}
              samples={state.listSamples || []}
              onOverride={setOverrideBase}
            />
          )}

          {/* 已识别的首页信息 */}
          {state.home && (
            <div className="s2s-home-info">
              {state.home.categories && state.home.categories.length > 0 && (
                <details className="s2s-collapsible">
                  <summary>📚 {state.home.categories.length} 个分类</summary>
                  <div className="s2s-cat-list">
                    {state.home.categories.slice(0, 12).map((c, i) => (
                      <span key={i} className="s2s-cat-tag">{c.name}</span>
                    ))}
                  </div>
                </details>
              )}
              {state.home.searchAction && (
                <details className="s2s-collapsible">
                  <summary>🔍 搜索接口</summary>
                  <div className="s2s-info-row"><code>{state.home.searchAction}</code></div>
                </details>
              )}
            </div>
          )}

          {/* 试运行结果 */}
          {testResult && (
            <div className="s2s-test-result">
              <div className="s2s-section-title" style={{ marginTop: 4 }}>
                🧪 试运行结果
                <span className={`s2s-badge ${testResult.count > 0 ? "" : "s2s-badge-warn"}`}>
                  {testResult.count} 项
                </span>
              </div>
              {testResult.errors && testResult.errors.length > 0 && (
                <div className="s2s-notice" style={{ margin: "6px 0" }}>
                  ⚠️ {testResult.errors.join("; ")}
                </div>
              )}
              {testResult.items.length > 0 && (
                <div className="s2s-test-cards">
                  {testResult.items.slice(0, 4).map((item, i) => (
                    <div key={i} className="s2s-test-card">
                      <div className="s2s-test-card-title">
                        <b>{item.name || "❌ 无标题"}</b>
                        {item.remarks && <span className="s2s-remarks"> · {item.remarks}</span>}
                      </div>
                      <div className="s2s-test-card-meta">
                        {item.pic ? <span title={item.pic}>🖼</span> : <span className="s2s-tip-dim">🚫 无图</span>}
                        {item.url ? (
                          <span className="s2s-test-url" title={item.url}>
                            🔗 {shortURL(item.url, 32)}
                          </span>
                        ) : (
                          <span className="s2s-tip-dim">🚫 无链接</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {testResult.count > 4 && (
                    <div className="s2s-tip-dim">... 共 {testResult.count} 项，只展示前 4 项</div>
                  )}
                </div>
              )}
              <div className="s2s-test-summary">
                {summarizeTestResult(testResult)}
              </div>
            </div>
          )}

          <div className="s2s-actions">
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("listPick")}>
              重选
            </button>
            <button
              className="s2s-btn s2s-btn-ghost"
              onClick={askAIForList}
              disabled={aiStatus.loading}
              title="AI 重新识别列表容器"
            >
              {aiStatus.loading ? "..." : "🤖 AI 重找"}
            </button>
            <button className="s2s-btn s2s-btn-ghost" onClick={runTest} disabled={testing}>
              {testing ? "..." : "🧪 试运行"}
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={learnDetail}>
              下一步 →
            </button>
          </div>
          {aiStatus.msg && !aiStatus.loading && step === "listReview" && (
            <div className={`s2s-notice ${aiStatus.msg.startsWith("❌") ? "s2s-notice-err" : ""}`} style={{ marginTop: 8 }}>
              {aiStatus.msg}
            </div>
          )}
        </section>
      )}

      {step === "detail" && (
        <section className="s2s-section">
          <div className="s2s-section-title">
            🔍 详情页学习
            {detailFieldsFilled.length > 0 && (
              <span className="s2s-badge">已识别 {detailFieldsFilled.join("/")}</span>
            )}
          </div>
          <p className="s2s-tip">
            打开一部影片的详情页，然后：<br />
            识别错的字段 → 点 <b>✎</b> 手改选择器，或 <b>点选</b> 从页面上认领元素。
          </p>
          <div className="s2s-detail-grid">
            <DetailField
              label="标题"
              selector={state.detail?.titleSelector}
              sample={detailTestResult?.title}
              onPick={() => startPick("title")}
              onEdit={(v) => editDetailField("titleSelector", v)}
            />
            <DetailField
              label="封面"
              selector={state.detail?.picSelector}
              sample={detailTestResult?.pic}
              onPick={() => startPick("pic")}
              onEdit={(v) => editDetailField("picSelector", v)}
            />
            <DetailField
              label="简介"
              selector={state.detail?.descSelector}
              sample={detailTestResult?.desc?.slice(0, 60) + (detailTestResult && detailTestResult.desc.length > 60 ? "..." : "")}
              onPick={() => startPick("desc")}
              onEdit={(v) => editDetailField("descSelector", v)}
            />
            <DetailField
              label="播放线路"
              selector={state.detail?.playTabSelector}
              sample={detailTestResult?.playFrom.join(" / ")}
              onPick={() => startPick("playTab")}
              onEdit={(v) => editDetailField("playTabSelector", v)}
            />
            <DetailField
              label="剧集列表"
              selector={state.detail?.playListSelector}
              sample={
                detailTestResult && detailTestResult.playURL.length > 0
                  ? `${detailTestResult.playURL[0].episodes.length} 集`
                  : undefined
              }
              onPick={() => startPick("playList")}
              onEdit={(v) => editDetailField("playListSelector", v)}
            />
          </div>

          {/* 详情试运行结果 */}
          {detailTestResult && (
            <div className="s2s-test-result" style={{ marginTop: 10 }}>
              <div className="s2s-section-title" style={{ marginTop: 0 }}>
                🧪 详情提取结果
                <span className="s2s-badge">
                  {summarizeDetail(detailTestResult)}
                </span>
              </div>
              {detailTestResult.errors && (
                <div className="s2s-notice" style={{ margin: "6px 0" }}>
                  ⚠️ {detailTestResult.errors.join("; ")}
                </div>
              )}
              {detailTestResult.playURL.length > 0 && detailTestResult.playURL[0].episodes.length > 0 && (
                <details className="s2s-collapsible">
                  <summary>
                    剧集样本（{detailTestResult.playFrom[0]} · 共 {detailTestResult.playURL[0].episodes.length} 集）
                  </summary>
                  <div className="s2s-episode-list">
                    {detailTestResult.playURL[0].episodes.slice(0, 6).map((ep, i) => (
                      <div key={i} className="s2s-episode">
                        <span>{ep.name || "?"}</span>
                        <span className="s2s-tip-dim s2s-test-url">{shortURL(ep.url, 22)}</span>
                      </div>
                    ))}
                    {detailTestResult.playURL[0].episodes.length > 6 && (
                      <div className="s2s-tip-dim">...</div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={learnDetail}>🔄 重新分析</button>
            <button
              className="s2s-btn s2s-btn-ghost"
              onClick={askAIForDetail}
              disabled={aiStatus.loading}
              title="用 AI 分析当前页 HTML"
            >
              {aiStatus.loading ? "..." : "🤖 AI 帮我看"}
            </button>
            <button
              className="s2s-btn s2s-btn-ghost"
              onClick={runDetailTest}
              disabled={testing || !state.detail?.titleSelector}
            >
              {testing ? "..." : "🧪 试运行"}
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={() => setStep("media")}>
              下一步 →
            </button>
          </div>
          {aiStatus.msg && (
            <div className={`s2s-notice ${aiStatus.msg.startsWith("❌") ? "s2s-notice-err" : ""}`} style={{ marginTop: 8 }}>
              {aiStatus.msg}
            </div>
          )}
        </section>
      )}

      {step === "media" && (
        <section className="s2s-section">
          <div className="s2s-section-title">
            🎥 视频流嗅探
            <span className="s2s-badge s2s-badge-count">{media.length}</span>
          </div>
          {media.length === 0 ? (
            <p className="s2s-tip">
              在页面上<b>点击播放按钮</b>，等视频开始加载。<br />
              抓到的 m3u8 / mp4 会自动出现。
            </p>
          ) : (
            <div className="s2s-media-list">
              {media.slice(-8).map((m, i) => (
                <div key={i} className="s2s-media-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="s2s-media-head">
                      <span className="s2s-media-type">{m.type}</span>
                      {m.tabURL && (
                        <span className="s2s-tip-dim" title={m.tabURL}>
                          from {shortURL(m.tabURL, 24)}
                        </span>
                      )}
                    </div>
                    <div className="s2s-media-url" title={m.url}>{shortURL(m.url, 42)}</div>
                  </div>
                  <div className="s2s-media-actions">
                    <button
                      className="s2s-btn-mini"
                      title="复制 URL"
                      onClick={() => copyToClipboard(m.url)}
                    >📋</button>
                    <button
                      className="s2s-btn-mini"
                      title="在新标签试播"
                      onClick={() => openInPlayer(m.url)}
                    >▶</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("detail")}>← 上一步</button>
            <button className="s2s-btn s2s-btn-primary" onClick={doGenerate}>📦 生成 + 下载</button>
          </div>
          <div className="s2s-actions" style={{ marginTop: 6 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={doUploadToGist} disabled={uploadStatus.loading}>
              {uploadStatus.loading ? "上传中..." : "☁️ 直接传到 GitHub Gist"}
            </button>
          </div>
          {uploadStatus.result && !uploadStatus.result.ok && (
            <div className="s2s-notice" style={{ marginTop: 8 }}>
              ❌ {uploadStatus.result.error}
            </div>
          )}
        </section>
      )}

      {step === "done" && (
        <section className="s2s-section">
          <div className="s2s-done">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
            <b>搞定！</b>
            {state.gistURL ? (
              <div style={{ marginTop: 14 }}>
                <p className="s2s-tip" style={{ textAlign: "left" }}>
                  已上传到 GitHub Gist：
                </p>
                <div className="s2s-url-box">
                  <code>{state.gistURL}</code>
                  <button className="s2s-btn-mini" onClick={() => copyToClipboard(state.gistURL!)}>
                    复制
                  </button>
                </div>
                <p className="s2s-tip s2s-tip-dim" style={{ marginTop: 8, textAlign: "left" }}>
                  把这个 URL 填到 tvbox.json 的 sites[0].api，<br />
                  然后 tvbox.json 也上传（新建 Gist 或放同一个），配置地址填 tvbox.json 的 URL。
                </p>
              </div>
            ) : (
              <p className="s2s-tip" style={{ marginTop: 12, textAlign: "left" }}>
                已下载：<b>spider_*.js</b> + <b>tvbox.json</b><br />
                <br />
                下一步：<br />
                1. 上传 spider 到 Gist / CF Pages<br />
                2. 改 tvbox.json 里 <code>sites[0].api</code> 为真实 URL<br />
                3. 上传 tvbox.json，配置地址填这个 URL<br />
              </p>
            )}
            <div className="s2s-actions" style={{ marginTop: 12 }}>
              {!state.gistURL && (
                <button className="s2s-btn s2s-btn-ghost" onClick={doUploadToGist} disabled={uploadStatus.loading}>
                  {uploadStatus.loading ? "上传中..." : "☁️ 传 Gist"}
                </button>
              )}
              <button className="s2s-btn s2s-btn-ghost" onClick={resetAll}>🔄 再来一次</button>
            </div>
          </div>
        </section>
      )}

      <footer className="s2s-footer">v0.4 · Site2Source</footer>
    </div>
  );
}

export default Popup;
