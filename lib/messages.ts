/**
 * 消息类型定义 —— background / content / popup 之间通信
 */

// ==================== 消息 ====================

export type Message =
  // 列表页交互
  | { type: "GET_CANDIDATES" }
  | { type: "HIGHLIGHT_ELEMENT"; selector: string }
  | { type: "STOP_INSPECT" }
  | { type: "RECOMPUTE_BASE"; selector: string }
  | { type: "GET_SAMPLES"; selector: string; itemTag?: string }
  | { type: "TEST_RULE"; rule: string }
  | { type: "TEST_DETAIL_RULE"; input: import("./rule-runner").DetailRuleInput }
  | { type: "GET_HTML_SNAPSHOT"; maxBytes?: number }
  // 手动点选模式（用户 hover 页面 → 点击选中）
  | { type: "START_PICK"; role: PickRole }
  | { type: "STOP_PICK" }
  | { type: "PICK_RESULT"; role: PickRole; selector: string; sample?: string }
  // 详情页学习
  | { type: "START_DETAIL_LEARN" }
  | { type: "GET_DETAIL_INFO" }
  // 首页学习（分类导航 + 搜索）
  | { type: "GET_HOME_INFO" }
  // 抓取的媒体
  | { type: "GET_CAPTURED_MEDIA" }
  | { type: "CLEAR_CAPTURED_MEDIA" }
  // 抓取的 XHR (API 型爬虫用)
  | { type: "CAPTURE_XHR"; xhr: CapturedXHR }
  | { type: "GET_CAPTURED_XHR" }
  | { type: "CLEAR_CAPTURED_XHR" }
  | { type: "REPLAY_XHR"; xhr: CapturedXHR }
  | { type: "OPEN_SIDEPANEL"; remember?: boolean }
  | { type: "SET_UI_PREFERENCE"; preferSidepanel: boolean }
  // 状态持久化
  | { type: "SAVE_STATE"; state: Partial<ProjectState>; replace?: Array<"detail" | "home" | "baseInfo"> }
  | { type: "GET_STATE" }
  | { type: "RESET_STATE" }
  // 多项目管理
  | { type: "LIST_PROJECTS" }
  | { type: "SWITCH_PROJECT"; host: string }
  | { type: "DELETE_PROJECT"; host: string };

/** 用户在页面上可以"点选"的字段角色 */
export type PickRole =
  | "list" // 列表容器（手动模式）
  | "title" // 详情页标题
  | "desc" // 详情简介
  | "playTab" // 播放线路（qq/youku 等 tab）
  | "playList" // 剧集列表容器
  | "playItem" // 单个剧集
  | "playButton"; // 播放按钮（用来触发嗅探）

// ==================== 数据结构 ====================

export interface SiteInfo {
  url: string;
  host: string;
  baseURL: string; // scheme://host（当前页面）
  siteName: string;
}

/** 从 DOM/抓包投票推断的多种 base */
export interface BaseInfo {
  pageBase: string; // location.origin
  linkBase?: string; // 列表 <a href> 里最常见的绝对 host
  imgBase?: string; // 列表 <img src> 里最常见的绝对 host
  apiBase?: string; // 抓到的 XHR/fetch 里最常见的 host
  /** 用户手工确认的最终 base（覆盖以上） */
  overrideBase?: string;
  /** 各 base 的统计明细，便于调试展示 */
  stats?: {
    links: { host: string; count: number; sample?: string }[];
    imgs: { host: string; count: number; sample?: string }[];
  };
}

export interface SerializedCandidate {
  selector: string;
  childCount: number;
  similarity: number;
  score: number;
  itemTag: string;
  samples: SerializedSample[];
}

export interface SerializedSample {
  name: string;
  pic: string;
  url: string;
  remarks: string;
}

export interface CapturedMedia {
  url: string;
  type: string; // "m3u8" | "mp4" | "flv" | "ts"
  timestamp: number;
  referer?: string;
  tabURL?: string;
  /** m3u8 内容探测结果 (仅 type=m3u8 时填充) */
  probe?: MediaProbe;
}

export interface MediaProbe {
  status: number;              // HTTP 状态
  ok: boolean;                 // status 2xx
  contentType?: string;
  /** 加密方式识别 */
  encryption: "none" | "aes-128" | "sample-aes" | "widevine" | "playready" | "custom" | "unknown";
  /** key 请求 URL (AES-128 时) */
  keyURI?: string;
  /** ts 片段数 */
  segmentCount?: number;
  /** m3u8 头几行 (最多 500 字符, 用于 UI 展示) */
  preview?: string;
  /** 是否 master playlist (指向多个码率的子 m3u8) */
  isMaster?: boolean;
  /** 错误信息 */
  error?: string;
}

/**
 * 网页 XHR/fetch 抓包结果
 * 由 content script hook page 侧的 fetch/XHR 得到
 */
export interface CapturedXHR {
  url: string;
  method: string;
  reqHeaders?: Record<string, string>;
  reqBody?: string;
  respStatus?: number;
  respContentType?: string;
  respBody?: string;       // 只保存前 50KB
  respTruncated?: boolean;
  timestamp: number;
  pageURL?: string;
  /** 用户可以给这条 XHR 打的标签 (home/category/search/detail/play) */
  role?: "home" | "category" | "search" | "detail" | "play";
  /** 后台抓包时按 URL 特征自动猜的 role, 仅供 UI 显示 badge, 用户可覆盖 */
  roleGuess?: "home" | "category" | "search" | "detail" | "play";
}

/** 详情页学习的成果 */
export interface DetailSpec {
  detailURL?: string; // 用户当前所在的详情页 URL（用于回溯规则）
  titleSelector?: string;
  picSelector?: string;
  descSelector?: string;
  playTabSelector?: string;
  playListSelector?: string;
  playItemSelector?: string;
}

/** 首页/分类导航学习的成果 */
export interface HomeSpec {
  categories?: { name: string; url: string }[]; // 识别到的分类
  searchAction?: string; // 搜索 form 的 action URL 模板
  searchParam?: string; // 搜索关键词参数名
  categoryURLPattern?: string; // 如 "/vodtype/{class}-{page}.html"
}

/** 一次源生成项目的完整状态，跨 tab 跨 popup 保持 */
export interface ProjectState {
  site?: SiteInfo;
  baseInfo?: BaseInfo;
  listSelector?: string;
  listItemTag?: string;
  listSamples?: SerializedSample[];
  listMeta?: { childCount: number; similarity: number };
  detail?: DetailSpec;
  home?: HomeSpec;
  capturedMedia?: CapturedMedia[];
  gistURL?: string;
  updatedAt?: number;
}
