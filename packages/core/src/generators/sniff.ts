/**
 * 嗅探型 spider 生成器
 *
 * 适用场景：SPA 站 + API 带签名（逆向不划算）
 *   - 分类列表：走前端路由页面 URL，drpy 加载页面后用 CSS selector 抓卡片
 *     （注意：纯 CSR 站这一步也会失败，此时只能靠搜索入口）
 *   - 搜索：前端路由 /search/{wd}
 *   - 播放：页面 URL 交给 drpy 嗅探视频流
 *
 * 相比 API 型的取舍：
 *   ✅ 不依赖签名，站点改算法也不会失效
 *   ✅ 播放能用（嗅探对加密流也有效）
 *   ❌ 拿不到剧集列表（只能播入口那一集）
 *   ❌ 纯 CSR 站的分类页抓不到卡片（HTML 是空壳）
 */

import type { CapturedMedia } from "./messages";

export interface SniffSpiderInput {
  siteName: string;
  host: string;
  /** 分类：name + 前端路由路径（如 /list/drama） */
  categories: { name: string; url: string }[];
  /** 分类页里卡片的 CSS selector（drpy 一级规则用） */
  listSelector?: string;
  /** 搜索前端路由模板，{wd} 占位 */
  searchRoute?: string;
  /** 搜索结果页卡片 selector */
  searchListSelector?: string;
  /** 详情/播放页路由模板，{id} 占位 */
  playRoute?: string;
  /** 抓到的媒体流，用来给嗅探加 host 提示 */
  media?: CapturedMedia[];
  /** 站点是纯 CSR（HTML 空壳）吗？是的话在注释里警告 */
  isPureCSR?: boolean;
}

function esc(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
}

/** 从抓到的媒体流里提取视频 CDN host，给嗅探当过滤条件 */
function extractSniffHosts(media: CapturedMedia[] = []): string[] {
  const hosts = new Set<string>();
  for (const m of media) {
    if (!m.url) continue;
    // 只要 m3u8/mp4/flv，ts 分片的 host 一样就不重复加
    if (!/\.(m3u8|mp4|flv|mpd)(\?|$)/i.test(m.url)) continue;
    try {
      hosts.add(new URL(m.url).host);
    } catch {}
  }
  return Array.from(hosts);
}

