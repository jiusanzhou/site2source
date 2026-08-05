/**
 * SiteModel — 站点声明式描述
 *
 * ## 设计理由
 * 之前 aiyifan spider 是硬编码的：8 个密钥、cert 模式规则、字段挑选逻辑
 * 都写死在 aiyifan-api-spider.ts。加一个站要复制 700 行代码。
 *
 * 现在把"站点差异"抽成 YAML/JSON：
 * - 签名算法 (md5/sha1/hmac + 公式)
 * - 密钥表
 * - 端点路径 + 参数模板
 * - 响应字段映射
 * - 播放地址挑选策略
 *
 * 引擎代码固定不变，站点 = 一份 SiteModel。
 *
 * ## 生命周期
 * scout → learn → SiteModel YAML → validator 校验 → generator → spider.js
 */

// ============ 签名 ============
/** 签名基础算法 */
export type SignAlgorithm = "none" | "md5" | "sha1" | "sha256" | "hmac-sha256";

/**
 * 签名参数来源
 * - literal: 硬编码字面量（如 "cinema"）
 * - timestamp: Date.now() 转字符串
 * - random: 随机字符串（16 hex）
 * - bootstrap: 从 bootstrap 端点响应里取（用 JSONPath）
 * - key_table: 从密钥表按索引取（用 JS 表达式算索引）
 * - query_lower: 完整 query 的小写形式（拼签名用）
 */
export type SignVarSource =
  | { kind: "literal"; value: string }
  | { kind: "timestamp" }
  | { kind: "random"; length?: number }
  | { kind: "bootstrap"; path: string }  // JSONPath-lite: "info[0].pConfig.publicKey"
  | { kind: "key_table"; table: string[]; index: string /* JS 表达式, 可用 pub */ }
  | { kind: "query_lower" };

/** 一个签名模式 */
export interface SignMode {
  /** 模式名（timestamp / cert / v2 ...）*/
  name: string;
  /** 参数定义：pub / pk / vv 等 */
  vars: Record<string, SignVarSource>;
  /**
   * 签名公式模板 — 用 {var} 引用 vars 里的字段
   * 例: aiyifan = "{pub}&{query_lower}&{pk}"
   */
  formula: string;
  /** 用什么算法算 formula → sign_value */
  algorithm: SignAlgorithm;
  /** hmac 的 secret（可用 {var} 模板）*/
  hmac_key?: string;
  /** 把签名结果附到 URL 的哪些 query 参数 */
  attach: Record<string, string>; // { vv: "{sign}", pub: "{pub}" }
}

/** 签名配置 */
export interface SigningConfig {
  /** 所有支持的签名模式 */
  modes: SignMode[];
  /**
   * 默认策略：
   * - 'first': 按 modes 顺序尝试第一个可用的
   * - 'auto': 优先带 bootstrap 依赖的模式（通常是 cert 类），失败退到 timestamp 类
   */
  default_strategy?: "first" | "auto";
}

// ============ Bootstrap ============
/** bootstrap: spider 启动时先跑一次，把结果缓存到全局，供其他端点用 */
export interface BootstrapConfig {
  /** bootstrap 用哪个端点（endpoints 里的名字）*/
  endpoint: string;
  /**
   * 从响应里提取什么字段进缓存，供签名 vars 里的 kind:'bootstrap' 引用
   * 例: { publicKey: "info[0].pConfig.publicKey", privateKey: "info[0].pConfig.privateKey" }
   */
  extract: Record<string, string>;
  /** 提取完的字段做后处理（可选）— 如把 privateKey 强制转数组 */
  transforms?: {
    field: string;
    /** as_array: 若是字符串就包一层 */
    op: "as_array" | "as_string" | "first_item";
  }[];
}

// ============ 端点 ============
/**
 * 响应挑选式：从 JSON 里挑数据
 * 例:
 *   { path: "info[0].playList" }              → info[0].playList
 *   { path: "info", first_where: "isEnabled=true", field: "path.result" }
 */
export interface ResponsePicker {
  path?: string;
  /** 遍历数组，取第一个满足条件的 */
  first_where?: string; // 简单表达式: "isHls=true", "field.sub.value=X"
  /** 从选中项里再取一个字段 */
  field?: string;
  /** 优先级挑选（依次尝试，第一个非空就用）*/
  priority?: ResponsePicker[];
  /** 排除某些结果（例如广告 host）*/
  exclude?: {
    /** 目标字段（相对 picker 结果，如 "result" 或 ""表 self）*/
    field?: string;
    /** 排除条件：hostRegex/contains/isHls等 */
    host_regex?: string;
    contains?: string;
  }[];
}

/** 字段映射：源字段候选（按顺序找第一个非空）*/
export type FieldCandidate = string | string[];

export interface Endpoint {
  /** 端点标识（home/detail/search/play/episodes/bootstrap...）*/
  name: string;
  /** base URL 的 key（见 SiteModel.bases）*/
  base: string;
  /** 路径（如 "v3/home/getAllVideo"）*/
  path: string;
  /**
   * query 模板 — 用 {var} 占位，运行时用 params 替换
   * 例: "cinema=1&id={id}&region=SG"
   */
  query: string;
  /**
   * 用哪个签名模式：
   * - "auto": SigningConfig.default_strategy
   * - "none": 不签名
   * - <mode.name>: 指定
   */
  sign_mode: "auto" | "none" | string;
  /** HTTP 方法 */
  method?: "GET" | "POST";
  /** POST body 模板 */
  body?: string;
  /** 额外请求头（会覆盖全局 HDR）*/
  headers?: Record<string, string>;
  /**
   * 响应挑选：把 JSON → 结构化数据
   * - list: 列表型端点用，产出 vod 数组
   * - item: 详情型端点，产出单个 vod
   * - episodes: 剧集列表
   * - play_url: 播放地址
   */
  response?: {
    list?: ResponsePicker;
    item?: ResponsePicker;
    episodes?: ResponsePicker;
    play_url?: ResponsePicker;
  };
}

