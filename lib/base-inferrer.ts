/**
 * Base URL 推断器
 *
 * 从当前页面的 DOM 抓样本，统计各来源的 host 频率，投票选出：
 *   - 页面 base（location.origin）
 *   - 链接 base（<a href> 的 host）
 *   - 图片 base（<img src> 的 host）
 */

import type { BaseInfo } from "./messages";

interface HostCount {
  host: string;
  count: number;
  sample?: string;
}

function tallyHosts(urls: string[]): HostCount[] {
  const map = new Map<string, HostCount>();
  for (const u of urls) {
    if (!u) continue;
    try {
      const parsed = new URL(u, location.href);
      // 只统计 http/https
      if (!/^https?:$/.test(parsed.protocol)) continue;
      const host = parsed.origin;
      const cur = map.get(host);
      if (cur) cur.count++;
      else map.set(host, { host, count: 1, sample: u });
    } catch {
      /* skip */
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

/**
 * 从一个已选好的列表容器里，抓所有列表项里的 <a href> 和 <img src>，
 * 分别统计 host 频次，选出出现次数最多的。
 *
 * @param listRoot 列表容器元素（如果没传，会全局扫描）
 */
export function inferBaseInfo(listRoot?: Element | null): BaseInfo {
  const pageBase = location.origin;

  const root: ParentNode = listRoot || document;

  // 收集所有链接和图片
  const anchors = Array.from(root.querySelectorAll("a[href]")) as HTMLAnchorElement[];
  const imgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];

  const linkURLs = anchors
    .map((a) => a.getAttribute("href") || "")
    .filter((h) => h && !h.startsWith("#") && !h.startsWith("javascript:"));

  const imgURLs = imgs
    .map(
      (i) =>
        i.getAttribute("src") ||
        i.getAttribute("data-src") ||
        i.getAttribute("data-original") ||
        i.getAttribute("data-lazy-src") ||
        ""
    )
    .filter(Boolean);

  const linkStats = tallyHosts(linkURLs);
  const imgStats = tallyHosts(imgURLs);

  const info: BaseInfo = {
    pageBase,
    stats: {
      links: linkStats.slice(0, 5),
      imgs: imgStats.slice(0, 5),
    },
  };

  if (linkStats.length > 0) info.linkBase = linkStats[0].host;
  if (imgStats.length > 0) info.imgBase = imgStats[0].host;

  return info;
}

/**
 * 决定 Drpy `host` 字段最终用哪个 URL。
 *
 * 优先级：
 *   1. 用户手工 override
 *   2. 详情页链接 base（listSamples 里 URL 的 host）——最重要，因为 host 主要用来补全详情页 URL
 *   3. 列表页链接 base（linkBase）
 *   4. 页面 base
 */
export function resolveHost(info: BaseInfo, sampleURLs?: string[]): string {
  if (info.overrideBase) return info.overrideBase;

  if (sampleURLs && sampleURLs.length > 0) {
    const stats = tallyHosts(sampleURLs);
    if (stats.length > 0) return stats[0].host;
  }

  return info.linkBase || info.pageBase;
}

/** 用来判断多个 base 是否显著不同（需要提醒用户） */
export function hasHostMismatch(info: BaseInfo): boolean {
  const set = new Set<string>();
  set.add(info.pageBase);
  if (info.linkBase) set.add(info.linkBase);
  if (info.imgBase) set.add(info.imgBase);
  return set.size > 1;
}
