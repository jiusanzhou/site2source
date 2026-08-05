# tvbox 仓库布局 (发布目标)

`jiusanzhou/tvbox` 是 Zoe 的 tvbox 订阅仓库, 部署到 GH Pages, 订阅 URL:
```
https://zoe.im/tvbox/tvbox.json
```

## 目录结构

```
tvbox/
├── README.md
├── package.json         # pnpm scripts: build, sync, smoke
├── tvbox.json           # ← 最终产物, 由 build.mjs 生成
├── smoke.json           # 冒烟测试结果 (GH Pages 展示)
├── docs/                # GH Pages 面板 (二维码 + 健康状态)
├── shared/
│   ├── lives.json       # 直播源清单
│   └── parses.json      # 解析源清单
├── scripts/
│   ├── build.mjs        # 打包 tvbox.json (合并 sites/*/meta.json)
│   ├── sync-from-ext.mjs # 从 site2source 同步 spider 产物
│   ├── smoke.mjs        # 契约 + 依赖可达性检查
│   ├── validate.mjs
│   └── loader.mjs
└── sites/
    ├── aiyifan/
    │   ├── spider.js    # ← 生成的 spider (可能含 secret)
    │   ├── meta.json    # ← 单 site 的配置
    │   └── README.md    # ← 说明
    └── ddys/
        ├── spider.js
        ├── meta.json
        └── README.md
```

## sites/<name>/meta.json 格式

```json
{
  "key": "<slug>",
  "name": "🎬 <显示名>",
  "type": 3,
  "spider": "sites/<slug>/spider.js",
  "searchable": 1,
  "quickSearch": 1,
  "filterable": 1,
  "categories": ["电影", "剧集", ...],
  "source": "https://<官网>",
  "note": "备注 (发布记录/特性)",
  "probes": ["https://<官网>/"]
}
```

**key 命名**:
- 全小写 + 数字 + 下划线
- 不能跟已有 site 重复
- 保留后缀区分变体: `xxx_api` (API 型) / `xxx_dom` (DOM 抓取) / `xxx_json` (静态镜像)

## scripts/build.mjs 干了啥

1. 遍历 `sites/*/meta.json`
2. 每个 meta 加个 `spider` 前缀 (指向对应 spider.js 的相对 URL)
3. 合并所有 site 成一个大数组 → `tvbox.json.sites`
4. 拼上 `shared/lives.json` + `shared/parses.json`
5. 加 `_meta` (commit hash + timestamp + site 清单)
6. 写 `tvbox.json`

## scripts/sync-from-ext.mjs 干了啥

从 `../site2source/test-output/spider_<name>.js` 拷贝到 `sites/<name>/spider.js`。有个硬编码的 MAP:

```js
const MAP = {
  aiyifan: 'spider_aiyifan_api_t3.js',
};
```

**注意**: 老的 sync 脚本用的是 `spider_aiyifan_api_t3.js` (老名字). 新 skill 生成的是 `spider_<name>.js`。加新站时更新这个 MAP。

或者 skill 的 `publish-tvbox.mjs` 直接覆盖了 `sites/<name>/spider.js`, 不走 sync-from-ext。

## GH Pages 部署

- 分支: `main`
- 目录: `/` (根)
- 域名: `zoe.im/tvbox/` (CNAME)
- 更新延迟: push → deploy 一般 30s-2min

## 加新站流程 (skill 视角)

1. `gen-spider.mjs <name>` → `test-output/spider_<name>.js` + `tvbox_<name>.json`
2. `verify-spider.mjs <name>` → 契约通过
3. `publish-tvbox.mjs <name>`:
   - `.tvbox-mirror/` 目录 clone `jiusanzhou/tvbox`
   - 拷贝 spider.js → `sites/<name>/spider.js`
   - 从 `test-output/tvbox_<name>.json` 生成 `sites/<name>/meta.json`
   - 跑 `pnpm build` 重新打包 tvbox.json
   - `git commit -m "..."` + `git push`

## 如果用户的 tvbox 仓库不是 jiusanzhou/tvbox

结构必须一样: `sites/<name>/{spider.js, meta.json}` + `scripts/build.mjs`.

不一样时可以:
- 让用户参考 [jiusanzhou/tvbox](https://github.com/jiusanzhou/tvbox) 改造
- 或者用 `--dry-run` 只拷文件不 build, 用户手动整合
