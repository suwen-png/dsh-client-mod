#!/usr/bin/env node
/**
 * _cdp-startup.mjs —— 真机套件的**统一起点自举**：把「总监页真的立起来」收成一个函数
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么必须共享（第二十四轮跨重启连跑暴露的真问题）
 * ──────────────────────────────────────────────────────────────────
 * 这段逻辑原本**只**长在 `verify-novel-split.mjs` 的 A0–A2 段里（那段被冷启动反复验证过），
 * 而 `verify-director-logic.mjs` 的起点只用了**内部口** `__directChatSubmit` 实体化 ⇒
 * 跨重启一连跑就 **8/29**，21 条红全由**一个起点问题**级联产生（纪律 41 的典型形态）。
 *
 * 四个探针给的证据（2026-09-17 · `_tmp-probe-{restart,restart2,restart3,coldstart-timeline,coldstart-trigger,tab-cycle,mount-why}.mjs`）：
 *   · **插件侧一切正常**：t+1s `__dshDirectorView.registered=true`、tab 注册成功、IDB 打开成功、sync 57 条；
 *   · **宿主侧很慢且不稳定**：冷启动可能 **120s 都没有 `[role="tab"]` 环**（另一次 t+58s 才出现）；
 *   · 用内部口/浮动组把会话视图"凑"出来时，环会出现、且「总监」**已经是 `aria-selected=true`**，
 *     但宿主**始终不渲染视图内容** ⇒ `dp-root` 永不在 DOM；
 *     点它（JS 直点 / 真实鼠标 / 切走再切回 / `Page.reload`）**全都无效**，
 *     且点击后 **0 条 console、0 异常**（不是抛错，是宿主压根没渲染）。
 *   · 而 `verify-novel-split` 走**真实 UI 点侧栏会话行**建立起点时一切正常 ⇒ 差别只在这一步。
 * ⇒ 「同一事实只留一份真相源」：起点自举只允许一个实现，两个套件都调这里。
 *
 * ══════════════════════════════════════════════════════════════════
 * 两条纪律就写在脸上
 * ──────────────────────────────────────────────────────────────────
 *  · **「环还没出现」不是「点击失败」**：冷启动实测环可迟到 58–120s，把它当一次点击失败
 *    会让 8 轮 ≈5.7s 就烧光预算，真正的可点窗口一次都等不到（这正是首版 8/29 的机制）。
 *  · 🔴 **「环非空」不是「环可点」**（第四十一轮 · 新增纪律 149，与 148 同族）：
 *    `querySelectorAll('[role="tab"]')` **读得到**页签，**不代表**宿主正在显示会话视图。
 *    实测（`logs/_r41l-ensure.out` / `logs/_r41l-ns.out` / 现场取证 `logs/_tmp-probe-tabs.mjs`）：
 *    宿主把装着页签环的 `OrjXgq_centerSurface` 置了 `hidden` —— 那 5 个页签盒**全 `0×0`**、
 *    `offsetParent===null`，`geomExpr` 直接回「尺寸为 0」**连点都点不下去**；
 *    而**同一时刻**页面上还有另一个 `centerSurface`（`1154×816`，可见）——
 *    宿主靠切换"哪个 `centerSurface` 可见"来换视图 ⇒ 在旧环上点击**原理上无效**。
 *    旧实现只看"有没有文本" ⇒ ③ 真实 UI 侧栏自举被绕过（触发条件是 `!ring.length`）
 *    ⇒ 在隐藏页签上白烧 90s ⇒ 起点永远恢复不了 ⇒ 下游一次连跑 **11 条假红**。
 *    ⇒ 判据改为**可见环**（`ringOf()` 只取盒 ≥2px 的；全部环另有 `ringAllOf()` 供取证），
 *      且等待预算按「全部环是否为空」分档：空 = 冷启动长等，非空 = 短等后立刻转侧栏自举。
 *  · **失败必须可分辨**（纪律 58）：返回 `reason` + 逐步 `steps`，由调用方决定判 INVALID 还是红。
 *
 * @param {object} io
 * @param {object} io.CL    `makeClicker` 的返回体（clickAt/clickSel/clickJs/clickByText/clickJsByText）
 * @param {Function} io.js  CDP Runtime.evaluate 的求值器
 * @param {Function} io.send CDP 原始 send（仅用于 Esc）
 * @param {Function} io.sleep
 * @param {Function} [io.log]
 * @param {number} [io.tabBudgetMs] 等页签环的总预算（默认 120000 —— 冷启动实测可到 120s）
 * @param {boolean} [io.useRealUi=true] 是否允许"真实 UI 点侧栏会话"自举（默认允许，这是正解）
 * @param {number} [io.stabilizeMs=18000] 起点建立后的**就绪稳定期**预算（可用环境变量
 *   `DSH_STABILIZE_MS` 覆盖）—— 判据是"连续两次读数完全一致"**且**"读数满足就绪契约"
 *   （`hit` 全 `@in` + `data-busy=0` + `data-ledger-ok=1`），不是固定 sleep；满足即提前结束。
 *   见 ⑤（`T-PLUG-067` 第二层：起点立起来了 ≠ 页面已经不动了；`T-PLUG-070` 补：
 *   **"稳定" ≠ "就绪"** —— 页面**稳定地**被遮罩时，只判"一致"的旧版照样放行 ⇒ 下游假红）
 * @returns {Promise<{ok:boolean, dpRoot:boolean, tabRing:string[], reason:string, steps:string[]}>}
 */
