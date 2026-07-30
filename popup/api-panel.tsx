/**
 * API 抓包面板 —— 显示 background 抓到的 XHR/fetch
 * 用户可以给某条打 role 标签 (home/category/detail/search)
 * 用于生成 API 型 Drpy 爬虫
 */

import { useEffect, useState } from "react";
import type { CapturedXHR, Message } from "~lib/messages";
import { sendToBackground, copyToClipboard, shortURL } from "~lib/popup-helpers";
import { analyzeJSON, type JSONField } from "~lib/json-analyzer";
import { detectPlayFormat, generatePlayParseSnippet } from "~lib/play-format-detector";
import { askAIJSONPath, hasAIConfig } from "~lib/ai-helper";

type Role = "home" | "detail" | "search";

const ROLE_LABELS: Record<Role, string> = {
  home: "🏠 首页/分类",
  detail: "📄 详情",
  search: "🔍 搜索",
};

/** 抓包 role 状态存 chrome.storage.local 里, 按 tab pageURL 存 */
const ROLE_KEY = "s2s:xhrRoles";

async function saveRole(xhrURL: string, role: Role | null) {
  const r = await chrome.storage.local.get([ROLE_KEY]);
  const map = r[ROLE_KEY] || {};
  if (role) map[xhrURL] = role;
  else delete map[xhrURL];
  await chrome.storage.local.set({ [ROLE_KEY]: map });
}

async function loadRoles(): Promise<Record<string, Role>> {
  const r = await chrome.storage.local.get([ROLE_KEY]);
  return r[ROLE_KEY] || {};
}

