# site2source-ext 自动化路线图

**问题**：怎么让插件自动搞定 aiyifan 这类 SPA + 签名站，而不是我每晚手动逆？

**答案**：不追求"零人工"，追求"每个环节的人工成本从小时降到分钟"。

---

## 这一晚做 aiyifan 的动作分解

按耗时排序（真实数据）：

| 阶段 | 耗时 | 我做了什么 | 能自动化到什么程度 |
|---|---|---|---|
| ① 找 API 端点 | 15 min | 打开 devtools 看 XHR | ✅ 完全自动（CDP 抓包） |
| ② 逆签名参数 | 60 min | 找 bundle → grep vv → 找 md5 → 找 pk 数组 | 🟡 半自动（引导式，人复核） |
| ③ 逆密钥表 | 90 min | 找到 4 个 → 8 个（形近字符坑） | 🟡 半自动（用验证器逼你补全） |
| ④ cert vs timestamp | 40 min | 浏览器 pub 是长串 → 找 pConfig 逻辑 | 🟡 半自动 |
| ⑤ 挑真视频（跳广告）| 20 min | flvPathList[0] 是广告 | ✅ 启发式规则可迁移 |
| ⑥ 生成 spider | 5 min | 已有 generator | ✅ 完全自动 |
| ⑦ 真机验证 | 30 min | ADB + FongMi | ✅ 完全自动（有 harness） |

**关键洞察**：② ③ ④ 是**真正的智力活**，但都是"重复相同的思考模式"，可以做成**引导 + 验证器 + LLM 辅助**。

---

## 分层架构

```
┌─────────────────────────────────────────────────┐
│  L4: SpiderPack 生成器                          │
│      T3 JS / drpy T4 / TVBox JSON              │
├─────────────────────────────────────────────────┤
│  L3: 站点模型（SiteModel）                       │
│      端点 + 签名 + 字段映射 + 播放地址挑选       │
├─────────────────────────────────────────────────┤
│  L2: 学习管线（Learner）                        │
│      浏览器控制 + 抓包 + 逆向助手 + 验证器       │
├─────────────────────────────────────────────────┤
│  L1: 原语（Primitives）                         │
│      CDP / cheerio / md5/hmac/aes/rsa           │
└─────────────────────────────────────────────────┘
```

现在我们有 **L1 + L4**（半成品），缺 **L2 + L3**。

---

## L3: SiteModel — 站点抽象

一个站点 = 一份 YAML（或 JSON）描述文件，**手写签名代码 → 声明式配置**：

```yaml
name: aiyifan
base:
  api: https://m10.aiyifan.tv
  rank: https://rankv21.aiyifan.tv
  site: https://www.aiyifan.tv

# 签名方案（可切换）
signing:
  algorithm: md5
  formula: '{pub}&{query_lower}&{pk}'
  modes:
    timestamp:
      pub_source: 'Date.now()'
      pk_source: 'PKS[Number(pub) % PKS.length]'
      constants:
        PKS: [version001, vers1on001, ..., version0o1]  # 8 个
    cert:
      pub_source: 'bootstrap.pConfig.publicKey'
      pk_source: 'bootstrap.pConfig.privateKey[0]'

bootstrap:
  # 拿 pConfig
  endpoint: v3/home/config
  query: cinema=1
  sign_mode: timestamp
  extract:
    publicKey: data.info[0].pConfig.publicKey
    privateKey: data.info[0].pConfig.privateKey

endpoints:
  home:
    path: v3/home/getAllVideo
    query: cinema=1&page=1&size=100&region=SG
    sign_mode: auto  # 优先 cert, 退 timestamp
    response:
      list_paths:
        movies: data.info[0].filmList
        series: data.info[0].tvList
        # ...

  detail:
    path: v3/video/detail
    query: 'cinema=1&device=1&player=CkPlayer&tech=HLS&lang=cns&v=1&id={id}&region=SG'
    sign_mode: auto
    response:
      item: data.info[0]

  episodes:
    path: v3/video/languagesplaylist
    query: 'cinema=1&vid={id}&lsk=1&taxis=0&cid={cid}'
    sign_mode: auto
    response:
      list: data.info[0].playList
      map:
        name: name
        key: key

  play:
    path: v3/video/play
    query: 'cinema=1&id={id}&a=0&lang=none&usersign=1&region=SG&device=1&isMasterSupport=1'
    sign_mode: cert   # play 必须 cert
    response:
      # 播放地址挑选策略
      pick:
        - clarity[?isEnabled==true].path
        - flvPathList[?isHls==true]
        - hlsPathList[?isHls==true]
        - '*[?isHls==true]'  # 兜底
      # 反广告规则
      exclude_hosts:
        - 's1-a1.global-cdn.me'   # aiyifan 广告 CDN
        - 'ad*.'                  # 通配

# 字段映射（响应字段 → TVBox vod_*）
mappings:
  vod_id: [key, contxt, id]
  vod_name: [title, name]
  vod_pic: [image, imgPath, cover, pic]
  vod_year: [year, post_Year]
  vod_area: [regional, area, region]
  vod_actor: [starring, stars, actor]
  vod_director: [directed, directors, director]
  vod_content: [shortDes, contxt, desc, description]
  vod_remarks: computed('更新至{lastName}' if lastName else score)
```

**这份 YAML 决定 spider 一切行为**。改站点等于改 YAML，不动代码。

---

## L2: Learner — 半自动学习管线

分 5 步，每步都有**自动 + 人工兜底**：

### Step 1: 站点侦查（`s2s scout <url>`）— 自动

```bash
$ s2s scout https://www.aiyifan.tv
```

