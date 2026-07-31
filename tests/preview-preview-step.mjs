import puppeteer from "/opt/homebrew/lib/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, "../build/chrome-mv3-prod");
const CHROME = "/Users/zoe/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PROFILE = "/tmp/s2s-preview-preview-step";
const OUT = path.resolve(__dirname, "../test-output");

if (fs.existsSync(PROFILE)) fs.rmSync(PROFILE, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: false, userDataDir: PROFILE,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
});

let extId;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 300));
  const ext = browser.targets().find((t) => t.url().startsWith("chrome-extension://"));
  if (ext) { extId = new URL(ext.url()).host; break; }
}

// 先在 sidepanel 塞进假 state
const bg = browser.targets().find(t => t.type() === 'service_worker' && t.url().includes(extId));
const bgPage = bg && await bg.worker();

const page = await browser.newPage();
await page.setViewport({ width: 520, height: 1000 });
await page.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 500));

// 塞假数据：模拟已经走到 preview step 后的样子
await page.evaluate(() => {
  const fakeSpider = `// ==UserScript==
// @name         aiyifan_com Spider
// @description  自动生成的 TVBox 影视爬虫
// @generated_at 2026-07-31T20:00:00Z
// ==/UserScript==

var rule = {
  title: "爱一凡",
  host: "https://www.aiyifan.tv",
  homeUrl: "/api/home/getIndexVideo?cinema=1&size=16",
  homeTid: "1",
  一级: async function() {
    let d = await request(input);
    let list = d.data.info[0].guessYouLike;
    let videos = [];
    for (const item of list) {
      videos.push({
        vod_id: item.id,
        vod_name: item.title,
        vod_pic: item.cover,
        vod_remarks: item.remarks
      });
    }
    return { list: videos };
  },
  二级: async function() {
    let d = await request(this.host + '/api/video/play?id=' + input);
    let vod = d.data.info[0];
    let plays = vod.flvPathList.map(x => x.title + '$' + x.result).join('#');
    return {
      vod_id: input,
      vod_name: vod.title,
      vod_content: vod.description,
      vod_play_from: '默认',
      vod_play_url: plays
    };
  },
  播放: async function() {
    // m3u8 直链, TVBox IJKPlayer 直接播
    return { parse: 0, url: input, header: {} };
  }
};`;

  const fakeTVBox = JSON.stringify({
    spider: "./spider_aiyifan_tv.js;md5;xxxxxx",
    sites: [{
      key: "aiyifan",
      name: "爱一凡",
      type: 3,
      api: "csp_XBPQ",
      searchable: 1,
      quickSearch: 1,
      filterable: 0
    }],
    parses: [],
    flags: ["默认"],
    lives: []
  }, null, 2);

  const project = {
    site: {
      host: "www.aiyifan.tv",
      baseURL: "https://www.aiyifan.tv",
      siteName: "爱一凡",
      title: "爱一凡影视",
    },
    listSelector: "$.data.info[*].guessYouLike",
    detail: {
      titleSelector: "$.data.info[0].title",
      playListSelector: "$.data.info[0].flvPathList[*]"
    },
    home: {
      apiURL: "https://upload.aiyifan.tv/api/home/getIndexVideo?cinema=1&size=16",
      method: "GET",
    }
  };

  // React state 塞不进去, 但组件初始化时会从 storage 拿, 所以塞进去后 reload
  // 更简单: 直接在页面上暴露 setState hack
  window.__previewMock = { fakeSpider, fakeTVBox, project };
});

// 这个方法比较麻烦, 干脆截其他 step 的图先给用户看
// 直接跑到 media step 的地方看
await page.screenshot({ path: path.join(OUT, "sidepanel-start.png"), fullPage: false });

await browser.close();
console.log("done - 只截了 start, preview 内部得手工进流程测");
