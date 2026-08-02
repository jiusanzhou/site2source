# 开发新 Spider 的模板

**开始前必读**：`docs/SPIDER-PITFALLS.md`（8 个真实事故沉淀）

---

## 快速上手

### 1. 抓包分析目标站点

```bash
# 用 browser-act 抓 XHR
browser-act browser open --url https://target.tv/tv --auto-analyze
```

**必须找到 4 类 API**：
- 首页/榜单（可选，用于 homeVod）
- **分类列表（必须支持 page 参数）** — 详见 SPIDER-PITFALLS P2
- 详情/剧集列表 — 详见 SPIDER-PITFALLS P3
- 播放地址（返回 m3u8/mp4）

### 2. 生成 spider

用 `lib/spider-utils.ts` 里的 helper：

```typescript
import { SPIDER_UTILS, TVBOX_OFFICIAL_FLAGS, validateTVBoxConfig } from "./lib/spider-utils";

const L: string[] = [];

// 标准 HTTP header
L.push(SPIDER_UTILS.standardHeaders("https://target.tv"));

// category 函数里
L.push(`function category(tid, pg) {`);
L.push(`  // 调分类专用列表接口 (不是首页聚合!)`);
L.push(`  var info = apiGet('list/videos', 'channel=' + tid + '&page=' + pg + '&size=30');`);
L.push(`  var list = (info.result || []).map(toVod);`);
L.push(`  var maxpage = info.maxpage || 1;`);
L.push(`  var total = info.recordcount || list.length;`);
L.push(`  ${SPIDER_UTILS.categoryResponse("list", "pg", "maxpage", "total")}`);
L.push(`}`);

// play 函数里, 返回 URL 前 warmup
L.push(`function play(flag, id) {`);
L.push(`  var url = getPlayUrl(id);`);
L.push(`  ${SPIDER_UTILS.warmupCdn("url", "HDR", 3)}`);
L.push(`  return JSON.stringify({ parse: 0, url: url, header: HDR });`);
L.push(`}`);
```

### 3. 生成 tvbox.json

```typescript
const cfg = {
  spider: "",
  sites: [{
    key: "site_target",
    name: "🎬 目标站",
    type: 3,
    api: "http://your-server/spider.js",
    searchable: 1,
    quickSearch: 1,
    filterable: 1,
  }],
  parses: [
    { name: "Web", type: 3, url: "Web" },
  ],
  flags: TVBOX_OFFICIAL_FLAGS,  // ⚠️  不要塞自己的 flag!
  ijk: [],
};

// 生成后必须过一遍 validator
const warnings = validateTVBoxConfig(cfg);
warnings.forEach(w => console.warn(w));
```

### 4. 部署 + 测试

```bash
# 起本地 HTTP 服务器分发 spider + tvbox
cd test-output && python3 -m http.server 8899

# fongmi 侧配置指向 http://10.0.2.2:8899/tvbox.json (emulator)
# 或 http://<mac-ip>:8899/tvbox.json (真机)
```

**FongMi 数据库快速配置**（跳过 UI）：
```bash
adb root
adb shell "sqlite3 /data/data/com.fongmi.android.tv/databases/tv \
  \"INSERT INTO Config (type, time, url, name) VALUES \
    (0, $(date +%s000), 'http://10.0.2.2:8899/tvbox.json', 'target');\""
adb shell "am force-stop com.fongmi.android.tv"
adb shell "am start -n com.fongmi.android.tv/.ui.activity.HomeActivity"
```

### 5. 端到端验证

```bash
node tests/smoketest-fongmi.mjs
```

必须通过：
- ✅ bootstrap done
- ✅ 主页有分类 tab
- ✅ 点分类 tab 出现分页（total > 30 时 pagecount > 1）
- ✅ 点剧集详情，Episode 列表显示多集（不是 "1080P" 或 "正片" 单集）
- ✅ 点集数进播放器，视频画面出图
- ✅ 无 "Unable to parse url" toast

## 常见错误 → 快速定位

| 症状 | 定位 | 修复参考 |
|---|---|---|
| toast "Unable to parse url" | tvbox.flags | SPIDER-PITFALLS P0 |
| 视频 4 秒退回首页 | CDN 冷启动 520 | SPIDER-PITFALLS P1 (warmup) |
| 分类只有 1-4 页 | 用了首页聚合接口 | SPIDER-PITFALLS P2 (换 list API) |
| 剧集只显示 1 集 | cid 字段用错 | SPIDER-PITFALLS P3 |
| QuickJS OOM | size 太大 | SPIDER-PITFALLS P4 (size≤100) |
| ReferenceError: fetch | 用了 fetch | SPIDER-PITFALLS P5 (用 req) |
| 本地 curl 520 但 spider OK | IP 校验 | SPIDER-PITFALLS P6 |
| curl 空 body / 403 | UA 太短 | SPIDER-PITFALLS P7 |

## 参考实现

- **aiyifan (API 型全签名)**: `lib/aiyifan-api-spider.ts`
  - 双模签名（timestamp + cert）
  - CDN warmup
  - api/list/Search 翻页
  - languagesplaylist 用 meta.cid
