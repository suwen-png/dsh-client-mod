/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：把插件控件注入**宿主底部统计行之前**
 * 引用：批次 1
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：util/dom-style.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/host-composer-slot.js — 把插件控件注入**宿主底部统计行之前**
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求来源（第 6 批 · 需求 7 原话）
 * ══════════════════════════════════════════════════════════════════
 *  「[图6] 这一列的 总监和对话切换的部分, 放到 [图7] 最下面 "58 轮 · 58 步" 之前,
 *    只用一个按钮位置, 点击切换, 比如默认显示总监, 点击显示对话,
 *    点击对话的时候, r5 总监消息, 变成对话的消息, 历史信息也要在」
 *
 * ── 落点实测（`scripts/_probe-stats-row.mjs`，2026-09-14 真机）────────
 *   统计行**在宿主 composer 内**，且祖先链是：
 *     `SPAN「58 轮 · 58 步」` → `DIV._6sWLG_root`(9 个 span) → `DIV` → `DIV.FVE3va_root`
 *     → `DIV.RWZidW_composerStack` → `DIV.RWZidW_composerSeat`
 *   该 composer 是**常驻**的（总监页与对话页都在：总监页 `dp-root` 到 y=691，
 *   composer 从 y=690 起）⇒ 注入一次即可两页共存。
 *   ⇒ 插到 `DIV._6sWLG_root` 里、统计 span **之前** = 视觉上就是
 *     「…之前 '58 轮 · 58 步'」，与用户原话逐字吻合。
 *
 * ── 🔴 为什么要"锚点跟随"而不是插一次就完事 ──────────────────────────
 *   宿主 composer 会随「是否在生成 / 统计项增减」**重渲染**。React 只认自己创建
 *   的节点，我们插进去的节点**不会被它删**（它按 fiber 记账），但只要宿主重建了
 *   `._6sWLG_root` 本身，旧容器整体消失、我们的节点就跟着成了孤儿。
 *   ⇒ 每次 sync 都用**当前**统计行重新验活 + 归位（`bar.parentElement !== statsRow`
 *     或 `bar.nextElementSibling !== statSpan` 就重新 insertBefore）。
 *
 * ── 护栏 ─────────────────────────────────────────────────────────
 *   · 注入节点带 `data-dsh-plugin` + `data-testid="dp-*"` ⇒ 被
 *     `host-panel-trim.js` 的 `PLUGIN_GUARD_SELECTOR` 护住，不会被自己人裁掉。
 *   · **绝不抛**（在 `installBatch1` 执行链上）；失败写 `composerSlotState.reason`。
 *   · 官方按钮一律 `stopPropagation`：宿主 composer 有自己的点击处理（聚焦输入框），
 *     不拦会在点按钮时顺手把焦点抢走。
 *
 * ── 事件契约 ─────────────────────────────────────────────────────
 *   本模块**不认识 React**，只负责 DOM 与事件；行为由插件侧注入：
 *     `setHostComposerHandlers({ getView, onToggleScope, onDeliver, onRegister, canDeliver })`
 *   （单向依赖：组件 → 本模块，本模块不反向 import 组件。）
 *
 * 诊断：`window.__dshHostComposerSlot`
 */

import { pxOf } from "../util/dom-style.js";

export const SCOPE_BAR_ID = "dsh-host-scope-bar";
export const SCOPE_TOGGLE_ID = "dsh-host-scope-toggle";
export const HOST_DELIVER_ID = "dsh-host-deliver";
export const HOST_REGISTER_ID = "dsh-host-register";

/** 统计行文本判据：「N 轮 · N 步」（宿主 client.js:7770 `"{turns} 轮 · {steps} 步"`） */
const STATS_RE = /^\d+\s*轮\s*·\s*\d+\s*步$/;

export const composerSlotState = {
	installed: false,
	/** 注入点在 DOM 且在位（`nextElementSibling` 就是统计 span） */
	inPlace: false,
	/** 锚点跟随次数（宿主重建后重新归位的次数；>0 说明"插一次"是不够的） */
	rescued: 0,
	toggleClicks: 0, deliverClicks: 0, registerClicks: 0,
	/** 当前视图（由插件侧 handler 提供；"director" | "chat"） */
	view: "director",
	observer: false,
	scans: 0, skipped: 0,
	reason: null, degraded: false
};

