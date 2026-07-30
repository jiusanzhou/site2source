/**
 * playURL 智能识别
 * 详情接口返回的 JSON 里, 剧集列表格式千奇百怪:
 *
 * 格式 A (MacCMS 标准): "第01集$url1#第02集$url2"
 *   → 已支持
 *
 * 格式 B (多线路): {
 *   "playFrom": ["线路1", "线路2"],
 *   "playUrl": ["第01集$url#...", "第01集$url#..."],
 * }
 *   → 数组一一对应, 拼 join('\$\$\$')
 *
 * 格式 C (对象数组): [
 *   { "name": "第01集", "url": "https://..." },
 *   ...
 * ]
 *   → 需要 map 出 name+url
 *
 * 格式 D (嵌套多线路对象): {
 *   "线路1": [{"name":"01","url":"..."}, ...],
 *   "线路2": [{"name":"01","url":"..."}, ...]
 * }
 *   → 需要遍历 key 作为 from, value 数组作为 url list
 *
 * 格式 E (单个 URL): "https://xxx.m3u8"
 *   → 直接就是完整视频
 */

export interface PlayFormat {
  kind: "maccms-string" | "maccms-array" | "object-array" | "nested-multi" | "single-url" | "unknown";
  playFromPath?: string;    // 线路名字数组路径 (JSONPath)
  playURLPath?: string;     // 播放地址路径
  itemNamePath?: string;    // 对象数组时, 集数名字段
  itemURLPath?: string;     // 对象数组时, URL 字段
  sample?: string;          // 一个样本值
  reasoning?: string;
}

/**
 * 分析详情 JSON, 找出剧集列表结构
 */
