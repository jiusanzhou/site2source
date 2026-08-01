// site2source-ext — aiyifan API 型 T3 spider
// Generated: 2026-08-01T21:47:49.592Z
//
// 全部走带签名的 API，不依赖 HTML（本站是纯 CSR，HTML 是空壳）
// 签名: vv = md5(pub + '&' + query.toLowerCase() + '&' + privateKey[pub % 4])
//
// 一级: v3/home/getAllVideo  (聚合接口，分类=返回字段，size 可到 1000)
// 搜索: v3/list/briefsearch
// 播放: v3/video/play       (直出 mp4/HLS)
// 详情: 拿不到剧集列表 (需 cert 模式签名)，只播正片

import * as cheerio from 'assets://js/lib/cat.js';

var API = 'https://m10.aiyifan.tv';
var RANK = 'https://rankv21.aiyifan.tv';
var SITE = 'https://www.aiyifan.tv';
var PKS = ['version001', 'versi0n001', 'versio_001', 'version0o1'];
var HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Referer': SITE + '/',
  'Origin': SITE,
};

// 栏目字段 → 分类名
var CATS = [
  { id: 'filmList', name: '电影' },
  { id: 'tvList', name: '剧集' },
  { id: 'varietyList', name: '综艺' },
  { id: 'animeList', name: '动漫' },
  { id: 'shortList', name: '短剧' },
  { id: 'documentaryList', name: '纪录片' },
  { id: 'sportList', name: '体育' },
];

// 一次拉回来的聚合数据缓存（避免每个分类都重新请求）
var CACHE = null;
var CACHE_AT = 0;

function signedUrl(base, path, query) {
  var pub = '' + Date.now();
  var pk = PKS[Number(pub) % PKS.length];
  var vv = md5X(pub + '&' + query.toLowerCase() + '&' + pk);
  return base + '/' + path + '?' + query + '&vv=' + vv + '&pub=' + pub;
}

function apiGet(base, path, query) {
  var url = signedUrl(base, path, query);
  var res = req(url, { headers: HDR });
  var body = res.content || res;
  try {
    var j = typeof body === 'string' ? JSON.parse(body) : body;
    if (j && j.data && j.data.code === 0) return j.data.info;
    console.log('[s2s] api ' + path + ' code=' + (j && j.data && j.data.code) + ' msg=' + (j && j.data && j.data.msg));
  } catch (e) {
    console.log('[s2s] api ' + path + ' parse 失败: ' + e.message);
  }
  return null;
}

// API item → TVBox vod
// 注意：两个接口字段名不一样，必须都兼容：
//   getAllVideo : key    / image   / rating(评分字符串 "8.3")
//   briefsearch : contxt / imgPath / score(评分) + rating(热度数字!)
// 早期版本直接用 it.key/it.image/it.rating → 搜索结果 vod_id=undefined
// 而且把热度数字 769 当成了评分显示。
function toVod(it) {
  var id = it.key || it.contxt || '';
  var pic = it.image || it.imgPath || '';
  // score 优先（搜索接口）；getAllVideo 的 rating 才是评分字符串
  var score = it.score || (typeof it.rating === 'string' ? it.rating : '');
  var remarks = it.lastName ? ('更新至' + it.lastName) : (it.cid || it.atypeName || '');
  if (score) remarks = remarks ? (remarks + ' · ' + score) : score;
  if (it.vipResource) remarks = remarks + ' ' + it.vipResource;
  return {
    vod_id: id,
    vod_name: it.title,
    vod_pic: pic,
    vod_year: it.year ? ('' + it.year) : '',
    vod_area: it.regional || '',
    vod_remarks: remarks,
  };
}

function init(cfg) { console.log('[s2s] aiyifan api spider init'); }

function home(filter) {
  var classes = CATS.map(function (c) { return { type_id: c.id, type_name: c.name }; });
  return JSON.stringify({ class: classes });
}

function homeVod() {
  // 首页推荐用电影栏目前 20 条
  var agg = loadAll();
  var list = (agg && agg.filmList ? agg.filmList : []).slice(0, 20).map(toVod);
  return JSON.stringify({ list: list });
}