function degrade(reason) {
	composerSlotState.degraded = true;
	composerSlotState.reason = String(reason);
	return false;
}
function heal() { composerSlotState.degraded = false; composerSlotState.reason = null; }

const hasDom = () => typeof window !== "undefined" && typeof document !== "undefined"
	&& typeof document.querySelector === "function";

/* ── 行为契约（插件侧注入；未注入时按钮仍可见但会说明原因）── */
let handlers = {
	getView: () => composerSlotState.view,
	onToggleScope: null,
	onDeliver: null,
	onRegister: null,
	canDeliver: () => false
};

export function setHostComposerHandlers(next) {
	if (!next || typeof next !== "object") return handlers;
	handlers = { ...handlers, ...next };
	syncHostComposerSlot();
	return handlers;
}

/** 找统计行本身（那枚 `SPAN`）。带缓存：`isConnected` 失效才重扫 */
export function findStatsSpan() {
	if (!hasDom()) return null;
	try {
		if (statsRef && statsRef.isConnected && STATS_RE.test(String(statsRef.textContent || "").trim())) return statsRef;
		statsRef = null;
		const all = document.querySelectorAll("div,span");
		for (let i = 0; i < all.length; i++) {
			const e = all[i];
			if (e.children.length !== 0) continue;
			const t = String(e.textContent || "").trim();
			if (!STATS_RE.test(t)) continue;
			/* 护栏：不能是插件自己的东西 */
			if (e.closest("#" + SCOPE_BAR_ID)) continue;
			statsRef = e;
			return e;
		}
		return null;
	} catch (e) { return null; }
}

function mkBtn(id, testid, label, title) {
	const b = document.createElement("button");
	b.id = id;
	b.setAttribute("data-testid", testid);
	b.setAttribute("data-dsh-plugin", "1");
	b.type = "button";
	b.textContent = label;
	b.title = title;
	Object.assign(b.style, pxOf({
		border: "1px solid var(--dp-line, #3d4148)", borderRadius: "var(--dp-radius-sm, 5px)",
		background: "transparent", color: "var(--dp-t2, #b6bcc6)", cursor: "pointer",
		font: "600 10px/1 ui-monospace,Consolas,monospace", padding: "2px 7px", height: 18,
		marginRight: 6, flex: "0 0 auto"
	}));
	return b;
}

function bindOnce(el, fn) {
	if (!el || el.getAttribute("data-dsh-bound")) return;
	el.setAttribute("data-dsh-bound", "1");
	el.addEventListener("click", (e) => {
		/* 宿主 composer 自己也监听点击（聚焦输入框）—— 不拦会把焦点抢走 */
		try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
		try { fn(); } catch (err) { /* 单个按钮异常不影响其它 */ }
	});
}

