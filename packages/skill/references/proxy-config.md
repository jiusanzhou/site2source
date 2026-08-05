# Proxy Config (绕 CF GEO block)

**症状**: curl 一个端点返回 `HTTP 403` + body 里有 `error code: 1009`。

**原因**: 站点用 Cloudflare, 且开了 GEO block (通常拒中国大陆 IP)。跟签名/参数无关, 纯 IP 层。

## 方案: 挂 cf-proxy

Zoe 有一个已经部署好的通用 HTTP 代理:

- Pages 项目: `notes-edge` (源码在 `labs.zoe.im/cf-proxy`)
- 域名: `notes-edge.pages.dev`
- Auth: `Authorization: Bearer <AIYIFAN_PROXY_TOKEN>` (在 .env 里)

### 用法 1: URL 前缀路径 (推荐)

```
GET https://notes-edge.pages.dev/?url=https%3A%2F%2Ftarget.com%2Fpath
Authorization: Bearer <TOKEN>
```

### 用法 2: 直接拼路径

```
GET https://notes-edge.pages.dev/https://target.com/path
Authorization: Bearer <TOKEN>
```

## 挂到 SiteModel

**不要**把 token 硬编码到 SiteModel:

```ts
// ❌ 别这样
proxy: {
  base: "https://notes-edge.pages.dev",
  headers: { Authorization: "Bearer -sLLUu7d2IaC..." }
}
```

**要**用 factory 函数, 从环境变量读:

```ts
// packages/core/src/sites/newsite.ts

export const NEWSITE_MODEL: SiteModel = { /* ... 无 proxy ... */ };

export function makeNewsiteModel(opts: { withProxy?: boolean } = {}) {
  const base = { ...NEWSITE_MODEL };
  if (!opts.withProxy) return base;

  const proxyBase = process.env.NEWSITE_PROXY_BASE || process.env.AIYIFAN_PROXY_BASE;
  const proxyToken = process.env.NEWSITE_PROXY_TOKEN || process.env.AIYIFAN_PROXY_TOKEN;
  if (!proxyBase || !proxyToken) {
    throw new Error("需要 NEWSITE_PROXY_BASE + NEWSITE_PROXY_TOKEN (或复用 AIYIFAN_*)");
  }
  return {
    ...base,
    proxy: {
      base: proxyBase,
      mode: "query" as const,     // /?url= 模式
      headers: { Authorization: `Bearer ${proxyToken}` },
      only: ["api", "rank"],       // 只代理这些 base, 别的 base 直连
      proxy_media: false,          // 视频 URL 也走代理? 默认关 (流量 100k/day 限)
    },
  };
}
```

复用同一份 cf-proxy 就好 (环境变量 fallback 到 AIYIFAN_*)。

## .env 模板

```bash
# .env  (gitignored)
AIYIFAN_PROXY_BASE=https://notes-edge.pages.dev
AIYIFAN_PROXY_TOKEN=<TOKEN>
```

新站要独立配额时:
```bash
NEWSITE_PROXY_BASE=https://another-proxy.pages.dev
NEWSITE_PROXY_TOKEN=<other-token>
```

## proxy_media 选择

| 场景 | proxy_media |
|------|-------------|
| 视频 CDN 也被 GEO block | `true` (小心配额, 100k 请求/天很快就爆) |
| 视频 CDN 全球可用 | `false` (默认) |
| 用户在海外, 代理只是为了统一网络路径 | `false` |

**建议**: 先 `false` 跑, 客户端播不了再开 `true`。

## Secret 泄漏警告

⚠️ **生成的 spider.js 会把 `Authorization: Bearer xxx` 硬编码进去**。

如果你打算把 spider.js **公开发布** (推到 public tvbox 仓库):
- Token 就永远公开了
- 免费 CF Pages 配额是 100k 请求/天, 被人扫到就随便刷
- 解决方案:
  1. **接受** (被薅了就换 token, 5 分钟事)
  2. **给新站单独配 token** (cf-proxy 侧支持多 token)
  3. **不发公开仓库**, 只在私人设备用

`publish-tvbox.mjs` 会自动检测 spider 里的 Bearer/API key 并警告。
