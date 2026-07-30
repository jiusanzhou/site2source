# Site2Source 测试

## E2E 冒烟测试

用 puppeteer + Chrome for Testing 在真扩展上跑核心路径.

**跑法**:
```bash
pnpm build                    # 先 build 出 build/chrome-mv3-prod
node tests/e2e-smoke.mjs      # 跑测试, 约 30 秒
```

**测什么**:
- T1: 扩展加载, 拿到 extension ID
- T2: popup.html 能打开, UI 渲染
- T3: sidepanel.html 能打开, hint 条 + 切回按钮都在
- T4: content script 注入真实网站 (default: example.com)
- T5: XHR 抓包机制运行 (storage 结构正确)
- T6: popup 按钮可访问

**跑真实影视站** (可选):
```bash
SITE=https://ddys.pro/ node tests/e2e-smoke.mjs
```

**截图** (可选, Chrome 150 + puppeteer 有 bug 默认关):
```bash
SCREENSHOT=1 node tests/e2e-smoke.mjs
```

## 已知限制

- 只能用 Chrome for Testing (Chrome 150+ 禁 `--load-extension`)
  路径写死: `~/Library/Caches/ms-playwright/chromium-1217/...`
  若没有此 binary, 装 playwright 触发下载: `npx playwright install chromium`
- 覆盖不到: AI 补正质量 / 手动点选高亮框 / TVBox 里的 .js 播放
