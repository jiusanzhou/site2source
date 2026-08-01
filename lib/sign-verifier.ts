/**
 * 签名验证器 — 用抓包样本校验签名公式的通过率
 *
 * ## 为什么这是核心
 * 逆签名时最容易出的错，不是"算法错"，是"参数错"：
 * - 密钥表少了一半（aiyifan 的 8 → 4 坑）
 * - 索引公式写反（% length 忘了）
 * - 大小写不一致（query vs query.toLowerCase）
 * - 字段类型（Number/String）
 *
 * 错误后果：
 * - 一半请求签对，一半签错 → 服务端返"签名错误" → 误以为"某些端点特殊"
 *
 * 验证器做的事：
 * 1. 抓 10-20 组真实 (url, query, vv, pub) 样本
 * 2. 用你猜的公式算一遍
 * 3. 报告通过率 + 失败样本的关键特征
 * 4. 帮你定位 bug（哪些 pub % N 值都失败 → 密钥表缺）
 */

import crypto from "crypto";
import type { SignMode, SignAlgorithm, SignVarSource } from "./site-model";

// ============ 类型 ============

/** 一组签名样本（从浏览器/CDP 抓来的真实请求）*/
export interface SignSample {
  /** 原始 URL（带 vv 和 pub）*/
  url: string;
  /** query 字符串（不含 vv/pub），如 "cinema=1&id=xxx&region=SG" */
  query: string;
  /** 实际 vv（32 hex）*/
  expected_sign: string;
  /** 实际 pub 值（字符串）*/
  expected_pub: string;
  /** bootstrap 上下文（可选）：cert 模式需要提前拿到的字段 */
  bootstrap?: Record<string, any>;
}

/** 校验结果 */
export interface VerifyResult {
  mode_name: string;
  total: number;
  passed: number;
  pass_rate: number;
  /** 通过的样本（用于确认稳定性）*/
  passes: SignSample[];
  /** 失败的样本 + 我们算出的值 */
  failures: {
    sample: SignSample;
    got_sign: string;
    computed_pub: string;
  }[];
  /** 诊断提示 — 失败样本的关键特征 */
  diagnostics: string[];
}

// ============ 核心 ============

/** 用一个 SignMode 校验一组样本 */
export function verifySignMode(mode: SignMode, samples: SignSample[]): VerifyResult {
  const passes: SignSample[] = [];
  const failures: VerifyResult["failures"] = [];

  for (const s of samples) {
    try {
      const computed = computeSignForSample(mode, s);
      if (computed.sign === s.expected_sign) {
        passes.push(s);
      } else {
        failures.push({ sample: s, got_sign: computed.sign, computed_pub: computed.pub });
      }
    } catch (e: any) {
      failures.push({ sample: s, got_sign: "ERROR: " + e.message, computed_pub: "" });
    }
  }

  return {
    mode_name: mode.name,
    total: samples.length,
    passed: passes.length,
    pass_rate: samples.length ? passes.length / samples.length : 0,
    passes,
    failures,
    diagnostics: diagnose(mode, passes, failures),
  };
}

/** 用给定 mode 为一个样本算签名（模拟运行）*/
function computeSignForSample(
  mode: SignMode,
  sample: SignSample,
): { sign: string; pub: string; formula_input: string } {
  // 1. 解析每个 var 的值
  const vals: Record<string, string> = {};

  for (const [key, src] of Object.entries(mode.vars)) {
    vals[key] = resolveVar(src, sample, vals);
  }

  // 2. 用 formula 模板拼字符串
  const formulaInput = mode.formula.replace(/\{(\w+)\}/g, (_, k) => {
    if (vals[k] === undefined) throw new Error(`formula var "${k}" 未定义`);
    return vals[k];
  });

  // 3. 用算法算
  const sign = applyAlgorithm(mode.algorithm, formulaInput, mode.hmac_key ? renderTemplate(mode.hmac_key, vals) : undefined);

  return { sign, pub: vals.pub || "", formula_input: formulaInput };
}

/** 解析单个 SignVarSource → 字符串值
 *
 * 对验证场景，有些 var 需要"逆推"：
 * - kind:timestamp / random: **从 sample.expected_pub 反向注入**（因为要复现签名）
 * - kind:key_table: 用 sample.expected_pub 算索引
 * - kind:bootstrap: 从 sample.bootstrap 里取
 * - kind:literal: 字面量
 * - kind:query_lower: sample.query.toLowerCase()
 */
