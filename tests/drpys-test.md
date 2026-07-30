# 真 Drpy runtime 测试

用 [drpyS (drpys-node)](https://github.com/zlw0901/drpys-node) 在本地跑 spider,
验证生成的 `.js` 在真 Drpy T4 引擎里能否响应 TVBox API 请求.

## 一次性 setup

```bash
# 克隆 drpyS
cd /tmp
git clone --depth 1 https://github.com/zlw0901/drpys-node.git drpys
cd drpys
npm install

# 清空 js 目录, 只留我们要测的
mv js js-full
mkdir js
```

## 跑一次

```bash
# 1. 用扩展抓 aiyifan.tv → 生成 spider
cd /Users/zoe/projects/labs.zoe.im/site2source-ext
node tests/e2e-real-site.mjs                          # 拿 XHR 数据
npx tsx tests/analyze-with-real-analyzer-runner.ts    # 分析 + 生成 spider

# 2. 复制到 drpyS
cp test-output/aiyifan-spider.js /tmp/drpys/js/aiyifan.js

# 3. 启 drpyS
cd /tmp/drpys && node index.js &

# 4. 调 TVBox 标准 API
curl "http://127.0.0.1:5757/api/aiyifan?ac=list&t=1&pg=1"
```

预期: 返回 `{ page, pagecount, list: [ { vod_id, vod_name, vod_pic }... ] }`
真实结果 (2026-07-31): ✅ 16 条爱壹帆影片正确返回

## 兼容性关键

生成的 spider 必须用 `var rule = {...}` 而非 `globalThis.rule = {...}`.

drpyS 加载器 (libs/drpyS.js:getRuleObject):
```js
const js_code_wrapper = `
  _asyncGetRule = (async function() {
    ${js_code}
    return rule;
  })();
`;
```

它在 IIFE 里 `return rule`, 所以 rule 必须在 IIFE 作用域内可见 —
`var rule = ...` OK, `globalThis.rule = ...` 需要 return globalThis.rule.

## 为什么这个测试很关键

以前只用 Node vm 模拟 Drpy, 会造假 (我们控制 request/log/vars).
drpyS 是**真 Drpy runtime** — 用它跑通, 等于装 TVBox 里跑通.

TVBox / FongMi 里的 Drpy 引擎和 drpyS 是同一份逻辑, 只是外面套了 Android UI.
