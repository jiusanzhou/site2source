# TVBox/Spider 坑位知识库

给生成器（drpy/t3/model）+ 未来的 AI/人类作者的必读检查清单。
每个坑都是一次真实事故沉淀下来的。

---

## 🔴 P0：tvbox.json 顶层 flags 不能塞 site 自家 flag

**症状**：点视频卡片进详情页 → 弹 toast "Unable to parse url"（= `R.string.error_play_parse`），视频不放。

**根因**：fongmi 里 `flags` 数组的语义是**"这些 flag 需要走 parses 解析"**。
如果一个 site 的 `vod_play_from` 值出现在 flags 里，fongmi 会：
1. 忽略 spider 直接返回的 URL
2. 遍历 `parses` 数组尝试解析
3. 全部失败 → `qa2.a()` → `xe2.a()` → 弹 error toast

**flags 只应包含"官方视频站方案"**：`youku, qq, iqiyi, qiyi, letv, sohu, tudou, pptv, mgtv, wasu, bilibili, renrenmi` 这类。

**规则**：
- ✅ `vod_play_from = 'youku'` + `flags: ["youku"]` + 配置 Web parser → fongmi 走解析
- ✅ `vod_play_from = '爱壹帆'` + `flags: [...官方...]`（不含"爱壹帆"）→ fongmi 直接用 spider 返回的 URL
- ❌ `vod_play_from = 'aiyifan'` + `flags: ["aiyifan", ...]` → error_play_parse

**排查方法**（记录）：
1. `adb logcat` 没看到 ExoPlayer error（因为根本没到播放器）
2. 反编译 apk：`apktool d base.apk`
3. `grep "Unable to parse url" res/values/strings.xml` → 找到 R.string.error_play_parse (0x7f1300c3)
4. `grep 0x7f1300c3 smali/` → xe2.smali (parse error handler)
5. 追踪到 `qa2` (Parse 派发器) 的 `la2.a()` fallback

---

## 🟡 P1：CDN 冷启动 520 → ExoPlayer 首次拉 chunklist 失败

**症状**：spider 返回 URL 后，视频界面停留 4 秒直接退回首页（或黑屏无反应）。

**根因**：Cloudflare 签名 URL 每次 vhash 变化对 CDN 都是**新对象**，边缘缓存冷启动第一次返回 520，body 却是完整 m3u8。ExoPlayer 只看 status code，非 2xx 直接 fail。

**修复**：spider 生成 URL 后，**返回给 fongmi 前先 warmup 请求一次**（预热 CDN 边缘），可加 3 次重试：

```javascript
// aiyifan-api-spider.ts 里的模式
try {
  for (var w = 0; w < 3; w++) {
    var wc = req(url, { headers: HDR }).status || 0;
    console.log('[s2s] warmup ' + (w+1) + ': HTTP ' + wc);
    if (wc >= 200 && wc < 400) break;
  }
} catch (e) { console.log('[s2s] warmup skip: ' + e); }
```

**别搞错**：
- ❌ 不要给 fongmi 侧加重试代理（改不了 ExoPlayer 行为）
- ❌ 不要把 520 body 回填给客户端（fongmi 不看 body）
- ✅ 让 spider 内部 warmup，等 CDN 缓存热了再返回 URL

---

## 🟡 P2：category 用聚合首页 API 翻页无效

**症状**：分类列表只有 1-4 页就到底，实际数据源有几千上万条。

**根因**：很多站的"首页聚合"接口（如 `getAllVideo` / `home/index` / `getHomeData`）：
- 返回 { filmList: [...100], tvList: [...100], ... } 一次给全部分类
- `page` 参数**服务端忽略**（page=1..5 返回相同数据）
- 只能作为**首屏缓存**用，不能做真正翻页

**正确做法**：抓包找**分类专用列表接口**（通常关键词：`list/Search` / `channel/list` / `getVideosByChannel` / `videoList`），它才支持 page + size + 分类 id/cid。

**识别方法**：
1. 打开网站的分类页（不是首页）
2. 抓 XHR，找URL 里带 `page=` 且改变 page 会返回不同 title 的接口
3. 通常返回 `{ recordcount, maxpage, result: [...] }` 结构

**参考**：`aiyifan-api-spider.ts` 里的 `api/list/Search`，`recordcount=14882 maxpage=30`。

---

## 🟡 P3：剧集选集列表参数用错字段

**症状**：剧集详情只显示 1 集（"1080P" 或"正片"），实际几十集。

**根因**：剧集列表接口通常需要一个 **cid（分类路径）** 参数，站点 detail 返回里有多个看起来像的字段：
- `cidMapper`: "悬疑,历险" ← 展示标签，不是 cid
- `publishNavKey`: "今年" / "热门" ← 导航标签，不是 cid
- `cid`: "0,1,4,137" ← ✅ 真正的分类路径

