# Site2Source Extension

Chrome 扩展：在任意影视网站上**一键生成 TVBox / FongMi 可用的 Drpy 爬虫**。

## 为什么用插件而不是 CLI

CLI 打不过 Cloudflare / 密码墙 / JS 渲染。插件跑在用户真实浏览器里，**这些反爬都不存在**。

## MVP 交互流程

1. 用户打开一个影视网站的**列表页**（比如 example.com/movies）
2. 点插件图标 → **"分析此页面"**
3. 插件在页面上**高亮候选影片列表**（多个的话按得分排序）
4. 用户点正确的那个 → 确认
5. 插件自动提取每张卡片的字段（标题/封面/链接/备注）
6. 用户点击一部片 → 进入详情页 → 插件学习详情结构
7. 点击播放 → 插件**从 Network 抓 m3u8/mp4**
8. **一键生成** Drpy T4 爬虫 + tvbox.json

## 技术栈

- **Plasmo** — MV3 扩展框架
- **React 18** — UI（Popup / Sidebar）
- **DOM 相似度算法** — 从 Go 版 site2source 移植到 TS
- **chrome.webRequest** — 抓视频流

## 开发

```bash
pnpm install
pnpm dev              # 开发模式（build/chrome-mv3-dev 加载到 Chrome）
pnpm build            # 生产构建
pnpm package          # 打包 zip
```

## 加载到 Chrome

1. `pnpm dev`
2. 打开 `chrome://extensions`
3. 打开右上角"开发者模式"
4. 点"加载已解压的扩展程序"，选 `build/chrome-mv3-dev`

## 路线图

- [x] V0.1 项目骨架 + 手工列表选择器
- [ ] V0.2 DOM 相似度自动候选 + 高亮
- [ ] V0.3 详情页学习 + 播放地址嗅探
- [ ] V0.4 生成 Drpy T4 + 一键下载
- [ ] V0.5 Gist/CF Pages 一键上传

## License

MIT
