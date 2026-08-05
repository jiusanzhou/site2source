/**
 * Role 卡片 —— 5 个角色 (home/category/search/detail/play) 各一张.
 *
 * 顶部 (always visible): 图标 + name + status badge + 展开箭头
 * 展开时: 当前选择器 / 摘要 / 测试结果 / 操作按钮
 */
import type { ReactNode } from "react";
import type { RoleName } from "./components";

export type RoleStatus = "empty" | "partial" | "ok";

const ROLE_META: Record<RoleName, { icon: string; label: string; hint: string }> = {
  home: {
    icon: "🏠",
    label: "首页",
    hint: "识别列表容器 + 分类导航",
  },
  category: {
    icon: "📂",
    label: "分类",
    hint: "分类接口或 URL 模板",
  },
  search: {
    icon: "🔍",
    label: "搜索",
    hint: "搜索接口或表单",
  },
  detail: {
    icon: "📄",
    label: "详情",
    hint: "标题 / 简介 / 剧集列表",
  },
  play: {
    icon: "▶️",
    label: "播放",
    hint: "m3u8 / mp4 嗅探",
  },
};

const STATUS_META: Record<RoleStatus, { dot: string; label: string; cls: string }> = {
  empty: { dot: "🔴", label: "未识别", cls: "red" },
  partial: { dot: "🟡", label: "识别中", cls: "yellow" },
  ok: { dot: "🟢", label: "已识别", cls: "green" },
};

export function RoleCard({
  role,
  status,
  expanded,
  onToggle,
  summary,
  emptyHint,
  actions,
  children,
}: {
  role: RoleName;
  status: RoleStatus;
  expanded: boolean;
  onToggle: () => void;
  /** 折叠状态下的一行文案 */
  summary?: ReactNode;
  /** status=empty 时展开区顶部的醒目提示 */
  emptyHint?: ReactNode;
  /** 展开区底部操作按钮 (由外部按 role 组合) */
  actions?: ReactNode;
  /** 展开区自定义正文 (选择器 / 测试结果) */
  children?: ReactNode;
}) {
  const meta = ROLE_META[role];
  const st = STATUS_META[status];
  return (
    <div className={`s2s-role-card ${expanded ? "expanded" : ""} s2s-role-card-${role}`}>
      <div className="s2s-role-card-header" onClick={onToggle} role="button">
        <span className="s2s-role-icon">{meta.icon}</span>
        <div className="s2s-role-title-col">
          <div className="s2s-role-title">
            {meta.label}
            <span className={`s2s-status-badge ${st.cls}`}>
              {st.dot} {st.label}
            </span>
          </div>
          {summary ? (
            <div className="s2s-role-summary">{summary}</div>
          ) : (
            <div className="s2s-role-summary s2s-tip-dim">{meta.hint}</div>
          )}
        </div>
        <span className={`s2s-role-caret ${expanded ? "open" : ""}`}>▾</span>
      </div>
      {expanded && (
        <div className="s2s-role-card-body">
          {status === "empty" && emptyHint && (
            <div className="s2s-role-empty-hint">{emptyHint}</div>
          )}
          {children}
          {actions && <div className="s2s-actions s2s-role-actions">{actions}</div>}
        </div>
      )}
    </div>
  );
}
