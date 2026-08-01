// site2source-ext auto-generated Drpy T4 API spider for https://www.aiyifan.tv
// Generated: 2026-08-01T16:38:14.723Z

var rule = {
  title: '爱壹帆',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: 'https://m10.aiyifan.tv/api/List/GuessYouLike?cinema=1&CID=fyclass&PageSize=35',
  detailUrl: 'https://www.aiyifan.tv/play/{id}',
  class_name: '国产剧&电影&综艺&动漫',
  class_url: '0,1,4&0,1,3&0,1,5&0,1,6',
  filter_url: '',
  filter: {},
  filter_def: {},
  headers: { 'User-Agent': 'MOBILE_UA' },
  timeout: 5000,
  play_parse: true,
  limit: 6,
  double: true,

  // 一级列表: 从 JSON API 解析
  一级: async function(fyclass, fypage, fyfilter) {
    let url = this.url.replace('fyclass', fyclass).replace('fypage', fypage);
    let raw = await request(url);
    let data;
    try { data = JSON.parse(raw); } catch(e) {
      log('[s2s] home 接口非 JSON: ' + String(raw).slice(0, 200));
      return [];
    }
    let list = data?.data?.info || [];
    let videos = list.map(function(v) {
      return {
        vod_id: v?.key || '',
        vod_name: v?.title || '',
        vod_pic: v?.image || '',
        vod_remarks: v?.lastName || '',
      };
    });
    return videos;
  },

  // 二级详情: SPA 前端路由模式（详情 API 带签名，走嗅探）
  二级: async function(ids) {
    let id = ids[0];
    let pageUrl = 'https://www.aiyifan.tv/play/{id}'.replace('{id}', id);
    // 页面 URL 直接当播放源，播放时由 drpy 嗅探真实流
    return {
      vod_id: id,
      vod_name: '',
      vod_play_from: '嗅探',
      vod_play_url: '正片$' + pageUrl,
    };
  },

  // 播放: id 若为 m3u8/mp4 直链则 parse=0 直接播, 否则交给 Drpy 嗅探
  播放: async function(flag, id, flags) {
    if (/\.(m3u8|mp4|flv|mpd)(\?|$)/i.test(id)) {
      return { parse: 0, url: id };
    }
    return { parse: 1, url: id };
  }
};