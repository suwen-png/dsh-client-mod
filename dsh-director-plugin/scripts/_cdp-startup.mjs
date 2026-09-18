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
	const RING = "Array.from(document.querySelectorAll('[role=\"tab\"]')).map(function(e){return String(e.textContent||'').trim();})";
	const TREE = "Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map(function(e,i){"
		+ "return {i:i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded'),cls:String(e.className||'').slice(0,44)};})";
	const OVERLAY = "['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(function(s){return !!document.querySelector(s);})";
	/* 🔴 **只认 `dp-root`**（纪律 30：「注册成功」≠「渲染成功」） */
	const hasRoot = () => js("!!document.querySelector('[data-testid=\"dp-root\"]')");
	const ringOf = async () => (await js(RING)) || [];
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
		if (await hasRoot()) {
			note("  [起点] `dp-root` 已在 DOM（起点已立，无需自举）· 环=" + JSON.stringify(ring));
			await stabilize();
			return { ok: true, dpRoot: true, tabRing: ring, reason: "", steps: steps };
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
			const half = Math.max(15000, Math.round(tabBudgetMs / 2));
			note("  [起点] 等待宿主就绪（**只等不点**，预算 " + Math.round(half / 1000) + "s）…");
			while (!ring.length && Date.now() - t0 < half) {
				await sleep(1500);
				ring = await ringOf();
				if (ring.length) break;
				if ((Date.now() - t0) % 15000 < 1600) note("  [起点]   t+" + Math.round((Date.now() - t0) / 1000) + "s 仍无环（宿主未渲染会话视图）");
			}
			note("  [起点] 等待 " + (Date.now() - t0) + "ms ⇒ 环 " + JSON.stringify(ring));
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
				if (!waitedForRing) note("  [起点] 点之前环又空了 ⇒ 只等不点（宿主仍在初始化）");
				waitedForRing += 1500;
				await sleep(1500);
				continue;
			}
			tries++;
			const c = tries === 1
				? await CL.clickByText('[role="tab"]', "总监")
				: await CL.clickJsByText('[role="tab"]', "总监");
			ok = await waitRoot(1400, 350);
			note("  [起点] 第 " + tries + " 轮「总监」" + (c && c.ok ? "命中" : "未命中 " + JSON.stringify(c && c.info))
				+ "（累计 " + (Date.now() - t4) + "ms）⇒ dp-root=" + ok);
			if (!ok) await sleep(900);
		}
		/* 退路：浮动组的「打开总监」（本轮实测它能点到，但冷启动时**不解决**挂载 —— 仍值得一试） */
		if (!ok) {
			const c2 = await CL.clickSel('[data-testid="d-open-director"]', "浮动组·打开总监");
			note("  [起点] 退路点「打开总监」：" + JSON.stringify({ ok: c2.ok }));
			if (c2.ok) ok = await waitRoot(6000, 400);
		}

		if (ok) { await stabilize(); return { ok: true, dpRoot: true, tabRing: ring, reason: "", steps: steps }; }
		/* ── 失败必须**可分辨**（纪律 58）：三种归因修法完全不同 ── */
		const diag = await js("(function(){var ts=[].slice.call(document.querySelectorAll('[role=tab]'));"
			+ "return JSON.stringify({ring:ts.map(function(e){return String(e.textContent||'').trim();}),"
			+ "selected:ts.filter(function(e){return e.getAttribute('aria-selected')==='true';}).map(function(e){return String(e.textContent||'').trim();}),"
			+ "hasDirector:ts.some(function(e){return String(e.textContent||'').trim()==='总监';}),"
			+ "handle:window.__dshDirectorView?!!window.__dshDirectorView.registered:null,"
			+ "idPresent:!!document.getElementById('dsh-director-page'),"
			+ "textured:document.querySelectorAll('.dp-textured').length});})()");
		note("  [起点] 🔴 失败归因 = " + diag);
		let d = null;
		try { d = JSON.parse(diag); } catch (_) { d = null; }
		const reason = !d ? "起点自举失败（归因读数读不到）"
			: (!d.ring.length ? "宿主始终没有页签环（会话视图未打开 —— 冷启动未就绪）"
				: (!d.hasDirector ? "页签环里没有「总监」（视图未注册到宿主）"
					: (d.selected.indexOf("总监") >= 0 ? "「总监」已选中但**宿主未渲染视图内容**（`idPresent=" + d.idPresent + "`）"
						: "点了「总监」但宿主未切换视图")));
		note("  [起点] 结论：" + reason);
		return { ok: false, dpRoot: false, tabRing: ring, reason: reason, steps: steps };
	} catch (e) {
		const msg = String((e && e.message) || e);
		note("  [起点] 自举抛错（**已兜住，不向上抛穿** —— 执行链上的模块不许抛穿）：" + msg);
		return { ok: false, dpRoot: false, tabRing: [], reason: "自举抛错：" + msg, steps: steps };
	}
}
