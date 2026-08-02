/**
 * SiteModel 自动推理器 — 从 CapturedXHR[] 生成 SiteModel 草稿
 *
 * ## 输入
 * 用户在目标站正常浏览时插件抓的所有 XHR 请求（含请求头/URL/响应体）
 *
 * ## 输出
 * 一份 SiteModel 草稿, 用户在 UI 里复核 + 微调 + 保存
 *
 * ## 核心推理步骤
 *
 * ### 1. 过滤 API 请求
 * 只保留：
 *   - 响应是 JSON (Content-Type: application/json 或 body 以 { 开头)
 *   - URL 里有 /api/ 或 /v3/ 或响应看起来像结构化数据
 *   - 排除广告/统计 URL (googleads/doubleclick/analytics)
 *
 * ### 2. 检测签名参数
 * 对每个 URL:
 *   - 找可疑参数 (32 hex = md5, 40 hex = sha1, 64 hex = sha256)
 *   - 找配对的时间戳/pub 参数 (13 位数字 = ms 时间戳; 长字符串 = cert)
 *
 * ### 3. 按 host + path 分组端点
 *   - 同一 host + path 前缀 = 一个端点候选
 *   - 从多个调用中提取变化的参数 → 模板变量
 *   - 从固定的参数 → 硬编码
 *
 * ### 4. 分类端点角色
 *   - path 含 home/list/index/getAll → home
 *   - path 含 detail/info → detail
 *   - path 含 play/video → play
 *   - path 含 search/query → search
 *   - path 含 episodes/playlist/season → episodes
 *
 * ### 5. 从响应体推字段
 *   - 找数组字段 (可能是列表)
 *   - 数组元素里找 id/name/title/pic/cover 之类 → mappings
 *
 * ### 6. 组装 SiteModel
 *   - bases: host → key
 *   - endpoints: 每组一个
 *   - mappings: 合并所有 endpoint 的字段候选
 *
 * ## 局限性 (需要人工介入的)
 * - 签名算法 (md5/sha1/hmac) 不能从 URL 推 → 显示"待确认: 32 hex 疑似 md5"
 * - 签名的公式 (哪些字段拼进去) 不能推 → 让用户点 🔍 验证器逐个试
 * - Bootstrap 逻辑 (cert 模式) 完全靠人 → 提示"检测到长 pub, 可能需 bootstrap"
 * - 密钥表 → 完全靠人从 bundle 抓
 */

import type { CapturedXHR } from "./messages";
import type { SiteModel, Endpoint, SignMode, Category, FieldMappings } from "./site-model";

// ============ 类型 ============

/** 一条 URL 里检测到的签名参数 */
export interface SignParam {
  key: string;
  value: string;
  guess: "md5" | "sha1" | "sha256" | "timestamp-ms" | "long-cert" | "random-hex" | "unknown";
  reason: string;
}

/** 端点候选 */
export interface EndpointCandidate {
  host: string;
  path: string;
  method: string;
  /** 所有调用 */
  samples: CapturedXHR[];
  /** URL query 里所有参数出现次数 */
  paramFreq: Map<string, Set<string>>;
  /** 检测到的签名参数 (来自任一样本) */
  signParams: SignParam[];
  /** 猜出的角色 */
  roleGuess: "home" | "detail" | "play" | "search" | "episodes" | "unknown";
  /** 响应字段候选 */
  responseFields: {
    listPath?: string;
    itemFields?: string[];
    firstItemSample?: any;
  };
}

export interface InferResult {
  model: SiteModel;
  /** 端点候选详情 (UI 显示用) */
  candidates: EndpointCandidate[];
  /** 全站签名参数汇总 */
  signParams: SignParam[];
  /** 提示信息 */
  hints: string[];
}

// ============ 主入口 ============

