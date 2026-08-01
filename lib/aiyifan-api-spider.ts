/**
 * aiyifan API 型 T3 spider — 2026-08-02 定稿
 *
 * ## 一晚上完整的心路：从「打不通」→「打通了」→「剧集也拿到了」
 *
 * ### 第一次错判：签名逆不出来
 * 拿浏览器抓包的 URL 去掉 vv/pub 直接请求 → "用户签名错误" →
 * 结论"签名破不了，API 型不可用"。
 * 错在：不该去掉签名，该**自己算签名**。
 *
 * ### 第二次错判：以为只有 4 个私钥
 * 从 bundle 抄了 4 个私钥，`pk = KEYS[pub % 4]`，大部分请求通过，
 * 于是以为 "getAllVideo/briefsearch/play 都能用 timestamp 模式；
 * detail/剧集列表要 cert，拿不到"。
 * 错在：bundle 里私钥其实有 **8 个**，形近字符混淆
 * (version001 / vers1on001 / bersion001 / vcrsion001 ...)，
 * 我只抄了一半 → 一半请求签错 → 报"用户签名错误" → 我把它归给端点特性。
 * 补齐 8 个后 detail 也是稳的。
 *
 * ### 第三次发现：真正需要 cert 的场景
 * 用户提示 "浏览器直接打开播放页试试"，浏览器控制台看到浏览器发的 pub 是
 * 150 字符的加密串，不是 timestamp。分析 bundle 源码:
 *
 *     if (t.publicKey === "") {
 *       let e = window.pConfig;
 *       if (e) {
 *         t.publicKey = e.publicKey;           // cert 模式：pub = pConfig.publicKey
 *         t.privateKey = [e.privateKey];       // pk = pConfig.privateKey (只一个)
 *       } else {
 *         let a = Date.now();
 *         t.publicKey = a + "";                // fallback: timestamp
 *         t.publicKeyInedx = a;
 *       }
 *     }
 *     getPrivateKey() { return t.privateKey[t.publicKeyInedx % t.privateKey.length]; }
 *
 * 结论:
 * - 优先 cert 模式（pConfig）
 * - 无 pConfig 才 fallback 到 timestamp（此时 privateKey 数组是 bundle 硬编码的 8 个）
 * - **video/play 用集 key 时**必须 cert，用专辑 key + a=1 可以 timestamp
 *
 * ### pConfig 从哪拿
 * 端点 `v3/home/config?cinema=1` 用 timestamp 模式即可访问（这是 bootstrap），
 * 返回真实 pConfig。spider 启动时先跑一遍 bootstrap 拿到 pConfig 后缓存。
 *
 * ## 端点清单（全部实测通过）
 * - v3/home/config              (bootstrap, timestamp)   → pConfig
 * - v3/home/getAllVideo         (timestamp)              → 首页聚合，7 栏目
 * - v3/list/briefsearch         (timestamp, rankv21)     → 搜索
 * - v3/video/detail             (timestamp/cert 都可)    → 详情元数据
 * - v3/video/languagesplaylist  (timestamp/cert 都可)    → 剧集列表
 *     参数: cinema=1&vid={专辑key}&lsk=1&taxis=0&cid={detail.cid}
 *     返回 info[0].playList[] = [{name:"01",key:"K76UeiYIRr3",id:1521790}, ...]
 * - v3/video/play               (a=0 切集时必须 cert)    → 播放地址
 *     参数: cinema=1&id={集key}&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1
 *
 * ## 播放地址挑选
 * play 响应字段:
 * - flvPathList[0] = **广告 mp4**（浏览器会先播 5 秒广告再切）
 * - flvPathList[1] = 真视频 m3u8 (isHls: true)
 * - clarity[i].path.result = 真视频（free 用户只有 isEnabled:true 的一档）
 * 挑选优先级: clarity(enabled) → hls/flv/mp4 List 里 isHls:true 项 → 任意非空
 *
 * ## 已知限制
 * - getAllVideo 的 page 参数无效 → 本地切片翻页
 * - size=1000 响应 4.6MB，QuickJS JSON.parse 会挂 → 降到 100
 * - video/play 有 IP+端点级配额，短时间频繁调触发"访问过量"，
 *   错误消息有时报"用户签名错误"（会误导）→ 保留嗅探降级
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
  L.push(`// 完整签名双模:`);
  L.push(`//   1. timestamp: pub=Date.now(), pk=PKS_TS[pub%8], vv=md5(pub+'&'+q+'&'+pk)`);
  L.push(`//   2. cert:      pub=pConfig.publicKey, pk=pConfig.privateKey[0], 同公式`);
  L.push(`// video/play 用集 key 时必须 cert; 其他端点两者都行, 但 cert 更稳。`);
  L.push(`//`);
  L.push(`// 剧集列表: v3/video/languagesplaylist?cinema=1&vid={key}&lsk=1&taxis=0&cid={cid}`);
  L.push(`// 每集 play: v3/video/play?cinema=1&id={集key}&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1`);
  L.push(``);
  L.push(`import * as cheerio from 'assets://js/lib/cat.js';`);
  L.push(``);
  L.push(`var API = 'https://m10.aiyifan.tv';`);
  L.push(`var RANK = 'https://rankv21.aiyifan.tv';`);
  L.push(`var SITE = 'https://www.aiyifan.tv';`);
  L.push(``);
  L.push(`// timestamp 模式的 8 个混淆密钥（形近字符攻击式命名）`);
  L.push(`var PKS_TS = [`);
  L.push(`  'version001', 'vers1on001', 'vers1on00i', 'bersion001',`);
  L.push(`  'vcrsion001', 'versi0n001', 'versio_001', 'version0o1',`);
  L.push(`];`);
  L.push(``);
  L.push(`var HDR = {`);
  L.push(`  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',`);
  L.push(`  'Referer': SITE + '/',`);
  L.push(`  'Origin': SITE,`);
  L.push(`  'Accept': 'application/json, text/plain, */*',`);
  L.push(`  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',`);
  L.push(`};`);
  L.push(``);
  L.push(`var CATS = [`);
  for (const c of AIYIFAN_CATEGORIES) {
    L.push(`  { id: '${c.field}', name: '${c.name}' },`);
  }
  L.push(`];`);
  L.push(``);
  L.push(`// pConfig 缓存: 首次 bootstrap 后长期有效`);
  L.push(`var PCONFIG = null;`);
  L.push(`// 首页聚合缓存（10 分钟）`);
  L.push(`var CACHE = null;`);
  L.push(`var CACHE_AT = 0;`);
  L.push(`// detail 缓存（key -> {cid, title, ...}）—— languagesplaylist 要 cid`);
  L.push(`var DETAIL_CACHE = {};`);
  L.push(``);

  // 签名函数
  L.push(`// 用 timestamp 模式签一个 URL（不需要 pConfig, 用于 bootstrap）`);
  L.push(`function signedUrlTS(base, path, query) {`);
  L.push(`  var pub = '' + Date.now();`);
  L.push(`  var pk = PKS_TS[Number(pub) % PKS_TS.length];`);
  L.push(`  var vv = md5X(pub + '&' + query.toLowerCase() + '&' + pk);`);
  L.push(`  return base + '/' + path + '?' + query + '&vv=' + vv + '&pub=' + pub;`);
  L.push(`}`);
  L.push(``);
  L.push(`// 用 cert 模式签一个 URL（pConfig 已就绪）`);
  L.push(`function signedUrlCert(base, path, query) {`);
  L.push(`  var pub = PCONFIG.publicKey;`);
  L.push(`  var pk = PCONFIG.privateKey[0];`);
  L.push(`  var vv = md5X(pub + '&' + query.toLowerCase() + '&' + pk);`);
  L.push(`  return base + '/' + path + '?' + query + '&vv=' + vv + '&pub=' + pub;`);
  L.push(`}`);
  L.push(``);
  L.push(`// bootstrap: 拿 pConfig（幂等）`);
  L.push(`function ensureBootstrap() {`);
  L.push(`  if (PCONFIG) return true;`);
  L.push(`  var url = signedUrlTS(API, 'v3/home/config', 'cinema=1');`);
  L.push(`  try {`);
  L.push(`    var res = req(url, { headers: HDR });`);
  L.push(`    var body = res.content || res;`);
  L.push(`    var j = typeof body === 'string' ? JSON.parse(body) : body;`);
  L.push(`    var info = j && j.data && j.data.info;`);
  L.push(`    var pc = info && info[0] && info[0].pConfig;`);
  L.push(`    if (pc && pc.publicKey && pc.privateKey && pc.privateKey.length) {`);
  L.push(`      // pConfig.privateKey 有时是字符串, 有时是数组, 统一成数组`);
  L.push(`      var pkArr = typeof pc.privateKey === 'string' ? [pc.privateKey] : pc.privateKey;`);
  L.push(`      PCONFIG = { publicKey: pc.publicKey, privateKey: pkArr };`);
  L.push(`      console.log('[s2s] bootstrap 完成，pConfig 已获取');`);
  L.push(`      return true;`);
  L.push(`    }`);
  L.push(`    console.log('[s2s] bootstrap 失败: pConfig 缺失，code=' + (j && j.data && j.data.code) + ' msg=' + (j && j.data && j.data.msg));`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] bootstrap 异常: ' + e.message);`);
  L.push(`  }`);
  L.push(`  return false;`);
  L.push(`}`);
  L.push(``);
  L.push(`// 通用 API 调用: mode='auto' 优先 cert, 失败退 timestamp`);
  L.push(`function apiGet(base, path, query, mode) {`);
  L.push(`  var useCert = (mode !== 'ts') && ensureBootstrap();`);
  L.push(`  var url = useCert ? signedUrlCert(base, path, query) : signedUrlTS(base, path, query);`);
  L.push(`  var res, body, j;`);
  L.push(`  try {`);
  L.push(`    res = req(url, { headers: HDR });`);
  L.push(`    body = res.content || res;`);
  L.push(`    j = typeof body === 'string' ? JSON.parse(body) : body;`);
  L.push(`    if (j && j.data && j.data.code === 0) return j.data.info;`);
  L.push(`    // cert 失败 → 试 timestamp（很少见, 保险起见）`);
  L.push(`    if (useCert && j && j.data && j.data.code !== 0) {`);
  L.push(`      console.log('[s2s] cert 失败, 试 timestamp: ' + path + ' msg=' + j.data.msg);`);
  L.push(`      var url2 = signedUrlTS(base, path, query);`);
  L.push(`      var res2 = req(url2, { headers: HDR });`);
  L.push(`      var body2 = res2.content || res2;`);
  L.push(`      var j2 = typeof body2 === 'string' ? JSON.parse(body2) : body2;`);
  L.push(`      if (j2 && j2.data && j2.data.code === 0) return j2.data.info;`);
  L.push(`      console.log('[s2s] api ' + path + ' 两种模式都失败: cert msg=' + j.data.msg + ' ts msg=' + (j2 && j2.data && j2.data.msg));`);
  L.push(`    } else {`);
  L.push(`      console.log('[s2s] api ' + path + ' code=' + (j && j.data && j.data.code) + ' msg=' + (j && j.data && j.data.msg));`);
  L.push(`    }`);
  L.push(`  } catch (e) {`);
  L.push(`    console.log('[s2s] api ' + path + ' 异常: ' + e.message);`);
  L.push(`  }`);
  L.push(`  return null;`);
  L.push(`}`);
  L.push(``);

  // item → vod
  L.push(`function toVod(it) {`);
  L.push(`  // getAllVideo 用 key/image/rating(评分字符串)`);
  L.push(`  // briefsearch 用 contxt/imgPath/score+rating(热度数字)`);
  L.push(`  var id = it.key || it.contxt || '';`);
  L.push(`  var pic = it.image || it.imgPath || '';`);
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

  L.push(`function init(cfg) {`);
  L.push(`  console.log('[s2s] aiyifan api spider init (cert+timestamp 双模)');`);
  L.push(`  ensureBootstrap();`);
  L.push(`}`);
  L.push(``);
  L.push(`function home(filter) {`);
  L.push(`  var classes = CATS.map(function (c) { return { type_id: c.id, type_name: c.name }; });`);
  L.push(`  return JSON.stringify({ class: classes });`);
  L.push(`}`);
  L.push(``);
  L.push(`function homeVod() {`);
  L.push(`  var agg = loadAll();`);
  L.push(`  var list = (agg && agg.filmList ? agg.filmList : []).slice(0, 20).map(toVod);`);
  L.push(`  return JSON.stringify({ list: list });`);
  L.push(`}`);
  L.push(``);
  L.push(`function loadAll() {`);
  L.push(`  var now = Date.now();`);
  L.push(`  if (CACHE && now - CACHE_AT < 600000) return CACHE;`);
  L.push(`  // size=100 = 约 460KB，size=1000 = 4.6MB 会挂 QuickJS`);
  L.push(`  var info = apiGet(API, 'v3/home/getAllVideo', 'cinema=1&page=1&size=100&region=SG');`);
  L.push(`  var agg = info && info[0] ? info[0] : null;`);
  L.push(`  if (agg) { CACHE = agg; CACHE_AT = now; }`);
  L.push(`  return agg;`);
  L.push(`}`);
  L.push(``);
  L.push(`function category(tid, pg, filter, extend) {`);
  L.push(`  if (!pg) pg = 1;`);
  L.push(`  var PAGE = 30;`);
  L.push(`  var agg = loadAll();`);
  L.push(`  var all = (agg && agg[tid]) ? agg[tid] : [];`);
  L.push(`  var start = (pg - 1) * PAGE;`);
  L.push(`  var list = all.slice(start, start + PAGE).map(toVod);`);
  L.push(`  var pagecount = Math.max(1, Math.ceil(all.length / PAGE));`);
  L.push(`  return JSON.stringify({`);
  L.push(`    list: list, page: pg, pagecount: pagecount, limit: PAGE, total: all.length,`);
  L.push(`  });`);
  L.push(`}`);
  L.push(``);

  // detail — 剧集列表来自 languagesplaylist
  L.push(`function detail(id) {`);
  L.push(`  // 1. 先拉 detail 拿元数据 + cid（languagesplaylist 需要 cid）`);
  L.push(`  var meta = null;`);
  L.push(`  var detailQ = 'cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id=' + id + '&region=SG';`);
  L.push(`  var dInfo = apiGet(API, 'v3/video/detail', detailQ);`);
  L.push(`  if (dInfo && dInfo[0]) {`);
  L.push(`    meta = dInfo[0];`);
  L.push(`    // cidMapper 是"悬疑,历险"这种; publishNavKey 才是原始 cid 路径 (如 "0,1,4,137")`);
  L.push(`    var cid = meta.publishNavKey || '0,1,4';`);
  L.push(`    DETAIL_CACHE[id] = { cid: cid, meta: meta };`);
  L.push(`  } else {`);
  L.push(`    // detail 失败: 用聚合缓存兜底`);
  L.push(`    var agg = loadAll();`);
  L.push(`    if (agg) {`);
  L.push(`      for (var i = 0; i < CATS.length && !meta; i++) {`);
  L.push(`        var arr = agg[CATS[i].id] || [];`);
  L.push(`        for (var k = 0; k < arr.length; k++) {`);
  L.push(`          if (arr[k].key === id || arr[k].contxt === id) { meta = arr[k]; break; }`);
  L.push(`        }`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`  }`);
  L.push(``);
  L.push(`  // 2. 拉剧集列表`);
  L.push(`  var epList = [];`);
  L.push(`  var cidForEp = (DETAIL_CACHE[id] && DETAIL_CACHE[id].cid) || (meta && meta.publishNavKey) || '0,1,4';`);
  L.push(`  var lplQ = 'cinema=1&vid=' + id + '&lsk=1&taxis=0&cid=' + cidForEp;`);
  L.push(`  var lplInfo = apiGet(API, 'v3/video/languagesplaylist', lplQ);`);
  L.push(`  if (lplInfo && lplInfo[0] && lplInfo[0].playList) {`);
  L.push(`    epList = lplInfo[0].playList;`);
  L.push(`  }`);
  L.push(``);
  L.push(`  // 3. 组装 vod_play_url: "名称$集key#名称$集key#..."`);
  L.push(`  var vodPlayUrl;`);
  L.push(`  if (epList.length) {`);
  L.push(`    var parts = epList.map(function (e) { return e.name + '$' + e.key; });`);
  L.push(`    vodPlayUrl = parts.join('#');`);
  L.push(`  } else {`);
  L.push(`    // 单集/电影: 用专辑 key 播`);
  L.push(`    vodPlayUrl = '正片$' + id;`);
  L.push(`  }`);
  L.push(``);
  L.push(`  var vod = {`);
  L.push(`    vod_id: id,`);
  L.push(`    vod_name: meta ? meta.title : id,`);
  L.push(`    vod_pic: meta ? (meta.image || meta.imgPath || '') : '',`);
  L.push(`    vod_year: meta && (meta.year || meta.post_Year) ? ('' + (meta.year || meta.post_Year)) : '',`);
  L.push(`    vod_area: meta ? (meta.regional || '') : '',`);
  L.push(`    vod_actor: meta ? (meta.starring || (meta.stars && meta.stars.join(',')) || '') : '',`);
  L.push(`    vod_director: meta ? (meta.directed || (meta.directors && meta.directors.join(',')) || '') : '',`);
  L.push(`    vod_content: meta ? (meta.shortDes || meta.contxt || '') : '',`);
  L.push(`    vod_remarks: meta && meta.serialCount ? ('共' + meta.serialCount + '集 更新至' + meta.lastName) : '',`);
  L.push(`    type_name: meta ? (meta.channel || meta.videoType || '') : '',`);
  L.push(`    vod_play_from: 'aiyifan',`);
  L.push(`    vod_play_url: vodPlayUrl,`);
  L.push(`  };`);
  L.push(`  return JSON.stringify({ list: [vod] });`);
  L.push(`}`);
  L.push(``);

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

  // play —— 用集 key 或专辑 key
  L.push(`function play(flag, id, flags) {`);
  L.push(`  // 切集时 a=0, 首播 a=1 —— 但 a=0 更保险（都能通）`);
  L.push(`  var q = 'cinema=1&id=' + id +`);
  L.push(`    '&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1';`);
  L.push(`  var info = apiGet(API, 'v3/video/play', q);`);
  L.push(`  var url = '';`);
  L.push(`  var isHls = false;`);
  L.push(`  if (info && info[0]) {`);
  L.push(`    var d = info[0];`);
  L.push(`    // flvPathList[0] 通常是广告 mp4, [1] 是真 m3u8。`);
  L.push(`    // 优先级: clarity(enabled=true) → 任 List 里 isHls=true → 任意非空`);
  L.push(`    var pickReal = function (arr) {`);
  L.push(`      if (!arr || !arr.length) return null;`);
  L.push(`      for (var i = 0; i < arr.length; i++) {`);
  L.push(`        if (arr[i] && arr[i].result && arr[i].isHls === true) return arr[i];`);
  L.push(`      }`);
  L.push(`      for (var j = 0; j < arr.length; j++) {`);
  L.push(`        if (arr[j] && arr[j].result) return arr[j];`);
  L.push(`      }`);
  L.push(`      return null;`);
  L.push(`    };`);
  L.push(`    var picked = null;`);
  L.push(`    if (d.clarity && d.clarity.length) {`);
  L.push(`      for (var k = 0; k < d.clarity.length; k++) {`);
  L.push(`        var c = d.clarity[k];`);
  L.push(`        if (c && c.isEnabled && c.path && c.path.result) { picked = c.path; break; }`);
  L.push(`      }`);
  L.push(`    }`);
  L.push(`    if (!picked) picked = pickReal(d.hlsPathList) || pickReal(d.flvPathList) || pickReal(d.mp4PathList);`);
  L.push(`    if (picked) { url = picked.result; isHls = !!picked.isHls; }`);
  L.push(`  }`);
  L.push(`  if (url) {`);
  L.push(`    console.log('[s2s] play 命中(' + (isHls ? 'HLS' : 'MP4') + '): ' + url.substring(0, 80));`);
  L.push(`    return JSON.stringify({`);
  L.push(`      parse: 0, url: url,`);
  L.push(`      header: { 'User-Agent': HDR['User-Agent'], 'Referer': SITE + '/' },`);
  L.push(`    });`);
  L.push(`  }`);
  L.push(`  // API 没给地址（配额耗尽/临时错误）→ 退回前端页嗅探`);
  L.push(`  console.log('[s2s] play API 无地址, 退回嗅探');`);
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
