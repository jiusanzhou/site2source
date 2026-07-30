/**
 * 消息类型定义 —— background / content / popup 之间通信
 */

// ==================== 消息 ====================

export type Message =
  // 列表页交互
  | { type: "GET_CANDIDATES" }
  | { type: "HIGHLIGHT_ELEMENT"; selector: string }
  | { type: "STOP_INSPECT" }
  // 手动点选模式（用户 hover 页面 → 点击选中）
  | { type: "START_PICK"; role: PickRole }
  | { type: "STOP_PICK" }
  | { type: "PICK_RESULT"; role: PickRole; selector: string; sample?: string }
  // 详情页学习
  | { type: "START_DETAIL_LEARN" }
  | { type: "GET_DETAIL_INFO" }
  // 抓取的媒体
  | { type: "GET_CAPTURED_MEDIA" }
  | { type: "CLEAR_CAPTURED_MEDIA" }
  // 状态持久化
  | { type: "SAVE_STATE"; state: Partial<ProjectState> }
  | { type: "GET_STATE" }
  | { type: "RESET_STATE" };

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
  baseURL: string; // scheme://host
  siteName: string;
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
}

/** 详情页学习的成果 */
export interface DetailSpec {
  detailURL?: string; // 用户当前所在的详情页 URL（用于回溯规则）
  titleSelector?: string;
  descSelector?: string;
  playTabSelector?: string;
  playListSelector?: string;
  playItemSelector?: string;
}

/** 一次源生成项目的完整状态，跨 tab 跨 popup 保持 */
export interface ProjectState {
  site?: SiteInfo;
  listSelector?: string;
  listItemTag?: string;
  listSamples?: SerializedSample[];
  listMeta?: { childCount: number; similarity: number };
  detail?: DetailSpec;
  capturedMedia?: CapturedMedia[]; // aggregated from background per-tab
}
