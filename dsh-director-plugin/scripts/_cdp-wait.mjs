#!/usr/bin/env node
/**
 * _cdp-wait.mjs —— 「**派发后等到位**」的唯一实现（第四十一轮 · T-PLUG-053 ④）
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 为什么必须"等到位"而不是"睡固定时长"
 * ──────────────────────────────────────────────────────────────────
 * 第四十一轮实测（`scripts/_r41-wheel-probe.mjs` ⇒ `logs/_r41-wheelprobe.out`）：
 *
 *   | 量 | 实测 |
 *   |:--|:--|
 *   | CDP `Input.dispatchMouseEvent` **响应** | **18–21 ms** |
 *   | 派发 ⇒ **页面处理器真的跑到**（合成事件正对照） | **264 ms** |
 *   | 派发 ⇒ **页面处理器真的跑到**（CDP 真派发） | **284 · 290 ms** |
 *
 * ⇒ 本仓大量套件仍是「派发 → 固定 `sleep(≤320)` → **单次**读数」，
 *   而 **320 ms 与 290 ms 同一量级** ⇒ 读数**读的是相邻一步的迟到结果**。
 *   危害形态（真实发生）：同一段里「缩放计数 `0→0`」与「缩放读数 `100%→92%`」
 *   **同时成立** —— 自相矛盾的读数，看起来像"产品坏了一半"。
 *   （纪律 145 · 与纪律 91「真实鼠标 58–76 ms」是**两个不同的数**，一个数字不许套所有事件类型）
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 红线：只许等「前置条件」，不许等「断言要成立的量」
 * ──────────────────────────────────────────────────────────────────
 * ❌ `await until(readK, (k) => k !== k0)` 然后断言 `k !== k0`
 *    ⇒ 判据**恒绿**（`until` 已经把要断言的事等到成立了）。纪律 32。
 * ✅ 等**前置条件**（"事件已送达"/"页面已回到已知态"/"布局已停止变化"），
 *    然后**单次**读断言值。
 *
 * 同族：纪律 129（判据不许建在会漂的量上）· 133（起点就绪 = 连续两次读数一致）·
 *       136（装机完成 ≠ 生效）· 143（对照实验两侧同起点）。
 */

/** 内部 sleep —— 本模块自包含，不依赖调用方的 sleep（避免"两个 sleep"）。 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));

/**
 * 轮询直到 `pred(fn())` 成立。
 * @param {() => any | Promise<any>} fn      取值函数（每次轮询都会重新调用）
 * @param {(v:any)=>boolean} pred            成立判据
 * @param {{budgetMs?:number, stepMs?:number, tag?:string, label?:string}} [opt]
 * @returns {Promise<{ok:boolean, val:any, waited:number, rounds:number, tag:string}>}
 *          🔴 **超时不抛**（纪律 58/19：不许把"没等到"升级成异常；让断言以"没动"的形态红出来）
 */
export async function until(fn, pred, opt) {
	const { budgetMs = 6000, stepMs = 150, tag = "", label = "" } = opt || {};
	const t0 = Date.now();
	let last = null;
	let rounds = 0;
	for (;;) {
		last = await fn();
		rounds++;
		if (pred(last)) return { ok: true, val: last, waited: Date.now() - t0, rounds, tag, label };
		if (Date.now() - t0 >= budgetMs) {
			return { ok: false, val: last, waited: Date.now() - t0, rounds, tag, label };
		}
		await sleep(stepMs);
	}
}

/** JSON 串化（用于 settle 的比较；循环引用/不可串化 ⇒ 退回 `String`）。 */
function keyOf(v) {
	try {
		return typeof v === "string" ? v : JSON.stringify(v);
	} catch (_) {
		return String(v);
	}
}

/**
 * 等**连续两次读数一致**（= "已经稳定"，不是"已经就绪"）。
 * 🔴 语义边界（纪律 133）：`settle` 只回答"还变不变"，**不回答"对不对"**。
 *    要"就绪"必须**再叠一个契约判据**（如 `dp-root` 在 DOM、`data-busy=0`），
 *    否则"稳定地被遮罩"照样放行 ⇒ 下游全假红。
 * @param {() => any | Promise<any>} fn
 * @param {{budgetMs?:number, stepMs?:number, tag?:string, label?:string}} [opt]
 * @returns {Promise<{ok:boolean, val:any, waited:number, rounds:number, tag:string}>}
 */
export async function settle(fn, opt) {
	const { budgetMs = 6000, stepMs = 120, tag = "", label = "" } = opt || {};
	const t0 = Date.now();
	let prev = await fn();
	let rounds = 1;
	for (;;) {
		if (Date.now() - t0 >= budgetMs) {
			return { ok: false, val: prev, waited: Date.now() - t0, rounds, tag, label };
		}
		await sleep(stepMs);
		const cur = await fn();
		rounds++;
		if (keyOf(cur) === keyOf(prev)) {
			return { ok: true, val: cur, waited: Date.now() - t0, rounds, tag, label };
		}
		prev = cur;
	}
}

/**
 * 「派发 ⇒ 等到位」封装：把 `dispatch` 与"等某个**前置条件**成立"绑成一次动作。
 * @param {() => void} dispatch             真正的派发（`emit(...)` / `send(...)` 皆可）
 * @param {() => any | Promise<any>} probe  前置条件探针（**必须与断言值不同源**，见红线）
 * @param {(v:any)=>boolean} pred
 * @param {{budgetMs?:number, stepMs?:number, tag?:string, label?:string}} [opt]
 */
export async function dispatchThen(dispatch, probe, pred, opt) {
	const r = await until(probe, pred, opt);
	if (r.ok) return r;
	/* 派发太早也可能导致探针永远不成立 ⇒ 明确回报，**不重试、不兜底**（纪律 96：兜底会盖真因）。 */
	return r;
}

export default { until, settle, dispatchThen };
