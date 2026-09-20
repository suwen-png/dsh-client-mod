/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：**「总监小结里必须出现的那一行」的唯一构造点**
 * 引用：22 号文 §3 · T-PLUG-050
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/summary-notes.js — **「总监小结里必须出现的那一行」的唯一构造点**
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  22 号文 §3 的两条差距（G5 / G6）都落在**同一件事**上：
 *    「用户在总监小结里**看不见**系统到底做了什么」。
 *
 *    · **G5（F3 接收确认）**：跨维度转交之后，源分支与目标分支**各自**
 *      要能读到一行可核对的凭证 —— 「已转交 → X」「已接收 ← Y」。
 *      改前这两句话**散在 3 个组件里各自拼字符串**
 *      （`DirectorDialog` / `DirectorPage` / `MindMap`），
 *      于是同一个语义有 3 份实现、3 种措辞 ⇒ 闸门没法用一个判据守住，
 *      用户也读不出"这是同一件事"。**同一语义两个标识符 = 隐式断链（纪律 126）**。
 *
 *    · **G6（N5/F5 对话持续性）**：`T-PLUG-050`（登记该不该产生总监消息）尚未裁定，
 *      本版按 doc19 §4 N5 的**第二方案**执行 —— **不写消息，但必须显式说出来**。
 *      改前那句话只进 `say()`（**2.6 秒后消失的 toast**）⇒ 用户点了「登记流转」，
 *      界面上"有结果的动作发生了"，3 秒后**什么都不剩**，读起来就是"没持久化"。
 *      ⇒ 必须落到**留得住的小结行**上，且**不能**因此写库（否则与
 *        `engineStats.conversations` 的负对照矛盾）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 三条纪律
 * ══════════════════════════════════════════════════════════════════
 *  ① **单一真相源**：三个组件**都调本文件**，谁也不许再自己拼这两句话。
 *     加一个字都要改这里 —— 这是"两处措辞漂移"的唯一解（纪律 126）。
 *  ② **纯函数**：不 import react、不碰 localStorage、不用 `Math.random`
 *     ⇒ `scripts/test-requirement22.mjs` 可离线逐字节断言。
 *     时间戳一律由调用方传入（`at`），不在函数内部取 `Date.now()`
 *     —— 否则同一次调用两次跑出不同结果，断言无法复现（纪律 107）。
 *  ③ **不编内容**：名字为空就落到「目标分支 / 来源分支」这种**中性占位**，
 *     不拿节点 id 或标题顶替（读不到就说读不到）。
 */

/** 源侧标记（判据用**字面量**，别在组件里另写字面量） */
export const HANDOFF_TAG = "已转交";
/** 目标侧标记 */
export const ACCEPT_TAG = "已接收";
/** G6：登记动作的显式标注（必须出现在总监小结里） */
export const NO_DIRECTOR_MSG_TAG = "本动作不写总监消息";
/** G6：提示里必须给出**可执行的替代路径**（只说"不行"等于没说） */
export const REGISTER_HINT = "要总监回应请用「执行」";
/** 源侧流转条目上的登记标记（`DirectorPage#registerNative` 写入 `note`） */
export const REGISTER_TRAIL_TAG = "登记";

/**
 * 本地 `HH:MM`（**确定性**：同一 `at` 恒定同一串，供离线断言用）。
 * ⚠️ 不用 `toLocaleTimeString()` —— 它随 locale / 时区 / ICU 版本变，
 *    写进判据会在别的机器上假红（纪律：判据不许建在环境相关的量上）。
 * @param {number} [at]
 * @returns {string}
 */
export function hhmm(at) {
	const t = typeof at === "number" && at > 0 ? at : Date.now();
	const d = new Date(t);
	const p = (n) => (n < 10 ? "0" + n : String(n));
	return p(d.getHours()) + ":" + p(d.getMinutes());
}

/** `（维度 X）`；无维度 key 时返回空串（不写 `（维度 ）` 这种半截话） */
export function dimPart(dimKey) {
	const s = String(dimKey == null ? "" : dimKey).trim();
	return s ? "（维度 " + s + "）" : "";
}

/** 名字兜底：空 ⇒ 中性占位，**不**拿 id 顶替 */
function nameOr(v, fallback) {
	const s = String(v == null ? "" : v).trim();
	return s || fallback;
}

/**
 * **G5 源侧一行**：「已转交 → <目标名>（维度 X）（HH:MM）」
 * @param {{toName?:string, dimKey?:string, at?:number}} o
 * @returns {string}
 */
export function transferLine(o) {
	const p = o || {};
	return HANDOFF_TAG + " → " + nameOr(p.toName, "目标分支") + dimPart(p.dimKey) + "（" + hhmm(p.at) + "）";
}

