/**
 * 底部动作条 (sticky)
 *   完成度 dots: 5 个 role, 已识别的显示 icon + 名字, 未识别的灰色
 *   [生成并预览] 主 CTA (随时可点)
 *   [重置] 二级操作
 */
import type { RoleName } from "./components";
import type { RoleStatus } from "./role-card";

const ROLE_ORDER: RoleName[] = ["home", "category", "search", "detail", "play"];
const ROLE_ICON: Record<RoleName, string> = {
  home: "🏠",
  category: "📂",
  search: "🔍",
  detail: "📄",
  play: "▶️",
};
const ROLE_LABEL: Record<RoleName, string> = {
  home: "首页",
  category: "分类",
  search: "搜索",
  detail: "详情",
  play: "播放",
};

export function ActionBar({
  progress,
  canGenerate,
  onGenerate,
  onReset,
  generating,
  onCardClick,
}: {
  progress: Record<RoleName, RoleStatus>;
  canGenerate: boolean;
  onGenerate: () => void;
  onReset: () => void;
  generating?: boolean;
  /** 点某个 dot 快速滚到 (或展开) 对应卡片 */
  onCardClick?: (role: RoleName) => void;
}) {
  return (
    <div className="s2s-action-bar">
      <div className="s2s-progress-dots" title="识别进度">
        {ROLE_ORDER.map((r) => {
          const st = progress[r];
          const cls = st === "ok" ? "ok" : st === "partial" ? "partial" : "empty";
          return (
            <button
              key={r}
              className={`s2s-dot ${cls}`}
              onClick={() => onCardClick?.(r)}
              title={`${ROLE_LABEL[r]}: ${st === "ok" ? "已识别" : st === "partial" ? "识别中" : "未识别"}`}
            >
              <span className="s2s-dot-icon">{ROLE_ICON[r]}</span>
            </button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <button
        className="s2s-btn s2s-btn-ghost s2s-btn-xs"
        onClick={() => {
          if (confirm("重置当前项目所有识别结果?")) onReset();
        }}
        title="清空当前项目状态"
      >
        🔄 重置
      </button>
      <button
        className="s2s-btn s2s-btn-primary"
        onClick={onGenerate}
        disabled={!canGenerate || generating}
        title={canGenerate ? "生成并预览爬虫" : "至少识别一个角色 (首页或详情) 才能生成"}
      >
        {generating ? "生成中..." : "🔍 生成并预览"}
      </button>
    </div>
  );
}