export function inferSiteModel(xhrs: CapturedXHR[], siteUrl: string): InferResult {
  const hints: string[] = [];

  // 1. 过滤 API 请求
  const apiXhrs = xhrs.filter(isLikelyApi);
  hints.push(`总 XHR: ${xhrs.length}, 疑似 API: ${apiXhrs.length}`);

  // 2. 按 host+path 分组
  const groups = groupByEndpoint(apiXhrs);
  hints.push(`识别出 ${groups.size} 个端点候选`);

  // 3. 每组分析
  const candidates: EndpointCandidate[] = [];
  for (const [key, samples] of groups) {
    const [host, path, method] = key.split("|");
    const cand = analyzeGroup(host, path, method, samples);
    candidates.push(cand);
  }

  // 4. 全站签名参数汇总
  const allSignParams = dedupSignParams(candidates.flatMap((c) => c.signParams));
  if (allSignParams.length) {
    const summary = allSignParams.map((s) => `${s.key}(${s.guess})`).join(", ");
    hints.push(`签名参数: ${summary}`);
  }

  // 5. 组装 SiteModel
  const model = buildModel(candidates, siteUrl, allSignParams);

  // 6. 添加行动建议
  const roleCoverage = new Set(candidates.map((c) => c.roleGuess));
  if (!roleCoverage.has("home")) hints.push("⚠️ 未识别 home 端点 — 可能需要浏览分类页触发");
  if (!roleCoverage.has("play")) hints.push("⚠️ 未识别 play 端点 — 可能需要点击播放触发");
  if (allSignParams.some((s) => s.guess === "long-cert")) {
    hints.push("💡 检测到长签名参数(可能是 cert), 需要在浏览器控制台找 pConfig 或类似 bootstrap");
  }
  if (allSignParams.some((s) => s.guess === "md5" || s.guess === "random-hex")) {
    hints.push("💡 检测到 32 hex 签名, 疑似 md5 — 打开签名验证器逆算法");
  }

  return { model, candidates, signParams: allSignParams, hints };
}

// ============ 步骤 1: 过滤 API ============

function isLikelyApi(xhr: CapturedXHR): boolean {
  const url = xhr.url;
  // 排除黑名单
  const blocklist = [
    "googleads", "doubleclick.net", "google-analytics", "googletagmanager",
    "facebook.com/tr", "hotjar.com", "clarity.ms", "sentry.io",
    "beacon", "collect", "pixel", "cloudflare.com/cdn-cgi",
  ];
  if (blocklist.some((k) => url.includes(k))) return false;

  // 白名单 (强特征)
  if (/\/api\/|\/v\d+\/|\.json(\?|$)|\/graphql/i.test(url)) return true;

  // 响应 Content-Type 是 JSON
  if (xhr.respContentType && /json|javascript/i.test(xhr.respContentType)) return true;

  // 响应体像 JSON
  const body = xhr.respBody?.trim();
  if (body && (body.startsWith("{") || body.startsWith("["))) return true;

  return false;
}

// ============ 步骤 2: 分组 ============

