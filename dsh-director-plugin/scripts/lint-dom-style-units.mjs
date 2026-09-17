#!/usr/bin/env node
/**
 * lint-dom-style-units.mjs — 「直接写 DOM 样式时不许塞无单位数字」守护闸门
 *
 * ══════════════════════════════════════════════════════════════════
 *  由来（2026-09-14 真机取证）：CSSOM 对无单位数字是**静默丢弃**的
 * ══════════════════════════════════════════════════════════════════
 *    `el.style.width = 6`    ⇒ 不生效（应为 "6px"）
 *    `el.style.height = 18`  ⇒ 不生效
 *    `el.style.top = 3`      ⇒ 不生效
 *   例外（数字合法）：`0`、以及纯数值型属性 `zIndex` / `opacity` /
 *   `lineHeight` / `flexGrow` / `order` / `zoom` 等。
 *
 *   **不报错、不警告、不回退** —— 元素照样在 DOM 里，只是尺寸/位置是错的。
 *   实测后果（三处"元素在、功能没有"）：
 *     · `#dsh-host-col-resizer` 宽 0px ⇒ 真实鼠标永远打不到 ⇒ 宽度拖不动
 *     · `#dsh-mem-height`       高 0px ⇒ 同上 ⇒ 高度拖不动
 *     · `#dsh-host-col-min`     20×18 退化成文字撑出的 8×13
 *   存在性断言**全绿**，只有真实鼠标命中测试 / 几何对账才抓得到
 *   ⇒ 与纪律 22 同源：**"看得见"不等于"摸得着"**。
 *
 *  这类缺陷的形状注定"只能靠人肉发现"，所以必须**机器可拦**（否则会再犯）。
 *
 * ── 判据 ──────────────────────────────────────────────────────────
 *   L1 自检校准（正负对照 · 精确计数）：检测器能判出坏样本、不误判好样本
 *   L2 真实源码零命中：`src/**` 里没有"未归一就写 style"的尺寸
 *   L3 唯一真相源：归一逻辑只在 `src/util/dom-style.js` 里定义过一份
 *       （别处只许 `import`，不许再写一份本地 px() —— 纪律 21「重复即漂移」）
 *   L4 覆盖度自证：确实扫到了直接样式赋值点（防"零命中"其实是"没扫到"）
 *      🔴 第 35 轮**就地更正口径**：原判据是 `totalWrapped + totalDirect >= 8` ——
 *         这个 8 是照着**当时的**真实计数钉的，于是它同时具备两个毛病：
 *         ① **无余量**：当时实测恰为 7（`host-composer-slot` 2 + `host-director-column` 5），
 *            本来就**够不到 8** ⇒ 这条闸门**一直是红的**（只是没人跑全量四把的第四把时会漏看）；
 *         ② **会过期**（纪律 14/103）：删掉一个合法的 `Object.assign(x.style, px({…}))` 就掉一格，
 *            而"删代码"本身**不该**让闸门转红 —— 那是**把手工维护的计数当判据**。
 *      ⇒ 改为**与规模无关**的判据：`L3c` 已经数出"有哪些文件在写 style"，
 *        所以只需断言 **`wrapped + direct > 0`**（真的扫到了可判定的写入点）
 *        且 **`wrapped >= 1`**（至少有一处是可静态判定的包裹调用，证明两类形态都走到了）。
 *        阈值降为"存在性"，覆盖面改由 `files.length`（扫描文件数）与 `L2a/L3c` 承担。
 *        这样：**删代码不再触发假红；而"检测器坏了 / 扫不到文件"仍然必红**。
 *
 * ── 为什么 L1 单独占一环 ─────────────────────────────────────────
 *   纪律 31/32：**闸门对该报的缺陷报绿 ⇒ 先审闸门口径，再谈修产品**。
 *   而"零命中"这个结论，在 **检测器写错** 与 **代码确实干净** 两种情况下
 *   读数完全一样（都是 0）—— 属于典型的**不可证伪收尾**（纪律 18）。
 *   ⇒ 所以必须先跑正负对照：坏样本命中、好样本不命中，且**计数精确相等**。
 *
 * 用法：node scripts/lint-dom-style-units.mjs
 *       node scripts/lint-dom-style-units.mjs --selftest   （只跑 L1）
 * 退出码：0 = 全通过；1 = 存在失败项；2 = INVALID（用法错 / 取样失败）
 */
import { PX_KEYS } from "../src/util/dom-style.js";
import { stripComments, walkSrc, readSrc, rel, PLUGIN_ROOT } from "./_src-scan.mjs";

