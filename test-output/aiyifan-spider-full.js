// site2source-ext auto-generated Drpy T4 API spider for www.aiyifan.tv
// Generated: 2026-07-30T19:17:21.399Z

var rule = {
  title: '爱壹帆',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: 'https://upload.aiyifan.tv/api/home/getIndexVideo?cinema=1&size=16',
  detailUrl: 'https://upload.aiyifan.tv/api/video/play?cinema=1&id={id}&a=1&region=SG&device=1&ispath=true&alluser=1',
  class_name: '电影&电视剧&综艺&动漫',
  class_url: '1&2&3&4',
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
        vod_id: v?.params?.v || '',
        vod_name: v?.title || '',
        vod_pic: v?.image || '',
        vod_remarks: '' || '',
      };
    });
    return videos;
  },

  // 二级详情: 从 JSON API 解析
  二级: async function(ids) {
    let id = ids[0];
    let url = 'https://upload.aiyifan.tv/api/video/play?cinema=1&id={id}&a=1&region=SG&device=1&ispath=true&alluser=1'.replace('{id}', id);
    let raw = await request(url);
    let data;
    try { data = JSON.parse(raw); } catch(e) {
      log('[s2s] detail 接口非 JSON: ' + String(raw).slice(0, 200));
      return {};
    }
    let vod = {
      vod_name: data?.data?.info?.[0]?.title || '',
      vod_pic: data?.data?.info?.[0]?.image || '',
      vod_content: data?.data?.info?.[0]?.contxt || '',
    };
    // 剧集列表 (从 sampleResponse 探测的格式)
// 从 flvPathList 提取 m3u8 直链
    let flvList = data?.data?.info?.[0]?.flvPathList || [];
    if (Array.isArray(flvList) && flvList.length > 0) {
      let urls = flvList.map(function(p, i) {
        return '第' + (i+1) + '集' + '$' + (p.result || p.dashResult || '');
      }).filter(function(s) { return s.split('$')[1]; });
      vod.vod_play_from = '爱壹帆';
      vod.vod_play_url = urls.join('#');
    }
    return vod;
  },

  // 播放: id 若为 m3u8/mp4 直链则 parse=0 直接播, 否则交给 Drpy 嗅探
  播放: async function(flag, id, flags) {
    if (/\.(m3u8|mp4|flv|mpd)(\?|$)/i.test(id)) {
      return { parse: 0, url: id };
    }
    return { parse: 1, url: id };
  }
};