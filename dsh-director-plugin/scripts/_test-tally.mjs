#!/usr/bin/env node
/**
 * _test-tally.mjs —— 套件**收尾对账**（唯一实现）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有它（纪律 18：跳过比红更危险 · 纪律 126：同源不许两处实现）
 * ──────────────────────────────────────────────────────────────────
 *   旧形态：套件各自写 `const MIN_ASSERTIONS = N; if (ran < N) exit(2);`
 *   ⇒ 同一语义**两处各自为政**（`test-scope-tree` 30 / `verify-mindmap` 113），
 *     改一处、另一处不跟，而且**不报错** —— 纪律 126 的标准形态。
 *
 *   本模块把它收成一处，而且除了"下限"之外补两条**更可推导**的判据：
 *     · **断言编号复用** —— 从**源码静态枚举**（剥注释后正则抽 `fn("ID"`），零运行时依赖。
 *       🔴 但**不判红**：本仓既有惯例是"正常路径 + 降级/前置失败路径"**共用一个编号**
 *       （互斥分支二选一），实测 `verify-mindmap` 有 11 个编号这么用 ⇒ 硬判会**误报**。
 *       默认只报告并打出出现次数；调用方确知编号必须唯一时可传 `dupIsError:true` 恢复硬判。
 *     · **声明面 vs 实跑面** —— 实跑 **<** 声明 ⇒ 打**提示**（不判红）。
 *     · **显式下限** —— 保留原语义：`ran < min` ⇒ INVALID（exit 2），
 *       与"产品坏"（exit 1）在**退出码层面**分开。
 *
 * 🔴 为什么**不**拿"静态声明数"直接当下限（这正是纪律 126 要防的反面）：
 *    断言可以写在**循环**里 —— `verify-dialog` 静态 191 处 `ok(`、实跑 **279** 条
 *    ⇒ 静态数**小于**实跑数属**正常**。拿它当下限会把正常情况判红；反过来拿它当
 *    上限也会误伤。⇒ 静态数只做"重号自检 + 提示"，**下限仍由实测值显式给出**。
 *
 * ⚠️ 下限是**下限**不是精确值：新增断言**必须**同步抬高它（不抬 = 把沉默合法化）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripComments } from "./_test-ledger.mjs";

/** 断言编号 = 首个空白前的 token（`"DL-8a 收尾..."` ⇒ `DL-8a`；无空白则取整串） */
export function idOf(firstArg) {
	const m = String(firstArg == null ? "" : firstArg).trim().match(/^(\S+)/);
	return m ? m[1] : "";
}

/**
 * 从源码**静态枚举**断言编号（剥注释；读不到源码返回 `null` ⇒ 对账降级，**不算通过**）。
 * @param {string} fileUrl 调用方 `import.meta.url`
 * @param {string} fn 断言函数名（`t` / `ok` / ...）
 * @returns {{ids:string[], dup:string[]}|null}
 */
export function staticAssertIds(fileUrl, fn) {
	let src = "";
	try { src = readFileSync(fileURLToPath(fileUrl), "utf8"); } catch (e) { return null; }
	const code = stripComments(src);
	const re = new RegExp("\\b" + String(fn) + "\\s*\\(\\s*\"([^\"]*)\"", "g");
	const seen = new Set();
	const count = Object.create(null);
	const dup = [];
	let m;
	while ((m = re.exec(code))) {
		const id = idOf(m[1]);
		if (!id) continue;
		count[id] = (count[id] || 0) + 1;
		if (seen.has(id)) { if (dup.indexOf(id) < 0) dup.push(id); }
		else seen.add(id);
	}
	return { ids: [...seen], dup: dup, count: count };
}

/**
 * 收尾对账。
 * @param {string} fileUrl 调用方 `import.meta.url`
 * @param {object} opt
 * @param {string} [opt.fn="t"] 断言函数名
 * @param {number} opt.ran 实跑条数（`pass+fail` 或 `pass+fail+skip`）
 * @param {number} [opt.min] 显式下限（实跑 < 下限 ⇒ INVALID）
 * @param {boolean} [opt.dupIsError=false] 编号复用是否判红（默认**不判** —— 见文件头 ①）
 * @param {string} [opt.label] 报告用的名字
 * @returns {{ok:boolean, declared:number|null, ran:number, min:number|null, dup:string[], ids:string[]}}
 */
export function tallyCheck(fileUrl, opt = {}) {
	const fn = opt.fn || "t";
	const ran = Number(opt.ran || 0);
	const min = opt.min == null ? null : Number(opt.min);
	const label = opt.label || "本套件";
	const st = staticAssertIds(fileUrl, fn);
	const declared = st ? st.ids.length : null;
	const dup = st ? st.dup : [];
	const count = st ? st.count : {};

	console.log("  [对账] " + label + "：实跑 " + ran + " 条 ｜ 声明面 "
		+ (declared == null ? "**读不到**（源码枚举失败 ⇒ 对账已降级，别把它当通过）" : declared + " 个编号（静态枚举 · 已剥注释）"));

	let ok = true;
	/* ① 编号复用 —— **报告，不判红**（这条边界是被实测打出来的，别改回硬判！）
	 *  🔴 本仓既有惯例：同一条断言的**正常路径**与**降级/前置失败路径**共用**同一编号**，
	 *     由互斥分支二选一执行。实测 `verify-mindmap` 有 11 个编号这么用（如 `C-M9a`：
	 *     「折叠全部折起来」/「本机没有非根有子节点 ⇒ 该按钮无事可做」；`C-M19b` 同理）。
	 *     ⇒ 静态重号**不等于**"真重号"；硬判会让正常套件一接入就 INVALID（**误报**）。
	 *  ⇒ 默认只报告，并把**出现次数**打出来（`X ×2`）—— 读的人能一眼分辨"互斥分支"还是
	 *     "复制粘贴写重了"。调用方若确知本套件编号必须唯一，传 `dupIsError: true` 恢复硬判。 */
	if (dup.length) {
		console.log("  ⚠️ 编号复用 " + dup.length + " 个：" + dup.map((d) => d + " ×" + (count[d] || 0)).join(", "));
		console.log("     互斥分支共用编号（正常路径 + 降级路径）是本仓既有惯例 ⇒ 属正常；");
		console.log("     但若是**复制粘贴**造成的真重号，报告会失去可归因性（纪律 128 同族）⇒ 请改号。");
		if (opt.dupIsError) {
			console.log("  ❌ INVALID：调用方声明本套件编号必须唯一（`dupIsError: true`）。");
			ok = false;
		}
	}
	/* ② 声明面 vs 实跑 —— **提示**，不判红（循环会让实跑多于声明；条件分支会让它少于声明） */
	if (declared != null && ran < declared) {
		console.log("  ⚠️ 提示：实跑 " + ran + " < 声明面 " + declared
			+ " ⇒ 有编号**没跑到**（条件分支属正常；否则查是不是整段静默没跑）。");
	}
	/* ③ 显式下限 —— 保留原语义 */
	if (min != null && ran < min) {
		console.log("  ❌ INVALID：断言总数对账不通过（实跑 " + ran + " < 下限 " + min + "）");
		console.log("     ⇒ 有段落**静默没跑**（多半是中途抛穿），本次结果不可用作产品判定。");
		ok = false;
	}
	return { ok: ok, declared: declared, ran: ran, min: min, dup: dup, ids: st ? st.ids : [] };
}
