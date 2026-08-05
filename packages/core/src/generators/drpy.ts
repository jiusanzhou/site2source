/**
 * Drpy T4 爬虫代码生成器（V0.3）
 */

import type {
  BaseInfo,
  CapturedMedia,
  DetailSpec,
  HomeSpec,
  SerializedSample,
} from "./messages";
import { resolveHost } from "./base-inferrer";

export interface GenerateInput {
  siteName: string;
  baseURL: string;
  host: string;

  // Base 推断（可选，如果没有就退回 baseURL）
  baseInfo?: BaseInfo;

  // 列表
  listSelector: string;
  itemSelector: string;
  cardCount: number;
  similarity: number;
  samples: SerializedSample[];

  // 详情（可选）
  detail?: DetailSpec;

  // 首页/分类（可选）
  home?: HomeSpec;

  // 抓到的媒体（可选）
  media?: CapturedMedia[];
}

export function generateDrpySpider(input: GenerateInput): string {
  const lines: string[] = [];
  lines.push(`// site2source-ext auto-generated Drpy T4 spider for ${input.host}`);
  lines.push(`// Generated: ${new Date().toISOString()}`);
  lines.push(`// Site: ${input.baseURL}`);
  lines.push("");

  const detail = input.detail || {};
  const home = input.home || {};
  const hasDetail = !!(detail.titleSelector || detail.playListSelector);
  const media = input.media || [];
  const hasMedia = media.length > 0;

  // 从 baseInfo + samples 里投票决定真实 host（详情页链接的 host 优先）
  const sampleURLs = input.samples.map((s) => s.url).filter(Boolean);
  const resolvedHost = input.baseInfo
    ? resolveHost(input.baseInfo, sampleURLs)
    : input.baseURL;

  // 分类
  const cats = home.categories || [];
  const className = cats.length > 0
    ? cats.map((c) => c.name).join("&")
    : "电影&电视剧&综艺&动漫";

  // 策略选择：
  // 1. 如果每个分类的 URL 都能被同一个 URL 模板匹配（如 /vodtype/{id}.html），
  //    就走"模板 + id"的 apple-cms 惯例
  // 2. 否则（aiyifan 这种多形态：/list/xx / /space/xx / /collection/xx 混杂），
  //    直接把完整路径塞进 class_url，url 模板设成 "fyclass" 让 drpy 直接用
  const catPaths = cats.map((c) => {
    try { return new URL(c.url, input.baseURL).pathname + (new URL(c.url, input.baseURL).search || ""); }
    catch { return c.url; }
  });
  const useDirectPath = shouldUseDirectPathStrategy(catPaths);

  let classURL: string;
  let urlPattern: string;
  if (useDirectPath && cats.length > 0) {
    // Direct-path 策略：class_url 存完整 path，url 模板就是 fyclass
    classURL = catPaths.join("&");
    // drpy 用 url 里的 fyclass 做纯文本替换，然后 host+url = 最终请求 URL
    // 不带查询参数，因为 aiyifan 分类页大多不支持翻页
    urlPattern = "fyclass";
  } else if (cats.length > 0) {
    // apple-cms 惯例
    classURL = cats.map((c, i) => extractClassId(c.url) || String(i + 1)).join("&");
    urlPattern = home.categoryURLPattern
      ? home.categoryURLPattern.replace("{class}", "fyclass") + "?page=fypage"
      : "/vodtype/fyclass-fypage.html";
  } else {
    classURL = "1&2&3&4";
    urlPattern = "/vodtype/fyclass-fypage.html";
  }

  lines.push(`var rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  lines.push(`  host: '${resolvedHost}',`);
  lines.push(`  homeUrl: '/',`);
  lines.push(`  url: '${urlPattern}',`);
  lines.push(`  detailUrl: '',`);

  // 搜索
  if (home.searchAction) {
    const searchTmpl = home.searchAction.replace("{wd}", "**").replace(/^https?:\/\/[^/]+/, "");
    // 判断 GET vs POST：
    //   - path 里含 ** 且 URL 没 querystring → 前端路由，GET
    //   - 有 ? 但 querystring 里含 ** → GET
    //   - 只有 body 里有关键词（不太可能出现在 URL 模板里）→ POST
    const isPost = !searchTmpl.includes("**") || searchTmpl.endsWith(";post");
    const finalSearchUrl = isPost && !searchTmpl.endsWith(";post") ? `${searchTmpl};post` : searchTmpl;
    lines.push(`  searchUrl: '${finalSearchUrl}',`);
    lines.push(`  searchable: 1,`);
    lines.push(`  quickSearch: 1,`);
  } else if (home.searchInputSelector) {
    // SPA 站点：识别到了输入框但没抓到具体 API URL
    // 给多个候选，最常见的先试
    lines.push(`  // 🔍 检测到搜索输入框 (${home.searchInputSelector.slice(0, 60)}${home.searchInputSelector.length > 60 ? "…" : ""})`);
    lines.push(`  //    未抓到搜索 API URL，以下是常见候选，请测试后保留一条:`);
    lines.push(`  //      /search?keyword=**    /search?q=**    /search?wd=**`);
    lines.push(`  //      /search/**            /s/**           /find?q=**`);
    lines.push(`  searchUrl: '/search?keyword=**',   // TODO: 若不匹配请换成上面其他候选`);
    lines.push(`  searchable: 1,`);
    lines.push(`  quickSearch: 0,                   // 搜索前先测试是否可用`);
  } else {
    lines.push(`  searchUrl: '',                     // TODO: 搜索 URL 模板`);
    lines.push(`  searchable: 0,`);
    lines.push(`  quickSearch: 0,`);
  }

  lines.push(`  filterable: 0,`);
  lines.push(`  headers: {`);
  lines.push(`    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',`);
  lines.push(`    'Referer': '${input.baseURL}/'`);
  lines.push(`  },`);
  lines.push(`  timeout: 5000,`);
  lines.push("");

  lines.push(`  // 首页分类${cats.length > 0 ? "（site2source 自动识别）" : "（TODO: 手动填）"}`);
  lines.push(`  class_name: '${escapeJS(className)}',`);
  lines.push(`  class_url:  '${escapeJS(classURL)}',`);
  lines.push("");

  // 分析 samples 判断哪些字段有值
  const sampleRemarks = input.samples.map((s) => s.remarks || "").filter(Boolean);
  const hasRemarks = sampleRemarks.length >= Math.max(2, input.samples.length * 0.3);
  const remarkRule = hasRemarks
    ? ".remark,.note,.tag,.badge,.label,.hd,.corner&&Text"
    : "*&&data-remark|data-note"; // 空字符串会让 drpy 显示"未知"，这里给个几乎必空的 dummy 避免出错

  lines.push(`  // 一级列表（site2source 自动识别）`);
  lines.push(`  // ${input.cardCount} 项 · 相似度 ${(input.similarity * 100).toFixed(0)}%${hasRemarks ? "" : " · 未识别到 remarks 标签"}`);
  lines.push(`  一级: '${input.listSelector} ${input.itemSelector};*[title],img&&alt,text;img&&data-original||data-src||src;${remarkRule};a&&href',`);
  lines.push("");

  // 二级
  lines.push(`  // 二级（详情页）${hasDetail ? "— site2source 从真实详情页学习" : "— 兜底模板"}`);
  lines.push(`  二级: {`);
  lines.push(`    title: '${detail.titleSelector || "h1"}&&Text',`);
  lines.push(`    desc:  '${detail.descSelector || ".detail"}&&Text',`);
  lines.push(`    content: '${detail.descSelector || ".plot,.content"}&&Text',`);
  lines.push(`    tabs: '${detail.playTabSelector || ".play-from,.playfrom"}&&a',`);
  lines.push(`    lists: '${detail.playListSelector || ".playlist,.play-list"}',`);
  lines.push(`  },`);
  lines.push("");

  // 搜索规则
  if (home.searchAction || home.searchInputSelector) {
    // 优先用识别到的 searchListSelector；否则复用一级 selector（DOM 不同的话手改）
    const searchListSel = home.searchListSelector || `${input.listSelector} ${input.itemSelector}`;
    // drpy 语法：分号分隔的多段规则，整体用单引号包裹。如果 selector 里含单引号（[href*='...']）会破坏字符串，转成双引号
    const safeSearchListSel = searchListSel.replace(/'/g, '"');
    lines.push(`  // 搜索规则（selector 从${home.searchListSelector ? "搜索结果页学习" : "一级列表复用，结果页 DOM 不同请手改"}）`);
    lines.push(`  搜索: '${safeSearchListSel};*[title],img&&alt,text;img&&data-original||data-src||src;${remarkRule};a&&href',`);
  } else {
    lines.push(`  搜索: '*',                          // TODO`);
  }
  lines.push("");

  // 智能 lazy
  lines.push(generateLazyFunction(media, input.baseURL));

  lines.push(`};`);
  lines.push("");

  // 附录：调试信息
  lines.push(`/* ============ 调试信息 ============`);
  lines.push(`  网站: ${input.siteName} (${input.baseURL})`);
  lines.push(`  最终 host: ${resolvedHost}`);
  if (input.baseInfo) {
    lines.push(``);
    lines.push(`  Base 推断:`);
    lines.push(`    - 页面: ${input.baseInfo.pageBase}`);
    if (input.baseInfo.linkBase) lines.push(`    - 链接: ${input.baseInfo.linkBase}`);
    if (input.baseInfo.imgBase) lines.push(`    - 图片: ${input.baseInfo.imgBase}`);
    if (input.baseInfo.overrideBase) lines.push(`    - 手工覆盖: ${input.baseInfo.overrideBase}`);
    if (input.baseInfo.stats) {
      lines.push(``);
      lines.push(`  链接 host 统计:`);
      input.baseInfo.stats.links.slice(0, 3).forEach((l) => {
        lines.push(`    ${l.count}× ${l.host}`);
      });
      lines.push(`  图片 host 统计:`);
      input.baseInfo.stats.imgs.slice(0, 3).forEach((l) => {
        lines.push(`    ${l.count}× ${l.host}`);
      });
    }
  }
  lines.push(``);
  if (cats.length > 0) {
    lines.push(`  识别到 ${cats.length} 个分类:`);
    cats.slice(0, 10).forEach((c) => {
      lines.push(`    - ${c.name}: ${c.url}`);
    });
  }
  if (home.searchAction) {
    lines.push(``);
    lines.push(`  搜索: ${home.searchAction} (参数: ${home.searchParam})`);
  }
  lines.push(``);
  lines.push(`  列表样本 (前 ${Math.min(5, input.samples.length)}):`);
  for (let i = 0; i < Math.min(5, input.samples.length); i++) {
    const s = input.samples[i];
    lines.push(`    ${i + 1}. ${s.name}${s.remarks ? ` [${s.remarks}]` : ""}`);
    lines.push(`       → ${s.url}`);
  }
  if (hasMedia) {
    lines.push(``);
    lines.push(`  抓到 ${media.length} 条视频流:`);
    media.slice(0, 5).forEach((m) => {
      lines.push(`    [${m.type}] ${m.url}`);
      if (m.referer) lines.push(`         Referer: ${m.referer}`);
    });
  }
  lines.push(`*/`);

  return lines.join("\n");
}

/** 智能 lazy() 生成：从抓到的多条 URL 找共同 pattern */
function generateLazyFunction(media: CapturedMedia[], baseURL: string): string {
  const lines: string[] = [];

  if (media.length === 0) {
    lines.push(`  lazy: async function (flag, id, flags) {`);
    lines.push(`    // TODO: 未抓到播放地址，交给 Drpy 内置嗅探`);
    lines.push(`    return { parse: 1, url: id };`);
    lines.push(`  }`);
    return lines.join("\n");
  }

  // 优先 m3u8
  const m3u8s = media.filter((m) => m.type === "m3u8");
  const primary = m3u8s.length > 0 ? m3u8s : media;
  const first = primary[0];
  const referer = first.referer || baseURL + "/";

  // 找共同 host / 路径 pattern
  const pattern = extractURLPattern(primary.map((m) => m.url));

  lines.push(`  // 🎬 播放解析（site2source 从 ${media.length} 条抓包学习）`);
  lines.push(`  lazy: async function (flag, id, flags) {`);
  lines.push(`    // 抓到的播放地址样本：`);
  for (const m of media.slice(0, 4)) {
    lines.push(`    //   [${m.type}] ${m.url}`);
  }
  if (pattern.commonHost) {
    lines.push(`    //`);
    lines.push(`    // 视频域名: ${pattern.commonHost}`);
    lines.push(`    // 疑似 pattern: ${pattern.template}`);
  }
  lines.push(``);
  lines.push(`    try {`);
  lines.push(`      // 策略 1: 拉播放页 HTML, 用正则从中提取 m3u8`);
  lines.push(`      const html = await request(id);`);
  lines.push(`      const patterns = [`);
  lines.push(`        /https?:\\/\\/[^"'\\s]+?\\.m3u8[^"'\\s]*/i,`);
  lines.push(`        /"(https?:\\/\\/[^"]+?\\.mp4[^"]*)"/i,`);
  lines.push(`        /(?:url|src|source)\\s*[:=]\\s*["'](https?:\\/\\/[^"']+?\\.(?:m3u8|mp4)[^"']*)["']/i,`);
  lines.push(`      ];`);
  lines.push(`      for (const re of patterns) {`);
  lines.push(`        const m = html.match(re);`);
  lines.push(`        if (m) {`);
  lines.push(`          const url = m[1] || m[0];`);
  lines.push(`          return {`);
  lines.push(`            parse: 0,`);
  lines.push(`            url: url.replace(/\\\\\\//g, '/'),`);
  lines.push(`            header: { 'User-Agent': 'Mozilla/5.0', 'Referer': '${escapeJS(referer)}' }`);
  lines.push(`          };`);
  lines.push(`        }`);
  lines.push(`      }`);
  lines.push(`    } catch (e) {`);
  lines.push(`      log('lazy fail: ' + e.message);`);
  lines.push(`    }`);
  lines.push(`    // 兜底: 交给 Drpy 内置嗅探`);
  if (pattern.commonHost) {
    lines.push(`    // 已知视频 host: ${pattern.commonHost} — drpy 会过滤此域名的响应`);
    lines.push(`    return { parse: 1, url: id, sniffer: 1, sniffCustomRegex: '${escapeJS(pattern.commonHost)}', header: { 'Referer': '${escapeJS(referer)}' } };`);
  } else {
    lines.push(`    return { parse: 1, url: id, header: { 'Referer': '${escapeJS(referer)}' } };`);
  }
  lines.push(`  }`);
  return lines.join("\n");
}

/** 从多条 URL 里找共同的 host 和路径模板 */
function extractURLPattern(urls: string[]): { commonHost: string; template: string } {
  if (urls.length === 0) return { commonHost: "", template: "" };
  try {
    const parsed = urls.map((u) => new URL(u));
    // 共同 host
    const hosts = new Set(parsed.map((u) => u.host));
    const commonHost = hosts.size === 1 ? parsed[0].host : Array.from(hosts).join(",");
    // 路径公共前缀
    const paths = parsed.map((u) => u.pathname.split("/"));
    const minLen = Math.min(...paths.map((p) => p.length));
    const common: string[] = [];
    for (let i = 0; i < minLen; i++) {
      const vals = new Set(paths.map((p) => p[i]));
      if (vals.size === 1) common.push(paths[0][i]);
      else common.push("*");
    }
    return { commonHost, template: common.join("/") };
  } catch {
    return { commonHost: "", template: "" };
  }
}

/** 从分类 URL 里提取数字 id */
function extractClassId(url: string): string | undefined {
  try {
    const p = new URL(url).pathname;
    // 常见 pattern: /vodtype/1.html, /type/1, /category/movie 等
    const m = p.match(/\/(\d+)(?:\.html?)?$/) || p.match(/[?&](?:id|cid|type)=(\d+)/);
    if (m) return m[1];
    // 拿最后一段
    const segs = p.split("/").filter(Boolean);
    return segs[segs.length - 1]?.replace(/\.html?$/i, "");
  } catch {
    return undefined;
  }
}

/**
 * 判断是否应该走 direct-path 策略（class_url 存完整路径）。
 * 触发条件：分类 URL 出现"多种一级路径前缀"（如 /list/、/space/、/collection/、/movie、/drama），
 *          此时无法用统一模板 /prefix/{id} 表达，只能每个都塞完整路径。
 */
function shouldUseDirectPathStrategy(paths: string[]): boolean {
  if (paths.length <= 1) return false;
  // 收集第一段（跳过带 id 的最后一段）
  const roots = new Set<string>();
  for (const p of paths) {
    const seg = p.split("?")[0].split("/").filter(Boolean)[0];
    if (seg) roots.add(seg.toLowerCase());
  }
  // 有 2 个及以上不同的一级前缀 → direct-path
  return roots.size >= 2;
}

// ==================== tvbox.json ====================

/**
 * ⚠️  重要坑位（请对照 docs/SPIDER-PITFALLS.md 阅读）
 *
 * flags 数组的语义: 这些 flag 需要走 parses 解析.
 * 只填官方视频站方案 (youku/qq/iqiyi 等). 千万不要把 site 自己的 flag 塞进来,
 * 否则 fongmi 会强制走 parses 流水线, 全失败后弹 "Unable to parse url".
 *
 * 如果你的 vod_play_from = 'aiyifan', flags 里就不能有 'aiyifan'.
 */
export function generateTVBoxJSON(input: GenerateInput, spiderURL: string): string {
  const cfg = {
    wallpaper: "https://picsum.photos/1920/1080",
    spider: "https://raw.githubusercontent.com/hjdhnx/dr_py/main/js/drpy2.min.js",
    sites: [
      {
        key: "site_" + sanitize(input.host),
        name: "🎬 " + input.siteName,
        type: 3,
        api: spiderURL,
        ext: "",
        searchable: input.home?.searchAction ? 1 : 0,
        quickSearch: input.home?.searchAction ? 1 : 0,
        filterable: 1,
      },
    ],
    lives: [
      {
        name: "央视卫视",
        type: 0,
        url: "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/global.m3u",
      },
    ],
    parses: [
      { name: "Json并发", type: 2, url: "Parallel" },
      { name: "Json轮询", type: 2, url: "Sequence" },
    ],
    // ⚠️  只放官方视频站方案. 不要放 site 自己的 flag!
    // 参考 docs/SPIDER-PITFALLS.md P0
    flags: [
      "youku", "qq", "iqiyi", "qiyi", "letv", "sohu",
      "tudou", "pptv", "mgtv", "wasu", "bilibili", "renrenmi",
    ],
    ijk: [],
  };
  return JSON.stringify(cfg, null, 2);
}

function sanitize(s: string): string {
  return s.replace(/[.\-:]/g, "_");
}

function escapeJS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ==================== API 型 Drpy 生成 (V0.10) ====================

/**
 * API 型爬虫的配置输入
 * 一个 site 需要三类接口的信息:
 *   home     - 首页/分类列表接口
 *   detail   - 详情接口 (可选)
 *   search   - 搜索接口 (可选)
 * 每个接口需要 URL 模板 + JSONPath 字段映射
 */
export interface APIGenerateInput {
  siteName: string;
  host: string;

  home: {
    urlTemplate: string;      // 例如 https://ex.tv/api/vod/list?type={cate}&page={page}
    method: "GET" | "POST";
    reqBody?: string;         // POST 时的请求体模板
    listPath: string;         // JSONPath: 到达列表数组, 如 $.data.list
    fields: {
      id?: string;            // 相对路径, 如 vod_id (在 list 数组每项下)
      name?: string;
      pic?: string;
      remarks?: string;
    };
  };

  detail?: {
    urlTemplate: string;      // 例如 /api/vod/detail?id={id}
    method: "GET" | "POST";
    fields: {
      name?: string;
      pic?: string;
      desc?: string;
      playFrom?: string;      // 播放源名字数组 path (可选)
      playURL?: string;       // 播放地址/剧集列表 path
    };
    /** V0.11: 从 sampleResponse 探测出来的播放解析片段 (JS 代码) */
    playSnippet?: string;
    /**
     * urlTemplate 是"前端页面路由"而非 JSON API。
     * SPA 站详情 API 常带严格签名（逆向不划算），这时用前端路由 + drpy 嗅探更稳。
     * 置 true 时生成的 二级 不会尝试 JSON.parse，直接返回占位 vod 让播放走嗅探。
     */
    isFrontendRoute?: boolean;
  };

  search?: {
    urlTemplate: string;      // 例如 /api/search?wd={wd}
    method: "GET" | "POST";
    listPath: string;
    fields: {
      id?: string;
      name?: string;
      pic?: string;
    };
  };

  categories?: { name: string; value: string }[];

  /** 抓到的媒体流 (含 m3u8 probe 结果), 用来在 spider 头注释里提示加密情况 */
  media?: CapturedMedia[];
}

export function generateAPIDrpySpider(input: APIGenerateInput): string {
  const lines: string[] = [];
  lines.push(`// site2source-ext auto-generated Drpy T4 API spider for ${input.host}`);
  lines.push(`// Generated: ${new Date().toISOString()}`);

  // 加密情况提示 (从 media probe 结果生成)
  const m3u8Probes = (input.media || [])
    .filter((m) => m.type === "m3u8" && m.probe)
    .slice(0, 3);
  if (m3u8Probes.length > 0) {
    lines.push("//");
    lines.push("// 媒体流探测结果:");
    for (const m of m3u8Probes) {
      const p = m.probe!;
      lines.push(`//   [${p.encryption}] ${m.url.slice(0, 80)}${m.url.length > 80 ? "..." : ""}`);
      if (p.encryption === "widevine" || p.encryption === "playready" || p.encryption === "sample-aes") {
        lines.push(`//     ⚠️  DRM 加密, TVBox 一般无法播放, 建议放弃此站`);
      } else if (p.encryption === "aes-128") {
        lines.push(`//     🔓 HLS AES-128, IJKPlayer 自动解密; 如 key 请求 401, 需在 播放() 里加 header`);
      } else if (p.encryption === "custom") {
        lines.push(`//     ⚠️  自定义加密, 需要在 播放() 里逆向解密算法`);
      }
    }
  }

  lines.push("");

  const cats = input.categories || [
    { name: "电影", value: "1" },
    { name: "电视剧", value: "2" },
    { name: "综艺", value: "3" },
    { name: "动漫", value: "4" },
  ];
  const className = cats.map((c) => c.name).join("&");
  const classValue = cats.map((c) => c.value).join("&");

  const homeMethod = input.home.method === "POST" ? ";post" : "";
  const homeURL = replacePlaceholders(input.home.urlTemplate);

  lines.push(`var rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  // input.host 可能已含协议（调用方来源不一），别无脑加前缀
  const hostVal = /^https?:\/\//i.test(input.host) ? input.host : `https://${input.host}`;
  lines.push(`  host: '${escapeJS(hostVal)}',`);
  lines.push(`  homeUrl: '/',`);
  lines.push(`  url: '${escapeJS(homeURL)}${homeMethod}',`);
  lines.push(`  detailUrl: '${input.detail ? escapeJS(replacePlaceholders(input.detail.urlTemplate)) : ""}',`);

  // 搜索
  if (input.search) {
    const sMethod = input.search.method === "POST" ? ";post" : "";
    lines.push(`  searchUrl: '${escapeJS(replacePlaceholders(input.search.urlTemplate))}${sMethod}',`);
  }

  lines.push(`  class_name: '${className}',`);
  lines.push(`  class_url: '${classValue}',`);
  lines.push(`  filter_url: '',`);
  lines.push(`  filter: {},`);
  lines.push(`  filter_def: {},`);
  lines.push(`  headers: { 'User-Agent': 'MOBILE_UA' },`);
  lines.push(`  timeout: 5000,`);
  lines.push(`  play_parse: true,`);
  lines.push(`  limit: 6,`);
  lines.push(`  double: true,`);
  lines.push(``);

  // ========== home 一级列表解析 (API 模式) ==========
  lines.push(`  // 一级列表: 从 JSON API 解析`);
  lines.push(`  一级: async function(fyclass, fypage, fyfilter) {`);
  lines.push(`    let url = this.url.replace('fyclass', fyclass).replace('fypage', fypage);`);
  if (input.home.reqBody) {
    lines.push(`    let body = '${escapeJS(input.home.reqBody)}'.replace('fyclass', fyclass).replace('fypage', fypage);`);
    lines.push(`    let { data } = await this.postJson(url, body);`);
  } else if (input.home.method === "POST") {
    lines.push(`    let { data } = await this.postJson(url, {});`);
  } else {
    lines.push(`    let raw = await request(url);`);
    lines.push(`    let data;`);
    lines.push(`    try { data = JSON.parse(raw); } catch(e) {`);
    lines.push(`      log('[s2s] home 接口非 JSON: ' + String(raw).slice(0, 200));`);
    lines.push(`      return [];`);
    lines.push(`    }`);
  }
  lines.push(`    let list = ${jsonPathToJS(input.home.listPath, "data")} || [];`);
  lines.push(`    let videos = list.map(function(v) {`);
  lines.push(`      return {`);
  lines.push(`        vod_id: ${accessField(input.home.fields.id, "v")} || '',`);
  lines.push(`        vod_name: ${accessField(input.home.fields.name, "v")} || '',`);
  lines.push(`        vod_pic: ${accessField(input.home.fields.pic, "v")} || '',`);
  lines.push(`        vod_remarks: ${accessField(input.home.fields.remarks, "v")} || '',`);
  lines.push(`      };`);
  lines.push(`    });`);
  lines.push(`    return videos;`);
  lines.push(`  },`);
  lines.push(``);

  // ========== detail 二级解析 (API 模式) ==========
  if (input.detail?.isFrontendRoute) {
    // 前端路由模式：详情 API 带严格签名逆向不划算，直接把页面 URL 当播放地址，
    // 让 drpy 打开页面 + 嗅探视频流。剧集列表拿不到（只能播当前集），
    // 但对"能播"这个核心目标够用。
    lines.push(`  // 二级详情: SPA 前端路由模式（详情 API 带签名，走嗅探）`);
    lines.push(`  二级: async function(ids) {`);
    lines.push(`    let id = ids[0];`);
    lines.push(`    let pageUrl = '${escapeJS(input.detail.urlTemplate)}'.replace('{id}', id);`);
    lines.push(`    // 页面 URL 直接当播放源，播放时由 drpy 嗅探真实流`);
    lines.push(`    return {`);
    lines.push(`      vod_id: id,`);
    lines.push(`      vod_name: '',`);
    lines.push(`      vod_play_from: '嗅探',`);
    lines.push(`      vod_play_url: '正片$' + pageUrl,`);
    lines.push(`    };`);
    lines.push(`  },`);
    lines.push(``);
  } else if (input.detail) {
    lines.push(`  // 二级详情: 从 JSON API 解析`);
    lines.push(`  二级: async function(ids) {`);
    lines.push(`    let id = ids[0];`);
    lines.push(`    let url = '${escapeJS(input.detail.urlTemplate)}'.replace('{id}', id);`);
    if (input.detail.method === "POST") {
      lines.push(`    let { data } = await this.postJson(url, {});`);
    } else {
      lines.push(`    let raw = await request(url);`);
      lines.push(`    let data;`);
      lines.push(`    try { data = JSON.parse(raw); } catch(e) {`);
      lines.push(`      log('[s2s] detail 接口非 JSON: ' + String(raw).slice(0, 200));`);
      lines.push(`      return {};`);
      lines.push(`    }`);
    }
    lines.push(`    let vod = {`);
    lines.push(`      vod_name: ${accessField(input.detail.fields.name, "data")} || '',`);
    lines.push(`      vod_pic: ${accessField(input.detail.fields.pic, "data")} || '',`);
    lines.push(`      vod_content: ${accessField(input.detail.fields.desc, "data")} || '',`);
    lines.push(`    };`);
    // 播放地址: 优先用探测器生成的 snippet
    if (input.detail.playSnippet) {
      lines.push(`    // 剧集列表 (从 sampleResponse 探测的格式)`);
      lines.push(input.detail.playSnippet);
    } else if (input.detail.fields.playURL) {
      lines.push(`    // 剧集列表 (兜底: 假设 MacCMS 字符串)`);
      lines.push(`    let playRaw = ${accessField(input.detail.fields.playURL, "data")};`);
      if (input.detail.fields.playFrom) {
        lines.push(`    let playFrom = ${accessField(input.detail.fields.playFrom, "data")};`);
        lines.push(`    if (Array.isArray(playFrom)) {`);
        lines.push(`      vod.vod_play_from = playFrom.join('$$$');`);
        lines.push(`      vod.vod_play_url = Array.isArray(playRaw) ? playRaw.join('$$$') : String(playRaw || '');`);
        lines.push(`    } else {`);
        lines.push(`      vod.vod_play_from = 'default';`);
        lines.push(`      vod.vod_play_url = typeof playRaw === 'string' ? playRaw : JSON.stringify(playRaw);`);
        lines.push(`    }`);
      } else {
        lines.push(`    vod.vod_play_from = 'default';`);
        lines.push(`    vod.vod_play_url = typeof playRaw === 'string' ? playRaw : JSON.stringify(playRaw);`);
      }
    }
    lines.push(`    return vod;`);
    lines.push(`  },`);
    lines.push(``);
  }

  // ========== search ==========
  if (input.search) {
    lines.push(`  // 搜索`);
    lines.push(`  搜索: async function(wd, quick) {`);
    lines.push(`    let url = '${escapeJS(input.search.urlTemplate)}'.replace('{wd}', encodeURIComponent(wd));`);
    if (input.search.method === "POST") {
      lines.push(`    let { data } = await this.postJson(url, {});`);
    } else {
      lines.push(`    let raw = await request(url);`);
      lines.push(`    let data;`);
      lines.push(`    try { data = JSON.parse(raw); } catch(e) {`);
      lines.push(`      log('[s2s] search 接口非 JSON: ' + String(raw).slice(0, 200));`);
      lines.push(`      return [];`);
      lines.push(`    }`);
    }
    lines.push(`    let list = ${jsonPathToJS(input.search.listPath, "data")} || [];`);
    lines.push(`    return list.map(function(v) {`);
    lines.push(`      return {`);
    lines.push(`        vod_id: ${accessField(input.search.fields.id, "v")} || '',`);
    lines.push(`        vod_name: ${accessField(input.search.fields.name, "v")} || '',`);
    lines.push(`        vod_pic: ${accessField(input.search.fields.pic, "v")} || '',`);
    lines.push(`      };`);
    lines.push(`    });`);
    lines.push(`  },`);
    lines.push(``);
  }

  // ========== 播放解析 ==========
  lines.push(`  // 播放: id 若为 m3u8/mp4 直链则 parse=0 直接播, 否则交给 Drpy 嗅探`);
  lines.push(`  播放: async function(flag, id, flags) {`);
  lines.push(`    if (/\\.(m3u8|mp4|flv|mpd)(\\?|$)/i.test(id)) {`);
  lines.push(`      return { parse: 0, url: id };`);
  lines.push(`    }`);
  lines.push(`    return { parse: 1, url: id };`);
  lines.push(`  }`);
  lines.push(`};`);

  return lines.join("\n");
}

/** 把用户配置的 URL 模板里 {cate}/{page}/{wd}/{id} 替换成 Drpy 变量 */
function replacePlaceholders(t: string): string {
  return t
    .replace(/\{cate\}/g, "fyclass")
    .replace(/\{page\}/g, "fypage")
    .replace(/\{wd\}/g, "**")
    .replace(/\{id\}/g, "{id}");
}

/**
 * 把 JSONPath (子集: $.a.b[*].c) 翻译成 JS 访问代码
/**
 * JSONPath → JS 访问代码
 * @param path 如 "$.data.list" / "$.data.info[*].guessYouLike"
 * @param varName 数据变量名, 如 "data"
 * @param treatMiddleWildcard "as-index-0" 时中间的 [*] 用 [0] 取 (常见于外层包装数组只有 1 项)
 *                            "skip" 时忽略 [*] (旧行为, 只在 [*] 位于末尾时正确)
 * 返回 "data?.data?.list" 或 "data?.data?.info?.[0]?.guessYouLike"
 */
function jsonPathToJS(
  path: string,
  varName: string,
  treatMiddleWildcard: "as-index-0" | "skip" = "as-index-0",
): string {
  if (!path || path === "$") return varName;
  const rest = path.replace(/^\$\.?/, "");
  const parts = rest.split(/[.[\]]/).filter(Boolean);
  let expr = varName;
  // 检查每个 [*] 是否是末尾 - 是则忽略 (由 map 处理), 中间的按策略处理
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "*") {
      const isLast = i === parts.length - 1;
      if (isLast) continue; // 末尾 [*] 由外层 map 处理
      if (treatMiddleWildcard === "as-index-0") expr += `?.[0]`;
      // "skip": 什么都不加, 会得到错的表达式
      continue;
    }
    if (/^\d+$/.test(p)) expr += `?.[${p}]`;
    else expr += `?.${p}`;
  }
  return expr;
}

/** 生成访问某个字段的 JS 表达式 (用于 map 回调里, v 是数组元素) */
function accessField(path: string | undefined, varName: string): string {
  if (!path) return "''";
  // 用户可能填相对路径 (无 $) 或绝对路径 ($.foo)
  if (path.startsWith("$")) return jsonPathToJS(path, varName);
  // 相对路径: 认为在当前元素下
  return `${varName}?.${path.replace(/^\./, "")}`;
}
