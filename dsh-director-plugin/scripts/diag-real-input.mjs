#!/usr/bin/env node
/**
 * diag-real-input.mjs —— 真实鼠标 e2e 的**前提诊断**（纪律 90 / 94 / 96 的落点工具）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（本轮实测触发）
 * ──────────────────────────────────────────────────────────────────
 * 2026-09-17 第十九号文真机第一波：`verify-novel-split` 判 INVALID、
 * `verify-director-logic` 判 FAIL，共同症状是
 *   「真实鼠标未达成后果 ⇒ 走 JS 直点（**诊断通道**）」+ 派发零后果
 *   （`派发前 tab=0`、`已命中但无后果，已重试 6 轮`）。
 *
 * 🔴 按纪律 23「先证前提再断结果」：这**不能**直接读成「产品坏了「。至少三种前提要分开：
 *   ① 窗口可见性（`visibilityState`）—— 纪律 90：hidden 时 press/release 被整条吞掉；
 *   ② 起点（是否停在欢迎页 / 有没有 `[role="tab"]` 环）—— 工作区已知环境事实 #1；
 *   ③ 插件装载（`__dshDirectorView.registered`）—— 假注入率问题。
 *   三者都成立才是「产品红「；任一不成立 ⇒ **INVALID（环境不成立）**，不是产品失败（纪律 18）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 它做什么
 * ──────────────────────────────────────────────────────────────────
 *   ensureHarness（自行拉起，含端口顺移）→ 连 CDP → 打印前提读数 →
 *   `Page.bringToFront` + `Emulation.setFocusEmulationEnabled(true)` →
 *   **再打印一次**（前/后对照，证明「建立动作是否改变可见性「）。
 *
 * 用法：node scripts/diag-real-input.mjs ｜ 退出码 0 = 前提齐备 / 2 = 前提不成立
 */

import { ensureHarness } from "./_harness.mjs";

const PORT0 = Number(process.env.CDP_PORT || 9222);

async function listPages(port) {
	try {
		const r = await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(3000) });
		const a = await r.json();
		return a.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
	} catch (e) { return []; }
}

/** 极简 CDP 连接（零依赖；只做 send/ev） */
function connect(wsUrl) {
	return new Promise((res, rej) => {
		const ws = new WebSocket(wsUrl);
		let seq = 0;
		const pending = new Map();
		ws.addEventListener("message", (ev) => {
			let m = null;
			try { m = JSON.parse(ev.data); } catch (e) { return; }
			if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
		});
		ws.addEventListener("error", (e) => rej(new Error("WS error")));
		ws.addEventListener("open", () => res({
			ws: ws,
			send: (method, params) => new Promise((r2) => {
				const id = ++seq;
				pending.set(id, r2);
				ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
			}),
			close: () => { try { ws.close(); } catch (e) { } }
		}));
	});
}

/** 前提读数（**只用产品自己的口径**：`dp-root` 在 DOM 即「总监页在" —— 纪律 30/92） */
const PROBE = [
	"(() => {",
	"  const tabs = document.querySelectorAll('[role=\"tab\"]');",
	"  const txt = [];",
	"  tabs.forEach((x) => txt.push((x.textContent || '').trim().slice(0, 8)));",
	"  return JSON.stringify({",
	"    visibility: document.visibilityState,",
	"    hidden: document.hidden === true,",
	"    hasFocus: document.hasFocus(),",
	"    url: String(location.href).slice(0, 60),",
	"    title: String(document.title).slice(0, 40),",
	"    tabCount: tabs.length,",
	"    tabTexts: txt,",
	"    dpRoot: !!document.querySelector('[data-testid=\"dp-root\"]'),",
	"    actSplit: !!document.querySelector('[data-testid=\"dp-act-split\"]'),",
	"    registered: !!(window.__dshDirectorView && window.__dshDirectorView.registered),",
	"    winW: window.innerWidth, winH: window.innerHeight,",
	"    bodyLen: (document.body ? document.body.innerText.length : -1)",
	"  });",
	"})()"
].join("\n");

const h = await ensureHarness({ port: PORT0, budgetMs: 180000 });
if (!h.ok) {
	console.log("IS_PASS: FALSE（INVALID · Harness 未就绪：" + (h.why || "未知") + "）");
	process.exit(2);
}
console.log("Harness 就绪：port=" + h.port + " reused=" + h.reused + " shifted=" + h.shifted);

/* 有界等 page 目标（纪律 55：等待须校验返回值） */
let pages = [];
for (let i = 0; i < 60; i++) {
	pages = await listPages(h.port);
	if (pages.length) break;
	await new Promise((r) => setTimeout(r, 1000));
}
console.log("page 目标：" + pages.length + " 个" + (pages[0] ? " · title=" + JSON.stringify(String(pages[0].title || "")) : ""));
if (!pages.length) { console.log("IS_PASS: FALSE（INVALID · 无 page 目标）"); process.exit(2); }

const c = await connect(pages[0].webSocketDebuggerUrl);
const evalJs = async (expr) => {
	const m = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (m.result && m.result.exceptionDetails) return { err: String(m.result.exceptionDetails.text).slice(0, 120) };
	return m.result && m.result.result ? m.result.result.value : null;
};

console.log("\n─── 前提读数 · 建立动作**之前** ───");
let a = null;
try { a = JSON.parse(await evalJs(PROBE)); } catch (e) { console.log("  探针失败：" + e.message); }
console.log("  " + JSON.stringify(a));

/* 建立动作：与 `_cdp-focus.ensurePageFocus` 同一组（本脚本**只诊断**，不代替它） */
await c.send("Page.bringToFront", {});
await c.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await new Promise((r) => setTimeout(r, 1200));

console.log("\n─── 前提读数 · 建立动作**之后** ───");
let b = null;
try { b = JSON.parse(await evalJs(PROBE)); } catch (e) { console.log("  探针失败：" + e.message); }
console.log("  " + JSON.stringify(b));

const ok = b && b.visibility === "visible" && b.dpRoot === true && b.registered === true;
console.log("\n─── 结论（三前提分别判定，不合并）───");
console.log("  ① 可见性：" + (b ? b.visibility : "?") + (b && b.visibility === "visible" ? " ✓" : " ✗（纪律 90：press/release 会被整条吞掉）"));
console.log("  ② 起点  ：tab 环 " + (b ? b.tabCount : "?") + " 个 " + (b && b.tabCount > 0 ? "✓" : "✗（停在欢迎页 ⇒ 派发类断言必然全红）")
	+ " ｜ dp-root " + (b && b.dpRoot ? "在" : "不在") + " ｜" + (b && b.bodyLen < 50 ? " **疑似白屏**（bodyLen=" + b.bodyLen + "）" : ""));
console.log("  ③ 插件  ：registered=" + (b && b.registered) + " " + (b && b.registered ? "✓" : "✗"));
console.log("  hasFocus=" + (b && b.hasFocus) + "（**观测项**：hidden 时它仍可能是 true —— 骗人指标）");
c.close();
console.log(ok ? "\nIS_PASS: TRUE（真实鼠标前提齐备）" : "\nIS_PASS: FALSE（INVALID · 前提不成立，此时真机红**不可**读成产品失败）");
process.exit(ok ? 0 : 2);
