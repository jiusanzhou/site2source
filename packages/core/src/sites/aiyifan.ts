/**
 * aiyifan 站点模型 — 从这一晚硬编码的 aiyifan-api-spider.ts 抽取
 *
 * 这份文件应该是**唯一站点相关代码**。引擎在 model-generator.ts。
 */

import type { SiteModel } from "./site-model";

export const AIYIFAN_MODEL: SiteModel = {
  name: "aiyifan",
  display_name: "爱壹帆",
  site_url: "https://www.aiyifan.tv",
  bases: {
    api: "https://m10.aiyifan.tv",
    rank: "https://rankv21.aiyifan.tv",
  },

  // 签名：双模并存
  signing: {
    default_strategy: "auto", // cert 优先, timestamp fallback
    modes: [
      // Cert 模式（长 pub, 从 bootstrap 拿）— play 端点必须
      {
        name: "cert",
        vars: {
          pub: { kind: "bootstrap", path: "publicKey" },
          query_lower: { kind: "query_lower" },
          pk: { kind: "bootstrap", path: "privateKey[0]" },
        },
        formula: "{pub}&{query_lower}&{pk}",
        algorithm: "md5",
        attach: { vv: "{sign}", pub: "{pub}" },
      },
      // Timestamp 模式（短 pub, bootstrap 用）
      {
        name: "timestamp",
        vars: {
          pub: { kind: "timestamp" },
          query_lower: { kind: "query_lower" },
          pk: {
            kind: "key_table",
            // 8 个混淆密钥（形近字符）
            table: [
              "version001", "vers1on001", "vers1on00i", "bersion001",
              "vcrsion001", "versi0n001", "versio_001", "version0o1",
            ],
            index: "Number(pub) % 8",
          },
        },
        formula: "{pub}&{query_lower}&{pk}",
        algorithm: "md5",
        attach: { vv: "{sign}", pub: "{pub}" },
      },
    ],
  },

  // Bootstrap：拿 pConfig 供 cert 模式用
  bootstrap: {
    endpoint: "config",
    extract: {
      publicKey: "info[0].pConfig.publicKey",
      privateKey: "info[0].pConfig.privateKey",
    },
    transforms: [
      // privateKey 有时是字符串，统一转数组
      { field: "privateKey", op: "as_array" },
    ],
  },

  endpoints: [
    // bootstrap 端点（只能用 timestamp，因为 pConfig 还没有）
    {
      name: "config",
      base: "api",
      path: "v3/home/config",
      query: "cinema=1",
      sign_mode: "timestamp",
    },
    // 首页聚合（7 栏目）
    {
      name: "home",
      base: "api",
      path: "v3/home/getAllVideo",
      // size=1000 会挂 QuickJS
      query: "cinema=1&page=1&size=100&region=SG",
      sign_mode: "auto",
      response: {
        // home 数据在 data.info[0], 引擎会存 data 层
        item: { path: "info[0]" },
      },
    },
    // 详情
    {
      name: "detail",
      base: "api",
      path: "v3/video/detail",
      query: "cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id={id}&region=SG",
      sign_mode: "auto",
      response: {
        item: { path: "info[0]" },
      },
    },
    // 剧集列表
    {
      name: "episodes",
      base: "api",
      path: "v3/video/languagesplaylist",
      query: "cinema=1&vid={id}&lsk=1&taxis=0&cid={cid}",
      sign_mode: "auto",
      response: {
        episodes: { path: "info[0].playList" },
      },
    },
    // 播放（必须 cert）
    {
      name: "play",
      base: "api",
      path: "v3/video/play",
      query: "cinema=1&id={id}&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1",
      sign_mode: "cert",
      response: {
        play_url: {
          priority: [
            // 优先 clarity 里 isEnabled=true 的 path.result
            { path: "info[0].clarity", first_where: "isEnabled=true", field: "path.result" },
            // flvPathList 里 isHls=true
            { path: "info[0].flvPathList", first_where: "isHls=true", field: "result" },
            // hlsPathList
            { path: "info[0].hlsPathList", first_where: "isHls=true", field: "result" },
            // 最后：flvPathList 首个非广告的
            {
              path: "info[0].flvPathList",
              first_where: "isHls=true",
              field: "result",
            },
          ],
          exclude: [
            { host_regex: "s1-a1\\.global-cdn\\.me" }, // aiyifan 广告 CDN
          ],
        },
      },
    },
    // 搜索
    {
      name: "search",
      base: "rank",
      path: "v3/list/briefsearch",
      query: "tags={wd}&orderby=4&page={page}&size=20&desc=0&isserial=-1&istitle=true",
      sign_mode: "auto",
      response: {
        list: { path: "info[0].result" },
      },
    },
  ],

  mappings: {
    // 列表 vs 详情 vs 搜索的字段名有差异，全放候选
    vod_id: ["key", "contxt", "id"],
    vod_name: ["title", "name"],
    vod_pic: ["image", "imgPath", "cover", "pic"],
    vod_year: ["year", "post_Year"],
    vod_area: ["regional", "area"],
    vod_actor: ["starring", "stars", "actor"],
    vod_director: ["directed", "directors", "director"],
    vod_content: ["shortDes", "contxt", "desc"],
    vod_remarks: ["lastName", "score", "rating"],
    // 剧集
    ep_name: ["name", "title"],
    ep_id: ["key", "id"],
  },

  categories: [
    { kind: "static", id: "filmList", name: "电影", source_field: "info[0].filmList" },
    { kind: "static", id: "tvList", name: "剧集", source_field: "info[0].tvList" },
    { kind: "static", id: "varietyList", name: "综艺", source_field: "info[0].varietyList" },
    { kind: "static", id: "animeList", name: "动漫", source_field: "info[0].animeList" },
    { kind: "static", id: "shortList", name: "短剧", source_field: "info[0].shortList" },
    { kind: "static", id: "documentaryList", name: "纪录片", source_field: "info[0].documentaryList" },
    { kind: "static", id: "sportList", name: "体育", source_field: "info[0].sportList" },
  ],

  play_result: {
    on_hit: { parse: 0 },
    on_miss: { parse: 1, url_template: "{site_url}/play/{id}" },
  },

  paging: { strategy: "local", page_size: 30 },

  // 国内环境走 cf-proxy 绕 CF GEO block（error 1009）
  // 部署: labs.zoe.im/cf-proxy (Pages 项目 "notes-edge")
  //
  // ⚠️ AUTH_TOKEN 是 secret，不能明文提交到 git。
  //   实际值由 makeAiyifanModel() 从环境变量注入：
  //     AIYIFAN_PROXY_BASE / AIYIFAN_PROXY_TOKEN
  //   见 .env / .env.example
  //
  // 直接 import AIYIFAN_MODEL 得到的是"无 proxy"版本（海外环境用）；
  // 需要 proxy 版本请调用 makeAiyifanModel({ withProxy: true })
};

/**
 * 生成 aiyifan SiteModel。
 * - 默认 (withProxy=false): 无代理，海外环境直接用
 * - withProxy=true: 挂 cf-proxy，从环境变量读凭证
 */
export function makeAiyifanModel(opts: { withProxy?: boolean } = {}): SiteModel {
  const base = { ...AIYIFAN_MODEL };
  if (!opts.withProxy) return base;

  const proxyBase = process.env.AIYIFAN_PROXY_BASE;
  const proxyToken = process.env.AIYIFAN_PROXY_TOKEN;
  if (!proxyBase || !proxyToken) {
    throw new Error(
      "makeAiyifanModel({ withProxy: true }) 需要环境变量 AIYIFAN_PROXY_BASE + AIYIFAN_PROXY_TOKEN (见 .env.example)",
    );
  }
  return {
    ...base,
    proxy: {
      base: proxyBase,
      mode: "query",
      headers: { Authorization: `Bearer ${proxyToken}` },
      only: ["api", "rank"],
      proxy_media: false,
    },
  };
}
