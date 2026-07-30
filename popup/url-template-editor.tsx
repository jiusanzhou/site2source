/**
 * URL 模板编辑器
 * 生成 API 型爬虫前, 让用户确认/编辑 URL 里的占位符
 *   {cate}: 分类 id
 *   {page}: 页码
 *   {id}: 详情 id
 *   {wd}: 搜索关键词
 *
 * 自动识别的可能不对, 让用户手动改
 */

import { useState } from "react";

export interface TemplateConfig {
  homeURL: string;
  detailURL?: string;
  searchURL?: string;
  categories: { name: string; value: string }[];
}

export function URLTemplateEditor({
  initial,
  onOK,
  onCancel,
}: {
  initial: TemplateConfig;
  onOK: (cfg: TemplateConfig) => void;
  onCancel: () => void;
}) {
  const [home, setHome] = useState(initial.homeURL);
  const [detail, setDetail] = useState(initial.detailURL || "");
  const [search, setSearch] = useState(initial.searchURL || "");
  const [cats, setCats] = useState(initial.categories.length > 0 ? initial.categories : [
    { name: "电影", value: "1" },
    { name: "电视剧", value: "2" },
    { name: "综艺", value: "3" },
    { name: "动漫", value: "4" },
  ]);

  const preview = (t: string) =>
    t.replace(/\{cate\}/g, "1").replace(/\{page\}/g, "1").replace(/\{id\}/g, "xxxxx").replace(/\{wd\}/g, "复仇者");

  const highlight = (t: string) =>
    t
      .replace(/(\{cate\})/g, '<span class="s2s-var s2s-var-cate">$1</span>')
      .replace(/(\{page\})/g, '<span class="s2s-var s2s-var-page">$1</span>')
      .replace(/(\{id\})/g, '<span class="s2s-var s2s-var-id">$1</span>')
      .replace(/(\{wd\})/g, '<span class="s2s-var s2s-var-wd">$1</span>');

  return (
    <div className="s2s-modal-backdrop" onClick={onCancel}>
      <div className="s2s-modal s2s-modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="s2s-modal-header">
          <b>🔧 URL 模板确认</b>
          <button className="s2s-btn-mini" onClick={onCancel}>取消</button>
        </div>
        <div className="s2s-modal-body">
          <p className="s2s-tip s2s-tip-dim">
            扩展自动把抓到的 URL 里具体值换成了占位符。检查一下, 不对就手动改。
            <br />
            <b>占位符</b>: <code>&#123;cate&#125;</code>=分类 <code>&#123;page&#125;</code>=页码 <code>&#123;id&#125;</code>=详情 id <code>&#123;wd&#125;</code>=搜索关键词
          </p>

          <TemplateInput
            label="🏠 首页/分类 URL 模板"
            value={home}
            onChange={setHome}
            highlight={highlight}
            preview={preview(home)}
            hint="通常需要 {cate} 和 {page}"
          />

          {initial.detailURL !== undefined && (
            <TemplateInput
              label="📄 详情 URL 模板"
              value={detail}
              onChange={setDetail}
              highlight={highlight}
              preview={preview(detail)}
              hint="通常需要 {id}"
            />
          )}

          {initial.searchURL !== undefined && (
            <TemplateInput
              label="🔍 搜索 URL 模板"
              value={search}
              onChange={setSearch}
              highlight={highlight}
              preview={preview(search)}
              hint="通常需要 {wd}"
            />
          )}

          <div className="s2s-detail-row">
            <b>📁 分类列表:</b>
            <div className="s2s-cats-editor">
              {cats.map((c, i) => (
                <div key={i} className="s2s-cat-row">
                  <input
                    className="s2s-input s2s-input-inline"
                    placeholder="分类名"
                    value={c.name}
                    onChange={(e) => {
                      const next = [...cats];
                      next[i] = { ...c, name: e.target.value };
                      setCats(next);
                    }}
                    style={{ flex: 1 }}
                  />
                  <input
                    className="s2s-input s2s-input-inline"
                    placeholder="value ({cate} 值)"
                    value={c.value}
                    onChange={(e) => {
                      const next = [...cats];
                      next[i] = { ...c, value: e.target.value };
                      setCats(next);
                    }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="s2s-btn-mini"
                    onClick={() => setCats(cats.filter((_, j) => j !== i))}
                    title="删除"
                  >
                    🗑
                  </button>
                </div>
              ))}
              <button
                className="s2s-btn-mini"
                onClick={() => setCats([...cats, { name: "", value: "" }])}
              >
                ➕ 加分类
              </button>
            </div>
          </div>

          <div className="s2s-actions" style={{ marginTop: 12 }}>
            <button
              className="s2s-btn s2s-btn-primary"
              onClick={() =>
                onOK({
                  homeURL: home,
                  detailURL: initial.detailURL !== undefined ? detail : undefined,
                  searchURL: initial.searchURL !== undefined ? search : undefined,
                  categories: cats.filter((c) => c.name && c.value),
                })
              }
            >
              ✨ 生成爬虫
            </button>
            <button className="s2s-btn" onClick={onCancel}>取消</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateInput({
  label,
  value,
  onChange,
  highlight,
  preview,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight: (t: string) => string;
  preview: string;
  hint?: string;
}) {
  return (
    <div className="s2s-detail-row">
      <b>{label}</b>
      <input
        className="s2s-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: "monospace", fontSize: 11 }}
      />
      <div
        className="s2s-tip-dim"
        style={{ marginTop: 3, fontFamily: "monospace", fontSize: 10 }}
        dangerouslySetInnerHTML={{ __html: `示例请求: ${highlight(preview)}` }}
      />
      {hint && <div className="s2s-tip-dim" style={{ marginTop: 2 }}>💡 {hint}</div>}
    </div>
  );
}
