import { useEffect, useState, useCallback } from "react";
import type {
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
    // 同时探测：列表 + 首页信息（分类导航/搜索）
    const [listRes, homeRes] = await Promise.all([
      sendToActiveTab<{ site: SiteInfo; candidates: SerializedCandidate[] }>({
        type: "GET_CANDIDATES",
      }),
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
    await saveState({
      listSelector: c.selector,
      listItemTag: c.itemTag,
      listSamples: c.samples,
      listMeta: { childCount: c.childCount, similarity: c.similarity },
    });
    setStep("listReview");
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
    setUploadStatus({ loading: false });
    setStep("start");
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
        <button className="s2s-btn-mini" onClick={() => setShowSettings(true)}>⚙</button>
        {step !== "start" && (
          <button className="s2s-btn-mini" onClick={resetAll}>重置</button>
        )}
      </header>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
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

          <div className="s2s-actions">
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("listPick")}>
              重选
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={learnDetail}>
              下一步 · 详情页 →
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

      <footer className="s2s-footer">v0.3 · Site2Source</footer>
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

export default Popup;
