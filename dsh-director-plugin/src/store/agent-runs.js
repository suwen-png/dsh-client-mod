/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监执行状态（智能体 / 技能调用）唯一真相源
 * 引用：批次 1
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js
 * 下游：logic/catalog.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/agent-runs.js — 总监执行状态（智能体 / 技能调用）唯一真相源
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（用户原话 · 第 6 批需求 6）
 * ══════════════════════════════════════════════════════════════════
 *  「我要的执行状态调用技能的窗口还是没有, 具体实现逻辑也要完善」
 *
 *  改之前有**三个各自独立、都会让窗口消失**的原因（缺一个都够呛）：
 *   ① 数据源是 `components/DirectorDialog.js` 里的**模块级内存数组** `agentRuns`：
 *      · 页内任何重渲染/重新挂载都会丢；宿主每次启动换随机端口 ⇒ 一定丢；
 *      · 真实执行链（`logic/director-run.js` 五步 + `deliver()` 投递）**一条都不写**，
 *        只有"在总监弹窗里手动点审核/代码/文档按钮"才写 ⇒ **正常使用永远没有内容**。
 *   ② 界面是「有内容才挂载」(`running.length ? h(div) : null`) ⇒ 空态**不渲染**，
 *      用户看到的是"这个窗口不存在"，而不是"窗口在、暂时没记录"。
 *   ③ 判定窗口 5 分钟，过期即从"正在使用"里剔除 ⇒ 即使有记录也会**到点自己消失**。
 *
 *  ⇒ 本模块把"谁在执行、执行到哪一步、成没成"变成**一份可持久化、可订阅、可断言**的数据。
 *
 * ── 数据形态（两级，刻意不合并）──────────────────────────────────
 *   `chains[]` —— **一次完整的执行**（在总监页点「执行」→ 五步 → 投递 → 落库）。
 *                带 `steps[]`，所以窗口能显示"第几步、由谁做、指向哪、什么档"。
 *   `calls[]`  —— **单次调用**（弹窗里手动点某个智能体/技能、自动审核等）。
 *                这是改造前 `agentRuns` 的语义，保留同名 API，兼容既有闸门。
 *
 * ── 三条硬约束 ───────────────────────────────────────────────────
 *  ① **绝不抛**：本模块在 `installBatch1` 执行链与本页渲染路径上，
 *     抛一次会把其后几十项能力一起丢掉（纪律 C）。全部读写包 try/catch。
 *  ② **不许撒谎**：`running` 是**进程内**状态。持久化读回时若见到 `running`，
 *     一律改判为 `interrupted` 并**写明原因** —— 上次真机就是"重启后卡片还转圈"，
 *     那种"看起来在跑"比明说"被中断"难查得多。
 *  ③ **可断言**：导出 `runsState`（计数 / 版本 / 上次错误），窗口与闸门读同一份。
 *
 * 诊断句柄：`window.__dshAgentRuns`
 */

import { CHAIN_STEPS, stepMeta, targetOf } from "../logic/catalog.js";

/** 持久化键（🔴 **新键**：既有键一个都不改名，见冻结契约） */
export const AGENT_RUNS_KEY = "dsh.director.agentRuns.v1";

/** `calls` 上限（超出丢最旧） */
export const RUNS_KEEP = 60;
/** `chains` 上限 */
export const CHAINS_KEEP = 12;
/** 面板「调用情况」一屏最多渲染条数（兼容旧导出：`DirectorDialog` 曾在此定义） */
export const RUNS_SHOWN = 8;

/** 运行状态（`running` 只在进程内有意义；读回时会被改判为 `interrupted`） */
export const RUN_STATUS = Object.freeze({
	RUNNING: "running",
	OK: "ok",
	WARN: "warn",
	FAIL: "fail",
	/** 上次进程结束时还没走完 —— 由读回时改判，**不是**运行时写入的 */
	INTERRUPTED: "interrupted"
});