**规则**：
- 用真正数字/分隔符结构的字段（形如 `0,1,4,137` 或 `/tv/action/`）
- 不要用中文/短单词字段
- 不确定就打两个都试试，看返回集数是不是等于 `serialCount`

**验证**：`playList.length` 应该 ≈ `min(serialCount, lastName)` 或 API 里显式的 `updates`。

---

## 🟢 P4：QuickJS 环境 JSON 解析限制

**症状**：spider 里 `apiGet(size=1000)` 直接崩，日志显示 quickjs OOM 或 JSON.parse 卡住。

**根因**：fongmi QuickJS 引擎处理 4MB+ JSON 会挂。大接口必须限制 size：
- `size=100` → ~460KB ✅
- `size=1000` → ~4.6MB ❌

**规则**：
- 分类列表 size 建议 30-50
- 首页聚合 size 建议 ≤100
- 大响应需要拆多个请求

---

## 🟢 P5：QuickJS 里没有 fetch/XMLHttpRequest

**症状**：spider 里写 `fetch(url)` 直接报 undefined。

**根因**：fongmi 提供 `req()` 函数（catvod 环境），不是 Web fetch API：

```javascript
var res = req(url, { headers: HDR });
// res: { status: number, content: string, headers: {} }
// 有些版本 body 在 res.content, 有些在 res.body
```

**规则**：
- 只用 `req()`
- 检查 `res.content || res.body` 兼容
- `req` 是同步的，不用 await/Promise

---

## 🟢 P6：Video.js/Cloudflare 校验签名的 IP

**症状**：本地 curl 拿签名 URL 是 520，spider 内部拿是 200。或者：某个 CDN URL 从 macOS 出口可以拉，从 emulator 出口不行。

**根因**：签名 URL 里编码了**生成时的客户端 IP**（如 `vCustomParameter=0_103.167.26.49_SG_1_0_1_0`）。CDN 校验请求 IP 必须匹配。

**规则**：
- **不要跨环境测试签名 URL**（macOS/Android/curl 走不同网络栈时可能出口 IP 不同）
- smoketest 用的 curl 出口 IP 必须和 spider 生成 URL 时的一样
- 用同一台机器的**同一个网络出口**做端到端验证

---

## 🟢 P7：smoketest 用完整浏览器 UA

**症状**：spider 在 fongmi 里拉 chunklist 200，smoketest 里 curl 拿到空 body 或 403。

**根因**：CDN 对 UA 有校验，短 UA（如 `Mozilla/5.0`）会被拒。

**规则**：
- 所有 HTTP 请求（包括测试脚本）都用完整 Chrome UA：
  ```
  Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36
  ```
- 加 `Referer` 和 `Origin` header

---

## 🔵 P8：fongmi 配置持久化在 SQLite

**症状**：`adb pm clear` 之后 fongmi 需要重新输入 config URL。

**位置**：`/data/data/com.fongmi.android.tv/databases/tv` 里的 `Config` 表。

**恢复命令**（emulator with root）：
```bash
adb -s emulator-5554 root
adb shell "sqlite3 /data/data/com.fongmi.android.tv/databases/tv \\
  \"INSERT INTO Config (type, time, url, name) VALUES \\
    (0, $(date +%s000), 'http://10.0.2.2:8899/tvbox_xxx.json', 'xxx');\""
adb shell "am force-stop com.fongmi.android.tv"
adb shell "am start -n com.fongmi.android.tv/.ui.activity.HomeActivity"
```

`type=0` 是 vod config，`type=1` 是 live。

---

## 检查清单（生成新 spider 时逐条对照）

生成 tvbox.json：
- [ ] `sites[].api` 指向 spider（http URL 或 csp_xxx）
- [ ] `flags` **不包含**自己 site 的 flag（只留官方视频站方案）
- [ ] `parses` 至少一个（`Web` / `Json并发` / `Json轮询`），即使暂不用
- [ ] `vod_play_from` 用友好中文名（"爱壹帆" 而不是 "aiyifan"），或英文短名但绝不放入 flags

生成 spider .js：
- [ ] category 找到真正翻页接口，不用首页聚合
- [ ] category 返回 `{ list, page, pagecount, limit, total }`
- [ ] detail 里 languagesplaylist/episodelist 的 cid 用真实路径字段
- [ ] play URL 生成后先 warmup 一次
- [ ] apiGet size ≤ 100
- [ ] 用 `req()` 不用 `fetch()`
- [ ] 加 `Referer` + `Origin` header
- [ ] UA 用完整 Chrome UA

排查思路：
- toast "Unable to parse url" → 检查 flags
- 视频 4 秒退回 → 检查 CDN 状态（是否 520）+ warmup
- 分类只有 1-4 页 → 换 category 接口
- 剧集只显示 1 集 → 检查 cid 字段