function resolveVar(src: SignVarSource, sample: SignSample, resolved: Record<string, string>): string {
  switch (src.kind) {
    case "literal":
      return src.value;
    case "timestamp":
      // 验证时用 sample.expected_pub（我们不能真调 Date.now, 那样每次都不同）
      return sample.expected_pub;
    case "random":
      // 随机值我们也用 expected_pub 反推
      return sample.expected_pub;
    case "bootstrap":
      if (!sample.bootstrap) throw new Error(`kind:bootstrap 需要 sample.bootstrap`);
      return jsonPath(sample.bootstrap, src.path);
    case "key_table": {
      // 索引表达式可能用到已解析的 var（如 pub）
      // 用 Function 沙盒执行 —— 只暴露必要变量
      const pub = resolved.pub || sample.expected_pub;
      // eslint-disable-next-line no-new-func
      const idx = new Function("pub", `return (${src.index});`)(pub);
      const clamped = Math.abs(Number(idx)) % src.table.length;
      return src.table[clamped];
    }
    case "query_lower":
      return sample.query.toLowerCase();
    default:
      throw new Error(`未知 SignVarSource kind: ${(src as any).kind}`);
  }
}

/** 简易 JSONPath: "info[0].pConfig.publicKey" */
function jsonPath(obj: any, path: string): string {
  const parts = path.split(/[.\[\]]+/).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return "";
    const idx = Number(p);
    cur = Number.isFinite(idx) ? cur[idx] : cur[p];
  }
  return cur == null ? "" : String(cur);
}

/** 模板字符串（用 vals 替换 {var}）*/
function renderTemplate(tpl: string, vals: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? "");
}

/** 应用 hash 算法 */
function applyAlgorithm(alg: SignAlgorithm, input: string, hmacKey?: string): string {
  switch (alg) {
    case "md5":
      return crypto.createHash("md5").update(input, "utf8").digest("hex");
    case "sha1":
      return crypto.createHash("sha1").update(input, "utf8").digest("hex");
    case "sha256":
      return crypto.createHash("sha256").update(input, "utf8").digest("hex");
    case "hmac-sha256":
      if (!hmacKey) throw new Error("hmac-sha256 需要 hmac_key");
      return crypto.createHmac("sha256", hmacKey).update(input, "utf8").digest("hex");
    case "none":
      return input;
  }
}

// ============ 诊断 ============

/**
 * 分析失败样本的规律，给出人可读的诊断
 * 这是验证器的"智能"部分 —— 帮你找 aiyifan 那种"密钥表少一半"的 bug
 */
