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
import {
  chromeAIStatus,
  FREE_MODELS,
  getAIConfig,
  setAIConfig,
  type AIProvider,
} from "~lib/ai-helper";

/** v0.22 role 卡片布局的角色名 */
export type RoleName = "home" | "category" | "search" | "detail" | "play";

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
  const [provider, setProvider] = useState<AIProvider>("openrouter-free");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [chromeAI, setChromeAI] = useState<{ available: boolean; message: string }>({
    available: false,
    message: "检查中...",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getGithubToken().then(setToken);
    getAIConfig().then((c) => {
      setProvider(c.provider);
      setKey(c.key);
      setModel(c.model);
      setBaseURL(c.baseURL);
    });
    chromeAIStatus().then((s) => setChromeAI({ available: s.available, message: s.message }));
  }, []);

  const changeProvider = async (p: AIProvider) => {
    setProvider(p);
    // 切 provider 时预填默认值 (如果字段是空的)
    const defaults: Record<AIProvider, { model: string; baseURL: string }> = {
      "chrome-ai": { model: "gemini-nano", baseURL: "" },
      "openrouter-free": { model: "deepseek/deepseek-chat-v3-0324:free", baseURL: "https://openrouter.ai/api/v1" },
      byok: { model: model || "deepseek/deepseek-chat", baseURL: baseURL || "https://openrouter.ai/api/v1" },
    };
    setModel(defaults[p].model);
    setBaseURL(defaults[p].baseURL);
  };

  const save = async () => {
    await setGithubToken(token.trim());
    await setAIConfig({
      provider,
      key: key.trim(),
      model: model.trim(),
      baseURL: baseURL.trim(),
    });
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
          {/* AI Provider */}
          <div className="s2s-section-title" style={{ marginBottom: 6 }}>
            🤖 AI 提供商
          </div>

          <div className="s2s-provider-tabs">
            <button
              className={`s2s-provider-tab ${provider === "chrome-ai" ? "active" : ""} ${!chromeAI.available ? "disabled" : ""}`}
              onClick={() => chromeAI.available && changeProvider("chrome-ai")}
              disabled={!chromeAI.available}
              title={chromeAI.message}
            >
              🌐 Chrome 内置
              <span className="s2s-tab-note">本地免费</span>
            </button>
            <button
              className={`s2s-provider-tab ${provider === "openrouter-free" ? "active" : ""}`}
              onClick={() => changeProvider("openrouter-free")}
            >
              🆓 免费模型
              <span className="s2s-tab-note">需注册</span>
            </button>
            <button
              className={`s2s-provider-tab ${provider === "byok" ? "active" : ""}`}
              onClick={() => changeProvider("byok")}
            >
              🔑 BYOK
              <span className="s2s-tab-note">带自己 key</span>
            </button>
          </div>

          {provider === "chrome-ai" && (
            <div className="s2s-provider-body">
              <p className="s2s-tip s2s-tip-dim">
                Chrome 138+ 内置的 <b>Gemini Nano</b> 模型 (本地运行, 隐私最好, 完全免费)。
              </p>
              <div
                className={`s2s-notice ${chromeAI.available ? "" : "s2s-notice-err"}`}
                style={{ margin: 0 }}
              >
                {chromeAI.message}
              </div>
              {!chromeAI.available && (
                <p className="s2s-tip s2s-tip-dim" style={{ marginTop: 8 }}>
                  开启步骤:
                  <br />1. Chrome 138+ (Dev/Canary 更稳)
                  <br />2. <code>chrome://flags/#prompt-api-for-gemini-nano</code> → Enabled
                  <br />3. <code>chrome://flags/#optimization-guide-on-device-model</code> → Enabled BypassPerfRequirement
                  <br />4. 重启 Chrome, 首次会自动下载 ~2GB 模型
                </p>
              )}
            </div>
          )}

          {provider === "openrouter-free" && (
            <div className="s2s-provider-body">
              <p className="s2s-tip s2s-tip-dim">
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                  OpenRouter
                </a>{" "}
                的免费模型 (:free 后缀)。免费账号限流 20 req/min · 200 req/day, 但对本扩展绰绰有余。
              </p>
              <input
                className="s2s-input"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-or-v1-..."
              />
              <select
                className="s2s-input"
                style={{ marginTop: 6 }}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                {FREE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.note}
                  </option>
                ))}
              </select>
            </div>
          )}

          {provider === "byok" && (
            <div className="s2s-provider-body">
              <p className="s2s-tip s2s-tip-dim">
                自定义任意 OpenAI 兼容 API (OpenRouter / Groq / Cerebras / DeepSeek / 自建等)。
              </p>
              <input
                className="s2s-input"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="Base URL (如 https://openrouter.ai/api/v1)"
              />
              <input
                className="s2s-input"
                style={{ marginTop: 6 }}
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="API Key"
              />
              <input
                className="s2s-input"
                style={{ marginTop: 6 }}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model ID (如 deepseek/deepseek-chat)"
              />
              <details className="s2s-collapsible" style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 11 }}>💡 常用 provider 参考</summary>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
                  <div>• <b>OpenRouter</b>: https://openrouter.ai/api/v1 · 所有模型</div>
                  <div>• <b>Groq</b>: https://api.groq.com/openai/v1 · Llama/Mixtral, 30 req/min 免费</div>
                  <div>• <b>Cerebras</b>: https://api.cerebras.ai/v1 · Llama 3.3, 免费</div>
                  <div>• <b>DeepSeek</b>: https://api.deepseek.com/v1 · 官方, 便宜</div>
                  <div>• <b>SiliconFlow</b>: https://api.siliconflow.cn/v1 · 国内快</div>
                </div>
              </details>
            </div>
          )}

          {/* GitHub Token */}
          <div className="s2s-section-title" style={{ marginTop: 14, marginBottom: 6 }}>
            📤 GitHub Token
          </div>
          <p className="s2s-tip s2s-tip-dim">
            上传到 Gist 需要{" "}
            <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
              PAT
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