export function detectPlayFormat(root: any): PlayFormat[] {
  const found: PlayFormat[] = [];

  const visit = (node: any, path: string, depth = 0) => {
    if (depth > 5 || node == null) return;

    // 字符串: 检查是否 MacCMS 格式
    if (typeof node === "string") {
      if (/\$https?:\/\/[^#$]+/.test(node) && /#/.test(node)) {
        // "第01集$url#第02集$url" 格式
        found.push({
          kind: "maccms-string",
          playURLPath: path,
          sample: node.slice(0, 100),
          reasoning: "字符串含 name$url#name$url 格式 (MacCMS)",
        });
      } else if (/^https?:\/\/[^\s]+\.(m3u8|mp4|flv)/i.test(node)) {
        found.push({
          kind: "single-url",
          playURLPath: path,
          sample: node.slice(0, 100),
          reasoning: "单个视频 URL",
        });
      }
      return;
    }

    // 数组
    if (Array.isArray(node)) {
      if (node.length === 0) return;
      // 数组元素是字符串, 且都是 MacCMS 格式 → maccms-array (多线路)
      if (typeof node[0] === "string" && node.every((s: any) => typeof s === "string")) {
        const allMacCMS = node.every((s: string) => /\$https?:\/\//.test(s) && /#|\$/.test(s));
        if (allMacCMS) {
          found.push({
            kind: "maccms-array",
            playURLPath: path,
            sample: node[0].slice(0, 80),
            reasoning: `字符串数组 ${node.length} 条, 每条都是 MacCMS 格式 (多线路)`,
          });
          return;
        }
      }
      // 数组元素是对象, 检查有没有 name+url 字段
      if (typeof node[0] === "object" && !Array.isArray(node[0])) {
        const sample = node[0];
        const nameKey = Object.keys(sample).find((k) => /name|title|episode|ep|集|number|index/i.test(k));
        const urlKey = Object.keys(sample).find((k) => /url|link|href|src|play/i.test(k) && typeof sample[k] === "string");
        if (nameKey && urlKey) {
          found.push({
            kind: "object-array",
            playURLPath: path,
            itemNamePath: nameKey,
            itemURLPath: urlKey,
            sample: `${sample[nameKey]} → ${String(sample[urlKey]).slice(0, 40)}`,
            reasoning: `对象数组 ${node.length} 集, name=${nameKey}, url=${urlKey}`,
          });
          return;
        }
      }
      // 兜底: 继续深入
      visit(node[0], `${path}[*]`, depth + 1);
      return;
    }

    // 对象
    if (typeof node === "object") {
      // 检查是不是 "线路 → 剧集数组" 的嵌套多线路
      const values = Object.values(node);
      const allArrayOfObjects =
        values.length >= 1 &&
        values.every(
          (v: any) =>
            Array.isArray(v) &&
            v.length > 0 &&
            typeof v[0] === "object" &&
            !Array.isArray(v[0]),
        );
      if (allArrayOfObjects) {
        const first = (values[0] as any[])[0];
        const nameKey = Object.keys(first).find((k) => /name|title|episode|ep|集|number/i.test(k));
        const urlKey = Object.keys(first).find(
          (k) => /url|link|href|src|play/i.test(k) && typeof first[k] === "string",
        );
        if (nameKey && urlKey) {
          found.push({
            kind: "nested-multi",
            playURLPath: path,
            itemNamePath: nameKey,
            itemURLPath: urlKey,
            sample: `${Object.keys(node).length} 线路, 每线路 ${(values[0] as any[]).length} 集`,
            reasoning: `嵌套对象: key=线路名, value=剧集数组 (多线路)`,
          });
          return;
        }
      }
      // 深入子字段
      for (const [k, v] of Object.entries(node)) {
        const childPath = path === "$" ? `$.${k}` : `${path}.${k}`;
        // 优先关注名字像播放的 key
        if (/play|episode|source|url|video|m3u8|link/i.test(k)) {
          visit(v, childPath, depth + 1);
        } else if (depth < 3) {
          visit(v, childPath, depth + 1);
        }
      }
    }
  };

  visit(root, "$");

  // 排序: 优先级 maccms-string > maccms-array > object-array > nested-multi > single-url
  const rank: Record<string, number> = {
    "maccms-string": 0,
    "maccms-array": 1,
    "object-array": 2,
    "nested-multi": 3,
    "single-url": 4,
    unknown: 5,
  };
  found.sort((a, b) => (rank[a.kind] ?? 99) - (rank[b.kind] ?? 99));
  return found;
}

/**
 * 根据 PlayFormat 生成 Drpy JS 里播放列表解析代码
 * 返回的字符串片段直接插入到 detail 函数里, 作为 vod_play_url 的赋值
 */
export function generatePlayParseSnippet(fmt: PlayFormat): string {
  if (!fmt.playURLPath) return `vod.vod_play_from = 'default'; vod.vod_play_url = '';`;

  const path = fmt.playURLPath;
  const accessor = jsonPathToAccessor(path, "data");

  switch (fmt.kind) {
    case "maccms-string":
      return `
    vod.vod_play_from = 'default';
    vod.vod_play_url = ${accessor} || '';`;

    case "maccms-array":
      // 数组每项是一条线路
      return `
    let plays = ${accessor} || [];
    vod.vod_play_from = plays.map((_, i) => '线路' + (i+1)).join('$$$');
    vod.vod_play_url = plays.join('$$$');`;

    case "object-array":
      return `
    let eps = ${accessor} || [];
    vod.vod_play_from = 'default';
    vod.vod_play_url = eps.map(e => e.${fmt.itemNamePath} + '$' + e.${fmt.itemURLPath}).join('#');`;

    case "nested-multi":
      return `
    let sources = ${accessor} || {};
    let fromList = Object.keys(sources);
    let urlList = fromList.map(k => sources[k].map(e => e.${fmt.itemNamePath} + '$' + e.${fmt.itemURLPath}).join('#'));
    vod.vod_play_from = fromList.join('$$$');
    vod.vod_play_url = urlList.join('$$$');`;

    case "single-url":
      return `
    vod.vod_play_from = 'default';
    vod.vod_play_url = '正片$' + ${accessor};`;

    default:
      return `vod.vod_play_from = 'default'; vod.vod_play_url = '';`;
  }
}

function jsonPathToAccessor(path: string, varName: string): string {
  if (!path || path === "$") return varName;
  const rest = path.replace(/^\$\.?/, "");
  const parts = rest.split(/[.[\]]/).filter(Boolean);
  let expr = varName;
  for (const p of parts) {
    if (p === "*") continue;
    if (/^\d+$/.test(p)) expr += `[${p}]`;
    else expr += `?.${p}`;
  }
  return expr;
}
