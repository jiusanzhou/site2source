/**
 * Drpy T4 爬虫代码生成器
 */

import type {
  CapturedMedia,
  DetailSpec,
  SerializedSample,
} from "./messages";

export interface GenerateInput {
  siteName: string;
  baseURL: string;
  host: string;

  // 列表
  listSelector: string;
  itemSelector: string;
  cardCount: number;
  similarity: number;
  samples: SerializedSample[];

  // 详情（可选）
  detail?: DetailSpec;

  // 抓到的媒体（可选）
  media?: CapturedMedia[];
}

export function generateDrpySpider(input: GenerateInput): string {
  const lines: string[] = [];
  lines.push(`// site2source-ext auto-generated Drpy T4 spider for ${input.host}`);
  lines.push(`// Generated: ${new Date().toISOString()}`);
  lines.push(`// ⚠️ 分类/搜索/播放解析可能需要人工微调`);
  lines.push("");

  const detail = input.detail || {};
  const hasDetail = !!(detail.titleSelector || detail.playListSelector);
  const media = input.media || [];
  const hasMedia = media.length > 0;

  lines.push(`globalThis.rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  lines.push(`  host: '${input.baseURL}',`);
  lines.push(`  homeUrl: '/',`);
  lines.push(`  url: '/',                          // TODO: 分类页 URL 模板 (fyclass/fypage)`);
  lines.push(`  detailUrl: '',`);
  lines.push(`  searchUrl: '',                     // TODO: 搜索 URL 模板`);
  lines.push(`  searchable: 0,`);
  lines.push(`  quickSearch: 0,`);
  lines.push(`  filterable: 0,`);
  lines.push(`  headers: {`);
  lines.push(`    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',`);
  lines.push(`    'Referer': '${input.baseURL}/'`);
  lines.push(`  },`);
  lines.push(`  timeout: 5000,`);
  lines.push("");
  lines.push(`  // 首页分类（TODO: 手动填分类导航）`);
  lines.push(`  class_name: '电影&电视剧',`);
  lines.push(`  class_url:  '1&2',`);
  lines.push("");
  lines.push(`  // 一级列表（site2source 自动识别）`);
  lines.push(`  // ${input.cardCount} 项 · 相似度 ${(input.similarity * 100).toFixed(0)}%`);
  lines.push(`  一级: '${input.listSelector} ${input.itemSelector};*[title],img&&alt,text;img&&data-original||data-src||src;.*(HD|4K|更新|第.集|全.集|完结|连载|\\\\d{4}).*;a&&href',`);
  lines.push("");

  // 二级 —— 有 detail 用推断，无 detail 用兜底
  lines.push(`  // 二级（详情页）${hasDetail ? "— site2source 从真实详情页学习" : "— 兜底模板，需要微调"}`);
  lines.push(`  二级: {`);
  lines.push(`    title: '${detail.titleSelector || "h1"}&&Text',`);
  if (detail.descSelector) {
    lines.push(`    desc:  '${detail.descSelector}&&Text',`);
  } else {
    lines.push(`    desc:  '.detail&&Text',`);
  }
  lines.push(`    content: '${detail.descSelector || ".plot,.content"}&&Text',`);
  if (detail.playTabSelector) {
    lines.push(`    tabs: '${detail.playTabSelector}&&a',`);
  } else {
    lines.push(`    tabs: '.play-from,.playfrom&&a',`);
  }
  if (detail.playListSelector) {
    lines.push(`    lists: '${detail.playListSelector}',`);
  } else {
    lines.push(`    lists: '.playlist,.play-list',`);
  }
  lines.push(`  },`);
  lines.push("");
  lines.push(`  // 搜索 TODO`);
  lines.push(`  搜索: '*',`);
  lines.push("");

  // 播放解析
  if (hasMedia) {
    lines.push(`  // 🎬 播放解析（site2source 抓到 ${media.length} 条视频流）`);
    // 优先 m3u8 > mp4 > flv > ts
    const primary = media.find((m) => m.type === "m3u8") || media[0];
    const referer = primary.referer || input.baseURL + "/";
    lines.push(`  lazy: async function (flag, id, flags) {`);
    lines.push(`    // 抓到的样本：`);
    for (const m of media.slice(0, 5)) {
      lines.push(`    //   [${m.type}] ${m.url}`);
    }
    lines.push(`    //`);
    lines.push(`    // 常见做法：`);
    lines.push(`    // 1. 拉播放页 HTML: const html = await request(id);`);
    lines.push(`    // 2. 从 HTML 里正则找 m3u8: const m = html.match(/https?:[^"']+\\\\.m3u8[^"']*/);`);
    lines.push(`    // 3. return { parse: 0, url: m[0], header: { Referer: HOST } };`);
    lines.push(`    //`);
    lines.push(`    // 或者用抓到的直链模式（如果 URL 里有 vodId 就替换）：`);
    lines.push(`    // return { parse: 0, url: '${primary.url}', header: { Referer: '${referer}' } };`);
    lines.push(`    return { parse: 1, url: id };  // 默认交给 Drpy 内置嗅探`);
    lines.push(`  }`);
  } else {
    lines.push(`  // 播放解析 TODO`);
    lines.push(`  lazy: async function (flag, id, flags) {`);
    lines.push(`    return { parse: 1, url: id };  // 默认交给 Drpy 内置嗅探`);
    lines.push(`  }`);
  }

  lines.push(`};`);
  lines.push("");
  lines.push(`/* 探测到的样本卡片（前 ${Math.min(5, input.samples.length)} 张）:`);
  for (let i = 0; i < Math.min(5, input.samples.length); i++) {
    const s = input.samples[i];
    lines.push(`  ${i + 1}. ${s.name}`);
    lines.push(`     URL: ${s.url}`);
    lines.push(`     Pic: ${s.pic}`);
    lines.push(`     Remarks: ${s.remarks}`);
  }
  lines.push(`*/`);

  return lines.join("\n");
}

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
        searchable: 1,
        quickSearch: 1,
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
