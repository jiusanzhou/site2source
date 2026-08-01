/**
 * v0.22 生成结果预览 Drawer.
 * 从 v0.21 workbench 的 step="preview" 抽出来, 变成独立模态.
 */
import { useState } from "react";
import type { CapturedMedia, ProjectState } from "~lib/messages";
import { copyToClipboard } from "~lib/popup-helpers";

export interface PreviewArtifact {
  spider: string;
  spiderName: string;
  tvbox: string;
}

export function PreviewDrawer({
  artifact,
  state,
  media,
  uploadStatus,
  onDownload,
  onUpload,
  onClose,
}: {
  artifact: PreviewArtifact;
  state: ProjectState;
  media: CapturedMedia[];
  uploadStatus: {
    loading: boolean;
    result?: { ok: boolean; spiderURL?: string; gistURL?: string; error?: string };
  };
  onDownload: () => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"spider" | "tvbox" | "meta">("spider");
  const [copied, setCopied] = useState(false);

  const copyCurrent = () => {
    const t =
      tab === "spider"
        ? artifact.spider
        : tab === "tvbox"
          ? artifact.tvbox
          : JSON.stringify(
              { site: state.site, list: state.listSelector, detail: state.detail, media },
              null,
              2,
            );
    copyToClipboard(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="s2s-modal-backdrop" onClick={onClose}>
      <div
        className="s2s-modal s2s-drawer s2s-preview-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="s2s-modal-header">
          <b>🔍 生成结果预览</b>
          <span className="s2s-tip-dim" style={{ fontSize: 11 }}>
            过一遍再下载或发布
          </span>
          <button className="s2s-btn-mini" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="s2s-modal-body">
          {/* Meta 概览 */}
          <div className="s2s-preview-meta">
            <div className="s2s-meta-row">
              <span className="s2s-meta-label">Spider</span>
              <code className="s2s-meta-value">{artifact.spiderName}</code>
              <span className="s2s-meta-badge">
                {(artifact.spider.length / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="s2s-meta-row">
              <span className="s2s-meta-label">TVBox 配置</span>
              <code className="s2s-meta-value">tvbox.json</code>
              <span className="s2s-meta-badge">
                {(artifact.tvbox.length / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="s2s-meta-row">
              <span className="s2s-meta-label">站点</span>
              <code className="s2s-meta-value">{state.site?.host || "-"}</code>
            </div>
            {state.listSelector && (
              <div className="s2s-meta-row">
                <span className="s2s-meta-label">一级选择器</span>
                <code className="s2s-meta-value" title={state.listSelector}>
                  {state.listSelector.length > 60
                    ? state.listSelector.slice(0, 57) + "..."
                    : state.listSelector}
                </code>
              </div>
            )}
            {state.detail?.playListSelector && (
              <div className="s2s-meta-row">
                <span className="s2s-meta-label">播放选择器</span>
                <code className="s2s-meta-value" title={state.detail.playListSelector}>
                  {state.detail.playListSelector.length > 60
                    ? state.detail.playListSelector.slice(0, 57) + "..."
                    : state.detail.playListSelector}
                </code>
              </div>
            )}
          </div>

          {/* Tab 切换 */}
          <div className="s2s-preview-tabs">
            <button
              className={`s2s-preview-tab ${tab === "spider" ? "active" : ""}`}
              onClick={() => setTab("spider")}
            >
              spider.js
            </button>
            <button
              className={`s2s-preview-tab ${tab === "tvbox" ? "active" : ""}`}
              onClick={() => setTab("tvbox")}
            >
              tvbox.json
            </button>
            <button
              className={`s2s-preview-tab ${tab === "meta" ? "active" : ""}`}
              onClick={() => setTab("meta")}
            >
              抓包摘要
            </button>
            <button
              className="s2s-btn-mini"
              style={{ marginLeft: "auto" }}
              onClick={copyCurrent}
            >
              {copied ? "✅" : "复制"}
            </button>
          </div>

          {/* 内容 */}
          <div className="s2s-preview-body">
            {tab === "spider" && <pre className="s2s-code">{artifact.spider}</pre>}
            {tab === "tvbox" && <pre className="s2s-code">{artifact.tvbox}</pre>}
            {tab === "meta" && (
              <pre className="s2s-code">
                {JSON.stringify(
                  {
                    site: state.site,
                    listSelector: state.listSelector,
                    detail: state.detail,
                    home: state.home,
                    mediaCount: media.length,
                    mediaEncryption: media.reduce<Record<string, number>>((acc, m) => {
                      const k = m.probe?.encryption ?? "unknown";
                      acc[k] = (acc[k] || 0) + 1;
                      return acc;
                    }, {}),
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>

          {/* 操作 */}
          <div className="s2s-actions" style={{ marginTop: 12 }}>
            <button className="s2s-btn s2s-btn-ghost" onClick={onClose}>
              ← 回改
            </button>
            <button
              className="s2s-btn s2s-btn-ghost"
              style={{ flex: 1 }}
              onClick={onDownload}
            >
              💾 下载到本地
            </button>
            <button
              className="s2s-btn s2s-btn-primary"
              style={{ flex: 1 }}
              onClick={onUpload}
              disabled={uploadStatus.loading}
            >
              {uploadStatus.loading ? "上传中..." : "☁️ 传 Gist"}
            </button>
          </div>
          {uploadStatus.result && !uploadStatus.result.ok && (
            <div className="s2s-notice" style={{ marginTop: 8 }}>
              ❌ {uploadStatus.result.error}
            </div>
          )}
          {uploadStatus.result?.ok && uploadStatus.result.spiderURL && (
            <div className="s2s-notice" style={{ marginTop: 8 }}>
              ✅ 已上传:{" "}
              <a href={uploadStatus.result.spiderURL} target="_blank" rel="noreferrer">
                {uploadStatus.result.spiderURL}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
