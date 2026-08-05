# Example: 开放 JSON API 站点 (无签名)

**站点特征**：
- 有个 `/api/xxx` 返回 JSON
- 没有 `sign` / `vv` / `token` 参数
- 直接 curl 就能拿数据

## 最小 SiteModel

```ts
import type { SiteModel } from "../site-model";

export const EXAMPLE_MODEL: SiteModel = {
  name: "example",
  display_name: "示例站",
  site_url: "https://example.com",
  bases: {
    api: "https://api.example.com",
  },

  // 无签名, 整段省略
  // signing: undefined,

  // 无 bootstrap
  // bootstrap: undefined,

  endpoints: [
    {
      name: "home",
      base: "api",
      path: "v1/list",
      query: "type=all&page=1&size=30",
      response: { list: { path: "data.items" } },
    },
    {
      name: "detail",
      base: "api",
      path: "v1/detail",
      query: "id={id}",
      response: { item: { path: "data" } },
    },
    {
      name: "search",
      base: "api",
      path: "v1/search",
      query: "q={wd}&page={page}",
      response: { list: { path: "data.results" } },
    },
    {
      name: "play",
      base: "api",
      path: "v1/play",
      query: "id={id}",
      response: {
        play_url: { path: "data.url" },
      },
    },
  ],

  mappings: {
    vod_id: ["id"],
    vod_name: ["title", "name"],
    vod_pic: ["cover", "thumb", "poster"],
    vod_content: ["desc", "description"],
    vod_remarks: ["duration", "score"],
    ep_name: ["title"],
    ep_id: ["id"],
  },

  categories: [
    { kind: "static", id: "movie", name: "电影", source_field: "data.movies" },
    { kind: "static", id: "tv", name: "剧集", source_field: "data.tvs" },
  ],

  play_result: {
    on_hit: { parse: 0 },
    on_miss: { parse: 1, url_template: "{site_url}/play/{id}" },
  },

  paging: { strategy: "server", page_size: 30 },
};
```

## 常见变体

### 分类不在 home 响应里

```ts
categories: [
  // dynamic: 从独立端点拿分类
  { kind: "dynamic", endpoint: "categories" },
]
```

配合 endpoint:
```ts
{ name: "categories", base: "api", path: "v1/categories" }
```

### 分类端点返回嵌套

如果 `/v1/categories` 返回 `{ data: [{ id, name, subs: [...] }] }`, 需要用 `filters`:
```ts
categories: [
  { kind: "static", id: "movie", name: "电影",
    filters: [{ key: "type", name: "类型", source_field: "subs" }]
  }
]
```

### 无翻页

```ts
paging: { strategy: "none" }
```

翻到第 2 页时引擎会返回 `list: []`。

## 判断能不能用这个模板

**能**：
- ✅ curl 一次拿 JSON, 直接看到 items 数组
- ✅ 分类要么在 home 里, 要么有独立 `/categories` 端点
- ✅ 播放响应里能明确挑到最终视频 URL

**不能** (需要更复杂的 SiteModel):
- ❌ 播放 URL 是加密的 (需要 decode 步骤)
- ❌ 每个请求要塞 cookie/token (加 headers)
- ❌ 分页游标不是 page number 而是 cursor string (需要状态)

复杂情况回去看 `example-aiyifan.md`。