function groupByEndpoint(xhrs: CapturedXHR[]): Map<string, CapturedXHR[]> {
  const groups = new Map<string, CapturedXHR[]>();
  for (const x of xhrs) {
    try {
      const u = new URL(x.url);
      // path 归一化：去掉 id 段（\d+ 或 hex）
      const normalPath = u.pathname
        .replace(/\/\d+(?=\/|$)/g, "/{id}")
        .replace(/\/[a-f0-9]{16,}(?=\/|$)/gi, "/{id}");
      const key = `${u.host}|${normalPath}|${x.method}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(x);
    } catch {}
  }
  return groups;
}

// ============ 步骤 3: 分析一组 ============

function analyzeGroup(host: string, path: string, method: string, samples: CapturedXHR[]): EndpointCandidate {
  const paramFreq = new Map<string, Set<string>>();
  const signParams: SignParam[] = [];

  for (const s of samples) {
    try {
      const u = new URL(s.url);
      u.searchParams.forEach((v, k) => {
        if (!paramFreq.has(k)) paramFreq.set(k, new Set());
        paramFreq.get(k)!.add(v);
        const sp = classifySignParam(k, v);
        if (sp && !signParams.find((x) => x.key === k)) signParams.push(sp);
      });
    } catch {}
  }

  // 响应字段
  const responseFields = analyzeResponse(samples);

  // 角色猜
  const roleGuess = guessRole(path, responseFields);

  return { host, path, method, samples, paramFreq, signParams, roleGuess, responseFields };
}

// ============ 签名参数分类 ============

function classifySignParam(key: string, value: string): SignParam | null {
  const k = key.toLowerCase();
  const v = String(value);

  // 关键字命中
  const signNames = ["vv", "sign", "signature", "sig", "token", "auth", "hash"];
  const pubNames = ["pub", "ts", "timestamp", "time", "t", "_t", "nonce", "salt"];

  const isHex = /^[a-f0-9]+$/i.test(v);
  const isNumeric = /^\d+$/.test(v);

  if (isHex && v.length === 32) {
    return { key, value, guess: "md5", reason: "32 hex" };
  }
  if (isHex && v.length === 40) return { key, value, guess: "sha1", reason: "40 hex" };
  if (isHex && v.length === 64) return { key, value, guess: "sha256", reason: "64 hex" };

  if (signNames.includes(k) && isHex) {
    return { key, value, guess: "random-hex", reason: `参数名 ${k} + hex 值` };
  }

  if (pubNames.includes(k)) {
    if (isNumeric && v.length === 13) return { key, value, guess: "timestamp-ms", reason: "13 位数字(ms 时间戳)" };
    if (isNumeric && v.length === 10) return { key, value, guess: "timestamp-ms", reason: "10 位数字(秒 时间戳)" };
    if (v.length > 50) return { key, value, guess: "long-cert", reason: `参数名 ${k} + 长值(可能 cert)` };
  }

  // 长非空非数字非 hex 值 (base64 / cert)
  if (v.length > 80 && !isNumeric) {
    return { key, value, guess: "long-cert", reason: "长非数字值" };
  }

  return null;
}

// ============ 响应字段分析 ============

function analyzeResponse(samples: CapturedXHR[]): EndpointCandidate["responseFields"] {
  for (const s of samples) {
    if (!s.respBody) continue;
    try {
      const j = JSON.parse(s.respBody);
      // spider 的 callEndpoint 会剥 data 层, 所以我们在 data 内层找路径
      const searchRoot = j && j.data && typeof j.data === "object" ? j.data : j;
      const listInfo = findListInObject(searchRoot, "");
      if (listInfo) {
        const first = listInfo.list[0];
        const fields = first && typeof first === "object" ? Object.keys(first) : [];
        return { listPath: listInfo.path, itemFields: fields, firstItemSample: first };
      }
      // 没找到列表, 记 root 顶层字段
      if (searchRoot && typeof searchRoot === "object") {
        return { itemFields: Object.keys(searchRoot), firstItemSample: searchRoot };
      }
    } catch {}
  }
  return {};
}

/** 递归找 JSON 里"含多个 xxxList 字段"的对象（多分类首页）*/
function findMultiListObject(obj: any, path: string, depth = 0): { basePath: string; fields: string[] } | null {
  if (depth > 5 || obj == null) return null;
  if (Array.isArray(obj)) {
    // 数组里第一个元素可能是有 xxxList 的对象
    if (obj.length && typeof obj[0] === "object" && obj[0] !== null) {
      const first = obj[0];
      const listFields = Object.entries(first)
        .filter(([k, v]) => Array.isArray(v) && (v as any[]).length > 0 && /list$/i.test(k))
        .map(([k]) => k);
      if (listFields.length >= 2) return { basePath: `${path}[0]`, fields: listFields };
    }
    return null;
  }
  if (typeof obj !== "object") return null;
  // 直接检查当前对象
  const listFields = Object.entries(obj)
    .filter(([k, v]) => Array.isArray(v) && (v as any[]).length > 0 && /list$/i.test(k))
    .map(([k]) => k);
  if (listFields.length >= 2) return { basePath: path, fields: listFields };
  // 递归子字段
  for (const k of Object.keys(obj)) {
    const sub = findMultiListObject(obj[k], path ? `${path}.${k}` : k, depth + 1);
    if (sub) return sub;
  }
  return null;
}

/** 递归找 JSON 里最像列表的字段 */
function findListInObject(obj: any, path: string, depth = 0): { path: string; list: any[] } | null {
  if (depth > 5 || obj == null) return null;
  // 直接是数组 (元素是 object)
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] === "object" && obj[0] !== null) {
      const keys = Object.keys(obj[0]);
      // 至少有一个像 id 的字段
      if (keys.some((k) => /id|key|title|name/i.test(k))) return { path, list: obj };
    }
    return null;
  }
  if (typeof obj !== "object") return null;

  // 优先猜 result/list/data/items/records
  const priorityKeys = ["list", "result", "data", "items", "records", "content", "info"];
  for (const k of priorityKeys) {
    if (obj[k] != null) {
      const sub = findListInObject(obj[k], path ? `${path}.${k}` : k, depth + 1);
      if (sub) return sub;
    }
  }
  // 尝试所有 key
  for (const k of Object.keys(obj)) {
    const sub = findListInObject(obj[k], path ? `${path}.${k}` : k, depth + 1);
    if (sub) return sub;
  }
  return null;
}

// ============ 角色猜 ============

function guessRole(path: string, resp: EndpointCandidate["responseFields"]): EndpointCandidate["roleGuess"] {
  const p = path.toLowerCase();
  // 明显的 bootstrap/config
  if (/config|bootstrap|init/.test(p)) return "unknown";
  // play 优先级最高
  if (/play(?!list)|video\/url|source|getvideo/.test(p)) return "play";
  // 剧集列表 (playlist/language/season/episode)
  if (/(playlist|languagesplaylist|episode|season)/.test(p)) return "episodes";
  // 搜索
  if (/search|briefsearch|query|find/.test(p)) return "search";
  // 详情 — 明确关键字优先于响应结构
  if (/detail|video\/(info|show)|item\//.test(p)) return "detail";
  // 首页/列表
  if (/(home|index|getall|category|feed|topic|list(?!.+detail))/.test(p)) return "home";
  // 兜底: 响应有清晰的列表 = home; 只有单 item = detail
  if (resp.listPath && resp.itemFields && resp.itemFields.some((f) => /id|key/.test(f.toLowerCase()))) return "home";
  return "unknown";
}

// ============ 步骤 5: 组 SiteModel ============

function buildModel(
  candidates: EndpointCandidate[],
  siteUrl: string,
  signParams: SignParam[],
): SiteModel {
  const hosts = new Set(candidates.map((c) => c.host));
  const bases: Record<string, string> = {};
  const hostAlias = new Map<string, string>();
  let hostIdx = 0;
  for (const h of hosts) {
    const alias = hostIdx === 0 ? "api" : `api${hostIdx + 1}`;
    bases[alias] = `https://${h}`;
    hostAlias.set(h, alias);
    hostIdx++;
  }

  // 构造 endpoints
  const endpoints: Endpoint[] = [];
  const seenNames = new Set<string>();
  // 检测 bootstrap 候选: path 含 config/init/bootstrap
  const bootstrapCand = candidates.find((c) => /config|bootstrap|init/.test(c.path.toLowerCase()));
  for (const c of candidates) {
    let name: string;
    if (c === bootstrapCand) {
      name = "config";
    } else if (c.roleGuess === "unknown") {
      name = sanitizeName(c.path);
    } else {
      name = c.roleGuess;
    }
    let n = name; let i = 1;
    while (seenNames.has(n)) n = `${name}_${i++}`;
    seenNames.add(n);
    endpoints.push({
      name: n,
      base: hostAlias.get(c.host)!,
      path: c.path.replace(/^\//, ""),
      query: buildQueryTemplate(c),
      // config 端点只能用 timestamp（bootstrap 前无 pConfig）
      sign_mode: c === bootstrapCand ? (c.signParams.length ? "timestamp-draft" : "none") : (c.signParams.length ? "auto" : "none"),
      response: buildResponseSpec(c),
    });
  }

  // signing (草稿)
  const signing = buildSigningDraft(signParams);

  // Bootstrap 草稿 — 如果检测到 config 端点 + 可能的 cert 参数
  let bootstrap: SiteModel["bootstrap"] | undefined;
  if (bootstrapCand) {
    // 尝试从 config 响应体里找 publicKey/privateKey 类字段
    const sample = bootstrapCand.samples.find((s) => s.respBody);
    let publicKeyPath = "info[0].pConfig.publicKey";
    let privateKeyPath = "info[0].pConfig.privateKey";
    if (sample?.respBody) {
      try {
        const j = JSON.parse(sample.respBody);
        // bootstrap 引擎从 raw 完整响应找路径（含 data 层）
        const found = findBootstrapFields(j, "");
        if (found.publicKey) publicKeyPath = found.publicKey;
        if (found.privateKey) privateKeyPath = found.privateKey;
      } catch {}
    }
    bootstrap = {
      endpoint: "config",
      extract: {
        publicKey: publicKeyPath,
        privateKey: privateKeyPath,
      },
      transforms: [{ field: "privateKey", op: "as_array" }],
    };
  }

  // mappings (从所有 responseFields 合并)
  const mappings = buildMappings(candidates);

  // categories 推理：
  // 情况 A: home 响应的某处对象里有多个 "xxxList" 字段 → 每个字段一个 category
  // 情况 B: home 有单一列表 listPath → 一个 "all" category
  const homeCand = candidates.find((c) => c.roleGuess === "home");
  let categories: Category[] = [];
  if (homeCand) {
    // 尝试在 home 响应体里递归找"多 List 字段"的对象
    let multiListInfo: { basePath: string; fields: string[] } | null = null;
    for (const s of homeCand.samples) {
      if (!s.respBody) continue;
      try {
        const j = JSON.parse(s.respBody);
        const searchRoot = j && j.data && typeof j.data === "object" ? j.data : j;
        multiListInfo = findMultiListObject(searchRoot, "");
        if (multiListInfo) break;
      } catch {}
    }
    if (multiListInfo && multiListInfo.fields.length >= 2) {
      categories = multiListInfo.fields.map((fieldName) => ({
        kind: "static" as const,
        id: fieldName,
        name: translateListFieldName(fieldName),
        source_field: multiListInfo!.basePath ? `${multiListInfo!.basePath}.${fieldName}` : fieldName,
      }));
    } else if (homeCand.responseFields.listPath) {
      // 单列表模式
      categories = [{ kind: "static" as const, id: "all", name: "全部", source_field: homeCand.responseFields.listPath }];
    }
  }

  return {
    name: hostFromUrl(siteUrl).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 20) || "site",
    display_name: hostFromUrl(siteUrl),
    site_url: siteUrl,
    bases,
    signing,
    bootstrap,
    endpoints,
    mappings,
    categories,
    paging: { strategy: "local", page_size: 30 },
  };
}

/** 递归在响应里找 publicKey/privateKey 类字段 */
function findBootstrapFields(obj: any, path: string, depth = 0): { publicKey?: string; privateKey?: string } {
  if (depth > 6 || obj == null) return {};
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length && i < 5; i++) {
      const sub = findBootstrapFields(obj[i], `${path}[${i}]`, depth + 1);
      if (sub.publicKey || sub.privateKey) return sub;
    }
    return {};
  }
  if (typeof obj !== "object") return {};
  const out: { publicKey?: string; privateKey?: string } = {};
  for (const k of Object.keys(obj)) {
    const sub = path ? `${path}.${k}` : k;
    if (/^publickey$/i.test(k) && typeof obj[k] === "string") out.publicKey = sub;
    else if (/^privatekey$/i.test(k)) out.privateKey = sub;
    if (!out.publicKey || !out.privateKey) {
      const deep = findBootstrapFields(obj[k], sub, depth + 1);
      if (!out.publicKey && deep.publicKey) out.publicKey = deep.publicKey;
      if (!out.privateKey && deep.privateKey) out.privateKey = deep.privateKey;
    }
  }
  return out;
}

