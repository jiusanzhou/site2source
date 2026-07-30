/**
 * Side Panel 版 UI —— 100% 复用 popup 的组件.
 * 相对 popup 的优势: 点页面不会关闭, 手动点选元素时体验流畅.
 */

import { useEffect, useState } from "react";
import Popup from "./popup";

export default function SidePanel() {
  const [currentHost, setCurrentHost] = useState<string>("");

  // 追踪当前活动 tab 的 host, 变化时提示 "站点已切换"
  useEffect(() => {
    const update = async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url || "";
        try {
          const h = new URL(url).host;
          setCurrentHost(h);
        } catch {
          setCurrentHost("");
        }
      } catch {}
    };
    update();
    const onActivated = () => update();
    const onUpdated = (_tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (info.status === "complete" || info.url) update();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

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
        <span title={currentHost}>
          📌 {currentHost ? shortHost(currentHost) : "侧边栏模式"}
        </span>
        <button
          className="s2s-sidepanel-close"
          onClick={switchBackToPopup}
          title="切回轻量 popup 模式"
        >
          切回 popup ✕
        </button>
      </div>
      <Popup key={currentHost /* host 变时强制 remount, 刷新 state */} />
    </div>
  );
}

function shortHost(h: string): string {
  return h.length > 30 ? h.slice(0, 27) + "..." : h;
}
