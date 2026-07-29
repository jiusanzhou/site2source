/**
 * 消息类型定义 —— background / content / popup 之间通信
 */

export type Message =
  | { type: "START_INSPECT" }
  | { type: "STOP_INSPECT" }
  | { type: "GET_CANDIDATES" }
  | { type: "SELECT_LIST"; selector: string }
  | { type: "HIGHLIGHT_ELEMENT"; selector: string }
  | { type: "CAPTURE_MEDIA_START" }
  | { type: "CAPTURE_MEDIA_STOP" }
  | { type: "GET_CAPTURED_MEDIA" }
  | { type: "GENERATE" };

export interface AnalysisState {
  url: string;
  host: string;
  siteName: string;
  candidates: SerializedCandidate[]; // top 5
  selectedIndex: number | null;
  capturedMedia: CapturedMedia[];
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
  sourceTabURL: string;
}