function hostFromUrl(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}

function sanitizeName(path: string): string {
  return path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 30) || "ep";
}

function buildQueryTemplate(c: EndpointCandidate): string {
  const parts: string[] = [];
  for (const [k, vals] of c.paramFreq) {
    // 签名参数不入 query 模板（由 signing.attach 处理）
    if (c.signParams.some((s) => s.key === k)) continue;
    if (vals.size === 1) {
      // 固定值
      parts.push(`${k}=${[...vals][0]}`);
    } else {
      // 变化值 → 变量
      const varName = guessVarName(k);
      parts.push(`${k}={${varName}}`);
    }
  }
  return parts.join("&");
}

function guessVarName(paramKey: string): string {
  const k = paramKey.toLowerCase();
  if (/^(id|vid|video|item)/.test(k)) return "id";
  if (/^(page|pg|p)$/.test(k)) return "page";
  if (/^(size|limit|count|num)$/.test(k)) return "size";
  if (/(wd|keyword|q|search|query|tags)/.test(k)) return "wd";
  return paramKey;
}

/** 把 English list field name 翻译成中文分类名 */
function translateListFieldName(fieldName: string): string {
  const map: Record<string, string> = {
    filmList: "电影", movieList: "电影",
    tvList: "剧集", seriesList: "剧集", dramaList: "剧集",
    varietyList: "综艺", showList: "综艺",
    animeList: "动漫", animationList: "动漫", cartoonList: "动漫",
    shortList: "短剧",
    documentaryList: "纪录片", docList: "纪录片",
    sportList: "体育", sportsList: "体育",
    musicList: "音乐", mvList: "MV",
    gameList: "游戏",
    kidsList: "少儿", childList: "少儿",
  };
  if (map[fieldName]) return map[fieldName];
  // 兜底: 首字母大写化并去掉 List/s 后缀
  return fieldName
    .replace(/List$/, "")
    .replace(/s$/, "")
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function buildResponseSpec(c: EndpointCandidate): Endpoint["response"] {
  if (!c.responseFields.listPath && !c.responseFields.itemFields) return undefined;
  if (c.roleGuess === "home" || c.roleGuess === "search") {
    return { list: { path: c.responseFields.listPath || "" } };
  }
  if (c.roleGuess === "episodes") {
    return { episodes: { path: c.responseFields.listPath || "" } };
  }
  if (c.roleGuess === "detail") {
    return { item: { path: c.responseFields.listPath || "" } };
  }
  if (c.roleGuess === "play") {
    // play 挑选式需要人工看响应确认字段 — 草稿给个占位
    return {
      play_url: {
        priority: [
          { path: "data.url" },
          { path: "url" },
          { path: "data.play_url" },
        ],
      },
    };
  }
  return undefined;
}

function buildSigningDraft(signParams: SignParam[]): SiteModel["signing"] | undefined {
  const md5Param = signParams.find((s) => s.guess === "md5");
  const tsParam = signParams.find((s) => s.guess === "timestamp-ms");
  const longParam = signParams.find((s) => s.guess === "long-cert");

  if (!md5Param && !signParams.some((s) => s.guess === "random-hex")) return undefined;

  const modes: SignMode[] = [];

  // Timestamp 模式草稿
  if (tsParam && md5Param) {
    modes.push({
      name: "timestamp-draft",
      vars: {
        pub: { kind: "timestamp" },
        query_lower: { kind: "query_lower" },
        pk: { kind: "literal", value: "PLEASE_FILL_KEY_TABLE_OR_LITERAL" },
      },
      formula: "{pub}&{query_lower}&{pk}",
      algorithm: "md5",
      attach: { [md5Param.key]: "{sign}", [tsParam.key]: "{pub}" },
    });
  }

  // Cert 模式草稿
  if (longParam && md5Param) {
    modes.push({
      name: "cert-draft",
      vars: {
        pub: { kind: "bootstrap", path: "publicKey" },
        query_lower: { kind: "query_lower" },
        pk: { kind: "bootstrap", path: "privateKey[0]" },
      },
      formula: "{pub}&{query_lower}&{pk}",
      algorithm: "md5",
      attach: { [md5Param.key]: "{sign}", [longParam.key]: "{pub}" },
    });
  }

  if (!modes.length && md5Param) {
    // 只有 md5, 猜通用模板
    modes.push({
      name: "unknown-md5",
      vars: {
        query_lower: { kind: "query_lower" },
      },
      formula: "{query_lower}",
      algorithm: "md5",
      attach: { [md5Param.key]: "{sign}" },
    });
  }

  return { modes, default_strategy: "auto" };
}

function buildMappings(candidates: EndpointCandidate[]): FieldMappings {
  // 采样列表 item (从 categories 的多 List / 或列表端点的 item)
  // 用真实 item 的字段做 mapping 依据, 而不是所有候选合并
  const listItemFields = new Set<string>();
  const listItemSamples: any[] = [];
  const singleItemFields = new Set<string>();
  for (const c of candidates) {
    // 尝试挖出 "list of vod" 的样本
    for (const s of c.samples) {
      if (!s.respBody) continue;
      try {
        const j = JSON.parse(s.respBody);
        // 从 data 内找所有可能的 vod 数组
        const items = findAllVodItems(j?.data ?? j);
        for (const it of items) {
          for (const k of Object.keys(it)) listItemFields.add(k);
          if (listItemSamples.length < 5) listItemSamples.push(it);
        }
      } catch {}
    }
    if (c.roleGuess === "detail" && c.responseFields.itemFields) {
      c.responseFields.itemFields.forEach((f) => singleItemFields.add(f));
    }
  }

  const allFields = [...listItemFields, ...singleItemFields];
  const has = (arr: string[], want: string[]) => arr.filter((f) => want.some((w) => new RegExp(`^${w}$`, "i").test(f)));
  const startsWith = (arr: string[], want: string[]) => arr.filter((f) => want.some((w) => new RegExp(w, "i").test(f)));

  // === ID 字段: 严格从"短字符串标识"里挑 ===
  // 不用长字段(如 contxt=简介)。要求样本值 <= 40 字符
  const idCandidateRaw = has(allFields, ["id", "vid", "key", "vod_id"]);
  const idCandidate = idCandidateRaw.filter((f) => {
    // 从样本里验证值长度合理
    for (const sample of listItemSamples) {
      if (sample[f] != null) {
        const s = String(sample[f]);
        if (s.length <= 40) return true;
        return false;
      }
    }
    return true; // 没样本就保留
  });

  // === 名称: 严格 title/name ===
  const nameCandidate = has(allFields, ["title", "name", "vod_name"]);
  // === 图片 ===
  const picCandidate = has(allFields, ["image", "imgPath", "cover", "pic", "poster", "thumb", "img_url", "vod_pic"]);
  // === 年份 (只要严格 year 字段) ===
  const yearCandidate = has(allFields, ["year", "post_year", "vod_year"]);
  // === 地区 ===
  const areaCandidate = has(allFields, ["regional", "area", "region", "country", "vod_area"]);
  // === 演员 ===
  const actorCandidate = has(allFields, ["starring", "stars", "actor", "actors", "vod_actor"]);
  // === 导演 ===
  const directorCandidate = has(allFields, ["directed", "directors", "director", "vod_director"]);
  // === 简介 (contxt / short_des / content 全放这里) ===
  const contentCandidate = has(allFields, ["shortDes", "contxt", "desc", "description", "content", "intro", "summary", "vod_content"]);
  // === 备注 (更新/评分/热度) ===
  const remarkCandidate = has(allFields, ["lastName", "score", "rating", "remark", "vod_remarks"]);

  const noneEmpty = <T>(arr: T[], fallback: T[]): T[] => (arr.length ? arr : fallback);

  return {
    vod_id: noneEmpty(idCandidate, ["id", "key"]),
    vod_name: noneEmpty(nameCandidate, ["name", "title"]),
    vod_pic: noneEmpty(picCandidate, ["pic", "image"]),
    vod_year: yearCandidate.length ? yearCandidate : undefined,
    vod_area: areaCandidate.length ? areaCandidate : undefined,
    vod_actor: actorCandidate.length ? actorCandidate : undefined,
    vod_director: directorCandidate.length ? directorCandidate : undefined,
    vod_content: contentCandidate.length ? contentCandidate : undefined,
    vod_remarks: remarkCandidate.length ? remarkCandidate : undefined,
    ep_name: ["name", "title"],
    ep_id: ["key", "id"],
  };
}

/** 递归找 JSON 里所有像 vod 的 item (含 title/name 且不太长) */
function findAllVodItems(obj: any, depth = 0, out: any[] = []): any[] {
  if (depth > 6 || obj == null) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item);
        // 是 vod-like: 有 title/name + 有 id-like
        const hasName = keys.some((k) => /^(title|name)$/i.test(k));
        const hasId = keys.some((k) => /^(id|key|vid)$/i.test(k));
        if (hasName && hasId) out.push(item);
      }
      if (item && typeof item === "object") findAllVodItems(item, depth + 1, out);
    }
    return out;
  }
  if (typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) findAllVodItems(obj[k], depth + 1, out);
  return out;
}

// ============ 去重工具 ============
function dedupSignParams(arr: SignParam[]): SignParam[] {
  const seen = new Map<string, SignParam>();
  for (const s of arr) {
    if (!seen.has(s.key)) seen.set(s.key, s);
  }
  return [...seen.values()];
}
