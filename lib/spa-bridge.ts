/**
 * 桥接：spa-harvester 的分析结果 → drpy API spider 输入
 *
 * harvester 只知道"哪个端点返回视频列表 + 字段叫什么"，
 * 还需要几步推断才能变成可用的 spider：
 *   1. 分类参数是哪个 query key（cid? type? tid?）
 *   2. 分页参数是哪个（page? p? pageIndex?）
 *   3. 详情页 URL 怎么拼（从 key 字段 + 站点路由推断）
 */

import type { HarvestedEndpoint } from "./spa-harvester";
import type { APIGenerateInput } from "./drpy-generator";
import type { CapturedMedia } from "./messages";

/** 常见分类参数名（按可能性排序） */
const CATEGORY_PARAMS = ["cid", "tid", "type", "typeId", "classId", "category", "cateId", "class"];
/** 常见分页参数名 */
const PAGE_PARAMS = ["page", "p", "pageIndex", "pageNum", "pg", "offset"];
/** 常见每页数量参数名 */
const SIZE_PARAMS = ["size", "pageSize", "limit", "count", "PageSize", "num"];

export interface BridgeOptions {
  siteName: string;
  host: string;
  /** 从首页导航学到的分类（name + 链接或 id） */
  categories?: { name: string; value: string }[];
  /** 详情页路由模板，如 "/play/{id}" —— 从用户学详情页时的 URL 推断 */
  detailRoute?: string;
  media?: CapturedMedia[];
  /** 搜索端点（如果 harvester 也抓到了搜索响应） */
  searchEndpoint?: HarvestedEndpoint;
}

/** 签名类参数名 —— 这些是一次性的，spider 复用会失效 */
const SIGNATURE_PARAMS = [
  "vv", "pub", "sign", "signature", "sig", "token", "_t", "timestamp",
  "nonce", "ts", "_signature", "x-sign", "authkey", "key_sign",
];

/** 把 URL 里的具体值替换成 drpy 占位符 */
export function templatizeURL(
  url: string
): {
  template: string;
  categoryParam?: string;
  pageParam?: string;
  sizeParam?: string;
  /** 被移除的签名参数 —— 非空说明这个端点需要签名，spider 直接调会 401/签名错误 */
  strippedSignatures: string[];
} {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { template: url, strippedSignatures: [] };
  }

  const sp = u.searchParams;
  let categoryParam: string | undefined;
  let pageParam: string | undefined;
  let sizeParam: string | undefined;
  const strippedSignatures: string[] = [];

  // 签名参数必须去掉 —— 它们是一次性的，带上会导致签名过期。
  // 但要记下来：如果端点依赖签名，生成的 spider 注定跑不通，得让用户知道。
  for (const cand of SIGNATURE_PARAMS) {
    for (const key of Array.from(sp.keys())) {
      if (key.toLowerCase() === cand.toLowerCase()) {
        strippedSignatures.push(key);
        sp.delete(key);
      }
    }
  }

  // 分类参数 → fyclass
  for (const cand of CATEGORY_PARAMS) {
    const key = Array.from(sp.keys()).find((k) => k.toLowerCase() === cand.toLowerCase());
    if (key) {
      sp.set(key, "fyclass");
      categoryParam = key;
      break;
    }
  }

  // 分页参数 → fypage
  for (const cand of PAGE_PARAMS) {
    const key = Array.from(sp.keys()).find((k) => k.toLowerCase() === cand.toLowerCase());
    if (key) {
      sp.set(key, "fypage");
      pageParam = key;
      break;
    }
  }

  // 每页数量：保留原值，但记下来（UI 可以让用户调大）
  for (const cand of SIZE_PARAMS) {
    const key = Array.from(sp.keys()).find((k) => k.toLowerCase() === cand.toLowerCase());
    if (key) {
      sizeParam = key;
      break;
    }
  }

  u.search = sp.toString();
  // URLSearchParams 会把占位符编码，还回来
  const template = decodeURIComponent(u.toString());
  return { template, categoryParam, pageParam, sizeParam, strippedSignatures };
}

/** bridge 的返回值 */
export interface BridgeResult {
  input: APIGenerateInput;
  warnings: string[];
  /**
   * 端点需要签名 → API 型 spider 注定跑不通。
   * 调用方应该改用「前端路由 + 嗅探」型 spider，或提示用户此站不适合。
   */
  requiresSignature: boolean;
  /** 检测到的签名参数名，用于给用户解释 */
  signatureParams: string[];
}

