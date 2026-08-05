# Example: MacCMS 采集站 (不用 spider)

**站点特征**：
- URL 长得像 `/index.php/vod/detail/id/xxx.html`
- 有个 `/api.php/provide/vod/?ac=list` 端点，直接返回 JSON
- 80% 的国内影视站都是 MacCMS

## 判断方式

```bash
curl 'https://<site>/api.php/provide/vod/?ac=list'
```

看到形如 `{"code": 1, "class": [...], "list": [...]}` 就是 MacCMS。

## 不需要 spider!

MacCMS 已经跟 tvbox 协议兼容, 直接在 `tvbox.json` 里加一条 `type: 1` 即可:

```json
{
  "key": "example_maccms",
  "name": "🎬 示例站",
  "type": 1,
  "api": "https://example.com/api.php/provide/vod",
  "searchable": 1,
  "quickSearch": 1,
  "filterable": 1
}
```

**就这一行, 没了**. 不需要 spider.js, 不需要 SiteModel, 不需要跑 gen/verify.

## 手动 publish (直接改 tvbox 仓库)

```bash
cd .tvbox-mirror
# 或 pnpm 命令自动加, 看你 tvbox 仓库 scripts/build.mjs 支持啥
git checkout main && git pull
# 编辑 sites.json 或 build.mjs 里的清单, 加一条 type=1
git add . && git commit -m "add: <site>"
git push origin main
```

## MacCMS 变体

有些站改过 MacCMS，需要看具体接口：

| 特征 | 类型 |
|------|------|
| `/api.php/provide/vod/?ac=list` + 返回标准 JSON | `type: 1` |
| `/api.php/provide/vod/?ac=videolist` 返回 XML  | `type: 0` |
| `/inc/api.php` 或其他自定义路径 | 试 `type: 1` 用自定义 api URL |
| `/api.php/provide/vod/from/xxx/at/json` 分片 | `type: 1` |

## 为什么本 skill 不处理 MacCMS

本 skill 目标是**签名 SPA / 复杂反爬**站点。MacCMS 是 tvbox 一等公民，直接改 tvbox.json 就好，用 spider 生成器反而多此一举。

**如果 classify-site.mjs 报 `maccms`**：
1. 复制上面那段 `type: 1` 配置
2. 改 key/name/api URL
3. 手动 append 到 tvbox 仓库的 sites 清单里
4. 跑 tvbox 仓库的 `pnpm build`
5. push

**skill 到此结束**。
