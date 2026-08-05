# SiteModel Schema 速查

完整类型定义: `packages/core/src/site-model.ts`

## 顶层结构

```ts
{
  name: string;              // 内部 key, 用作 site 目录名 (小写字母)
  display_name?: string;     // FongMi 里显示的名字 (中文/emoji OK)
  site_url: string;          // 官网 URL, 给 tvbox meta.json 的 source 字段
  bases: Record<string, string>; // { api: "https://xxx", rank: "https://yyy" }
  signing?: SigningConfig;   // 签名配置, 无签名站可以省
  bootstrap?: BootstrapConfig; // 启动预取 (取签名用的密钥等)
  endpoints: Endpoint[];     // 所有端点
  mappings: Record<string, FieldCandidate>; // 字段映射
  categories?: Category[];   // home 分类
  play_result: PlayResult;   // play 命中/不命中的策略
  paging?: { strategy: "server" | "local" | "none"; page_size?: number };
  proxy?: ProxyConfig;       // 可选: HTTP 代理 (绕 GEO block)
  flags?: string[];          // ⚠️ 不能含 name (P0 pitfall)
}
```

## Signing (签名)

```ts
signing: {
  default_strategy: "auto" | "first",  // auto: 优先 bootstrap 依赖的模式
  modes: [
    {
      name: "cert",                    // 模式名
      vars: {
        pub: { kind: "bootstrap", path: "publicKey" },
        pk:  { kind: "bootstrap", path: "privateKey[0]" },
        query_lower: { kind: "query_lower" },
        // 其他 kind: literal / timestamp / random / key_table
      },
      formula: "{pub}&{query_lower}&{pk}",  // 用 {var} 引用
      algorithm: "md5",                     // md5/sha1/sha256/hmac-sha256
      attach: { vv: "{sign}", pub: "{pub}" } // 附到 URL 的 query
    }
  ]
}
```

### SignVarSource kinds

| kind         | 说明                                              | 例                                          |
|--------------|---------------------------------------------------|---------------------------------------------|
| `literal`    | 固定值                                            | `{ kind: "literal", value: "cinema" }`      |
| `timestamp`  | `Date.now().toString()`                           | `{ kind: "timestamp" }`                     |
| `random`     | 16-hex 随机                                       | `{ kind: "random", length: 16 }`            |
| `bootstrap`  | 从 bootstrap 响应 JSONPath 取                     | `{ kind: "bootstrap", path: "info[0].pk" }` |
| `key_table`  | 从密钥表按 JS 表达式索引                          | `{ kind: "key_table", table: [...], index: "Number(pub) % 8" }` |
| `query_lower`| 整条 query 转小写                                 | `{ kind: "query_lower" }`                   |

## Bootstrap (启动预取)

有的站需要先拉一个 `/config` 端点拿密钥, 才能给业务端点签名。

```ts
bootstrap: {
  endpoint: "config",                    // endpoints 里的 name
  extract: {
    publicKey: "info[0].pConfig.publicKey",
    privateKey: "info[0].pConfig.privateKey",
  },
  transforms: [
    { field: "privateKey", op: "as_array" },  // 统一转数组
  ]
}
```

## Endpoints (端点)

```ts
endpoints: [
  {
    name: "home" | "detail" | "search" | "play" | "episodes" | ...,
    base: "api",           // bases 里的 key
    path: "v3/home/getAllVideo",
    query: "cinema=1&page={page}&size=100",  // {var} 占位符
    sign_mode: "auto" | "cert" | "timestamp" | ...,
    response: {
      item?: ResponsePicker,        // 单项
      list?: ResponsePicker,        // 列表
      episodes?: ResponsePicker,
      play_url?: ResponsePicker,
    }
  }
]
```

### ResponsePicker (从 JSON 里挑数据)

```ts
{
  path?: "info[0].playList",     // JSONPath-lite
  first_where?: "isEnabled=true", // 遍历数组挑第一个满足条件的
  field?: "path.result",         // 从选中项再取字段
  priority?: [                   // 按优先级依次试
    { path: "info[0].clarity", first_where: "isEnabled=true", field: "path.result" },
    { path: "info[0].flvPathList", first_where: "isHls=true", field: "result" },
  ],
  exclude?: [                    // 排除某些结果
    { host_regex: "s1-a1\\.global-cdn\\.me" },
    { contains: "/ads/" },
  ]
}
```

## Mappings (字段映射)

**vod_* 字段来自 tvbox 协议，是固定的**。你要做的是：告诉引擎，你的站的 API 里，哪些字段对应 vod_id/vod_name/... 等。

```ts
mappings: {
  vod_id:      ["key", "id", "contxt"],     // 依次尝试, 第一个非空就用
  vod_name:    ["title", "name"],
  vod_pic:     ["image", "imgPath", "cover", "pic"],
  vod_year:    ["year", "post_Year"],
  vod_area:    ["regional", "area"],
  vod_actor:   ["starring", "stars", "actor"],
  vod_director: ["directed", "directors", "director"],
  vod_content: ["shortDes", "contxt", "desc"],
  vod_remarks: ["lastName", "score", "rating"],
  ep_name:     ["name", "title"],           // 剧集
  ep_id:       ["key", "id"],
}
```

**FongMi 期望的字段**: vod_id, vod_name, vod_pic, vod_year, vod_area, vod_lang, vod_actor, vod_director, vod_content, vod_remarks, vod_play_url, vod_play_from.

## Categories (分类)

```ts
categories: [
  // static: 从 home 响应固定字段拿
  { kind: "static", id: "filmList", name: "电影", source_field: "info[0].filmList" },
  // 或 dynamic: 从 API 动态发现 (少见)
]
```

## PlayResult (播放策略)

```ts
play_result: {
  on_hit:  { parse: 0 },                                       // 直接播 m3u8/mp4
  on_miss: { parse: 1, url_template: "{site_url}/play/{id}" }, // 退回让 FongMi sniff
}
```

`parse` 语义:
- `0`: 直接是最终视频 URL
- `1`: 需要 FongMi 内嵌 sniff (自动解析网页里的 video 标签)

## Paging (分页)

```ts
paging: {
  strategy: "server" | "local" | "none",
  page_size?: 30,
}
```

- `server`: `endpoints[list].query` 里用 `{page}` 占位符, 每翻一页调一次
- `local`: 一次拉大 size, 本地切片 (省接口调用)
- `none`: 一次给全 (静态 mirror)

## Proxy (可选, 绕 GEO block)

```ts
proxy: {
  base: process.env.MY_PROXY_BASE,       // "https://notes-edge.pages.dev"
  mode: "query",                          // /?url=<encoded>
  headers: { Authorization: `Bearer ${process.env.MY_PROXY_TOKEN}` },
  only: ["api", "rank"],                  // 只代理这些 base
  proxy_media: false,                     // 视频 URL 也走代理? (流量大, 慎开)
}
```

⚠️ **不能把 secret 明文写进 SiteModel**, 必须从 `process.env.*` 读, 用 factory 函数注入。
