/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）
 * 引用：要求 5 · 要求 3
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, components/OverviewDialog.js, mount.js
 * 下游：bridge/split.js, util/debug.js, logic/branch-tree.js, store/hierarchy.js, logic/conv-snapshot.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/chat-bridge.js — 「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）
 *
 * ── 定位 ────────────────────────────────────────────────────────
 *   分屏通道（`bridge/split.js`）已经让**右栏＝原生对话区本身**：
 *   消息渲染、滚动、选择复制、消息内交互**天然可用**，本模块**不需要**做任何"显示"工作。
 *   本模块只补两件分屏给不了的事：
 *     ① **左 → 右**：把总监侧的输入送进原生 composer 并提交（要求 5「互相传送消息」）
 *     ② **右 → 左**：观察原生产出变化 → 通知总监侧触发审核（要求 3）
 *
 * ── 🔴 定位原生的方式：**语义属性**，不用 hash 类名 ──────────────
 *   实测（2026-09-12 真机）：
 *     composer 编辑器  `textarea[placeholder="给智能体发消息"]`（类名 `FVE3va_input` 会随构建变）
 *     发送按钮         `button[aria-label="发送消息"]`（空内容时 `disabled=true`）
 *   ⇒ 一律用 `placeholder` / `aria-label` 这类**语义属性**做锚点；
 *     类名（`FVE3va_*` / `RWZidW_*`）只作兜底，不入判据。
 *
 * ── 🔴 React 受控输入的正确写法 ─────────────────────────────────
 *   直接 `ta.value = x` 不会触发 React 的 onChange（React 劫持了 value setter）。
 *   必须走**原生 setter** + 派发 `input` 事件：
 *     `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, x)`
 *     `ta.dispatchEvent(new Event("input", { bubbles: true }))`
 *   否则发送按钮的 `disabled` 不会解除，点击是原生 no-op（→ 表现为"点了没反应"）。
 */

import { getSplitRootRect, findChatRoot, isPluginNode } from "./split.js";
import { dshLog } from "../util/debug.js";
/* ── 第 40 轮（需求 21-R21-05）：把「对话镜像」采集到的**最后一次我发的 + 结果**
 *    落到该会话的**层级节点**上 —— 这是"关掉对话之后还能看见"的唯一通道。
 *    为什么放在这里：镜像是**唯一**读得到"用户 ↔ AI 对话"的地方
 *    （`readConversationItems()` 读当前打开会话的 DOM），而它只在**对话页签**才取数
 *    ⇒ 只有在这里顺手落盘，才不新增 IO 通道、也不新增轮询。 */
import { currentSessionId } from "../logic/branch-tree.js";
import { findNodeBySessionId, saveNode, loadTree } from "../store/hierarchy.js";
import { pickLastExchange, mergeSnapshot } from "../logic/conv-snapshot.js";

const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined";

/** 最近一次投递的结果（供界面呈现与验证脚本读 —— 降级也要看得见走的是哪一级） */
let lastDeliver = null;
/** @returns {object|null} 最近一次 `deliverToChat` 的返回 */
export function getLastDeliver() { return lastDeliver; }

/** 发送按钮的语义锚点（实测值，勿改成类名） */
export const SEND_ARIA = "发送消息";
/** composer 编辑器占位文案（实测值；命中不到时退回"任意可见 textarea"） */
export const COMPOSER_PLACEHOLDER = "给智能体发消息";

function isVisible(el) {
	if (!el || !el.getBoundingClientRect) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}

/**
 * 宿主是否正在生成回答。
 *
 * 判据：出现 `button[aria-label="停止生成"]`（宿主把「发送」换成「停止」的那个按钮）。
 * ⚠️ 为什么要单独判它：**生成中宿主会把 composer 隐藏**
 *   （真机实测：`textarea[placeholder=…]` 仍在 DOM，但外层 `display:none` ⇒ 盒为 0×0，
 *    `findComposer()` 自然返回 null）。此时若只说「先打开对话区」会误导用户
 *    —— 框不是没打开，是宿主在生成中暂时收起来了。
 * @returns {boolean}
 */
export function isAgentGenerating() {
	if (!hasDom()) return false;
	return Boolean(document.querySelector('button[aria-label="停止生成"]'));
}

/** 找到 composer 编辑器 */
export function findComposer() {	if (!hasDom()) return null;
	const byPh = document.querySelector('textarea[placeholder="' + COMPOSER_PLACEHOLDER + '"]');
	if (byPh && isVisible(byPh)) return byPh;
	for (const ta of document.querySelectorAll("textarea")) if (isVisible(ta)) return ta;
	for (const ed of document.querySelectorAll('[contenteditable="true"]')) if (isVisible(ed)) return ed;
	return null;
}

/** 找到发送按钮（按 aria-label；找不到则退回 composer 卡片内的主按钮） */
export function findSendButton() {
	if (!hasDom()) return null;
	const byAria = document.querySelector('button[aria-label="' + SEND_ARIA + '"]');
	if (byAria) return byAria;
	const ta = findComposer();
	let el = ta ? ta.parentElement : null;
	for (let i = 0; i < 5 && el; i++) {
		const btns = [...el.querySelectorAll("button")].filter((b) => /send|发送/i.test((b.getAttribute("aria-label") || "") + (b.getAttribute("title") || "") + (b.textContent || "")));
		if (btns.length) return btns[btns.length - 1];
		el = el.parentElement;
	}
	return null;
}

/**
 * 把文本写入 composer（React 受控输入安全）
 * @returns {{ok:boolean, reason?:string, editor?:HTMLElement}}
 */
