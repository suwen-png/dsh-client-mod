#!/usr/bin/env node
/**
 * lint-platform-stub.mjs — 「平台模块桩只能有一份」守护闸门
 *
 * 由来（2026-09-13）：同一个坑同一天踩了**两次**。
 *   产物里有 `class SafeLayer extends react.Component`（单层错误边界）。
 *   `verify-bundle.mjs` 与 `verify-install.mjs` **各写了一份**极简 react 桩：
 *   两份都缺 `Component` ⇒ `react.Component === undefined` ⇒ factory 抛
 *   `Class extends value undefined is not a constructor or null`
 *   ⇒ 其后几十项断言**全部级联失败**，报告读起来像「插件整个坏了」。
 *   2026-09-12 只修了 verify-bundle（改为 import 共享桩），当轮 verify-install
 *   **漏修**，于是同日第二次踩中。真机一直是正常的。
 *
 * 判据：
 *   L1 共享桩 `_platform-stub-impl.mjs` 的必备导出齐全（尤其 Component）
 *   L2 `scripts/*.mjs` 中**零内联 react 桩**（唯一真相源 `_platform-modules.mjs`）
 *   L2b 两个消费者确实 import 了共享桩表
 *   L3 桩表 key 集合 == 官方 `getStaticModules()` 的 10 项
 *   L4 解析钩子 `_platform-stub.mjs` 的 PLATFORM 集合与桩表互相覆盖（防两处漂移）
 *   L5 自检校准（正负对照）：检测器能判出坏样本、不误判好样本
 *
 * 用法：node scripts/lint-platform-stub.mjs
 * 退出码：0 = 全通过；1 = 存在失败项
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as stub from "./_platform-stub-impl.mjs";
import { platformStub } from "./_platform-modules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0; const fails = [];
function C(label, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + label + (detail ? " · " + detail : "")); }
	else { fails.push(label + (detail ? " · " + detail : "")); console.log("  ❌ " + label + (detail ? " · " + detail : "")); }
}

// ── L1 共享桩必备导出 ──
console.log("【L1 共享桩必备导出】");
const REQ = ["Fragment", "Component", "PureComponent", "createElement", "jsx", "jsxs",
	"createRoot", "hydrateRoot", "useState", "useEffect", "useRef", "useMemo",
	"useCallback", "useSyncExternalStore", "memo", "forwardRef"];
const missEx = REQ.filter((k) => stub[k] === undefined);
C("L1 共享桩导出 " + REQ.length + " 项齐全", missEx.length === 0,
	missEx.length ? "缺: " + missEx.join(", ") : "含 Component / PureComponent");

// ── L2 零内联 react 桩 ──
console.log("\n【L2 零内联 react 桩】");
// 坏形态 = react 键直接跟对象字面量（不写出该形态本身，否则本文件会被自己命中）
// 好形态 = 该键引用共享桩（reactStub），不是字面量
const BAD = /["']react["']\s*:\s*\{/;
const ALLOW = new Set(["_platform-modules.mjs"]);
const files = readdirSync(HERE).filter((n) => n.endsWith(".mjs")).sort();
const offenders = [];
for (const f of files) {
	if (ALLOW.has(f)) continue;
	if (BAD.test(readFileSync(join(HERE, f), "utf8"))) offenders.push(f);
}
C("L2 scripts/ 下零内联 react 桩", offenders.length === 0,
	offenders.length ? "命中: " + offenders.join(", ") : `已扫 ${files.length} 个脚本`);

console.log("\n【L2b 消费者引用共享桩】");
for (const f of ["verify-bundle.mjs", "verify-install.mjs"]) {
	const src = readFileSync(join(HERE, f), "utf8");
	C("L2b " + f + " 引用 _platform-modules.mjs", src.includes("_platform-modules.mjs"), "");
}

// ── L3 桩表 key == 官方 10 项 ──
console.log("\n【L3 桩表对齐官方 getStaticModules()】");
const EXPECT = ["react", "react/jsx-runtime", "react-dom", "react-dom/client",
	"@deepseek-ai/cordis", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-web-react",
	"@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-attachment",
	"@deepseek-ai/dsh-client-schema-form"];
const got = Object.keys(platformStub);
const setEq = got.length === EXPECT.length && EXPECT.every((k) => got.includes(k));
C("L3 桩表恰好 " + EXPECT.length + " 项且逐项相符", setEq,
	setEq ? got.length + " 项" : `多: [${got.filter((k) => !EXPECT.includes(k)).join(", ")}] 少: [${EXPECT.filter((k) => !got.includes(k)).join(", ")}]`);

// ── L4 解析钩子与桩表互覆盖 ──
console.log("\n【L4 解析钩子 ↔ 桩表 互覆盖】");
const hookSrc = readFileSync(join(HERE, "_platform-stub.mjs"), "utf8");
const m = hookSrc.match(/new Set\(\[([^\]]*)\]\)/);
const hookKeys = m ? m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
const hookMiss = hookKeys.filter((k) => !(k in platformStub));
C("L4 解析钩子 PLATFORM 全在桩表内", hookMiss.length === 0,
	hookKeys.length ? hookKeys.join(" / ") : "⚠️ 未解析到 PLATFORM 集合");
const REACT_FAMILY = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];
const famMiss = REACT_FAMILY.filter((k) => !hookKeys.includes(k));
C("L4b react 系列四项都在解析钩子内", famMiss.length === 0, famMiss.length ? "缺: " + famMiss.join(", ") : REACT_FAMILY.length + " 项");

// ── L5 自检校准（正负对照）──
console.log("\n【L5 自检校准】");
/* 🔴 判据污染防护（2026-09-13 首跑即踩，第二次）：坏样本若以**完整字面量**写在源码里
 *   （**包括写在注释里**），本脚本自己就会被 L2 命中 ——
 *   首跑报「命中 lint-platform-stub.mjs」，我改了一次样本、仍报，因为**注释里**还留着
 *   那个连续形态。故这里只说"react 键直接跟对象字面量"这一形态，不写出该形态本身；
 *   样本用拼接构造。
 *   （同类：V15.1 的判据污染 —— 审核表里引用的旧代码文本污染卫生判据，
 *    那次的处置是**校验前剥离 `<code>`**。） */
const BAD_SAMPLE = 'const p = { "' + "react" + '": { useCallback: () => {} } };';
const GOOD_SAMPLE = 'import { platformStub } from "./_platform-modules.mjs";';
C("L5a 检测器能判出坏样本（内联 react 桩）", BAD.test(BAD_SAMPLE), "坏样本命中");
C("L5b 检测器不误判好样本（引用共享桩）", !BAD.test(GOOD_SAMPLE), "好样本放行");

// ── 汇总 ──
const total = pass + fails.length;
console.log("\n" + "─".repeat(64));
console.log("PASS " + pass + " / FAIL " + fails.length + " / 总计 " + total);
if (fails.length) { console.log("失败明细："); for (const f of fails) console.log("  · " + f); }
console.log("IS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE"));
process.exit(fails.length === 0 ? 0 : 1);
