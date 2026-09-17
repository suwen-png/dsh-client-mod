#!/usr/bin/env node
/**
 * _cdp-click-until.mjs —— 真机套件的**共享点击层**（第二十四轮 · 落地 U6）
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 第二十四轮**真因纠正**（本条推翻了本文件初版的归因，留痕不删）
 * ──────────────────────────────────────────────────────────────────
 * **旧归因（已证伪）**：「CDP `Input.dispatchMouseEvent` 在 Electron 下偶发静默丢事件，
 *    是 Electron 的坑」—— 依据是「同一坐标、`elementFromPoint` 明确命中自己、
 *    合成鼠标却连丢 6 轮」。
 *
 * **真因（受控对照实测）**：丢的不是「偶发」，而是 **`document.visibilityState !== "visible"`
 *    时 CDP 的 `mousePressed`/`mouseReleased` 被**整条吞掉**（`mouseMoved` 照常送达）。
 *
 *    | 状态 | `visibilityState` | 真实鼠标序列送达 |
 *    |:--|:--|:--|
 *    | 建立前提前 | **`hidden`** | 只有 `pointermove`；**pointerdown/mousedown/pointerup/click 全丢** |
 *    | 建立前提后 | `visible` | 完整 6 个事件**全到** |
 *
 *    ⇒ 「点不动」是**前提缺失**，不是事件通道坏了。纪律 90。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 因此：`el.click()` 兜底**不再是"更可靠的路径"**（纪律 96）
 * ──────────────────────────────────────────────────────────────────
 * 前提修好之后，`verify-novel-split` 的兜底依赖 **8 → 0**、整轮耗时 **97s → 16s**
 * —— 而在此之前，正是这个兜底让 8 处红**全部转绿**，
 * **把真因盖了整整一轮**（第二轮靠「每一处都走兜底」这个**异常高频**才反查出来）。
 *
 * ⇒ 兜底在本层的定位改为**诊断通道**，且**必须记账**：
 *   ① 每走一次诊断通道 ⇒ `stats.diag++` 并留一条 `diagLog`；
 *   ② **首次**走时打印醒目提示（"先查前提"）；
 *   ③ 套件可在收尾读 `stats` / `diagSummary()`；**高频兜底 = 前提有问题的信号灯**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 本模块提供的三条语义
 * ──────────────────────────────────────────────────────────────────
 *  1. **几何自检**（纪律 22）：视口内 + 尺寸非 0 + `elementFromPoint` 命中自己。
 *     点不中 ⇒ 立刻回报原因（不在 DOM / 尺寸为 0 / 在视口外 / 被遮挡）。
 *  2. **后果校验**（纪律 55）：点了必须**等得到可观测后果**，等不到才重试。
 *  3. **双通道**：第 1 轮走**真实鼠标**（保住"用户真的点得动"的证据），
 *     之后走 **JS 直点**（**诊断通道**，计入 `stats.diag`）。
 *
 * 🔴 **这不是把红洗成绿**：`verifyFn` 由调用方给出（如"派发读数出现且 `kind=noise`"）。
 *    产品真坏了 ⇒ 每轮都无后果 ⇒ 预算耗尽照样判红。它只把
 *    「合成本身的偶发」与「产品坏了」**分开**；而「前提缺失」应由
 *    `ensurePageFocus`（`_cdp-focus.mjs`）在**套件入口**拦住并判 INVALID（纪律 24）。
 *
 * @param {{send:Function, js:Function, sleep:Function}} io
 * @param {{diagAnnounce?:boolean}} [opt] `diagAnnounce:false` 关掉首次兜底提示（默认开）
 * @returns {{clickAt:Function, clickSel:Function, clickJs:Function,
 *            clickByText:Function, clickJsByText:Function, clickUntil:Function,
 *            stats:object, diagSummary:Function}}
 */
