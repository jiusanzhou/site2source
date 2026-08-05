# site2source

**把任意影视站点转换为 TVBox / FongMi 可用的源。**

从抓包 → 声明式 SiteModel → 生成 spider → 发布订阅, 一条龙。

## Monorepo

```
packages/
├── core/         # 引擎: SiteModel schema + generators + inferrer
├── extension/    # Plasmo Chrome 扩展 (可视化 SiteModel 编辑)
└── skill/        # AgentSkill (OpenClaw): 让别的 agent 也能造 spider
```

## Quick Start

**1. 声明站点** (参考 `packages/core/src/sites/aiyifan.ts`):

```ts
export const MYSITE_MODEL: SiteModel = {
  name: "mysite",
  bases: { api: "https://api.mysite.com" },
  endpoints: [{ name: "home", base: "api", path: "v1/list", ... }],
  mappings: { vod_id: ["id"], vod_name: ["title"], ... },
  ...
};
```

**2. 生成 spider**:
```bash
node packages/skill/scripts/gen-spider.mjs mysite
```

**3. 验证**:
```bash
node packages/skill/scripts/verify-spider.mjs mysite
```

**4. 发布到 tvbox 仓库** (可选):
```bash
node packages/skill/scripts/publish-tvbox.mjs mysite --repo <owner>/<tvbox>
```

## Skill

其他 agent (Claude/Codex 等) 想造 spider 可以直接用 skill:
```
packages/skill/SKILL.md
```

## 依赖

- Node ≥ 20
- pnpm (workspace)
- `.env` (可选, 挂 cf-proxy 时用)