/** 可断言面（窗口与闸门读同一份；不要把状态藏在闭包里） */
export const runsState = {
	version: 0,
	calls: 0,
	chains: 0,
	/** 最近一次写入错误（无错为 null）—— 有错必须能被看到 */
	lastError: null,
	/** 持久化是否可用（localStorage 被禁时为 false，此时退化为内存态） */
	persisted: true,
	/** 读回时被改判为 interrupted 的条数（>0 说明上次没走完） */
	interruptedOnLoad: 0
};

const state = { calls: [], chains: [] };
let seq = 0;
const listeners = new Set();

function bump() {
	runsState.version += 1;
	runsState.calls = state.calls.length;
	runsState.chains = state.chains.length;
	for (const fn of Array.from(listeners)) {
		try { fn(runsState.version); } catch (e) { /* 订阅者自己坏了不许反噬数据层 */ }
	}
}

function newId(prefix) {
	seq += 1;
	return prefix + "-" + Date.now().toString(36) + "-" + seq.toString(36);
}

/* ══════════════════════════════════════════════════════════════════
 * 持久化
 * ══════════════════════════════════════════════════════════════════ */

function safeGet() {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage.getItem(AGENT_RUNS_KEY);
	} catch (e) { return null; }
}

function persist() {
	try {
		if (typeof localStorage === "undefined") { runsState.persisted = false; return; }
		localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify({ v: 1, calls: state.calls, chains: state.chains }));
		runsState.persisted = true;
		runsState.lastError = null;
	} catch (e) {
		/* 容量满 / 隐私模式：降级为内存态，但**必须留痕**（无声降级是最坏的一种） */
		runsState.persisted = false;
		runsState.lastError = "持久化失败，已退化为内存态：" + ((e && e.message) || e);
	}
}

/**
 * 读回。🔴 见到 `running` 一律改判 —— 详见文件头约束②。
 * 返回被改判的条数（0 表示上次是干净收尾）。
 */
function restore() {
	state.calls = [];
	state.chains = [];
	runsState.interruptedOnLoad = 0;
	const raw = safeGet();
	if (!raw) return 0;
	let data = null;
	try { data = JSON.parse(raw); } catch (e) {
		runsState.lastError = "持久化数据解析失败（已忽略，不清空键）：" + ((e && e.message) || e);
		return 0;
	}
	if (!data || typeof data !== "object") return 0;

	const calls = Array.isArray(data.calls) ? data.calls : [];
	for (const c of calls) {
		if (!c || typeof c !== "object" || !c.key) continue;
		state.calls.push(c);
	}

	const chains = Array.isArray(data.chains) ? data.chains : [];
	for (const ch of chains) {
		if (!ch || typeof ch !== "object" || !ch.id) continue;
		if (ch.status === RUN_STATUS.RUNNING) {
			ch.status = RUN_STATUS.INTERRUPTED;
			ch.note = "上次进程结束时还没走完（本地模型/投递可能被中断）";
			runsState.interruptedOnLoad += 1;
			const steps = Array.isArray(ch.steps) ? ch.steps : [];
			for (const s of steps) {
				if (s && s.status === RUN_STATUS.RUNNING) s.status = RUN_STATUS.INTERRUPTED;
			}
		}
		state.chains.push(ch);
	}
	return runsState.interruptedOnLoad;
}

/* ══════════════════════════════════════════════════════════════════
 * 一、单次调用（兼容原 `recordAgentRun` / `listAgentRuns`）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 记一次智能体 / 技能调用。
 * @param {string} key 智能体 id 或技能 key（与 `logic/roles.js` / `logic/catalog.js` 同源）
 * @param {string} [status] ok / warn / fail / running
 * @param {string} [note] 归因说明（**不写就空着，不编**）
 * @param {object} [extra] 可选 { kind, label, target }
 */
export function recordAgentRun(key, status, note, extra = {}) {
	try {
		const k = String(key || "").trim();
		if (!k) { runsState.lastError = "recordAgentRun 收到空 key，已忽略"; return null; }
		const rec = {
			id: newId("call"),
			key: k,
			kind: extra.kind || "agent",
			label: extra.label || k,
			target: extra.target || "",
			status: status || RUN_STATUS.OK,
			note: note || "",
			at: Date.now()
		};
		state.calls.unshift(rec);
		if (state.calls.length > RUNS_KEEP) state.calls.length = RUNS_KEEP;
		persist();
		bump();
		return rec;
	} catch (e) {
		runsState.lastError = "recordAgentRun 异常：" + ((e && e.message) || e);
		return null;
	}
}

