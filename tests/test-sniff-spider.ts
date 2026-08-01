import { generateSniffSpider } from "../lib/sniff-spider-generator";
import fs from "fs";
import path from "path";

const spider = generateSniffSpider({
  siteName: "爱壹帆国际版",
  host: "https://www.aiyifan.tv",
  // 从首页导航学到的分类（前端路由）
  categories: [
    { name: "电影", url: "/movie" },
    { name: "国产剧", url: "/list/drama" },
    { name: "港剧", url: "/list/drama?region=香港" },
    { name: "日剧", url: "/list/drama?region=日本" },
    { name: "韩剧", url: "/list/drama?region=韩国" },
    { name: "综艺", url: "/variety" },
    { name: "动漫", url: "/anime" },
    { name: "短剧", url: "/short" },
  ],
  listSelector: "div.rec-track div",
  searchRoute: "/search/{wd}",
  searchListSelector: "div.search-results a[href*='/play/']",
  // CDP 抓到的真实媒体流
  media: [
    { url: "https://sss111-e1.pipecdn.vip/ppotb62-xxx/chunklist.m3u8?vendtime=1785774174", type: "m3u8", referer: "https://www.aiyifan.tv/" },
    { url: "https://sss111-e1.pipecdn.vip/ppotb62-xxx/media_0.ts", type: "ts", referer: "https://www.aiyifan.tv/" },
    { url: "https://s1-a1.global-cdn.me/vod/FD0C83606-03366.mp4", type: "mp4", referer: "https://www.aiyifan.tv/" },
  ] as any,
  isPureCSR: true,
});

const out = path.resolve(__dirname, "../test-output/spider_aiyifan_sniff.js");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, spider);
console.log(`${spider.length} bytes → ${out}\n`);
console.log(spider);
