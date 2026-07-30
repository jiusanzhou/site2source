/**
 * Side Panel 版 UI —— 100% 复用 popup 的组件.
 * 相对 popup 的优势: 点页面不会关闭, 手动点选元素时体验流畅.
 */

import Popup from "./popup";

export default function SidePanel() {
  return (
    <div className="s2s-sidepanel-root">
      <div className="s2s-sidepanel-hint">
        📌 侧边栏模式 · 点击页面不会关闭
      </div>
      <Popup />
    </div>
  );
}
