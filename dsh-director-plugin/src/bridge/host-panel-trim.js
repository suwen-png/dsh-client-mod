/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：显示层裁剪宿主残留区块
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * bridge/host-panel-trim.js — 显示层裁剪宿主残留区块
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求来源（2026-09-14 第 4 批 · 用户原话）
 * ══════════════════════════════════════════════════════════════════
 *   「去掉，那目前只在页面上不显示就行，如果有后端逻辑就保留，没有不用管」
 *
 *  目标区块在**宿主**里：`workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`
 *     · 7337–7340  「总监对话」标题行（含一个 `—` 折叠按钮）
 *     · 7342–7357  「智能体 · 点击创建分支」标签 + 5 颗智能体按钮
 *
 * ── 🔴 为什么是"显示层裁剪"而不是删那段宿主代码 ────────────────────
 *   ① `workspace/**` 被 `.gitignore` 排除 ⇒ 改它**git 无法回滚**（本项目已列为高风险操作）；
 *   ② 用户明确说「只在页面上不显示就行」—— 目标是**用户看不到**，不是"代码不存在"；
 *   ③ 「如果有后端逻辑就保留」：实测那 5 颗按钮的 onClick 调的是 `handleAgentClick`，
 *      而该函数在当前构建里**已无定义**（`DirectorView` 随 MOD-B 退坡时被删，
 *      如今全文件只剩 7347 行一个悬空引用）⇒ 点击必抛 ReferenceError，
 *      **不存在需要保留的后端逻辑**。故裁剪它不会让任何能力失效。
 *
 * ── 裁剪口径（只隐"块"，不隐"字"）────────────────────────────────
 *   按**叶子元素的完整文本**定位（`textContent` 去空白后全等），再上溯一层拿到块容器：
 *     · 「智能体 · 点击创建分支」的父级 = 标签 + 按钮行的整块
 *     · 「总监对话」的父级           = 标题 + `—` 按钮的整行
 *   ⚠️ 用"全等"而不是"包含"：宿主里还有「总监记忆」「总监面板」等相邻文案，
 *      用包含匹配会把不该动的块一起吃掉。
 *
 * ── 护栏（缺一条就会误伤）──────────────────────────────────────────
 *   ① **必须落在宿主"总监面板"内** —— 判据是该元素能 `closest('[style*="min-width: 180px"]')`
 *      到（client.js:7330 给面板列写了 `minWidth: 180`）。面板之外的同名文字一律不碰。
 *   ② 只对**叶子**元素生效（`children.length === 0`），不会命中外层大容器。
 *   ③ `display:none` 不会被 React 还原：该属性从来不在宿主组件的 style prop 里，
 *      而 React 的 style diff 只增删**自己写过的**键 ⇒ 我们的隐藏是"外来且稳定"的。
 *      （宿主若整块重挂载，节点重建 ⇒ MutationObserver 会重新贴上，见下。）
 *
 * ── 可逆（负向对照纪律）────────────────────────────────────────────
 *   `restoreHostPanelTrim()` 把 `display` 还原成裁剪前的原值（不是一律删 —— 纪律 26：
 *   动别人状态前先读原值，恢复按"原来怎么设的"）。有了它才能做"裁剪→还原→再裁剪"
 *   的正负对照，而不是只能目测一次。
 *
 * 诊断：`window.__dshHostPanelTrim`（调试与验证脚本用）
 */

const hasWindow = typeof window !== "undefined" && typeof document !== "undefined";

/** 被隐掉的块打的标记（既是幂等判据，也是"这块是被我们隐的"的证据） */
export const TRIM_MARK = "data-dsh-trimmed";

/**
 * 裁剪目标（**唯一真相源**：文本 + 上溯层数 + 为什么）。
 * ⚠️ 文本按宿主当前构建抄录；宿主改文案 ⇒ 这里失效（表现为"那两行又回来了"，
 *    不会静默误伤别的块 —— 因为判据是全等 + 面板护栏）。
 */
