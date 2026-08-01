// site2source-ext auto-generated Drpy T4 spider for www.aiyifan.tv
// Generated: 2026-08-01T15:31:03.393Z
// Site: https://www.aiyifan.tv

var rule = {
  title: '爱壹帆国际版-海量高清视频免费在线观看',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: 'fyclass',
  detailUrl: '',
  searchUrl: '/search/**',
  searchable: 1,
  quickSearch: 1,
  filterable: 0,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.aiyifan.tv/'
  },
  timeout: 5000,

  // 首页分类（site2source 自动识别）
  class_name: '电影最TOP&电影&喜剧&爱情&动作&科幻&浪漫爱情喜剧&心理学电影&电视剧&港剧&台剧&日剧&韩剧&欧美剧&英剧&综艺&动漫&短剧&动画&沙盘上的战争',
  class_url:  '/space/BhtExynkOcLy0E7uF7YPwE&/movie&/list/movie-19&/list/movie-20&/list/movie-21&/list/movie-23&/collection/luv0uQk1UzT&/collection/dWU6SWoQcZ0&/drama&/list/drama?region=%E9%A6%99%E6%B8%AF&/list/drama?region=%E5%8F%B0%E6%B9%BE&/list/drama?region=%E6%97%A5%E6%9C%AC&/list/drama?region=%E9%9F%A9%E5%9B%BD&/list/drama?region=%E7%BE%8E%E5%9B%BD&/list/drama?region=%E8%8B%B1%E5%9B%BD&/variety&/anime&/short&/yule&/collection/K0LQGCsJlNkf5NJz21Zyz9',

  // 一级列表（site2source 自动识别）
  // 5 项 · 相似度 100% · 未识别到 remarks 标签
  一级: 'div.rec-track div;*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|data-note;a&&href',

  // 二级（详情页）— site2source 从真实详情页学习
  二级: {
    title: 'div.main > div.playPageBottom > div.container.v-page > div.left > app-video-info > div > div:nth-of-type(1) > h4.h4&&Text',
    desc:  'div.left > app-video-info > div > div.d-flex.openner > div.intro > div.d-flex > app-summary > div.summary.show&&Text',
    content: 'div.left > app-video-info > div > div.d-flex.openner > div.intro > div.d-flex > app-summary > div.summary.show&&Text',
    tabs: '.play-from,.playfrom&&a',
    lists: '.playlist,.play-list',
  },

  // 搜索规则（selector 从搜索结果页学习）
  搜索: 'div.search-results a[href*="/play/"];*[title],img&&alt,text;img&&data-original||data-src||src;*&&data-remark|data-note;a&&href',

  // 🎬 播放解析（site2source 从 3 条抓包学习）
  lazy: async function (flag, id, flags) {
    // 抓到的播放地址样本：
    //   [m3u8] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/chunklist.m3u8?vendtime=1785774174&vhash=Ip4D8mCfVadIhxyM-g--SdfzRzZJA1-UNRKHyfqmRF4=
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_0.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=a
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_1.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=b
    //
    // 视频域名: sss111-e1.pipecdn.vip
    // 疑似 pattern: /ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/chunklist.m3u8

    try {
      // 策略 1: 拉播放页 HTML, 用正则从中提取 m3u8
      const html = await request(id);
      const patterns = [
        /https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*/i,
        /"(https?:\/\/[^"]+?\.mp4[^"]*)"/i,
        /(?:url|src|source)\s*[:=]\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4)[^"']*)["']/i,
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) {
          const url = m[1] || m[0];
          return {
            parse: 0,
            url: url.replace(/\\\//g, '/'),
            header: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.aiyifan.tv/' }
          };
        }
      }
    } catch (e) {
      log('lazy fail: ' + e.message);
    }
    // 兜底: 交给 Drpy 内置嗅探
    // 已知视频 host: sss111-e1.pipecdn.vip — drpy 会过滤此域名的响应
    return { parse: 1, url: id, sniffer: 1, sniffCustomRegex: 'sss111-e1.pipecdn.vip', header: { 'Referer': 'https://www.aiyifan.tv/' } };
  }
};

/* ============ 调试信息 ============
  网站: 爱壹帆国际版-海量高清视频免费在线观看 (https://www.aiyifan.tv)
  最终 host: https://www.aiyifan.tv

  Base 推断:
    - 页面: https://www.aiyifan.tv
    - 链接: https://www.aiyifan.tv
    - 图片: https://static.aiyifan.tv

  识别到 20 个分类:
    - 电影最TOP: https://www.aiyifan.tv/space/BhtExynkOcLy0E7uF7YPwE
    - 电影: https://www.aiyifan.tv/movie
    - 喜剧: https://www.aiyifan.tv/list/movie-19
    - 爱情: https://www.aiyifan.tv/list/movie-20
    - 动作: https://www.aiyifan.tv/list/movie-21
    - 科幻: https://www.aiyifan.tv/list/movie-23
    - 浪漫爱情喜剧: https://www.aiyifan.tv/collection/luv0uQk1UzT
    - 心理学电影: https://www.aiyifan.tv/collection/dWU6SWoQcZ0
    - 电视剧: https://www.aiyifan.tv/drama
    - 港剧: https://www.aiyifan.tv/list/drama?region=%E9%A6%99%E6%B8%AF

  搜索: https://www.aiyifan.tv/search/{wd} (参数: wd)

  列表样本 (前 5):
    1. 24小时内近4.9万名移民进入西班牙休达 [1008]
       → https://www.aiyifan.tv/watch?v=XzXecsy4CnVUY3zJ3VyYbm
    2. 杰伊·克莱顿获参议院确认，接掌动荡中的美国情报体系
       → https://www.aiyifan.tv/watch?v=bz20B0YCntlMprk8bElxX4
    3. 留美求职成本恐飙升，川普政府考虑对OPT项目收费10万美元
       → https://www.aiyifan.tv/watch?v=tZrQKp7hII2ynjxhkBocO3
    4. 耗资225亿美元，川普将宣布华盛顿杜勒斯机场改建方案
       → https://www.aiyifan.tv/watch?v=rkzZzwg6YgZZyF8oyDzSXa0
    5. 伊朗突袭驻约旦美军，川普：将痛打德黑兰
       → https://www.aiyifan.tv/watch?v=zjiI15SeCRIadodNxkgxzA

  抓到 3 条视频流:
    [m3u8] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/chunklist.m3u8?vendtime=1785774174&vhash=Ip4D8mCfVadIhxyM-g--SdfzRzZJA1-UNRKHyfqmRF4=
         Referer: https://www.aiyifan.tv/
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_0.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=a
         Referer: https://www.aiyifan.tv/
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_1.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=b
         Referer: https://www.aiyifan.tv/
*/