做的事：
- 起 headless Chrome，打开首页/几个详情页
- CDP 抓所有 XHR/Fetch
- 分析请求：URL 模式、参数模式、有无签名字段（vv/sign/token/x-sig...）
- 输出 `scout-report.md`：
  ```
  发现 8 个 API 端点：
    - m10.aiyifan.tv/v3/home/getAllVideo  (12 次调用, 有签名 vv/pub)
    - m10.aiyifan.tv/v3/video/detail       (3 次调用, 有签名)
    - rankv21.aiyifan.tv/v3/list/briefsearch  (搜索)
    ...
  签名参数模式: vv (32 hex) + pub (变长)
  推测算法: md5 (32 hex 特征)
  ```

### Step 2: 签名逆向助手（`s2s reverse-sign`）— 引导式

```bash
$ s2s reverse-sign
```

做的事：
- 从 scout 抓到的 `main.js` bundle 里 grep 加密函数
- 用 **AST 解析**（不是正则）定位签名生成点
- **交互式**问用户："这里发现 md5(a + '&' + b + '&' + c)，a=pub, c=看起来是密钥？"
- **实时验证器**：给你算出的公式，用抓包里的 10 组 (query, vv, pub) 校验
  - "10/10 通过" → 收工
  - "5/10 通过" → **告诉你哪 5 组失败**，让你补密钥表
  - 这一步能自动**发现"8 个不是 4 个"**！

**这一步是关键**：验证器让"缺一半密钥"这种 bug 一定被发现。

### Step 3: 端点行为学习（`s2s learn-endpoints`）— 自动

对每个 scout 到的端点：
- 用逆出的签名多调几次，改参数看差异
- 自动识别：分类端点/详情端点/播放端点/搜索端点
- 分析响应结构，找 vod 字段（title/pic/year 的候选路径）
- 输出 SiteModel YAML 草稿

### Step 4: 播放地址挑选学习（`s2s learn-play`）— 半自动

**这一步最脏**，但可以有启发式：
- 用 CDP 打开真实播放页
- **在浏览器里等 15 秒**（跳过广告）
- 抓 video 元素的 `src` 或 hls.js 加载的 m3u8
- 对比 play 端点响应里的所有 URL 字段
- **匹配**：真视频 URL 在响应哪个字段？
- 学到 `pick_strategy` + 广告 host 黑名单

### Step 5: 真机烟测（`s2s smoketest`）— 自动

已有的 FongMi harness：
- 生成 spider + tvbox.json
- 起 http server + 装 emulator 配置
- ADB 点击：分类 → 详情 → 播放
- 抓 logcat 里的 `[s2s]` 日志和播放地址
- 通/不通给报告

---

## 应对新站点的完整流程

```bash
# 1. 侦查（3 分钟自动）
s2s scout https://newsite.com > report.md

# 2. 看报告，决定策略
#    - 无签名 → 跳到 step 3
#    - 有签名简单 → step 2 自动逆
#    - 有签名复杂 → step 2 交互式 + LLM 辅助

# 3. 逆签名（5-30 分钟，视复杂度）
s2s reverse-sign --interactive

# 4. 学端点（2 分钟自动）
s2s learn-endpoints > site.yaml

# 5. 学播放挑选（3 分钟半自动）
s2s learn-play --patch site.yaml

# 6. 生成 + 烟测（2 分钟自动）
s2s build site.yaml
s2s smoketest

# 7. 通了就 commit
```

**目标**：新站 P50 时间 ≤ 20 分钟；aiyifan 这种硬骨头 ≤ 2 小时。

---

## 什么时候用 LLM

- **Step 2 签名逆向**：把 bundle 片段 + 抓到的 10 组样本喂 LLM，让它猜公式，验证器校验
- **Step 4 播放挑选**：把响应 JSON + 真视频 URL 喂 LLM，让它写 JSONPath 挑选式
- **Step 5 失败诊断**：logcat 报错 + spider 代码喂 LLM，让它建议改哪里

LLM 不是主流程，是**卡壳时的加速器**。核心是**验证器**，因为 LLM 会瞎猜，验证器不骗人。

---

## 落地优先级

**先做**（能立刻用上，2-3 天）：
1. `s2s scout` — CDP 自动抓包（已有 spa-harvester 底子）
2. **验证器**：给一组 (query, expected_sign) + 一份猜测公式，判定通过率
3. SiteModel YAML schema + spider 生成器改造（读 YAML 而不是硬编码 aiyifan）

**再做**（有用但复杂，1-2 周）：
4. `s2s reverse-sign` 交互式逆向 CLI
5. `s2s learn-endpoints` 自动学端点
6. `s2s learn-play` 播放挑选学习

**最后**（打磨，随缘）：
7. LLM 集成
8. 广告 host 众包黑名单
9. Chrome 插件形态（点一下"学习此站"）

---

## 未来的样子

理想情况，看到新视频站：

```bash
$ s2s scout https://xxx.com --auto
[1/6] 侦查... 找到 6 个端点，2 个带签名
[2/6] 逆签名... 匹配"md5(ts+key+query)"模板，10/10 校验通过
[3/6] 学端点... home/category/detail/search/play 都识别
[4/6] 学播放... 发现广告 host xxx.ad-cdn.com, isHls 字段可用
[5/6] 生成 spider... test-output/spider_xxx_t3.js
[6/6] 烟测... FongMi 一二三级全通 ✅

耗时: 4 分 32 秒
```

碰到 aiyifan 级难度的站，中间自动降级到交互模式让人复核几个选择就够了。

---

**要不要现在开始 Step 1**（把这一晚上的 aiyifan 经验抽成 SiteModel YAML，把 `aiyifan-api-spider.ts` 改成"YAML → spider"的通用 generator）？
睡醒了动手也行 —— 这是 3-5 天的工程量，今晚已经烧脑够多了 😴
