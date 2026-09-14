/**
 * cdp-mouse.mjs — 真实鼠标命中测试 / 真实点击（Input.dispatchMouseEvent）
 *
 * 【为什么必须单独有这个工具】
 *   1) e2e 里普遍用 element.click()。它是**程序化派发**：不看 z-index、不看遮挡、
 *      祖先 pointer-events:none 也照样触发 —— 只要能拿到元素引用就一定能"点到"。
 *      真人点鼠标走浏览器**命中测试（hit test）**：谁在最上层谁收事件。
 *   2) 更要命的一种：**点击本身会改变布局**。本工具第一版一次性采集所有目标坐标，
 *      点完「保存」后按钮变宽 27px、整条顶栏右移，后续点击全部落在旧坐标上，
 *      于是报出"好几个按钮点了没反应"的**假故障**（真人手点同样会点空，
 *      但原因是按钮跑了，不是按钮坏了 —— 两者修法完全不同）。
 *      ⇒ 坐标必须**现取现用**；同时报告"点完之后谁位移了"。
 *
 * 用法：
 *   node scripts/cdp-mouse.mjs hit   <目标...>      # 命中测试：是否被遮挡、被谁遮挡
 *   node scripts/cdp-mouse.mjs click <目标...>      # 真实点击 + 前后状态差异 + 顶栏位移
 *   node scripts/cdp-mouse.mjs sweep <容器testid>   # 遍历容器内所有 button 逐个真实点击
 *
 * <目标> 可写 data-testid 名（ds-save）或任意 CSS 选择器。
 *
 * 零依赖（Node 22 原生 fetch + WebSocket）。
 */
const PORT = 9222;

const mode = process.argv[2];
const rest = process.argv.slice(3);
if (!["hit", "click", "sweep"].includes(mode || "")) {
	console.error("用法: node scripts/cdp-mouse.mjs hit|click|sweep <目标...>");
	process.exit(2);
}

/* 裸 testid 名 → [data-testid="..."]；含 CSS 语法字符的按原样用 */
const toSel = (s) => (/[\[\].#\s>+~:]/.test(s) ? s : `[data-testid="${s}"]`);

let targets = rest;
if (mode === "sweep") targets = [rest[0]];           // sweep 只要一个容器选择器
const targetsJson = JSON.stringify(targets.map(toSel));
const containerJson = JSON.stringify(rest[0] ? toSel(rest[0]) : "");

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = pages.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) { console.error("未找到页面目标"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
let consoleErrors = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
		consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 160));
	}
	if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
		consoleErrors.push(String(m.params.entry.text).slice(0, 160));
	}
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const sendRaw = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	pending.set(id, { res, rej });
	ws.send(JSON.stringify({ id, method, params }));
});
/* 🔴 CDP 调用必须有硬超时（详注见 cdp-eval.mjs 同名段）
 *   渲染进程主线程卡死时**浏览器进程仍正常回 HTTP**，但调用永不返回。
 *   本文件的 Input.dispatchMouseEvent 正是实测把渲染进程顶死的那条路径 —— 
 *   所以超时包在 send 里，一处覆盖全部调用（含鼠标事件）。 */
const CALL_TIMEOUT = Number(process.env.CDP_TIMEOUT_MS || 8000);
const withTimeout = (p, label) => new Promise((res, rej) => {
	const h = setTimeout(() => rej(new Error("CDP 调用超时 " + CALL_TIMEOUT + "ms：" + label + " —— 渲染进程可能已无响应（不是选择器写错）")), CALL_TIMEOUT);
	if (h.unref) h.unref();
	p.then((v) => { clearTimeout(h); res(v); }, (e) => { clearTimeout(h); rej(e); });
});
const send = (method, params = {}) => withTimeout(sendRaw(method, params), method);
try {
	await new Promise((r) => ws.addEventListener("open", r));
	await send("Runtime.enable");
	await send("Log.enable");
} catch (e) {
	console.error("❌ 连接/启用阶段失败：" + String((e && e.message) || e));
	console.error("   自检：node scripts/cdp-eval.mjs \"1+1\" —— 若也失败，就是渲染进程无响应，需重启 Harness。");
	process.exit(2);
}

const evalJs = async (expr) => {
	const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
	return out.result?.value;
};

