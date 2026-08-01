// site2source-ext 生成的嗅探型 Drpy T4 spider
// Site: https://www.aiyifan.tv
// Generated: 2026-08-01T16:40:47.954Z
//
// 【为什么是嗅探型】
// 本站 API 带一次性签名（vv/pub 之类），spider 无法生成 → API 型不可用。
// 改用前端路由 + drpy 嗅探：加载页面，从网络请求里捞视频流。
//
// 【已知限制】
// - 拿不到剧集列表，只能播入口那一集
// - ⚠️ 本站是纯 CSR（HTML 空壳），分类页 selector 大概率抓不到卡片。
//   如果一级列表为空，说明 drpy 拿到的是未渲染的 HTML —— 此时只有搜索能用。
//
// 视频 CDN: sss111-e1.pipecdn.vip, s1-a1.global-cdn.me

var rule = {
  title: '爱壹帆国际版',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: 'fyclass',
  class_name: '电影&国产剧&港剧&日剧&韩剧&综艺&动漫&短剧',
  class_url: '/movie&/list/drama&/list/drama?region=香港&/list/drama?region=日本&/list/drama?region=韩国&/variety&/anime&/short',
  // ↑ 部分分类路由带 query（?region=xxx）。若翻页异常，检查 drpy 拼 fypage 时
  //   是用 ? 还是 & —— 带 query 的分类需要 & 拼接。
  searchUrl: '/search/**',
  searchable: 1,
  quickSearch: 1,
  filterable: 0,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.aiyifan.tv/'
  },
  timeout: 8000,
  play_parse: true,

  // 一级列表（CSR 站可能抓不到 —— 见文件头警告）
  一级: 'div.rec-track div;*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|text;a&&href',

  // 搜索（前端路由，结果页 selector 从真实搜索页学到）
  搜索: 'div.search-results a[href*="/play/"];*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|text;a&&href',

  // 二级：不解析详情（详情 API 带签名），页面 URL 直接当播放源
  二级: async function(ids) {
    let id = ids[0];
    // id 可能是相对路径，补全成绝对 URL
    let pageUrl = id.startsWith('http') ? id : (rule.host + (id.startsWith('/') ? '' : '/') + id);
    return {
      vod_id: id,
      vod_play_from: '嗅探',
      vod_play_url: '正片$' + pageUrl,
    };
  },

  // 播放：交给 drpy 嗅探（对加密流也有效）
  lazy: async function(flag, id, flags) {
    // 先试着从页面 HTML 里直接找 m3u8/mp4（有些站服务端渲染了播放地址）
    try {
      let html = await request(id);
      let m = html.match(/https?:\/\/[^"'\s\\]+?\.(?:m3u8|mp4)[^"'\s\\]*/i);
      if (m) {
        return { parse: 0, url: m[0].replace(/\\\//g, '/'), header: { 'Referer': rule.host + '/' } };
      }
    } catch (e) {
      log('[s2s] lazy 拉页面失败: ' + e.message);
    }
    // 兜底：让 drpy 打开页面嗅探网络请求
    return {
      parse: 1,
      url: id,
      sniffer: 1,
      sniffCustomRegex: 'sss111-e1.pipecdn.vip|s1-a1.global-cdn.me',   // 已知视频 CDN
      header: { 'Referer': rule.host + '/' },
    };
  },
}