export const TRIM_TARGETS = Object.freeze([
	{
		key: "host-agent-row",
		text: "智能体 · 点击创建分支",
		up: 1,
		why: "宿主残留的智能体按钮行；其 onClick 指向的 handleAgentClick 已无定义（点击必抛），无后端逻辑可保留"
	},
	{
		key: "host-director-chat-title",
		text: "总监对话",
		up: 1,
		why: "宿主残留的标题行；对话页的总监面板已由插件接管，这行只是重复标题 + 一个折叠按钮"
	}
]);

/** 宿主总监面板的作用域护栏选择器（client.js:7330 的 `minWidth: 180`） */
export const PANEL_GUARD_SELECTOR = '[style*="min-width: 180px"]';

/** 裁剪状态（供断言读；不编 —— 只有真的贴上去了才计数） */
export const trimState = {
	applied: [], restored: 0, scans: 0, observer: false, skipped: 0,
	/** 降级原因（null = 一切正常）。**降级可以，无声不行**（纪律 19）：读不到就在这里说清 */
	reason: null,
	/** 是否已降级（离线桩环境 / body 未就绪 / DOM 接口缺失） */
	degraded: false
};

/** 把降级原因记下来（可见、可断言），而不是静默 return */
function degrade(reason) {
	trimState.degraded = true;
	trimState.reason = String(reason);
	return [];
}

/** 文档是否具备裁剪所需的 DOM 能力（离线桩常缺 querySelectorAll / body） */
function domUsable(doc) {
	return Boolean(doc && typeof doc.querySelectorAll === "function");
}

/** 元素是否是"文本全等且无子元素"的叶子 */
function isLeafWithText(el, text) {
	if (!el || el.children.length !== 0) return false;
	return String(el.textContent || "").trim() === text;
}

/**
 * 扫一遍文档，找出该隐的块。
 * @returns {Array<{key:string, node:Element}>}
 */
export function findTrimTargets(root) {
	const doc = root || (hasWindow ? document : null);
	/* 🔴 2026-09-14 实战教训（本模块第一版就是因此把整条安装链打断的）：
	 *   `verify-bundle.mjs` 的离线桩里 **`document` 存在但 `querySelectorAll` 不存在**
	 *   ⇒ 原来的裸调用直接抛穿 `installBatch1()`，被 apply 的外层 try/catch 吞掉后
	 *   表现为「apply 返回 null + 后面 60 多项级联 FAIL」，**看起来像插件整体坏了**。
	 *   故：入口先验能力，不可用就**带着原因降级**，绝不抛。 */
	if (!domUsable(doc)) return degrade("document.querySelectorAll 不可用（离线桩 / 无 DOM 环境）");
	const out = [];
	const seen = new Set();
	let nodes;
	try {
		nodes = doc.querySelectorAll("div,span");
	} catch (e) {
		return degrade("querySelectorAll 抛错：" + ((e && e.message) || e));
	}
	for (let i = 0; i < nodes.length; i++) {
		const el = nodes[i];
		for (const t of TRIM_TARGETS) {
			if (seen.has(t.key)) continue;
			if (!isLeafWithText(el, t.text)) continue;
			let node = el;
			for (let k = 0; k < t.up && node; k++) node = node.parentElement;
			if (!node) continue;
			/* 护栏①：必须在宿主总监面板内（面板之外的同名文字不碰，避免误伤别处 UI） */
			try {
				if (!node.closest(PANEL_GUARD_SELECTOR)) continue;
			} catch (e) { continue; }
			seen.add(t.key);
			out.push({ key: t.key, node });
		}
		if (seen.size === TRIM_TARGETS.length) break;
	}
	return out;
}

/**
 * 应用裁剪（幂等）。已隐过的块**先读原值**再隐，供 restore 精确还原。
 * ⚠️ 本函数**绝不抛** —— 它是安装链上的一环，抛一次会让后面几十个能力全丢。
 * @returns {string[]} 本次贴上的 key 列表
 */
export function applyHostPanelTrim() {
	if (!hasWindow || !domUsable(document)) return [];
	trimState.scans++;
	let hits;
	try {
		hits = findTrimTargets(document);
	} catch (e) {
		return degrade("扫描失败：" + ((e && e.message) || e));
	}
	for (const h of hits) {
		try {
			if (h.node.getAttribute(TRIM_MARK)) continue; // 已隐，别覆盖原值备份
			h.node.setAttribute("data-dsh-trim-prev-display", h.node.style.display || "");
			h.node.style.display = "none";
			h.node.setAttribute(TRIM_MARK, h.key);
			trimState.applied.push(h.key);
		} catch (e) {
			degrade("贴标记失败：" + ((e && e.message) || e));
		}
	}
	return hits.map((h) => h.key);
}