/**
 * **G5 目标侧一行**：「已接收 ← <来源名>（维度 X）（HH:MM）」
 * @param {{fromName?:string, dimKey?:string, at?:number}} o
 * @returns {string}
 */
export function acceptLine(o) {
	const p = o || {};
	return ACCEPT_TAG + " ← " + nameOr(p.fromName, "来源分支") + dimPart(p.dimKey) + "（" + hhmm(p.at) + "）";
}

/** 取一条流转的「最后活动时刻」（登记时刻与全部足迹取最大）—— 与 `flow.js#lastTouchOf` 同义 */
function touchOf(f) {
	if (!f) return 0;
	let m = typeof f.at === "number" ? f.at : 0;
	const t = Array.isArray(f.trail) ? f.trail : [];
	for (const h of t) if (h && typeof h.at === "number" && h.at > m) m = h.at;
	return m;
}

/** 某条流转是不是「登记」产生的（看第一跳的 note） */
export function isRegisterFlow(f) {
	const t0 = (f && Array.isArray(f.trail) && f.trail[0]) || null;
	return Boolean(t0) && String(t0.note || "").indexOf(REGISTER_TRAIL_TAG) >= 0;
}

/** 消息里最晚的时刻（0 = 没有消息） */
function lastMsgAt(messages) {
	const list = Array.isArray(messages) ? messages : [];
	let m = 0;
	for (const x of list) if (x && typeof x.at === "number" && x.at > m) m = x.at;
	return m;
}

/**
 * **G6 的核心判据（纯函数）** —— 总监小结里该不该出现
 * 「本动作不写总监消息（登记为流转）」这一行。
 *
 * 🔴 为什么是**推导**而不是"写一条库记录"：
 *    G6 的判据是**两条一起**成立的 ——
 *      ① 总监小结**出现**该行；② `engineStats.conversations` **不因该动作增长**。
 *    若把这一行写进 plugin-db，②必然失败（消息数 +1），两条判据自相矛盾。
 *    ⇒ 唯一自洽的形态：**这一行由「数据状态」推导出来，零写库**。
 *
 * 🔴 判定口径（顺序固定）：
 *    ① 没有任何「登记」产生的流转          → 不显示
 *    ② 最近一次登记**之后**已经有总监消息   → 不显示（该说的已经说了，别赖着）
 *    ③ 否则                               → 显示
 *
 * @param {Array} flows 本作用域的流转（`flowStore.ofSession(scopeKey)`）
 * @param {Array} messages 本作用域的总监消息（`listDirectorMessages(nodeId)`）
 * @returns {string} 非空即显示
 */
export function registerNote(flows, messages) {
	const list = Array.isArray(flows) ? flows : [];
	let lastReg = null;
	for (let i = list.length - 1; i >= 0; i--) {
		if (isRegisterFlow(list[i])) { lastReg = list[i]; break; }
	}
	if (!lastReg) return "";
	const regAt = touchOf(lastReg);
	if (lastMsgAt(messages) >= regAt) return "";
	return registerBody();
}

/**
 * G6：登记动作的**唯一措辞**（= `registerNote()` 的正文 = 登记提示 toast 的正文）。
 *
 * 🔴 为什么必须抽成一处（**第 41 轮收口**）：`DirectorPage#registerNative` 的提示原先是一串
 *    **内联字面量**，写着「「登记」**不产生**总监消息」，而同一语义的常量
 *    `NO_DIRECTOR_MSG_TAG` 写的是「本动作**不写**总监消息」—— **同一事实两处措辞漂移**
 *    （纪律 126 的又一形态）。用户看到的恰恰是那句提示，而闸门断言引用的是常量
 *    ⇒ 不收口就会出现"**判据是绿的、用户看到的是另一句话**"。
 * @returns {string}
 */
export function registerBody() {
	return NO_DIRECTOR_MSG_TAG + "（登记为流转）—— " + REGISTER_HINT;
}

/**
 * `DirectorPage#registerNative` 的登记提示（toast）—— **唯一构造点**
 * @param {number} n 已登记文本的字符数（调用方传 `String(txt).trim().length`）
 * @returns {string}
 */
export function registerToast(n) {
	const c = Number.isFinite(Number(n)) ? String(Number(n)) : "0";
	return "已登记流转 · " + c + " 字符（已进四维轨迹；" + registerBody() + "）";
}

/** 离线/调试用 */
export function installSummaryNotesApi() {
	const api = {
		HANDOFF_TAG, ACCEPT_TAG, NO_DIRECTOR_MSG_TAG, REGISTER_HINT, REGISTER_TRAIL_TAG,
		hhmm, dimPart, transferLine, acceptLine, isRegisterFlow, registerNote, registerBody, registerToast
	};
	if (typeof window !== "undefined") window.__dshSummaryNotes = api;
	return api;
}