export function setComposerText(text) {
	const ed = findComposer();
	if (!ed) return { ok: false, reason: "composer-not-found" };
	try {
		const v = String(text == null ? "" : text);
		if (ed.tagName === "TEXTAREA") {
			const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
			if (desc && desc.set) desc.set.call(ed, v); else ed.value = v;
		} else if (ed.tagName === "INPUT") {
			const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
			if (desc && desc.set) desc.set.call(ed, v); else ed.value = v;
		} else {
			ed.textContent = v;
		}
		ed.dispatchEvent(new Event("input", { bubbles: true }));
		ed.dispatchEvent(new Event("change", { bubbles: true }));
		return { ok: true, editor: ed };
	} catch (e) {
		return { ok: false, reason: "set-error:" + (e && e.message) };
	}
}

/**
 * 读取 composer 当前值（**写后回读校验**用，见 execution-standards §3.4）
 * @returns {string|null}
 */
export function readComposerText() {
	const ed = findComposer();
	if (!ed) return null;
	return ed.tagName === "TEXTAREA" || ed.tagName === "INPUT" ? String(ed.value || "") : String(ed.textContent || "");
}

/* 🔴 第 42 轮（需求 1：**测试别烧额度**）────────────────────────────────
 * 背景（用户原话）：「你测试流转的时候 没有标注测试或者其他的么，把我的额度跑没了」。
 *
 * 真因（取证，不是猜）：本插件的"流转"是**真实投递** —— 最终落到
 *   `submitComposer()`（点宿主原生发送按钮）或 `sendToHost()`（直投宿主会话口），
 * 宿主收到就**真的发起一次模型调用**。全量真机批（16 套）里有若干段会走到这里
 *   ⇒ 每跑一轮就实打实消耗用户的模型额度，且测试产生的会话/消息**不带任何标记**，
 *   事后无法与用户真实使用区分（"没标注测试"正是这句抱怨的由来）。
 *
 * 处置：加**干跑开关**（默认**关**，绝不影响正常使用）——
 *   开启时：文本**照旧填进 composer**（界面反馈、以及"能读到输入"这类判据仍然有效），
 *   但**不点发送、不直投宿主** ⇒ 不产生任何模型调用。
 *   · 真机套件启动时置 `window.__dshDirectorDryRun = true`（见 `scripts/_ensure-page.mjs`）。
 *   · 需要真发时显式置回 false（例如专门验"发送链路"的那一条）。
 * ⚠️ 开关**只拦"发送"这一个动作**，不改任何其它行为 —— 不产生副作用、可随时回退。
 *
 * 🔴 第 42 轮补丁：**跨页面重载必须存活**。
 *   真因（取证）：`verify-v17-sync.mjs` / `verify-director-logic.mjs` 等套件会在**套件内部**
 *     执行 `location.reload()` 来复位成"干净起点"。`window.__dshDirectorDryRun` 是
 *     **页面全局**，reload 之后**必然丢失** ⇒ 该套件 reload 之后的每一次"流转"都会
 *     **真发**（额度就是这样被悄悄烧掉的：批内每套之前有守卫会重设，套件**内部**那段没有）。
 *   ⇒ 加 `sessionStorage` 兜底：**同标签 reload 存活、关标签/重启宿主即清**。
 *   为什么不用 `localStorage`：它会**长期残留**，用户在同一台机上正常使用时会"发不出去"
 *     却查不出原因 —— 那等于把测试痕迹留进了产品。`sessionStorage` 的生命周期
 *     恰好覆盖"一次测试会话"，与纪律 99（判据生命周期 = 数据生命周期）同族。
 *   · 读法：**内存 → 页面全局 → sessionStorage** 三级，任一为真即干跑。
 *   · 产品默认不受影响：正常使用不会写入该键 ⇒ `false`（回归判据见 `test-r42-req.mjs` R42-6f/6g）。
 */
const DRY_SS_KEY = "dsh.director.testDryRun";
let dryRunFlag = false;

/** 开/关干跑（返回生效值）。同时镜像到 `window.__dshDirectorDryRun` + `sessionStorage` 供 CDP 侧读写。 */
export function setDryRun(v) {
	dryRunFlag = v === true;
	try { if (typeof window !== "undefined") window.__dshDirectorDryRun = dryRunFlag; } catch (e) { /* 无 window：仅内存态 */ }
	try {
		if (typeof window !== "undefined" && window.sessionStorage) {
			if (dryRunFlag) window.sessionStorage.setItem(DRY_SS_KEY, "1");
			else window.sessionStorage.removeItem(DRY_SS_KEY);
		}
	} catch (e) { /* 隐私模式/配额：降级为仅内存态，不影响主流程 */ }
	return dryRunFlag;
}

/** 是否干跑（内存标记 **或** 页面全局标记 **或** sessionStorage 兜底 —— 后两者让真机脚本无需触碰模块内部） */
export function isDryRun() {
	if (dryRunFlag) return true;
	try {
		if (typeof window === "undefined") return false;
		if (window.__dshDirectorDryRun === true) return true;
		const ss = window.sessionStorage;
		return !!(ss && ss.getItem(DRY_SS_KEY) === "1");
	} catch (e) { return false; }
}

/**
 * 点原生"发送"按钮（**唯一的提交实现点**）。
 * @returns {{ok:boolean, reason?:string, via?:string}}
 */
