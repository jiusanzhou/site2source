/**
 * FongMi / TVBox T3 JS Spider 生成器
 *
 * 【为什么需要这个】
 * 之前生成的都是 drpy T4 规则（`var rule = {...}`），那需要 drpy2 解释器加载。
 * FongMi (com.fongmi.android.tv) 的 QuickJS 引擎直接要 T3 接口：
 *   spider.__jsEvalReturn() → { init, home, homeVod, category, detail, play, search }
 * 缺 __jsEvalReturn 时 Spider.init 里 getJSFunction 拿到 null → NPE 崩溃。
 * （实测日志：NullPointerException ... JSObject.getJSFunction on a null object reference）
 *
 * 【FongMi 注入的全局】（实测确认，FongMi 5.5.6 / mobile-arm64）
 * assets/js/lib/spider.js 是加载器，它只做一件事：
 *     globalThis.req = http
 *     globalThis.__JS_SPIDER__ = spider.__jsEvalReturn()
 * 所以：
 *   ✅ req(url, options)   - 唯一自动注入的全局，返回 { content, headers }
 *   ✅ joinUrl / local / md5X / aesX / rsaX / js2Proxy / getProxy - 引擎侧提供
 *   ✅ console.log         - 可用
 *   ❌ log()               - 不存在！用了会 'log' is not defined 然后静默失败
 *   ❌ print()             - 也不存在！dex strings 里有这个词但 QuickJS 全局没有
 *                            （实测报 QuickJSException: 'print' is not defined）
 *   ❌ pdfh / pdfa         - 不存在，不能用 drpy 的伪 xpath
 *   ⚠️ cheerio             - 存在但必须显式 import：
 *                            import * as cheerio from 'assets://js/lib/cat.js'
 *                            （cat.js 就是打包后的 cheerio，不是什么 T3 SDK）
 *
 * 【T3 返回格式】
 *   home:     { class: [{type_id, type_name}], list?: [...] }
 *   category: { list: [vod], page, pagecount, limit, total }
 *   detail:   { list: [{ vod_id, vod_name, vod_play_from, vod_play_url, ... }] }
 *   search:   { list: [vod] }
 *   play:     { parse, url, header }
 *   vod:      { vod_id, vod_name, vod_pic, vod_remarks }
 *
 * 【实测状态 2026-08-02，FongMi 5.5.6 + Android 14 模拟器】
 * 用硬编码探针验证过完整调用链：
 *   home() → 5 个分类正常显示在 UI ✅
 *   category() → 返回的 vod 正常渲染成卡片 ✅
 * 所以生成的 spider 结构是对的。aiyifan 分类页为空是站点本身的问题：
 *   curl https://www.aiyifan.tv/drama → 9.7KB HTML，body 里只有 loading spinner
 *   + 空的 <div class="root-container">，0 个 /play/ 链接。
 * 纯 CSR 站没有任何 HTML 抓取方案能拿到列表，这是硬限制。
 */

import type { CapturedMedia } from "./messages";

export interface T3SpiderInput {
  siteName: string;
  /** 站点根 URL，含协议 */
  host: string;
  categories: { name: string; url: string }[];
  /** 分类页卡片 selector（cheerio 语法） */
  listSelector?: string;
  /** 搜索前端路由，{wd} 占位 */
  searchRoute?: string;
  searchListSelector?: string;
  media?: CapturedMedia[];
  /** 纯 CSR 站（HTML 空壳），一级会拿不到数据 */
  isPureCSR?: boolean;
}

function esc(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, " ");
}

function sniffHosts(media: CapturedMedia[] = []): string[] {
  const out = new Set<string>();
  for (const m of media) {
    if (!m?.url || !/\.(m3u8|mp4|flv|mpd)(\?|$)/i.test(m.url)) continue;
    try {
      out.add(new URL(m.url).host);
    } catch {}
  }
  return Array.from(out);
}