import { pressEsc } from "./_cdp-click-until.mjs";

/**
 * `waitCdpPage()` —— **有界等待 CDP 的 page 目标**（唯一实现 · 纪律 98/55）。
 *
 * 🔴 为什么必须共享（第 25 批真机实测）：
 *    `_run-with-harness.mjs` 报告「CDP 就绪」只代表**端口**在应答（实测 ≈2.0s），
 *    而 `/json/list` 里**出现 page 目标还要更晚**。于是"端口就绪 ⇒ 立刻取 targets"
 *    的实现会拿到空数组 ⇒ 报 `INVALID：CDP 无 page 目标` —— 读起来像"Harness 没起来"，
 *    真因只是**等得不够**（纪律 58：「没跑成」与「失败」必须可分）。
 *    本轮一次连跑里 `verify-director-logic` / `link-shots` / `verify-novel-e2e-human`
 *    **三个脚本同时**死在这一步，而 `verify-novel-split`（唯一写了有界等待的那份）没事
 *    ⇒ 典型"同一事实写了 N 份、只有一份是对的"。**收成一个函数**，谁都不许再各写一份。
 *
 * @param {object} [io]
 * @param {number} [io.port] 默认 `process.env.CDP_PORT || 9222`
 * @param {number} [io.budgetMs] 默认 `process.env.PAGE_BUDGET_MS || 60000`
 * @param {Function} [io.sleep]
 * @param {Function} [io.log]
 * @returns {Promise<{ok:boolean,page:object|null,targets:Array|null,port:number,ms:number,reason?:string}>}
 *   `ok:false` ⇒ 调用方判 **INVALID（退出码 2）**，不许判 FAIL（纪律 24：环境问题不是产品坏）
 */
export async function waitCdpPage(io = {}) {
	const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	const log = io.log || console.log;
	const port = Number(io.port || process.env.CDP_PORT || 9222);
	const budget = Number(io.budgetMs || process.env.PAGE_BUDGET_MS || 60000);
	const t0 = Date.now();
	let targets = null;
	while (Date.now() - t0 < budget) {
		try { targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); } catch (e) { targets = null; }
		const page = Array.isArray(targets)
			? targets.find((t) => t && t.type === "page" && !/devtools/.test(String(t.url)))
			: null;
		if (page) return { ok: true, page: page, targets: targets, port: port, ms: Date.now() - t0 };
		if ((Date.now() - t0) % 5000 < 700) log("  [等待] t+" + Math.round((Date.now() - t0) / 1000) + "s 尚无 page 目标…");
		await sleep(600);
	}
	return {
		ok: false, page: null, targets: targets, port: port, ms: Date.now() - t0,
		reason: Array.isArray(targets) ? "有 targets 但无 page 目标" : "连不上 CDP " + port
	};
}

