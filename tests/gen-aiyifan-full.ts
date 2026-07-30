/**
 * 生成完整 aiyifan spider (含 详情 + 播放)
 * 相当于用户在扩展里标了 home + detail role 之后的效果
 */

import { generateAPIDrpySpider } from "../lib/drpy-generator";
import fs from "fs";
import path from "path";

const OUT = path.resolve(process.cwd(), "test-output/aiyifan-spider-full.js");

// 从抓包结果学到的 aiyifan API 结构
const spider = generateAPIDrpySpider({
  siteName: "爱壹帆",
  baseURL: "https://www.aiyifan.tv",
  host: "www.aiyifan.tv",

  home: {
    urlTemplate: "https://upload.aiyifan.tv/api/home/getIndexVideo?cinema=1&size=16",
    method: "GET",
    listPath: "$.data.info[*].guessYouLike",
    fields: {
      // 关键: id 用 params.v (真播放接口需要 vid, 不是 link)
      id: "$.params.v",
      name: "$.title",
      pic: "$.image",
      url: "$.link",
    },
  } as any,

  // 详情 API: /api/video/play?id={vid}
  detail: {
    urlTemplate: "https://upload.aiyifan.tv/api/video/play?cinema=1&id={id}&a=1&region=SG&device=1&ispath=true&alluser=1",
    method: "GET",
    fields: {
      name: "$.data.info[0].title",
      pic: "$.data.info[0].image",
      desc: "$.data.info[0].contxt",
      playURL: "$.data.info[0].flvPathList[*].result",
    },
    // 关键: 用探测器生成的 snippet 处理 flvPathList
    playSnippet: `
    // 从 flvPathList 提取 m3u8 直链
    let flvList = data?.data?.info?.[0]?.flvPathList || [];
    if (Array.isArray(flvList) && flvList.length > 0) {
      let urls = flvList.map(function(p, i) {
        return '第' + (i+1) + '集' + '$' + (p.result || p.dashResult || '');
      }).filter(function(s) { return s.split('$')[1]; });
      vod.vod_play_from = '爱壹帆';
      vod.vod_play_url = urls.join('#');
    }
    `.trim(),
  } as any,

  baseInfo: undefined,
  listSelector: "",
  itemSelector: "",
  cardCount: 0,
  similarity: 0,
  samples: [],
} as any);

fs.writeFileSync(OUT, spider);
console.log(`✅ 生成 ${OUT} (${spider.length} bytes)`);
console.log(`\n=== 二级 部分 ===`);
const idx = spider.indexOf("二级");
console.log(spider.slice(idx, idx + 1200));
