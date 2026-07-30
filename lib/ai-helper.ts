/**
 * AI Provider 抽象 —— 支持三种模式:
 *   1. chrome-ai     : Chrome 内置 Gemini Nano (window.LanguageModel API)
 *   2. openrouter-free : OpenRouter 免费模型 (需要 key 但模型 :free)
 *   3. byok          : 用户自定义 base URL + model + key
 *
 * 存储在 chrome.storage.local 里的字段:
 *   s2s:aiProvider: 'chrome-ai' | 'openrouter-free' | 'byok'
 *   s2s:aiKey     : API Key (openrouter-free + byok 用)
 *   s2s:aiModel   : model id (byok 用)
 *   s2s:aiBaseURL : API base URL (byok 用)
 *
 * legacy 兼容: 老版本 s2s:aiKey 会被读为 openrouter-free 或 byok
 */

export type AIProvider = "chrome-ai" | "openrouter-free" | "byok";

export interface AIConfig {
  provider: AIProvider;
  key: string;
  model: string;
  baseURL: string;
}

// 各 provider 的默认设置
const DEFAULTS: Record<AIProvider, Partial<AIConfig>> = {
  "chrome-ai": {
    model: "gemini-nano",
    baseURL: "",
  },
  "openrouter-free": {
    model: "deepseek/deepseek-chat-v3-0324:free",
    baseURL: "https://openrouter.ai/api/v1",
  },
  byok: {
    model: "deepseek/deepseek-chat",
    baseURL: "https://openrouter.ai/api/v1",
  },
};

