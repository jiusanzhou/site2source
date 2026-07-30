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
  generateTVBoxJSON,
} from "~lib/drpy-generator";
import { hasHostMismatch, resolveHost } from "~lib/base-inferrer";
import { runOnePlusRule, type OnePlusRuleResult } from "~lib/rule-runner";
import {
  getGithubToken,
  setGithubToken,
  uploadToGist,
} from "~lib/gist-uploader";
import "./popup.css";

// ==================== helpers ====================

async function sendToActiveTab<T = any>(msg: any): Promise<T | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage<any, T>(tab.id, msg);
  } catch (e) {
    console.warn("[popup] sendMessage failed, injecting content script...", e);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["inspector.js"],
      });
      return await chrome.tabs.sendMessage<any, T>(tab.id, msg);
    } catch (e2) {
      console.error("[popup] inject failed:", e2);
      return null;
    }
  }
}

async function sendToBackground<T = any>(msg: any): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage<any, T>(msg);
  } catch (e) {
    console.error("[popup] bg send failed:", e);
    return null;
  }
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function shortURL(u: string, n = 40) {
  if (u.length <= n) return u;
  return u.slice(0, 20) + "..." + u.slice(-16);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

/** 分析试运行结果，给出人话诊断 */
function summarizeTestResult(r: OnePlusRuleResult): string {
  if (!r.containerFound) return "❌ 容器都没找到，选择器可能不对";
  if (r.count === 0) return "⚠️ 容器找到了但里面没卡片";
  const withName = r.items.filter((i) => i.name).length;
  const withPic = r.items.filter((i) => i.pic).length;
  const withURL = r.items.filter((i) => i.url).length;
  const withRemarks = r.items.filter((i) => i.remarks).length;
  const parts: string[] = [];
  parts.push(`📝 标题 ${withName}/${r.count}`);
  parts.push(`🖼 图 ${withPic}/${r.count}`);
  parts.push(`🔗 链接 ${withURL}/${r.count}`);
  if (withRemarks > 0) parts.push(`🏷 备注 ${withRemarks}/${r.count}`);
  const perfect = withName === r.count && withPic === r.count && withURL === r.count;
  return (perfect ? "✅ " : "") + parts.join(" · ");
}

// ==================== component ====================

type Step = "start" | "listPick" | "listReview" | "detail" | "media" | "done";

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
  const [projects, setProjects] = useState<Array<ProjectState & { host: string }>>([]);
  const [testResult, setTestResult] = useState<OnePlusRuleResult | null>(null);
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
          onClick={() => {
            loadProjects();
            setShowProjects(true);
          }}
          title="项目列表"
        >📁</button>
        <button className="s2s-btn-mini" onClick={() => setShowSettings(true)}>⚙</button>
      </header>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
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
            打开影视网站的<b>首页或分类页</b>（有影片列表的地方），然后：
          </p>
          <button className="s2s-btn s2s-btn-primary" onClick={analyzeCurrentPage} disabled={loading}>
            {loading ? "分析中..." : "🔎 分析此页面"}
          </button>
          <div className="s2s-actions" style={{ marginTop: 8 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={startManualPick}>
              手动选列表容器
            </button>
          </div>
          <p className="s2s-tip s2s-tip-dim" style={{ marginTop: 12 }}>
            💡 手动模式：hover 元素高亮 → 点击确认。Esc 取消。
          </p>
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
            <button className="s2s-btn s2s-btn-ghost" onClick={runTest} disabled={testing}>
              {testing ? "..." : "🧪 试运行"}
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={learnDetail}>
              下一步 →
            </button>
          </div>
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
            识别错的字段 → 点"手选"，去页面上点击正确元素。
          </p>
          <div className="s2s-detail-grid">
            <DetailField label="标题" selector={state.detail?.titleSelector} onPick={() => startPick("title")} />
            <DetailField label="简介" selector={state.detail?.descSelector} onPick={() => startPick("desc")} />
            <DetailField label="播放线路" selector={state.detail?.playTabSelector} onPick={() => startPick("playTab")} />
            <DetailField label="剧集列表" selector={state.detail?.playListSelector} onPick={() => startPick("playList")} />
          </div>
          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={learnDetail}>🔄 重新分析</button>
            <button className="s2s-btn s2s-btn-primary" onClick={() => setStep("media")}>
              下一步 · 抓播放 →
            </button>
          </div>
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
                  <span className="s2s-media-type">{m.type}</span>
                  <span className="s2s-media-url">{shortURL(m.url, 34)}</span>
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

// ==================== 子组件 ====================

function ProgressBar({ current, state }: { current: Step; state: ProjectState }) {
  const steps: { key: Step; label: string; done: boolean }[] = [
    { key: "start", label: "1", done: !!state.site },
    { key: "listReview", label: "2", done: !!state.listSelector },
    { key: "detail", label: "3", done: !!(state.detail?.titleSelector || state.detail?.playListSelector) },
    { key: "media", label: "4", done: false },
    { key: "done", label: "✓", done: current === "done" },
  ];
  return (
    <div className="s2s-progress">
      {steps.map((s) => (
        <div
          key={s.key}
          className={`s2s-progress-step ${s.done ? "done" : ""} ${current === s.key ? "active" : ""}`}
        >
          {s.label}
        </div>
      ))}
    </div>
  );
}

function SampleCard({ s }: { s: SerializedSample }) {
  return (
    <div className="s2s-sample-card">
      <b>{s.name || "<无标题>"}</b>
      {s.remarks && <span className="s2s-remarks"> · {s.remarks}</span>}
      <div className="s2s-sample-url">{s.url}</div>
    </div>
  );
}

function DetailField({
  label, selector, onPick,
}: {
  label: string; selector?: string; onPick: () => void;
}) {
  return (
    <div className={`s2s-detail-field ${selector ? "filled" : ""}`}>
      <div className="s2s-detail-label">{label}</div>
      <div className="s2s-detail-value">
        {selector ? <code>{selector}</code> : <span className="s2s-tip-dim">未识别</span>}
      </div>
      <button className="s2s-btn-mini" onClick={onPick}>{selector ? "改" : "手选"}</button>
    </div>
  );
}

function BasePanel({
  info, samples, onOverride,
}: {
  info: BaseInfo;
  samples: SerializedSample[];
  onOverride: (val: string) => void;
}) {
  const sampleURLs = samples.map((s) => s.url).filter(Boolean);
  const auto = resolveHost({ ...info, overrideBase: undefined }, sampleURLs);
  const final = info.overrideBase || auto;
  const mismatch = hasHostMismatch(info);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(info.overrideBase || "");

  const candidates = Array.from(
    new Set(
      [
        auto,
        info.pageBase,
        info.linkBase,
        info.imgBase,
        ...(info.stats?.links.slice(0, 3).map((l) => l.host) || []),
      ].filter((x): x is string => !!x)
    )
  );

  return (
    <details className="s2s-collapsible s2s-base-panel" open={mismatch}>
      <summary>
        🌐 Base URL: <code>{final}</code>
        {mismatch && <span className="s2s-badge s2s-badge-warn"> ⚠ 多域</span>}
      </summary>
      <div className="s2s-base-body">
        <div className="s2s-base-row">
          <span className="s2s-info-label">页面 origin：</span>
          <code>{info.pageBase}</code>
        </div>
        {info.linkBase && info.linkBase !== info.pageBase && (
          <div className="s2s-base-row">
            <span className="s2s-info-label">链接 host：</span>
            <code>{info.linkBase}</code>
          </div>
        )}
        {info.imgBase && info.imgBase !== info.pageBase && (
          <div className="s2s-base-row">
            <span className="s2s-info-label">图片 host：</span>
            <code>{info.imgBase}</code>
          </div>
        )}
        {info.stats && info.stats.links.length > 1 && (
          <details className="s2s-collapsible" style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 11 }}>Top 链接 host 统计</summary>
            {info.stats.links.slice(0, 4).map((l) => (
              <div key={l.host} className="s2s-base-row">
                <span className="s2s-info-label">{l.count}×</span>
                <code>{l.host}</code>
              </div>
            ))}
          </details>
        )}

        <div style={{ marginTop: 8 }}>
          {editing ? (
            <div className="s2s-actions">
              <input
                className="s2s-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例如 https://www.example.tv"
                list="s2s-base-cands"
              />
              <datalist id="s2s-base-cands">
                {candidates.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          ) : null}
          <div className="s2s-actions" style={{ marginTop: 6 }}>
            {editing ? (
              <>
                <button className="s2s-btn s2s-btn-ghost" onClick={() => { setEditing(false); setDraft(info.overrideBase || ""); }}>
                  取消
                </button>
                <button className="s2s-btn s2s-btn-primary" onClick={() => { onOverride(draft.trim()); setEditing(false); }}>
                  保存
                </button>
              </>
            ) : (
              <>
                {info.overrideBase && (
                  <button className="s2s-btn s2s-btn-ghost" onClick={() => onOverride("")}>
                    还原自动
                  </button>
                )}
                <button className="s2s-btn s2s-btn-ghost" onClick={() => { setEditing(true); setDraft(info.overrideBase || auto); }}>
                  ✎ 手工改
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { getGithubToken().then(setToken); }, []);
  const save = async () => {
    await setGithubToken(token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };
  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>⚙ 设置</b>
          <button className="s2s-btn-mini" onClick={onClose}>关闭</button>
        </div>
        <div className="s2s-modal-body">
          <div className="s2s-section-title" style={{ marginBottom: 6 }}>GitHub Token</div>
          <p className="s2s-tip s2s-tip-dim">
            上传到 Gist 需要 <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">Personal Access Token</a>（勾选 <code>gist</code> 权限）
          </p>
          <input
            className="s2s-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_... 或 github_pat_..."
          />
          <div className="s2s-actions" style={{ marginTop: 8 }}>
            <button className="s2s-btn s2s-btn-primary" onClick={save}>
              {saved ? "✅ 已保存" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProjectsPanel({
  projects, activeHost, onSwitch, onDelete, onNew, onClose,
}: {
  projects: Array<ProjectState & { host: string }>;
  activeHost?: string;
  onSwitch: (host: string) => void;
  onDelete: (host: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>📁 项目列表</b>
          <button className="s2s-btn-mini" onClick={onClose}>关闭</button>
        </div>
        <div className="s2s-modal-body">
          {projects.length === 0 ? (
            <p className="s2s-tip">还没有保存过项目</p>
          ) : (
            <div className="s2s-project-list">
              {projects.map((p) => (
                <div
                  key={p.host}
                  className={`s2s-project ${activeHost === p.host ? "active" : ""}`}
                >
                  <div className="s2s-project-info" onClick={() => onSwitch(p.host)}>
                    <div className="s2s-project-name">
                      <b>{p.site?.siteName || p.host}</b>
                      {activeHost === p.host && <span className="s2s-badge">当前</span>}
                    </div>
                    <div className="s2s-project-host">{p.host}</div>
                    <div className="s2s-project-meta">
                      {p.listSelector && <span className="s2s-tag">列表 ✓</span>}
                      {p.detail?.titleSelector && <span className="s2s-tag">详情 ✓</span>}
                      {p.gistURL && <span className="s2s-tag">Gist ✓</span>}
                      {p.updatedAt && (
                        <span className="s2s-tip-dim">
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="s2s-btn-mini"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除项目 ${p.host}？`)) onDelete(p.host);
                    }}
                  >🗑</button>
                </div>
              ))}
            </div>
          )}
          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-primary" onClick={onNew}>
              ➕ 新建项目
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Popup;
