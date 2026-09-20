#!/usr/bin/env node
/**
 * _r40-seg-shot.mjs —— 22 号文 **G3** 一次性探针：分段条**「人看得见」的验收入口**
 *
 * ⚠️ **一次性探针**：按 `.gitignore:74` 的惯例**用完即删、不入仓**。
 *    长期复用请把判据搬进 `verify-dialog.mjs` / 正式真机套件，别让探针变成第二处真相源。
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么要有它（22 号文 §G3 · 纪律 57「全绿 ≠ 能验收」）
 * ══════════════════════════════════════════════════════════════════
 *  分段条（总监 / 导图 / 智能体）第 38 轮改过颜色与文字，但**没有任何图给用户看**。
 *  闸门能证明「testid 在、aria-selected 在」，证明不了「**看起来**分得清」。
 *  本探针产出：① 每个选中态一张**整条特写**（`scale:2` 高清）；② 逐 tap 的
 *  `backgroundColor` / `color` / `fontWeight` / `aria-selected` 读数（落 JSON）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 判据口径**按实现修正**（纪律 130：证伪要显式更正原记录）
 * ══════════════════════════════════════════════════════════════════
 *  22 号文 §G3 原写「三个 tap 的底色读数**互不相同**」——
 *  **该口径与实现不符**：`DirectorDialog.js#S.segItem(on)` 只有**两态**
 *    · 选中   ：`backgroundColor: rgba(137,87,229,.52)` · `color: #ffffff` · `fontWeight: 600`
 *    · 未选中 ：`backgroundColor: transparent`            · `color: var(--dp-dlg-t2,…)` · `fontWeight: 400`
 *  ⇒ 照抄「三色互异」**必然假红**。实质意图是"防整条一个色 / 全黑也过"，故改为可成立的判据：
 *    ① 恰好一个 `aria-selected="true"`（分段条的**本质**）；
 *    ② 选中底色 **≠** 未选中底色（两态可辨）；
 *    ③ 切换选中 ⇒ 高亮**跟着换**（不是写死第一个）。
 *
 * ⚠️ 非空白判据：本仓**没有**既有的"像素方差"实现（`shot-dialog-bg.mjs` 只 `clip` 不判空）
 *    ⇒ 用三条**可被坏样本校准**（纪律 32）的硬口径代替：
 *      · PNG 头 IHDR 尺寸 == clip × scale（**拍到了该拍的框**，不是空图）；
 *      · 文件字节 > 8 KB（纯色/全黑 PNG 压缩后极小 ⇒ 全黑过不了）；
 *      · 三张字节**两两不同**（防"每次都拍同一张"）。
 *
 * 用法（**必须同一条命令**，纪律 ㊵；**复用实例**，遵守 T2）：
 *   RH_RESTART=0 node scripts/_run-with-harness.mjs bash -c 'node scripts/_r40-seg-shot.mjs'
 *
 * 退出码：0 通过 / 1 FAIL / 2 INVALID（前提不成立）
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { PORT } from "./cdp-port.mjs";
import { makeClicker } from "./_cdp-click-until.mjs";
import { waitCdpPage, ensureDirectorPage } from "./_cdp-startup.mjs";
/* 🔴 "非空白"判据**只有一处实现**（纪律 126）—— 本探针与 `verify-novel-e2e-human.mjs` 共用它 */
import { pngSize, shotCheck } from "./_shot-verify.mjs";

const OUT_DIR = resolve(process.argv[2] || "logs/acceptance22");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function t(id, name, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + id + " " + name); }
	else { fail++; console.log("  ❌ " + id + " " + name + (detail !== undefined ? "\n      → " + JSON.stringify(detail) : "")); }
}
const _bail = (why) => (e) => {
	console.error("\nIS_PASS: FALSE（INVALID：" + why + "）");
	console.error("  已跑 " + (pass + fail) + " 条（通过 " + pass + " / 失败 " + fail + "）");
	console.error("  原因：" + String((e && e.stack) || e).split("\n").slice(0, 3).join(" ｜ "));
	process.exit(2);
};
process.on("uncaughtException", _bail("未捕获异常"));
process.on("unhandledRejection", _bail("未处理的 Promise 拒绝"));

console.log("═══════════════════════════════════════════════════════════");
console.log(" G3 · 分段条人的验收入口（22 号文 §G3）→ " + OUT_DIR);
console.log(" 模式：" + (String(process.env.RH_RESTART || "") === "0" ? "复用实例" : "RH_RESTART 未置 0（注意别重复启停，T2）"));
console.log("═══════════════════════════════════════════════════════════");

/* ── 等 CDP 就绪（唯一实现：`_cdp-startup.mjs#waitCdpPage`，纪律 98/55）── */
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + (T.reason || "连不上 CDP " + PORT) + "）");
	console.error("  正确用法（启动与测试**同一条命令**）：");
	console.error("    RH_RESTART=1 node scripts/_run-with-harness.mjs bash -c 'node scripts/_r40-seg-shot.mjs'");
	process.exit(2);
}

