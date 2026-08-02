// site2source-ext — Spider 常用工具函数库
//
// 这些函数是 QuickJS 里通用的 helper, 会被 inline 进各个 spider .js 里.
// 使用方法: 在生成器里调用 `L.push(SPIDER_UTILS.warmupCdn())`
//
// 每个函数都是**纯字符串**, 内部只能用 fongmi 提供的 API:
//   - req(url, opts): { status, content, headers }
//   - console.log
//   - JSON.parse/stringify
//   - 不能用 fetch/Promise/async/箭头函数(部分 QuickJS 版本)
//
// 完整坑位说明见 docs/SPIDER-PITFALLS.md

export const SPIDER_UTILS = {
  /**
   * 生成 CDN warmup 逻辑: 返回 URL 前先请求一次预热边缘缓存.
   *
   * 用法 (在 play/parse 里生成 URL 后, return 前调用):
   * ```ts
   * L.push(SPIDER_UTILS.warmupCdn('url', 'HDR'));
   * L.push(`return JSON.stringify({ parse: 0, url: url, header: HDR });`);
   * ```
   *
   * 修复症状: 视频界面 4 秒后自动退回(Cloudflare 首次冷启动 520).
   * 详见 docs/SPIDER-PITFALLS.md P1
   */
  warmupCdn(urlVar = "url", hdrVar = "HDR", retries = 3): string {
    return `
try {
  for (var __w = 0; __w < ${retries}; __w++) {
    var __wr = req(${urlVar}, { headers: ${hdrVar} });
    var __wc = (__wr && __wr.status) || 0;
    console.log('[s2s] warmup ' + (__w+1) + ': HTTP ' + __wc);
    if (__wc >= 200 && __wc < 400) break;
  }
} catch (__we) { console.log('[s2s] warmup skip: ' + __we); }
`.trim();
  },

  /**
   * 生成标准 category 返回结构 (支持翻页).
   *
   * 用法:
   * ```ts
   * L.push(SPIDER_UTILS.categoryResponse('list', 'pg', 'maxpage', 'total'));
   * ```
   *
   * 关键: 必须返回 pagecount 才能让 fongmi 显示翻页按钮.
   * 详见 docs/SPIDER-PITFALLS.md P2
   */
  categoryResponse(
    listVar = "list",
    pageVar = "pg",
    pagecountVar = "maxpage",
    totalVar = "total",
    limit = 30,
  ): string {
    return `return JSON.stringify({
  list: ${listVar}, page: ${pageVar}, pagecount: ${pagecountVar}, limit: ${limit}, total: ${totalVar},
});`;
  },

  /**
   * 生成 vod_play_url 字符串 (剧集列表).
   *
   * playList: [{ name: '01', key: 'xxxxx' }, ...]
   * 输出: '01$xxxxx#02$yyyyy#...'
   *
   * 关键: 剧集 API 通常需要 cid, 而 cid 是形如 '0,1,4,137' 的数字路径,
   * 不是 publishNavKey('今年') 也不是 cidMapper('悬疑,历险').
   * 详见 docs/SPIDER-PITFALLS.md P3
   */
  buildVodPlayUrl(playListVar = "epList"): string {
    return `${playListVar}.map(function(e) { return e.name + '$' + e.key; }).join('#')`;
  },

  /**
   * 标准 fongmi HTTP header (完整 Chrome UA + Referer + Origin).
   * 短 UA 会被某些 CDN 拒绝.
   * 详见 docs/SPIDER-PITFALLS.md P7
   */
  standardHeaders(siteOrigin: string): string {
    return `var HDR = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Referer': '${siteOrigin}/',
  'Origin': '${siteOrigin}',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};`;
  },
};

/**
 * TVBox flags 白名单 - 只放官方视频站方案.
 * 生成 tvbox.json 时用这个常量, 不要在 flags 里加自定义 flag.
 * 详见 docs/SPIDER-PITFALLS.md P0
 */
export const TVBOX_OFFICIAL_FLAGS = [
  "youku", "qq", "iqiyi", "qiyi", "letv", "sohu",
  "tudou", "pptv", "mgtv", "wasu", "bilibili", "renrenmi",
];

/**
 * 检查一个 flag 是否可以安全放入 tvbox.flags.
 * 用于 validator - 阻止 site 自定义 flag 被塞进去.
 */
export function isOfficialFlag(flag: string): boolean {
  return TVBOX_OFFICIAL_FLAGS.includes(flag);
}

/**
 * 校验 tvbox 配置对象, 报告已知坑位.
 * 用于生成后调用一次, 输出 warning.
 */
export function validateTVBoxConfig(cfg: any): string[] {
  const warnings: string[] = [];

  const flags: string[] = Array.isArray(cfg?.flags) ? cfg.flags : [];
  const sites: any[] = Array.isArray(cfg?.sites) ? cfg.sites : [];

  // P0: 检查 flags 不含 site 自定义 flag
  const nonOfficial = flags.filter((f) => !isOfficialFlag(f));
  if (nonOfficial.length) {
    warnings.push(
      `⚠️  P0: flags 包含非官方 flag ${JSON.stringify(nonOfficial)} — ` +
        `会导致 fongmi 强制走 parses 解析, 弹 "Unable to parse url". ` +
        `参考 docs/SPIDER-PITFALLS.md`,
    );
  }

  // 检查 parses 数组非空
  if (!Array.isArray(cfg?.parses) || cfg.parses.length === 0) {
    warnings.push(
      `⚠️  parses 数组为空 — 即使不用解析, 也应至少放一个 Web/Json 兜底`,
    );
  }

  // 检查 sites[].api 有效
  for (const s of sites) {
    if (!s.api) {
      warnings.push(`⚠️  site ${s.key || s.name} 缺少 api 字段`);
    }
    if (s.type === 3 && s.api && !/^https?:\/\/|^csp_/.test(s.api)) {
      warnings.push(
        `⚠️  site ${s.key} type=3 但 api 格式不对 (应为 http URL 或 csp_XXX)`,
      );
    }
  }

  return warnings;
}