// OpenRouter 上比较靠谱的免费模型 (按识别 CSS 选择器能力排序)
export const FREE_MODELS = [
  { id: "deepseek/deepseek-chat-v3-0324:free", name: "DeepSeek V3 (免费)", note: "推荐, 中文好, JSON 输出稳" },
  { id: "deepseek/deepseek-r1:free", name: "DeepSeek R1 (免费)", note: "推理强, 慢一些" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (免费)", note: "通用强" },
  { id: "google/gemini-2.0-flash-exp:free", name: "Gemini 2.0 Flash (免费)", note: "多模态" },
  { id: "qwen/qwen-2.5-coder-32b-instruct:free", name: "Qwen 2.5 Coder (免费)", note: "代码/结构化强" },
];

// ============ 配置读写 ============

const KEY_PROVIDER = "s2s:aiProvider";
const KEY_API_KEY = "s2s:aiKey";
const KEY_MODEL = "s2s:aiModel";
const KEY_BASE_URL = "s2s:aiBaseURL";

export async function getAIConfig(): Promise<AIConfig> {
  const r = await chrome.storage.local.get([
    KEY_PROVIDER,
    KEY_API_KEY,
    KEY_MODEL,
    KEY_BASE_URL,
  ]);
  const provider = (r[KEY_PROVIDER] || "openrouter-free") as AIProvider;
  const d = DEFAULTS[provider];
  return {
    provider,
    key: r[KEY_API_KEY] || "",
    model: r[KEY_MODEL] || d.model || "",
    baseURL: r[KEY_BASE_URL] || d.baseURL || "",
  };
}

export async function setAIConfig(patch: Partial<AIConfig>) {
  const kv: Record<string, string> = {};
  if (patch.provider !== undefined) kv[KEY_PROVIDER] = patch.provider;
  if (patch.key !== undefined) kv[KEY_API_KEY] = patch.key;
  if (patch.model !== undefined) kv[KEY_MODEL] = patch.model;
  if (patch.baseURL !== undefined) kv[KEY_BASE_URL] = patch.baseURL;
  await chrome.storage.local.set(kv);
}

/** 当前 provider 配置齐了吗 (能不能真的调用 AI) */
export async function hasAIConfig(): Promise<boolean> {
  const c = await getAIConfig();
  if (c.provider === "chrome-ai") {
    return await isChromeAIAvailable();
  }
  return !!c.key;
}

// ============ Chrome AI 检测 ============

/**
 * 检查 Chrome 内置 AI 是否可用
 * Chrome 138+ 稳定, Canary 更靠谱
 * API 变过几次: window.ai.assistant / window.ai.languageModel / window.LanguageModel
 */
export async function isChromeAIAvailable(): Promise<boolean> {
  try {
    // 最新 API (Chrome 138+): window.LanguageModel
    if (typeof (globalThis as any).LanguageModel !== "undefined") {
      const avail = await (globalThis as any).LanguageModel.availability?.();
      // "available" / "downloadable" / "downloading" / "unavailable"
      return avail === "available" || avail === "downloadable" || avail === "downloading";
    }
    // 老 API: window.ai.languageModel / window.ai.assistant
    const ai = (globalThis as any).ai;
    if (ai?.languageModel) {
      const caps = await ai.languageModel.capabilities?.();
      return caps?.available === "readily" || caps?.available === "after-download";
    }
    if (ai?.assistant) {
      const caps = await ai.assistant.capabilities?.();
      return caps?.available === "readily" || caps?.available === "after-download";
    }
  } catch (e) {
    console.warn("[ai] Chrome AI detect failed", e);
  }
  return false;
}

/** 返回 Chrome AI 的详细状态 (给设置页显示) */
export async function chromeAIStatus(): Promise<{
  available: boolean;
  state: "available" | "downloadable" | "downloading" | "unavailable" | "no-api";
  message: string;
}> {
  try {
    if (typeof (globalThis as any).LanguageModel !== "undefined") {
      const s = await (globalThis as any).LanguageModel.availability?.();
      const map: Record<string, string> = {
        available: "✅ 已就绪, 可直接用",
        downloadable: "⏬ 首次用会自动下载模型 (~2GB)",
        downloading: "⏳ 模型下载中...",
        unavailable: "❌ 此设备不支持 (需要 Chrome 138+ / 4GB VRAM)",
      };
      return {
        available: s === "available" || s === "downloadable" || s === "downloading",
        state: s,
        message: map[s] || `未知状态: ${s}`,
      };
    }
    const ai = (globalThis as any).ai;
    if (ai?.languageModel || ai?.assistant) {
      const api = ai.languageModel || ai.assistant;
      const caps = await api.capabilities?.();
      return {
        available: caps?.available === "readily" || caps?.available === "after-download",
        state: caps?.available === "readily" ? "available" : "downloadable",
        message: `旧版 API (${caps?.available})`,
      };
    }
  } catch {}
  return {
    available: false,
    state: "no-api",
    message: "❌ 浏览器不支持 (需 Chrome 138+, 或去 chrome://flags 开启 Prompt API)",
  };
}

// ============ 结构 ============

export interface AIFieldResult {
  titleSelector?: string;
  picSelector?: string;
  descSelector?: string;
  playTabSelector?: string;
  playListSelector?: string;
  listContainerSelector?: string;
  listItemTag?: string;
  reasoning?: string;
  errors?: string[];
}

// ============ 主入口 ============

async function callChromeAI(system: string, user: string): Promise<string> {
  const LM = (globalThis as any).LanguageModel;
  const ai = (globalThis as any).ai;

  if (typeof LM !== "undefined") {
    const session = await LM.create({
      initialPrompts: [{ role: "system", content: system }],
    });
    try {
      return await session.prompt(user);
    } finally {
      session.destroy?.();
    }
  }

  const api = ai?.languageModel || ai?.assistant;
  if (!api) throw new Error("Chrome AI API 不可用");

  const session = await api.create({ systemPrompt: system });
  try {
    return await session.prompt(user);
  } finally {
    session.destroy?.();
  }
}

async function callHTTP(
  cfg: AIConfig,
  system: string,
  user: string,
): Promise<string> {
  const url = cfg.baseURL.replace(/\/+$/, "") + "/chat/completions";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/jiusanzhou/site2source-ext",
      "X-Title": "Site2Source Chrome Extension",
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 800,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`API ${r.status}: ${t.slice(0, 200)}`);
  }
  const data: any = await r.json();
  if (data.error) throw new Error(data.error.message || "AI 返回错误");
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 返回空");
  return content;
}

async function askAI(
  mode: "detail" | "list",
  htmlSnippet: string,
  pageURL: string,
  existing?: Partial<AIFieldResult>,
): Promise<AIFieldResult> {
  const cfg = await getAIConfig();
  const system = SYSTEM_PROMPT;
  const user = mode === "list"
    ? buildListPrompt(htmlSnippet, pageURL, existing)
    : buildDetailPrompt(htmlSnippet, pageURL, existing);

  let content: string;
  try {
    if (cfg.provider === "chrome-ai") {
      if (!(await isChromeAIAvailable())) {
        return { errors: ["Chrome 内置 AI 不可用, 请去设置换 Provider"] };
      }
      content = await callChromeAI(system, user);
    } else {
      if (!cfg.key) return { errors: ["未配置 API Key, 请去 ⚙ 设置里填"] };
      content = await callHTTP(cfg, system, user);
    }
  } catch (e: any) {
    return { errors: [e.message || "AI 调用失败"] };
  }

  // 解析 JSON
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); }
      catch { return { errors: [`AI 返回非 JSON: ${content.slice(0, 200)}`] }; }
    } else {
      return { errors: [`AI 返回非 JSON: ${content.slice(0, 200)}`] };
    }
  }

  return {
    titleSelector: cleanSel(parsed.titleSelector),
    picSelector: cleanSel(parsed.picSelector),
    descSelector: cleanSel(parsed.descSelector),
    playTabSelector: cleanSel(parsed.playTabSelector),
    playListSelector: cleanSel(parsed.playListSelector),
    listContainerSelector: cleanSel(parsed.listContainerSelector),
    listItemTag: cleanSel(parsed.listItemTag),
    reasoning: parsed.reasoning,
  };
}