/** harvester 结果 → APIGenerateInput */
export function bridgeToAPISpider(
  endpoints: HarvestedEndpoint[],
  opts: BridgeOptions
): BridgeResult | null {
  const warnings: string[] = [];
  if (!endpoints.length) return null;

  // 选主列表端点。不能只看 item 数量 —— "猜你喜欢/热榜"这类端点 item 很多但没分页，
  // 拿来当一级列表只能翻出第一页。优先级：
  //   1. 同时有分类参数 + 分页参数（真正的分类列表接口）
  //   2. 有分类参数
  //   3. item 数量多
  const scored = endpoints.map((ep) => {
    const t = templatizeURL(ep.fullUrl);
    let score = 0;
    if (t.categoryParam) score += 100;
    if (t.pageParam) score += 100;
    // URL 路径末段带 list/category 的更可能是分类接口（用末段避免 /api/List/GuessYouLike 误加分）
    const lastSeg = ep.url.split("/").filter(Boolean).pop() || "";
    if (/^(list|getlist|vodlist|category|gettype|videolist)$/i.test(lastSeg)) score += 40;
    // "猜你喜欢/热门/推荐/最新/banner" 这类是首页模块，不是分类列表
    if (/(guessyoulike|recommend|hot|top\d*|banner|renew|lastadd|sublist|flash)/i.test(lastSeg)) score -= 60;
    // 需要签名的端点严重降权 —— spider 无法生成签名
    if (t.strippedSignatures.length) score -= 80;
    score += Math.min(ep.itemCount, 40);
    return { ep, t, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const { ep: primary, t: tpl } = scored[0];
  const { template, categoryParam, pageParam, sizeParam, strippedSignatures } = tpl;

  if (scored.length > 1) {
    warnings.push(
      `主列表端点选了 ${primary.url}（评分 ${scored[0].score}）。` +
        `备选：${scored.slice(1, 4).map((s) => `${s.ep.url.split("/").pop()}(${s.score})`).join(", ")}`
    );
  }

  const requiresSignature = strippedSignatures.length > 0;
  if (requiresSignature) {
    warnings.push(
      `⛔ 该端点带签名参数（${strippedSignatures.join(", ")}）。` +
        `签名是一次性的，spider 复用会返回"签名错误"。` +
        `API 型 spider 对本站不可用 —— 建议改用「前端路由 + 嗅探」型，或放弃本站。`
    );
  }

  if (!categoryParam) {
    warnings.push(
      `未在 ${primary.url} 里找到分类参数（试过 ${CATEGORY_PARAMS.join("/")}）。` +
        `class_url 会被忽略，所有分类返回同样内容 — 请手工确认参数名。`
    );
  }
  if (!pageParam) {
    warnings.push(`未找到分页参数（试过 ${PAGE_PARAMS.join("/")}）。翻页会失效，只能拿第一页。`);
  }
  if (sizeParam) {
    warnings.push(`检测到每页数量参数 ${sizeParam} — 可以手工调大以减少翻页次数。`);
  }

  const fm = primary.fieldMap;
  // listPath 从 "data.info" 转成 drpy 期望的 JSONPath 风格
  const listPath = fm?.listPath ? `$.${fm.listPath}` : "$";

  const input: APIGenerateInput = {
    siteName: opts.siteName,
    host: opts.host,
    home: {
      urlTemplate: template,
      method: (primary.method?.toUpperCase() === "POST" ? "POST" : "GET") as "GET" | "POST",
      listPath,
      fields: {
        id: fm?.key,
        name: fm?.title,
        pic: fm?.image,
        remarks: fm?.remarks,
      },
    },
    categories: opts.categories,
    media: opts.media,
  };

  // 详情：SPA 站的详情通常也是 API，但常见带严格签名。
  // 如果知道前端路由，就让 drpy 走"打开页面 + 嗅探"，比硬拼 API 稳。
  if (opts.detailRoute) {
    input.detail = {
      urlTemplate: opts.detailRoute,
      method: "GET",
      fields: {},
      isFrontendRoute: true,
    };
    warnings.push(
      `详情页用前端路由 ${opts.detailRoute}（SPA 详情 API 常带严格签名）。` +
        `播放地址交给 drpy 嗅探。`
    );
  }

  // 搜索
  if (opts.searchEndpoint) {
    const s = templatizeURL(opts.searchEndpoint.fullUrl);
    const sfm = opts.searchEndpoint.fieldMap;
    input.search = {
      urlTemplate: s.template,
      method: (opts.searchEndpoint.method?.toUpperCase() === "POST" ? "POST" : "GET") as "GET" | "POST",
      listPath: sfm?.listPath ? `$.${sfm.listPath}` : "$",
      fields: { id: sfm?.key, name: sfm?.title, pic: sfm?.image },
    };
  }

  return { input, warnings, requiresSignature, signatureParams: strippedSignatures };
}