/* ── 命中测试表达式（sels 现注入，**每次点击前重新求值**）─────────────────── */
const hitExpr = (sels) => `(() => {
	const sels = ${JSON.stringify(sels)};
	const desc = (n) => {
		if (!n) return "null";
		if (n === window) return "window";
		if (n === document.documentElement) return "html";
		const tid = n.getAttribute && n.getAttribute("data-testid");
		const cls = n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
		return n.tagName.toLowerCase() + (tid ? "[data-testid=" + tid + "]" : "") + cls;
	};
	return sels.map((s) => {
		const el = document.querySelector(s);
		if (!el) return { sel: s, found: false };
		const r = el.getBoundingClientRect();
		const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
		const cs = getComputedStyle(el);
		const stack = document.elementsFromPoint(cx, cy);
		const idx = stack.indexOf(el);
		const top = stack[0] || null;
		const reachable = !!top && (top === el || el.contains(top) || top.contains(el));
		return {
			sel: s, found: true,
			text: (el.textContent || "").trim().slice(0, 18),
			rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
			center: { x: Math.round(cx), y: Math.round(cy) },
			insideViewport: cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight,
			stackIndex: idx, top: desc(top), reachable,
			blocker: reachable ? null : desc(top),
			stack: stack.slice(0, 6).map(desc),
			css: { pe: cs.pointerEvents, vis: cs.visibility, op: cs.opacity, disp: cs.display, z: cs.zIndex },
			disabled: !!el.disabled
		};
	});
})()`;

/* ── 顶栏位移检测：记录容器直接子元素的 left，点击前后对比 ─────────────── */
const shiftExpr = (sel) => `(() => {
	const top = document.querySelector(${JSON.stringify(sel)});
	if (!top) return null;
	const out = {};
	[].forEach.call(top.children, (c, i) => {
		const tid = c.getAttribute("data-testid");
		const key = tid || ("#" + i + " " + c.tagName.toLowerCase());
		out[key] = Math.round(c.getBoundingClientRect().left);
	});
	return out;
})()`;
const TOP_SEL = "[data-testid=ds-top]";

/* ── 状态快照 ───────────────────────────────────────────────────────────── */
const SNAP_EXPR = `(() => {
	const t = (s) => { const e = document.querySelector(s); return e ? (e.textContent || "").trim().slice(0, 26) : null; };
	return {
		studioOpen: !!document.querySelector('[data-testid=ds-root]'),
		save: t('[data-testid=ds-save]'),
		ver: t('[data-testid=ds-ver-toggle]'),
		stats: t('[data-testid=ds-stats]'),
		zoom: t('[data-testid=ds-zoom]'),
		verPanelOpen: !!document.querySelector('[data-testid=ds-ver-panel]'),
		renameInput: !!document.querySelector('[data-testid=ds-docname]'),
		toast: t('[data-testid=ds-toast]'),
		docNames: (document.querySelector('[data-testid=ds-doclist]') || {}).innerText || null,
		elCount: (() => { const m = /元素\\s*(\\d+)/.exec(t('[data-testid=ds-stats]') || ""); return m ? Number(m[1]) : null; })(),
		lastLogic: (() => { const e = document.querySelector('[data-testid=ds-logic]'); return e ? (e.textContent || "").trim().slice(0, 40) : null; })()
	};
})()`;
const snapKey = (s) => JSON.stringify(s);
const LABEL = { studioOpen: "工作室开合", save: "保存按钮", ver: "版本按钮", stats: "统计条", zoom: "缩放", verPanelOpen: "版本面板", renameInput: "改名输入框", toast: "提示条", docNames: "图列表", elCount: "元素数", lastLogic: "左栏逻辑" };

const printHit = (r) => {
	if (!r.found) { console.log(`  ❌ ${r.sel} — 页面上找不到这个元素`); return; }
	const flag = !r.insideViewport ? "❌ 在视口外" : r.reachable ? "✅ 可点" : "❌ 被遮挡";
	console.log(`  ${flag}  ${r.sel}  「${r.text}」`);
	console.log(`       rect ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h} · 中心 ${r.center.x},${r.center.y} · 栈位 ${r.stackIndex}`);
	console.log(`       css pointer-events=${r.css.pe} visibility=${r.css.vis} opacity=${r.css.op} display=${r.css.disp} z=${r.css.z}`);
	if (r.disabled) console.log(`       ⚠️ 元素 disabled`);
	if (!r.reachable) {
		console.log(`       🔴 栈顶（真正接收点击的）= ${r.blocker}`);
		console.log(`       栈（上→下）: ${r.stack.join("  ⟩  ")}`);
	}
};