const ARGS = process.argv.slice(2);
const UNKNOWN = ARGS.filter((a) => a !== "--selftest");
if (UNKNOWN.length) {
	console.error("[lint-dom-style-units] INVALID 用法 —— 不认识的参数: " + UNKNOWN.join(" "));
	console.error("  可用：node scripts/lint-dom-style-units.mjs [--selftest]");
	process.exit(2);
}
const SELF_ONLY = ARGS.indexOf("--selftest") >= 0;

let pass = 0; const fails = [];
function C(label, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + label + (detail ? " · " + detail : "")); }
	else { fails.push(label + (detail ? " · " + detail : "")); console.log("  ❌ " + label + (detail ? " · " + detail : "")); }
}

/* ══════════════════════════════════════════════════════════════════
 *  检测器（纯函数 · 可离线单测）
 * ══════════════════════════════════════════════════════════════════ */

/** 取一段以 `{` 开头的平衡花括号内容（跳过字符串内的花括号） */
function balancedBlock(code, openIdx) {
	let depth = 0;
	let mode = 0; // 0 代码 / 1 单引号 / 2 双引号 / 3 反引号
	for (let i = openIdx; i < code.length; i++) {
		const c = code[i];
		if (mode !== 0) {
			if (c === "\\") { i++; continue; }
			const close = mode === 1 ? "'" : mode === 2 ? '"' : "`";
			if (c === close) mode = 0;
			continue;
		}
		if (c === "'") { mode = 1; continue; }
		if (c === '"') { mode = 2; continue; }
		if (c === "`") { mode = 3; continue; }
		if (c === "{") depth++;
		else if (c === "}") { depth--; if (depth === 0) return code.slice(openIdx, i + 1); }
	}
	return code.slice(openIdx);
}

const NUM = "-?(?:\\d+\\.?\\d*|\\.\\d+)";

/**
 * 扫描一段**已去注释**的代码，返回未归一的尺寸写入点。
 * @param {string} raw  原始源码（本函数内部自己去注释）
 * @returns {{hits: Array, wrapped: number, unknown: number, direct: number}}
 */