/**
 * 列出单次调用（最新在前）。
 * 🔴 无参返回**全量**（供 `data-run-total` 反映真实条数）；
 *    截断由调用方自己做 —— 「列表 API 静默截断」曾使最旧一条被挤出，
 *    验证脚本据此误判为缺记录（历史缺陷，勿回退）。
 * @param {number} [limit]
 */
export function listAgentRuns(limit) {
	const all = state.calls.slice();
	return (typeof limit === "number" && limit >= 0) ? all.slice(0, limit) : all;
}

/** 清空全部记录（诊断/闸门用；会同步清持久化） */
export function clearAgentRuns() {
	try {
		state.calls.length = 0;
		state.chains.length = 0;
		persist();
		bump();
		return true;
	} catch (e) { runsState.lastError = "clearAgentRuns 异常：" + ((e && e.message) || e); return false; }
}

/**
 * 快照当前全部记录（深拷贝，JSON 形态）。
 *
 * 🔴 存在的理由（纪律 15「会写盘的闸门段必须 快照 → 还原 → 还原断言」）：
 *   本 store 是**持久化**的。任何"为了断言先塞几条"的测试，如果不还原，
 *   就会把测试数据永久留在用户的真实记录里 —— 闸门不许成为产品的破坏者。
 *   快照走 JSON 深拷贝（不共享引用），否则还原会把被改过的对象当成原件。
 */
export function snapshotRuns() {
	try {
		return JSON.parse(JSON.stringify({ calls: state.calls, chains: state.chains }));
	} catch (e) {
		runsState.lastError = "snapshotRuns 异常：" + ((e && e.message) || e);
		return null;
	}
}

/**
 * 用快照**覆盖**当前记录（不是合并 —— 合并会把测试期间新增的脏数据留下）。
 * @param {{calls:Array, chains:Array}} snap `snapshotRuns()` 的返回值
 * @returns {boolean}
 */
export function restoreRuns(snap) {
	try {
		if (!snap || typeof snap !== "object") { runsState.lastError = "restoreRuns 收到非法快照"; return false; }
		state.calls = Array.isArray(snap.calls) ? snap.calls.slice() : [];
		state.chains = Array.isArray(snap.chains) ? snap.chains.slice() : [];
		persist();
		bump();
		return true;
	} catch (e) {
		runsState.lastError = "restoreRuns 异常：" + ((e && e.message) || e);
		return false;
	}
}

/* ══════════════════════════════════════════════════════════════════
 * 二、一次完整执行（chain）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 开始一次执行链。**先登记再跑** —— 这样"跑挂了"也能看到它挂在哪一步
 * （事后登记只能看到成功的那些，正是改造前的问题）。
 * @param {{sessionId?:string, text?:string}} p
 * @returns {string|null} runId（登记失败返回 null；调用方**不因 null 中断主流程**）
 */
export function beginChain(p = {}) {
	try {
		const rec = {
			id: newId("chain"),
			at: Date.now(),
			sessionId: String(p.sessionId || ""),
			text: String(p.text || "").slice(0, 120),
			status: RUN_STATUS.RUNNING,
			grade: "",
			model: "",
			deliver: null,
			note: "",
			steps: CHAIN_STEPS.map((s) => ({
				n: s.n, name: s.name, roleId: s.roleId,
				target: targetOf(s.module, s.symbol),
				status: RUN_STATUS.RUNNING, grade: "", text: ""
			}))
		};
		state.chains.unshift(rec);
		if (state.chains.length > CHAINS_KEEP) state.chains.length = CHAINS_KEEP;
		persist();
		bump();
		return rec.id;
	} catch (e) {
		runsState.lastError = "beginChain 异常：" + ((e && e.message) || e);
		return null;
	}
}

/**
 * 用真实步骤结果**逐条对齐**（不是"跑完再补"，而是拿到就写）。
 * @param {string} runId
 * @param {Array<{n:number,name:string,enabled:boolean,grade:string,text:string}>} steps
 *        形参就是 `runDirector()` 返回的 `steps`（**同源**，不重新拼装）
 */
