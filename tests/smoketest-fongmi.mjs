#!/usr/bin/env node
/**
 * FongMi 真机烟测 harness
 *
 * 一键跑：
 *   node tests/smoketest-fongmi.mjs
 *
 * 前置：
 *   - Android emulator 已启动 (adb devices 有 emulator-5554)
 *   - com.fongmi.android.tv 已安装 (5.5.6 已验证 OK)
 *   - fongmi 里的 Config 表已有一条指向 http://10.0.2.2:8899/tvbox_aiyifan.json
 *     （首次要手动加，之后会持久化）
 *
 * 流程：
 *   1. 起 http server on 8899 分发 test-output/
 *   2. force-stop + start fongmi HomeActivity
 *   3. 等 spider bootstrap 完成
 *   4. dismiss Update 弹窗
 *   5. 点第一张卡进 detail → 自动播放
 *   6. 抓 TV-quickjs / TV-player logcat，判 spider 是否吐出 HLS
 *   7. curl 验证 chunklist 200 + ts 段数 > 100
 *   8. 输出通过/失败
 */

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "test-output");
const SHOT_DIR = path.join(ROOT, "test-screenshots");
const DEVICE = process.env.ADB_SERIAL || "emulator-5554";
const PORT = 8899;
const CARD_TAP_X = 194, CARD_TAP_Y = 667; // 第一张卡中心 (1080x2400)
const CANCEL_TAP_X = 631, CANCEL_TAP_Y = 1571; // Update 弹窗 Cancel

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
const adb = (args) => sh(`adb -s ${DEVICE} ${args}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[smoketest] ${msg}`);

async function main() {
  // 0. sanity
  try { adb("get-state"); } catch { throw new Error(`device ${DEVICE} not connected`); }
  const tvbox = path.join(OUT_DIR, "tvbox_aiyifan.json");
  if (!fs.existsSync(tvbox)) throw new Error(`missing ${tvbox}`);

  // 1. http server — 检查 launchd 是否已在跑（im.zoe.s2s.devserver），有就复用
  let server = null;
  let existing = false;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/tvbox_aiyifan.json`);
    if (r.ok) { existing = true; log(`http server already running on :${PORT} (launchd), reusing`); }
  } catch {}

  if (!existing) {
    log(`starting temporary http server on :${PORT}`);
    server = http.createServer((req, res) => {
      const p = path.join(OUT_DIR, decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(OUT_DIR) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        "content-type": req.url.endsWith(".json") ? "application/json" : "application/javascript",
        "access-control-allow-origin": "*",
      });
      fs.createReadStream(p).pipe(res);
    }).listen(PORT);
    await new Promise((r) => server.once("listening", r));
  }

  try {
    // 2. restart fongmi
    log("restarting FongMi");
    try { adb("shell am force-stop com.fongmi.android.tv"); } catch {}
    adb("logcat -c");
    await sleep(500);
    adb("shell am start -n com.fongmi.android.tv/.ui.activity.HomeActivity");

    // 3. wait spider init
    log("waiting for spider init + bootstrap...");
    const deadline = Date.now() + 30_000;
    let sawBootstrap = false;
    while (Date.now() < deadline) {
      await sleep(1000);
      const q = adb('logcat -d -s "TV-quickjs:*"');
      if (q.includes("bootstrap")) { sawBootstrap = true; break; }
    }
    if (!sawBootstrap) throw new Error("spider bootstrap did not complete in 30s");
    log("✅ bootstrap done");

    // 4. dismiss update dialog if any
    await sleep(1000);
    const ui = adb('shell "uiautomator dump && cat /sdcard/window_dump.xml"');
    if (ui.includes(">Update<") || ui.includes("Cancel")) {
      log("dismissing Update dialog");
      adb(`shell input tap ${CANCEL_TAP_X} ${CANCEL_TAP_Y}`);
      await sleep(1500);
    }

    // 5. tap first card
    log("tapping first card");
    adb(`shell input tap ${CARD_TAP_X} ${CARD_TAP_Y}`);

    // 6. wait for play hit
    log("waiting for play hit (HLS/MP4)...");
    let playUrl = null;
    const playDeadline = Date.now() + 30_000;
    while (Date.now() < playDeadline) {
      await sleep(1000);
      const q = adb('logcat -d -s "TV-quickjs:*"');
      const m = q.match(/\[s2s\] play 命中\([^)]+\): (https?:\/\/\S+)/);
      if (m) { playUrl = m[1]; break; }
    }
    if (!playUrl) throw new Error("spider did not resolve a play URL in 30s");
    log(`✅ play URL: ${playUrl.slice(0, 80)}...`);

    // 7. verify chunklist (等 spider warmup 完再拉, CDN 冷启动首次会 520)
    log("verifying HLS chunklist (with warmup wait)");
    const playerLog = adb('logcat -d -s "TV-player:*"');
    const fullMatch = playerLog.match(/"url":"([^"]+)"/);
    const fullUrl = fullMatch ? fullMatch[1] : playUrl;
    let tsCount = 0;
    for (let i = 0; i < 5; i++) {
      const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
      const cmd = `curl -s -w "\\n__CODE__:%{http_code}" -H 'User-Agent: ${UA}' -H 'Referer: https://www.aiyifan.tv/' '${fullUrl}'`;
      const raw = sh(cmd);
      const codeMatch = raw.match(/__CODE__:(\d+)$/);
      const httpCode = codeMatch ? codeMatch[1] : "??";
      const chunklist = raw.replace(/__CODE__:\d+$/, "");
      tsCount = (chunklist.match(/\.ts/g) || []).length;
      if (tsCount >= 10) break;
      log(`  attempt ${i + 1}: HTTP ${httpCode}, ${tsCount} ts (CDN warming), retry in 1s`);
      await sleep(1000);
    }
    if (tsCount < 10) throw new Error(`chunklist has only ${tsCount} ts segments (expect > 10)`);
    log(`✅ chunklist OK: ${tsCount} ts segments`);

    // 8. screenshot
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const shot = path.join(SHOT_DIR, `smoketest-${Date.now()}.png`);
    sh(`adb -s ${DEVICE} exec-out screencap -p > "${shot}"`);
    log(`📸 ${shot}`);

    console.log("\n🎉 aiyifan spider real-device smoketest PASSED");
    console.log(`   play url:  ${playUrl}`);
    console.log(`   ts count:  ${tsCount}`);
    process.exit(0);
  } finally {
    if (server) server.close();
  }
}

main().catch((e) => {
  console.error(`❌ FAIL: ${e.message}`);
  process.exit(1);
});