export async function ensureDirectorPage(io) {
	const { CL, js, send, sleep, log = console.log, tabBudgetMs = 120000, useRealUi = true } = io;
	const steps = [];
	const note = (s) => { steps.push(s); log(s); };
	/* 全部页签环（**取证**用 —— 失败归因必须能看见"环其实存在，只是不可见"） */
	const RING_ALL = "Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent||'').trim();})";
	/* 🔴 **可见页签环**（**判据**用 · 第四十一轮 · 新增纪律 149）──────────────────────────
	 *   「**环非空 ≠ 环可点**」。真机实测（`logs/_r41l-ns.out` + 现场取证 `logs/_tmp-probe-tabs.mjs`）：
	 *   宿主把装着页签环的 `OrjXgq_centerSurface` 置了 `hidden`（⇒ `display:none`），
	 *   而 `querySelectorAll('[role="tab"]')` **照样读得到 5 个** —— 每一个的盒都是 `0×0`、
	 *   `offsetParent===null`；`geomExpr` 于是直接回「尺寸为 0」，`clickByText` **连点都点不下去**
	 *   ⇒ 在隐藏页签上白烧 90s，起点永远恢复不了（这正是批 #3 那 11 条级联假红的入口）。
	 *   而**同一时刻**页面上还有个 `1154×816` 的 `centerSurface` —— 宿主真正显示的那个
	 *   （里面**没有**总监页）⇒ 唯一有效路径是 ③ 真实 UI 侧栏点会话行，让宿主**重建**视图。 */
	const RING_VIS = "Array.from(document.querySelectorAll('[role=\"tab\"]')).filter(function(e){"
		+ "var b=e.getBoundingClientRect();return b.width>=2&&b.height>=2;})"
		+ ".map(function(e){return String(e.textContent||'').trim();})";
	const TREE = "Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map(function(e,i){"
		+ "return {i:i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded'),cls:String(e.className||'').slice(0,44)};})";
	const OVERLAY = "['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(function(s){return !!document.querySelector(s);})";
	/* 🔴 **只认 `dp-root`**（纪律 30：「注册成功」≠「渲染成功」） */
	const hasRoot = () => js("!!document.querySelector('[data-testid=\"dp-root\"]')");
	const ringOf = async () => (await js(RING_VIS)) || [];
	/** 全部页签（**取证**用；判据一律用 `ringOf()` = 可见环 —— 纪律 149） */
	const ringAllOf = async () => (await js(RING_ALL)) || [];
	/* 有界等待：只看 `dp-root`，**不抛** */
	const waitRoot = async (totalMs, gapMs) => {
		const t = Date.now();
		while (Date.now() - t < totalMs) {
			if (await hasRoot()) return true;
			await sleep(gapMs || 350);
		}
		return await hasRoot() === true;
	};

	try {
		/* ── ① 关掉残留浮层（`closeFloatLayers()` 的产品对应物：浮层会**吃掉全部点击**）── */
		for (let i = 0; i < 4; i++) {
			if (!(await js("(" + OVERLAY + ").length"))) break;
			await pressEsc(send, sleep);
			await sleep(320);
		}
		note("  [起点] 浮层清理后残留：" + JSON.stringify(await js(OVERLAY)));

		/* ── ⑤ 就绪**稳定期**（`T-PLUG-067` 的第二层：起点立起来了 ≠ 页面已经不动了）──────
		 *  🔴 实测（v19 首套不建起点 ⇒ v20 是**首个真正拉起页面**的套件）：
		 *     `dp-root` 已挂载、`data-busy=0` 也已自报，但**覆盖物探针还在变**
		 *     （同一采样点先后命中 `DIV` → `LI`），且 CDP 派发的 `mouseMoved` **收不到**
		 *     ⇒ 下游的「覆盖层前提 / 输入通道前提」判红，读起来完全是产品坏了：
		 *     `verify-v20` 一次红 6 条 + 跳过 16 条（`V-S3` / `V-S5` / `V-B0b` / `V-E0b` / `V-B0` / `V-F1`），
		 *     `verify-v21` 首条 `V21-S0` 也红 —— 全靠**一个时序问题**级联产生。
		 *  ⇒ 判据不是"再睡一会儿"（固定 sleep 在慢机器上照样不够、快机器上白等），
		 *     而是**连续两次读数完全一致**（与 `verify-v20` 的 `V-S4` 闲态同口径）：
		 *     采样 = `dp-root` 几何 + 两个覆盖物探针的命中元素特征 + `data-busy`/`data-ledger-ok`。
		 *     有界（默认 **6s**，可用 `io.stabilizeMs` 覆盖）；仍未稳定也**如实回报**
		 *     （`stable:false` 进 steps），**不静默**、也不改写 `ok`（纪律 19/58）。 */
		const PROBE = "(function(){var r=document.querySelector('[data-testid=\"dp-root\"]');if(!r)return 'no-root';"
			+ "var b=r.getBoundingClientRect();"
			+ "var ps=[[b.x+b.width*0.35,b.y+b.height*0.35],[b.x+b.width*0.75,b.y+b.height*0.55]];"
			+ "var hit=ps.map(function(p){var e=document.elementFromPoint(Math.round(p[0]),Math.round(p[1]));"
			+ "if(!e)return 'null';var t=e.tagName||'?';"
			+ "var inR=!!(e===r||(e.closest&&e.closest('[data-testid=\"dp-root\"]')));"
			+ "return t+(inR?'@in':'@out');});"
			+ "return JSON.stringify({w:Math.round(b.width),h:Math.round(b.height),hit:hit,"
			+ "busy:r.getAttribute('data-busy'),ledger:r.getAttribute('data-ledger-ok')});})()";
		/* 🔴 **就绪契约**（`T-PLUG-070`）：**"连续两次一致"只说明"不动了"，不说明"可以测了"。**
		 *    实测（2026-09-18 真机）：`verify-v20` 那次稳定期末次 =
		 *    `hit:["DIV@out","DIV@out"]` —— 两个采样点**都被外部元素盖住**，
		 *    而 stabilize **照样判 ✅**（因为两次读数一致）⇒ 下游 `V-S3` 报
		 *    "覆盖层前提不成立"，读起来像产品坏了。
		 *    ⇒ 退出条件补一条：读数必须**同时满足就绪契约**
		 *    （`hit` 全 `@in` + `data-busy=0` + `data-ledger-ok=1` —— 与 `v20` 的 `V-S4` 闲态同口径）。
		 *    达不到就**继续等**（仍有界）；耗尽预算则**如实报"未稳定"**，不判 ✅。 */
		const readyOf = (s) => {
			if (s == null || s === "no-root") return false;
			try {
				const o = JSON.parse(s);
				if (!Array.isArray(o.hit) || !o.hit.length) return false;
				if (!o.hit.every((h) => /@in$/.test(String(h)))) return false;
				if (String(o.busy) !== "0") return false;
				if (String(o.ledger) !== "1") return false;
				return true;
			} catch (e) { return false; }
		};
		/* 🔴 单次「就绪契约」采样（不等待）—— 供「点完之后**这一次到底算不算立起来**」使用。
		 *   与 `stabilize()` 的 `readyOf` 同源（纪律 126：契约只有一处定义）。 */
		const readyNow = async () => readyOf(await js(PROBE));
		const stabilize = async () => {
			/* 默认 **18000**（2026-09-18 实测）：冷启动后**首个自举套件**的"遮罩期" **> 6s** ——
			 *    6s 预算下 `verify-v20` 的 `V-S3`（覆盖层前提）**稳定红**、`V-S5` 也红；
			 *    调到 18s 后**两条同时转绿**（`logs/_r39d-live.out`）。
			 *  ⚠️ 调大**不拖慢正常路径** —— 契约一满足就立刻返回（正常第 **2** 次采样 ≈450ms）；
			 *    只有异常场景才等到预算上限，且耗尽后**如实报"未稳定"**、不判 ✅。
			 *  可用 `DSH_STABILIZE_MS` 临时覆盖（诊断用）或 `io.stabilizeMs` 精确指定。 */
			const budget = Number(io.stabilizeMs == null ? (Number(process.env.DSH_STABILIZE_MS) || 18000) : io.stabilizeMs);
			const t5 = Date.now();
			let prev = null, stable = false, n = 0;
			while (Date.now() - t5 < budget) {
				const cur = await js(PROBE);
				n++;
				if (prev !== null && cur === prev && readyOf(cur)) { stable = true; break; }
				prev = cur;
				await sleep(450);
			}
			note("  [起点] 就绪稳定期：" + (stable
					? "✅ 连续两次读数一致 **且** 满足就绪契约（第 " + n + " 次采样）"
					: "⚠️ " + budget + "ms 内未同时满足「读数一致 + 就绪契约」（末次就绪=" + (readyOf(prev) ? "通过" : "**未通过**") + "）")
				+ " ｜ 末次=" + String(prev).slice(0, 220));
			return stable;
		};

		let ring = await ringOf();
		const ringAllAtEntry = await ringAllOf();
		if (await hasRoot()) {
			note("  [起点] `dp-root` 已在 DOM（起点已立，无需自举）· 可见环=" + JSON.stringify(ring)
				+ " · 全部环=" + JSON.stringify(ringAllAtEntry));
			if (!ring.length && ringAllAtEntry.length) {
				/* 🔴 纪律 149 的**核心形态**：页签环读得到、却一个都点不动 —— 宿主显示的不是会话视图。 */
				note("  [起点] ⚠️ **环读得到但一个都不可见**（" + ringAllAtEntry.length
					+ " 个页签全在隐藏容器里 · 盒 0×0）⇒ 宿主当前显示的**不是**会话视图；"
					+ "在那个环上点击**原理上无效**（`geomExpr` 直接回「尺寸为 0」）"
					+ "⇒ 只能走 ③ 真实 UI 侧栏自举让宿主**重建**视图（纪律 149）");
			}
			if (await stabilize()) return { ok: true, dpRoot: true, tabRing: ring, reason: "", steps: steps };
			/* 🔴 **`dp-root` 在 DOM ≠ 宿主正在显示它**（第四十一轮真机实测 · 新增纪律 148）
			 *   形态：`{"w":0,"h":0,"hit":["DIV@out","DIV@out"]}` —— 页面**挂着却没有盒**，
			 *   因为宿主上显示的是**别的视图**（本轮实测：连跑 4 套之后环由 3 个变 5 个，
			 *   总监视图被切走）。此时若按旧行为**直接 return ok:true**，起点守卫会判「在位」，
			 *   而后续套件从 `dp-act-split` 零盒开始 ⇒ 一次连跑产生 **11 条假红 + 整轮 INVALID**
			 *   （`logs/_r41j-ns.out`：`NS-1c`→`NS-3a`~`NS-3h` 全红，读起来完全是"产品坏了"）。
			 *   ⇒ 不提前返回，**转下面的「点总监」路径把它显示出来** —— 复用同一段点击实现
			 *     （纪律 126：不为这件事再写第二份），并把「就绪」并入成功判据。 */
			note("  [起点] ⚠️ 已挂载但**未满足就绪契约** ⇒ 不提前返回，转「点总监」把视图显示出来"
				+ "（归因：旧判据只覆盖「DOM 挂载」，未覆盖「宿主正在显示它」）");
		}

		/* ── ② 无环 ⇒ **先等**（**只等不点**：环迟到 58–120s 是实测事实）──
		 *    顺手做一次**实体化**（内部口）作为加速：它对"空白草稿会话"是必需的
		 *    （宿主不给 `blank` 草稿挂 `conversation.view` ⇒ 永远没有页签环）。 */
		const t0 = Date.now();
		if (!ring.length) {
			const mat = await js("(async function(){"
				+ "var b=window.__dshBranchTree; if(!b) return {ok:false,reason:'无 __dshBranchTree（插件未装载）'};"
				+ "var raws=b.rawSessionSummaries()||[]; var arch=await b.archivedSessionIds();"
				+ "if(!Array.isArray(arch)) return {ok:false,reason:'归档集读不到 ⇒ 按纪律不做实体化'};"
				+ "var set={}; for(var i=0;i<arch.length;i++) set[String(arch[i])]=1;"
				+ "var live=raws.filter(function(s){return !set[String(s.id||s.sessionId)];});"
				+ "if(!live.length) return {ok:false,reason:'没有活会话可供实体化'};"
				+ "var one=live[0]; var id=String(one.id||one.sessionId);"
				+ "if(typeof window.__directChatSubmit!=='function') return {ok:false,reason:'宿主未暴露 __directChatSubmit'};"
				+ "try{ window.__directChatSubmit(id,'起点自举：请回复 OK'); }catch(e){ return {ok:false,reason:'投递抛错：'+String((e&&e.message)||e)}; }"
				+ "return {ok:true,id:id,blank:one.blank===true,liveN:live.length};})()");
			note("  [起点] 实体化（内部口）：" + JSON.stringify(mat));
			/* 🔴 **等待预算按「宿主有没有渲染过页签」分档**（纪律 149）：
			 *   · **全部环为空** ⇒ 真的还没渲染（冷启动实测环可迟到 58–120s）⇒ **长等**（tabBudgetMs/2，≥15s）；
			 *   · **全部环非空、可见环却为空** ⇒ 宿主**早已渲染过**、只是把装载它的容器藏了
			 *     （隐藏的 `centerSurface`）⇒ 长等毫无意义（它不会自己切回来，实测 90s 白烧）
			 *     ⇒ **短等** 8s，随即进 ③ 段点侧栏会话行，逼宿主**重建**视图。 */
			const half = ringAllAtEntry.length ? 8000 : Math.max(15000, Math.round(tabBudgetMs / 2));
			note("  [起点] 等待宿主就绪（**只等不点**，预算 " + Math.round(half / 1000) + "s · 全部环="
				+ ringAllAtEntry.length + " ⇒ " + (ringAllAtEntry.length ? "**短等**" : "长等") + "）…");
			while (!ring.length && Date.now() - t0 < half) {
				await sleep(1500);
				ring = await ringOf();
				if (ring.length) break;
				if ((Date.now() - t0) % 15000 < 1600) note("  [起点]   t+" + Math.round((Date.now() - t0) / 1000) + "s 仍无**可见**环（宿主未显示会话视图）");
			}
			note("  [起点] 等待 " + (Date.now() - t0) + "ms ⇒ 可见环 " + JSON.stringify(ring));
		}

		/* ── ③ 仍无环 ⇒ **真实 UI 侧栏自举**（`verify-novel-split` 验证过的正解）──
		 *    顺序：展开工作区根 → 点「新会话」→ 点会话行 → 再实体化。 */
		if (!ring.length && useRealUi) {
			note("  [起点] 转真实 UI 自举：展开侧栏工作区根 + 点会话行");
			let items = (await js(TREE)) || [];
			const looksLikeSession = (x) => /分钟|小时|天|刚刚|秒/.test(x.t);
			if (!items.some(looksLikeSession)) {
				const rootIdx = items.findIndex((x) => x.ex === "false");
				if (rootIdx >= 0) {
					await CL.clickSel('[role="treeitem"]', "侧栏工作区根");
					await sleep(1200);
					items = (await js(TREE)) || [];
				}
			}
			if (!items.some(looksLikeSession)) {
				const nb = await js("(function(){var els=[].slice.call(document.querySelectorAll('[role=\"treeitem\"],button,[role=\"button\"]'));"
					+ "var t=els.filter(function(e){var s=String(e.textContent||'').trim();return s==='新会话'||s==='新建会话'||s==='新建对话';})[0];"
					+ "if(!t)return null;var r=t.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;"
					+ "return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),text:String(t.textContent).trim()};})()");
				note("  [起点] 无带时间标记的会话 ⇒ 点「新会话」自举：" + JSON.stringify(nb));
				if (nb) {
					await CL.clickAt(nb.x, nb.y);
					await sleep(2600);
					items = (await js(TREE)) || [];
				}
			}
			const cands = items.filter(looksLikeSession);
			const isSessionRow = (x) => /sessionRow/.test(String(x.cls || ""));
			/* ⚠️ 「新会话」**是会话行不是按钮**（class=`sessionRow`）⇒ 不能按标题排除（第 19 批实测） */
			const targets = (cands.length ? cands : items.filter(isSessionRow)).slice(0, 4);
			note("  [起点] 可点目标 " + targets.length + " 个（"
				+ (cands.length ? "按会话时间标记" : "无时间标记 ⇒ 退化为按 class 认 sessionRow") + "）："
				+ JSON.stringify(targets.map((c) => c.t)));
			for (const c of targets) {
				const r = await js("(function(){var L=document.querySelectorAll('[role=\"treeitem\"]');var e=L[" + c.i + "];"
					+ "if(!e)return null;var b=e.getBoundingClientRect();"
					+ "return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()");
				if (r) { await CL.clickAt(r.x, r.y); await sleep(1500); }
				ring = await ringOf();
				if (ring.length) { note("  [起点] 已打开会话：" + c.t); break; }
			}
			if (!ring.length) {
				const mat2 = await js("(async function(){var b=window.__dshBranchTree;if(!b)return {ok:false,reason:'无 __dshBranchTree'};"
					+ "var raws=b.rawSessionSummaries()||[];var arch=await b.archivedSessionIds();"
					+ "if(!Array.isArray(arch))return {ok:false,reason:'归档集读不到'};var set={};arch.forEach(function(a){set[String(a)]=1;});"
					+ "var live=raws.filter(function(s){return !set[String(s.id||s.sessionId)];});"
					+ "if(!live.length)return {ok:false,reason:'没有活会话'};var id=String(live[0].id||live[0].sessionId);"
					+ "if(typeof window.__directChatSubmit!=='function')return {ok:false,reason:'无 __directChatSubmit'};"
					+ "try{window.__directChatSubmit(id,'起点自举：请回复 OK');}catch(e){return {ok:false,reason:String(e&&e.message)};}"
					+ "return {ok:true,id:id};})()");
				note("  [起点] 再实体化：" + JSON.stringify(mat2));
				const t3 = Date.now();
				while (!ring.length && Date.now() - t3 < 10000) { await sleep(500); ring = await ringOf(); }
			}
			note("  [起点] 真实 UI 自举后环 = " + JSON.stringify(ring));
		}

		/* ── ④ 点「总监」直到 `dp-root`；**环不在就只等不点**（不再空转烧轮数）── */
		let ok = false;
		let tries = 0;
		let waitedForRing = 0;
		const t4 = Date.now();
		while (!ok && Date.now() - t4 < 90000) {
			ring = await ringOf();
			if (!ring.length) {
				if (!waitedForRing) note("  [起点] 可见环为空 ⇒ 只等不点（宿主未显示会话视图）");
				waitedForRing += 1500;
				await sleep(1500);
				/* 🔴 **不许空转到预算耗尽**（纪律 149）：若**全部环非空**（宿主渲染过页签、
				 *    只是把装载它的容器藏了）且可见环已经空了 6s ⇒ 它不会自己切回来
				 *    ⇒ 提前跳出，把「环在但全不可见」如实带进归因
				 *    （而不是白烧剩下的 80 多秒、再让下游套件整片假红）。 */
				if (waitedForRing >= 6000 && (await ringAllOf()).length) {
					note("  [起点] ⚠️ 可见环持续为空 " + waitedForRing
						+ "ms，而**全部环非空** ⇒ 宿主不会自己切回来 ⇒ 提前跳出（交归因，不空烧预算）");
					break;
				}
				continue;
			}
			tries++;
			const c = tries === 1
				? await CL.clickByText('[role="tab"]', "总监")
				: await CL.clickJsByText('[role="tab"]', "总监");
			/* 🔴 成功判据 = **DOM 挂载 + 就绪契约**（纪律 139 / 148）：
			 *    只判 `dp-root` 会把「点了但宿主没切过来」（盒仍是 0×0）算成成功 ——
			 *    那正是本轮 11 条假红的入口。 */
			const domOk = await waitRoot(1400, 350);
			ok = domOk && (await readyNow());
			note("  [起点] 第 " + tries + " 轮「总监」" + (c && c.ok ? "命中" : "未命中 " + JSON.stringify(c && c.info))
				+ "（累计 " + (Date.now() - t4) + "ms）⇒ dp-root=" + domOk + " · 就绪=" + ok);
			if (!ok) await sleep(900);
		}
		/* 退路：浮动组的「打开总监」（本轮实测它能点到，但冷启动时**不解决**挂载 —— 仍值得一试） */
		if (!ok) {
			const c2 = await CL.clickSel('[data-testid="d-open-director"]', "浮动组·打开总监");
			note("  [起点] 退路点「打开总监」：" + JSON.stringify({ ok: c2.ok }));
			/* 🔴 同样要求**就绪**（见上：只判挂载会把"没切过去"算成成功） */
			if (c2.ok) ok = (await waitRoot(6000, 400)) && (await readyNow());
			/* 🔴 第 42 轮补（真机失败归因逼出来的）：**点浮标只是把视图容器打开，不保证落在「总监」页**。
			 *   实测失败归因 `selected:["总监","脚本"]` —— 宿主把 ring 建起来了，但内容是**「脚本」**那一页
			 *   ⇒ `dp-root` 自然不在（`idPresent=false`），于是自举 90s 白等、下游整批跟着假红。
			 *   ⇒ 浮标点开后若**可见环里已经有「总监」**，就再点它一次（真实点击 → 退化为 JS 点击）。
			 *   成功路径（环里本来就有总监）**完全不受影响** —— 这段只在 `!ok` 时才走。 */
			if (!ok) {
				const ring2 = await ringOf();
				note("  [起点] 退路后可见环：" + JSON.stringify(ring2));
				const hasDir = ring2.some((t) => String(t).indexOf("总监") >= 0);
				if (hasDir) {
					const c3 = await CL.clickByText('[role="tab"]', "总监");
					note("  [起点] 环内补点「总监」tab（真实点击）：" + JSON.stringify({ ok: c3 && c3.ok }));
					if (c3 && c3.ok) ok = (await waitRoot(8000, 400)) && (await readyNow());
					if (!ok) {
						const c4 = await CL.clickJsByText('[role="tab"]', "总监");
						note("  [起点] 环内补点「总监」tab（JS 点击）：" + JSON.stringify({ ok: c4 && c4.ok }));
						if (c4 && c4.ok) ok = (await waitRoot(8000, 400)) && (await readyNow());
					}
				} else {
					note("  [起点] 退路后可见环里**没有**「总监」⇒ 不补点（如实归因，不空点）");
				}
			}
		}

		if (ok) { await stabilize(); return { ok: true, dpRoot: true, tabRing: ring, reason: "", steps: steps }; }
		/* ── 失败必须**可分辨**（纪律 58）：三种归因修法完全不同 ── */
		const diag = await js("(function(){var ts=[].slice.call(document.querySelectorAll('[role=tab]'));"
			+ "return JSON.stringify({ring:ts.map(function(e){return String(e.textContent||'').trim();}),"
			+ "selected:ts.filter(function(e){return e.getAttribute('aria-selected')==='true';}).map(function(e){return String(e.textContent||'').trim();}),"
			/* 🔴 第四十一轮（纪律 149）：**可见环**必须与「全部环」并排取证 ——
			 *    "环里没有总监"（视图未注册）与"环全不可见"（宿主没显示会话视图）
			 *    是**两种修法完全不同的失败**，只看全部环会把后者误指向前者（纪律 58）。 */
			+ "visible:ts.filter(function(e){var b=e.getBoundingClientRect();return b.width>=2&&b.height>=2;})"
			+   ".map(function(e){return String(e.textContent||'').trim();}),"
			/* 中心区容器（现场取证一眼可辨「一隐一显」：宿主靠切换哪个 centerSurface 可见来换视图） */
			+ "surfaces:[].slice.call(document.querySelectorAll('[class*=\"centerSurface\"]')).map(function(e){"
			+   "var b=e.getBoundingClientRect();return Math.round(b.width)+'x'+Math.round(b.height)+(e.hasAttribute('hidden')?'H':'');}),"
			+ "hasDirector:ts.some(function(e){return String(e.textContent||'').trim()==='总监';}),"
			+ "handle:window.__dshDirectorView?!!window.__dshDirectorView.registered:null,"
			+ "idPresent:!!document.getElementById('dsh-director-page'),"
			/* 🔴 第四十一轮（纪律 148）：把 `dp-root` 的**盒**一并取证 ——
			 *    "已挂载但 0×0"（宿主显示的是别的视图）与"压根没渲染"是**两种修法不同的失败**，
			 *    只报 `idPresent=true` 无法分辨。 */
			+ "rect:(function(){var r=document.querySelector('[data-testid=\"dp-root\"]');if(!r)return null;"
			+ "var b=r.getBoundingClientRect();return Math.round(b.width)+'x'+Math.round(b.height);})(),"
			+ "textured:document.querySelectorAll('.dp-textured').length});})()");
		note("  [起点] 🔴 失败归因 = " + diag);
		let d = null;
		try { d = JSON.parse(diag); } catch (_) { d = null; }
		/* 🔴 第四十一轮（纪律 148）：**「已挂载但没有盒」必须与「已选中但未渲染」分开** ——
		 *    `idPresent` 在两种情况下**都是 true**（同一个 `#dsh-director-page`），
		 *    只看它会把两因合一（纪律 140 的反面）⇒ 判据取**盒的尺寸**。 */
		const mountedNoBox = !!(d && d.idPresent && /^0x|^[0-9]+x0$/.test(String(d.rect || "")));
		/* 🔴 纪律 149：**「环全不可见」必须先于「环里没有总监」被分辨** ——
		 *    隐藏容器里的页签既读得到、又点不动；若不先判，归因会把它说成"视图未注册"，
		 *    把修法指向完全错的方向（纪律 58：归因不可分辨 = 等于没归因）。
		 *    ⚠️ `Array.isArray(d.visible)` 守卫：老读数（无该字段）退回原归因，不误报。 */
		const hiddenRing = !!(d && d.ring.length && Array.isArray(d.visible) && !d.visible.length);
		/* 写成**扁平分支**而不是五层三元嵌套：这一段的每个分支对应**一种修法**
		 * （纪律 58），扁平写法既不容易括号配错，也让人一眼看清"有几种失败"。 */
		let reason;
		if (!d) {
			reason = "起点自举失败（归因读数读不到）";
		} else if (!d.ring.length) {
			reason = "宿主始终没有页签环（会话视图未打开 —— 冷启动未就绪）";
		} else if (hiddenRing) {
			reason = "页签环**全部不可见**（" + d.ring.length + " 个页签全在隐藏容器里 · 盒 0×0 · 中心容器="
				+ JSON.stringify(d.surfaces || []) + "）—— 宿主当前显示的**不是**会话视图；"
				+ "在那个环上点击**原理上无效**（`geomExpr` 回「尺寸为 0」），"
				+ "只能靠 ③ 真实 UI 侧栏自举让宿主**重建**视图（纪律 149）";
		} else if (!d.hasDirector) {
			reason = "页签环里没有「总监」（视图未注册到宿主）";
		} else if (mountedNoBox) {
			/* 盒 `0x0` ⇒ 宿主显示的是**别的视图** ⇒ 修法 = "把视图切过来"，
			 * 而不是"等它渲染"或"重建起点"。 */
			reason = "`dp-root` **已挂载但未显示**（盒=" + d.rect + "）—— 宿主当前显示的**不是**总监视图；"
				+ "旧起点判据只覆盖「DOM 挂载」，故被误判为「在位」（纪律 148）";
		} else if (d.selected.indexOf("总监") >= 0) {
			reason = "「总监」已选中但**宿主未渲染视图内容**（`idPresent=" + d.idPresent + "` · 盒=" + d.rect + "）";
		} else {
			reason = "点了「总监」但宿主未切换视图";
		}
		note("  [起点] 结论：" + reason);
		return { ok: false, dpRoot: false, tabRing: ring, reason: reason, steps: steps };
	} catch (e) {
		const msg = String((e && e.message) || e);
		note("  [起点] 自举抛错（**已兜住，不向上抛穿** —— 执行链上的模块不许抛穿）：" + msg);
		return { ok: false, dpRoot: false, tabRing: [], reason: "自举抛错：" + msg, steps: steps };
	}
}