const ws = new WebSocket(T.page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
	const m = JSON.parse(e.data);
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");
const ev = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) return "__exc:" + r.exceptionDetails.text;
	return r.result ? r.result.value : undefined;
};

/* ── 起点自举（唯一实现，纪律 98）──────────────────────────────── */
const CL = makeClicker({ send: send, js: ev, sleep: sleep }, {});
const BOOT = await ensureDirectorPage({ CL: CL, js: ev, send: send, sleep: sleep, log: (s) => console.log("  [boot] " + s) });
if (!(await ev("!!document.querySelector('[data-testid=\"dp-root\"]')"))) {
	console.error("IS_PASS: FALSE（INVALID：总监页未挂载 ⇒ 分段条无从谈起）");
	console.error("  boot = " + JSON.stringify(BOOT));
	process.exit(2);
}

/* ── 打开弹窗（分段条在弹窗内）────────────────────────────────── */
await ev("(function(){var s=window.__directorLayoutStore;if(s&&typeof s.setDialogOpen==='function')s.setDialogOpen(true);return 1;})()");
let dlgOk = false;
for (let k = 0; k < 20 && !dlgOk; k++) { dlgOk = Boolean(await ev("!!document.querySelector('[data-testid=\"d-dialog\"]')")); if (!dlgOk) await sleep(250); }
if (!dlgOk) {
	/* 🔴 必须自解释（纪律 138）：错误边界会把"层崩了"变成"只有一个角标"
	 *    ⇒ 点开「技术详情」把**异常原文**带出来，而不是只打一句"弹窗未打开"。 */
	const diag = await ev("(function(){var b=document.querySelector('[data-testid=\"d-layer-detail-toggle\"]');if(b)b.click();return 1;})()");
	await sleep(400);
	/* ⚠️ React 状态提交是异步的 ⇒ 必须"先点、再等、再读" */
	let detail = await ev("(function(){var e=document.querySelector('[data-testid=\"d-layer-detail\"]');return e?e.textContent:null;})()");
	for (let k = 0; k < 12 && !detail; k++) { await sleep(250); detail = await ev("(function(){var e=document.querySelector('[data-testid=\"d-layer-detail\"]');return e?e.textContent:null;})()"); }
	const logs = await ev("(function(){var d=window.__dshDebug;return d&&d.logs?d.logs.slice(-6):null;})()");
	console.error("IS_PASS: FALSE（INVALID：弹窗未打开 ⇒ 分段条不在场）");
	console.error("  技术详情：" + (detail ? String(detail).slice(0, 500) : "（取不到 —— 角标可能不在）"));
	console.error("  调试尾部：" + JSON.stringify(logs));
	console.error("  diag=" + diag);
	process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });

const SEGS = [
	{ id: "director", tid: "d-seg-director", label: "总监" },
	{ id: "mindmap", tid: "d-seg-mindmap", label: "导图" },
	{ id: "agents", tid: "d-seg-agents", label: "智能体" }
];

/* 逐 tap 读数 + 整条 rect。⚠️ 表达式里**不出现反引号**（模板字面量内嵌反引号 = SyntaxError，本仓已踩过）。 */
const PROBE = "(function(tid){"
	+ "var e=document.querySelector('[data-testid=\"'+tid+'\"]');if(!e)return null;"
	+ "var cs=getComputedStyle(e);var r=e.getBoundingClientRect();"
	+ "var p=e.parentElement?e.parentElement.getBoundingClientRect():r;"
	+ "return {bg:cs.backgroundColor,fg:cs.color,sel:e.getAttribute('aria-selected'),weight:cs.fontWeight,"
	+ "rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],"
	+ "bar:[Math.round(p.x),Math.round(p.y),Math.round(p.width),Math.round(p.height)]};})";

const readAll = async () => {
	const o = {};
	for (const s of SEGS) o[s.id] = await ev("(" + PROBE + ")(" + JSON.stringify(s.tid) + ")");
	return o;
};

/** PNG IHDR 尺寸 / 非空白判据 —— **用公共实现**（`_shot-verify.mjs`，纪律 126 唯一真相源）。
 *  第 41 轮实测教训：本探针初版自己写了 `bytes > 8192` 的固定下限，
 *  而分段条特写只有 572×80 ⇒ 真实截图 6.8 KB ⇒ **假红**。
 *  8 KB 是"整屏截图"的直觉数，不是从判据语义推出来的（纪律 126：阈值不许照手工计数钉）。 */