export async function askAIDetail(
  htmlSnippet: string,
  pageURL: string,
  existing?: Partial<AIFieldResult>,
): Promise<AIFieldResult> {
  return askAI("detail", htmlSnippet, pageURL, existing);
}

export async function askAIList(
  htmlSnippet: string,
  pageURL: string,
  existing?: Partial<AIFieldResult>,
): Promise<AIFieldResult> {
  return askAI("list", htmlSnippet, pageURL, existing);
}

// ============ helpers ============

function cleanSel(s: any): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (!t || t === "null" || t.toLowerCase() === "n/a") return undefined;
  return t;
}

const SYSTEM_PROMPT = `你是网页爬虫选择器专家。给你影视网站的 HTML 片段, 你输出精确的 CSS 选择器 (支持 Drpy && 属性语法) 用来提取影片数据。

Drpy T4 语法:
- 纯 CSS: h1.title / .video-list > li
- 提取属性: img&&src / a&&href / h1&&Text
- 属性 fallback: img&&data-original||data-src||src (惰性图 fallback)
- 逗号候选: *[title],img&&alt (取第一个非空)

约束:
- 只返回 JSON, 不要 markdown code fence
- 找不到的字段用 null
- 选择器要尽量简短但唯一 (优先 class > tag+attribute > tag chain)
- 优先选**语义化 class** (.title 好于 h1, .video-list 好于 div > div)`;

function buildDetailPrompt(
  html: string,
  url: string,
  existing?: Partial<AIFieldResult>,
): string {
  const parts: string[] = [];
  parts.push(`## 页面类型: 影片详情页`);
  parts.push(`URL: ${url}`);
  if (existing && Object.keys(existing).some((k) => (existing as any)[k])) {
    parts.push(`\n已识别的字段 (如需改进请覆盖, 认为已经对的请照抄):`);
    Object.entries(existing).forEach(([k, v]) => {
      if (v) parts.push(`  ${k}: ${v}`);
    });
  }
  parts.push(`\n## 输出 JSON, 包含这些 key:`);
  parts.push(`- titleSelector: 影片标题 (如 h1.title, 或 .video-info h1)`);
  parts.push(`- picSelector: 封面图 URL, 用属性表达式 (如 .cover img&&data-original||src)`);
  parts.push(`- descSelector: 剧情简介 (较长文字段, 如 .desc, .video-content .synopsis)`);
  parts.push(`- playTabSelector: 播放线路切换按钮的**每个** tab (如 .play-from > li)`);
  parts.push(`- playListSelector: 剧集列表容器 (里面是 <a> 链接, 如 .play-list ul, .episode-list)`);
  parts.push(`- reasoning: 一句话说明主要判断依据`);
  parts.push(`\n## HTML:`);
  parts.push(html);
  return parts.join("\n");
}

function buildListPrompt(
  html: string,
  url: string,
  existing?: Partial<AIFieldResult>,
): string {
  const parts: string[] = [];
  parts.push(`## 页面类型: 影片列表页 (首页/分类/搜索结果)`);
  parts.push(`URL: ${url}`);
  if (existing && Object.keys(existing).some((k) => (existing as any)[k])) {
    parts.push(`\n已有识别:`);
    Object.entries(existing).forEach(([k, v]) => {
      if (v) parts.push(`  ${k}: ${v}`);
    });
  }
  parts.push(`\n## 输出 JSON:`);
  parts.push(`- listContainerSelector: 影片卡片列表**容器** (不含卡片自身, 如 .video-list, ul.movies)`);
  parts.push(`- listItemTag: 每张卡片的标签名 (li / div / a, 用小写)`);
  parts.push(`- reasoning: 一句话说明为何这个容器最像影片列表`);
  parts.push(`\n判断影片列表的信号:`);
  parts.push(`- 内部有多个结构相似的子项 (10+ 个)`);
  parts.push(`- 每个子项都有 <a href> 和 <img>`);
  parts.push(`- <a> 的 href 通常带 /vod/, /detail/, /movie/ 之类`);
  parts.push(`- 排除页头 nav / 侧栏 / 页脚里的分类链接列表`);
  parts.push(`\n## HTML:`);
  parts.push(html);
  return parts.join("\n");
}

/**
 * 精简 HTML: 去 script/style/comment, 截断到 ~15KB
 */
export function trimHTML(fullHTML: string, maxBytes = 15000): string {
  let s = fullHTML
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > maxBytes) s = s.slice(0, maxBytes) + "...[truncated]";
  return s;
}
