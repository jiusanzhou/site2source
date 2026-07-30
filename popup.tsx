import { useEffect, useState, useCallback } from "react";
import type {
  CapturedMedia,
  DetailSpec,
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
      // retry
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

  // ---- load persisted state ----
  const loadState = useCallback(async () => {
    const res = await sendToBackground<{ state: ProjectState }>({ type: "GET_STATE" });
    if (res?.state) {
      setState(res.state);
      // 决定初始 step
      if (res.state.listSelector) {
        setStep("listReview");
      }
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  // ---- media polling ----
  const refreshMedia = useCallback(async () => {
    const r = await sendToBackground<{ media: CapturedMedia[] }>({ type: "GET_CAPTURED_MEDIA" });
    if (r) setMedia(r.media);
  }, []);

  useEffect(() => {
    refreshMedia();
    const t = setInterval(refreshMedia, 1500);
    return () => clearInterval(t);
  }, [refreshMedia]);

  // ---- listen for pick results from content script ----
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

  // ==================== 步骤动作 ====================

  const analyzeCurrentPage = async () => {
    setLoading(true);
    setNotice("");
    const res = await sendToActiveTab<{
      site: SiteInfo;
      candidates: SerializedCandidate[];
    }>({ type: "GET_CANDIDATES" });
    setLoading(false);
    if (!res) {
      setNotice("无法与页面通信，请刷新页面后重试");
      return;
    }
    setCandidates(res.candidates);
    await saveState({ site: res.site });
    if (res.candidates.length === 0) {
      setNotice("未找到影片列表。可以试试点\"手动选\"按钮，自己在页面上圈出列表。");
      return;
    }
    setStep("listPick");
    if (res.candidates.length === 1) {
      pickCandidate(0);
    }
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
    window.close(); // 关掉 popup，让用户在页面上点
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

  const startPick = (role: PickRole) => {
    sendToActiveTab({ type: "START_PICK", role });
    window.close();
  };

  const handlePickResult = async (role: PickRole, selector: string, sample: string) => {
    if (!selector) return; // ESC 取消
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

  const doGenerate = () => {
    if (!state.site || !state.listSelector) return;
    const s = state.site;
    const spider = generateDrpySpider({
      siteName: s.siteName || s.host,
      baseURL: s.baseURL,
      host: s.host,
      listSelector: state.listSelector,
      itemSelector: state.listItemTag || "*",
      cardCount: state.listMeta?.childCount || 0,
      similarity: state.listMeta?.similarity || 0,
      samples: state.listSamples || [],
      detail: state.detail,
      media: media,
    });
    const spiderName = "spider_" + s.host.replace(/[.:]/g, "_") + ".js";
    const tvbox = generateTVBoxJSON(
      {
        siteName: s.siteName || s.host,
        baseURL: s.baseURL,
        host: s.host,
        listSelector: state.listSelector,
        itemSelector: state.listItemTag || "*",
        cardCount: state.listMeta?.childCount || 0,
        similarity: state.listMeta?.similarity || 0,
        samples: state.listSamples || [],
      },
      "./" + spiderName
    );
    downloadText(spiderName, spider, "text/javascript");
    downloadText("tvbox.json", tvbox, "application/json");
    setStep("done");
  };

  const resetAll = async () => {
    await sendToBackground({ type: "RESET_STATE" });
    await sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" });
    sendToActiveTab({ type: "STOP_INSPECT" });
    setState({});
    setCandidates([]);
    setSelectedIdx(null);
    setMedia([]);
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
        <div style={{ flex: 1 }}>
          <div className="s2s-title">Site2Source</div>
          <div className="s2s-sub">
            {state.site?.host || "TVBox 源生成器"}
          </div>
        </div>
        {step !== "start" && (
          <button className="s2s-btn-mini" onClick={resetAll}>
            重置
          </button>
        )}
      </header>

      {notice && <div className="s2s-notice">{notice}</div>}

      <ProgressBar current={step} state={state} />

      {step === "start" && (
        <section className="s2s-section">
          <p className="s2s-tip">
            打开影视网站的<b>列表页</b>（比如 /movies 或分类页），然后：
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
            💡 手动模式：在页面上鼠标 hover 元素高亮 → 点击确认。Esc 取消。
          </p>
        </section>
      )}

      {step === "listPick" && (
        <section className="s2s-section">
          <div className="s2s-section-title">
            找到 {candidates.length} 个候选列表：
          </div>
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
            🔍 详情页学习 {detailFieldsFilled.length > 0 && (
              <span className="s2s-badge">已识别 {detailFieldsFilled.join("/")}</span>
            )}
          </div>
          <p className="s2s-tip">
            打开一部影片的详情页，然后：
            <br />
            自动识别不满意 → 点下面的按钮，去页面上<b>点选正确元素</b>。
          </p>

          <div className="s2s-detail-grid">
            <DetailField
              label="标题"
              selector={state.detail?.titleSelector}
              onPick={() => startPick("title")}
            />
            <DetailField
              label="简介"
              selector={state.detail?.descSelector}
              onPick={() => startPick("desc")}
            />
            <DetailField
              label="播放线路 tab"
              selector={state.detail?.playTabSelector}
              onPick={() => startPick("playTab")}
            />
            <DetailField
              label="剧集列表"
              selector={state.detail?.playListSelector}
              onPick={() => startPick("playList")}
            />
          </div>

          <div className="s2s-actions" style={{ marginTop: 10 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={learnDetail}>
              🔄 重新自动分析
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={() => setStep("media")}>
              下一步 · 抓播放地址 →
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
              在页面上<b>点击播放按钮</b>并等待视频开始加载。
              <br />
              抓到的 m3u8 / mp4 会自动显示在这里。
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
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("detail")}>
              ← 上一步
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={doGenerate}>
              📦 生成 + 下载
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="s2s-section">
          <div className="s2s-done">
            <div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div>
            <b>已下载：spider_*.js + tvbox.json</b>
            <p className="s2s-tip" style={{ marginTop: 12, textAlign: "left" }}>
              下一步：
              <br />
              1. 把 spider 上传到 Gist / CF Pages / GitHub
              <br />
              2. 修改 tvbox.json 里 <code>sites[0].api</code> 为真实 URL
              <br />
              3. 再上传 tvbox.json，配置地址填这个 URL
            </p>
            <div className="s2s-actions">
              <button className="s2s-btn s2s-btn-ghost" onClick={resetAll}>
                🔄 再来一次
              </button>
            </div>
          </div>
        </section>
      )}

      <footer className="s2s-footer">v0.2 · Site2Source</footer>
    </div>
  );
}

// ==================== 子组件 ====================

function ProgressBar({ current, state }: { current: Step; state: ProjectState }) {
  const steps: { key: Step; label: string; done: boolean }[] = [
    { key: "start", label: "1", done: !!state.site },
    { key: "listReview", label: "2", done: !!state.listSelector },
    { key: "detail", label: "3", done: !!(state.detail?.titleSelector || state.detail?.playListSelector) },
    { key: "media", label: "4", done: false }, // 媒体不作为强制
    { key: "done", label: "✓", done: current === "done" },
  ];
  return (
    <div className="s2s-progress">
      {steps.map((s, i) => (
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
  label,
  selector,
  onPick,
}: {
  label: string;
  selector?: string;
  onPick: () => void;
}) {
  return (
    <div className={`s2s-detail-field ${selector ? "filled" : ""}`}>
      <div className="s2s-detail-label">{label}</div>
      <div className="s2s-detail-value">
        {selector ? <code>{selector}</code> : <span className="s2s-tip-dim">未识别</span>}
      </div>
      <button className="s2s-btn-mini" onClick={onPick}>
        {selector ? "改" : "手选"}
      </button>
    </div>
  );
}

export default Popup;