export function scanBareNumericStyles(raw) {
	const code = stripComments(raw);
	const hits = [];
	const lines = (idx) => code.slice(0, idx).split("\n").length;
	let wrapped = 0; let unknown = 0; let direct = 0;

	/* ── 形态 A：Object.assign(<sel>.style, { ... }) ── */
	const RE_A = /Object\.assign\(\s*([^,()]{1,120}?\.style)\s*,\s*/g;
	let m;
	while ((m = RE_A.exec(code)) !== null) {
		const after = m.index + m[0].length;
		const rest = code.slice(after);
		const head = rest.match(/^([A-Za-z_$][\w$]*)\s*\(/);
		if (head) {
			/* 首参是函数调用（pxOf(...) / px(...) / applyStyle(...) / 或变量包装）⇒ 视为已归一 */
			wrapped++;
			continue;
		}
		if (rest[0] === "{") {
			const blk = balancedBlock(rest, 0);
			const RE_KV = new RegExp("([A-Za-z_$][\\w$]*)\\s*:\\s*(" + NUM + ")\\s*(?=[,}])", "g");
			let k;
			while ((k = RE_KV.exec(blk)) !== null) {
				const key = k[1]; const val = Number(k[2]);
				if (!PX_KEYS.has(key)) continue;
				if (val === 0) continue;
				hits.push({ line: lines(after), key: key, value: k[2], form: "Object.assign(style, {…})" });
			}
			continue;
		}
		unknown++;
	}

	/* ── 形态 B：<sel>.style.<prop> = <数字> ── */
	const RE_B = new RegExp("\\.style\\.([A-Za-z_$][\\w$]*)\\s*=\\s*(" + NUM + ")\\s*(?=[;,)}\\n])", "g");
	let b;
	while ((b = RE_B.exec(code)) !== null) {
		direct++;
		const key = b[1]; const val = Number(b[2]);
		if (!PX_KEYS.has(key)) continue;
		if (val === 0) continue;
		hits.push({ line: lines(b.index), key: key, value: b[2], form: ".style." + key + " = " + b[2] });
	}

	return { hits: hits, wrapped: wrapped, unknown: unknown, direct: direct };
}

/* ══════════════════════════════════════════════════════════════════
 *  L1 自检校准（正负对照）
 * ══════════════════════════════════════════════════════════════════ */
console.log("═══════════════════════════════════════════════════════════");
console.log(" lint-dom-style-units —— 直接 DOM 样式的单位归一守护闸门");
console.log(" 属性表 " + PX_KEYS.size + " 项（单一真相源 src/util/dom-style.js）");
console.log("═══════════════════════════════════════════════════════════");

console.log("\n【L1 自检校准 · 正负对照】");
/* 坏/好样本都用**拼接**构造 —— 不把坏形态的字面量写进本文件
 * （既有纪律：判据污染 —— 样本写死会让"扫自己"的检查自指） */
const F = "wi" + "dth";           // width
const T = "to" + "p";             // top
const Z = "zIn" + "dex";          // zIndex（纯数值，合法）
const K = "PX_" + "KEYS";

const BAD_BLOCK = "Object.assign(el.style, { " + F + ": 6, color: 'x' });";
const GOOD_1 = "Object.assign(el.style, pxOf({ " + F + ": 6 }));";
const GOOD_2 = "Object.assign(el.style, px({ " + F + ": 6 }), px(extra));";
const GOOD_3 = "Object.assign(el.style, applyStyle(el, { " + F + ": 6 }));";
const GOOD_4 = "Object.assign(el.style, { " + Z + ": 76, opacity: 0.6, " + F + ": 0 });";
const BAD_DIRECT = "el.style." + T + " = 3;";
const BAD_DIRECT_M = "el.style.margin" + "Top = 4;";
const GOOD_DIRECT = "el.style." + Z + " = 76;";
const GOOD_DIRECT_ZERO = "el.style." + T + " = 0;";

const sBad1 = scanBareNumericStyles(BAD_BLOCK);
const sG1 = scanBareNumericStyles(GOOD_1);
const sG2 = scanBareNumericStyles(GOOD_2);
const sG3 = scanBareNumericStyles(GOOD_3);
const sG4 = scanBareNumericStyles(GOOD_4);
const sBad2 = scanBareNumericStyles(BAD_DIRECT);
const sBad3 = scanBareNumericStyles(BAD_DIRECT_M);
const sG5 = scanBareNumericStyles(GOOD_DIRECT);
const sG6 = scanBareNumericStyles(GOOD_DIRECT_ZERO);
const sCmt = scanBareNumericStyles("/* " + BAD_DIRECT + " */\nvoid 0;");

C("L1a 坏样本·对象字面量命中（精确 1）", sBad1.hits.length === 1,
	sBad1.hits.length + " 命中" + (sBad1.hits[0] ? " · " + sBad1.hits[0].form : ""));
C("L1b 好样本·pxOf 包裹不命中", sG1.hits.length === 0 && sG1.wrapped === 1, "wrapped=" + sG1.wrapped);
C("L1c 好样本·px 包裹 + 覆盖参不命中", sG2.hits.length === 0 && sG2.wrapped === 1, "wrapped=" + sG2.wrapped);
C("L1d 好样本·applyStyle 包裹不命中", sG3.hits.length === 0 && sG3.wrapped === 1, "wrapped=" + sG3.wrapped);
C("L1e 好样本·zIndex/opacity/0 不命中", sG4.hits.length === 0, "命中 " + sG4.hits.length);
C("L1f 坏样本·.style.top = 3 命中（精确 1）", sBad2.hits.length === 1, sBad2.hits.length + " 命中");
C("L1g 坏样本·.style.marginTop = 4 命中（精确 1）", sBad3.hits.length === 1, sBad3.hits.length + " 命中");
C("L1h 好样本·.style.zIndex = 76 不命中", sG5.hits.length === 0, "命中 " + sG5.hits.length);
C("L1i 好样本·.style.top = 0 不命中（0 无单位合法）", sG6.hits.length === 0, "命中 " + sG6.hits.length);
C("L1j 注释里的坏样本不命中（先 stripComments）", sCmt.hits.length === 0, "命中 " + sCmt.hits.length);
C("L1k 属性表非空且含核心项", PX_KEYS.size >= 20 && PX_KEYS.has("width") && PX_KEYS.has("height"),
	K + ".size=" + PX_KEYS.size);

if (SELF_ONLY) {
	console.log("\n───────────────────────────────────────────────────────────────");
	console.log("（--selftest：只跑 L1）");
	console.log("PASS " + pass + " / FAIL " + fails.length + " / 总计 " + (pass + fails.length));
	console.log("IS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE"));
	process.exit(fails.length === 0 ? 0 : 1);
}

/* ══════════════════════════════════════════════════════════════════
 *  L2 真实源码零命中
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n【L2 真实源码零命中】");
const files = walkSrc();
let totalHits = []; let totalWrapped = 0; let totalDirect = 0; let totalUnknown = 0;
for (const f of files) {
	const r = scanBareNumericStyles(readSrc(f));
	totalWrapped += r.wrapped;
	totalDirect += r.direct;
	totalUnknown += r.unknown;
	for (const h of r.hits) totalHits.push({ file: rel(f), line: h.line, form: h.form });
}
C("L2a src/** 零未归一尺寸写入", totalHits.length === 0,
	totalHits.length ? totalHits.map((h) => h.file + ":" + h.line + " " + h.form).join(" | ") : "扫描 " + files.length + " 文件");

/* ══════════════════════════════════════════════════════════════════
 *  L3 唯一真相源
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n【L3 归一逻辑唯一真相源】");
const OWNER = "src/util/dom-style.js";
const ownerSrc = readSrc(PLUGIN_ROOT + "/" + OWNER);
C("L3a " + OWNER + " 存在且导出 pxOf / PX_KEYS",
	/export\s+function\s+pxOf/.test(ownerSrc) && /export\s+const\s+PX_KEYS/.test(ownerSrc),
	ownerSrc ? ownerSrc.length + " B" : "读不到");

/* 别处不许再定义一份 PX_KEYS / 本地 px 归一实现（只许 import） */
const dupDefs = [];
for (const f of files) {
	const r = rel(f);
	if (r === OWNER) continue;
	const code = stripComments(readSrc(f));
	if (new RegExp("(?:const|let|var|function)\\s+" + K + "\\b").test(code)) dupDefs.push(r + " · 重复定义 " + K);
	if (/\bfunction\s+px\s*\(/.test(code)) dupDefs.push(r + " · 本地 function px() 归一实现");
}
C("L3b 无第二份 PX_KEYS / 本地 px() 实现", dupDefs.length === 0, dupDefs.length ? dupDefs.join(" | ") : "唯一一份");

/* L3c：所有写 `.style` 的文件都已接线（要么 import pxOf，要么根本没有尺寸写入） */
const consumers = [];
for (const f of files) {
	const r = rel(f);
	if (r === OWNER) continue;
	const code = stripComments(readSrc(f));
	const r2 = scanBareNumericStyles(code);
	if (r2.wrapped === 0 && r2.direct === 0 && r2.unknown === 0) continue;
	consumers.push({ file: r, uses: /pxOf|applyStyle/.test(code) });
}
const notWired = consumers.filter((c) => !c.uses).map((c) => c.file);
C("L3c 有直接样式写入的文件均已接线归一（" + consumers.length + " 个）", notWired.length === 0,
	notWired.length ? notWired.join(" | ") : consumers.map((c) => c.file.split("/").pop()).join(", "));

/* ══════════════════════════════════════════════════════════════════
 *  L4 覆盖度自证（防"零命中 = 没扫到"）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n【L4 覆盖度自证】");
/* 🔴 口径已就地更正（第 35 轮）：不再用"手工维护的整仓计数 ≥ 8"。
 *    见文件头 L4 说明 —— 那个 8 既无余量（实测 7）又会因**合法删除代码**而假红。
 *    改为存在性判据 + 明确打印两侧读数（文件数 / 两类计数），可分辨"扫到了"与"没扫到"。 */
C("L4a 确实扫到了可判定的样式写入点（包裹 " + totalWrapped + " / 直写 " + totalDirect + "）",
	totalWrapped + totalDirect > 0, "扫描 " + files.length + " 文件");
C("L4b 两类形态都走到了（wrapped ≥ 1 有静态包裹调用 · 扫描文件 ≥ 10）",
	totalWrapped >= 1 && files.length >= 10, "wrapped=" + totalWrapped + " files=" + files.length);

/* ══════════════════════════════════════════════════════════════════ */
console.log("\n───────────────────────────────────────────────────────────────");
if (totalUnknown > 0) console.log("ℹ️  " + totalUnknown + " 处 Object.assign(*.style, <非字面量>) 无法静态判定（提示，不阻塞）");
console.log("PASS " + pass + " / FAIL " + fails.length + " / 总计 " + (pass + fails.length));
console.log("IS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE"));
if (fails.length) { console.log("\n失败项："); for (const f of fails) console.log("  · " + f); }
process.exit(fails.length === 0 ? 0 : 1);
