/**
 * aiyifan API 方案 —— 修正之前"API 抓不到"的错误结论
 *
 * ## 之前错在哪
 * 我拿浏览器抓包里的 api/List/GuessYouLike，去掉 vv/pub 后直接请求 → "用户签名错误"，
 * 就下结论"签名破不了 → API 型 spider 不可用"。
 * 错误在于：**不该去掉签名，而是该自己算签名**。timestamp 模式的签名早就逆出来了。
 *
 * ## 实测可用的端点（timestamp 模式签名，无需 pConfig/cert）
 * 1. v3/home/getAllVideo   ← 分类列表，一次返回所有栏目，size 可到 1000
 * 2. v3/list/briefsearch   ← 搜索
 * 3. v3/video/play         ← 播放地址，直出 mp4/HLS
 *
 * ## 签名算法
 *   pub = Date.now()
 *   privateKey = ["version001","versi0n001","versio_001","version0o1"][pub % 4]
 *   vv = md5(pub + "&" + query.toLowerCase() + "&" + privateKey)
 * query 是不含 vv/pub 的原始 query string。
 *
 * ## getAllVideo 的特殊之处
 * 它是首页聚合接口：一次返回 filmList/tvList/varietyList/animeList/
 * documentaryList/sportList/shortList 等栏目。
 * - cid 参数被忽略（cid=1..8 返回完全一样）
 * - page 参数被忽略（page=1/2/3 完全一样）
 * - size 有效，实测 size=1000 每个栏目都给 1000 条
 * 所以「分类」= 返回对象的不同字段，不是不同请求。
 * 翻页策略：一次拉 size=1000 缓存，本地切片。
 *
 * ## 仍然打不开的
 * v3/video/detail 和 v3/video/languagesplaylist 要 cert 模式签名（pConfig），
 * 所以拿不到剧集列表。但 video/play 能直出播放地址，"能播"这个目标达成。
 *
 * ## 坑：video/play 有独立调用配额
 * 短时间连续调 20+ 次后返回 `{"code":1,"msg":"访问过量"}`，
 * 而且**有时报的是 "用户签名错误"** —— 错误消息会误导人以为签名算错了。
 * 排查方法：同时测 getAllVideo/briefsearch，如果那两个还通就说明签名没问题，
 * 只是 play 端点被限了。冷却几分钟自动恢复。
 * 所以 play() 里必须有降级路径（退回前端页面嗅探），不能只依赖 API。
 */

/** 栏目字段 → 中文分类名 */
export const AIYIFAN_CATEGORIES: { field: string; name: string }[] = [
  { field: "filmList", name: "电影" },
  { field: "tvList", name: "剧集" },
  { field: "varietyList", name: "综艺" },
  { field: "animeList", name: "动漫" },
  { field: "shortList", name: "短剧" },
  { field: "documentaryList", name: "纪录片" },
  { field: "sportList", name: "体育" },
];