export function submitComposer() {
	/* 干跑：**不点发送** ⇒ 不触发模型调用。
	 * 返回专门的原因串 `dry-run`，让读数能区分"被有意跳过"与"真失败"（纪律 58）。 */
	if (isDryRun()) return { ok: false, reason: "dry-run", via: "dry-run" };
	const btn = findSendButton();
	if (!btn) return { ok: false, reason: "send-button-not-found" };
	if (btn.disabled) return { ok: false, reason: "send-button-disabled", via: "disabled" };
	try {
		btn.click();
		return { ok: true, via: "click" };
	} catch (e) {
		return { ok: false, reason: "click-error:" + (e && e.message) };
	}
}

/**
 * 🔴 宿主直投通道：把指令交给宿主自己的会话发送口 `window.__directChatSubmit`
 *
 * 为什么"点原生发送按钮"不够（2026-09-12 真机实测）：
 *   宿主的 InputBar 在 `focusTarget !== "chat"` 时会把提交**劫持给总监**
 *   —— 走 `window.__directorSubmit`，也就是"再跑一遍宿主自己那套五步"。
 *   而我们的指令**已经过插件侧五步处理**（`runDirector`）⇒ 会被处理两次，
 *   并且落进宿主旧版总监库（插件侧 R5 与它不是同一份）。实测后果：
 *   `__directorSubmit` 内部把**快照对象**当活会话用，抛
 *   `TypeError: session.prompt is not a function` ⇒ 消息其实**没送到智能体**，
 *   而点按钮这件事本身成功 ⇒ 表现为"显示已发送，实际没发"（最坏的假绿灯）。
 *
 *   `__directChatSubmit` 用的是宿主**同一份** `scopedConversation(sessions,id).send(text)`
 *   —— 直投对话域，不经过 InputBar 的劫持分支。
 *
 * 证据（不是"调了就算"）：`__directChatSubmit` 每次执行都会写
 *   `window.__directChatProbe = {called, sessionId, draft, time}`
 *   ⇒ 以 `called` 的**增量**为凭据，确认宿主确实收下了这次投递。
 *
 * @param {string} sessionId 目标会话
 * @param {string} text 已处理好的指令
 * @returns {Promise<{ok:boolean, mode?:"sent", via?:string, verified?:boolean, reason?:string}>}
 */
export async function sendToHost(sessionId, text) {
	if (!hasDom()) return { ok: false, reason: "no-dom" };
	if (!sessionId) return { ok: false, reason: "no-session" };
	const fn = window.__directChatSubmit;
	if (typeof fn !== "function") return { ok: false, reason: "host-send-unavailable" };
	const called = () => {
		const p = window.__directChatProbe;
		return p && typeof p.called === "number" ? p.called : 0;
	};
	const before = called();
	try {
		fn(sessionId, String(text));
	} catch (e) {
		return { ok: false, reason: "host-send-throw:" + (e && e.message) };
	}
	for (let i = 0; i < 8; i++) {
		await new Promise((r) => setTimeout(r, 60));
		if (called() > before) return { ok: true, mode: "sent", via: "host-send", verified: true };
	}
	return { ok: false, reason: "host-send-unconfirmed" };
}

/**
 * 左 → 右 主入口：把总监侧输入送到对话域
 *
 * 四级降级（保证"必定有反馈"，不会静默失败）：
 *   ① `sessionId` 有效且宿主直投口可用 → 直投对话域，`mode="sent"` / `via="host-send"`（首选）
 *   ② `autoSend=true` 且发送按钮可用    → 真正发送，`mode="sent"`
 *   ③ 否则                              → 文本已填入 composer，`mode="filled"`，由用户确认后手动发送
 *
 * @param {string} text
 * @param {{autoSend?:boolean, verify?:boolean}} [opts]
 * @returns {Promise<{ok:boolean, mode:"sent"|"filled"|"failed", reason?:string, verified?:boolean}>}
 */
export async function sendToChat(text, opts = {}) {
	const autoSend = opts.autoSend !== false;
	const filled = setComposerText(text);
	if (!filled.ok) return { ok: false, mode: "failed", reason: filled.reason };

	// 🔴 写后回读校验：确认文本真的进了受控组件
	const back = readComposerText();
	if (back !== String(text)) {
		return { ok: false, mode: "failed", reason: "readback-mismatch", verified: false };
	}

	if (!autoSend) return { ok: true, mode: "filled", verified: true };

	const sub = submitComposer();
	if (!sub.ok) return { ok: true, mode: "filled", reason: sub.reason, verified: true };

	// 提交后编辑器应被清空（原生行为）—— 作为"确实发出"的弱证据
	await new Promise((r) => setTimeout(r, 120));
	const after = readComposerText();
	return { ok: true, mode: "sent", verified: after !== null ? after === "" : null };
}

/**
 * 🔴 把一条指令**真正送达某会话的原生对话**（三级降级 + 写后回读）
 *
 * 为什么需要它（而不是直接用 `sendToChat`）：
 *   总监页是宿主 tab 环里的**独立 view**，切到它时原生 composer 多半**不在场**
 *   （`findComposer()` 返回 null，因为它要求元素有非零盒）。
 *   实测形态：在总监页 `sendToChat` 直接失败 → 用户以为"总监没把消息发出去"。
 *   ⇒ 必须允许「先切到目标会话，等 composer 出现，再投递」这条通道。
 *
 * 为什么 `opener` 由调用方注入（而不是本模块 import `logic/branch-tree.js`）：
 *   `branch-tree.js` 依赖宿主 ctx 与 split.js，本模块是**零业务依赖的 DOM 通道**。
 *   反向 import 会形成 module 环（build 期外置顺序受影响）。注入更干净、可单测。
 *
 * 判据（四级，逐级降级，**每级都给出归因**）：
 *   ① 宿主直投口可用 + 有 sessionId → 直投对话域  `via="host-send"`（首选；避开 InputBar 的「总监劫持」）
 *   ② `composer` 已在场            → 直投        `via="direct"`
 *   ③ `opener(sessionId)` 成功 + 等 → 再投        `via="open-then-send"`
 *   ④ 仍不在场                     → 失败并报因  `reason="composer-unavailable"`
 *
 * @param {string} text
 * @param {{sessionId?:string, opener?:(id:string)=>Promise<{ok:boolean,reason?:string}>,
 *          autoSend?:boolean, settleMs?:number, hostSend?:boolean}} [opts]
 * @returns {Promise<{ok:boolean, mode:"sent"|"filled"|"failed", reason?:string,
 *                    via?:string, opened?:boolean, verified?:boolean|null}>}
 */