export function makeClicker(io, opt) {
	const o = opt || {};
	const { send, js, sleep } = io;

	/* 🔴 兜底记账（纪律 96）——「高频兜底 = 前提有问题」的信号灯 */
	const stats = { mouse: 0, diag: 0, geomFail: 0, diagLog: [] };
	let diagAnnounced = false;

	function noteDiag(sel, text, why) {
		stats.diag++;
		stats.diagLog.push({ sel: sel, text: text || null, why: why || "" });
		if (!diagAnnounced && o.diagAnnounce !== false) {
			diagAnnounced = true;
			console.log("  ⚠️ [兜底首现] 真实鼠标未达成后果 ⇒ 走 JS 直点（**诊断通道**）"
				+ " · 目标=" + sel + (text ? " ｜ 文本=" + text : "")
				+ (why ? " ｜ 原因=" + why : ""));
			console.log("      ⇒ 单次可能是合成本身的偶发；**若本套件兜底次数 > 0，先查前提**（纪律 90：`visibilityState`）");
		}
	}

	/** 一行读数：真实鼠标 N ｜ 诊断通道 M ｜ 几何未命中 K（收尾打印/断言用） */
	function diagSummary() {
		return "真实鼠标 " + stats.mouse + " ｜ 诊断通道 " + stats.diag
			+ " ｜ 几何未命中 " + stats.geomFail;
	}

	/** 裸坐标点击（mouseMoved → pressed → released） */
	async function clickAt(x, y) {
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
		await sleep(40);
		await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
		stats.mouse++;
	}

	/** 几何自检表达式：命中返回坐标，未命中返回可读原因 */
	function geomExpr(finderExpr) {
		return "(function(){var e=" + finderExpr + ";"
			+ "if(!e) return {ok:false, why:'不在 DOM'};"
			+ "var r=e.getBoundingClientRect();"
			+ "if(r.width<2||r.height<2) return {ok:false, why:'尺寸为 0'};"
			+ "var x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);"
			+ "if(x<0||y<0||x>window.innerWidth||y>window.innerHeight) return {ok:false, why:'在视口外', at:[x,y]};"
			+ "var hit=document.elementFromPoint(x,y);var mine=hit===e||e.contains(hit);"
			+ "return mine?{ok:true,at:[x,y],text:String(e.textContent||'').trim().slice(0,24)}"
			+ ":{ok:false, why:'elementFromPoint 未命中自己', at:[x,y],"
			+ "hit:hit?String(hit.tagName)+'.'+String(hit.className||'').slice(0,24):null};})()";
	}

	/** 按 CSS 选择器 · 真实鼠标 */
	async function clickSel(sel) {
		const info = await js(geomExpr("document.querySelector(" + JSON.stringify(sel) + ")"));
		if (!info || !info.ok) { stats.geomFail++; return { ok: false, info: info }; }
		await clickAt(info.at[0], info.at[1]);
		return { ok: true, info: info, via: "mouse" };
	}

	/** 按 CSS 选择器 · **JS 直点（诊断通道；计入 `stats.diag`）**；仍回报 `self` 作为纪律 22 的证据 */
	async function clickJs(sel, why) {
		const info = await js("(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");"
			+ "if(!e) return {ok:false, why:'不在 DOM'};"
			+ "var r=e.getBoundingClientRect();"
			+ "if(r.width<2||r.height<2) return {ok:false, why:'尺寸为 0'};"
			+ "var x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);"
			+ "var hit=document.elementFromPoint(x,y);var mine=hit===e||e.contains(hit);"
			+ "try{ e.click(); }catch(err){ return {ok:false, why:'click 抛错：'+String(err&&err.message)}; }"
			+ "return {ok:true, why:'', at:[x,y], self:mine, text:String(e.textContent||'').trim().slice(0,24),"
			+ "hit:hit?String(hit.tagName)+'.'+String(hit.className||'').slice(0,24):null};})()");
		if (info && info.ok) noteDiag(sel, null, why);
		return { ok: !!(info && info.ok), info: info, via: "js-click", diag: true };
	}

	/** 按**可见文本** · 真实鼠标（同一选择器多个候选时只点文本匹配的那个） */
	async function clickByText(sel, text) {
		const info = await js(geomExpr("[].slice.call(document.querySelectorAll(" + JSON.stringify(sel) + "))"
			+ ".filter(function(x){return String(x.textContent||'').trim()===" + JSON.stringify(text) + ";})[0]"));
		if (!info || !info.ok) { stats.geomFail++; return { ok: false, info: info }; }
		await clickAt(info.at[0], info.at[1]);
		return { ok: true, info: info, via: "mouse" };
	}

	/** 按**可见文本** · **JS 直点（诊断通道）** */
	async function clickJsByText(sel, text, why) {
		const info = await js("(function(){var L=[].slice.call(document.querySelectorAll(" + JSON.stringify(sel) + "));"
			+ "var e=L.filter(function(x){return String(x.textContent||'').trim()===" + JSON.stringify(text) + ";})[0];"
			+ "if(!e) return {ok:false, why:'无匹配文本', n:L.length};"
			+ "var r=e.getBoundingClientRect();"
			+ "if(r.width<2||r.height<2) return {ok:false, why:'尺寸为 0'};"
			+ "var x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);"
			+ "var hit=document.elementFromPoint(x,y);var mine=hit===e||e.contains(hit);"
			+ "try{ e.click(); }catch(err){ return {ok:false, why:'click 抛错：'+String(err&&err.message)}; }"
			+ "return {ok:true, why:'', at:[x,y], self:mine, text:String(e.textContent||'').trim()};})()");
		if (info && info.ok) noteDiag(sel, text, why);
		return { ok: !!(info && info.ok), info: info, via: "js-click", diag: true };
	}

	/**
	 * 点击 → 校验后果 → 未达成则重试（第 1 轮真实鼠标，之后走诊断通道）。
	 * @param {{sel?:string, text?:string}} target `sel` 必填；`text` 给定时按文本定位
	 * @param {() => Promise<any>} verifyFn 返回真值 = 后果已发生
	 * @param {{rounds?:number, gapMs?:number, warmMs?:number, waitTries?:number, waitGap?:number}} [opt]
	 * @returns {Promise<{ok:boolean, rounds:number, why?:string, info?:any, val?:any, via?:string, diag?:boolean}>}
	 */
	async function clickUntil(target, verifyFn, opt2) {
		const c2 = opt2 || {};
		const rounds = c2.rounds || 6;
		const gapMs = c2.gapMs || 500;
		const warmMs = c2.warmMs || 300;
		const tries = c2.waitTries || 8;
		const waitGap = c2.waitGap || 200;
		let why = "";
		let lastInfo = null;
		for (let i = 1; i <= rounds; i++) {
			const useJs = i > 1;
			let c;
			if (useJs) c = target.text
				? await clickJsByText(target.sel, target.text, why)
				: await clickJs(target.sel, why);
			else c = target.text ? await clickByText(target.sel, target.text) : await clickSel(target.sel);
			if (!c.ok) { why = "未命中：" + JSON.stringify(c.info); await sleep(gapMs); continue; }
			lastInfo = c.info;
			/* 🔴 点完**必须先给渲染留时间**再判后果 —— 否则"刚点完立刻读=空"会被当成"没生效"
			 *    ⇒ 再点一次 ⇒ **同一个派发跑两遍（重复建会话）**。这是比红更坏的假绿。 */
			let v = null;
			for (let k = 0; k < tries && !v; k++) { await sleep(warmMs); v = await verifyFn(); if (!v) await sleep(waitGap); }
			if (v) return { ok: true, rounds: i, info: c.info, val: v, via: c.via, diag: useJs === true };
			why = "已命中但无后果";
			await sleep(gapMs);
		}
		return { ok: false, rounds: rounds, info: lastInfo, why: why };
	}

	return { clickAt, clickSel, clickJs, clickByText, clickJsByText, clickUntil, stats, diagSummary };
}

/** 按 Esc 清浮层（宿主的导图/工作室/弹窗会吃掉页签与按钮的点击） */
export async function pressEsc(send, sleep) {
	for (const type of ["keyDown", "keyUp"]) {
		await send("Input.dispatchKeyEvent", {
			type: type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
		});
	}
	await sleep(120);
}