// ============ 字段映射 ============
/** vod 字段候选映射 */
export interface FieldMappings {
  vod_id: FieldCandidate;
  vod_name: FieldCandidate;
  vod_pic?: FieldCandidate;
  vod_year?: FieldCandidate;
  vod_area?: FieldCandidate;
  vod_actor?: FieldCandidate;
  vod_director?: FieldCandidate;
  vod_content?: FieldCandidate;
  vod_remarks?: FieldCandidate;
  /** 剧集列表 item 的字段映射 */
  ep_name?: FieldCandidate;
  ep_id?: FieldCandidate;
}

// ============ 分类 ============
/** 分类定义 —— 有两种模式 */
export type Category =
  | { kind: "static"; id: string; name: string; source_field: string /* 从 home 响应哪个字段取 */ }
  | { kind: "endpoint"; id: string; name: string; endpoint: string /* 用哪个端点 */; params?: Record<string, string> };

// ============ Proxy（可选，用于 GEO block 场景）============
/**
 * 全站请求代理 —— 让所有 API 请求走一个中转 URL。
 *
 * 典型场景: aiyifan 被 Cloudflare GEO block 挡住国内 IP，
 * 用 CF Pages/Worker 部署的通用 HTTP 代理转发（cf-proxy 项目）绕过。
 *
 * 例:
 *   proxy: {
 *     base: "https://notes-edge.pages.dev",
 *     mode: "query",
 *     headers: { Authorization: "Bearer xxx" },
 *   }
 *   → 原 https://m10.aiyifan.tv/v3/xxx?a=1
 *     实 https://notes-edge.pages.dev/?url=https%3A%2F%2Fm10.aiyifan.tv%2Fv3%2Fxxx%3Fa%3D1
 */
export interface ProxyConfig {
  /** 代理服务的 base URL（无尾斜杠）*/
  base: string;
  /**
   * URL 传递方式：
   * - "query": ?url=<encoded>（cf-proxy 兼容，推荐）
   * - "path":  /<url without scheme>（cf-proxy 也支持，某些代理只认这个）
   */
  mode?: "query" | "path";
  /** 鉴权/额外 header（如 Authorization: Bearer xxx）*/
  headers?: Record<string, string>;
  /**
   * 只代理这些 base（对应 SiteModel.bases 的 key）。
   * 空/未指定 = 全部代理。
   * 例: only: ["api"] 只代理主 API，不代理 CDN
   */
  only?: string[];
  /**
   * 是否也代理播放流（m3u8/mp4）。默认 false。
   * 注意: 播流量大，可能超 CF 免费额度或触发反爬；默认关。
   */
  proxy_media?: boolean;
}

// ============ SiteModel 主文档 ============
export interface SiteModel {
  /** 站点名（用作 spider 文件名前缀）*/
  name: string;
  /** 显示名 */
  display_name: string;
  /** 站点主 URL（Referer 等用）*/
  site_url: string;
  /** 命名 base URL：{ api: "https://m10.xxx", rank: "https://rank.xxx" } */
  bases: Record<string, string>;
  /** 请求头（默认 UA/Referer）*/
  headers?: Record<string, string>;

  /** 签名 */
  signing?: SigningConfig;
  /** bootstrap（可选，无签名或简单签名站点不需要）*/
  bootstrap?: BootstrapConfig;
  /** 所有端点 */
  endpoints: Endpoint[];
  /** 字段映射（列表和详情共用一份，允许字段候选足够多）*/
  mappings: FieldMappings;
  /** 分类 */
  categories: Category[];

  /**
   * 播放地址决策后处理
   * - 有些站响应里就是最终 URL，直接返回给 FongMi (parse=0)
   * - 有些站需要网页嗅探，返回 parse=1 + 前端 URL 让 FongMi 播放器嗅探
   */
  play_result?: {
    /** 命中挑选式时: 直接返回 URL (parse=0) */
    on_hit?: { parse: 0; headers?: Record<string, string> };
    /** 未命中时: 退回嗅探 (parse=1)，url = site_url + fallback_url_template */
    on_miss?: { parse: 1; url_template: string /* "{site_url}/play/{id}" */ };
  };

  /** 首页/分类翻页策略：'server' 走端点分页 | 'local' 本地切片 */
  paging?: {
    strategy: "server" | "local";
    page_size?: number;
  };

  /** 请求代理（GEO block 绕过用，可选）*/
  proxy?: ProxyConfig;
}

// ============ Runtime 传参 ============
/** 生成 spider 时的选项 */
export interface GenerateOptions {
  /** 输出 TVBox site key */
  site_key?: string;
  /** flags（FongMi 播放器 flags）*/
  flags?: string[];
  /** 是否需要 quickSearch */
  quickSearch?: boolean;
  /** 是否 filterable */
  filterable?: boolean;
}
