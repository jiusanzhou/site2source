# Example: aiyifan (完整签名 SPA 案例)

**站点特征**：
- SPA (Next.js)，前端全靠 API 拉数据
- **双模签名**：`cert` (bootstrap 拿 pk) + `timestamp` (兜底，8 个混淆密钥表)
- `bootstrap` 端点：`/v3/home/config`
- 分域：`m10.aiyifan.tv` (API) + `rankv21.aiyifan.tv` (搜索)
- CF GEO 拦国内 IP (error 1009)

**完整 SiteModel**：见 `packages/core/src/sites/aiyifan.ts`。

## 关键决策点

### 1. 为什么用双模签名

`/v3/home/config` 是 bootstrap 端点本身，它**只能**用 timestamp 模式签（cert 模式的 pk 还没拿到）。业务端点默认走 cert（安全性更高），失败时 fallback 到 timestamp。

```ts
signing: {
  default_strategy: "auto",  // 优先 cert, 失败退 timestamp
  modes: [
    { name: "cert", vars: { pub: { kind: "bootstrap", ... } }, ... },
    { name: "timestamp", vars: { pub: { kind: "timestamp" }, pk: { kind: "key_table", ... } }, ... }
  ]
}
```

### 2. 密钥表 (key_table)

aiyifan 有 8 个"形近字符"混淆的密钥：`version001`, `vers1on001`, `versio_001` 等。签名时按 `Number(pub) % 8` 选一个。这是 timestamp 模式独有的抗爬手段。

```ts
{
  kind: "key_table",
  table: ["version001", "vers1on001", "vers1on00i", ...8 items],
  index: "Number(pub) % 8",  // JS 表达式, 可用 pub
}
```

### 3. bootstrap privateKey 类型不定

pConfig.privateKey 有时字符串有时数组，用 transforms 统一：

```ts
bootstrap: {
  extract: { privateKey: "info[0].pConfig.privateKey" },
  transforms: [{ field: "privateKey", op: "as_array" }],
}
```

签名公式里用 `path: "privateKey[0]"` 拿第一个。

### 4. 播放 URL 优先级挑选

aiyifan 的 play 响应有 4 个候选数组，还要排除广告 CDN：

```ts
play_url: {
  priority: [
    { path: "info[0].clarity", first_where: "isEnabled=true", field: "path.result" },
    { path: "info[0].flvPathList", first_where: "isHls=true", field: "result" },
    { path: "info[0].hlsPathList", first_where: "isHls=true", field: "result" },
    { path: "info[0].flvPathList", first_where: "isHls=true", field: "result" },
  ],
  exclude: [{ host_regex: "s1-a1\\.global-cdn\\.me" }],  // 广告 CDN
}
```

### 5. 分类是 static (home 响应里带的)

```ts
categories: [
  { kind: "static", id: "filmList", name: "电影", source_field: "info[0].filmList" },
  { kind: "static", id: "tvList", name: "剧集", source_field: "info[0].tvList" },
  // ... 7 个
]
```

`home` 端点一次返回所有分类的前 N 条，`category(id, page)` 时从本地缓存切片（`paging.strategy: "local"`）。

### 6. 分页策略：local

aiyifan `size=1000` 会挂 QuickJS（QuickJS 单次 fetch body 上限），只能拉 100 条。所以：

```ts
paging: { strategy: "local", page_size: 30 }
```

一次拉 100 条本地存着，`category(id, page)` 时切 30 条给 FongMi。

### 7. Proxy (国内环境用)

工厂函数注入，不入源码：

```ts
export function makeAiyifanModel(opts: { withProxy?: boolean } = {}) {
  const base = { ...AIYIFAN_MODEL };
  if (!opts.withProxy) return base;
  return {
    ...base,
    proxy: {
      base: process.env.AIYIFAN_PROXY_BASE!,
      mode: "query",
      headers: { Authorization: `Bearer ${process.env.AIYIFAN_PROXY_TOKEN}` },
      only: ["api", "rank"],
      proxy_media: false,
    },
  };
}
```

## 如果一个新站长得像 aiyifan

**照抄这个模板，改 4 处**：

1. `name` / `display_name` / `site_url` / `bases`
2. `signing.modes` 里的公式 + algorithm + 密钥表
3. `endpoints` 的 path/query
4. `mappings` 的字段候选 (curl 一下拿到真实 JSON，看字段名)

**别做的事**：
- 不要复制 `bootstrap.transforms` 之类的兜底逻辑 —— 只有 aiyifan 的 privateKey 类型不定，你的新站可能不需要
- 不要复制 exclude 里的 `s1-a1.global-cdn.me` —— 那是 aiyifan 广告 CDN，跟你站无关
