# Example: 静态镜像站 (单份 JSON dump)

**站点特征**：
- 一个 `/data/index.json` (或类似) 里塞了所有影片数据
- 客户端就是拿这份 JSON 在本地过滤/分页
- 例子: ddys.lat, 一些独立影视镜像站

## SiteModel 模板

```ts
export const DDYS_MODEL: SiteModel = {
  name: "ddys",
  display_name: "低端影视",
  site_url: "https://ddys.lat",
  bases: {
    data: "https://ddys.lat/data",
  },

  endpoints: [
    // 只有一个端点: 拉全量
    {
      name: "dump",
      base: "data",
      path: "index.json",
      response: { list: { path: "$" } },  // 整份就是 list
    },
  ],

  mappings: {
    vod_id: ["id", "slug"],
    vod_name: ["title"],
    vod_pic: ["poster", "cover"],
    vod_content: ["synopsis"],
    vod_remarks: ["year"],
  },

  categories: [
    // 分类靠 JSON 里字段过滤
    { kind: "static", id: "movie", name: "电影",
      filter: { field: "type", equals: "movie" }
    },
    { kind: "static", id: "tv", name: "剧集",
      filter: { field: "type", equals: "tv" }
    },
  ],

  play_result: {
    // 播放 URL 已在 dump 里, 直接播
    on_hit: { parse: 0 },
    // dump 里没 m3u8 时退回让 FongMi 嗅探
    on_miss: { parse: 1, url_template: "{site_url}/watch/{id}" },
  },

  paging: { strategy: "local", page_size: 30 },
};
```

## 特殊考虑

### JSON 太大 (>1MB)

QuickJS (FongMi 内嵌 JS 引擎) 对单次 fetch response 有软限制。**500KB 以内保险**，超过就要考虑：

- 服务端能否切分？(`index-movie.json` / `index-tv.json`)
- 引入手动分片 endpoint (`data/page-1.json`, `data/page-2.json`)

### 更新频率

静态镜像的 JSON 通常几小时/几天更新一次。可以：
- 加个 cache 层（引擎的 `spider-utils.ts` 有 memory cache 支持）
- FongMi 侧配 `spider` URL 加 `?v=<hash>` 强制 CDN 刷新

### 搜索

静态镜像通常不带 search 端点，只能本地过滤：
```ts
{
  name: "search",
  base: "data",
  path: "index.json",   // 同 dump 端点
  local_filter: {
    field_candidates: ["title", "name", "synopsis"],
    query_var: "wd",
  }
}
```

引擎会在本地把整份 JSON 里的每条按 `wd` 关键词过滤。

## 判断能不能用

**能**：
- ✅ 一次 curl 就能拿到全量数据 (`.json` 文件, GB 别超)
- ✅ 数据里有明确的 type/category 字段可以本地过滤

**不能**：
- ❌ 数据是 SSR HTML (没 JSON 数据源) → 走 dom-only 模式，本 skill 不支持
- ❌ 数据分散在多份 JSON 里 (需要多个 endpoint 拉了拼装) → 走 api-open 模式
