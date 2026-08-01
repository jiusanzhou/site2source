// site2source-ext auto-generated Drpy T4 spider for www.aiyifan.tv
// Generated: 2026-08-01T04:58:20.712Z
// Site: https://www.aiyifan.tv

var rule = {
  title: '爱壹帆国际版-海量高清视频免费在线观看',
  host: 'https://www.aiyifan.tv',
  homeUrl: '/',
  url: '/vodtype/fyclass-fypage.html',
  detailUrl: '',
  searchUrl: '',                     // TODO: 搜索 URL 模板
  searchable: 0,
  quickSearch: 0,
  filterable: 0,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.aiyifan.tv/'
  },
  timeout: 5000,

  // 首页分类（site2source 自动识别）
  class_name: '电影最TOP&电影&喜剧&爱情&动作&科幻&浪漫爱情喜剧&心理学电影&电视剧&港剧&台剧&日剧&韩剧&欧美剧&英剧&综艺&动漫&短剧&动画&沙盘上的战争',
  class_url:  'BhtExynkOcLy0E7uF7YPwE&movie&movie-19&movie-20&movie-21&movie-23&luv0uQk1UzT&dWU6SWoQcZ0&drama&drama&drama&drama&drama&drama&drama&variety&anime&short&yule&K0LQGCsJlNkf5NJz21Zyz9',

  // 一级列表（site2source 自动识别）
  // 21 项 · 相似度 100%
  一级: 'div.rec-track div;*[title],img&&alt,text;img&&data-original||data-src||src;.*?(HD[0-9]*|4K|更新至第?.+?集|第.+?集|全.+?集|完结|连载|BD|超清|高清|\\d{4}).*?;a&&href',

  // 二级（详情页）— site2source 从真实详情页学习
  二级: {
    title: 'div.main > div.playPageBottom > div.container.v-page > div.left > app-video-info > div > div:nth-of-type(1) > h4.h4&&Text',
    desc:  'div > div:nth-of-type(2) > div.main > div.playPageTop&&Text',
    content: 'div > div:nth-of-type(2) > div.main > div.playPageTop&&Text',
    tabs: 'div.playPageBottom > div.container.v-page > div.left > app-video-info > div > div.d-flex.openner > div.img > img&&a',
    lists: 'div.inner.d-flex > div.box.justify-content-end > app-dn-user-menu-item.h-100.top-item > div.item.d-inline-flex > div:nth-of-type(2) > app-dropdown-recharge > div.dropdown.newStyle > div.outer-box.bg',
  },

  搜索: '*',                          // TODO

  // � 播放解析（site2source 从 18 条抓包学习）
  lazy: async function (flag, id, flags) {
    // 抓到的播放地址样本：
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_3.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=d&verify=1785563514-R3EmaaXJsLIJBmEZCJysOkteVWMNdNAEYUDpCLVNev0%3D
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_4.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=e&verify=1785563514-%2BtREl0mddCIqYOebQoS4kYB8FWDmvYA998%2BW4fD0TBo%3D
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_5.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=f&verify=1785563514-bgTJqs3GP%2FPlfLz70DqzX0%2FwGADK5NEpCSMnlsayszg%3D
    //   [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_6.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=g&verify=1785563514-hRf9QhDuYmPCe%2FmDXgQXsw%2FBpa7L%2FDlOLhcYKJ2p7zY%3D
    //
    // 视频域名: sss111-e1.pipecdn.vip
    // 疑似 pattern: /ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBtTsRsGlQd4jQ7enEJaqUNajP7aqE31GBJ0pDpKpH3auE2vjS34/chunklist.m3u8

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
            header: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.aiyifan.tv/play/Na5mm0pFZzP' }
          };
        }
      }
    } catch (e) {
      log('lazy fail: ' + e.message);
    }
    // 兜底: 交给 Drpy 内置嗅探
    return { parse: 1, url: id, header: { 'Referer': 'https://www.aiyifan.tv/play/Na5mm0pFZzP' } };
  }
};

/* ============ 调试信息 ============
  网站: 爱壹帆国际版-海量高清视频免费在线观看 (https://www.aiyifan.tv)
  最终 host: https://www.aiyifan.tv

  Base 推断:
    - 页面: https://www.aiyifan.tv
    - 链接: https://www.aiyifan.tv
    - 图片: https://static.aiyifan.tv

  链接 host 统计:
    63× https://www.aiyifan.tv
  图片 host 统计:
    42× https://static.aiyifan.tv
    16× https://www.aiyifan.tv

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

  抓到 18 条视频流:
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_3.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=d&verify=1785563514-R3EmaaXJsLIJBmEZCJysOkteVWMNdNAEYUDpCLVNev0%3D
         Referer: https://www.aiyifan.tv/play/KCnOotAjyG3
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_4.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=e&verify=1785563514-%2BtREl0mddCIqYOebQoS4kYB8FWDmvYA998%2BW4fD0TBo%3D
         Referer: https://www.aiyifan.tv/play/KCnOotAjyG3
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_5.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=f&verify=1785563514-bgTJqs3GP%2FPlfLz70DqzX0%2FwGADK5NEpCSMnlsayszg%3D
         Referer: https://www.aiyifan.tv/play/KCnOotAjyG3
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_6.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=g&verify=1785563514-hRf9QhDuYmPCe%2FmDXgQXsw%2FBpa7L%2FDlOLhcYKJ2p7zY%3D
         Referer: https://www.aiyifan.tv/play/KCnOotAjyG3
    [ts] https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsHgTcyo5x8yYrZQdDkBJKtDd0jC34nGKP6DJWqBcrmD0/media_7.ts?vCustomParameter=0_103.167.26.53_SG_1_0_1_0&lb=9b8d1f96e103825a68f1c20562e8d10b&ab=h&verify=1785563514-j1Zf5fn88CHjcuyQllGfalu3RELLx%2Bd7nDJpVRZ3P8Q%3D
         Referer: https://www.aiyifan.tv/play/KCnOotAjyG3
*/