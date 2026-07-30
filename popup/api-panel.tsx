/**
 * API 抓包面板 —— 显示 background 抓到的 XHR/fetch
 * 用户可以给某条打 role 标签 (home/category/detail/search)
 * 用于生成 API 型 Drpy 爬虫
 */

import { useEffect, useState } from "react";
import type { CapturedXHR } from "~lib/messages";
import { sendToBackground, copyToClipboard, shortURL } from "~lib/popup-helpers";
import { analyzeJSON, type JSONField } from "~lib/json-analyzer";

type Role = "home" | "category" | "search" | "detail" | "play";

const ROLE_LABELS: Record<Role, string> = {
  home: "🏠 首页",
  category: "📁 分类",
  search: "🔍 搜索",
  detail: "📄 详情",
  play: "▶ 播放",
};

export function ApiPanel({ onClose }: { onClose: () => void }) {
  const [xhr, setXHR] = useState<CapturedXHR[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const r = await sendToBackground<{ xhr: CapturedXHR[] }>({ type: "GET_CAPTURED_XHR" });
    setXHR(r?.xhr || []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);

  const clear = async () => {
    if (!confirm("清空所有 XHR 记录？")) return;
    await sendToBackground({ type: "CLEAR_CAPTURED_XHR" });
    setXHR([]);
    setSelected(-1);
  };

  const filtered = xhr.filter((x) => {
    if (!filter) return true;
    return x.url.toLowerCase().includes(filter.toLowerCase());
  });

  const sel = selected >= 0 ? filtered[selected] : null;

  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal s2s-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>🕸 API 抓包 ({xhr.length})</b>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="s2s-btn-mini" onClick={refresh} title="刷新">
              {loading ? "..." : "🔄"}
            </button>
            <button className="s2s-btn-mini" onClick={clear} title="清空">
              🗑
            </button>
            <button className="s2s-btn-mini" onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="s2s-modal-body">
          {xhr.length === 0 ? (
            <p className="s2s-tip s2s-tip-dim">
              还没抓到 API 请求。<br />
              打开影视网站,滚动页面 / 点分类 / 搜一下 / 点详情,让页面发请求。
              <br /><br />
              🌐 → 首页/分类接口<br />
              🔍 → 搜索时的 API<br />
              📄 → 点详情页时的 API
            </p>
          ) : (
            <>
              <input
                className="s2s-input"
                placeholder="🔎 过滤 URL..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="s2s-xhr-list">
                {filtered.map((x, i) => (
                  <XHRRow
                    key={i}
                    x={x}
                    idx={i}
                    active={selected === i}
                    onClick={() => setSelected(i)}
                  />
                ))}
                {filtered.length === 0 && (
                  <p className="s2s-tip s2s-tip-dim">无匹配</p>
                )}
              </div>

              {sel && <XHRDetail x={sel} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function XHRRow({
  x,
  idx: _idx,
  active,
  onClick,
}: {
  x: CapturedXHR;
  idx: number;
  active: boolean;
  onClick: () => void;
}) {
  const path = (() => {
    try {
      const u = new URL(x.url);
      return u.pathname + (u.search || "");
    } catch {
      return x.url;
    }
  })();
  return (
    <div className={`s2s-xhr-row ${active ? "active" : ""}`} onClick={onClick}>
      <span className={`s2s-method s2s-method-${x.method.toLowerCase()}`}>{x.method}</span>
      <span className="s2s-xhr-path" title={x.url}>{shortURL(path, 60)}</span>
      {x.role && <span className="s2s-badge">{ROLE_LABELS[x.role]}</span>}
      {x.respStatus && x.respStatus !== 200 && (
        <span className="s2s-badge s2s-badge-warn">{x.respStatus}</span>
      )}
    </div>
  );
}

function XHRDetail({ x }: { x: CapturedXHR }) {
  const [fields, setFields] = useState<JSONField[]>([]);
  const [rawExpanded, setRawExpanded] = useState(false);

  useEffect(() => {
    if (x.respBody) {
      try {
        const parsed = JSON.parse(x.respBody);
        setFields(analyzeJSON(parsed));
      } catch {
        setFields([]);
      }
    }
  }, [x.url, x.respBody]);

  return (
    <div className="s2s-xhr-detail">
      <div className="s2s-detail-row">
        <b>URL:</b>
        <div className="s2s-detail-url">
          <code>{x.url}</code>
          <button className="s2s-btn-mini" onClick={() => copyToClipboard(x.url)}>
            📋
          </button>
        </div>
      </div>

      {x.reqBody && (
        <div className="s2s-detail-row">
          <b>请求体:</b>
          <code style={{ fontSize: 10, wordBreak: "break-all" }}>{x.reqBody.slice(0, 200)}</code>
        </div>
      )}

      {fields.length > 0 && (
        <div className="s2s-detail-row">
          <b>💡 检测到的字段路径 (JSONPath):</b>
          <div className="s2s-json-fields">
            {fields.map((f, i) => (
              <div key={i} className="s2s-json-field">
                <div className="s2s-json-field-head">
                  <code className="s2s-json-path">{f.path}</code>
                  <span className="s2s-badge">{f.kind}</span>
                  {f.count > 1 && <span className="s2s-tip-dim">×{f.count}</span>}
                  <button
                    className="s2s-btn-mini"
                    onClick={() => copyToClipboard(f.path)}
                    title="复制路径"
                  >
                    📋
                  </button>
                </div>
                {f.sample && (
                  <div className="s2s-json-sample" title={f.sample}>
                    → {f.sample.slice(0, 60)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {x.respBody && (
        <details className="s2s-collapsible" open={rawExpanded}>
          <summary onClick={() => setRawExpanded(!rawExpanded)}>
            📦 响应原文 ({x.respBody.length} bytes{x.respTruncated ? ", 已截断" : ""})
          </summary>
          <pre className="s2s-json-raw">{prettyJSON(x.respBody)}</pre>
        </details>
      )}
    </div>
  );
}

function prettyJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2).slice(0, 5000);
  } catch {
    return s.slice(0, 5000);
  }
}
