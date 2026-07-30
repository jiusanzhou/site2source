/**
 * AI 辅助识别 - 让 LLM 看页面 HTML 猜选择器
 *
 * 用 OpenRouter API 走 DeepSeek Chat (便宜好用, 结构化选择器识别足够)
 * User key + model 存 chrome.storage.local
 */

const KEY_AI_KEY = "s2s:aiKey";
const KEY_AI_MODEL = "s2s:aiModel";
const DEFAULT_MODEL = "deepseek/deepseek-chat";

export async function getAIConfig(): Promise<{ key: string; model: string }> {
  const r = await chrome.storage.local.get([KEY_AI_KEY, KEY_AI_MODEL]);
  return {
    key: r[KEY_AI_KEY] || "",
    model: r[KEY_AI_MODEL] || DEFAULT_MODEL,
  };
}

export async function hasAIConfig(): Promise<boolean> {
  const { key } = await getAIConfig();
  return !!key;
}

/** AI 识别的返回 —— 每个字段 CSS 选择器 (含属性表达式) */
export interface AIFieldResult {
  titleSelector?: string;
  picSelector?: string;
  descSelector?: string;
  playTabSelector?: string;
  playListSelector?: string;
  listContainerSelector?: string;
  listItemTag?: string;         // 卡片标签, 如 li / div / a
  reasoning?: string;    // 简短说明
  errors?: string[];
}

interface AIRawResp {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/**
 * 通用 AI 调用 - 让 AI 看 HTML 给字段选择器
 * @param mode 'detail' | 'list'  区分详情页/列表页 prompt
 */
async function askAI(
  mode: "detail" | "list",
  htmlSnippet: string,
  pageURL: string,
  existing?: Partial<AIFieldResult>,
): Promise<AIFieldResult> {
  const { key, model } = await getAIConfig();
  if (!key) {
    return { errors: ["未配置 AI key, 请在设置里填 OpenRouter Key"] };
  }

  const prompt = mode === "list"
    ? buildListPrompt(htmlSnippet, pageURL, existing)
    : buildDetailPrompt(htmlSnippet, pageURL, existing);

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/jiusanzhou/site2source-ext",
        "X-Title": "Site2Source Chrome Extension",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 800,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return { errors: [`AI 请求失败 (${r.status}): ${t.slice(0, 200)}`] };
    }

    const data: AIRawResp = await r.json();
    if (data.error) return { errors: [`AI 错误: ${data.error.message}`] };

    const content = data.choices?.[0]?.message?.content;
    if (!content) return { errors: ["AI 返回空"] };

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
  } catch (e: any) {
    return { errors: [`网络错误: ${e.message}`] };
  }
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
