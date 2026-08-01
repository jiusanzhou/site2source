// 用最近的 state 快照 + 修好的 generator 本地跑
import { generateDrpySpider, generateTVBoxJSON } from "../lib/drpy-generator";
import fs from "node:fs";

const proj = {
  site: { url: "https://www.aiyifan.tv/", host: "www.aiyifan.tv", baseURL: "https://www.aiyifan.tv", siteName: "爱壹帆国际版-海量高清视频免费在线观看" },
  baseInfo: {
    pageBase: "https://www.aiyifan.tv",
    linkBase: "https://www.aiyifan.tv",
    imgBase: "https://static.aiyifan.tv",
  },
  listSelector: "div.rec-track",
  listItemTag: "div",
  listMeta: { similarity: 1.0 },
  listSamples: [
    { name: "24小时内近4.9万名移民进入西班牙休达", url: "https://www.aiyifan.tv/watch?v=XzXecsy4CnVUY3zJ3VyYbm", pic: "", remarks: "1008" },
    { name: "杰伊·克莱顿获参议院确认，接掌动荡中的美国情报体系", url: "https://www.aiyifan.tv/watch?v=bz20B0YCntlMprk8bElxX4", pic: "", remarks: "" },
    { name: "留美求职成本恐飙升，川普政府考虑对OPT项目收费10万美元", url: "https://www.aiyifan.tv/watch?v=tZrQKp7hII2ynjxhkBocO3", pic: "", remarks: "" },
    { name: "耗资225亿美元，川普将宣布华盛顿杜勒斯机场改建方案", url: "https://www.aiyifan.tv/watch?v=rkzZzwg6YgZZyF8oyDzSXa0", pic: "", remarks: "" },
    { name: "伊朗突袭驻约旦美军，川普：将痛打德黑兰", url: "https://www.aiyifan.tv/watch?v=zjiI15SeCRIadodNxkgxzA", pic: "", remarks: "" },
  ],
  detail: {
    detailURL: "https://www.aiyifan.tv/play/Na5mm0pFZzP",
    titleSelector: "div.main > div.playPageBottom > div.container.v-page > div.left > app-video-info > div > div:nth-of-type(1) > h4.h4",
    descSelector: "div.left > app-video-info > div > div.d-flex.openner > div.intro > div.d-flex > app-summary > div.summary.show",
  },
  home: {
    categories: [
      { name: "电影最TOP", url: "https://www.aiyifan.tv/space/BhtExynkOcLy0E7uF7YPwE" },
      { name: "电影", url: "https://www.aiyifan.tv/movie" },
      { name: "喜剧", url: "https://www.aiyifan.tv/list/movie-19" },
      { name: "爱情", url: "https://www.aiyifan.tv/list/movie-20" },
      { name: "动作", url: "https://www.aiyifan.tv/list/movie-21" },
      { name: "科幻", url: "https://www.aiyifan.tv/list/movie-23" },
      { name: "浪漫爱情喜剧", url: "https://www.aiyifan.tv/collection/luv0uQk1UzT" },
      { name: "心理学电影", url: "https://www.aiyifan.tv/collection/dWU6SWoQcZ0" },
      { name: "电视剧", url: "https://www.aiyifan.tv/drama" },
      { name: "港剧", url: "https://www.aiyifan.tv/list/drama?region=%E9%A6%99%E6%B8%AF" },
      { name: "台剧", url: "https://www.aiyifan.tv/list/drama?region=%E5%8F%B0%E6%B9%BE" },
      { name: "日剧", url: "https://www.aiyifan.tv/list/drama?region=%E6%97%A5%E6%9C%AC" },
      { name: "韩剧", url: "https://www.aiyifan.tv/list/drama?region=%E9%9F%A9%E5%9B%BD" },
      { name: "欧美剧", url: "https://www.aiyifan.tv/list/drama?region=%E7%BE%8E%E5%9B%BD" },
      { name: "英剧", url: "https://www.aiyifan.tv/list/drama?region=%E8%8B%B1%E5%9B%BD" },
      { name: "综艺", url: "https://www.aiyifan.tv/variety" },
      { name: "动漫", url: "https://www.aiyifan.tv/anime" },
      { name: "短剧", url: "https://www.aiyifan.tv/short" },
      { name: "动画", url: "https://www.aiyifan.tv/yule" },
      { name: "沙盘上的战争", url: "https://www.aiyifan.tv/collection/K0LQGCsJlNkf5NJz21Zyz9" },
    ],
    // 从 CDP 探测拿到：填入寒战 + 回车后 URL 变成 /search/寒战
    searchAction: "https://www.aiyifan.tv/search/{wd}",
    searchParam: "wd",
    searchInputSelector: "#search-input",
    searchTriggerHint: "enter",
    // 从搜索结果页 DOM 探测拿到
    searchListSelector: "div.search-results a[href*='/play/']",
  },
};

const media = [
  // 从 aiyifan 剧集页 CDP 观测抓到的（sss111-e1.pipecdn.vip m3u8 + ts）
  {
    url: "https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/chunklist.m3u8?vendtime=1785774174&vhash=Ip4D8mCfVadIhxyM-g--SdfzRzZJA1-UNRKHyfqmRF4=",
    type: "m3u8",
    referer: "https://www.aiyifan.tv/",
  },
  {
    url: "https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_0.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=a",
    type: "ts",
    referer: "https://www.aiyifan.tv/",
  },
  {
    url: "https://sss111-e1.pipecdn.vip/ppotb62-S71lT2yliZApDBSvkYzBsrmD3fpCJ4nBsjsRsGlR7XgBMfjBJ0nBJ0pCK4qDpGnHYvjS34/media_1.ts?vCustomParameter=0_103.167.27.48_SG_1_0_1_0&lb=69167f95254b071bf2caec70e3b6f6bd&ab=b",
    type: "ts",
    referer: "https://www.aiyifan.tv/",
  },
];

const input = {
  siteName: proj.site.siteName,
  baseURL: proj.baseInfo.pageBase,
  host: proj.site.host,
  baseInfo: proj.baseInfo,
  listSelector: proj.listSelector,
  itemSelector: proj.listItemTag,
  cardCount: proj.listSamples.length,
  similarity: proj.listMeta.similarity,
  samples: proj.listSamples,
  detail: proj.detail,
  home: proj.home,
  media,
};

const spider = generateDrpySpider(input);
fs.writeFileSync("test-output/spider_www_aiyifan_tv_v3.js", spider);
console.log("saved spider (" + spider.length + " bytes) → test-output/spider_www_aiyifan_tv_v3.js");
const tvbox = generateTVBoxJSON(input, "./spider_www_aiyifan_tv_v3.js");
fs.writeFileSync("test-output/tvbox_v3.json", tvbox);
console.log("saved tvbox (" + tvbox.length + " bytes)");
