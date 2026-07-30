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
  const classURL = cats.length > 0
    ? cats.map((c, i) => extractClassId(c.url) || String(i + 1)).join("&")
    : "1&2&3&4";
  const urlPattern = home.categoryURLPattern
    ? home.categoryURLPattern.replace("{class}", "{cate}") + "?page={page}"
    : "/vodtype/{cate}-{page}.html";

  lines.push(`globalThis.rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  lines.push(`  host: '${resolvedHost}',`);
  lines.push(`  homeUrl: '/',`);
  lines.push(`  url: '${urlPattern.replace("{cate}", "fyclass").replace("{page}", "fypage")}',`);
  lines.push(`  detailUrl: '',`);

  // 搜索
  if (home.searchAction) {
    const searchTmpl = home.searchAction.replace("{wd}", "**").replace(/^https?:\/\/[^/]+/, "");
    lines.push(`  searchUrl: '${searchTmpl};post',  // TODO: 若为 GET 改为不带 ';post'`);
    lines.push(`  searchable: 1,`);
    lines.push(`  quickSearch: 1,`);
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

  lines.push(`  // 一级列表（site2source 自动识别）`);
  lines.push(`  // ${input.cardCount} 项 · 相似度 ${(input.similarity * 100).toFixed(0)}%`);
  lines.push(`  一级: '${input.listSelector} ${input.itemSelector};*[title],img&&alt,text;img&&data-original||data-src||src;.*?(HD[0-9]*|4K|更新至第?.+?集|第.+?集|全.+?集|完结|连载|BD|超清|高清|\\\\d{4}).*?;a&&href',`);
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
  if (home.searchAction) {
    lines.push(`  // 搜索规则（site2source 自动识别搜索表单）`);
    lines.push(`  搜索: '${input.listSelector} ${input.itemSelector};*[title],img&&alt,text;img&&data-original||data-src||src;.*(HD|更新|完结|\\\\d{4}).*;a&&href',`);
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
  lines.push(`    return { parse: 1, url: id, header: { 'Referer': '${escapeJS(referer)}' } };`);
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

// ==================== tvbox.json ====================

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
}

export function generateAPIDrpySpider(input: APIGenerateInput): string {
  const lines: string[] = [];
  lines.push(`// site2source-ext auto-generated Drpy T4 API spider for ${input.host}`);
  lines.push(`// Generated: ${new Date().toISOString()}`);
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

  lines.push(`globalThis.rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  lines.push(`  host: 'https://${input.host}',`);
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
    lines.push(`    let data = await request(url);`);
    lines.push(`    try { data = JSON.parse(data); } catch(e) {}`);
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
  if (input.detail) {
    lines.push(`  // 二级详情: 从 JSON API 解析`);
    lines.push(`  二级: async function(ids) {`);
    lines.push(`    let id = ids[0];`);
    lines.push(`    let url = '${escapeJS(input.detail.urlTemplate)}'.replace('{id}', id);`);
    if (input.detail.method === "POST") {
      lines.push(`    let { data } = await this.postJson(url, {});`);
    } else {
      lines.push(`    let data = await request(url);`);
      lines.push(`    try { data = JSON.parse(data); } catch(e) {}`);
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
      lines.push(`    let data = await request(url);`);
      lines.push(`    try { data = JSON.parse(data); } catch(e) {}`);
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

  // ========== 播放解析 (交给 drpy 嗅探) ==========
  lines.push(`  // 播放: 交给 Drpy 内置嗅探`);
  lines.push(`  播放: async function(flag, id, flags) {`);
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
 * @param path 如 "$.data.list"
 * @param varName 数据变量名, 如 "data"
 * 返回 "data?.data?.list"
 */
function jsonPathToJS(path: string, varName: string): string {
  if (!path || path === "$") return varName;
  const rest = path.replace(/^\$\.?/, "");
  const parts = rest.split(/[.[\]]/).filter(Boolean);
  let expr = varName;
  for (const p of parts) {
    if (p === "*") continue; // 列表迭代由 map 处理
    if (/^\d+$/.test(p)) expr += `[${p}]`;
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
