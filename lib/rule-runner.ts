/**
 * Drpy 一级/二级规则解析器（子集）
 *
 * 支持的语法（Drpy T4 兼容）：
 *   - CSS 选择器：`.list .item`
 *   - 属性提取：`a&&href` / `img&&src` / `img&&data-original||data-src||src`
 *   - 文本提取：`h1&&Text` / `.desc&&Text`
 *   - 兜底属性：`*[title],img&&alt,text` (逗号分隔，取第一个非空)
 *   - 正则过滤：`.*(HD|4K).*`（用于 remarks 之类）
 *
 * 用于扩展内的"试运行"，不加载 Drpy 本身。
 */

export interface OnePlusRuleResult {
  count: number;
  items: {
    name: string;
    pic: string;
    url: string;
    remarks: string;
  }[];
  containerFound: boolean;
  errors?: string[];
}

/**
 * 解析一级规则字符串
 * 格式: `<容器 卡片>;<name>;<pic>;<remarks>;<url>`
 */
export function parseOnePlusRule(rule: string) {
  const parts = rule.split(";");
  return {
    listExpr: (parts[0] || "").trim(),
    nameExpr: (parts[1] || "").trim(),
    picExpr: (parts[2] || "").trim(),
    remarksExpr: (parts[3] || "").trim(),
    urlExpr: (parts[4] || "").trim(),
  };
}

/** 运行一级规则，从 root（document 或子树）里解析出卡片列表 */
export function runOnePlusRule(root: Document | Element, rule: string): OnePlusRuleResult {
  const errors: string[] = [];
  const p = parseOnePlusRule(rule);

  // listExpr 形如 "容器CSS 卡片tag" —— 空格切最后一段做卡片
  const listTokens = p.listExpr.split(/\s+/).filter(Boolean);
  if (listTokens.length < 1) {
    return { count: 0, items: [], containerFound: false, errors: ["空规则"] };
  }
  const itemTag = listTokens[listTokens.length - 1];
  const containerSel = listTokens.slice(0, -1).join(" ") || "body";

  let container: Element | null = null;
  try {
    container = (root as any).querySelector(containerSel);
  } catch (e) {
    errors.push(`容器选择器无效: ${containerSel}`);
    return { count: 0, items: [], containerFound: false, errors };
  }
  if (!container) {
    return { count: 0, items: [], containerFound: false, errors: [`未找到容器 ${containerSel}`] };
  }

  // 卡片 —— 通配 * 就选所有直接子节点，否则按 tag/class 选择
  let cardEls: Element[];
  try {
    if (itemTag === "*") {
      cardEls = Array.from(container.children);
    } else {
      cardEls = Array.from(container.querySelectorAll(`:scope > ${itemTag}`));
      if (cardEls.length === 0) {
        cardEls = Array.from(container.querySelectorAll(itemTag));
      }
    }
  } catch (e) {
    errors.push(`卡片选择器无效: ${itemTag}`);
    return { count: 0, items: [], containerFound: true, errors };
  }

  const items = cardEls.map((el) => ({
    name: extractField(el, p.nameExpr) || "",
    pic: extractField(el, p.picExpr) || "",
    url: extractField(el, p.urlExpr) || "",
    remarks: extractField(el, p.remarksExpr, true) || "",
  }));

  return {
    count: items.length,
    items,
    containerFound: true,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * 字段提取器：支持 Drpy 语法
 *   `a&&href` -> 从 a 元素拿 href 属性
 *   `img&&data-src||src` -> 从 img 元素拿 data-src, 没有则拿 src
 *   `h1&&Text` -> 从 h1 元素拿 textContent
 *   `*[title],img&&alt,text` -> 逗号分隔多个策略，取第一个非空
 *   `.*(HD|4K).*` -> 单独的正则(用于 remarks)，会从 el 的所有文本里搜
 *
 * @param isRegex remarks 字段特殊：如果表达式看起来像正则(纯 .* 开头)，做全文匹配
 */
function extractField(el: Element, expr: string, isRegex = false): string {
  if (!expr) return "";

  // 判断 remarks 的正则模式
  if (isRegex && /^\.\*|^\.\+/.test(expr)) {
    try {
      const re = new RegExp(expr);
      const txt = (el.textContent || "").trim();
      const m = txt.match(re);
      // 优先取捕获组，取不到就退回整个匹配
      if (m) return (m[1] || m[0]).trim();
    } catch {}
    // 正则解析失败也当选择器再试
  }

  // 逗号分隔的候选策略
  const strategies = expr.split(",").map((s) => s.trim()).filter(Boolean);
  for (const strat of strategies) {
    const val = extractOneStrategy(el, strat);
    if (val) return val;
  }
  return "";
}

function extractOneStrategy(el: Element, strat: string): string {
  // 语法: `selector&&attr` 或 `&&attr` 或 `selector`
  const parts = strat.split("&&");

  if (parts.length === 1) {
    // 只是选择器 —— 或者裸关键字 "text"
    const s = parts[0];
    if (s.toLowerCase() === "text") {
      return (el.textContent || "").trim();
    }
    const target = querySelectorFlex(el, s);
    return target ? (target.textContent || "").trim() : "";
  }

  const [selector, attrExpr] = parts;
  const target = selector ? querySelectorFlex(el, selector) : el;
  if (!target) return "";

  // attrExpr 可能是 `href` 也可能是 `data-src||src||data-original`
  const attrs = attrExpr.split("||").map((a) => a.trim()).filter(Boolean);
  for (const a of attrs) {
    if (a === "Text" || a === "text") {
      const t = (target.textContent || "").trim();
      if (t) return t;
      continue;
    }
    if (a === "html" || a === "innerHTML") {
      return target.innerHTML || "";
    }
    // 属性
    const v = target.getAttribute(a);
    if (v) {
      // 常见图片属性可能是相对 URL / lazy src, 补全
      if (/^(src|data-src|data-original|data-lazy-src|href)$/i.test(a)) {
        try {
          return new URL(v, (target.ownerDocument?.location as any)?.href || location.href).toString();
        } catch {
          return v;
        }
      }
      return v;
    }
  }
  return "";
}

/**
 * 灵活的 querySelector：
 *   - 支持 Drpy 里 `*[title]` 这种"任意标签有 title 属性"
 *   - 空/`*` 都返回自身
 */
function querySelectorFlex(el: Element, sel: string): Element | null {
  const s = sel.trim();
  if (!s || s === "*" || s === "&&") return el;
  try {
    // 先看自身是否匹配
    if (el.matches(s)) return el;
    return el.querySelector(s);
  } catch {
    return null;
  }
}