const SHOT_SCALE = 2;
const shots = [];
async function shotBar(name, bar, note) {
	const pad = 3;
	const clip = {
		x: Math.max(0, bar[0] - pad), y: Math.max(0, bar[1] - pad),
		width: bar[2] + pad * 2, height: bar[3] + pad * 2, scale: SHOT_SCALE
	};
	const r = await send("Page.captureScreenshot", { format: "png", clip: clip });
	const buf = Buffer.from(r.data, "base64");
	const p = join(OUT_DIR, name);
	writeFileSync(p, buf);
	const rec = { name: name, note: note, path: p, bytes: buf.length, png: pngSize(buf), want: { w: clip.width * SHOT_SCALE, h: clip.height * SHOT_SCALE } };
	rec.check = shotCheck(buf, rec.want);
	shots.push(rec);
	return rec;
}

const r0 = await readAll();
t("SEG-1", "三个 tap 都在场（`d-seg-director` / `d-seg-mindmap` / `d-seg-agents`，非源码级 —— 真机 DOM）",
	SEGS.every((s) => r0[s.id] && r0[s.id].rect[2] > 0 && r0[s.id].rect[3] > 0),
	SEGS.map((s) => ({ id: s.id, ok: Boolean(r0[s.id]), rect: r0[s.id] && r0[s.id].rect })));

const selCount = (rs) => SEGS.filter((s) => String(rs[s.id] && rs[s.id].sel) === "true").length;
t("SEG-2", "恰好**一个** tap 是选中态（`aria-selected=\"true\"`）—— 这是「分段条」的本质，0 个或 2 个都不成立",
	selCount(r0) === 1, { selected: SEGS.filter((s) => String(r0[s.id] && r0[s.id].sel) === "true").map((s) => s.id) });

const on0 = SEGS.find((s) => String(r0[s.id] && r0[s.id].sel) === "true");
const off0 = SEGS.filter((s) => s !== on0);
t("SEG-3", "🔴 选中底色 **≠** 未选中底色（防「整条一个色」；口径已按 `S.segItem(on)` 两态实现修正，纪律 130）",
	Boolean(on0) && off0.every((s) => r0[s.id].bg !== r0[on0.id].bg),
	{ on: on0 && { id: on0.id, bg: r0[on0.id].bg }, off: off0.map((s) => ({ id: s.id, bg: r0[s.id].bg })) });

/* ── 逐态截特写 + 切一次验证高亮跟着换 ───────────────────────── */
for (const s of SEGS) {
	const rs = await readAll();
	const bar = (rs[s.id] || {}).bar || (r0[s.id] || {}).bar;
	if (!bar) continue;
	await shotBar("seg-" + s.id + ".png", bar, "选中「" + s.label + "」时的整条特写（scale " + SHOT_SCALE + "）");
	if (s !== SEGS[0]) {
		await CL.clickSel("[data-testid=\"" + s.tid + "\"]", "切到「" + s.label + "」");
		await sleep(300);
	}
}

const rAfter = await readAll();
t("SEG-4", "🔴 切换选中（点「导图」「智能体」）⇒ 高亮**跟着换**，不是写死第一个",
	String(rAfter[SEGS[SEGS.length - 1].id].sel) === "true" && String(rAfter[SEGS[0].id].sel) !== "true",
	{ after: SEGS.map((s) => ({ id: s.id, sel: String(rAfter[s.id].sel) })) });

t("SEG-5", "截图 ≥3 张、每张都**拍到了东西**（PNG 尺寸 == clip × " + SHOT_SCALE + " **且** 字节数 > 面积相关下限 —— 纯色 / 全黑通不过）",
	shots.length >= 3 && shots.every((s) => s.check.ok),
	shots.map((s) => ({ n: s.name, bytes: s.bytes, png: s.png, want: s.want, minBytes: s.check.minBytes, why: s.check.ok ? null : s.check.why })));

t("SEG-6", "三张截图**两两互异**（防每次都拍同一张 / 拍空）",
	shots.length >= 3 && new Set(shots.map((s) => s.bytes)).size === shots.length,
	shots.map((s) => s.bytes));

/* ── 读数落档（供人工核对 + 报告引用）────────────────────────── */
const readout = {
	at: new Date().toISOString(),
	outDir: OUT_DIR,
	segItems: SEGS.map((s) => ({ id: s.id, tid: s.tid, label: s.label, before: r0[s.id], after: rAfter[s.id] })),
	shots: shots.map((s) => ({ name: s.name, path: s.path, bytes: s.bytes, png: s.png }))
};
writeFileSync(join(OUT_DIR, "seg-readout.json"), JSON.stringify(readout, null, 1), "utf8");

console.log("\n── 读数（选中 / 未选中 两态）──");
for (const s of SEGS) {
	const b = r0[s.id] || {};
	console.log("  " + s.label.padEnd(4) + " sel=" + b.sel + "  bg=" + b.bg + "  fg=" + b.fg + "  weight=" + b.weight);
}
console.log("\n── 截图 ──");
for (const s of shots) console.log("  " + s.name + "  " + s.bytes + " B  " + (s.png ? s.png.w + "x" + s.png.h : "?") + "  → " + s.path);
console.log("  读数 JSON: " + join(OUT_DIR, "seg-readout.json"));

console.log("\n  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
process.exit(fail === 0 ? 0 : 1);
