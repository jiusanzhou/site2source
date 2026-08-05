/**
 * SPA 站点 API 收割器
 *
 * 背景：Angular/React/Vue SPA 站点（如 aiyifan）的分类页 HTML 是空壳，
 * 内容全靠 XHR 拉。而这些 XHR 往往带签名（vv/pub），逆向成本高。
 *
 * 方案：不逆向签名，让页面自己发请求，我们只收割响应体。
 * 页面 = 签名机。这对任何签名方案都有效，且不会因为算法升级而失效。
 *
 * 用法（扩展 content script 侧）：
 *   1. 用户在目标站点点「学习分类页」
 *   2. content script 注入 hook，记录所有 XHR 的 (url, responseBody)
 *   3. 分析响应体，找出「哪个端点返回视频列表」+ 「字段映射」
 *   4. 生成的 spider 用 T4 的 `预处理` 钩子调这些端点（带签名的 URL 可以在
 *      运行时由 drpy 的 WebView 模式拿到，或者 fallback 到嗅探）
 */

export interface HarvestedEndpoint {
  url: string;              // 去掉 query 的 path
  fullUrl: string;          // 完整 URL（含签名，可能过期）
  method: string;
  itemCount: number;        // 响应里的 item 数量
  /** 推断出的字段映射：videoList 字段路径 → 具体字段名 */
  fieldMap?: {
    listPath: string;       // 如 "data.info" 或 "data.info[0].result"
    title?: string;
    image?: string;
    key?: string;           // 详情页 id
    remarks?: string;       // 更新状态
    category?: string;
  };
  sample: string;
}

/** 在响应 JSON 里递归找「看起来是视频列表」的数组 */
export function findVideoList(json: any, path = ""): { path: string; items: any[] } | null {
  if (!json || typeof json !== "object") return null;

  if (Array.isArray(json)) {
    // 数组里的对象是否含 title/name + image/pic 之类字段？
    const first = json[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const keys = Object.keys(first).map((k) => k.toLowerCase());
      const hasTitle = keys.some((k) => /^(title|name|videoname|vodname)$/.test(k));
      const hasImage = keys.some((k) => /(image|img|pic|cover|poster|thumb)/.test(k));
      if (hasTitle && hasImage && json.length >= 2) {
        return { path, items: json };
      }
    }
    // 数组元素本身可能嵌套（如 info[0].result）
    for (let i = 0; i < Math.min(json.length, 3); i++) {
      const r = findVideoList(json[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }

  // 对象：优先常见容器字段
  const preferred = ["result", "list", "info", "data", "items", "records", "videos"];
  for (const k of preferred) {
    if (k in json) {
      const r = findVideoList(json[k], path ? `${path}.${k}` : k);
      if (r) return r;
    }
  }
  for (const k of Object.keys(json)) {
    if (preferred.includes(k)) continue;
    const r = findVideoList(json[k], path ? `${path}.${k}` : k);
    if (r) return r;
  }
  return null;
}

/** 从 item 样本推断字段名 */
export function inferFieldMap(items: any[]): NonNullable<HarvestedEndpoint["fieldMap"]> | null {
  if (!items.length) return null;
  const item = items[0];
  const keys = Object.keys(item);

  const pick = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const found = keys.find((k) => re.test(k));
      if (found) return found;
    }
    return undefined;
  };

  return {
    // 注意：listPath 由 analyzeHarvest 回填。这里不能写 item 里的同名字段，
    // 否则会被数据值覆盖（曾经踩过：banner 响应里有个 listPath 字段）
    listPath: "",
    title: pick([/^(title|name|videoName|vodName)$/i, /title/i, /^name$/i]),
    image: pick([/^(image|img|imgPath|pic|cover|poster)$/i, /image/i, /imgpath/i, /pic/i, /cover/i]),
    key: pick([/^(key|vid|videoId|vodId)$/i, /^key$/i, /^id$/i]),
    remarks: pick([/^(lastName|remarks|note|updateInfo|serialCount)$/i, /lastname/i, /remark/i, /note/i]),
    category: pick([/^(atypeName|typeName|className|category)$/i, /typename/i, /classname/i, /^cid$/i]),
  };
}

/** 判断一个端点是不是"真的视频列表"（过滤支付/公告等误判） */
function looksLikeVideoEndpoint(url: string, items: any[], fm: NonNullable<HarvestedEndpoint["fieldMap"]>): boolean {
  // 明显非视频的 path
  if (/\/(payment|pay|order|user|login|comment|barrage|danmu|notify|ad|banner)\b/i.test(url)) {
    // banner 有时也是视频入口，但字段特征不同，单独放宽
    if (!/banner/i.test(url)) return false;
  }
  // 必须同时有 title + image + key，缺一个就可疑
  if (!fm.title || !fm.image || !fm.key) return false;
  // 视频列表通常有 remarks 或 category 之一（集数/类型）
  if (!fm.remarks && !fm.category) return false;
  // item 里的 image 值应该像图片 URL
  const imgVal = items[0]?.[fm.image];
  if (typeof imgVal === "string" && !/\.(jpg|jpeg|png|webp|gif|avif)/i.test(imgVal) && !imgVal.startsWith("http")) {
    return false;
  }
  return true;
}

/** 分析一批收割来的响应，输出可用端点 */
export function analyzeHarvest(
  raw: Array<{ url: string; method: string; body: string }>
): HarvestedEndpoint[] {
  const out: HarvestedEndpoint[] = [];
  for (const r of raw) {
    let json: any;
    try {
      json = JSON.parse(r.body);
    } catch {
      continue;
    }
    const found = findVideoList(json);
    if (!found || found.items.length < 2) continue;
    const fieldMap = inferFieldMap(found.items);
    if (!fieldMap?.title) continue;
    if (!looksLikeVideoEndpoint(r.url, found.items, fieldMap)) continue;
    // listPath 在这里回填（inferFieldMap 里留空，避免被数据字段覆盖）
    fieldMap.listPath = found.path;
    out.push({
      url: r.url.split("?")[0],
      fullUrl: r.url,
      method: r.method,
      itemCount: found.items.length,
      fieldMap,
      sample: JSON.stringify(found.items[0]).slice(0, 400),
    });
  }
  // 按 item 数量排序，多的更可能是主列表
  out.sort((a, b) => b.itemCount - a.itemCount);
  return out;
}
