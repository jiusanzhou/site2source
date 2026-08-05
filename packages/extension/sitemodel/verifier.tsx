/**
 * 签名验证器 UI — 让用户粘贴抓包 URL, 立即校验签名公式
 *
 * ## 使用场景
 * 1. 用户逆完签名, 想确认公式对不对 → 贴 10 组 URL
 * 2. 部分通过时 → 看诊断 → 修密钥表 / 索引式
 * 3. 全绿 → 收工, 保存 SignMode
 *
 * ## 输入格式
 * 每行一个 URL, 例:
 *   https://m10.aiyifan.tv/v3/home/getAllVideo?cinema=1&page=1&size=10&region=SG&vv=xxx&pub=yyy
 *
 * 支持自定义 vv/pub 参数名 (默认 vv/pub)
 */

import { useState, useMemo } from "react";
import { verifySignMode, parseSampleFromUrl, type SignSample } from "~lib/sign-verifier";
import type { SignMode } from "~lib/site-model";

interface Props {
  mode: SignMode;
  onClose: () => void;
}

export function SignVerifierPanel({ mode, onClose }: Props) {
  const [urlsText, setUrlsText] = useState("");
  const [vvKey, setVvKey] = useState("vv");
  const [pubKey, setPubKey] = useState("pub");
  const [bootstrapJson, setBootstrapJson] = useState(""); // cert 模式用
  const [result, setResult] = useState<ReturnType<typeof verifySignMode> | null>(null);

  const needsBootstrap = useMemo(() => {
    return Object.values(mode.vars).some((v: any) => v.kind === "bootstrap");
  }, [mode]);

  const doVerify = () => {
    const lines = urlsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const samples: SignSample[] = [];
    let bootstrap: Record<string, any> | undefined;
    if (needsBootstrap && bootstrapJson.trim()) {
      try {
        bootstrap = JSON.parse(bootstrapJson);
      } catch (e) {
        alert("Bootstrap JSON 解析失败: " + (e as any).message);
        return;
      }
    }
    for (const line of lines) {
      const s = parseSampleFromUrl(line, vvKey, pubKey);
      if (s) {
        if (bootstrap) s.bootstrap = bootstrap;
        samples.push(s);
      }
    }
    if (!samples.length) {
      alert(`没有解析出任何样本 (检查 vvKey="${vvKey}" pubKey="${pubKey}" 是否正确)`);
      return;
    }
    const r = verifySignMode(mode, samples);
    setResult(r);
  };

  const rateColor = result
    ? result.pass_rate === 1
      ? "#16a34a"
      : result.pass_rate > 0
        ? "#eab308"
        : "#dc2626"
    : "#6b7280";

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>🔍 签名验证器</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              模式: <b>{mode.name}</b> · 算法: {mode.algorithm} · formula: <code>{mode.formula}</code>
            </div>
          </div>
          <button onClick={onClose} style={btnGhost}>✕</button>
        </div>

        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1 }}>
          {/* 使用说明 */}
          <div style={hint}>
            💡 <b>怎么用</b>: 在浏览器 DevTools 抓 10-20 条真实请求, 复制 URL (含 vv/pub 参数) 粘贴下面。
            全绿说明公式正确; 部分通过看诊断修正密钥表或索引式。
          </div>

          {/* 参数名配置 */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label style={label}>签名参数名:</label>
            <input value={vvKey} onChange={(e) => setVvKey(e.target.value)} style={{ ...input, width: 80 }} placeholder="vv" />
            <label style={label}>pub 参数名:</label>
            <input value={pubKey} onChange={(e) => setPubKey(e.target.value)} style={{ ...input, width: 80 }} placeholder="pub" />
          </div>

          {/* Bootstrap 上下文 (cert 模式) */}
          {needsBootstrap && (
            <div>
              <label style={label}>Bootstrap 上下文 (kind:bootstrap 需要):</label>
              <textarea
                value={bootstrapJson}
                onChange={(e) => setBootstrapJson(e.target.value)}
                placeholder='{"publicKey":"CJSuDJ...","privateKey":["SuDJJSuDJOoDp4pD..."]}'
                style={{ ...input, minHeight: 60, fontFamily: "monospace", fontSize: 11 }}
              />
            </div>
          )}

          {/* URL 输入区 */}
          <div>
            <label style={label}>抓包 URL 列表 (每行一个):</label>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder="https://api.example.com/list?page=1&size=10&vv=xxx&pub=yyy"
              spellCheck={false}
              style={{ ...input, minHeight: 150, fontFamily: "monospace", fontSize: 11 }}
            />
          </div>

          <button onClick={doVerify} style={btnPrimary}>
            🔍 开始验证
          </button>

          {/* 结果展示 */}
          {result && (
            <div style={resultCard}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: rateColor }}>
                  {(result.pass_rate * 100).toFixed(0)}%
                </div>
                <div style={{ fontSize: 13 }}>
                  <b>{result.passed}</b> / {result.total} 通过
                </div>
                {result.pass_rate === 1 && (
                  <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
                    ✅ 完美
                  </span>
                )}
              </div>

              {/* 诊断信息 */}
              <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>📋 诊断:</div>
                {result.diagnostics.map((d, i) => (
                  <div key={i} style={{ fontSize: 11, padding: "3px 0", color: "#374151" }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* 失败样本详情 */}
              {result.failures.length > 0 && (
                <details style={{ marginTop: 8, borderTop: "1px solid #e5e7eb", paddingTop: 8 }}>
                  <summary style={{ fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    ❌ 失败样本 ({result.failures.length})
                  </summary>
                  <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 10, fontFamily: "monospace", marginTop: 6 }}>
                    {result.failures.slice(0, 10).map((f, i) => (
                      <div key={i} style={{ padding: 4, borderBottom: "1px dashed #e5e7eb" }}>
                        <div>
                          <span style={{ color: "#6b7280" }}>pub</span>=<code>{f.sample.expected_pub}</code>
                        </div>
                        <div>
                          <span style={{ color: "#16a34a" }}>期望 vv</span>: {f.sample.expected_sign}
                        </div>
                        <div>
                          <span style={{ color: "#dc2626" }}>算出 vv</span>: {f.got_sign}
                        </div>
                      </div>
                    ))}
                    {result.failures.length > 10 && (
                      <div style={{ padding: 4, color: "#6b7280" }}>... 还有 {result.failures.length - 10} 条</div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ 样式 ============
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10001,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const panel: React.CSSProperties = {
  background: "#fff", borderRadius: 8, width: "85%", maxWidth: 800, maxHeight: "90%",
  display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};
const header: React.CSSProperties = {
  padding: "10px 14px", borderBottom: "1px solid #e5e7eb",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: "#374151", display: "block", marginBottom: 4 };
const input: React.CSSProperties = {
  padding: 5, fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, width: "100%", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  padding: "6px 12px", fontSize: 13, background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", alignSelf: "flex-start",
};
const btnGhost: React.CSSProperties = {
  padding: "3px 8px", fontSize: 14, background: "transparent", border: "none", cursor: "pointer", color: "#6b7280",
};
const hint: React.CSSProperties = {
  background: "#eff6ff", border: "1px solid #bfdbfe", padding: 8, borderRadius: 4, fontSize: 11, color: "#1e40af",
};
const resultCard: React.CSSProperties = {
  background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: 12,
};
