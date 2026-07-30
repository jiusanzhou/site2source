/**
 * 单元测试: analyzeM3U8 对各种 m3u8 内容的识别
 */

import { analyzeM3U8, isPlayable } from "../lib/m3u8-probe";

const cases: Array<{ name: string; content: string; expectEnc: string }> = [
  {
    name: "无加密 · 直接 EXTINF",
    content: `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXTINF:5.0,
seg-001.ts
#EXTINF:5.0,
seg-002.ts
#EXT-X-ENDLIST`,
    expectEnc: "none",
  },
  {
    name: "AES-128 加密",
    content: `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key.bin",IV=0x1234
#EXTINF:5.0,
seg-001.ts
#EXTINF:5.0,
seg-002.ts`,
    expectEnc: "aes-128",
  },
  {
    name: "SAMPLE-AES DRM",
    content: `#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm.example.com/key",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:5.0,
seg.ts`,
    expectEnc: "sample-aes",
  },
  {
    name: "Widevine 引用",
    content: `#EXTM3U
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",URI="data:text/plain;base64,widevineData"
#EXT-X-STREAM-INF:BANDWIDTH=1000000
stream.m3u8`,
    expectEnc: "widevine",
  },
  {
    name: "Master playlist (无加密)",
    content: `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
360p.m3u8`,
    expectEnc: "none",
  },
  {
    name: "自定义加密 (segment 命名异常)",
    content: `#EXTM3U
#EXTINF:5.0,
enc-a3f2e4.ts
#EXTINF:5.0,
enc-b8c1d5.ts`,
    expectEnc: "custom",
  },
  {
    name: "EXT-X-KEY:METHOD=NONE",
    content: `#EXTM3U
#EXT-X-KEY:METHOD=NONE
#EXTINF:5.0,
seg.ts`,
    expectEnc: "none",
  },
];

console.log("=== analyzeM3U8 测试 ===\n");
let pass = 0, fail = 0;
for (const c of cases) {
  const r = analyzeM3U8(c.content);
  const ok = r.encryption === c.expectEnc;
  const status = ok ? "✅" : "❌";
  console.log(`${status} ${c.name}`);
  console.log(`   期望: ${c.expectEnc}, 实际: ${r.encryption}${r.keyURI ? ` (key: ${r.keyURI.slice(0,60)})` : ""}`);
  console.log(`   segs=${r.segmentCount} master=${r.isMaster} playable=${isPlayable(r.encryption).playable}`);
  if (ok) pass++; else fail++;
}
console.log(`\n结果: ${pass}/${cases.length} 通过`);
if (fail > 0) process.exit(1);