/** 建/重建注入条（只在缺件时建，不每次都重建 —— 重建会丢掉焦点与 hover 态） */
function ensureBar(statsSpan) {
	let bar = document.getElementById(SCOPE_BAR_ID);
	if (!bar || !bar.isConnected) {
		bar = document.createElement("div");
		bar.id = SCOPE_BAR_ID;
		bar.setAttribute("data-testid", "dp-host-scope-bar");
		bar.setAttribute("data-dsh-plugin", "1");
		Object.assign(bar.style, pxOf({ display: "flex", alignItems: "center", flex: "0 0 auto" }));
		bar.appendChild(mkBtn(SCOPE_TOGGLE_ID, "dp-host-scope-toggle", "总监",
			"点击切换：R5 显示总监五步消息 / 对话消息（含历史）"));
		bar.appendChild(mkBtn(HOST_DELIVER_ID, "dp-host-deliver", "执行",
			"经总监处理并发送到对话"));
		bar.appendChild(mkBtn(HOST_REGISTER_ID, "dp-host-register", "登记流转",
			"把输入框里这句话登记为一条流转"));
		bindOnce(bar.querySelector("#" + SCOPE_TOGGLE_ID), () => {
			composerSlotState.toggleClicks++;
			if (typeof handlers.onToggleScope === "function") handlers.onToggleScope();
			else composerSlotState.reason = "未注入 onToggleScope（插件侧尚未接线）";
			syncHostComposerSlot();
		});
		bindOnce(bar.querySelector("#" + HOST_DELIVER_ID), () => {
			composerSlotState.deliverClicks++;
			if (typeof handlers.onDeliver === "function") handlers.onDeliver();
		});
		bindOnce(bar.querySelector("#" + HOST_REGISTER_ID), () => {
			composerSlotState.registerClicks++;
			if (typeof handlers.onRegister === "function") handlers.onRegister();
		});
		/* ⚠️ 标记"这是我们的"，供 PLUGIN_GUARD_SELECTOR 识别（它认 data-dsh-plugin） */
	}
	/* 归位：必须在统计 span **之前** */
	try {
		const parent = statsSpan.parentElement;
		if (!parent) return bar;
		if (bar.parentElement !== parent || bar.nextElementSibling !== statsSpan) {
			if (bar.parentElement) composerSlotState.rescued++;
			parent.insertBefore(bar, statsSpan);
		}
	} catch (e) { degrade("归位失败：" + ((e && e.message) || e)); }
	return bar;
}

/**
 * 同步（幂等）：找统计行 → 保证注入条在它前面 → 刷新按钮文案/可用性 → 验活。
 * **绝不抛**（在 `installBatch1` 执行链上）。
 */
export function syncHostComposerSlot() {
	if (!hasDom() || typeof document.createElement !== "function") return degrade("无 document / createElement");
	composerSlotState.scans++;
	const span = findStatsSpan();
	if (!span) {
		/* 宿主 composer 未挂载（例如全屏浮层盖住 / 刚启动）—— 不是降级，等下一次 sync */
		composerSlotState.inPlace = false;
		return false;
	}
	ensureBar(span);
	let bar = null;
	try { bar = document.getElementById(SCOPE_BAR_ID); } catch (e) { bar = null; }
	if (!bar || !bar.isConnected) return degrade("注入条未建立");
	composerSlotState.installed = true;
	composerSlotState.inPlace = bar.nextElementSibling === span;
	try {
		const view = String((handlers.getView && handlers.getView()) || "director");
		composerSlotState.view = view;
		/* 🔴 2026-09-16：**幂等写入** —— 只在值真的不同时才写 DOM。
		 * 旧写法无条件赋值（textContent / style 每轮都写）⇒ 每次 sync 都制造 mutation
		 * ⇒ MutationObserver → scheduleSync → sync → 再 mutation …… 自激反馈环。
		 * 真机表现（verify-flow）：渲染进程 8s 内不响应（CDP_TIMEOUT）、整轮 19 分钟，
		 * 而同一版代码在环被切断前是 1m15s / 80/80。写入前先比对是切断这个环的最小改动。 */
		const setIfDiff = (el, attr, val) => { if (el.getAttribute(attr) !== val) el.setAttribute(attr, val); };
		const cssIfDiff = (el, prop, val) => { if (el.style[prop] !== val) el.style[prop] = val; };
		const tg = bar.querySelector("#" + SCOPE_TOGGLE_ID);
		if (tg) {
			const isDirector = view !== "chat";
			const wantTxt = isDirector ? "总监" : "对话";
			if (tg.textContent !== wantTxt) tg.textContent = wantTxt;
			setIfDiff(tg, "data-view", isDirector ? "director" : "chat");
			const wantTitle = isDirector
				? "当前 R5 显示【总监】五步消息 —— 点击切到【对话】消息（含历史）"
				: "当前 R5 显示【对话】消息 —— 点击切回【总监】五步消息";
			if (tg.title !== wantTitle) tg.title = wantTitle;
			cssIfDiff(tg, "color", isDirector ? "var(--dp-ac, #b794f6)" : "#79a8ff");
			cssIfDiff(tg, "borderColor", isDirector ? "var(--dp-ac-line, rgba(137,87,229,.45))" : "rgba(47,111,235,.5)");
		}
		const dv = bar.querySelector("#" + HOST_DELIVER_ID);
		if (dv) {
			const ok = Boolean(handlers.canDeliver && handlers.canDeliver());
			setIfDiff(dv, "aria-disabled", ok ? "false" : "true");
			cssIfDiff(dv, "opacity", ok ? "1" : "0.6");
		}
		heal();
	} catch (e) { degrade("刷新文案失败：" + ((e && e.message) || e)); }
	return true;
}