/* ── hit ────────────────────────────────────────────────────────────────── */
if (mode === "hit") {
	console.log(`──────── 命中测试（真实鼠标走的就是这个）────────`);
	const rows = await evalJs(hitExpr(targets.map(toSel)));
	rows.forEach(printHit);
	const bad = rows.filter((r) => !r.found || !r.reachable || !r.insideViewport);
	console.log(`\n可点 ${rows.length - bad.length} / 共 ${rows.length}${bad.length ? ` · 🔴 不可点 ${bad.length} 个` : " · 全部可点 ✅"}`);
	ws.close();
	process.exit(0);
}

/* ── sweep：遍历容器内所有 button ───────────────────────────────────────── */
/* 🔴 2026-09-14 补：sweep 原先**没有起点建立、也没有收尾复原**，于是它
 *   ① 点到容器里的 `ds-close`（工作室的关闭按钮，属**破坏夹具型**控件）⇒ 工作室被关掉；
 *   ② 点开 `ds-ver-toggle` / `ds-personalize` 这类**开合型**控件后原地不管 ⇒ 浮层跨运行留着。
 *   后果实测：连跑第二次直接 `容器找不到: ds-top`，而退出码是 1 —— 读起来像"产品坏了"，
 *   其实是"脚本自己把夹具拆了"。本项目要求真机套件**各连跑 3 次**，这条因此必须修。
 *   纪律依据：① 起点必须**显式建立并断言**；② 开合/破坏型控件点完**当场还原**；
 *            ③ 用错目标判 INVALID(2)，不判 FAIL(1)。 */
const clickSel = async (sel) => {
	const r = (await evalJs(hitExpr([sel])))[0];
	if (!r || !r.found) return false;
	const { x, y } = r.center;
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
	await new Promise((res) => setTimeout(res, 40));
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await new Promise((res) => setTimeout(res, 60));
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
	await new Promise((res) => setTimeout(res, 400));
	return true;
};

const sweepContainerExists = async () => !!(await evalJs(`!!document.querySelector(${containerJson})`));
let sweepStudioWasOpen = false;

/** sweep 收尾复原：关掉本次可能打开的浮层，并把工作室开合态还原到进入时的样子 */
const sweepRestore = async () => {
	const pairs = [["[data-testid=ds-ver-panel]", "ds-ver-toggle"], ["[data-testid=pp-panel]", "pp-close"], ["[data-testid=ds-export-panel]", "ds-export-close"]];
	for (const [open, closer] of pairs) {
		for (let i = 0; i < 4; i++) {
			if (!(await evalJs(`!!document.querySelector(${JSON.stringify(open)})`))) break;
			if (!(await clickSel(toSel(closer)))) break;
		}
	}
	const nowOpen = !!(await evalJs(`!!document.querySelector('[data-testid=ds-top]')`));
	if (sweepStudioWasOpen && !nowOpen) { await clickSel("#dsh-design-studio-launcher"); await new Promise((r) => setTimeout(r, 600)); }
	if (!sweepStudioWasOpen && nowOpen) { await clickSel(toSel("ds-close")); await new Promise((r) => setTimeout(r, 500)); }
	const after = !!(await evalJs(`!!document.querySelector('[data-testid=ds-top]')`));
	console.log(`\n♻️ 收尾复原：工作室开合 ${sweepStudioWasOpen ? "开" : "关"} → ${after ? "开" : "关"}` + (sweepStudioWasOpen === after ? "（起点等价 ✅）" : "（⚠️ 未还原）"));
};

if (mode === "sweep") {
	const buildList = () => evalJs(`(() => {
		const c = document.querySelector(${containerJson});
		if (!c) return null;
		return [].map.call(c.querySelectorAll("button, select, input"), (e, i) => {
			const tid = e.getAttribute("data-testid");
			if (tid) return tid;
			e.setAttribute("data-sweep-idx", String(i));
			return "?i=" + i;
		});
	})()`);
	sweepStudioWasOpen = !!(await evalJs(`!!document.querySelector('[data-testid=ds-top]')`));
	let list = await buildList();
	if (!list) {
		/* 容器不在就**自己把起点建立起来**（走用户真实入口），而不是让调用者先手动开 */
		console.log("容器不在，尝试经用户入口打开：" + rest[0]);
		await clickSel("#dsh-design-studio-launcher");
		await new Promise((r) => setTimeout(r, 700));
		list = await buildList();
	}
	if (!list) {
		console.error("容器找不到:", rest[0]);
		console.error("  这是**前置条件缺失（INVALID）**，不是被测目标不合格：该容器当前不在文档里。");
		console.error("  可复制命令（先起 Harness 并让它上屏）：");
		console.error("    powershell -ExecutionPolicy Bypass -File scripts/restart-harness.ps1");
		console.error("    node scripts/cdp-eval.mjs \"document.getElementById('dsh-design-studio-launcher').click()\"");
		console.error("    node scripts/cdp-mouse.mjs sweep " + rest[0]);
		process.exit(2);
	}
	targets = list;
	console.log(`扫到 ${list.length} 个可交互元素\n`);
}

