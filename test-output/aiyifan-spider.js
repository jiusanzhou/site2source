// site2source-ext auto-generated Drpy T4 API spider for www.aiyifan.tv
// Generated: 2026-07-30T18:53:34.481Z

globalThis.rule = {
  title: '爱壹帆',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: 'https://upload.aiyifan.tv/api/home/getIndexVideo?cinema=1&size=16',
  detailUrl: '',
  class_name: '推荐&热门',
  class_url: '1&2',
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
    let list = data?.data?.info?.[0]?.guessYouLike || [];
    let videos = list.map(function(v) {
      return {
        vod_id: v?.link || '',
        vod_name: v?.title || '',
        vod_pic: v?.image || '',
        vod_remarks: '' || '',
      };
    });
    return videos;
  },

  // 播放: 交给 Drpy 内置嗅探
  播放: async function(flag, id, flags) {
    return { parse: 1, url: id };
  }
};