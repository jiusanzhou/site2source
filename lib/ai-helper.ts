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
  reasoning?: string;    // 简短说明
  errors?: string[];
}

interface AIRawResp {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/**
 * 询问 AI 详情页选择器
 * @param htmlSnippet 精简过的 HTML (通常 <20KB)
 * @param pageURL 当前页 URL (帮助 AI 判断上下文)
 * @param existing 已识别的字段(如有), AI 会尝试改进未识别的
 */
export async function askAIDetail(
  htmlSnippet: string,
  pageURL: string,
  existing?: Partial<AIFieldResult>,
): Promise<AIFieldResult> {
  const { key, model } = await getAIConfig();
  if (!key) {
    return { errors: ["未配置 AI key, 请在设置里填 OpenRouter Key"] };
  }

  const prompt = buildDetailPrompt(htmlSnippet, pageURL, existing);

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

    // 解析 JSON
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 兜底: 从 markdown 里挖 JSON
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
      reasoning: parsed.reasoning,
    };
  } catch (e: any) {
    return { errors: [`网络错误: ${e.message}`] };
  }
}

function cleanSel(s: any): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (!t || t === "null" || t.toLowerCase() === "n/a") return undefined;
  return t;
}

const SYSTEM_PROMPT = `你是网页爬虫选择器专家。给你一段影视网站的 HTML 片段，你要输出 CSS 选择器（支持 Drpy 的 && 属性语法）来提取以下字段。

支持的语法（Drpy T4 兼容）:
- 纯 CSS 选择器: h1.title
- 提取属性: img&&src / a&&href
- 属性 fallback: img&&data-original||data-src||src
- 逗号候选: *[title],img&&alt (取第一个非空)

必须返回严格 JSON，只包含这些 key: titleSelector, picSelector, descSelector, playTabSelector, playListSelector, listContainerSelector, reasoning
未找到的字段用 null。不要 markdown 代码块，直接返回 JSON。`;

function buildDetailPrompt(
  html: string,
  url: string,
  existing?: Partial<AIFieldResult>,
): string {
  const parts: string[] = [];
  parts.push(`页面 URL: ${url}`);
  if (existing && Object.keys(existing).length > 0) {
    parts.push(`已识别的字段 (如需改进请覆盖):`);
    Object.entries(existing).forEach(([k, v]) => {
      if (v) parts.push(`  ${k}: ${v}`);
    });
  }
  parts.push(`\n请提取:`);
  parts.push(`- titleSelector: 影片标题 (H1, .title 之类)`);
  parts.push(`- picSelector: 封面图 (img&&src, 支持 data-src 兜底)`);
  parts.push(`- descSelector: 剧情简介 (较长的一段文字)`);
  parts.push(`- playTabSelector: 播放线路切换按钮 (每个线路对应一个元素, 如 .play-from li)`);
  parts.push(`- playListSelector: 剧集列表容器 (里面是很多 <a> 链接, 如 .play-list)`);
  parts.push(`- listContainerSelector: (只在列表页填) 影片卡片列表容器`);
  parts.push(`- reasoning: 一句话解释判断依据`);
  parts.push(`\n=== HTML 片段 ===`);
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