export async function deliverToChat(text, opts = {}) {
	const r = await deliverImpl(text, opts);
	lastDeliver = { ...r, at: Date.now(), sessionId: (opts && opts.sessionId) || null };
	return r;
}

/**
 * 投递结果 → **展示等级**（`data-deliver-mode` 的取值）。**唯一实现** —— 三个展示端共用。
 *
 * 🔴 为什么必须收口（第 42 轮需求 1）：`dry-run` 曾被三个展示端**各自**折成 `filled`
 *   （写法都是 `r.mode === "sent" ? "sent" : (r.ok ? "filled" : "failed")`），
 *   于是"**测试干跑跳过**"与"**真的填进输入框等你发送**"在读数上**完全同形**
 *   ⇒ 用户抱怨的「你测试流转的时候没有标注测试」（额度被跑没、事后还分不出哪些是测试）
 *      **在读数层面根本没解决**（纪律 126：同一语义两处实现 = 隐式断链；146：判据须对可见面）。
 *
 * @param {{ok?:boolean, mode?:string}} r `deliverToChat` / `sendToChat` 的返回值
 * @returns {"sent"|"dry-run"|"filled"|"failed"}
 */
export function deliverModeOf(r) {
	if (!r) return "failed";
	if (r.mode === "sent") return "sent";
	if (r.mode === "dry-run") return "dry-run";   // 有意跳过 ≠ 送达 ≠ 失败（纪律 58）
	return r.ok ? "filled" : "failed";
}

/** `deliverToChat` 的实现体（外层包一层只为记录 `lastDeliver`） */
async function deliverImpl(text, opts = {}) {
	const t = String(text == null ? "" : text);
	if (!t.trim()) return { ok: false, mode: "failed", reason: "empty-text" };

	/* 🔴 干跑（需求 1）：**只填不发** —— 界面反馈照旧（用户/闸门都能看到文本进了输入框），
	 *    但不点发送、不直投宿主 ⇒ **零模型调用**。
	 *    返回 `mode:"dry-run"` 而不是 failed：这是**有意为之**的跳过，不是失败
	 *    （纪律 58：没跑成 ≠ 失败，两者必须可分）。 */
	if (isDryRun() && opts.autoSend !== false) {
		let filled = false;
		try { filled = Boolean(setComposerText(t)); } catch (e) { filled = false; }
		return { ok: true, mode: "dry-run", via: "composer-only", dryRun: true, filled, opened: false };
	}

	/* ① 宿主直投：指令已由插件侧处理完，应**直接**进对话域，
	 *    不再经 InputBar（否则会被宿主的旧版总监再处理一次，见 sendToHost 论证）。 */
	if (opts.autoSend !== false && opts.hostSend !== false && opts.sessionId) {
		const h = await sendToHost(opts.sessionId, t);
		if (h.ok) {
			// 投递成功 ⇒ 原生草稿已被消费；留着会变成"发完还在框里"的脏数据
			try { setComposerText(""); } catch (e) { /* composer 不在场：无需清理 */ }
			return { ok: true, mode: "sent", via: h.via, verified: h.verified, opened: false };
		}
	}

	const settle = typeof opts.settleMs === "number" ? opts.settleMs : 450;
	let composer = findComposer();
	let opened = false;

	if (!composer && typeof opts.opener === "function" && opts.sessionId) {
		try {
			const r = await opts.opener(opts.sessionId);
			opened = Boolean(r && r.ok);
		} catch (e) {
			return { ok: false, mode: "failed", reason: "open-error:" + (e && e.message), opened: false };
		}
		if (opened) await new Promise((res) => setTimeout(res, settle));
		composer = findComposer();
	}

	if (!composer) {
		return {
			ok: false, mode: "failed", reason: "composer-unavailable", opened,
			via: opened ? "open-then-send" : "direct"
		};
	}

	const r = await sendToChat(t, { autoSend: opts.autoSend !== false });
	return { ...r, opened, via: opened ? "open-then-send" : "direct" };
}

/* ── 右 → 左：产出观察 ─────────────────────────────────────────── */

/**
 * 宿主当前选中的页签名（「总监」/「对话」/「轨迹」）。
 * @returns {string|null} 读不到（宿主未挂载 tab 环）时回 `null` —— 调用方据此区分
 *   "确定不在对话页签" 与 "无从判断"，不许把两者混为一谈。
 */
export function hostTabName() {
	if (!hasDom()) return null;
	try {
		const t = document.querySelector("[role=tab][aria-selected=true]");
		return t ? String(t.textContent || "").trim() : null;
	} catch (e) { return null; }
}

