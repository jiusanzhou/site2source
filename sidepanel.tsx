/**
 * Side Panel 版 UI —— 100% 复用 popup 的组件.
 * 相对 popup 的优势: 点页面不会关闭, 手动点选元素时体验流畅.
 */

import Popup from "./popup";

export default function SidePanel() {
  const switchBackToPopup = async () => {
    try {
      // 切回 popup 模式
      await chrome.runtime.sendMessage({
        type: "SET_UI_PREFERENCE",
        preferSidepanel: false,
      });
      // 关闭 sidepanel
      window.close();
    } catch (e) {
      alert("切回失败: " + (e as any).message);
    }
  };

  return (
    <div className="s2s-sidepanel-root">
      <div className="s2s-sidepanel-hint">
        <span>📌 侧边栏模式 · 点击页面不关</span>
        <button
          className="s2s-sidepanel-close"
          onClick={switchBackToPopup}
          title="切回轻量 popup 模式"
        >
          切回 popup ✕
        </button>
      </div>
      <Popup />
    </div>
  );
}
