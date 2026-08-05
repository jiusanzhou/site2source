/**
 * 顶部 sticky 抓包摘要:
 *   XHR n · 媒体 n [查看] [清空]
 *   点 [查看] 弹 drawer, 显示所有 XHR (带 role badge + "标记为 xxx" 按钮)
 */
import { useMemo, useState } from "react";
import type { CapturedMedia, CapturedXHR } from "~lib/messages";
import { shortURL } from "~lib/popup-helpers";
import type { RoleName } from "./components";

const ROLE_META: Record<RoleName, { icon: string; label: string }> = {
  home: { icon: "🏠", label: "首页" },
  category: { icon: "📂", label: "分类" },
  search: { icon: "🔍", label: "搜索" },
  detail: { icon: "📄", label: "详情" },
  play: { icon: "▶️", label: "播放" },
};

export function CaptureSummary({
  xhrs,
  media,
  onMarkAs,
  onClearXHR,
  onClearMedia,
}: {
  xhrs: CapturedXHR[];
  media: CapturedMedia[];
  /** 用户在 drawer 里点了"标记为 xxx"时回调 */
  onMarkAs: (xhr: CapturedXHR, role: RoleName) => void;
  onClearXHR: () => void;
  onClearMedia: () => void;
}) {
  const [openDrawer, setOpenDrawer] = useState<"xhr" | "media" | null>(null);

  const encStats = useMemo(() => {
    const m: Record<string, number> = {};
    for (const x of media) {
      const k = x.probe?.encryption ?? "?";
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [media]);

  return (
    <>
      <div className="s2s-capture-summary">
        <span className="s2s-cap-item">
          <span className="s2s-cap-dot" />
          XHR <b>{xhrs.length}</b>
        </span>
        <button
          className="s2s-btn-mini"
          onClick={() => setOpenDrawer("xhr")}
          disabled={xhrs.length === 0}
          title="查看抓到的 XHR"
        >
          查看
        </button>

        <span className="s2s-cap-sep" />

        <span className="s2s-cap-item">
          🎥 <b>{media.length}</b>
        </span>
        {media.length > 0 && (
          <span className="s2s-cap-enc-row">
            {Object.entries(encStats).map(([enc, n]) => (
              <EncDot key={enc} enc={enc} n={n} />
            ))}
          </span>
        )}
        <button
          className="s2s-btn-mini"
          onClick={() => setOpenDrawer("media")}
          disabled={media.length === 0}
        >
          查看
        </button>

        <span style={{ flex: 1 }} />

        <button
          className="s2s-btn-mini"
          onClick={() => {
            if (xhrs.length + media.length === 0) return;
            if (confirm("清空当前 tab 的所有抓包?")) {
              onClearXHR();
              onClearMedia();
            }
          }}
          disabled={xhrs.length + media.length === 0}
          title="清空抓包"
        >
          🗑
        </button>
      </div>

      {openDrawer === "xhr" && (
        <XHRDrawer
          xhrs={xhrs}
          onClose={() => setOpenDrawer(null)}
          onMarkAs={(x, r) => {
            onMarkAs(x, r);
            setOpenDrawer(null);
          }}
        />
      )}

      {openDrawer === "media" && (
        <MediaDrawer media={media} onClose={() => setOpenDrawer(null)} />
      )}
    </>
  );
}

function EncDot({ enc, n }: { enc: string; n: number }) {
  const colors: Record<string, string> = {
    "none": "#16a34a",
    "aes-128": "#0284c7",
    "sample-aes": "#dc2626",
    "widevine": "#dc2626",
    "playready": "#dc2626",
    "custom": "#d97706",
    "unknown": "#71717a",
    "?": "#71717a",
  };
  const labels: Record<string, string> = {
    "none": "无",
    "aes-128": "AES",
    "sample-aes": "SAE",
    "widevine": "WV",
    "playready": "PR",
    "custom": "自",
    "unknown": "?",
    "?": "?",
  };
  return (
    <span
      className="s2s-cap-enc"
      style={{ background: colors[enc] || "#71717a" }}
      title={enc}
    >
      {labels[enc] || enc}
      {n > 1 ? `×${n}` : ""}
    </span>
  );
}

function XHRDrawer({
  xhrs,
  onClose,
  onMarkAs,
}: {
  xhrs: CapturedXHR[];
  onClose: () => void;
  onMarkAs: (xhr: CapturedXHR, role: RoleName) => void;
}) {
  const sorted = useMemo(
    () => [...xhrs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)),
    [xhrs],
  );
  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal s2s-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>🕸 抓到 {xhrs.length} 条 XHR</b>
          <button className="s2s-btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="s2s-modal-body">
          {sorted.length === 0 && (
            <p className="s2s-tip">
              这个 tab 还没抓到 XHR。刷新页面或操作站点触发接口调用。
            </p>
          )}
          {sorted.map((x, i) => (
            <XHRRow key={i} x={x} onMarkAs={(r) => onMarkAs(x, r)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function XHRRow({
  x,
  onMarkAs,
}: {
  x: CapturedXHR;
  onMarkAs: (role: RoleName) => void;
}) {
  const [open, setOpen] = useState(false);
  const g = x.roleGuess as RoleName | undefined;
  const marked = x.role as RoleName | undefined;
  return (
    <div className="s2s-xhr-row">
      <div className="s2s-xhr-head">
        <span className="s2s-xhr-method">{x.method}</span>
        <span className="s2s-xhr-url" title={x.url}>
          {shortURL(x.url, 46)}
        </span>
        {marked && (
          <span className="s2s-badge s2s-badge-marked">
            {ROLE_META[marked].icon} 已标记 {ROLE_META[marked].label}
          </span>
        )}
        {!marked && g && (
          <span className="s2s-badge s2s-badge-guess" title="URL 特征猜的 role">
            {ROLE_META[g].icon} 疑似{ROLE_META[g].label}
          </span>
        )}
        <button
          className="s2s-btn-mini"
          onClick={() => setOpen((v) => !v)}
          title={open ? "收起" : "展开"}
        >
          {open ? "▲" : "▼"}
        </button>
      </div>
      {open && (
        <div className="s2s-xhr-body">
          <div className="s2s-xhr-mark-row">
            {(Object.keys(ROLE_META) as RoleName[])
              .filter((r) => r !== "play") // play 不允许手工从 XHR 标, 自动派生
              .map((r) => (
                <button
                  key={r}
                  className={`s2s-btn s2s-btn-ghost s2s-btn-xs ${marked === r ? "active" : ""}`}
                  onClick={() => onMarkAs(r)}
                  title={`标记为${ROLE_META[r].label}`}
                >
                  {ROLE_META[r].icon} {ROLE_META[r].label}
                </button>
              ))}
          </div>
          {x.respBody && (
            <details className="s2s-collapsible" style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11 }}>响应片段 ({x.respBody.length} 字节)</summary>
              <pre className="s2s-code" style={{ maxHeight: 180 }}>
                {x.respBody.slice(0, 1200)}
                {x.respBody.length > 1200 ? "\n…" : ""}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function MediaDrawer({
  media,
  onClose,
}: {
  media: CapturedMedia[];
  onClose: () => void;
}) {
  const recent = [...media].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal s2s-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>🎥 {media.length} 条媒体流</b>
          <button className="s2s-btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="s2s-modal-body">
          {recent.map((m, i) => (
            <div key={i} className="s2s-media-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="s2s-media-head">
                  <span className="s2s-media-type">{m.type}</span>
                  {m.probe && (
                    <span
                      className="s2s-cap-enc"
                      style={{ background: encColor(m.probe.encryption) }}
                    >
                      {m.probe.encryption}
                    </span>
                  )}
                </div>
                <div className="s2s-media-url" title={m.url}>
                  {shortURL(m.url, 60)}
                </div>
              </div>
              <button
                className="s2s-btn-mini"
                onClick={() => navigator.clipboard?.writeText(m.url)}
                title="复制"
              >
                📋
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function encColor(enc: string): string {
  const colors: Record<string, string> = {
    "none": "#16a34a",
    "aes-128": "#0284c7",
    "sample-aes": "#dc2626",
    "widevine": "#dc2626",
    "playready": "#dc2626",
    "custom": "#d97706",
    "unknown": "#71717a",
  };
  return colors[enc] || "#71717a";
}