/* ── click：每个目标现取坐标 → 点击 → 复测 ──────────────────────────────── */
/* 🔴 位移统计必须**记账**：`beforePos`/`afterPos` 任一为 null 时原代码是**静默跳过** ——
 *    于是"顶栏没动"与"根本没量"在输出里长得一模一样（空真）。故作两个计数器，
 *    收尾打一行 `量了 N 次 / 位移 M 个`，M>0 或 N=0 都肉眼可见。 */
let posProbes = 0, movedTotal = 0;
const printClick = (r, before, after, beforePos, afterPos) => {
	console.log(`  ${r.reachable ? "🖱" : "🔴"} ${r.sel}  「${r.text}」 @ ${r.center.x},${r.center.y}`);
	if (!r.reachable) console.log(`       栈顶是 ${r.blocker} —— 这一下点给了别人`);
	const changed = Object.keys(before).filter((k) => snapKey(before[k]) !== snapKey(after[k]));
	if (changed.length) {
		console.log(`       ✅ 状态变化 ${changed.length} 项：`);
		for (const k of changed) console.log(`          ${LABEL[k] || k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
	} else {
		console.log(`       ⚠️ 点击后**页面无任何状态变化**`);
	}
	/* 位移检测 */
	if (beforePos && afterPos) {
		posProbes++;
		const moved = Object.keys(beforePos).filter((k) => afterPos[k] !== undefined && afterPos[k] !== beforePos[k]);
		const gone = Object.keys(beforePos).filter((k) => afterPos[k] === undefined);
		const born = Object.keys(afterPos).filter((k) => beforePos[k] === undefined);
		if (moved.length) {
			movedTotal += moved.length;
			console.log(`       ⚠️ 顶栏位移 ${moved.length} 个（按钮跑了 ⇒ 用户下一次会点空）：`);
			for (const k of moved.slice(0, 6)) console.log(`          ${k}: ${beforePos[k]} → ${afterPos[k]}  (Δ${afterPos[k] - beforePos[k] >= 0 ? "+" : ""}${afterPos[k] - beforePos[k]})`);
			if (moved.length > 6) console.log(`          …另有 ${moved.length - 6} 个`);
		}
		if (gone.length || born.length) console.log(`       ℹ️ 顶栏元素增删：-${gone.length} +${born.length}${gone.length ? " [" + gone.join(",") + "]" : ""}`);
	}
	if (consoleErrors.length) console.log(`       🐞 控制台报错: ${consoleErrors.slice(0, 2).join(" | ")}`);
};

for (const sel of targets.map(toSel)) {
	consoleErrors = [];
	/* 🔴 现取现用：这一秒的坐标才算数 */
	const r = (await evalJs(hitExpr([sel])))[0];
	if (!r || !r.found) { console.log(`  ❌ ${sel} — 找不到元素`); continue; }
	const before = await evalJs(SNAP_EXPR);
	const beforePos = await evalJs(shiftExpr(TOP_SEL));

	const { x, y } = r.center;
	await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
	await new Promise((res) => setTimeout(res, 40));
	await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
	await new Promise((res) => setTimeout(res, 60));
	await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
	await new Promise((res) => setTimeout(res, 500));

	const after = await evalJs(SNAP_EXPR);
	const afterPos = await evalJs(shiftExpr(TOP_SEL));
	printClick(r, before, after, beforePos, afterPos);
}

/* 🔴 sweep 收尾复原必须**接在循环之后**（原先根本没有这一步）：
 *    不接的话，上面那些开合型/破坏型控件的副作用会留给下一次运行。 */
if (mode === "sweep") {
	console.log(`\n📏 顶栏位移：量了 ${posProbes} 次 / 检出 ${movedTotal} 个` + (posProbes === 0 ? "（⚠️ 一次都没量到 ⇒ 本判据空转，不是「没动」）" : movedTotal === 0 ? "（✅ 零位移）" : "（⚠️ 有位移，按钮会跑）"));
	try { await sweepRestore(); } catch (e) { console.error("♻️ 收尾复原异常：" + String((e && e.message) || e)); }
}

ws.close();
