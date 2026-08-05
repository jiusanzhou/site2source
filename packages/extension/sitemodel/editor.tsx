/**
 * SiteModel 编辑器 — 插件里的可视化 SiteModel 创作面板
 *
 * ## 定位
 * 阶段 1: 手工编辑 + 内置模板加载 + 签名验证 + 一键生成 spider
 *
 * ## UI 布局
 * ```
 * [模板选择 | 导入 JSON] [👀 预览] [💾 下载 spider] [📋 复制配置]
 * ─────────────────────────────────────
 * 基本信息 (name/site_url/bases)
 * ─────────────────────────────────────
 * 签名模式 (可加多个)
 *   └─ 每个模式: formula + algorithm + vars (含密钥表)
 *   └─ [🔍 验证按钮] → 打开验证器
 * ─────────────────────────────────────
 * 端点列表 (可加多个)
 *   └─ 每个端点: base/path/query 模板/sign_mode/挑选式
 * ─────────────────────────────────────
 * 字段映射
 * ─────────────────────────────────────
 * 分类列表
 * ─────────────────────────────────────
 * ```
 *
 * ## 实现哲学
 * - **不用 form 库**: state + JSON edit / textarea, 保持依赖轻量
 * - **两种模式**: 表单模式(引导) / JSON 模式 (专家直接改)
 * - **实时预览**: 每次改动 → 立即重新生成 spider.js 显示 byte 数 + 摘要
 */

import { useState, useMemo, useCallback } from "react";
import type { SiteModel } from "~lib/site-model";
import { generateT3SpiderFromModel } from "~lib/model-generator";
import { AIYIFAN_MODEL } from "~lib/sites/aiyifan";
import { inferSiteModel } from "~lib/model-inferrer";
import type { CapturedXHR } from "~lib/messages";
import { SignVerifierPanel } from "./verifier";

// 内置模板
const TEMPLATES: Record<string, SiteModel> = {
  aiyifan: AIYIFAN_MODEL,
  blank: {
    name: "example",
    display_name: "Example Site",
    site_url: "https://www.example.com",
    bases: { api: "https://api.example.com" },
    endpoints: [
      {
        name: "home",
        base: "api",
        path: "list",
        query: "page={page}",
        sign_mode: "none",
        response: { list: { path: "data.list" } },
      },
    ],
    mappings: {
      vod_id: ["id"],
      vod_name: ["name", "title"],
      vod_pic: ["cover", "image"],
    },
    categories: [{ kind: "static", id: "all", name: "全部", source_field: "data.list" }],
  },
};

interface Props {
  onClose: () => void;
  /** 当前站抓到的 XHR (用于"从抓包推理"按钮) */
  capturedXhrs?: CapturedXHR[];
  /** 当前站的 URL */
  siteUrl?: string;
}