export function ApiPanel({
  onClose,
  onExport,
}: {
  onClose: () => void;
  onExport?: (config: {
    home?: CapturedXHR & { fields: any; listPath: string };
    detail?: CapturedXHR & { fields: any };
    search?: CapturedXHR & { fields: any; listPath: string };
  }) => void;
}) {
  const [xhr, setXHR] = useState<CapturedXHR[]>([]);
  const [selected, setSelected] = useState<number>(-1);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [aiWorking, setAIWorking] = useState(false);
  const [aiMsg, setAIMsg] = useState<string>("");

  const refresh = async () => {
    setLoading(true);
    const r = await sendToBackground<{ xhr: CapturedXHR[] }>({ type: "GET_CAPTURED_XHR" });
    setXHR(r?.xhr || []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    loadRoles().then(setRoles);
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const clear = async () => {
    if (!confirm("清空所有 XHR 记录？(role 标签保留)")) return;
    await sendToBackground({ type: "CLEAR_CAPTURED_XHR" });
    setXHR([]);
    setSelected(-1);
  };

  const setXHRRole = async (xhrURL: string, role: Role | null) => {
    const next = { ...roles };
    if (role) next[xhrURL] = role;
    else delete next[xhrURL];
    setRoles(next);
    await saveRole(xhrURL, role);
  };

  const filtered = xhr.filter((x) => {
    if (!filter) return true;
    return x.url.toLowerCase().includes(filter.toLowerCase());
  });

  const sel = selected >= 0 ? filtered[selected] : null;

  // AI 一键: 让 AI 看所有 XHR 的 URL + 响应体前 500 字符, 猜每条的 role
  const askAIToTag = async () => {
    if (!(await hasAIConfig())) {
      setAIMsg("❌ 请先在 ⚙ 设置里配 AI");
      return;
    }
    setAIWorking(true);
    setAIMsg("🤖 AI 分析中...");
    try {
      const list = xhr.slice(0, 30).map((x) => ({
        url: x.url,
        method: x.method,
        respBody: (x.respBody || "").slice(0, 500),
      }));
      const guess = await askAIJSONPath(list);
      if (guess.errors?.length) {
        setAIMsg(`❌ ${guess.errors[0]}`);
        setAIWorking(false);
        return;
      }
      const next = { ...roles };
      let count = 0;
      for (const g of guess.tags || []) {
        const target = xhr.find((x) => x.url === g.url);
        if (target && g.role) {
          next[g.url] = g.role as Role;
          count++;
        }
      }
      setRoles(next);
      // 保存
      const kv: Record<string, Role | null> = {};
      for (const [k, v] of Object.entries(next)) kv[k] = v as Role;
      await chrome.storage.local.set({ [ROLE_KEY]: kv });
      setAIMsg(`✅ AI 标记了 ${count} 条`);
    } catch (e: any) {
      setAIMsg(`❌ ${e.message}`);
    }
    setAIWorking(false);
  };

  // 已标记的分组统计
  const groupedCount = Object.values(roles).reduce((m, r) => {
    m[r] = (m[r] || 0) + 1;
    return m;
  }, {} as Record<Role, number>);

  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal s2s-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>🕸 API 抓包 ({xhr.length})</b>
          <div style={{ display: "flex", gap: 4 }}>
            <button className="s2s-btn-mini" onClick={refresh} title="刷新">
              {loading ? "..." : "🔄"}
            </button>
            <button
              className="s2s-btn-mini"
              onClick={askAIToTag}
              disabled={aiWorking || xhr.length === 0}
              title="AI 帮忙标记每条 XHR 的用途"
            >
              🤖
            </button>
            <button className="s2s-btn-mini" onClick={clear} title="清空">🗑</button>
            <button className="s2s-btn-mini" onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="s2s-modal-body">
          {xhr.length === 0 ? (
            <p className="s2s-tip s2s-tip-dim">
              还没抓到 API 请求。<br />
              打开影视网站,滚动页面 / 点分类 / 搜一下 / 点详情,让页面发请求。
              <br /><br />
              如果什么都抓不到,可能是页面用 SSR (数据在 HTML 里),这时候用 CSS 选择器模式即可。
            </p>
          ) : (
            <>
              {aiMsg && (
                <div className={`s2s-notice ${aiMsg.startsWith("❌") ? "s2s-notice-err" : ""}`}>
                  {aiMsg}
                </div>
              )}

              {/* 已标记的分组 */}
              {Object.keys(groupedCount).length > 0 && (
                <div className="s2s-role-summary">
                  {(["home", "detail", "search"] as Role[]).map((r) =>
                    groupedCount[r] ? (
                      <span key={r} className="s2s-badge">
                        {ROLE_LABELS[r]} × {groupedCount[r]}
                      </span>
                    ) : null,
                  )}
                </div>
              )}

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
                    role={roles[x.url]}
                    active={selected === i}
                    onClick={() => setSelected(i)}
                  />
                ))}
                {filtered.length === 0 && (
                  <p className="s2s-tip s2s-tip-dim">无匹配</p>
                )}
              </div>

              {sel && (
                <XHRDetail
                  x={sel}
                  role={roles[sel.url]}
                  onSetRole={(r) => setXHRRole(sel.url, r)}
                />
              )}

              {onExport && Object.keys(groupedCount).length > 0 && (
                <div className="s2s-actions" style={{ marginTop: 10 }}>
                  <button
                    className="s2s-btn s2s-btn-primary"
                    onClick={() => {
                      const homeXHR = xhr.find((x) => roles[x.url] === "home");
                      const detailXHR = xhr.find((x) => roles[x.url] === "detail");
                      const searchXHR = xhr.find((x) => roles[x.url] === "search");
                      if (!homeXHR) {
                        alert("至少要标记一条 🏠 首页/分类 接口");
                        return;
                      }
                      onExport({
                        home: homeXHR ? augment(homeXHR, "home") : undefined,
                        detail: detailXHR ? augment(detailXHR, "detail") : undefined,
                        search: searchXHR ? augment(searchXHR, "search") : undefined,
                      } as any);
                      onClose();
                    }}
                  >
                    ✨ 生成 API 型爬虫
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 从 XHR 里自动分析 JSONPath 字段 (用于导出) */
function augment(x: CapturedXHR, role?: Role): any {
  const fields: any = {};
  let listPath = "";
  let playSnippet: string | undefined;
  try {
    if (x.respBody) {
      const parsed = JSON.parse(x.respBody);
      const analyzed = analyzeJSON(parsed);
      const list = analyzed.find((f) => f.kind === "list");
      if (list) listPath = list.path;
      // 从 list[*].xxx 里提字段 (相对路径, 去掉 listPath 前缀)
      for (const f of analyzed) {
        if (list && f.path.startsWith(list.path + "[*].")) {
          const rel = f.path.slice((list.path + "[*].").length);
          if (f.kind === "title") fields.name = fields.name || rel;
          if (f.kind === "pic") fields.pic = fields.pic || rel;
          if (f.kind === "id" || f.kind === "url") fields.id = fields.id || rel;
          if (f.kind === "desc") fields.desc = fields.desc || rel;
        } else if (!list) {
          // 无列表, 顶层字段
          if (f.kind === "title") fields.name = fields.name || f.path;
          if (f.kind === "pic") fields.pic = fields.pic || f.path;
          if (f.kind === "desc") fields.desc = fields.desc || f.path;
          if (f.kind === "playURL") fields.playURL = fields.playURL || f.path;
        }
      }
      // 对详情接口, 额外做 playURL 智能识别
      if (role === "detail") {
        const formats = detectPlayFormat(parsed);
        if (formats.length > 0) {
          playSnippet = generatePlayParseSnippet(formats[0]);
          fields.playURL = fields.playURL || formats[0].playURLPath;
        }
      }
    }
  } catch {}
  return { ...x, fields, listPath, playSnippet };
}

function XHRRow({
  x,
  role,
  active,
  onClick,
}: {
  x: CapturedXHR;
  role?: Role;
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
    <div className={`s2s-xhr-row ${active ? "active" : ""} ${role ? "tagged" : ""}`} onClick={onClick}>
      <span className={`s2s-method s2s-method-${x.method.toLowerCase()}`}>{x.method}</span>
      <span className="s2s-xhr-path" title={x.url}>{shortURL(path, 55)}</span>
      {role && <span className="s2s-badge">{ROLE_LABELS[role]}</span>}
      {x.respStatus && x.respStatus !== 200 && (
        <span className="s2s-badge s2s-badge-warn">{x.respStatus}</span>
      )}
    </div>
  );
}

function XHRDetail({
  x,
  role,
  onSetRole,
}: {
  x: CapturedXHR;
  role?: Role;
  onSetRole: (r: Role | null) => void;
}) {
  const [fields, setFields] = useState<JSONField[]>([]);
  const [playFormats, setPlayFormats] = useState<any[]>([]);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<any>(null);

  useEffect(() => {
    if (x.respBody) {
      try {
        const parsed = JSON.parse(x.respBody);
        setFields(analyzeJSON(parsed));
        setPlayFormats(detectPlayFormat(parsed));
      } catch {
        setFields([]);
        setPlayFormats([]);
      }
    }
    setReplayResult(null);
  }, [x.url, x.respBody]);

  const replay = async () => {
    setReplaying(true);
    setReplayResult(null);
    try {
      const r = await sendToBackground<any>({ type: "REPLAY_XHR", xhr: x });
      setReplayResult(r);
    } catch (e: any) {
      setReplayResult({ ok: false, error: e.message });
    }
    setReplaying(false);
  };

  return (
    <div className="s2s-xhr-detail">
      <div className="s2s-detail-row">
        <b>标记为:</b>
        <div className="s2s-role-picker">
          {(["home", "detail", "search"] as Role[]).map((r) => (
            <button
              key={r}
              className={`s2s-role-btn ${role === r ? "active" : ""}`}
              onClick={() => onSetRole(role === r ? null : r)}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="s2s-detail-row">
        <b>URL:</b>
        <div className="s2s-detail-url">
          <code>{x.url}</code>
          <button className="s2s-btn-mini" onClick={() => copyToClipboard(x.url)}>📋</button>
          <button
            className="s2s-btn-mini"
            onClick={replay}
            disabled={replaying}
            title="重新请求这个 API"
          >
            {replaying ? "..." : "▶ 重播"}
          </button>
        </div>
      </div>

      {replayResult && (
        <div className={`s2s-notice ${replayResult.ok ? "" : "s2s-notice-err"}`}>
          {replayResult.ok ? (
            <>
              ✅ HTTP {replayResult.status} · {replayResult.contentType} · {replayResult.body?.length || 0} bytes
              <details style={{ marginTop: 4 }}>
                <summary>查看响应</summary>
                <pre className="s2s-json-raw" style={{ maxHeight: 150 }}>
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(replayResult.body), null, 2).slice(0, 3000);
                    } catch {
                      return replayResult.body?.slice(0, 3000);
                    }
                  })()}
                </pre>
              </details>
            </>
          ) : (
            <>❌ {replayResult.error || `HTTP ${replayResult.status}`}</>
          )}
        </div>
      )}

      {x.reqBody && (
        <div className="s2s-detail-row">
          <b>请求体:</b>
          <code style={{ fontSize: 10, wordBreak: "break-all" }}>{x.reqBody.slice(0, 200)}</code>
        </div>
      )}

      {/* V0.11: 剧集列表格式识别 (仅 detail 角色) */}
      {role === "detail" && playFormats.length > 0 && (
        <div className="s2s-detail-row">
          <b>🎬 剧集列表格式:</b>
          <div className="s2s-play-fmt">
            <span className="s2s-badge">{playFormats[0].kind}</span>
            {" "}
            <code className="s2s-json-path">{playFormats[0].playURLPath}</code>
            <div className="s2s-tip-dim" style={{ marginTop: 3 }}>
              {playFormats[0].reasoning}
              {playFormats[0].sample && ` — ${playFormats[0].sample.slice(0, 60)}`}
            </div>
          </div>
        </div>
      )}

      {fields.length > 0 && (
        <div className="s2s-detail-row">
          <b>💡 检测到的字段 (JSONPath):</b>
          <div className="s2s-json-fields">
            {fields.map((f, i) => (
              <div key={i} className="s2s-json-field">
                <div className="s2s-json-field-head">
                  <code className="s2s-json-path">{f.path}</code>
                  <span className="s2s-badge">{f.kind}</span>
                  {f.count > 1 && <span className="s2s-tip-dim">×{f.count}</span>}
                  <button className="s2s-btn-mini" onClick={() => copyToClipboard(f.path)} title="复制">📋</button>
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
        <details className="s2s-collapsible">
          <summary>
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
