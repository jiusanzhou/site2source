/**
 * JSON 结构分析器
 * 输入一段 JSON 数据, 猜出哪些字段是影视数据 (标题/图/URL/简介/剧集列表)
 * 输出候选 JSONPath, 用户挑选后可以喂给 Drpy 生成 API 型爬虫
 */

export interface JSONField {
  path: string;          // JSONPath, 如 $.data.list[*].title
  kind: "title" | "pic" | "url" | "desc" | "list" | "id" | "playURL" | "unknown";
  sample?: string;       // 一个示例值
  count: number;         // 该 path 出现次数 (数组场景)
  confidence: number;    // 0-1
}

/** 猜测字段类型的启发式规则 */
const FIELD_HINTS: Array<{ kind: JSONField["kind"]; keys: RegExp; valuePattern?: RegExp }> = [
  // 影片相关
  { kind: "title", keys: /^(name|title|vod_name|movie_name|film_name|videoName|videotitle)$/i },
  { kind: "pic", keys: /^(pic|img|image|thumb|cover|poster|vod_pic|vod_img|imgurl|thumbnail)$/i },
  { kind: "url", keys: /^(url|link|href|vod_id|movie_id|id|detailUrl|detail_url)$/i },
  { kind: "desc", keys: /^(desc|description|intro|summary|synopsis|content|vod_content|blurb)$/i },
  { kind: "id", keys: /^(id|vod_id|movie_id|film_id|video_id|_id)$/i },
  { kind: "playURL", keys: /^(play_url|playUrl|m3u8|videoUrl|video_url|source)$/i, valuePattern: /\.m3u8|\.mp4|http/i },
  // 列表类
  { kind: "list", keys: /^(list|data|items|results|videos|movies|films|content|records)$/i },
];

/** 分析一段 JSON, 返回所有猜到的字段 */
export function analyzeJSON(root: any, maxDepth = 5): JSONField[] {
  const found: JSONField[] = [];
  const visited = new Set<string>();

  function walk(node: any, path: string, depth: number) {
    if (depth > maxDepth) return;
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      // 数组: 分析前 3 项的结构 (假设同构)
      if (node.length === 0) return;
      // 特殊: 数组本身可能就是"影片列表", 加候选
      if (path !== "$") {
        pushCandidate({
          path,
          kind: "list",
          count: node.length,
          confidence: 0.6,
          sample: `${node.length} 项`,
        });
      }
      for (let i = 0; i < Math.min(3, node.length); i++) {
        walk(node[i], `${path}[*]`, depth + 1);
      }
      return;
    }

    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        const childPath = path === "$" ? `$.${k}` : `${path}.${k}`;
        // 匹配字段名
        const hint = FIELD_HINTS.find(
          (h) => h.keys.test(k) && (!h.valuePattern || (typeof v === "string" && h.valuePattern.test(v)))
        );
        if (hint) {
          pushCandidate({
            path: childPath,
            kind: hint.kind,
            count: 1,
            confidence: 0.9,
            sample: previewValue(v),
          });
        }
        // 图片值检测 (即使 key 不像也检测 URL 特征)
        if (typeof v === "string" && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(v)) {
          pushCandidate({
            path: childPath,
            kind: "pic",
            count: 1,
            confidence: hint ? 1 : 0.7,
            sample: previewValue(v),
          });
        }
        // URL 值检测
        if (typeof v === "string" && /^https?:\/\//i.test(v) && !hint) {
          if (/\.m3u8|\.mp4/i.test(v)) {
            pushCandidate({
              path: childPath,
              kind: "playURL",
              count: 1,
              confidence: 0.95,
              sample: previewValue(v),
            });
          }
        }
        // 递归
        walk(v, childPath, depth + 1);
      }
    }
  }

  function pushCandidate(f: JSONField) {
    const key = f.path + "::" + f.kind;
    if (visited.has(key)) return;
    visited.add(key);
    found.push(f);
  }

  walk(root, "$", 0);

  // 排序: 按 kind 优先级 + confidence
  const rank: Record<string, number> = {
    list: 0, title: 1, pic: 2, url: 3, desc: 4, playURL: 5, id: 6, unknown: 7,
  };
  found.sort((a, b) => {
    const ra = rank[a.kind] ?? 99;
    const rb = rank[b.kind] ?? 99;
    if (ra !== rb) return ra - rb;
    return b.confidence - a.confidence;
  });

  return found;
}

function previewValue(v: any): string {
  if (v === null) return "null";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "..." : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") return `Object{${Object.keys(v).slice(0, 3).join(",")}...}`;
  return "";
}

/**
 * 用 JSONPath 提取值 (仅支持 $ / . / [*] / [n] 语法子集)
 * 用于 popup 里预览"用户选中路径能提取到什么"
 */
export function extractByPath(root: any, path: string): any[] {
  if (!path.startsWith("$")) return [];
  const parts = path.slice(1).split(/(\.|\[[^\]]*\])/).filter(Boolean);
  let curr: any[] = [root];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    const next: any[] = [];
    if (part === "[*]") {
      for (const c of curr) if (Array.isArray(c)) next.push(...c);
    } else if (part.match(/^\[\d+\]$/)) {
      const idx = parseInt(part.slice(1, -1));
      for (const c of curr) if (Array.isArray(c) && c[idx] !== undefined) next.push(c[idx]);
    } else if (part.startsWith(".")) {
      const key = part.slice(1);
      for (const c of curr) {
        if (c && typeof c === "object" && key in c) next.push(c[key]);
      }
    } else {
      for (const c of curr) {
        if (c && typeof c === "object" && part in c) next.push(c[part]);
      }
    }
    curr = next;
    if (curr.length === 0) break;
  }
  return curr;
}