/**
 * 取一个元素的**布局孩子**（穿透 `display:contents` 包裹层）。
 *
 * 🔴 为什么必须穿透（2026-09-14 `scripts/_probe-surface.mjs` 取证）：
 *    宿主在 `OrjXgq_centerSurface` 与 `RWZidW_root` 之间插了一层 **`display:contents`** 的
 *    `<div>` —— 它**不生成盒子** ⇒ `getBoundingClientRect()` 恒为 `0×0`
 *    ⇒ 原来用 `isVisible()`（宽高 > 0）过滤时它被判为"不可见"
 *    ⇒ "单子链下钻"在第一层就 `kids.length !== 1` 而中断 ⇒ `findMessageList()` 返回 `null`
 *    ⇒ R5 的对话视图只能显示降级文案（F8/F9/F11 那三条红）。
 *    判据错在"用像素面积代表存在性"—— **`display:contents` 有存在性、无盒子**。
 */
function layoutChildren(el, out) {
	const acc = out || [];
	let kids = [];
	try { kids = [...el.children]; } catch (e) { return acc; }
	for (const k of kids) {
		let disp = "";
		try { disp = window.getComputedStyle(k).display; } catch (e) { disp = ""; }
		if (disp === "contents") { layoutChildren(k, acc); continue; }
		acc.push(k);
	}
	return acc;
}

/** 元素是否真的在滚（看 `overflow-y` 声明，**不看**当前是否溢出：短会话同样用滚动容器渲染） */
function isScrollBox(el) {
	try {
		const y = window.getComputedStyle(el).overflowY;
		return y === "auto" || y === "scroll";
	} catch (e) { return false; }
}

/** 元素相对 `root` 的深度（用于在多个候选滚动容器里取**最深**那个） */
function depthFrom(root, el) {
	let d = 0, p = el;
	while (p && p !== root) { d++; p = p.parentElement; }
	return d;
}

/**
 * 应用根内**最深**的"消息滚动容器"。
 * 🔴 为什么是"最深"而不是"孩子最多"：真机实测消息滚动容器是 `f7fkwa_scroll`，
 *    它**只有 1 个孩子**（`f7fkwa_column`，真正装 76 条消息的那一层）
 *    ⇒ "孩子最多"会挑到内层非滚动容器，"最深滚动容器"才对。
 */