/** 生成 aiyifan 专用 T3 spider（API 型，全走签名 API） */
export function generateAiyifanT3Spider(): string {
  const L: string[] = [];

  L.push(`// site2source-ext — aiyifan API 型 T3 spider`);
  L.push(`// Generated: ${new Date().toISOString()}`);
  L.push(`//`);
  L.push(`// 全部走带签名的 API，不依赖 HTML（本站是纯 CSR，HTML 是空壳）`);
  L.push(`// 签名: vv = md5(pub + '&' + query.toLowerCase() + '&' + privateKey[pub % 4])`);
  L.push(`//`);
  L.push(`// 一级: v3/home/getAllVideo  (聚合接口，分类=返回字段，size 可到 1000)`);
  L.push(`// 搜索: v3/list/briefsearch`);
  L.push(`// 播放: v3/video/play       (直出 mp4/HLS)`);
  L.push(`// 详情: 拿不到剧集列表 (需 cert 模式签名)，只播正片`);
  L.push(``);
  L.push(`import * as cheerio from 'assets://js/lib/cat.js';`);
  L.push(``);
  L.push(`var API = 'https://m10.aiyifan.tv';`);
  L.push(`var RANK = 'https://rankv21.aiyifan.tv';`);
  L.push(`var SITE = 'https://www.aiyifan.tv';`);
  L.push(`var PKS = ['version001', 'versi0n001', 'versio_001', 'version0o1'];`);
  L.push(`var HDR = {`);
  L.push(`  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',`);
  L.push(`  'Referer': SITE + '/',`);
  L.push(`  'Origin': SITE,`);
  L.push(`};`);
  L.push(``);
  L.push(`// 栏目字段 → 分类名`);
  L.push(`var CATS = [`);
  for (const c of AIYIFAN_CATEGORIES) {
    L.push(`  { id: '${c.field}', name: '${c.name}' },`);
  }
  L.push(`];`);
  L.push(``);
  L.push(`// 一次拉回来的聚合数据缓存（避免每个分类都重新请求）`);
  L.push(`var CACHE = null;`);
  L.push(`var CACHE_AT = 0;`);
  L.push(``);

  // 签名
  L.push(`function signedUrl(base, path, query) {`);
  L.push(`  var pub = '' + Date.now();`);
  L.push(`  var pk = PKS[Number(pub) % PKS.length];`);
  L.push(`  var vv = md5X(pub + '&' + query.toLowerCase() + '&' + pk);`);
  L.push(`  return base + '/' + path + '?' + query + '&vv=' + vv + '&pub=' + pub;`);
  L.push(`}`);
  L.push(``);
  L.push(`function apiGet(base, path, query) {`);
  L.push(`  var url = signedUrl(base, path, query);`);
  L.push(`  var res = req(url, { headers: HDR });`);
  L.push(`  var body = res.content || res;`);
  L.push(`  try {`);
  L.push(`    var j = typeof body === 'string' ? JSON.parse(body) : body;`);
  L.push(`    if (j && j.data && j.data.code === 0) return j.data.info;`);
  L.push(`    console.log('[s2s] api ' + path + ' code=' + (j && j.data && j.data.code) + ' msg=' + (j && j.data && j.data.msg));`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] api ' + path + ' parse 失败: ' + e.message);`);
  L.push(`  }`);
  L.push(`  return null;`);
  L.push(`}`);
  L.push(``);

  // item → vod
  L.push(`// API item → TVBox vod`);
  L.push(`// 注意：两个接口字段名不一样，必须都兼容：`);
  L.push(`//   getAllVideo : key    / image   / rating(评分字符串 "8.3")`);
  L.push(`//   briefsearch : contxt / imgPath / score(评分) + rating(热度数字!)`);
  L.push(`// 早期版本直接用 it.key/it.image/it.rating → 搜索结果 vod_id=undefined`);
  L.push(`// 而且把热度数字 769 当成了评分显示。`);
  L.push(`function toVod(it) {`);
  L.push(`  var id = it.key || it.contxt || '';`);
  L.push(`  var pic = it.image || it.imgPath || '';`);
  L.push(`  // score 优先（搜索接口）；getAllVideo 的 rating 才是评分字符串`);
  L.push(`  var score = it.score || (typeof it.rating === 'string' ? it.rating : '');`);
  L.push(`  var remarks = it.lastName ? ('更新至' + it.lastName) : (it.cid || it.atypeName || '');`);
  L.push(`  if (score) remarks = remarks ? (remarks + ' · ' + score) : score;`);
  L.push(`  if (it.vipResource) remarks = remarks + ' ' + it.vipResource;`);
  L.push(`  return {`);
  L.push(`    vod_id: id,`);
  L.push(`    vod_name: it.title,`);
  L.push(`    vod_pic: pic,`);
  L.push(`    vod_year: it.year ? ('' + it.year) : '',`);
  L.push(`    vod_area: it.regional || '',`);
  L.push(`    vod_remarks: remarks,`);
  L.push(`  };`);
  L.push(`}`);
  L.push(``);

  L.push(`function init(cfg) { console.log('[s2s] aiyifan api spider init'); }`);
  L.push(``);
  L.push(`function home(filter) {`);
  L.push(`  var classes = CATS.map(function (c) { return { type_id: c.id, type_name: c.name }; });`);
  L.push(`  return JSON.stringify({ class: classes });`);
  L.push(`}`);
  L.push(``);
  L.push(`function homeVod() {`);
  L.push(`  // 首页推荐用电影栏目前 20 条`);
  L.push(`  var agg = loadAll();`);
  L.push(`  var list = (agg && agg.filmList ? agg.filmList : []).slice(0, 20).map(toVod);`);
  L.push(`  return JSON.stringify({ list: list });`);
  L.push(`}`);
  L.push(``);

  // 聚合加载 + 缓存
  L.push(`// getAllVideo 是聚合接口，一次拿全部栏目。10 分钟缓存。`);
  L.push(`function loadAll() {`);
  L.push(`  var now = Date.now();`);
  L.push(`  if (CACHE && now - CACHE_AT < 600000) return CACHE;`);
  // size=1000 时响应 4.6MB，QuickJS 解析会挂（真机实测：日志停在 body len=4646979 后无输出）。
  // size=100 约 460KB，7 个栏目各 100 条 = 700 部，对 TVBox 浏览完全够用。
  L.push(`  var info = apiGet(API, 'v3/home/getAllVideo', 'cinema=1&page=1&size=100&region=SG');`);
  L.push(`  var agg = info && info[0] ? info[0] : null;`);
  L.push(`  if (agg) { CACHE = agg; CACHE_AT = now; }`);
  L.push(`  return agg;`);
  L.push(`}`);
  L.push(``);

  // category：从聚合数据切片
  L.push(`function category(tid, pg, filter, extend) {`);
  L.push(`  if (!pg) pg = 1;`);
  L.push(`  var PAGE = 30;`);
  L.push(`  var agg = loadAll();`);
  L.push(`  var all = (agg && agg[tid]) ? agg[tid] : [];`);
  L.push(`  // API 的 page 参数无效（实测 page=1/2/3 返回一样），改本地切片`);
  L.push(`  var start = (pg - 1) * PAGE;`);
  L.push(`  var list = all.slice(start, start + PAGE).map(toVod);`);
  L.push(`  var pagecount = Math.max(1, Math.ceil(all.length / PAGE));`);
  L.push(`  return JSON.stringify({`);
  L.push(`    list: list, page: pg, pagecount: pagecount, limit: PAGE, total: all.length,`);
  L.push(`  });`);
  L.push(`}`);
  L.push(``);

  // detail
  L.push(`function detail(id) {`);
  L.push(`  // v3/video/detail 需要 cert 模式签名（pConfig），拿不到 → 用聚合缓存里的元数据补`);
  L.push(`  var meta = null;`);
  L.push(`  var agg = loadAll();`);
  L.push(`  if (agg) {`);
  L.push(`    var fields = CATS.map(function (c) { return c.id; });`);
  L.push(`    for (var i = 0; i < fields.length && !meta; i++) {`);
  L.push(`      var arr = agg[fields[i]] || [];`);
  L.push(`      for (var k = 0; k < arr.length; k++) {`);
  L.push(`        // 搜索来的 id 是 contxt，聚合里是 key，两边都比`);
  L.push(`        if (arr[k].key === id || arr[k].contxt === id) { meta = arr[k]; break; }`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(`  var vod = {`);
  L.push(`    vod_id: id,`);
  L.push(`    vod_name: meta ? meta.title : id,`);
  L.push(`    vod_pic: meta ? (meta.image || meta.imgPath || '') : '',`);
  L.push(`    vod_year: meta && meta.year ? ('' + meta.year) : '',`);
  L.push(`    vod_area: meta ? (meta.regional || '') : '',`);
  L.push(`    vod_actor: meta ? (meta.starring || '') : '',`);
  L.push(`    vod_director: meta ? (meta.directed || '') : '',`);
  L.push(`    vod_content: meta ? (meta.shortDes || '') : '',`);
  L.push(`    vod_play_from: 'aiyifan',`);
  L.push(`    // 剧集列表要 cert 签名，拿不到 → 只给正片`);
  L.push(`    vod_play_url: '正片$' + id,`);
  L.push(`  };`);
  L.push(`  return JSON.stringify({ list: [vod] });`);
  L.push(`}`);
  L.push(``);

  // search
  L.push(`function search(wd, quick, pg) {`);
  L.push(`  if (!pg) pg = 1;`);
  L.push(`  var q = 'tags=' + encodeURIComponent(wd) +`);
  L.push(`    '&orderby=4&page=' + pg + '&size=20&desc=0&isserial=-1&istitle=true';`);
  L.push(`  var info = apiGet(RANK, 'v3/list/briefsearch', q);`);
  L.push(`  var list = [];`);
  L.push(`  if (info && info[0] && info[0].result) {`);
  L.push(`    list = info[0].result.map(toVod);`);
  L.push(`  }`);
  L.push(`  return JSON.stringify({ list: list });`);
  L.push(`}`);
  L.push(``);

  // play
  L.push(`function play(flag, id, flags) {`);
  L.push(`  var q = 'cinema=1&id=' + id +`);
  L.push(`    '&a=1&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1';`);
  L.push(`  var info = apiGet(API, 'v3/video/play', q);`);
  L.push(`  var url = '';`);
  L.push(`  if (info && info[0]) {`);
  L.push(`    var d = info[0];`);
  L.push(`    // 优先 HLS（m3u8），退回 mp4`);
  L.push(`    var pick = function (arr) {`);
  L.push(`      if (!arr || !arr.length) return '';`);
  L.push(`      for (var i = 0; i < arr.length; i++) {`);
  L.push(`        if (arr[i] && arr[i].result) return arr[i].result;`);
  L.push(`      }`);
  L.push(`      return '';`);
  L.push(`    };`);
  L.push(`    url = pick(d.hlsPathList) || pick(d.flvPathList) || pick(d.mp4PathList) || '';`);
  L.push(`  }`);
  L.push(`  if (url) {`);
  L.push(`    console.log('[s2s] play 命中: ' + url);`);
  L.push(`    return JSON.stringify({`);
  L.push(`      parse: 0, url: url,`);
  L.push(`      header: { 'User-Agent': HDR['User-Agent'], 'Referer': SITE + '/' },`);
  L.push(`    });`);
  L.push(`  }`);
  L.push(`  // API 没给地址。常见原因是 play 端点配额耗尽（"访问过量"/"用户签名错误"），`);
  L.push(`  // 不是签名算错 —— getAllVideo/briefsearch 此时通常还是通的。`);
  L.push(`  // 退回前端播放页，让 FongMi 嗅探真实流。`);
  L.push(`  console.log('[s2s] play API 无地址（可能配额耗尽），退回嗅探');`);
  L.push(`  return JSON.stringify({`);
  L.push(`    parse: 1,`);
  L.push(`    url: SITE + '/play/' + id,`);
  L.push(`    header: { 'User-Agent': HDR['User-Agent'], 'Referer': SITE + '/' },`);
  L.push(`  });`);
  L.push(`}`);
  L.push(``);
  L.push(`function isVideoFormat(url) { return /\\.(m3u8|mp4|flv|mkv|ts)(\\?|$)/i.test(url); }`);
  L.push(`function manualVideoCheck() { return false; }`);
  L.push(``);
  L.push(`export function __jsEvalReturn() {`);
  L.push(`  return {`);
  L.push(`    init: init, home: home, homeVod: homeVod, category: category,`);
  L.push(`    detail: detail, play: play, search: search,`);
  L.push(`    isVideoFormat: isVideoFormat, manualVideoCheck: manualVideoCheck,`);
  L.push(`  };`);
  L.push(`}`);

  return L.join("\n");
}
