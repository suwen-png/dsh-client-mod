/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）
 * 引用：要求 5 · 要求 3
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, mount.js
 * 下游：bridge/split.js, util/debug.js
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

import { getSplitRootRect, findChatRoot } from "./split.js";
import { dshLog } from "../util/debug.js";

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

/**
 * 提交 composer
 * @returns {{ok:boolean, reason?:string, via?:string}}
 */
export function submitComposer() {
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

/** `deliverToChat` 的实现体（外层包一层只为记录 `lastDeliver`） */
async function deliverImpl(text, opts = {}) {
	const t = String(text == null ? "" : text);
	if (!t.trim()) return { ok: false, mode: "failed", reason: "empty-text" };

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

/** 找到"消息列表"容器（沿 viewArea 的单子节点链下钻） */
export function findMessageList() {
	const rect = getSplitRootRect();
	if (!rect) return null;
	const root = findChatRoot();
	if (!root) return null;
	// 消息列表 = 应用根内"高度占主体、且不含 composer 编辑器"的最深单子链末端
	let cur = root;
	let guard = 0;
	while (cur && guard++ < 12) {
		const kids = [...cur.children].filter((e) => isVisible(e));
		if (kids.length !== 1) break;
		if (kids[0].querySelector("textarea,[contenteditable=true]")) break;
		cur = kids[0];
	}
	return cur === root ? null : cur;
}

/**
 * 读取当前对话的可见产出概况
 * @returns {{count:number, lastText:string, listFound:boolean}}
 */
export function readConversation() {
	const list = findMessageList();
	if (!list) return { count: 0, lastText: "", listFound: false };
	const items = [...list.children].filter(isVisible);
	const last = items[items.length - 1];
	return {
		count: items.length,
		lastText: last ? String(last.textContent || "").trim().slice(0, 400) : "",
		listFound: true
	};
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
	const fire = () => {
		const cur = readConversation();
		const delta = cur.count - last.count;
		const changed = delta !== 0 || cur.lastText !== last.lastText;
		last = cur;
		if (changed) { try { cb({ ...cur, delta }); } catch (e) { /* 订阅者异常不影响观察 */ } }
	};
	const mo = new MutationObserver(() => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(fire, 220); // 防抖：流式输出期间高频变更
	});
	const target = findMessageList() || document.body;
	mo.observe(target, { childList: true, subtree: true, characterData: true });
	return () => { try { mo.disconnect(); } catch (e) { /* 已断开 */ } if (timer) clearTimeout(timer); };
}

/** 安装全局契约（调试与验证脚本用） */
export function installChatBridgeApi() {
	if (!hasDom()) return null;
	const api = {
		SEND_ARIA, COMPOSER_PLACEHOLDER,
		findComposer, findSendButton, findMessageList,
		setComposerText, readComposerText, submitComposer, sendToChat, sendToHost, deliverToChat, getLastDeliver,
		isAgentGenerating,
		readConversation, observeConversation
	};
	window.__dshChatBridge = api;
	dshLog("bridge", "chat-bridge 已安装（composer 锚点：" + COMPOSER_PLACEHOLDER + " / " + SEND_ARIA + "）");
	return api;
}
