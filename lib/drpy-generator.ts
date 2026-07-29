/**
 * Drpy T4 爬虫代码生成器
 * 复用 Go 版 site2source/internal/generator/generic.go 的逻辑
 */

import type { CardSample, ListCandidate } from "./dom-analyzer";

export interface GenerateInput {
  siteName: string;
  baseURL: string;
  host: string;
  listSelector: string;
  itemSelector: string; // e.g. "li" | "div"
  cardCount: number;
  similarity: number;
  samples: CardSample[];
  // 未来扩展：detail 页规则、播放规则、m3u8 直链等
  playURLs?: string[];
}

export function generateDrpySpider(input: GenerateInput): string {
  const lines: string[] = [];
  lines.push(`// site2source-ext auto-generated Drpy T4 spider for ${input.host}`);
  lines.push(`// Generated URL: ${input.baseURL}`);
  lines.push(`// ⚠️ detail() / play() / search() 需要人工完善`);
  lines.push("");
  lines.push(`globalThis.rule = {`);
  lines.push(`  title: '${escapeJS(input.siteName)}',`);
  lines.push(`  host: '${input.baseURL}',`);
  lines.push(`  homeUrl: '/',`);
  lines.push(`  url: '/',                          // TODO: 分类页 URL 模板`);
  lines.push(`  detailUrl: '',                     // TODO: 详情页 URL 模板`);
  lines.push(`  searchUrl: '',                     // TODO: 搜索 URL 模板`);
  lines.push(`  searchable: 0,`);
  lines.push(`  quickSearch: 0,`);
  lines.push(`  filterable: 0,`);
  lines.push(`  headers: {`);
  lines.push(`    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'`);
  lines.push(`  },`);
  lines.push(`  timeout: 5000,`);
  lines.push("");
  lines.push(`  // 首页分类（TODO：把网站的分类导航填进来）`);
  lines.push(`  class_name: '电影&电视剧',`);
  lines.push(`  class_url:  '1&2',`);
  lines.push("");
  lines.push(`  // 一级列表（=首页 & 分类页的影片卡片解析）`);
  lines.push(`  // 由 site2source 从 ${input.cardCount} 个候选卡片自动推断（相似度 ${(input.similarity * 100).toFixed(0)}%）`);
  lines.push(`  一级: '${input.listSelector} ${input.itemSelector};*[title],img&&alt,text;img&&data-original||data-src||src;.*(HD|4K|更新|第.集|全.集|完结|连载|\\\\d{4}).*;a&&href',`);
  lines.push("");
  lines.push(`  // 二级（详情页） TODO`);
  lines.push(`  二级: {`);
  lines.push(`    title: 'h1&&Text',`);
  lines.push(`    img:   '.pic img&&src',`);
  lines.push(`    desc:  '.detail&&Text',`);
  lines.push(`    content: '.plot&&Text',`);
  lines.push(`    tabs: '.play-from&&a',`);
  lines.push(`    lists: '.playlist',`);
  lines.push(`  },`);
  lines.push("");
  lines.push(`  // 搜索 TODO`);
  lines.push(`  搜索: '',`);
  lines.push("");
  lines.push(`  // 播放 TODO：需要根据网站播放页结构写解析`);

  if (input.playURLs && input.playURLs.length > 0) {
    lines.push(`  // 🎬 site2source 抓到的候选播放地址（供参考）：`);
    for (const u of input.playURLs.slice(0, 5)) {
      lines.push(`  //   ${u}`);
    }
  }

  lines.push(`  lazy: async function (flag, id, flags) {`);
  lines.push(`    return { parse: 1, url: id };`);
  lines.push(`  }`);
  lines.push(`};`);
  lines.push("");
  lines.push(`/* 探测到的样本卡片（前 5 张）：`);
  for (let i = 0; i < input.samples.length; i++) {
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