export function generateT3Spider(input: T3SpiderInput): string {
  const L: string[] = [];
  const hosts = sniffHosts(input.media);
  const hostVal = /^https?:\/\//i.test(input.host) ? input.host : `https://${input.host}`;
  const cats = input.categories.length ? input.categories : [{ name: "首页", url: "/" }];

  L.push(`// site2source-ext 生成的 FongMi/TVBox T3 JS spider`);
  L.push(`// Site: ${hostVal}`);
  L.push(`// Generated: ${new Date().toISOString()}`);
  L.push(`//`);
  L.push(`// 用法：TVBox 配置 sites[].type=3, api 指向本文件 URL`);
  if (input.isPureCSR) {
    L.push(`//`);
    L.push(`// ⚠️ 本站是纯 CSR（Angular/React），服务端返回的 HTML 是空壳。`);
    L.push(`//    一级列表大概率为空 —— 这是站点特性，不是 spider bug。`);
    L.push(`//    详情/播放走嗅探，仍然可用。`);
  }
  if (hosts.length) L.push(`// 视频 CDN: ${hosts.join(", ")}`);
  L.push(``);

  // FongMi 只自动注入 req；cheerio/其他要自己 import。
  // log() 不存在（实测 dex strings 里只有 print/console）—— 用 log 会 ReferenceError 静默失败。
  L.push(`import * as cheerio from 'assets://js/lib/cat.js';`);
  L.push(``);
  L.push(`var rule = {`);
  L.push(`  title: '${esc(input.siteName)}',`);
  L.push(`  host: '${esc(hostVal)}',`);
  L.push(`};`);
  L.push(``);
  L.push(`var HOST = '${esc(hostVal)}';`);
  L.push(``);

  // ---- init
  L.push(`function init(cfg) {`);
  L.push(`  console.log('[s2s] init ' + HOST);`);
  L.push(`}`);
  L.push(``);

  // ---- home
  L.push(`function home(filter) {`);
  L.push(`  var classes = [`);
  for (const c of cats) {
    L.push(`    { type_id: '${esc(c.url)}', type_name: '${esc(c.name)}' },`);
  }
  L.push(`  ];`);
  L.push(`  return JSON.stringify({ class: classes });`);
  L.push(`}`);
  L.push(``);

  // ---- homeVod
  L.push(`function homeVod() {`);
  L.push(`  return JSON.stringify({ list: [] });`);
  L.push(`}`);
  L.push(``);

  // ---- 抽取辅助：从 HTML 里捞卡片
  L.push(`// 从 HTML 抽卡片。FongMi 没有 pdfh/pdfa，用 cheerio。`);
  L.push(`function parseList(html, selector) {`);
  L.push(`  var vods = [];`);
  L.push(`  try {`);
  L.push(`    var $ = cheerio.load(html);`);
  L.push(`    $(selector).each(function (i, el) {`);
  L.push(`      var $el = $(el);`);
  L.push(`      var a = $el.is('a') ? $el : $el.find('a').first();`);
  L.push(`      var href = a.attr('href') || '';`);
  L.push(`      if (!href) return;`);
  L.push(`      var img = $el.find('img').first();`);
  L.push(`      var name = a.attr('title') || $el.attr('title') || img.attr('alt') || $el.text().trim();`);
  L.push(`      var pic = img.attr('data-original') || img.attr('data-src') || img.attr('src') || '';`);
  L.push(`      if (pic && pic.indexOf('http') !== 0) pic = joinUrl(HOST, pic);`);
  L.push(`      if (href.indexOf('http') !== 0) href = joinUrl(HOST, href);`);
  L.push(`      if (!name) return;`);
  L.push(`      vods.push({`);
  L.push(`        vod_id: href,`);
  L.push(`        vod_name: name.substring(0, 60),`);
  L.push(`        vod_pic: pic,`);
  L.push(`        vod_remarks: ($el.find('[class*=remark],[class*=note],[class*=episode]').first().text() || '').trim(),`);
  L.push(`      });`);
  L.push(`    });`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] parseList 失败: ' + e.message);`);
  L.push(`  }`);
  L.push(`  return vods;`);
  L.push(`}`);
  L.push(``);

  // ---- category
  L.push(`function category(tid, pg, filter, extend) {`);
  L.push(`  if (!pg) pg = 1;`);
  L.push(`  var url = tid.indexOf('http') === 0 ? tid : joinUrl(HOST, tid);`);
  L.push(`  if (pg > 1) url += (url.indexOf('?') > -1 ? '&' : '?') + 'page=' + pg;`);
  L.push(`  var vods = [];`);
  L.push(`  try {`);
  L.push(`    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;`);
  if (input.listSelector) {
    L.push(`    vods = parseList(html, '${esc(input.listSelector.replace(/'/g, '"'))}');`);
    L.push(`    // selector 抓空时退化成"找所有含 /play/ 的链接"`);
    L.push(`    if (!vods.length) vods = parseList(html, 'a[href*="/play/"],a[href*="/detail"],a[href*="/watch"]');`);
  } else {
    L.push(`    vods = parseList(html, 'a[href*="/play/"],a[href*="/detail"],a[href*="/watch"]');`);
  }
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] category 失败: ' + e.message);`);
  L.push(`  }`);
  L.push(`  return JSON.stringify({ list: vods, page: pg, pagecount: vods.length ? pg + 1 : pg, limit: 20, total: 999 });`);
  L.push(`}`);
  L.push(``);

  // ---- detail：不解析，页面 URL 当播放源
  L.push(`function detail(id) {`);
  L.push(`  // 详情 API 常带签名，不去硬解。页面 URL 直接当播放源，播放时嗅探。`);
  L.push(`  var url = id.indexOf('http') === 0 ? id : joinUrl(HOST, id);`);
  L.push(`  var name = '', pic = '', desc = '';`);
  L.push(`  try {`);
  L.push(`    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;`);
  L.push(`    var $ = cheerio.load(html);`);
  L.push(`    name = ($('h1,h4,.title').first().text() || $('title').text() || '').trim();`);
  L.push(`    pic = $('meta[property="og:image"]').attr('content') || '';`);
  L.push(`    desc = ($('meta[name="description"]').attr('content') || '').trim();`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] detail 拉页面失败: ' + e.message);`);
  L.push(`  }`);
  L.push(`  var vod = {`);
  L.push(`    vod_id: id,`);
  L.push(`    vod_name: name || '未知',`);
  L.push(`    vod_pic: pic,`);
  L.push(`    vod_content: desc,`);
  L.push(`    vod_play_from: '嗅探',`);
  L.push(`    vod_play_url: '正片$' + url,`);
  L.push(`  };`);
  L.push(`  return JSON.stringify({ list: [vod] });`);
  L.push(`}`);
  L.push(``);

  // ---- search
  L.push(`function search(wd, quick, pg) {`);
  L.push(`  var vods = [];`);
  if (input.searchRoute) {
    L.push(`  try {`);
    L.push(`    var url = joinUrl(HOST, '${esc(input.searchRoute)}'.replace('{wd}', encodeURIComponent(wd)));`);
    L.push(`    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;`);
    const ssel = input.searchListSelector
      ? esc(input.searchListSelector.replace(/'/g, '"'))
      : 'a[href*="/play/"]';
    L.push(`    vods = parseList(html, '${ssel}');`);
    L.push(`    if (!vods.length) vods = parseList(html, 'a[href*="/play/"],a[href*="/detail"]');`);
    L.push(`  } catch (e) {`);
    L.push(`    console.log('[s2s] search 失败: ' + e.message);`);
    L.push(`  }`);
  }
  L.push(`  return JSON.stringify({ list: vods });`);
  L.push(`}`);
  L.push(``);

  // ---- play
  L.push(`function play(flag, id, flags) {`);
  L.push(`  // 先试着从页面 HTML 里直接找 m3u8/mp4（有些站 SSR 了播放地址）`);
  L.push(`  try {`);
  L.push(`    var html = req(id, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;`);
  L.push(`    var m = html.match(/https?:\\/\\/[^"'\\s\\\\]+?\\.(?:m3u8|mp4)[^"'\\s\\\\]*/i);`);
  L.push(`    if (m) {`);
  L.push(`      console.log('[s2s] play 直接命中: ' + m[0]);`);
  L.push(`      return JSON.stringify({ parse: 0, url: m[0].replace(/\\\\\\//g, '/'), header: { 'Referer': HOST + '/', 'User-Agent': 'Mozilla/5.0' } });`);
  L.push(`    }`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] play 拉页面失败: ' + e.message);`);
  L.push(`  }`);
  L.push(`  // 兜底：parse:1 让 FongMi 用内置解析/嗅探打开页面`);
  L.push(`  return JSON.stringify({ parse: 1, url: id, header: { 'Referer': HOST + '/' } });`);
  L.push(`}`);
  L.push(``);

  L.push(`function isVideoFormat(url) {`);
  L.push(`  return /\\.(m3u8|mp4|flv|avi|mkv|ts)(\\?|$)/i.test(url);`);
  L.push(`}`);
  L.push(``);
  L.push(`function manualVideoCheck() { return false; }`);
  L.push(``);

  // ---- 必须的导出
  L.push(`// FongMi 的 QuickJS 只认这个导出。缺了它 Spider.init 会 NPE。`);
  L.push(`export function __jsEvalReturn() {`);
  L.push(`  return {`);
  L.push(`    init: init,`);
  L.push(`    home: home,`);
  L.push(`    homeVod: homeVod,`);
  L.push(`    category: category,`);
  L.push(`    detail: detail,`);
  L.push(`    play: play,`);
  L.push(`    search: search,`);
  L.push(`    isVideoFormat: isVideoFormat,`);
  L.push(`    manualVideoCheck: manualVideoCheck,`);
  L.push(`  };`);
  L.push(`}`);

  return L.join("\n");
}
