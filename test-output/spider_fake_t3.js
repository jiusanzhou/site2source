// site2source-ext 生成的 FongMi/TVBox T3 JS spider
// Site: http://10.0.2.2:8877
// Generated: 2026-08-01T21:28:18.030Z
//
// 用法：TVBox 配置 sites[].type=3, api 指向本文件 URL

import * as cheerio from 'assets://js/lib/cat.js';

var rule = {
  title: '测试影视',
  host: 'http://10.0.2.2:8877',
};

var HOST = 'http://10.0.2.2:8877';

function init(cfg) {
  console.log('[s2s] init ' + HOST);
}

function home(filter) {
  var classes = [
    { type_id: '/', type_name: '首页' },
    { type_id: '/index.html', type_name: '电影' },
  ];
  return JSON.stringify({ class: classes });
}

function homeVod() {
  return JSON.stringify({ list: [] });
}

// 从 HTML 抽卡片。FongMi 没有 pdfh/pdfa，用 cheerio。
function parseList(html, selector) {
  var vods = [];
  try {
    var $ = cheerio.load(html);
    $(selector).each(function (i, el) {
      var $el = $(el);
      var a = $el.is('a') ? $el : $el.find('a').first();
      var href = a.attr('href') || '';
      if (!href) return;
      var img = $el.find('img').first();
      var name = a.attr('title') || $el.attr('title') || img.attr('alt') || $el.text().trim();
      var pic = img.attr('data-original') || img.attr('data-src') || img.attr('src') || '';
      if (pic && pic.indexOf('http') !== 0) pic = joinUrl(HOST, pic);
      if (href.indexOf('http') !== 0) href = joinUrl(HOST, href);
      if (!name) return;
      vods.push({
        vod_id: href,
        vod_name: name.substring(0, 60),
        vod_pic: pic,
        vod_remarks: ($el.find('[class*=remark],[class*=note],[class*=episode]').first().text() || '').trim(),
      });
    });
  } catch (e) {
    console.log('[s2s] parseList 失败: ' + e.message);
  }
  return vods;
}

function category(tid, pg, filter, extend) {
  if (!pg) pg = 1;
  var url = tid.indexOf('http') === 0 ? tid : joinUrl(HOST, tid);
  if (pg > 1) url += (url.indexOf('?') > -1 ? '&' : '?') + 'page=' + pg;
  var vods = [];
  try {
    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;
    vods = parseList(html, 'div.module-list a.module-item');
    // selector 抓空时退化成"找所有含 /play/ 的链接"
    if (!vods.length) vods = parseList(html, 'a[href*="/play/"],a[href*="/detail"],a[href*="/watch"]');
  } catch (e) {
    console.log('[s2s] category 失败: ' + e.message);
  }
  return JSON.stringify({ list: vods, page: pg, pagecount: vods.length ? pg + 1 : pg, limit: 20, total: 999 });
}

function detail(id) {
  // 详情 API 常带签名，不去硬解。页面 URL 直接当播放源，播放时嗅探。
  var url = id.indexOf('http') === 0 ? id : joinUrl(HOST, id);
  var name = '', pic = '', desc = '';
  try {
    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;
    var $ = cheerio.load(html);
    name = ($('h1,h4,.title').first().text() || $('title').text() || '').trim();
    pic = $('meta[property="og:image"]').attr('content') || '';
    desc = ($('meta[name="description"]').attr('content') || '').trim();
  } catch (e) {
    console.log('[s2s] detail 拉页面失败: ' + e.message);
  }
  var vod = {
    vod_id: id,
    vod_name: name || '未知',
    vod_pic: pic,
    vod_content: desc,
    vod_play_from: '嗅探',
    vod_play_url: '正片$' + url,
  };
  return JSON.stringify({ list: [vod] });
}

function search(wd, quick, pg) {
  var vods = [];
  try {
    var url = joinUrl(HOST, '/search.html?wd={wd}'.replace('{wd}', encodeURIComponent(wd)));
    var html = req(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;
    vods = parseList(html, 'div.module-list a.module-item');
    if (!vods.length) vods = parseList(html, 'a[href*="/play/"],a[href*="/detail"]');
  } catch (e) {
    console.log('[s2s] search 失败: ' + e.message);
  }
  return JSON.stringify({ list: vods });
}

function play(flag, id, flags) {
  // 先试着从页面 HTML 里直接找 m3u8/mp4（有些站 SSR 了播放地址）
  try {
    var html = req(id, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': HOST + '/' } }).content;
    var m = html.match(/https?:\/\/[^"'\s\\]+?\.(?:m3u8|mp4)[^"'\s\\]*/i);
    if (m) {
      console.log('[s2s] play 直接命中: ' + m[0]);
      return JSON.stringify({ parse: 0, url: m[0].replace(/\\\//g, '/'), header: { 'Referer': HOST + '/', 'User-Agent': 'Mozilla/5.0' } });
    }
  } catch (e) {
    console.log('[s2s] play 拉页面失败: ' + e.message);
  }
  // 兜底：parse:1 让 FongMi 用内置解析/嗅探打开页面
  return JSON.stringify({ parse: 1, url: id, header: { 'Referer': HOST + '/' } });
}

function isVideoFormat(url) {
  return /\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i.test(url);
}

function manualVideoCheck() { return false; }

// FongMi 的 QuickJS 只认这个导出。缺了它 Spider.init 会 NPE。
export function __jsEvalReturn() {
  return {
    init: init,
    home: home,
    homeVod: homeVod,
    category: category,
    detail: detail,
    play: play,
    search: search,
    isVideoFormat: isVideoFormat,
    manualVideoCheck: manualVideoCheck,
  };
}