export function generateSniffSpider(input: SniffSpiderInput): string {
  const L: string[] = [];
  const sniffHosts = extractSniffHosts(input.media);

  L.push(`// site2source-ext 生成的嗅探型 Drpy T4 spider`);
  L.push(`// Site: ${input.host}`);
  L.push(`// Generated: ${new Date().toISOString()}`);
  L.push(`//`);
  L.push(`// 【为什么是嗅探型】`);
  L.push(`// 本站 API 带一次性签名（vv/pub 之类），spider 无法生成 → API 型不可用。`);
  L.push(`// 改用前端路由 + drpy 嗅探：加载页面，从网络请求里捞视频流。`);
  L.push(`//`);
  L.push(`// 【已知限制】`);
  L.push(`// - 拿不到剧集列表，只能播入口那一集`);
  if (input.isPureCSR) {
    L.push(`// - ⚠️ 本站是纯 CSR（HTML 空壳），分类页 selector 大概率抓不到卡片。`);
    L.push(`//   如果一级列表为空，说明 drpy 拿到的是未渲染的 HTML —— 此时只有搜索能用。`);
  }
  if (sniffHosts.length) {
    L.push(`//`);
    L.push(`// 视频 CDN: ${sniffHosts.join(", ")}`);
  }
  L.push(``);

  const cats = input.categories.length
    ? input.categories
    : [{ name: "首页", url: "/" }];

  // class_url 里的 & 会被 drpy 当分隔符切开 —— 带 query 的分类路由必须编码，
  // 否则 "/list/drama?region=香港" 里如果有第二个参数就会被切成两个分类。
  // 这里只处理 & ；单个 ? 是安全的。
  const safeCats = cats.map((c) => {
    if (c.url.includes("&")) {
      return { ...c, url: c.url.replace(/&/g, "%26") };
    }
    return c;
  });
  const hasQueryCats = cats.some((c) => c.url.includes("?"));

  L.push(`var rule = {`);
  L.push(`  title: '${esc(input.siteName)}',`);
  const hostVal = /^https?:\/\//i.test(input.host) ? input.host : `https://${input.host}`;
  L.push(`  host: '${esc(hostVal)}',`);
  L.push(`  homeUrl: '/',`);
  // url 直接用分类路由，fyclass 会被 class_url 的值替换
  L.push(`  url: 'fyclass',`);
  L.push(`  class_name: '${safeCats.map((c) => esc(c.name)).join("&")}',`);
  L.push(`  class_url: '${safeCats.map((c) => esc(c.url)).join("&")}',`);
  if (hasQueryCats) {
    L.push(`  // ↑ 部分分类路由带 query（?region=xxx）。若翻页异常，检查 drpy 拼 fypage 时`);
    L.push(`  //   是用 ? 还是 & —— 带 query 的分类需要 & 拼接。`);
  }
  if (input.searchRoute) {
    L.push(`  searchUrl: '${esc(input.searchRoute.replace(/\{wd\}/g, "**"))}',`);
    L.push(`  searchable: 1,`);
    L.push(`  quickSearch: 1,`);
  } else {
    L.push(`  searchUrl: '',`);
    L.push(`  searchable: 0,`);
    L.push(`  quickSearch: 0,`);
  }
  L.push(`  filterable: 0,`);
  L.push(`  headers: {`);
  L.push(`    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',`);
  L.push(`    'Referer': '${esc(hostVal)}/'`);
  L.push(`  },`);
  L.push(`  timeout: 8000,`);
  L.push(`  play_parse: true,`);
  L.push(``);

  // 一级
  if (input.listSelector) {
    const sel = input.listSelector.replace(/'/g, '"');
    L.push(`  // 一级列表（CSR 站可能抓不到 —— 见文件头警告）`);
    L.push(`  一级: '${sel};*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|text;a&&href',`);
  } else {
    L.push(`  一级: '*',   // TODO: 未识别到列表 selector`);
  }
  L.push(``);

  // 搜索
  if (input.searchListSelector) {
    const sel = input.searchListSelector.replace(/'/g, '"');
    L.push(`  // 搜索（前端路由，结果页 selector 从真实搜索页学到）`);
    L.push(`  搜索: '${sel};*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|text;a&&href',`);
    L.push(``);
  }

  // 二级：不解析详情，直接把页面 URL 当播放源
  L.push(`  // 二级：不解析详情（详情 API 带签名），页面 URL 直接当播放源`);
  L.push(`  二级: async function(ids) {`);
  L.push(`    let id = ids[0];`);
  L.push(`    // id 可能是相对路径，补全成绝对 URL`);
  L.push(`    let pageUrl = id.startsWith('http') ? id : (rule.host + (id.startsWith('/') ? '' : '/') + id);`);
  L.push(`    return {`);
  L.push(`      vod_id: id,`);
  L.push(`      vod_play_from: '嗅探',`);
  L.push(`      vod_play_url: '正片$' + pageUrl,`);
  L.push(`    };`);
  L.push(`  },`);
  L.push(``);

  // lazy：交给嗅探，带 host 过滤
  L.push(`  // 播放：交给 drpy 嗅探（对加密流也有效）`);
  L.push(`  lazy: async function(flag, id, flags) {`);
  L.push(`    // 先试着从页面 HTML 里直接找 m3u8/mp4（有些站服务端渲染了播放地址）`);
  L.push(`    try {`);
  L.push(`      let html = await request(id);`);
  L.push(`      let m = html.match(/https?:\\/\\/[^"'\\s\\\\]+?\\.(?:m3u8|mp4)[^"'\\s\\\\]*/i);`);
  L.push(`      if (m) {`);
  L.push(`        return { parse: 0, url: m[0].replace(/\\\\\\//g, '/'), header: { 'Referer': rule.host + '/' } };`);
  L.push(`      }`);
  L.push(`    } catch (e) {`);
  L.push(`      log('[s2s] lazy 拉页面失败: ' + e.message);`);
  L.push(`    }`);
  L.push(`    // 兜底：让 drpy 打开页面嗅探网络请求`);
  if (sniffHosts.length) {
    L.push(`    return {`);
    L.push(`      parse: 1,`);
    L.push(`      url: id,`);
    L.push(`      sniffer: 1,`);
    L.push(`      sniffCustomRegex: '${esc(sniffHosts.join("|"))}',   // 已知视频 CDN`);
    L.push(`      header: { 'Referer': rule.host + '/' },`);
    L.push(`    };`);
  } else {
    L.push(`    return { parse: 1, url: id, sniffer: 1, header: { 'Referer': rule.host + '/' } };`);
  }
  L.push(`  },`);
  L.push(`}`);

  return L.join("\n");
}
