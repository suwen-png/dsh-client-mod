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

/** 发送按钮的语义锚点（实测值，勿改成类名） */
export const SEND_ARIA = "发送消息";
/** composer 编辑器占位文案（实测值；命中不到时退回"任意可见 textarea"） */
export const COMPOSER_PLACEHOLDER = "给智能体发消息";

function isVisible(el) {
	if (!el || !el.getBoundingClientRect) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}

/** 找到 composer 编辑器 */
export function findComposer() {
	if (!hasDom()) return null;
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
 * 左 → 右 主入口：把总监侧输入送到对话域
 *
 * 两级降级（保证"必定有反馈"，不会静默失败）：
 *   ① `autoSend=true` 且发送按钮可用 → 真正发送，`mode="sent"`
 *   ② 否则 → 文本已填入 composer，`mode="filled"`，由用户确认后手动发送
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
		setComposerText, readComposerText, submitComposer, sendToChat,
		readConversation, observeConversation
	};
	window.__dshChatBridge = api;
	dshLog("bridge", "chat-bridge 已安装（composer 锚点：" + COMPOSER_PLACEHOLDER + " / " + SEND_ARIA + "）");
	return api;
}
