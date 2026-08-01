import { generateT3Spider } from "../lib/t3-spider-generator";
import fs from "fs";
import path from "path";

const spider = generateT3Spider({
  siteName: "爱壹帆",
  host: "https://www.aiyifan.tv",
  categories: [
    { name: "电影", url: "/movie" },
    { name: "剧集", url: "/drama" },
    { name: "综艺", url: "/variety" },
    { name: "动漫", url: "/anime" },
    { name: "短剧", url: "/short" },
  ],
  listSelector: "div.rec-track div",
  searchRoute: "/search/{wd}",
  searchListSelector: "div.search-results a[href*='/play/']",
  media: [
    { url: "https://sss111-e1.pipecdn.vip/x/chunklist.m3u8", type: "m3u8" },
    { url: "https://s1-a1.global-cdn.me/vod/FD0C83606-03366.mp4", type: "mp4" },
  ] as any,
  isPureCSR: true,
});

const out = path.resolve(__dirname, "../test-output/spider_aiyifan_t3.js");
fs.writeFileSync(out, spider);
console.log(`${spider.length} bytes -> ${out}`);
