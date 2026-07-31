/**
 * m3u8 内容探测器
 * 抓 m3u8 内容判断加密方式 (AES-128 / DRM / 无加密 / 自定义)
 */

import type { MediaProbe } from "./messages";

/** 探测 m3u8 URL, 返回加密方式和关键信息 */
export async function probeM3U8(url: string, referer?: string): Promise<MediaProbe> {
  try {
    const headers: Record<string, string> = {
      "Accept": "*/*",
    };
    // SW 里 navigator.userAgent 可能为空, 保险起见 optional chain
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
    if (ua) headers["User-Agent"] = ua;
    if (referer) headers["Referer"] = referer;

    const resp = await fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      cache: "no-store",
    });

    const contentType = resp.headers.get("content-type") || undefined;
    const ok = resp.ok;
    const status = resp.status;

    if (!ok) {
      return {
        status,
        ok: false,
        contentType,
        encryption: "unknown",
        error: `HTTP ${status}`,
      };
    }

    const text = await resp.text();
    return analyzeM3U8(text, status, contentType);
  } catch (e) {
    return {
      status: 0,
      ok: false,
      encryption: "unknown",
      error: (e as Error).message,
    };
  }
}

/** 解析 m3u8 文本判断加密方式 */
export function analyzeM3U8(text: string, status = 200, contentType?: string): MediaProbe {
  const preview = text.slice(0, 500);
  const lower = text.toLowerCase();

  // master playlist? (含 #EXT-X-STREAM-INF)
  const isMaster = /#EXT-X-STREAM-INF/i.test(text);

  // 段数
  const segmentCount = (text.match(/#EXTINF/g) || []).length;

  // 加密判断 (优先级从最严到最松)
  // Widevine / DRM
  if (/widevine|com\.widevine|urn:uuid:edef8ba9/i.test(text)) {
    return { status, ok: true, contentType, encryption: "widevine", segmentCount, preview, isMaster };
  }
  if (/playready|com\.microsoft\.playready|urn:uuid:9a04f079/i.test(text)) {
    return { status, ok: true, contentType, encryption: "playready", segmentCount, preview, isMaster };
  }

  // HLS 标准加密
  const keyMatch = /#EXT-X-KEY:([^\n\r]+)/i.exec(text);
  if (keyMatch) {
    const line = keyMatch[1];
    const methodM = /METHOD=([\w-]+)/i.exec(line);
    const method = methodM?.[1]?.toUpperCase();
    const uriM = /URI="([^"]+)"/.exec(line);
    const keyURI = uriM?.[1];

    if (method === "NONE") {
      return { status, ok: true, contentType, encryption: "none", segmentCount, preview, isMaster };
    }
    if (method === "AES-128") {
      return {
        status, ok: true, contentType,
        encryption: "aes-128",
        keyURI,
        segmentCount, preview, isMaster,
      };
    }
    if (method === "SAMPLE-AES" || method === "SAMPLE-AES-CENC" || method === "SAMPLE-AES-CTR") {
      return {
        status, ok: true, contentType,
        encryption: "sample-aes",
        keyURI,
        segmentCount, preview, isMaster,
      };
    }
    // 其他 method → 归为 custom
    return {
      status, ok: true, contentType,
      encryption: "custom",
      keyURI,
      segmentCount, preview, isMaster,
      error: `未知加密 method: ${method}`,
    };
  }

  // 没 EXT-X-KEY 但看起来像有加密痕迹
  if (/enc[-_]?[a-f0-9]+\.ts/i.test(text) || /encrypted/i.test(lower)) {
    return {
      status, ok: true, contentType,
      encryption: "custom",
      segmentCount, preview, isMaster,
      error: "疑似自定义加密 (segment 命名异常)",
    };
  }

  // 就是普通 m3u8
  return { status, ok: true, contentType, encryption: "none", segmentCount, preview, isMaster };
}

/** 加密方式 → 是否能在 TVBox/Drpy 里播放 */
export function isPlayable(enc: MediaProbe["encryption"]): {
  playable: boolean;
  reason: string;
} {
  switch (enc) {
    case "none":
      return { playable: true, reason: "无加密, 直接播" };
    case "aes-128":
      return { playable: true, reason: "AES-128 加密, IJKPlayer 自动解密 (注意 key 请求可能需要 Referer/UA)" };
    case "sample-aes":
      return { playable: false, reason: "SAMPLE-AES 加密, 需要 DRM CDM 支持, TVBox 一般无法播放" };
    case "widevine":
      return { playable: false, reason: "Widevine DRM, 需要合法授权 + ExoPlayer, 放弃" };
    case "playready":
      return { playable: false, reason: "PlayReady DRM, 需要授权, 放弃" };
    case "custom":
      return { playable: false, reason: "自定义加密, 需要逆向算法后在 lazy() 里处理" };
    case "unknown":
    default:
      return { playable: false, reason: "无法访问 m3u8 内容 (跨域或已过期)" };
  }
}