// getAllVideo 是聚合接口，一次拿全部栏目。10 分钟缓存。
function loadAll() {
  var now = Date.now();
  if (CACHE && now - CACHE_AT < 600000) return CACHE;
  var info = apiGet(API, 'v3/home/getAllVideo', 'cinema=1&page=1&size=100&region=SG');
  var agg = info && info[0] ? info[0] : null;
  if (agg) { CACHE = agg; CACHE_AT = now; }
  return agg;
}

function category(tid, pg, filter, extend) {
  if (!pg) pg = 1;
  var PAGE = 30;
  var agg = loadAll();
  var all = (agg && agg[tid]) ? agg[tid] : [];
  // API 的 page 参数无效（实测 page=1/2/3 返回一样），改本地切片
  var start = (pg - 1) * PAGE;
  var list = all.slice(start, start + PAGE).map(toVod);
  var pagecount = Math.max(1, Math.ceil(all.length / PAGE));
  return JSON.stringify({
    list: list, page: pg, pagecount: pagecount, limit: PAGE, total: all.length,
  });
}

function detail(id) {
  // v3/video/detail 需要 cert 模式签名（pConfig），拿不到 → 用聚合缓存里的元数据补
  var meta = null;
  var agg = loadAll();
  if (agg) {
    var fields = CATS.map(function (c) { return c.id; });
    for (var i = 0; i < fields.length && !meta; i++) {
      var arr = agg[fields[i]] || [];
      for (var k = 0; k < arr.length; k++) {
        // 搜索来的 id 是 contxt，聚合里是 key，两边都比
        if (arr[k].key === id || arr[k].contxt === id) { meta = arr[k]; break; }
      }
    }
  }
  var vod = {
    vod_id: id,
    vod_name: meta ? meta.title : id,
    vod_pic: meta ? (meta.image || meta.imgPath || '') : '',
    vod_year: meta && meta.year ? ('' + meta.year) : '',
    vod_area: meta ? (meta.regional || '') : '',
    vod_actor: meta ? (meta.starring || '') : '',
    vod_director: meta ? (meta.directed || '') : '',
    vod_content: meta ? (meta.shortDes || '') : '',
    vod_play_from: 'aiyifan',
    // 剧集列表要 cert 签名，拿不到 → 只给正片
    vod_play_url: '正片$' + id,
  };
  return JSON.stringify({ list: [vod] });
}

function search(wd, quick, pg) {
  if (!pg) pg = 1;
  var q = 'tags=' + encodeURIComponent(wd) +
    '&orderby=4&page=' + pg + '&size=20&desc=0&isserial=-1&istitle=true';
  var info = apiGet(RANK, 'v3/list/briefsearch', q);
  var list = [];
  if (info && info[0] && info[0].result) {
    list = info[0].result.map(toVod);
  }
  return JSON.stringify({ list: list });
}

function play(flag, id, flags) {
  var q = 'cinema=1&id=' + id +
    '&a=1&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1';
  var info = apiGet(API, 'v3/video/play', q);
  var url = '';
  if (info && info[0]) {
    var d = info[0];
    // 优先 HLS（m3u8），退回 mp4
    var pick = function (arr) {
      if (!arr || !arr.length) return '';
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].result) return arr[i].result;
      }
      return '';
    };
    url = pick(d.hlsPathList) || pick(d.flvPathList) || pick(d.mp4PathList) || '';
  }
  if (url) {
    console.log('[s2s] play 命中: ' + url);
    return JSON.stringify({
      parse: 0, url: url,
      header: { 'User-Agent': HDR['User-Agent'], 'Referer': SITE + '/' },
    });
  }
  // API 没给地址。常见原因是 play 端点配额耗尽（"访问过量"/"用户签名错误"），
  // 不是签名算错 —— getAllVideo/briefsearch 此时通常还是通的。
  // 退回前端播放页，让 FongMi 嗅探真实流。
  console.log('[s2s] play API 无地址（可能配额耗尽），退回嗅探');
  return JSON.stringify({
    parse: 1,
    url: SITE + '/play/' + id,
    header: { 'User-Agent': HDR['User-Agent'], 'Referer': SITE + '/' },
  });
}

function isVideoFormat(url) { return /\.(m3u8|mp4|flv|mkv|ts)(\?|$)/i.test(url); }
function manualVideoCheck() { return false; }

export function __jsEvalReturn() {
  return {
    init: init, home: home, homeVod: homeVod, category: category,
    detail: detail, play: play, search: search,
    isVideoFormat: isVideoFormat, manualVideoCheck: manualVideoCheck,
  };
}