function deepestScroller(root) {
	let best = null, bestDepth = -1;
	let all = [];
	try { all = root.querySelectorAll("div,ul,ol"); } catch (e) { return null; }
	for (let i = 0; i < all.length; i++) {
		const el = all[i];
		try {
			if (isPluginNode(el)) continue;
			if (el.querySelector('textarea,[contenteditable="true"]')) continue;
			if (!isScrollBox(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.width < 200 || r.height < 120) continue;
			const d = depthFrom(root, el);
			if (d > bestDepth) { bestDepth = d; best = el; }
		} catch (e) { /* 单个候选失败不影响其它候选 */ }
	}
	return best;
}

/** 不是消息列表的"排除性判据"：页签环在消息列表**之外**（落回应用根时它必然在） */
function looksLikeRoot(el) {
	try { return Boolean(el.querySelector("[role=tab]")); } catch (e) { return true; }
}

/**
 * 找到"消息列表"容器。
 *
 * ── 🔴 判据演进（2026-09-14，两轮实测各自证伪了旧写法）────────────
 *   · 旧写法 = "从应用根沿**可见**单子链下钻"。两处致命问题：
 *     ① `display:contents` 包裹层被 `isVisible()` 判为不可见 ⇒ 第一层就中断 ⇒ 恒 `null`；
 *     ② 即便钻通，落点也常常是**应用根本身**（它有多可见子节点时下钻在第一步就 break），
 *        而 `cur === root ? null : cur` 只挡住了"原地不动"这一种形态
 *        ⇒ 真机曾返回 `RWZidW_root`（整个应用根，3 个孩子）并把它当消息列表
 *        ⇒ `total` 变成 3，"读到了隔壁"却**看起来有数据**（最坏的一类假绿）。
 *   · 新写法 = **先定位真正在滚的消息列，再穿透单孩子包裹层**：
 *     滚动容器（`overflow-y: auto|scroll`）是宿主消息区的结构性事实，
 *     与"会话内容多少""包裹层怎么加"都无关；落点稳定在装消息行的那一层。
 *
 * ── 页签前置（同上一版，保留）──────────────────────────────────
 *   宿主页签是**内容互换**不是隐藏 ⇒ 不在【对话】页签时消息列表必然不在场，
 *   直接 `null`（而不是返回隔壁容器当"有数据"）。
 */
export function findMessageList() {
	if (!hasDom()) return null;
	const rect = getSplitRootRect();
	if (!rect) return null;
	const root = findChatRoot();
	if (!root) return null;
	/* 页签前置：读得到页签名且不是「对话」⇒ 消息列表不在场 */
	const tab = hostTabName();
	if (tab !== null && tab !== "对话") return null;

	/** 单孩子包裹层穿透（带几何护栏：孩子必须**撑满**当前层，避免钻进某一条消息里） */
	const pierce = (from, maxGuard) => {
		let cur = from, guard = 0;
		while (cur && guard++ < (maxGuard || 8)) {
			const kids = layoutChildren(cur).filter((e) => !e.querySelector('textarea,[contenteditable=true]'));
			if (kids.length !== 1) break;
			const c = kids[0];
			let ok = true;
			try {
				const cr = c.getBoundingClientRect(), pr = cur.getBoundingClientRect();
				/* 单条消息（矮）不撑满容器 ⇒ 到此为止，`cur` 就是列表（1 条 = 1 个孩子，读数正确） */
				if (cr.height < pr.height * 0.6) ok = false;
			} catch (e) { ok = false; }
			if (!ok) break;
			cur = c;
		}
		return cur;
	};

	const scroller = deepestScroller(root);
	if (scroller) return pierce(scroller, 6);

	/* 兜底：下钻（穿透 `display:contents`）。命中的判据收紧到"**不能**落回应用根"，
	 * 因为消息列表里面绝不会有页签环。 */
	let cur = root, guard = 0;
	while (cur && guard++ < 12) {
		const kids = layoutChildren(cur).filter((e) => !e.querySelector('textarea,[contenteditable=true]'));
		if (kids.length !== 1) break;
		cur = kids[0];
	}
	if (cur === root || looksLikeRoot(cur)) return null;
	return cur;
}

/**
 * 读取当前对话的可见产出概况
 * @returns {{count:number, lastText:string, listFound:boolean}}
 */
export function readConversation() {
	const list = findMessageList();
	if (!list) return { count: 0, lastText: "", listFound: false };
	/* 🔴 用 `layoutChildren`（穿透 `display:contents` 包裹层）再按可见性过滤：
	 *    只按 `children + isVisible` 会在宿主插入 `display:contents` 包裹层时**静默漏掉整层消息**
	 *    （面积 0×0 ⇒ 被判为不可见），条数直接变 0 而没有任何报错。 */
	const items = layoutChildren(list).filter(isVisible);
	const last = items[items.length - 1];
	return {
		count: items.length,
		lastText: last ? String(last.textContent || "").trim().slice(0, 400) : "",
		listFound: true
	};
}

/**
 * 读取当前对话的**消息条目**（第 6 批需求 7 的 R5「对话」视图数据源）。
 *
 * 🔴 为什么不能直接用 `readConversation()`：它只回 `count + lastText`（一行摘要）。
 *    用户要求「点击对话的时候, r5总监消息, 变成对话的消息, **历史信息也要在**」
 *    ⇒ 需要**逐条**可渲染的消息。
 *
 * 实测（`scripts/_probe-chat-messages.mjs`，2026-09-14 真机）：
 *   消息列表 = `DIV.f7fkwa_column`，当前 **76** 条可见子节点 —— 与 `findMessageList()`
 *   的下钻结果一致（它是在"可见子节点数 ≠ 1"处 break 并把当前层返回）。
 *   ⇒ 复用同一处真相源（`findMessageList`），不另写一套下钻。
 *
 * @param {number} [limit=40] 最多回多少条（默认取**最后** 40 条：历史要看，但不必全渲染）
 * @returns {{ok:boolean, total:number, items:Array<{i:number,text:string}>, reason:string|null}}
 *   `ok=false` 时**必带 reason**（纪律 19：降级可以，无声不行）—— 别让 R5 空着还不说话。
 */
export function readConversationItems(limit) {
	const n = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.round(Number(limit)) : 40;
	const list = findMessageList();
	if (!list) return { ok: false, total: 0, items: [], reason: "未找到消息列表容器（对话区可能未挂载 / 当前不在对话页签）" };
	let els;
	try { els = layoutChildren(list).filter(isVisible); } catch (e) {
		return { ok: false, total: 0, items: [], reason: "读取消息子节点失败：" + ((e && e.message) || e) };
	}
	const start = Math.max(0, els.length - n);
	const items = [];
	for (let i = start; i < els.length; i++) {
		const el = els[i];
		let text = "";
		try { text = String(el.textContent || "").replace(/\s+/g, " ").trim(); } catch (e) { text = ""; }
		items.push({ i, text: text.slice(0, 600) });
	}
	return { ok: true, total: els.length, items, reason: null };
}

/* ══════════════════════════════════════════════════════════════════
 *  对话消息镜像（第 6 批需求 7 的真·数据源）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 宿主对话消息的**本次运行内镜像**。
 *
 * ── 🔴 为什么必须有镜像（2026-09-14 实测两条，缺一不可）──────────────
 *   ① **DOM 源在总监页签下不存在**：页签是"内容互换"不是"隐藏" ——
 *      切到【总监】时宿主消息滚动容器（`f7fkwa_scroll`）**整体卸载**
 *      （`scripts/_probe-tab-mount.mjs`：对话页签 5 个滚动容器，总监页签只剩 3 个，
 *      消息列不在其中）。而 R5 恰恰**只**在总监页签可见
 *      ⇒ "切到对话视图时现读 DOM"在结构上不可能成立。
 *   ② **逻辑层没有对话正文**：宿主 `sessions.list.getSnapshot().byId[id]` 只有会话
 *      **元数据**（id/标题/running/父会话…，取证 `dsh-client-runtime/lib/client.js:9222` `projectList`）；
 *      插件 `memoryCore.conversationHistory` 只记**用户侧**投递且本机为空
 *      （`scripts/_probe-conv-history.mjs`：`memoryCore 为空`）；
 *      `plugin-db/directorConversations` 是**总监自己的**消息，不是宿主对话。
 *   ⇒ 唯一有正文的地方就是那个 DOM，而它**只在对话页签存在**
 *   ⇒ 只能"在场时持续镜像、离场时保留上次快照"。
 *
 * ── 语义边界（不许含糊）───────────────────────────────────────────
 *   · 镜像**只累积到本次运行**（不落盘）：不新开 localStorage / DB 契约（R5 冻结键）。
 *   · `at` 是最后一次**成功同步**的时刻；`reason` 是最后一次**失败**的原因。
 *     两者分开记 ⇒ 界面才能同时说清"这是什么时候的数据"和"现在为什么没更新"。
 */
export const conversationMirror = {
	items: [], total: 0, at: 0, tab: null,
	syncs: 0, misses: 0,
	/** null = 上一次同步成功；否则是失败原因（可显示） */
	reason: "尚未同步（宿主【对话】页签未激活过）",
	/* ── 第 40 轮：落盘状态（可分辨，供面板/闸门读；不额外读盘）── */
	/** 最后一次落盘的快照（`lastUser`/`lastResult`/`pending`） */
	persisted: null,
	/** null = 落盘成功；否则是**可分辨**的原因（不是"静默没落"） */
	persistReason: "尚未落盘（宿主【对话】页签未激活过）",
	persistAt: 0
};

/**
 * 把「最后一次我发的 + 结果」落到**当前会话**的层级节点（异步 · **绝不抛**）
 *
 * 🔴 为什么必须落盘：`readConversationItems()` 读的是**当前打开会话**的 DOM，
 *    一切离开这个会话就没了。用户要的是"点文件夹就能看见**所有**对话在做什么"
 *    ⇒ 只能在"读到的那一刻"顺手存下来。
 * 🔴 为什么绝不抛：本函数在 `setInterval` 回调链上；抛出去会打断轮询
 *    （本项目已有同型事故：`startConversationMirror` 的注释记着"整条安装链被打断"）。
 * 🔴 为什么 `lastUser` 为空就不写：空快照写进去 = 用"没有"覆盖"有"
 *    ⇒ 用户会看到内容**间歇消失**，且无法归因。宁可不写。
 *
 * @param {Array} items `readConversationItems()` 的产物
 * @returns {Promise<boolean>} 是否真的落盘
 */
export function persistConversationSnapshot(items) {
	const snap = pickLastExchange(items);
	conversationMirror.persisted = snap;
	conversationMirror.persistAt = Date.now();
	if (!snap.lastUser) {
		conversationMirror.persistReason = "本次镜像里没有『我发的』消息 ⇒ 无可落（不写空快照）";
		return Promise.resolve(false);
	}
	let sid = null;
	try { sid = currentSessionId(); } catch (e) { sid = null; }
	if (!sid) {
		conversationMirror.persistReason = "拿不到当前会话 id（宿主 sessions 快照不可用）";
		return Promise.resolve(false);
	}
	return Promise.resolve()
		.then(() => loadTree())
		.then((root) => {
			const node = findNodeBySessionId(root, sid);
			if (!node) {
				conversationMirror.persistReason = "当前会话尚未同步到层级树（先跑一次「同步真实会话」）";
				return false;
			}
			const prev = (Array.isArray(node.conversations) && node.conversations[0]) || null;
			node.conversations = [mergeSnapshot(
				prev || { conversationId: sid, title: node.name }, snap, Date.now()
			)];
			return saveNode(node).then(() => {
				conversationMirror.persistReason = null;
				return true;
			});
		})
		.catch((e) => {
			conversationMirror.persistReason = "落盘失败：" + ((e && e.message) || e);
			return false;
		});
}

/**
 * 同步一次镜像。**幂等**：在场则刷新、不在场则**保留**上一次快照并记原因。
 * @param {number} [limit=60]
 * @returns {typeof conversationMirror}
 */
export function syncConversationMirror(limit) {
	conversationMirror.tab = hostTabName();
	const live = readConversationItems(limit || 60);
	if (live.ok) {
		conversationMirror.items = live.items;
		conversationMirror.total = live.total;
		conversationMirror.at = Date.now();
		conversationMirror.syncs++;
		conversationMirror.reason = null;
		/* 第 40 轮（需求 21-R21-05）：读到就落盘 —— 不 await（不拖慢轮询），
		 * 失败原因写进 `persistReason`（**不静默**，面板可显示）。 */
		try { persistConversationSnapshot(live.items); } catch (e) { /* 绝不抛穿 */ }
	} else {
		conversationMirror.misses++;
		conversationMirror.reason = live.reason;
	}
	return conversationMirror;
}

/** 镜像定时器（单例；重复调用只是换周期） */
let mirrorTimer = null;
/**
 * 启动镜像轮询。
 * 🔴 周期取 **2500ms**：`findMessageList()` 会走 `findChatRoot()`（扫 textarea + button 并量祖先几何），
 *    属"中等代价"——**不能**放进 mutation 回调（那正是本文件另一处布局抖动事故的成因），
 *    只能低频轮询。且**只在对话页签**才真正取数（其余时刻一次页签查询即返回）。
 * @param {number} [intervalMs=2500]
 * @returns {() => void} 停止函数
 */
export function startConversationMirror(intervalMs) {
	/* 🔴 本函数在 `installBatch1` 执行链上 ⇒ **绝不抛**（纪律 C）：
	 *    离线桩环境**没有** `setInterval`，第一版直接调用会把整条安装链打断
	 *    ——实测后果：其后几十项能力（个性化 / 四维流转 / 批次*）全部丢失，
	 *    外层却只看到 `TypeError: Cannot read properties of undefined (reading 'store')`
	 *    （`verify-bundle.mjs:393` 报的就是这个，**读起来与真实缺陷无关**）。
	 *    ⇒ 能力先探测，全程 try/catch，降级原因写进 `conversationMirror.reason`。 */
	const hasTimer = typeof setInterval === "function" && typeof clearInterval === "function";
	try { syncConversationMirror(60); }
	catch (e) { conversationMirror.reason = "首次同步失败：" + ((e && e.message) || e); }
	if (!hasTimer) {
		conversationMirror.reason = conversationMirror.reason || "无 setInterval（离线 / 非浏览器环境）—— 镜像未启动轮询";
		return () => {};
	}
	const ms = Number.isFinite(Number(intervalMs)) && Number(intervalMs) >= 500 ? Math.round(Number(intervalMs)) : 2500;
	try {
		if (mirrorTimer) clearInterval(mirrorTimer);
		mirrorTimer = setInterval(() => {
			try {
				/* 廉价前置：不在对话页签就**只记未命中**，不跑 findChatRoot 那一串 */
				conversationMirror.tab = hostTabName();
				if (conversationMirror.tab !== "对话") {
					conversationMirror.misses++;
					conversationMirror.reason = "宿主当前不在【对话】页签 —— 消息列表不在场（已保留上次快照）";
					return;
				}
				syncConversationMirror(60);
			} catch (e) { /* 轮询绝不抛穿（纪律 C） */ }
		}, ms);
	} catch (e) {
		conversationMirror.reason = "定时器挂载失败：" + ((e && e.message) || e);
		return () => {};
	}
	return () => { try { clearInterval(mirrorTimer); } catch (e) { /* 已停 */ } mirrorTimer = null; };
}

/**
 * 观察对话产出变化（右 → 左）
 * @param {(info:{count:number,lastText:string,delta:number})=>void} cb
 * @returns {() => void} 取消订阅
 */
export function observeConversation(cb) {
	if (!hasDom() || typeof MutationObserver === "undefined") return () => {};
	let last = readConversation();
	let timer = null;
	let mo = null;
	let retry = null;
	const fire = () => {
		const cur = readConversation();
		const delta = cur.count - last.count;
		const changed = delta !== 0 || cur.lastText !== last.lastText;
		last = cur;
		if (changed) { try { cb({ ...cur, delta }); } catch (e) { /* 订阅者异常不影响观察 */ } }
	};
	/* 🔴 挂载点**必须**优先是消息列表，不能无条件退回 `document.body`（2026-09-14）：
	 *    `findMessageList()` 现在有了"宿主不在对话页签 ⇒ 返回 null"的前置判据
	 *    ⇒ 总监页签下会落到兜底 `document.body`，那就是**全文档观察**
	 *    （流式输出期等价于把每次渲染都过一遍 debounce），与本文件另一处布局抖动事故同源。
	 *    折中（同时满足两个约束）：
	 *      · 观察器**始终**创建（契约：调用方拿得到退订函数，`verify-dialog` D18 断言这条）；
	 *      · 找不到消息列表时挂在 `body` 上但**只观察直接子节点**（`subtree:false`，代价极低），
	 *        并低频重试，一旦消息列表出现就换成真正的目标。
	 */
	mo = new MutationObserver(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(fire, 220); // 防抖：流式输出期间高频变更
	});
	const applyTarget = () => {
		const list = findMessageList();
		const target = list || document.body;
		const opts = list ? { childList: true, subtree: true, characterData: true } : { childList: true, subtree: false };
		try { mo.disconnect(); } catch (e) { /* 未挂过 */ }
		try { mo.observe(target, opts); } catch (e) { return false; }
		return Boolean(list);
	};
	if (!applyTarget()) {
		retry = setInterval(() => { if (applyTarget()) { clearInterval(retry); retry = null; fire(); } }, 1500);
	}
	return () => {
		try { mo.disconnect(); } catch (e) { /* 已断开 */ }
		if (timer) clearTimeout(timer);
		if (retry) { clearInterval(retry); retry = null; }
	};
}

