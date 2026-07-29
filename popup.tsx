import { useEffect, useState } from "react";
import type {
  CapturedMedia,
  SerializedCandidate,
} from "~lib/messages";
import {
  generateDrpySpider,
  generateTVBoxJSON,
} from "~lib/drpy-generator";
import "./popup.css";

interface SiteInfo {
  url: string;
  host: string;
  siteName: string;
}

async function sendToActiveTab<T = any>(msg: any): Promise<T | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage<any, T>(tab.id, msg);
  } catch (e) {
    console.error("[site2source] sendMessage failed:", e);
    return null;
  }
}

async function sendToBackground<T = any>(msg: any): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage<any, T>(msg);
  } catch (e) {
    console.error("[site2source] bg sendMessage failed:", e);
    return null;
  }
}

function Popup() {
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [candidates, setCandidates] = useState<SerializedCandidate[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"idle" | "picking" | "review" | "done">("idle");

  const analyzeCurrentPage = async () => {
    setLoading(true);
    setStep("picking");
    const res = await sendToActiveTab<{ site: SiteInfo; candidates: SerializedCandidate[] }>({
      type: "GET_CANDIDATES",
    });
    if (res) {
      setSite(res.site);
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        alert("未找到影片列表，请打开一个有列表的页面（比如 /movies 或 /category/...）");
        setStep("idle");
      } else if (res.candidates.length === 1) {
        setSelectedIdx(0);
        setStep("review");
      }
    } else {
      alert("无法与页面通信，请刷新后重试");
      setStep("idle");
    }
    setLoading(false);
  };

  const stopInspect = () => {
    sendToActiveTab({ type: "STOP_INSPECT" });
    setStep("idle");
  };

  const pickCandidate = (i: number) => {
    setSelectedIdx(i);
    const c = candidates[i];
    sendToActiveTab({ type: "HIGHLIGHT_ELEMENT", selector: c.selector });
    setStep("review");
  };

  const refreshMedia = async () => {
    const res = await sendToBackground<{ media: CapturedMedia[] }>({
      type: "GET_CAPTURED_MEDIA",
    });
    if (res) setMedia(res.media);
  };

  useEffect(() => {
    refreshMedia();
    const t = setInterval(refreshMedia, 1000);
    return () => clearInterval(t);
  }, []);

  const doGenerate = () => {
    if (!site || selectedIdx == null) return;
    const c = candidates[selectedIdx];
    const spider = generateDrpySpider({
      siteName: site.siteName || site.host,
      baseURL: `https://${site.host}`,
      host: site.host,
      listSelector: c.selector,
      itemSelector: c.itemTag,
      cardCount: c.childCount,
      similarity: c.similarity,
      samples: c.samples,
      playURLs: media.map((m) => m.url),
    });
    const spiderName = "spider_" + site.host.replace(/[.:]/g, "_") + ".js";
    const tvbox = generateTVBoxJSON(
      {
        siteName: site.siteName || site.host,
        baseURL: `https://${site.host}`,
        host: site.host,
        listSelector: c.selector,
        itemSelector: c.itemTag,
        cardCount: c.childCount,
        similarity: c.similarity,
        samples: c.samples,
      },
      "./" + spiderName
    );
    downloadText(spiderName, spider, "text/javascript");
    downloadText("tvbox.json", tvbox, "application/json");
    setStep("done");
  };

  return (
    <div className="s2s-root">
      <header className="s2s-header">
        <span className="s2s-logo">🎬</span>
        <div>
          <div className="s2s-title">Site2Source</div>
          <div className="s2s-sub">TVBox 源生成器</div>
        </div>
      </header>

      {step === "idle" && (
        <section className="s2s-section">
          <p className="s2s-tip">
            打开影视网站的<b>列表页</b>（比如 /movies），然后点下面的按钮：
          </p>
          <button className="s2s-btn s2s-btn-primary" onClick={analyzeCurrentPage} disabled={loading}>
            {loading ? "分析中..." : "🔎 分析此页面"}
          </button>
        </section>
      )}

      {step === "picking" && (
        <section className="s2s-section">
          <div className="s2s-section-title">
            找到 {candidates.length} 个候选列表，点击选择：
          </div>
          <div className="s2s-candidates">
            {candidates.map((c, i) => (
              <div
                key={i}
                className={`s2s-candidate ${selectedIdx === i ? "selected" : ""}`}
                onClick={() => pickCandidate(i)}
              >
                <div className="s2s-candidate-header">
                  <span className="s2s-candidate-badge" data-idx={i}>
                    #{i + 1}
                  </span>
                  <span className="s2s-candidate-selector">{c.selector}</span>
                </div>
                <div className="s2s-candidate-meta">
                  {c.childCount} 项 · 相似度 {(c.similarity * 100).toFixed(0)}%
                </div>
                {c.samples.slice(0, 2).map((s, j) => (
                  <div key={j} className="s2s-sample">
                    · {s.name || "<无标题>"}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <button className="s2s-btn s2s-btn-ghost" onClick={stopInspect}>
            取消
          </button>
        </section>
      )}

      {step === "review" && selectedIdx != null && site && (
        <section className="s2s-section">
          <div className="s2s-section-title">已选：{candidates[selectedIdx].selector}</div>
          <div className="s2s-samples">
            {candidates[selectedIdx].samples.map((s, i) => (
              <div key={i} className="s2s-sample-card">
                <b>{s.name || "<无标题>"}</b>
                {s.remarks && <span className="s2s-remarks"> · {s.remarks}</span>}
                <div className="s2s-sample-url">{s.url}</div>
              </div>
            ))}
          </div>

          <div className="s2s-media-section">
            <div className="s2s-section-title">
              🎥 抓到的视频流 ({media.length})
              <button
                className="s2s-btn-mini"
                onClick={() =>
                  sendToBackground({ type: "CLEAR_CAPTURED_MEDIA" }).then(refreshMedia)
                }
              >
                清空
              </button>
            </div>
            {media.length === 0 ? (
              <div className="s2s-tip s2s-tip-dim">
                💡 想抓播放地址？在页面上<b>点击任意影片→点击播放按钮</b>，等待几秒就能抓到。
              </div>
            ) : (
              <div className="s2s-media-list">
                {media.slice(0, 5).map((m, i) => (
                  <div key={i} className="s2s-media-item">
                    <span className="s2s-media-type">{m.type}</span>
                    <span className="s2s-media-url">{shortURL(m.url)}</span>
                  </div>
                ))}
                {media.length > 5 && <div className="s2s-tip-dim">还有 {media.length - 5} 条...</div>}
              </div>
            )}
          </div>

          <div className="s2s-actions">
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("picking")}>
              重新选
            </button>
            <button className="s2s-btn s2s-btn-primary" onClick={doGenerate}>
              📦 生成并下载
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="s2s-section">
          <div className="s2s-done">
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
            <b>已下载：spider_*.js + tvbox.json</b>
            <p className="s2s-tip" style={{ marginTop: 12 }}>
              下一步：
              <br />
              1. 把 spider 文件上传到 Gist / CF Pages
              <br />
              2. 修改 tvbox.json 里的 api 字段为真实 URL
              <br />
              3. 把 tvbox.json 也上传，配置地址填这个 URL
            </p>
            <button className="s2s-btn s2s-btn-ghost" onClick={() => setStep("idle")}>
              再来一次
            </button>
          </div>
        </section>
      )}

      <footer className="s2s-footer">v0.1 · MVP</footer>
    </div>
  );
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

function shortURL(u: string, n: number = 40) {
  if (u.length <= n) return u;
  return u.slice(0, 20) + "..." + u.slice(-20);
}

export default Popup;