let observer = null;
let syncTimer = null;
/** 缓存统计行引用（`isConnected` 失效即重找）—— 避免每次 sync 全文扫 `div,span` */
let statsRef = null;

/**
 * 限流合并（**不是微任务合并**）。
 * 🔴 与 `bridge/host-director-column.js` 同一个事故：宿主流式输出期间 mutation 成百上千次，
 *    微任务合并 ⇒ 每次都跑一遍 `querySelectorAll("div,span")` 全文扫描 + 强制布局 ⇒
 *    **布局抖动**、渲染进程 8s 无响应。⇒ 时间限流 160ms，代价值与事件频率解耦。
 */
function scheduleSync() {
	if (syncTimer) return;
	syncTimer = setTimeout(() => { syncTimer = null; syncHostComposerSlot(); }, 160);
}

/**
 * 廉价判据：**不查全文档**，只认"我那一段还在不在、位置对不对"。
 * ⚠️ 这里刻意**不校验文案**（那要读 DOM 文本）：文案由 store 驱动，
 *    会在下一次真实 sync 时刷新；廉价路径只保证"结构在位"。
 */
function cheapOk() {
	if (!hasDom()) return false;
	const bar = document.getElementById(SCOPE_BAR_ID);
	if (!bar || !bar.isConnected) return false;
	const nx = bar.nextElementSibling;
	if (!nx || nx.tagName !== "SPAN") return false;
	return true;
}


/** 安装（幂等）。**绝不抛** */
export function installHostComposerSlot() {
	if (!hasDom() || typeof document.createElement !== "function") {
		degrade("无 document（离线桩 / 非浏览器环境）");
		if (typeof window !== "undefined") window.__dshHostComposerSlot = api();
		return false;
	}
	let fresh = false;
	if (!observer && typeof window.MutationObserver === "function") {
		try {
			/* 🔴 回调里**只做廉价判断**（见 `scheduleSync` 的事故说明）—— 绝不全文扫描。 */
			observer = new window.MutationObserver(() => {
				if (cheapOk()) { composerSlotState.skipped++; return; }
				scheduleSync();
			});
			observer.observe(document.body, { childList: true, subtree: true });
			composerSlotState.observer = true;
			fresh = true;
		} catch (e) { observer = null; degrade("MutationObserver 挂载失败：" + ((e && e.message) || e)); }
	}
	try { syncHostComposerSlot(); } catch (e) { degrade("首装失败：" + ((e && e.message) || e)); }
	if (typeof window !== "undefined") window.__dshHostComposerSlot = api();
	return fresh;
}

/** 全量还原（负向对照用）：把注入条摘掉、断开观察器 */
export function restoreHostComposerSlot() {
	try { if (observer) { observer.disconnect(); observer = null; composerSlotState.observer = false; } } catch (e) { /* ignore */ }
	try {
		const bar = document.getElementById(SCOPE_BAR_ID);
		if (bar && bar.parentElement) bar.parentElement.removeChild(bar);
	} catch (e) { /* ignore */ }
	composerSlotState.installed = false;
	composerSlotState.inPlace = false;
	composerSlotState.degraded = false;
	composerSlotState.reason = null;
	statsRef = null;
	if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
	return true;
}

function api() {
	return {
		SCOPE_BAR_ID, SCOPE_TOGGLE_ID, HOST_DELIVER_ID, HOST_REGISTER_ID,
		composerSlotState,
		findStatsSpan, syncHostComposerSlot, setHostComposerHandlers,
		installHostComposerSlot, restoreHostComposerSlot
	};
}

/** 全局契约（调试 / 验证脚本用，不可改名） */
export function installHostComposerSlotApi() {
	if (!hasDom()) return null;
	window.__dshHostComposerSlot = api();
	return window.__dshHostComposerSlot;
}