/** 安装全局契约（调试与验证脚本用） */
export function installChatBridgeApi() {
	if (!hasDom()) return null;
	/* 🔴 2026-09-16 渲染进程被钉死的根因修复：**真幂等** —— 已装过就直接返回同一对象。
	 * 本函数被 `components/DirectorDialog.js` 的**渲染体**调用（`installChatBridgeApi(); // 幂等`），
	 * 而那个"幂等"只保证了 `window.__dshChatBridge` 被重复赋值，**没有拦住日志**：
	 * 每渲染一次就 `dshLog` 一次 ⇒ `bridgeDebugLogToFile` 把它桥到 `appendLogLine()`
	 * （读全文 → 拼一行 → 重写全文的 O(n) 写）⇒ 变成"每渲染一次重写整份日志"的 I/O 风暴。
	 * 宿主流式生成期间组件高频重渲染，代价随日志长度线性增长 ⇒ 渲染进程数分钟无响应。
	 * 真机抓栈（logs/pause-on-hang.log，由 `scripts/_probe-pause-on-hang.mjs` 用
	 * `Debugger.pause` 中断 V8 取得）：
	 *   format ← dbg.<computed> ← dshLog ← installChatBridgeApi ← DirectorDialog ← React
	 * 复现是**偶发**的（取决于日志体积与重渲染频率），所以只靠重跑验不出来 —— 必须结构性切断。
	 * 语义不变：`window.__dshChatBridge` 仍是同一形状的对象（宿主 / 闸门只读它的字段）。 */
	if (window.__dshChatBridge) return window.__dshChatBridge;
	const api = {
		SEND_ARIA, COMPOSER_PLACEHOLDER,
		findComposer, findSendButton, findMessageList, hostTabName,
		setComposerText, readComposerText, submitComposer, sendToChat, sendToHost, deliverToChat, getLastDeliver,
		isAgentGenerating,
		readConversation, observeConversation,
		/* 第 6 批需求 7：R5「对话」视图的数据源与镜像（闸门 / 探针要用，**不要改名**） */
		readConversationItems, conversationMirror, syncConversationMirror, startConversationMirror,
		/* 🔴 第 42 轮（需求 1）：干跑开关 —— 真机套件启动时置 true，
		 *    即可让所有"流转"只填不发 ⇒ **不消耗模型额度**。 */
		setDryRun, isDryRun
	};
	window.__dshChatBridge = api;
	dshLog("bridge", "chat-bridge 已安装（composer 锚点：" + COMPOSER_PLACEHOLDER + " / " + SEND_ARIA + "）");
	return api;
}
