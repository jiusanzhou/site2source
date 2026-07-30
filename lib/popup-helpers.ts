/**
 * popup 相关的纯工具函数（无 React 依赖）
 */
import type { OnePlusRuleResult, DetailRuleResult } from "~lib/rule-runner";

/** 发送消息到当前 active tab 的 content script; 失败自动兜底注入 */
export async function sendToActiveTab<T = any>(msg: any): Promise<T | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage<any, T>(tab.id, msg);
  } catch (e) {
    console.warn("[popup] sendMessage failed, injecting content script...", e);
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["inspector.js"],
      });
      return await chrome.tabs.sendMessage<any, T>(tab.id, msg);
    } catch (e2) {
      console.error("[popup] inject failed:", e2);
      return null;
    }
  }
}

/** 发送消息到 background service worker */
export async function sendToBackground<T = any>(msg: any): Promise<T | null> {
  try {
    return await chrome.runtime.sendMessage<any, T>(msg);
  } catch (e) {
    console.error("[popup] bg send failed:", e);
    return null;
  }
}

/** 让浏览器下载一段文本内容 */
export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/** URL 截断显示 */
export function shortURL(u: string, n = 40) {
  if (u.length <= n) return u;
  return u.slice(0, 20) + "..." + u.slice(-16);
}

/** 复制到剪贴板（静默失败） */
export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

/** mp4 直开新 tab, m3u8 复制到剪贴板 + 弹提示 */
export function openInPlayer(url: string) {
  const isMp4 = /\.(mp4|flv)(\?|$)/i.test(url);
  if (isMp4) {
    chrome.tabs.create({ url });
  } else {
    navigator.clipboard.writeText(url).then(() => {
      alert(
        "已复制 m3u8 URL 到剪贴板\n\n" +
        "试播方法：\n" +
        "• VLC: 媒体 → 打开网络串流 → 粘贴 URL\n" +
        "• Chrome: 装 'Native HLS Playback' 扩展\n" +
        "• 或者装到 TVBox 里直接跑生成的 spider"
      );
    });
  }
}

/** 分析一级规则试运行结果 */
export function summarizeTestResult(r: OnePlusRuleResult): string {
  if (!r.containerFound) return "❌ 容器都没找到，选择器可能不对";
  if (r.count === 0) return "⚠️ 容器找到了但里面没卡片";
  const withName = r.items.filter((i) => i.name).length;
  const withPic = r.items.filter((i) => i.pic).length;
  const withURL = r.items.filter((i) => i.url).length;
  const withRemarks = r.items.filter((i) => i.remarks).length;
  const parts: string[] = [];
  parts.push(`📝 标题 ${withName}/${r.count}`);
  parts.push(`🖼 图 ${withPic}/${r.count}`);
  parts.push(`🔗 链接 ${withURL}/${r.count}`);
  if (withRemarks > 0) parts.push(`🏷 备注 ${withRemarks}/${r.count}`);
  const perfect = withName === r.count && withPic === r.count && withURL === r.count;
  return (perfect ? "✅ " : "") + parts.join(" · ");
}

/** 详情页试运行诊断 */
export function summarizeDetail(r: DetailRuleResult): string {
  const parts: string[] = [];
  parts.push(r.title ? "✓ 标题" : "✗ 标题");
  parts.push(r.pic ? "✓ 图" : "✗ 图");
  parts.push(r.desc ? "✓ 简介" : "✗ 简介");
  const totalEp = r.playURL.reduce((sum, l) => sum + l.episodes.length, 0);
  parts.push(totalEp > 0 ? `✓ ${r.playURL.length} 线路 · ${totalEp} 集` : "✗ 无剧集");
  return parts.join(" · ");
}