export function fillChainSteps(runId, steps) {
	try {
		const ch = state.chains.find((c) => c && c.id === runId);
		if (!ch || !Array.isArray(steps)) return false;
		ch.steps = steps.map((s) => {
			const meta = stepMeta(s && s.n);
			return {
				n: (s && s.n) || 0,
				name: (s && s.name) || "",
				roleId: meta ? meta.roleId : "",
				target: meta ? targetOf(meta.module, meta.symbol) : "",
				/* 🔴 职责被关闭 ⇒ 状态是 `skipped` 而不是 `ok`：
				 *    「没做」与「做了」在读数上必须能分开（纪律 18：跳过比红更危险）。 */
				status: (s && s.enabled === false) ? "skipped" : RUN_STATUS.OK,
				grade: (s && s.grade) || "",
				text: (s && s.text) || ""
			};
		});
		persist();
		bump();
		return true;
	} catch (e) {
		runsState.lastError = "fillChainSteps 异常：" + ((e && e.message) || e);
		return false;
	}
}

/**
 * 结束一次执行链。
 * @param {string} runId
 * @param {{status?:string, grade?:string, model?:string, deliver?:object, note?:string}} info
 */
export function endChain(runId, info = {}) {
	try {
		const ch = state.chains.find((c) => c && c.id === runId);
		if (!ch) return false;
		ch.status = info.status || RUN_STATUS.OK;
		if (info.grade) ch.grade = info.grade;
		if (info.model) ch.model = info.model;
		if (info.deliver) ch.deliver = info.deliver;
		if (info.note) ch.note = info.note;
		ch.endAt = Date.now();
		persist();
		bump();
		return true;
	} catch (e) {
		runsState.lastError = "endChain 异常：" + ((e && e.message) || e);
		return false;
	}
}

/** 最近一次执行链（**窗口默认渲染它** ⇒ 不再"有内容才挂载"） */
export function latestChain() {
	return state.chains.length ? state.chains[0] : null;
}

/** 列出执行链（最新在前；`limit` 省略给全量） */
export function listChains(limit) {
	const all = state.chains.slice();
	return (typeof limit === "number" && limit >= 0) ? all.slice(0, limit) : all;
}

/** 正在跑的那条（没有则 null）—— 供窗口显示 ● 运行中 */
export function activeChain() {
	return state.chains.find((c) => c && c.status === RUN_STATUS.RUNNING) || null;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、订阅（React 侧用 `useSyncExternalStore` 的入参对）
 * ══════════════════════════════════════════════════════════════════ */

/** @param {(v:number)=>void} fn @returns {()=>void} 退订 */
export function subscribeRuns(fn) {
	if (typeof fn !== "function") return () => { };
	listeners.add(fn);
	return () => { listeners.delete(fn); };
}

/** 版本号（`useSyncExternalStore` 的 getSnapshot；必须返回**稳定值**，不能每次新对象） */
export function runsVersion() {
	return runsState.version;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、装载 / 诊断
 * ══════════════════════════════════════════════════════════════════ */

/** 装载（读回持久化 + 自挂 window）。可重复调用，幂等。 */
export function installAgentRuns() {
	try {
		restore();
		bump();
	} catch (e) {
		runsState.lastError = "installAgentRuns 异常：" + ((e && e.message) || e);
	}
	if (typeof window !== "undefined") {
		try {
			window.__dshAgentRuns = {
				state: runsState, KEY: AGENT_RUNS_KEY, STATUS: RUN_STATUS,
				list: listAgentRuns, chains: listChains, latest: latestChain, active: activeChain,
				record: recordAgentRun, clear: clearAgentRuns, version: runsVersion, subscribe: subscribeRuns,
				/* 快照/还原（纪律 15）：闸门写入前后用它把用户真实记录原样还回去 */
				snapshot: snapshotRuns, restore: restoreRuns,
				beginChain, fillChainSteps, endChain
			};
		} catch (e) { /* 诊断句柄失败不影响数据层 */ }
	}
	return runsState;
}

installAgentRuns();
