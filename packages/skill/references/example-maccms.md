# Example: MacCMS 采集站 (走 tvbox build 路径)

**站点特征**：
- URL 长得像 `/index.php/vod/detail/id/xxx.html`
- 有个 `/api.php/provide/vod/?ac=list` 端点，直接返回 JSON
- 80% 的国内影视站都是 MacCMS

## 判断方式

```bash
node packages/skill/scripts/classify-site.mjs https://<site>/
```

看到 `✅ maccms` 即可 —— 也可以 curl 一次:
```bash
curl 'https://<site>/api.php/provide/vod/?ac=list'
```

返回形如 `{"code": 1, "class": [...], "list": [...]}` 就是。

## 不需要 spider

MacCMS 天然跟 tvbox 协议兼容。只要在 tvbox 仓库里加一条 `type: 1` 配置即可。**不走 gen-spider / verify-spider**。

## 完整流程 (照做)

假设 tvbox 仓库 = `jiusanzhou/tvbox`，本地 mirror 在 `.tvbox-mirror/`：

### 1. 在 tvbox 仓库建 site 目录

```bash
mkdir -p .tvbox-mirror/sites/<slug>
```

### 2. 写 meta.json

```json
{
  "key": "<slug>",
  "name": "⚡ <显示名>",
  "type": 1,
  "api": "https://<host>/api.php/provide/vod",
  "searchable": 1,
  "quickSearch": 1,
  "filterable": 1,
  "tags": ["cn", "maccms"],
  "source": "https://<host>/",
  "note": "MacCMS v10 采集站, XXX 部影片, N 分类",
  "probes": ["https://<host>/api.php/provide/vod/?ac=list"]
}
```

**关键区别（vs type=3 spider 站）**:
- `type: 1`（不是 3）
- **有** `api` 字段（外部 URL）
- **没有** `spider` 字段（不需要 spider.js）
- `tags` 建议加 `maccms` 便于筛选

### 3. tvbox 仓库的 build.mjs 需要支持 type=0/1

**默认的 build.mjs 只处理 type=3 spider 站**。如果没升级过，跑 build 会报 `sites/xxx/meta.json 缺 key/name/spider`。

需要在 build.mjs 里加分支处理（参考 `jiusanzhou/tvbox` commit `05482a8`）：

```js
// scripts/build.mjs 里 site loop 前面
const isCollector = meta.type === 0 || meta.type === 1;

if (isCollector) {
  if (!meta.api) {
    console.error(`❌ type=${meta.type} 需要 api 字段`);
    process.exit(1);
  }
  sites.push({
    key: meta.key,
    name: meta.name,
    type: meta.type,
    api: meta.api,           // ← 外部 URL 原样塞进去, 不做 resolveUrl 转换
    searchable: meta.searchable ?? 1,
    quickSearch: meta.quickSearch ?? 1,
    filterable: meta.filterable ?? 1,
    ...(meta.categories ? { categories: meta.categories } : {}),
  });
  siteMeta.push({
    key: meta.key,
    hash: crypto.createHash('sha256').update(meta.api).digest('hex').slice(0, 8),
    tags: meta.tags || [],
    type: meta.type,
    updated_at: fs.statSync(path.join(sitesDir, d, 'meta.json')).mtime.toISOString(),
  });
  continue;
}

// 下面继续原有 type=3 spider 逻辑
if (!meta.spider) { /* ... */ }
```

### 4. build + push

```bash
cd .tvbox-mirror
pnpm build          # 或 node scripts/build.mjs
git add -A
git commit -m "feat: add <slug> MacCMS 采集站"
git push origin main
```

GH Pages 30s-2min 生效，用户端订阅 URL 自动拿到新站。

## MacCMS 变体

有些站改过 MacCMS，接口路径不一样：

| 特征 | 类型 | api 字段 |
|------|------|----------|
| `/api.php/provide/vod/?ac=list` + JSON | `type: 1` | `https://xxx/api.php/provide/vod` |
| `/api.php/provide/vod/?ac=videolist` + XML | `type: 0` | 同上 |
| `/inc/api.php` 或其他自定义路径 | `type: 1` | 用它的路径 |
| `/api.php/provide/vod/from/xxx/at/json` 分片 | `type: 1` | 用完整分片 URL |

## 已完成案例

- `jiusanzhou/tvbox` commit `05482a8`：`cj.ffzyapi.com` (97655 部影片, 31 分类)

## 为什么本 skill 不做 gen/verify

MacCMS 是 tvbox 一等公民，客户端自己会调 API。**skill 的价值在签名 SPA / 复杂反爬站**，MacCMS 加一行配置就好。

**如果 classify 报 `maccms`**：直接照本文流程走，不要瞎调 gen-spider —— 也没意义。