/**
 * 还原裁剪（负向对照用）：把 `display` 写回**裁剪前读到的原值**。
 * @returns {number} 还原了几个节点
 */
export function restoreHostPanelTrim() {
	if (!hasWindow || !domUsable(document)) return 0;
	let marked;
	try {
		marked = document.querySelectorAll("[" + TRIM_MARK + "]");
	} catch (e) {
		degrade("还原扫描失败：" + ((e && e.message) || e));
		return 0;
	}
	let n = 0;
	for (let i = 0; i < marked.length; i++) {
		const el = marked[i];
		el.style.display = el.getAttribute("data-dsh-trim-prev-display") || "";
		el.removeAttribute(TRIM_MARK);
		el.removeAttribute("data-dsh-trim-prev-display");
		n++;
	}
	trimState.restored += n;
	return n;
}

/** 已贴上的标记是否都还挂在文档里（宿主整块重挂载 ⇒ 标记丢失 ⇒ 需要重扫） */
function markersAlive() {
	if (!domUsable(document)) return true; // 无 DOM ⇒ 不重扫（也不报"丢了"）
	const marked = document.querySelectorAll("[" + TRIM_MARK + "]");
	if (marked.length < TRIM_TARGETS.length) return false;
	for (let i = 0; i < marked.length; i++) if (!marked[i].isConnected) return false;
	return true;
}

let observer = null;
let timer = null;

/**
 * 安装裁剪（挂 MutationObserver 持续保持）。
 * 🔴 代价控制：每次 DOM 变动**先看标记还在不在**，都在就直接返回，不做全量扫描
 *    （宿主页面 DOM 很大，每帧全扫会拖慢界面）。
 * 🔴 **绝不抛**：本函数在 `installBatch1` 的执行链上，抛一次就会让其后几十项能力全部丢失
 *    （2026-09-14 已实测踩到一次）。任何失败都只记 `trimState.reason` 并降级。
 * @returns {boolean} 是否新装（幂等）
 */
export function installHostPanelTrim() {
	if (!hasWindow || typeof window.MutationObserver !== "function") {
		degrade("无 window / MutationObserver（离线桩或非浏览器环境）");
		if (typeof window !== "undefined") window.__dshHostPanelTrim = api();
		return false;
	}
	try {
		applyHostPanelTrim();
	} catch (e) {
		degrade("首次应用失败：" + ((e && e.message) || e));
	}
	if (observer) return false;
	try {
		observer = new window.MutationObserver(() => {
			if (timer) return;
			timer = setTimeout(() => {
				timer = null;
				try {
					if (markersAlive()) { trimState.skipped++; return; }
					applyHostPanelTrim();
				} catch (e) { /* 裁剪失败不影响宿主与插件任何功能 */ }
			}, 300);
		});
		observer.observe(document.body, { childList: true, subtree: true });
		trimState.observer = true;
	} catch (e) {
		/* body 未就绪 / 观察失败 —— 降级为"一次性裁剪"，不阻断安装链 */
		observer = null;
		degrade("MutationObserver 挂载失败：" + ((e && e.message) || e));
	}
	if (typeof window !== "undefined") window.__dshHostPanelTrim = api();
	return true;
}

/** 卸载（测试/排障用） */
export function uninstallHostPanelTrim() {
	if (observer) { observer.disconnect(); observer = null; }
	if (timer) { clearTimeout(timer); timer = null; }
	trimState.observer = false;
	return true;
}

function api() {
	return {
		TRIM_MARK, TRIM_TARGETS, PANEL_GUARD_SELECTOR, trimState,
		findTrimTargets, applyHostPanelTrim, restoreHostPanelTrim,
		installHostPanelTrim, uninstallHostPanelTrim
	};
}

/** 全局契约（调试 / 验证脚本用，不可改名） */
export function installHostPanelTrimApi() {
	if (!hasWindow) return null;
	window.__dshHostPanelTrim = api();
	return window.__dshHostPanelTrim;
}
