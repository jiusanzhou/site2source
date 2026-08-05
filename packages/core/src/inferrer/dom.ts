/**
 * DOM 结构相似度分析 + 卡片字段提取
 * 从 Go 版 site2source/internal/analyzer/dom.go 移植
 */

export interface CardSample {
  name: string;
  pic: string;
  url: string;
  remarks: string;
  element?: Element; // 浏览器版本独有：真实 DOM 引用
}

export interface ListCandidate {
  selector: string;
  element: Element;
  childCount: number;
  similarity: number;
  depth: number;
  score: number;
  samples: CardSample[];
}

/**
 * 在整个 document 里找"重复子节点容器" = 影片列表容器
 */
export function findListContainers(root: Document | Element = document): ListCandidate[] {
  const results: ListCandidate[] = [];
  const all = root.querySelectorAll("*");

  for (const el of Array.from(all)) {
    const children = Array.from(el.children);
    const n = children.length;
    if (n < 6 || n > 200) continue;

    // 计算子节点结构签名相似度
    const sigCount = new Map<string, number>();
    for (const c of children) {
      const sig = structureSignature(c);
      sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
    }

    let maxCount = 0;
    for (const c of sigCount.values()) if (c > maxCount) maxCount = c;
    const similarity = maxCount / n;
    if (similarity < 0.6) continue;

    // 卡片必须包含 <a>
    const firstChild = children[0];
    const hasA = firstChild.querySelector("a") !== null || firstChild.tagName === "A";
    if (!hasA) continue;
    const hasImg = firstChild.querySelector("img") !== null;

    const depth = getDepth(el);
    let score = n * similarity;
    if (hasImg) score *= 1.5;
    if (depth >= 4) score *= 1.2;

    results.push({
      selector: buildSelector(el),
      element: el,
      childCount: n,
      similarity,
      depth,
      score,
      samples: [],
    });
  }

  results.sort((a, b) => b.score - a.score);

  // 取前 5 个候选，每个提取 5 张卡片样本
  const top = results.slice(0, 5);
  for (const c of top) {
    c.samples = sampleCards(c.element, 5);
  }
  return top;
}

/**
 * 一个节点的"结构指纹"：标签名 + 内部标签序列（前 15 个）
 */
function structureSignature(node: Element): string {
  const inner: string[] = [];
  const descendants = node.querySelectorAll("*");
  for (let i = 0; i < Math.min(15, descendants.length); i++) {
    inner.push(descendants[i].tagName);
  }
  return `${node.tagName}[${inner.join(">")}]`;
}

function getDepth(el: Element): number {
  let d = 0;
  let cur: Element | null = el;
  while (cur && cur.parentElement && d < 50) {
    cur = cur.parentElement;
    d++;
  }
  return d;
}

function buildSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `#${el.id}`;
  if (el.className && typeof el.className === "string") {
    const first = el.className.trim().split(/\s+/)[0];
    if (first) return `${tag}.${CSS.escape(first)}`;
  }
  return tag;
}

/**
 * 从容器里前 N 个子节点提取字段样本
 */
export function sampleCards(container: Element, n: number = 5): CardSample[] {
  const out: CardSample[] = [];
  const children = Array.from(container.children);
  for (let i = 0; i < Math.min(n, children.length); i++) {
    const c = children[i];
    const s = extractCard(c);
    if (s.name || s.url) out.push(s);
  }
  return out;
}

/**
 * 从单张卡片元素提取标准字段
 */
export function extractCard(card: Element): CardSample {
  const s: CardSample = { name: "", pic: "", url: "", remarks: "", element: card };

  // URL: 第一个 a 的 href
  const a = card.querySelector("a");
  if (a) {
    const href = a.getAttribute("href") || "";
    s.url = resolveURL(href);
    const title = a.getAttribute("title") || "";
    if (title && containsChinese(title)) s.name = title.trim();
  }

  // Pic: img 的 data-original / data-src / src
  const img = card.querySelector("img");
  if (img) {
    s.pic = pickImage(img);
    if (!s.name) {
      const alt = img.getAttribute("alt") || "";
      if (alt && containsChinese(alt)) s.name = alt.trim();
    }
  }

  // 备选标题：最长中文文本
  if (!s.name) s.name = pickLongestChineseText(card);

  // 备注：短文本，含集数/HD/年份
  s.remarks = pickRemarks(card);

  return s;
}

const RE_REMARKS = /HD|4K|1080|720|更新|第.{1,4}集|全.{1,4}集|完结|连载|\d{4}/;

function pickImage(img: HTMLImageElement): string {
  const keys = ["data-original", "data-src", "data-lazy-src", "data-echo", "src"];
  for (const k of keys) {
    const v = img.getAttribute(k);
    if (v && !v.startsWith("data:")) return resolveURL(v);
  }
  return "";
}

function pickLongestChineseText(el: Element): string {
  let best = "";
  // 遍历所有子节点的直接文本
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue || "").trim();
    if (t.length > best.length && t.length < 60 && containsChinese(t)) {
      best = t;
    }
  }
  return best;
}

function pickRemarks(el: Element): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue || "").trim();
    if (!t || t.length > 20) continue;
    if (RE_REMARKS.test(t)) return t;
  }
  return "";
}

function containsChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

/**
 * 相对 URL → 绝对（用当前页面的 origin）
 */
export function resolveURL(ref: string): string {
  if (!ref) return "";
  if (/^https?:\/\//.test(ref)) return ref;
  try {
    return new URL(ref, location.href).toString();
  } catch {
    return ref;
  }
}
