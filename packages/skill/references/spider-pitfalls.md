# Spider 坑位大全

按血泪程度排序。生成/调试 spider 时对着这份查。

---

## 🔴 P0 · tvbox.json 的 `flags` 数组不能含 site 自家 key

**症状**：FongMi/TVBox 里点站源，弹 `Unable to parse url` 的 toast，然后什么也拉不出来。

**原因**：FongMi 用 `flags` 数组做 spider 分类映射。如果里面写了 `["aiyifan"]`，客户端会试图 `parseUrl("aiyifan")`，得到一个非法 URL，直接 crash。

**修复**：**从 `flags` 里删掉 site 自家 key**。flags 只放"通用能力标签"（如 `["b", "youtube"]`），或者干脆留空数组。

**检测**：`gen-spider.mjs` 已内置校验；发布前自动 fail。

---

## 🔴 P1 · `type` 字段用错

- `type: 0` — MacCMS 采集站（用 `api` 字段填 XML/JSON 采集 URL）
- `type: 1` — MacCMS v10 JSON 采集
- `type: 3` — Drpy JS spider（就是我们生成的这种）
- `type: 4` — Drpy Python spider

**生成的 T3 spider 一定要用 `type: 3`**。用 0/1 会让 FongMi 按 MacCMS 协议解析，直接白屏。

---

## 🔴 P2 · vod_play_url 里 flag 名重复导致选集塌陷

FongMi 用 `flag$url$flag$url...` 的格式（`#` 分割选集），但 flag 名不能全相同。

**错**：`hls$url1#hls$url2#hls$url3`  → FongMi 只显示第一集
**对**：`第1集$url1#第2集$url2#第3集$url3`  或 `播放源A$url1#播放源A$url2`（flag 是 A 但 ep 名靠 url 后的 title 区分，此处不适用）

**Fix**：ep_name 字段候选顺序 `["name", "title", "episode"]`，别用 `flag`。

---

## 🔴 P3 · 签名公式的顺序错了

例：aiyifan 用 `md5({pub}&{query_lower}&{pk})`。写成 `md5({query_lower}&{pub}&{pk})` 就废了。

**Fix**：至少抓 3 个不同时间戳的请求，用 `packages/core/src/inferrer/sign-verifier.ts` 反向验证公式顺序。**不要凭直觉猜**。

---

## 🔴 P4 · query 参数被大小写洗过

很多签名算法用 `query_lower`（整条 query 转小写后拼签）。如果站点大小写不敏感，url 参数本身大小写混着写，本地拼签会跟服务端结果不一致。

**Fix**：`SigningConfig.vars.query_lower.kind = "query_lower"` 让引擎统一处理。**永远用引擎的 kind，不要自己拼**。

---

## 🔴 P5 · 分页策略选错

- `paging.strategy = "server"`  — 服务端支持 `page` 参数（aiyifan 是 pagination 假象，实际返回 100 条随机；不适用）
- `paging.strategy = "local"`   — 一次拉大 size 本地切片（aiyifan 用这个）
- `paging.strategy = "none"`    — 服务端一次给全（ddys 这类静态镜像）

选错的表现：翻页返回空 / 翻页返回重复项 / 翻页返回 500。

---

## 🔴 P6 · GEO block 认成签名错

**症状**：curl 直接打端点返回 HTML 而非 JSON，body 里有 `error code: 1009`；spider 日志显示 `Unexpected token '<'`。

**原因**：Cloudflare 拒国内 IP。跟签名/参数无关。

**Fix**：`SiteModel.proxy` 配 cf-proxy（见 `proxy-config.md`）。

---

## 🔴 P7 · bootstrap 提取的 privateKey 类型不稳定

例：aiyifan 的 `pConfig.privateKey` 有时是 `"abc"`（字符串），有时是 `["abc", "def"]`（数组）。签名公式里写 `{pk}` 拼字符串时炸。

**Fix**：
```ts
bootstrap: {
  transforms: [
    { field: "privateKey", op: "as_array" }, // 统一转数组
  ]
}
```
然后签名公式用 `{pk[0]}` 或 `path: "privateKey[0]"`。

---

## 🔴 P8 · 播放地址挑到广告 CDN

**症状**：能出播放地址，但播的是广告 30 秒 loop。

**原因**：`endpoints[play].response.play_url` 挑到了 `flvPathList[0]`，但 aiyifan 会把广告 CDN（`s1-a1.global-cdn.me`）塞在数组首位。

**Fix**：
```ts
play_url: {
  priority: [...],
  exclude: [
    { host_regex: "s1-a1\\.global-cdn\\.me" }, // 广告 CDN
    { contains: "/ads/" },
  ]
}
```

---

## 🚨 通用调试路线（照做）

1. curl 直接打端点，确认返回 JSON 结构
2. spider 生成后先跑 `node packages/skill/scripts/verify-spider.mjs <name>`
3. Fatal 时看 stack trace 里的方法名，对应到 `packages/core/src/generators/t3-spider.ts` 里生成的模板
4. Warning 但过测 → 大概率是 P7/P8/P4，需要在 SiteModel 里补 transforms/exclude/query_lower
5. `verify` 过但 FongMi 里显示不对 → 90% 是 P0/P1/P2

**不要相信 AI 帮你写的 spider.js**——所有 spider 必须通过 SiteModel 生成，而不是手撸。因为 T3 spider 的 QuickJS 环境有一堆非标准限制（无 fetch/无 Promise/req 是同步的），手写很容易踩坑。
