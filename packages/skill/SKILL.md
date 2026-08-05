---
name: site2source-spider
description: Generate TVBox/FongMi spider (Drpy T3/T4 爬虫) from any video streaming site by writing a declarative SiteModel, then publish to a public tvbox subscription repo. Use when (1) user asks to build a spider/爬虫/源 for a video site, (2) user mentions TVBox/FongMi/CatVod/影视仓/Drpy/tvbox 订阅, (3) user provides curl/HAR/DevTools captures from a video site and wants to turn them into a scraper, (4) user needs to add a new site to their tvbox subscription (jiusanzhou/tvbox), (5) an existing spider is broken and needs to be regenerated. NOT for: simple MacCMS 采集站 (use tvbox `type: 1` directly, no spider needed), single-request scraping (use browser-act or web_fetch), or non-video content extraction.
---

# site2source-spider

Turn a video streaming site into a TVBox/FongMi spider. Handles:

- **Signed API sites** (SPA + `md5({pub}&{query}&{pk})` style signing, e.g. aiyifan)
- **JSON API sites** (open endpoints, no signing)
- **MacCMS-style sites** (via bridging to `type: 1`, no spider)
- **Static-mirror sites** (single JSON dump, e.g. ddys.lat)

Two outputs:
1. A `spider.js` (T3 JS spider, self-contained)
2. A `tvbox.json` fragment (Drpy config snippet)

Then publish both to `jiusanzhou/tvbox` (public GH Pages) so any FongMi/TVBox client can subscribe.

## Repo layout (this skill lives inside site2source)

```
site2source/
├── packages/
│   ├── core/               # engine — SiteModel + generators + inferrer
│   │   ├── src/
│   │   │   ├── site-model.ts               # ← SiteModel schema
│   │   │   ├── generators/t3-spider.ts     # SiteModel → spider.js
│   │   │   └── sites/aiyifan.ts            # ← reference example
│   └── skill/              # ← YOU ARE HERE
│       ├── SKILL.md
│       ├── scripts/*.mjs
│       └── references/*.md
```

## Workflow

Always read `references/spider-pitfalls.md` first — 8 landmines that broke real sites. Skip them and you'll waste hours.

### Step 1 — Classify the site

Run:
```bash
node packages/skill/scripts/classify-site.mjs <url>
```
Output: one of `maccms | api-signed | api-open | static-mirror | dom-only | unsupported`.

If `maccms` → **stop, no spider needed**. Add a `type: 1` entry to tvbox.json pointing at the site's `/api.php/provide/vod` (see `references/example-maccms.md`).

If `dom-only` → this skill can't help; delegate to browser-act.

Otherwise continue.

### Step 2 — Capture network traffic

Ask the user for **either**:

- **HAR file** (DevTools → Network → Export HAR) — preferred
- **curl commands** (right-click request → Copy as cURL) — 3–5 core endpoints: home/list/detail/search/play
- **Live browser session** — invoke browser-act to record

For signed sites, capture with **at least 2 different timestamps** so signature vars can be reverse-engineered.

### Step 3 — Author SiteModel

**Do not write a spider from scratch**. Write a `SiteModel` (declarative config); the generator produces the spider.

**Reference material** (read only what applies):

| If site is… | Read |
|---|---|
| Signed SPA (md5/sha1 signing)      | `references/example-aiyifan.md` — the canonical case |
| Open JSON API (no signing)         | `references/example-open-api.md` |
| Static mirror (single JSON dump)   | `references/example-static-mirror.md` |
| Uses bootstrap (fetches keys first)| `references/example-aiyifan.md` — see `bootstrap` section |
| GEO-blocked (CF 1009 error)        | `references/proxy-config.md` — mount cf-proxy |

**Full SiteModel schema**: `references/site-model-schema.md` — read on demand, not up front.

Write the site definition to `packages/core/src/sites/<name>.ts`. Follow the exact aiyifan layout (const + `make<Name>Model()` factory if secrets involved).

### Step 4 — Generate the spider

```bash
node packages/skill/scripts/gen-spider.mjs <site-name>
```
Outputs to `test-output/spider_<name>.js` + `test-output/tvbox_<name>.json`.

### Step 5 — Verify

```bash
node packages/skill/scripts/verify-spider.mjs <site-name>
```
Runs contract checks (9 required methods) + end-to-end (home → category → detail → play → search).

Expected output: `✅ 5/5 stages pass`. If any stage fails, cross-reference `references/spider-pitfalls.md` — 90% of failures match a known pitfall.

### Step 6 — Publish to tvbox repo

```bash
node packages/skill/scripts/publish-tvbox.mjs <site-name> \
  --repo jiusanzhou/tvbox \
  [--message "add: <site-display-name>"]
```

This:
1. Clones/updates local mirror of `jiusanzhou/tvbox`
2. Copies `spider_<name>.js` → `sites/<name>/spider.js`
3. Writes/updates `sites/<name>/meta.json`
4. Runs the repo's own `pnpm build` to regenerate `tvbox.json`
5. Commits + pushes to `main` (which triggers GH Pages deploy)
6. Prints the subscription URL: `https://zoe.im/tvbox/tvbox.json`

If the user's tvbox repo isn't `jiusanzhou/tvbox`, pass `--repo <owner/name>`. The repo must follow the same layout (see `references/tvbox-repo-layout.md`).

## Hard rules (do not skip)

1. **Never inline secrets in `packages/core/src/sites/<name>.ts`** — use the `make<Name>Model({ withProxy: true })` factory pattern reading from `process.env.*` (see aiyifan). `.env` must be gitignored.
2. **The generated `spider.js` will contain any inlined secrets**. Before publishing check: if the tvbox target repo is public and the spider embeds a secret (e.g. proxy token), warn the user explicitly. Offer 3 options: accept token being public, rotate token to a low-privilege one, or add path-based obfuscation.
3. **`tvbox.json` `flags` array MUST NOT contain the site's own key** — this triggers FongMi "Unable to parse url" toast (pitfall #P0). Always verify after gen.
4. **Always run `verify-spider.mjs` before `publish-tvbox.mjs`**. Publishing a broken spider poisons the subscription for all downstream clients.
5. **For GEO-blocked sites** (CF error 1009), the user's cf-proxy at `notes-edge.pages.dev` is reusable; do not spin up a new proxy just for this site.

## Common failure modes

See `references/spider-pitfalls.md` for the full list. Top three:

- **`vod_play_url` empty** → mappings picked wrong field, or ad-CDN URL not excluded in `endpoints[play].response.exclude`
- **`Unable to parse url`** → flags contains site's own key (rule #3 above)
- **`签名错误` / signature mismatch** → wrong `formula` order, wrong `algorithm`, or `query_lower` not lower-cased

## What this skill does NOT do

- Automatic HAR → SiteModel inference (the inferrer only works on aiyifan-style; other sites need manual authoring)
- Video URL de-encryption (encrypted m3u8 keys are out of scope)
- Anti-bot bypass (Cloudflare Turnstile, PoW, etc.)
- Cross-region CDN load balancing

For those, ask the user to authorize a manual reverse-engineering session.