function diagnose(mode: SignMode, passes: SignSample[], failures: VerifyResult["failures"]): string[] {
  const notes: string[] = [];

  if (failures.length === 0) {
    notes.push(`✅ 全部 ${passes.length} 个样本通过`);
    return notes;
  }

  if (passes.length === 0) {
    notes.push(`❌ 全部失败 — 算法或参数完全错了。检查 formula / algorithm / 密钥表`);
    return notes;
  }

  // 发现关键场景：部分通过部分失败 —— 通常意味着密钥表不全 or 索引式错
  const rate = passes.length / (passes.length + failures.length);
  notes.push(`⚠️  ${passes.length}/${passes.length + failures.length} 通过（${(rate * 100).toFixed(0)}%）— 部分通过通常意味着"表不全"或"索引错"`);

  // 查所有用了 key_table 的 var
  const keyTableVars = Object.entries(mode.vars).filter(([, src]) => src.kind === "key_table") as [
    string,
    Extract<SignVarSource, { kind: "key_table" }>,
  ][];

  for (const [varName, src] of keyTableVars) {
    const tableLen = src.table.length;
    // 计算通过样本 vs 失败样本的索引分布
    const passIndices = new Set<number>();
    const failIndices = new Set<number>();

    for (const s of passes) {
      try {
        const pub = Number(s.expected_pub);
        // eslint-disable-next-line no-new-func
        const idx = Math.abs(Number(new Function("pub", `return (${src.index});`)(pub))) % tableLen;
        passIndices.add(idx);
      } catch {}
    }
    for (const f of failures) {
      try {
        const pub = Number(f.sample.expected_pub);
        // eslint-disable-next-line no-new-func
        const idx = Math.abs(Number(new Function("pub", `return (${src.index});`)(pub))) % tableLen;
        failIndices.add(idx);
      } catch {}
    }

    notes.push(
      `📊 密钥表 "${varName}"(size=${tableLen}): 通过索引={${[...passIndices].sort().join(",")}}, 失败索引={${[...failIndices].sort().join(",")}}`,
    );

    // === 场景 1: 表可能只有真实表的一半 ===
    // 判据：通过 + 失败样本的索引大量重叠，且失败率接近 50%
    // 因为 pub 每次不同 → 我们的表算出的索引在 [0, tableLen)，但真实表若是 2N 长度，
    // 每个 pub 对应的"真索引"落在 [0, tableLen) 只有一半概率，此时我们算出的密钥恰好对上。
    const overlapCount = [...passIndices].filter((i) => failIndices.has(i)).length;
    const overlapRatio = passIndices.size ? overlapCount / passIndices.size : 0;
    const failRate = failures.length / (passes.length + failures.length);
    if (overlapRatio > 0.6 && failRate > 0.3 && failRate < 0.7) {
      notes.push(
        `💡 提示: 每个索引位置都有通过也有失败（重叠率 ${(overlapRatio * 100).toFixed(0)}%，失败率 ${(failRate * 100).toFixed(0)}%）— **密钥表长度可能是真实值的一半**！去 bundle 再 grep 密钥常量，看看有没有形近字符（e→c, i→1, o→0, n→_）的兄弟`,
      );
    }

    // === 场景 2: 索引公式的模数写错（例如真实 % 8 写成 % 3）===
    // 判据：通过样本索引集合明显小于表长
    if (passes.length > 0 && passIndices.size > 0 && passIndices.size < tableLen / 2) {
      const passArr = [...passIndices].sort((a, b) => a - b);
      const maxPass = passArr[passArr.length - 1];
      if (maxPass < tableLen - 1) {
        notes.push(
          `💡 提示: 通过索引只覆盖 [${passArr.join(",")}]，但密钥表有 ${tableLen} 项 — 索引公式的模数可能小于表长（如 "% ${maxPass + 1}" 应该是 "% ${tableLen}"）`,
        );
      }
    }

    // === 场景 3: 特定索引密钥值错 ===
    if (failIndices.size === 1 && passIndices.size > 0 && !passIndices.has([...failIndices][0])) {
      const badIdx = [...failIndices][0];
      notes.push(`💡 提示: 所有失败样本索引都是 ${badIdx} — 密钥表 [${badIdx}] 位置的值 "${src.table[badIdx]}" 可能错了`);
    }
  }

  // pub 长度分析（长 pub → cert 模式；短 pub → timestamp）
  const failPubLens = failures.map((f) => f.sample.expected_pub.length);
  const passPubLens = passes.map((s) => s.expected_pub.length);
  const failAvg = avg(failPubLens);
  const passAvg = avg(passPubLens);
  if (Math.abs(failAvg - passAvg) > 20) {
    notes.push(
      `💡 提示: 失败样本的 pub 长度平均 ${failAvg.toFixed(0)}, 通过样本 ${passAvg.toFixed(0)} — 可能是两种签名模式混用，需要拆成两个 SignMode`,
    );
  }

  return notes;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// ============ 导出便利函数 ============

/** 一次校验多个 mode，返回最佳匹配 */
export function verifyAll(modes: SignMode[], samples: SignSample[]): VerifyResult[] {
  return modes.map((m) => verifySignMode(m, samples));
}

/** 把 URL 拆成 { query, vv, pub } */
export function parseSampleFromUrl(url: string, vvKey = "vv", pubKey = "pub"): SignSample | null {
  const q = url.indexOf("?");
  if (q < 0) return null;
  const qs = url.slice(q + 1);
  const params = new Map<string, string>();
  for (const pair of qs.split("&")) {
    const [k, v = ""] = pair.split("=");
    params.set(k, decodeURIComponent(v));
  }
  const vv = params.get(vvKey);
  const pub = params.get(pubKey);
  if (!vv || !pub) return null;
  params.delete(vvKey);
  params.delete(pubKey);
  const query = [...params].map(([k, v]) => `${k}=${v}`).join("&");
  return { url, query, expected_sign: vv, expected_pub: pub };
}
