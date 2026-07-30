/**
 * popup 里用到的小型可复用组件。
 * 主 Popup 组件仍在 popup.tsx，本文件只放"叶子组件"。
 */
import { useEffect, useState } from "react";
import type {
  BaseInfo,
  ProjectState,
  SerializedSample,
} from "~lib/messages";
import { hasHostMismatch, resolveHost } from "~lib/base-inferrer";
import { getGithubToken, setGithubToken } from "~lib/gist-uploader";

export type Step = "start" | "listPick" | "listReview" | "detail" | "media" | "done";

// ============ 顶部进度条 ============
export function ProgressBar({
  current,
  state,
}: {
  current: Step;
  state: ProjectState;
}) {
  const steps: { key: Step; label: string; done: boolean }[] = [
    { key: "start", label: "1", done: !!state.site },
    { key: "listReview", label: "2", done: !!state.listSelector },
    {
      key: "detail",
      label: "3",
      done: !!(state.detail?.titleSelector || state.detail?.playListSelector),
    },
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

// ============ 列表样本卡片 ============
export function SampleCard({ s }: { s: SerializedSample }) {
  return (
    <div className="s2s-sample-card">
      <b>{s.name || "<无标题>"}</b>
      {s.remarks && <span className="s2s-remarks"> · {s.remarks}</span>}
      <div className="s2s-sample-url">{s.url}</div>
    </div>
  );
}

// ============ 详情字段编辑器（inline） ============
export function DetailField({
  label,
  selector,
  sample,
  onPick,
  onEdit,
  onAskAI,
}: {
  label: string;
  selector?: string;
  sample?: string;
  onPick: () => void;
  onEdit?: (val: string) => void;
  onAskAI?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(selector || "");
  useEffect(() => {
    setDraft(selector || "");
  }, [selector]);

  return (
    <div className={`s2s-detail-field ${selector ? "filled" : ""}`}>
      <div className="s2s-detail-label">{label}</div>
      {editing ? (
        <>
          <input
            className="s2s-input s2s-input-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="CSS 选择器 (可 && 属性)"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onEdit?.(draft.trim());
                setEditing(false);
              }
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(selector || "");
              }
            }}
          />
          <button
            className="s2s-btn-mini"
            onClick={() => {
              onEdit?.(draft.trim());
              setEditing(false);
            }}
          >
            ✓
          </button>
        </>
      ) : (
        <>
          <div className="s2s-detail-value">
            {selector ? (
              <>
                <code title={selector}>{selector}</code>
                {sample && (
                  <div className="s2s-detail-sample" title={sample}>
                    → {sample}
                  </div>
                )}
              </>
            ) : (
              <span className="s2s-tip-dim">未识别</span>
            )}
          </div>
          {onEdit && selector && (
            <button
              className="s2s-btn-mini"
              onClick={() => setEditing(true)}
              title="改选择器"
            >
              ✎
            </button>
          )}
          {onAskAI && (
            <button
              className="s2s-btn-mini"
              onClick={onAskAI}
              title="AI 帮我识别"
            >
              🤖
            </button>
          )}
          <button className="s2s-btn-mini" onClick={onPick}>
            {selector ? "点选" : "手选"}
          </button>
        </>
      )}
    </div>
  );
}

// ============ Base URL 面板 ============
export function BasePanel({
  info,
  samples,
  onOverride,
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
                {candidates.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          ) : null}
          <div className="s2s-actions" style={{ marginTop: 6 }}>
            {editing ? (
              <>
                <button
                  className="s2s-btn s2s-btn-ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(info.overrideBase || "");
                  }}
                >
                  取消
                </button>
                <button
                  className="s2s-btn s2s-btn-primary"
                  onClick={() => {
                    onOverride(draft.trim());
                    setEditing(false);
                  }}
                >
                  保存
                </button>
              </>
            ) : (
              <>
                {info.overrideBase && (
                  <button
                    className="s2s-btn s2s-btn-ghost"
                    onClick={() => onOverride("")}
                  >
                    还原自动
                  </button>
                )}
                <button
                  className="s2s-btn s2s-btn-ghost"
                  onClick={() => {
                    setEditing(true);
                    setDraft(info.overrideBase || auto);
                  }}
                >
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

// ============ 设置面板 ============
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState("");
  const [aiKey, setAIKey] = useState("");
  const [aiModel, setAIModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getGithubToken().then(setToken);
    chrome.storage.local
      .get(["s2s:aiKey", "s2s:aiModel"])
      .then((r) => {
        setAIKey(r["s2s:aiKey"] || "");
        setAIModel(r["s2s:aiModel"] || "deepseek/deepseek-chat");
      });
  }, []);

  const save = async () => {
    await setGithubToken(token.trim());
    await chrome.storage.local.set({
      "s2s:aiKey": aiKey.trim(),
      "s2s:aiModel": aiModel.trim() || "deepseek/deepseek-chat",
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div className="s2s-modal" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>⚙ 设置</b>
          <button className="s2s-btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="s2s-modal-body">
          <div className="s2s-section-title" style={{ marginBottom: 6 }}>
            GitHub Token
          </div>
          <p className="s2s-tip s2s-tip-dim">
            上传到 Gist 需要{" "}
            <a
              href="https://github.com/settings/tokens?type=beta"
              target="_blank"
              rel="noreferrer"
            >
              Personal Access Token
            </a>
            （勾选 <code>gist</code> 权限）
          </p>
          <input
            className="s2s-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_... 或 github_pat_..."
          />

          <div className="s2s-section-title" style={{ marginTop: 14, marginBottom: 6 }}>
            🤖 AI 辅助 (OpenRouter)
          </div>
          <p className="s2s-tip s2s-tip-dim">
            识别不到字段时用 AI 帮忙看 HTML。填{" "}
            <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
              OpenRouter Key
            </a>
            。默认 DeepSeek Chat（便宜，几乎免费）。
          </p>
          <input
            className="s2s-input"
            type="password"
            value={aiKey}
            onChange={(e) => setAIKey(e.target.value)}
            placeholder="sk-or-v1-..."
          />
          <input
            className="s2s-input"
            style={{ marginTop: 6 }}
            value={aiModel}
            onChange={(e) => setAIModel(e.target.value)}
            placeholder="deepseek/deepseek-chat"
          />

          <div className="s2s-actions" style={{ marginTop: 12 }}>
            <button className="s2s-btn s2s-btn-primary" onClick={save}>
              {saved ? "✅ 已保存" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 项目列表面板 ============
export function ProjectsPanel({
  projects,
  activeHost,
  onSwitch,
  onDelete,
  onNew,
  onClose,
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
          <button className="s2s-btn-mini" onClick={onClose}>
            关闭
          </button>
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
                  >
                    🗑
                  </button>
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
