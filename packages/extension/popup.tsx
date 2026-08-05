/**
 * Popup: 极简信息展示卡
 *
 * 默认扩展是 side panel 模式, popup 仅在用户显式切换到 popup 模式时才用.
 * 只显示: 当前站点 / 抓包统计 / 最近项目, 主要操作按钮 "打开侧栏"
 */

import { useEffect, useState } from "react";
import type { CapturedMedia, ProjectState } from "~lib/messages";
import "./popup.css";

interface HostStat {
  host: string;
  xhrCount: number;
  mediaCount: number;
  encryptions: Record<string, number>;
}

export default function Popup() {
  const [host, setHost] = useState<string>("");
  const [tabURL, setTabURL] = useState<string>("");
  const [stat, setStat] = useState<HostStat | null>(null);
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const t = tabs[0];
        setTabURL(t?.url || "");
        try {
          setHost(new URL(t?.url || "").host);
        } catch {}

        // 抓包统计
        const all = await chrome.storage.local.get(["site2source:xhr", "site2source:media"]);
        const xhrMap = all["site2source:xhr"] || {};
        const mediaMap = all["site2source:media"] || {};
        const tabId = String(t?.id ?? "");
        const xhrs = xhrMap[tabId] || [];
        const media: CapturedMedia[] = mediaMap[tabId] || [];
        const encryptions: Record<string, number> = {};
        for (const m of media) {
          const enc = m.probe?.encryption ?? "?";
          encryptions[enc] = (encryptions[enc] || 0) + 1;
        }
        setStat({
          host: host,
          xhrCount: xhrs.length,
          mediaCount: media.length,
          encryptions,
        });

        // 最近项目
        const r = await chrome.runtime.sendMessage({ type: "LIST_PROJECTS" });
        setProjects((r?.projects || []).slice(0, 5));
      } catch (e) {
        console.warn("popup init", e);
      }
    })();
  }, []);

  const openSidePanel = async () => {
    try {
      const r = await chrome.runtime.sendMessage({
        type: "OPEN_SIDEPANEL",
        remember: false,
      });
      if (r?.ok) {
        window.close();
      } else {
        setMsg("打开失败: " + (r?.error || "unknown"));
      }
    } catch (e) {
      setMsg("打开失败: " + (e as Error).message);
    }
  };

  const alwaysSidepanel = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "SET_UI_PREFERENCE",
        preferSidepanel: true,
      });
      await openSidePanel();
    } catch (e) {
      setMsg("切换失败: " + (e as Error).message);
    }
  };

  return (
    <div className="s2s-root">
      <div className="s2s-header">
        <span className="s2s-logo">🧭</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="s2s-title">Site2Source</div>
          <div className="s2s-sub" title={tabURL}>
            {host || "no active tab"}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 抓包统计卡 */}
        {stat && (
          <div className="s2s-info-card">
            <div className="s2s-info-row">
              <span className="s2s-info-label">XHR</span>
              <span className="s2s-info-value">{stat.xhrCount}</span>
            </div>
            <div className="s2s-info-row">
              <span className="s2s-info-label">媒体流</span>
              <span className="s2s-info-value">{stat.mediaCount}</span>
            </div>
            {stat.mediaCount > 0 && (
              <div className="s2s-info-row" style={{ flexWrap: "wrap", gap: 4 }}>
                <span className="s2s-info-label">加密</span>
                {Object.entries(stat.encryptions).map(([enc, n]) => (
                  <EncBadge key={enc} enc={enc} count={n} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 主 CTA */}
        <button className="s2s-btn s2s-btn-primary" onClick={openSidePanel}>
          打开侧栏工作台 →
        </button>

        {/* 最近项目 */}
        {projects.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--s2s-muted)", marginBottom: 6 }}>
              最近项目
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {projects.map((p) => (
                <div
                  key={p.site?.host}
                  className="s2s-project-mini"
                  title={p.site?.host}
                >
                  <span className="s2s-project-mini-host">{p.site?.host}</span>
                  <span className="s2s-project-mini-meta">
                    {p.site?.title?.slice(0, 20) || ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {msg && <div className="s2s-alert-warn">{msg}</div>}

        {/* 底部辅助操作 */}
        <div style={{ display: "flex", gap: 6, borderTop: "1px solid var(--s2s-border)", paddingTop: 10 }}>
          <button
            className="s2s-btn s2s-btn-ghost"
            style={{ flex: 1, fontSize: 12 }}
            onClick={alwaysSidepanel}
            title="设为默认: 点扩展图标直接开侧栏"
          >
            默认打开侧栏
          </button>
          <button
            className="s2s-btn s2s-btn-ghost"
            style={{ flex: 1, fontSize: 12 }}
            onClick={() => chrome.runtime.openOptionsPage?.() || openSidePanel()}
          >
            设置
          </button>
        </div>
      </div>
    </div>
  );
}

function EncBadge({ enc, count }: { enc: string; count: number }) {
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
    "none": "无加密",
    "aes-128": "AES",
    "sample-aes": "SAE",
    "widevine": "WV",
    "playready": "PR",
    "custom": "自定义",
    "unknown": "未知",
    "?": "待探测",
  };
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 3,
        background: colors[enc] || "#71717a",
        color: "#fff",
      }}
      title={enc}
    >
      {labels[enc] || enc} {count > 1 ? `×${count}` : ""}
    </span>
  );
}