export function SiteModelEditor({ onClose, capturedXhrs, siteUrl }: Props) {
  const [model, setModel] = useState<SiteModel>(AIYIFAN_MODEL);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState(() => JSON.stringify(AIYIFAN_MODEL, null, 2));
  const [jsonError, setJsonError] = useState<string>("");
  const [showVerifier, setShowVerifier] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState("");
  const [inferHints, setInferHints] = useState<string[]>([]);

  // 实时生成 spider
  const spiderResult = useMemo(() => {
    try {
      const src = generateT3SpiderFromModel(model);
      return { ok: true as const, src, bytes: src.length };
    } catch (e: any) {
      return { ok: false as const, error: e.message };
    }
  }, [model]);

  const applyJsonEdit = useCallback((text: string) => {
    setJsonText(text);
    try {
      const m = JSON.parse(text);
      setModel(m);
      setJsonError("");
    } catch (e: any) {
      setJsonError(e.message);
    }
  }, []);

  const loadTemplate = useCallback((key: string) => {
    const t = TEMPLATES[key];
    if (!t) return;
    setModel(t);
    setJsonText(JSON.stringify(t, null, 2));
    setJsonError("");
    setInferHints([]);
  }, []);

  /** 从当前站抓包推理 SiteModel */
  const doInfer = useCallback(() => {
    if (!capturedXhrs?.length) {
      alert("当前站还没抓到 XHR。先在页面上正常浏览（首页 / 分类 / 详情 / 播放）让插件抓包，再来推理。");
      return;
    }
    const url = siteUrl || (capturedXhrs[0]?.pageURL) || "https://unknown.com";
    const result = inferSiteModel(capturedXhrs, url);
    setModel(result.model);
    setJsonText(JSON.stringify(result.model, null, 2));
    setJsonError("");
    setInferHints(result.hints);
    setCopiedMsg(`✨ 从 ${capturedXhrs.length} 条抓包推出 ${result.model.endpoints.length} 端点`);
    setTimeout(() => setCopiedMsg(""), 3000);
  }, [capturedXhrs, siteUrl]);

  const copyToClipboard = useCallback(async (text: string, msg = "已复制") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(msg);
      setTimeout(() => setCopiedMsg(""), 1500);
    } catch {}
  }, []);

  const downloadFile = useCallback((name: string, content: string, mime = "text/plain") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadSpider = useCallback(() => {
    if (!spiderResult.ok) return;
    downloadFile(`spider_${model.name}_t3.js`, spiderResult.src, "application/javascript");
  }, [spiderResult, model.name, downloadFile]);

  const downloadTvboxConfig = useCallback(() => {
    const cfg = {
      spider: "",
      sites: [
        {
          key: model.name,
          name: model.display_name,
          type: 3,
          api: `./spider_${model.name}_t3.js`,
          searchable: 1,
          quickSearch: 1,
          filterable: 0,
        },
      ],
      parses: [{ name: "Web", type: 3, url: "Web" }],
      flags: [model.name, "youku", "qq", "iqiyi", "bilibili"],
      ijk: [],
      ads: [],
    };
    downloadFile(`tvbox_${model.name}.json`, JSON.stringify(cfg, null, 2), "application/json");
  }, [model, downloadFile]);

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={header}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>🧬 SiteModel 编辑器</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {spiderResult.ok ? `${spiderResult.bytes.toLocaleString()} bytes` : `❌ ${spiderResult.error}`}
            </span>
            {copiedMsg && <span style={{ fontSize: 11, color: "#16a34a" }}>{copiedMsg}</span>}
            <button onClick={onClose} style={btnGhost}>✕</button>
          </div>
        </div>

        {/* 工具条 */}
        <div style={toolbar}>
          <button
            onClick={doInfer}
            disabled={!capturedXhrs?.length}
            style={{ ...btnPrimary, background: capturedXhrs?.length ? "#059669" : "#9ca3af" }}
            title={capturedXhrs?.length ? `从 ${capturedXhrs.length} 条抓包自动推理 SiteModel` : "还没有抓到 XHR"}
          >
            ✨ 从抓包推理 {capturedXhrs?.length ? `(${capturedXhrs.length})` : ""}
          </button>
          <select onChange={(e) => loadTemplate(e.target.value)} style={select} defaultValue="">
            <option value="" disabled>加载模板...</option>
            <option value="aiyifan">爱壹帆 (aiyifan) — 双模签名 + bootstrap</option>
            <option value="blank">空白站点</option>
          </select>
          <button
            onClick={() => setMode(mode === "form" ? "json" : "form")}
            style={btnSecondary}
          >
            {mode === "form" ? "📝 JSON 模式" : "📋 表单模式"}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={() => setShowPreview(!showPreview)} style={btnSecondary}>
            👀 {showPreview ? "隐藏" : "预览"} Spider
          </button>
          <button onClick={downloadSpider} disabled={!spiderResult.ok} style={btnPrimary}>
            💾 spider.js
          </button>
          <button onClick={downloadTvboxConfig} style={btnPrimary}>
            💾 tvbox.json
          </button>
        </div>

        {/* 推理提示条 */}
        {inferHints.length > 0 && (
          <div style={{ background: "#f0fdf4", borderBottom: "1px solid #86efac", padding: "8px 12px", fontSize: 11, color: "#166534" }}>
            <b>💡 推理结果：</b>
            {inferHints.map((h, i) => (
              <div key={i} style={{ padding: "2px 0" }}>{h}</div>
            ))}
          </div>
        )}

        <div style={contentArea}>
          {/* 左侧: 编辑区 */}
          <div style={{ flex: 1, overflowY: "auto", padding: 12, borderRight: "1px solid #e5e7eb" }}>
            {mode === "json" ? (
              <JsonEditor value={jsonText} onChange={applyJsonEdit} error={jsonError} />
            ) : (
              <FormEditor
                model={model}
                onChange={(m) => {
                  setModel(m);
                  setJsonText(JSON.stringify(m, null, 2));
                }}
                onVerifyMode={(idx) => setShowVerifier(idx)}
              />
            )}
          </div>

          {/* 右侧: spider 预览 */}
          {showPreview && (
            <div style={{ width: 400, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: 8, fontSize: 11, color: "#6b7280", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between" }}>
                <span>生成的 spider.js</span>
                {spiderResult.ok && (
                  <button onClick={() => copyToClipboard(spiderResult.src, "spider 已复制")} style={btnGhost}>
                    📋
                  </button>
                )}
              </div>
              <pre style={preview}>
                {spiderResult.ok ? spiderResult.src : `❌ ${spiderResult.error}`}
              </pre>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div style={footer}>
          <span style={{ fontSize: 11, color: "#6b7280" }}>
            提示: 加载 aiyifan 模板可直接生成可用 spider; 空白模板从零开始配置站点
          </span>
        </div>

        {/* 签名验证器模态 */}
        {showVerifier !== null && model.signing?.modes[showVerifier] && (
          <SignVerifierPanel
            mode={model.signing.modes[showVerifier]}
            onClose={() => setShowVerifier(null)}
          />
        )}
      </div>
    </div>
  );
}

// ============ 表单编辑器 ============

function FormEditor({
  model,
  onChange,
  onVerifyMode,
}: {
  model: SiteModel;
  onChange: (m: SiteModel) => void;
  onVerifyMode: (idx: number) => void;
}) {
  const update = (patch: Partial<SiteModel>) => onChange({ ...model, ...patch });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Section title="📌 基本信息">
        <Row label="内部名 (name)">
          <input value={model.name} onChange={(e) => update({ name: e.target.value })} style={input} />
        </Row>
        <Row label="显示名">
          <input value={model.display_name} onChange={(e) => update({ display_name: e.target.value })} style={input} />
        </Row>
        <Row label="站点 URL">
          <input value={model.site_url} onChange={(e) => update({ site_url: e.target.value })} style={input} />
        </Row>
        <Row label="Base URLs">
          <textarea
            value={JSON.stringify(model.bases, null, 2)}
            onChange={(e) => {
              try { update({ bases: JSON.parse(e.target.value) }); } catch {}
            }}
            style={{ ...input, minHeight: 60, fontFamily: "monospace", fontSize: 11 }}
          />
        </Row>
      </Section>

      <Section title={`🔐 签名模式 (${model.signing?.modes.length || 0})`}>
        {model.signing?.modes.map((mode, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <b style={{ fontSize: 13 }}>{mode.name}</b>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => onVerifyMode(i)} style={btnGhost} title="用真实抓包样本验证">
                  🔍 验证
                </button>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>算法: {mode.algorithm}</div>
            <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
              formula: {mode.formula}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
              vars: {Object.entries(mode.vars).map(([k, v]) => `${k}=${(v as any).kind}`).join(", ")}
            </div>
          </div>
        )) || <div style={emptyState}>无签名 (无需签名的站点)</div>}
        <div style={{ fontSize: 11, color: "#6b7280", padding: 4 }}>
          💡 修改签名: 切到 JSON 模式编辑; 或用抓包辅助 (阶段 2)
        </div>
      </Section>

      <Section title={`🌐 端点 (${model.endpoints.length})`}>
        {model.endpoints.map((ep, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <b style={{ fontSize: 13 }}>{ep.name}</b>
              <span style={{ fontSize: 10, background: "#e5e7eb", padding: "1px 6px", borderRadius: 3 }}>
                {ep.sign_mode}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
              {ep.base}/{ep.path}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
              ?{ep.query}
            </div>
          </div>
        ))}
      </Section>

      <Section title="🗂 字段映射">
        {Object.entries(model.mappings).map(([k, v]) => (
          <Row key={k} label={k}>
            <input
              value={Array.isArray(v) ? v.join(", ") : v || ""}
              onChange={(e) => {
                const val = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                update({ mappings: { ...model.mappings, [k]: val.length > 1 ? val : val[0] || "" } as any });
              }}
              style={input}
            />
          </Row>
        ))}
      </Section>

      <Section title={`🏷 分类 (${model.categories.length})`}>
        {model.categories.map((c, i) => (
          <div key={i} style={{ ...cardStyle, display: "flex", justifyContent: "space-between" }}>
            <div>
              <b>{c.name}</b>
              <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>({c.id})</span>
            </div>
            <span style={{ fontSize: 10, background: "#e5e7eb", padding: "1px 6px", borderRadius: 3 }}>
              {c.kind}
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ============ JSON 编辑器 ============

function JsonEditor({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string }) {
  return (
    <div>
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 6, fontSize: 11, borderRadius: 4, marginBottom: 6 }}>
          ⚠️ {error}
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%",
          minHeight: 500,
          fontFamily: "monospace",
          fontSize: 11,
          padding: 8,
          border: "1px solid #d1d5db",
          borderRadius: 4,
          resize: "vertical",
        }}
      />
    </div>
  );
}

// ============ 小组件 ============

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#f9fafb", padding: 8, borderRadius: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 90, fontSize: 11, color: "#6b7280" }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ============ 样式 ============
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const panel: React.CSSProperties = {
  background: "#fff", borderRadius: 8, width: "95%", height: "90%",
  display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};
const header: React.CSSProperties = {
  padding: "10px 14px", borderBottom: "1px solid #e5e7eb",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};
const toolbar: React.CSSProperties = {
  padding: 10, borderBottom: "1px solid #e5e7eb", display: "flex", gap: 8, alignItems: "center", background: "#fafafa",
};
const contentArea: React.CSSProperties = { flex: 1, display: "flex", overflow: "hidden" };
const footer: React.CSSProperties = { padding: 8, borderTop: "1px solid #e5e7eb", background: "#fafafa" };
const preview: React.CSSProperties = {
  flex: 1, margin: 0, padding: 8, fontSize: 10, fontFamily: "monospace",
  overflow: "auto", background: "#1e293b", color: "#e2e8f0", whiteSpace: "pre-wrap",
};
const input: React.CSSProperties = {
  width: "100%", padding: 4, fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box",
};
const select: React.CSSProperties = { ...input, width: "auto" };
const btnPrimary: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer",
};
const btnGhost: React.CSSProperties = {
  padding: "3px 8px", fontSize: 12, background: "transparent", border: "none", cursor: "pointer", color: "#6b7280",
};
const cardStyle: React.CSSProperties = {
  background: "#fff", border: "1px solid #e5e7eb", padding: 8, borderRadius: 4,
};
const emptyState: React.CSSProperties = {
  padding: 8, fontSize: 11, color: "#9ca3af", textAlign: "center", fontStyle: "italic",
};
