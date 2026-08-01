/**
 * 从 XHR URL / params 里猜 role, 不猜就返回 null.
 */
import type { CapturedXHR } from "./messages";

export type RoleName = "home" | "category" | "search" | "detail" | "play";

export function guessRoleFromXHR(xhr: CapturedXHR): RoleName | null {
  const url = (xhr.url || "").toLowerCase();
  if (!url) return null;

  if (/\b(home|index|getindex|recommend|banner)\b/.test(url)) return "home";

  if (/\b(detail|videoinfo|getvideo|videoplay)\b/.test(url)) return "detail";
  if (/\/video\/play\b|\/video\/detail\b|\bvod\/detail\b/.test(url)) return "detail";

  if (/\b(search|keyword|query)\b/.test(url) || /[?&](wd|keyword|q|search|kw)=/.test(url)) {
    return "search";
  }

  if (/\b(category|categorylist|getcategory|classify)\b/.test(url)) return "category";
  if (/[?&](cate|category|type|classify|tag)=/.test(url) && !/\b(search|detail)\b/.test(url)) {
    return "category";
  }

  return null;
}
