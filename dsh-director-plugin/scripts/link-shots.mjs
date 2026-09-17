#!/usr/bin/env node
/**
 * link-shots.mjs —— 19 号文 **N8 落点 2**：总监链路**分步截图**（人可感知验收层 · L3）
 *   ≥6 张 · 每张**含目标锚点** · 每张**非空白**（像素方差阈值）· 落 `logs/acceptance19/`
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么"闸门全绿"还不够（用户原话）
 * ──────────────────────────────────────────────────────────────────
 *   「闸门全绿，我**看不出**流程通了。」
 *   e2e 断言能证明"点了会变"，证明不了"**用户第一眼看得到**"。
 *   ⇒ 本脚本把链路每一步**拍下来**，并把「这一张里必须能看到什么」写成可断言的锚点。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 判据（每条都对着一类"看起来过"的失败形态）
 * ──────────────────────────────────────────────────────────────────
 *   ① **张数 ≥ 6**：少一张就意味着链路有一段没人看过。
 *   ② **每张必须有目标锚点**：否则拍的是"空页" —— 空白页也算通过是这条判据最大的反例。
 *   ③ **非空白 = 实测像素统计**（不是"文件存在"）：
 *      解 PNG 的 IDAT ⇒ 对**解压后的扫描线字节**算方差与唯一值个数。
 *      空白页解压后几乎全是同一字节（方差≈0、唯一值≈1）⇒ 一眼可分。
 *      ⚠️ 不实现完整 PNG 滤波还原：判据是"**非空白**"，不是"像素精确",
 *        对扫描线字节统计已足够且少 60 行易错代码（滤波链是另一个 bug 温床）。
 *   ④ **前提缺失 ≠ 产品坏**（纪律 94）：若某步的锚点不存在（例如还没派发过），
 *      如实标注 `anchor:false` 并计入 `missing`，最后**退出码 2（INVALID）**——
 *      并打印**可执行的补救命令**，而不是把它读成"产品坏了"。
 *   ⑤ **张数够 ≠ 有用**（`LS-5`）：10 张里若有多张 md5 相同 ⇒ 拍的是同一帧。
 *   ⑥ **复原**（`LS-6`）：本脚本开过的浮层收尾必须关掉（不然给下一个套件留脏状态）。
 *
 * 🔴 状态契约：本脚本**只观测 + 切换界面面**（点开浮层 / 换选中态），
 *    **不派发、不写入、不建会话**；收尾按 `close` 逐个复原地关闭（`LS-6` 断言）。
 *
 * 环境：`CDP_PORT`（默认 9222）· `SHOTS_DIR`（默认 `logs/acceptance19`）
 *       · `LS_CAL_DUP=1`（🧪 校准态，只在"留证"时用 —— 见文件尾说明）
 * 前置：Harness 已在跑（与本脚本**同一条命令**内启动 —— 纪律 ㊵）
 * 用法：node scripts/link-shots.mjs ｜ 退出码 0 全绿 / 1 有红 / 2 前提缺失
 */

import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ensureDirectorPage, waitCdpPage } from "./_cdp-startup.mjs";
import { makeClicker } from "./_cdp-click-until.mjs";

const PORT = Number(process.env.CDP_PORT || 9222);
const DIR = process.env.SHOTS_DIR || "logs/acceptance19";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 非空白阈值（variance/uniq）—— 由首跑实测标定，见文件尾 README 注 */
const MIN_VAR = 40;
const MIN_UNIQ = 12;
/** 🔴 当门的两条（口径取自**产品自己的可见性**，与动态像素无关）：
 *    · 界面面**覆盖** ≥ 4（总监页 / 导图 / 工作室 / 个性化 —— 每面至少一张）；
 *    · **换面必换帧**（任两张不同面的截图 md5 必须不同）。
 *  ⚠️ 「md5 去重后的不同画面数」**不再当门**（2026-09-17 第二十七轮）：同计划两次跑得 **6 / 8**
 *     两种值 —— 它量的是**动态像素**（读数刷新 / 滚动余量）而非证据面 ⇒ 当门必然假红假绿。 */
const FACES = ["page", "mindmap", "studio", "personalize"];
const MIN_FACES = FACES.length;
const ls5Ok = (n) => n >= MIN_FACES;
/** 🔴 浮层**可见性**唯一实现（face 观察 / 收尾复原共用 —— 各写一份迟早不同源，纪律 78）：
 *  口径 = **计算样式 + 盒尺寸**，**不是** `querySelector` 的"存在"
 *  （设计图工作室关闭后节点仍在 DOM、只是隐藏 ⇒ 用"存在"判必恒真）。 */
const VIS = `function vis(e){ if(!e) return false; var s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0') return false; var b=e.getBoundingClientRect(); return b.width>1&&b.height>1; }`;

/**
 * 最小 PNG 统计：读 IHDR 拿尺寸，拼 IDAT 解压，对**扫描线字节**算分布。
 * @param {Buffer} buf
 * @returns {{w:number,h:number,raw:number,mean:number,variance:number,uniq:number}}
 */
function pngStats(buf) {
	if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return { w: 0, h: 0, raw: 0, mean: 0, variance: 0, uniq: 0 };
	let off = 8, w = 0, h = 0;
	const idat = [];
	while (off + 8 <= buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.toString("ascii", off + 4, off + 8);
		const data = buf.subarray(off + 8, off + 8 + len);
		if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
		else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
		off += 12 + len;
	}
	if (!idat.length) return { w: w, h: h, raw: 0, mean: 0, variance: 0, uniq: 0 };
	let raw;
	try { raw = inflateSync(Buffer.concat(idat)); } catch (e) { return { w: w, h: h, raw: 0, mean: 0, variance: 0, uniq: 0 }; }
	const n = raw.length;
	let sum = 0, sum2 = 0;
	const seen = new Uint8Array(256);
	for (let i = 0; i < n; i++) { const v = raw[i]; sum += v; sum2 += v * v; seen[v] = 1; }
	let uniq = 0;
	for (let i = 0; i < 256; i++) if (seen[i]) uniq++;
	const mean = n ? sum / n : 0;
	return { w: w, h: h, raw: n, mean: Math.round(mean), variance: Math.round(n ? (sum2 / n - mean * mean) : 0), uniq: uniq };
}

/* ── 链路分步定义（"这一张里必须看得到什么"就是锚点）─────────────────────
 * `sel` 必须存在于 DOM，`probe` 返回该步的**读数**（也写进清单，供人/闸门对账）。 */
const SHOTS = [
	/* 🔴 2026-09-17 第二十六轮 · **张数够 ≠ 有用**（纪律 31/60）：
	 *    修前 8 张里有 **4 张 md5 完全相同**（`01/02/03/04` 一组、`05/06/07/08` 一组）
	 *    —— 四张都在**同一个静态页面的不同锚点**上滚动，锚点都在同一屏内 ⇒
	 *    截出来是同一帧。「≥6 张非空白截图」因此**全绿却零信息量**。
	 *    ⇒ 计划改为**按「界面面」取景**：每张要么换浮层、要么在浮层里换选中态，
	 *      并新增判据 **`LS-5`：去重（md5）后不同画面数 ≥ 6**（配 `LS_CAL_DUP=1` 校准）。
	 *    ⚠️ 锚点全部取自**实测存在**的 `data-testid`（纪律 53：只信实测）。
	 *    🔴 **换选中态必须换到"另一个"**（2026-09-17 第二十七轮实测踩到）：修前 06/08 都点
	 *      第一个元素，而第一个往往**本来就是选中态** ⇒ 点与不点画面一样（`mindmap ≡ mindmap-node`、
	 *      `studio-screen ≡ canvas`）—— 这类重复是**证据假**（"切换成功"没被看见），不是判据坏。
	 *      ⇒ 用 `clickIdx` 选**第 2 个**（不存在时回落到第 1 个）。
	 *    ℹ️ 01–04 同帧是**事实陈述**而非缺陷：四处读数**同屏**（"进门第一眼全都在"）——
	 *      本判据要拦的是"换浮层/换选中态也拍成同一帧"那种形态。 */
	{ n: "01", id: "before", name: "总监页 · 常驻读数（进门第一眼）", sel: '[data-testid="dp-live-readout"]',
		probe: `(function(){var e=document.querySelector('[data-testid="dp-live-readout"]');return e?e.textContent:null;})()` },
	{ n: "02", id: "console", name: "总监页 · 控制台动作与计数同屏", sel: '[data-testid="dp-console-counts"]',
		probe: `(function(){var e=document.querySelector('[data-testid="dp-console-counts"]');return e?e.textContent:null;})()` },
	{ n: "03", id: "attribution", name: "总监页 · 归属/转发/整理读数（N1/N2/N4）", sel: '[data-testid="dp-flow-split"]',
		probe: `(function(){var e=document.querySelector('[data-testid="dp-flow-split"]');if(!e)return null;return {attr:e.getAttribute('data-attr'),reason:e.getAttribute('data-reason'),dims:e.getAttribute('data-dims'),made:e.getAttribute('data-made'),reused:e.getAttribute('data-reused'),created:e.getAttribute('data-created'),lines:e.getAttribute('data-org-lines'),noise:e.getAttribute('data-org-noise')};})()` },
	{ n: "04", id: "collect", name: "总监页 · 回收（产出回流 + 总裁定）", sel: '[data-testid="dp-flow-collect"]',
		probe: `(function(){var e=document.querySelector('[data-testid="dp-flow-collect"]');return e?{read:e.getAttribute('data-read'),total:e.getAttribute('data-total'),verdict:e.getAttribute('data-verdict')}:null;})()` },
	{ n: "05", id: "mindmap", name: "分支导图浮层（分流出来的分支 + 血缘）", sel: '[data-testid="mm-root"]',
		open: '[data-testid="dp-open-mindmap"]',
		probe: `(function(){var e=document.querySelector('[data-testid="mm-root"]');return e?{nodes:document.querySelectorAll('[data-testid="mm-node"]').length,split:document.querySelectorAll('[data-split]').length,dossier:document.querySelectorAll('[data-dossier-role]').length}:null;})()` },
	{ n: "06", id: "mindmap-node", name: "导图 · 选中一条分支后的节点详情", sel: '[data-testid="mm-node"]',
		open: null, click: '[data-testid="mm-node"]', clickIdx: 1, close: '[data-testid="dp-open-mindmap"]',
		probe: `(function(){var e=document.querySelector('[data-testid="mm-node"][data-selected], [data-testid="mm-node"][data-active]')||document.querySelector('[data-testid="mm-node"]');return e?{title:e.getAttribute('data-title'),split:e.getAttribute('data-split'),sel:(e.getAttribute('data-selected')||e.getAttribute('data-active')||'')}:null;})()` },
	{ n: "07", id: "studio", name: "设计图工作室浮层（铺满全屏）", sel: '[data-testid="ds-root"]',
		open: '[data-testid="dp-open-design"]', close: null,
		probe: `(function(){var e=document.querySelector('[data-testid="ds-root"]');return e?{screens:document.querySelectorAll('[data-testid="ds-screen-row"]').length,total:(document.querySelector('[data-testid="ds-chip-total"]')||{}).textContent||null}:null;})()` },
	{ n: "08", id: "studio-screen", name: "工作室 · 切到某个设计屏后的画布", sel: '[data-testid="ds-screen-row"]',
		open: null, click: '[data-testid="ds-screen-row"]', clickIdx: 1,
		probe: `(function(){var e=document.querySelector('[data-testid="ds-screen-row"]');return e?{screen:e.getAttribute('data-screen')}:null;})()` },
	{ n: "09", id: "canvas", name: "工作室 · 画布与元素库同屏", sel: '[data-testid="ds-canvas"]',
		open: null, close: '[data-testid="dp-open-design"]',
		probe: `(function(){var e=document.querySelector('[data-testid="ds-canvas"]');return e?{kids:e.children.length,w:Math.round(e.getBoundingClientRect().width)}:null;})()` },
	/* 第 6 个**界面面**：个性化设定（四处共用同一组件的其中之一）——
	 * 锚点 `pp-panel` 取自实测（`PersonalizePanel.js` 第 158 行，`role="dialog"`）。 */
	{ n: "10", id: "personalize", name: "个性化设定面板（总监页入口）", sel: '[data-testid="pp-panel"]',
		open: '[data-testid="dp-personalize"]', close: '[data-testid="pp-close"]',
		probe: `(function(){var e=document.querySelector('[data-testid="pp-panel"]');return e?{scope:e.getAttribute('data-scope'),inset:e.getAttribute('data-inset'),opts:document.querySelectorAll('[data-testid^="pp-"]').length}:null;})()` }
];

let pass = 0, fail = 0; const failures = []; const manifest = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + "  " + name + (detail !== undefined && !cond ? "  → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log(" 19 号文 N8 · 链路分步截图（≥6 张 · 非空白 · 含目标锚点 · **不同画面 ≥6**）");
console.log("═══════════════════════════════════════════════════════════");

/* 🔴 有界等待 page 目标（**唯一实现** `_cdp-startup.mjs#waitCdpPage` —— 纪律 98/55）：
 *    「端口就绪」不等于「page 目标已在 `/json/list` 里」（实测端口 ≈2.0s，page 更晚）。 */
const T = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!T.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + T.reason + "，等了 " + Math.round(T.ms / 1000) + "s）");
	console.error("  正确用法（**同一条命令**，纪律 ㊵）：");
	console.error("    node scripts/_run-with-harness.mjs node scripts/link-shots.mjs");
	process.exit(2);
}
const page = T.page;

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id); pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");

const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) return "__exc:" + r.exceptionDetails.text;
	return r.result ? r.result.value : undefined;
};

/* 起点自举（**唯一实现** `_cdp-startup.mjs#ensureDirectorPage` —— 纪律 98） */
/* 🔴 同上（`verify-novel-e2e-human.mjs` 同族）：`CL` 必须是 `makeClicker()` 返回体，
 *    不是 `console.log` —— 否则冷启动需要**真实 UI 自举**时抛
 *    `CL.clickAt is not a function` ⇒ `dp-root` 不出现 ⇒ 整片假红。 */
const CL = makeClicker({ send: send, js: js, sleep: sleep });
const BOOT = await ensureDirectorPage({ CL: CL, js: js, send: send, sleep: sleep, log: (s) => console.log("  [boot] " + s) });
t("LS-0", "起点自举成功（`dp-root` 在 DOM —— 冷启动停留在欢迎页时必须先建立起点）",
	!!(BOOT && BOOT.ok !== false && (await js(`!!document.querySelector('[data-testid="dp-root"]')`)) === true), BOOT);

mkdirSync(DIR, { recursive: true });
/* 🧹 清掉**旧计划**的残留帧（编号模式 `NN-*.png` 但不在本次计划里）：
 *    否则人翻这个目录时分不出"哪 10 张是当前的"，上一版计划的截图会被当成当前证据
 *    （实测残留 `02-attribution` / `05-recv` / `11-canvas` … 共 10 张 —— 本目录是**本工具自己的
 *     产出目录**，每次运行全量重写，残留只会造成误读）。删除清单**逐个打印**（纪律 83：破坏性动作留痕）。 */
const expected = new Set(SHOTS.map((s) => s.n + "-" + s.id + ".png"));
const stale = [];
try {
	for (const f of readdirSync(DIR)) {
		if (!/^\d{2}-.*\.png$/.test(f) || expected.has(f)) continue;
		rmSync(join(DIR, f), { force: true });
		stale.push(f);
	}
} catch (e) { /* 清理失败不改结论（本脚本的判据不依赖旧帧） */ }
if (stale.length) console.log("  🧹 清除**旧计划**残留帧 " + stale.length + " 张：" + stale.join(" / "));

const missing = [];
const seenMd5 = new Map();
/* 🧪 植入缺陷校准（纪律 32/58，**只用于留证、正常跑不设**）：
 *    修前的缺陷形态是「所有步骤都在**同一个静态页面**上拍」⇒ 多张同一帧。
 *    `LS_CAL_DUP=1` 就**原样复现该形态**：第 02–09 张全部改拍第 1 张的锚点，
 *    且不开浮层 / 不点击 / 不关闭（只留第 10 张个性化面板当第二个界面面）。
 *    ⇒ 期望：**恰红 `LS-5` 一条**、其余全绿，且**与自然基线无关**。
 *    🔴 旧写法（只把第 2 张换成第 1 张）**校准等于没校准**：注入量恒 = 1 个重复，
 *       而自然不同画面数在 **6–8 之间飘** ⇒ `8−1=7` 仍 ≥6 ⇒ 校准态**照样报绿**。
 *       教训：校准的**注入量必须与基线无关**，不能"看运气跨阈值"（纪律 58「精确命中」）。 */
const CAL_DUP = String(process.env.LS_CAL_DUP || "") === "1";
const CAL_UPTO = SHOTS.length - 2;   // 索引 1..(N-2) ⇒ 第 02…0(N-1) 张压成同一帧
for (let si = 0; si < SHOTS.length; si++) {
	const s = SHOTS[si];
	if (CAL_DUP && si >= 1 && si <= CAL_UPTO) { s.sel = SHOTS[0].sel; s.open = null; s.click = null; s.close = null; }
	/* 换界面面：先点开浮层（**有界等待**它真的挂载；点了但没挂 ⇒ `anchor:false`，不静默） */
	let opened = null;
	if (s.open) {
		opened = (await js(`(function(){var e=document.querySelector('${s.open}');if(!e)return false;e.click();return true;})()`)) === true;
		if (opened) {
			for (let i = 0; i < 40; i++) {
				if ((await js(`!!document.querySelector('${s.sel}')`)) === true) break;
				await sleep(120);
			}
		}
	}
	/* 在浮层里换**选中态**（同一浮层的不同画面 —— 也是"流程看得见"的一部分）
	 * 🔴 换选中态 = 换到**另一个**（`clickIdx`）：点"本来就选中的那一个"画面不变
	 *    ⇒ 两张同一帧，而"切换成功"这件事**没被看见**（证据假，不是判据坏）。 */
	if (s.click) {
		const idx = Number(s.clickIdx || 0);
		await js(`(function(){var a=document.querySelectorAll('${s.click}');if(!a.length)return false;a[Math.min(${idx},a.length-1)].click();return true;})()`);
		await sleep(320);
	}
	const anchorOk = (await js(`!!document.querySelector('${s.sel}')`)) === true;
	const probe = await js(s.probe);
	/* 滚动到该锚点（让它真的进入视口 —— 否则截的是"页面上方"，锚点在屏幕外）
	 * ⚠️ 不点它、不改它（只观测）。 */
	if (anchorOk) await js(`(function(){var e=document.querySelector('${s.sel}');if(e&&e.scrollIntoView)e.scrollIntoView({block:'center'});return 1;})()`);
	await sleep(180);
	/* 🔴 **观察到的界面面**（快门前的实时读数 —— 不是按计划"声明"的那个面）：
	 *    这是 `LS-5` 的口径 —— 「名字叫工作室、画面还是总监页」这类**名不副实**只能这样抓。 */
	const face = await js(`(function(){ ${VIS}
  if(vis(document.querySelector('[data-testid="ds-root"]'))) return 'studio';
  if(vis(document.querySelector('[data-testid="mm-root"]'))) return 'mindmap';
  if(vis(document.querySelector('[data-testid="pp-panel"]'))) return 'personalize';
  return 'page';
})()`);
	const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
	const buf = Buffer.from(shot.data, "base64");
	const file = join(DIR, s.n + "-" + s.id + ".png");
	writeFileSync(file, buf);
	const st = pngStats(buf);
	const nonBlank = st.variance >= MIN_VAR && st.uniq >= MIN_UNIQ;
	/* 🔴 内容指纹：判"这张和前面某张是不是同一帧"（纪律 63 —— 比字节/体积可靠） */
	const md5 = createHash("md5").update(buf).digest("hex");
	const dupOf = seenMd5.get(md5) || null;
	if (!dupOf) seenMd5.set(md5, s.id);
	manifest.push({ n: s.n, id: s.id, name: s.name, file: file, face: face, anchor: anchorOk, sel: s.sel, probe: probe, png: st, nonBlank: nonBlank, bytes: buf.length, md5: md5, dupOf: dupOf, opened: opened });
	if (!anchorOk) missing.push(s.id);
	console.log("  " + (nonBlank ? "🖼 " : "❌ ") + s.n + " " + s.name + "  ⇒ " + file
		+ "  " + st.w + "x" + st.h + " " + buf.length + " B 方差 " + st.variance + " 唯一值 " + st.uniq
		+ "  面 " + face
		+ (dupOf ? "  ⚠️ 与 " + dupOf + " **同一帧**（md5 相同）" : "")
		+ (anchorOk ? "" : "  ⚠️ 锚点缺失（该步尚未发生）"));
	/* 复原：开合型控件必须还原（纪律 45/96）。
	 * 🔴 口径更正（本轮实测踩到）：条件**不能**写成 `opened && s.close` ——
	 *    「继承上一张已打开浮层」的那两张（导图节点详情 / 工作室画布）`open` 是 `null`
	 *    ⇒ `opened === null`（falsy）⇒ **关闭被整条跳过** ⇒ 浮层留在打开态（`LS-6` 红）。
	 *    正确条件只看 `s.close`：**谁声明了关闭动作就执行**，再用"锚点是否已消失"校验。 */
	if (s.close) {
		await js(`(function(){var e=document.querySelector('${s.close}');if(e)e.click();return true;})()`);
		for (let i = 0; i < 25; i++) { if ((await js(`!!document.querySelector('${s.sel}')`)) !== true) break; await sleep(120); }
	}
}

const shots = manifest.length;
const nonBlankN = manifest.filter((m) => m.nonBlank).length;
const anchoredN = manifest.filter((m) => m.anchor && m.nonBlank).length;

t("LS-1", "截图张数 ≥ 6（" + shots + " 张，覆盖链路分步）", shots >= 6, shots);
t("LS-2", "🔴 每张**非空白**（像素方差 ≥ " + MIN_VAR + " 且唯一值 ≥ " + MIN_UNIQ + " —— 空白页也算通过是这条判据最大的反例）",
	nonBlankN === shots, manifest.filter((m) => !m.nonBlank).map((m) => [m.id, m.png]));
t("LS-3", "🔴 **含目标锚点**的张数 ≥ 6（锚点在 DOM 且画面非空白 —— 二者缺一都可能是「拍了空页」）",
	anchoredN >= 6, { anchored: anchoredN, missing: missing });
t("LS-4", "清单落盘（`index.json`）：每张的锚点、读数、像素统计都可回查（不是「有几个 png 文件」）",
	(() => { writeFileSync(join(DIR, "index.json"), JSON.stringify({ at: new Date().toISOString(), port: PORT, minVar: MIN_VAR, minUniq: MIN_UNIQ, shots: manifest }, null, 2)); return true; })());
/* 🔴 LS-5：**张数够 ≠ 有用**（第二十六轮实测踩到；第二十七轮**换口径**）。
 *    修前 8 张里 **4 张 md5 完全相同**（`01/02/03/04` 与 `05/06/07/08` 各一组）——
 *    四张都在**同一静态页面的不同锚点**上滚动，锚点同屏 ⇒ **截的是同一帧**；
 *    ⇒ 「LS-1 张数 ≥ 6」+「LS-3 有锚点 ≥ 6」**全绿却零信息量**（纪律 31「报绿先审口径」）。
 *    🔴 但**不能**拿"md5 去重数"当门：同计划两次跑实测 **6 / 8** —— 它量的是**动态像素**
 *      （读数刷新 / 滚动余量），不量证据面 ⇒ 当门必然假红假绿（纪律 93「改判据先问反例」）。
 *    ⇒ 门换成两条**与像素噪声无关**、口径取自**产品自己的可见性**的判据：
 *      ① `LS-5`  **界面面覆盖 ≥ 4**：快门那一刻**实时观察到**的面（不是按计划声明的面）；
 *      ② `LS-5b` **换面必换帧**：任两张**不同面**的截图 md5 必须不同
 *         —— 直抓"名字叫工作室、画面还是总监页"这类**名不副实**（修前形态也一并被抓）。
 *    `不同画面数` 降级为**报告项**（照打，不设门）。
 *    🧪 校准：`LS_CAL_DUP=1` ⇒ 复现"浮层全不开、全在同一页面上拍"的修前形态 ⇒ 应**恰红 `LS-5`**。 */
const distinct = seenMd5.size;
const dups = manifest.filter((m) => m.dupOf).map((m) => m.id + "≡" + m.dupOf);
const faceCount = new Map();
for (const m of manifest) faceCount.set(m.face, (faceCount.get(m.face) || 0) + 1);
const observed = [...faceCount.keys()];
const unknownFace = observed.filter((f) => !FACES.includes(f));
t("LS-5", "🔴 **界面面覆盖 ≥ " + MIN_FACES + "**（实时观察 " + FACES.join(" / ") + " —— 每面至少一张，且快门那一刻**真的可见**）",
	ls5Ok(observed.length) && unknownFace.length === 0,
	{ coverage: observed.length, observed: observed, missingFaces: FACES.filter((f) => !faceCount.has(f)), unknownFace: unknownFace });
/* ② 换面必换帧：不同面的两张**必须**不同帧（**同一面内允许冗余取景** —— 四处读数本就同屏）。 */
const crossDup = [];
for (let i = 0; i < manifest.length; i++) {
	for (let j = i + 1; j < manifest.length; j++) {
		const a = manifest[i], b = manifest[j];
		if (a.face !== b.face && a.md5 === b.md5) crossDup.push(a.id + "(" + a.face + ")≡" + b.id + "(" + b.face + ")");
	}
}
t("LS-5b", "🔴 **换面必换帧**：不同界面面的两张截图 md5 必须不同（同一面内的冗余取景不算）",
	crossDup.length === 0, crossDup);
/* 报告项（**不是门**，理由见上）：画面数 + 面分布 + 同帧清单 —— 报绿也要肉眼可查（纪律 31）。 */
console.log("     ℹ️ 不同画面数（报告项，**不设门**）：" + distinct + " / " + shots
	+ " ｜ 面分布 " + FACES.map((f) => f + "×" + (faceCount.get(f) || 0)).join(" ")
	+ (dups.length ? " ｜ 同帧：" + dups.join(" / ") : " ｜ 同帧：无"));
if (CAL_DUP) {
	/* 校准态：缺陷数据（= 本次真实读数，因为缺陷已被注入）**必须**被判红；
	 * 用 `ls5Ok()` 而非另写阈值 ⇒ 证明"红/绿"确实由那一行谓词决定（纪律 32/58）。 */
	t("LS-5c", "🧪 校准态（`LS_CAL_DUP=1`）：缺陷数据用**同一谓词**判 ⇒ 必须为**红**（覆盖 ≤ " + (MIN_FACES - 1) + "）",
		!ls5Ok(observed.length), { coverage: observed.length, observed: observed });
}
/* 复原断言：浮层必须**真的不可见**（开合型控件不许留在打开态 —— 纪律 45/96）。
 * 🔴 口径更正（纪律 92：判据必须用产品自己的口径）：不能用 `querySelector` 判存在 ——
 *    设计图工作室关闭后**节点仍在 DOM**（只是隐藏）⇒ 用"存在"判会**恒红**（假红）。
 *    可见性判据与 face 观察**共用同一段实现**（`VIS` —— 各写一份迟早不同源，纪律 78）。 */
const leftOpen = await js(`(function(){ ${VIS}
  var out=[];
  if(vis(document.querySelector('[data-testid="ds-root"]'))) out.push('ds-root(设计图工作室)');
  if(vis(document.querySelector('[data-testid="mm-root"]'))) out.push('mm-root(分支导图)');
  if(vis(document.querySelector('[data-testid="pp-panel"]'))) out.push('pp-panel(个性化设定)');
  return out;
})()`);
t("LS-6", "🔴 收尾**复原**：凡本脚本打开的浮层都已关闭（不留痕迹给下一个套件）",
	Array.isArray(leftOpen) && leftOpen.length === 0, leftOpen);

console.log("");
console.log("  PASS " + pass + " / FAIL " + fail + " ｜ 截图 " + shots + " 张（非空白 " + nonBlankN + " · 有锚点 " + anchoredN + " · **不同画面 " + distinct + "**）"
	+ (CAL_DUP ? "  🧪 校准态" : ""));
if (CAL_DUP) {
	console.log("  🧪 校准态（`LS_CAL_DUP=1`）：本跑的红是**缺陷注入**造成的、**不是产品红** ——");
	console.log("     期望形态 = `LS-5` 红 + `LS-5c` 绿（证明该谓词对缺陷数据确实判红）；正常跑请**去掉**该环境变量。");
}
if (missing.length) {
	console.log("  ⚠️ 锚点缺失的步骤：" + missing.join(" / "));
	console.log("     真因：这些是**动作后**读数（`dp-flow-split` / `dp-flow-collect` / `dp-dir-msg`），");
	console.log("     在还没派发/回收过的页面上**本就不存在** —— 不是产品缺陷（纪律 94）。");
	console.log("     补救：先跑一次链路（会在真机上真建会话）：");
	console.log("       node scripts/_run-with-harness.mjs node scripts/verify-novel-split.mjs");
	console.log("     再重跑本脚本。");
}
if (fail || anchoredN < 6) {
	console.log("  IS_PASS: " + (fail ? "FALSE" : "FALSE（INVALID：有锚点的截图不足 6 张 —— 前提缺失，不判产品红）"));
	fs_manifestGuard(manifest);
	process.exit(fail ? 1 : 2);
}
console.log("  IS_PASS: TRUE");
ws.close();
process.exit(0);

/** 前提缺失时也把清单落盘（排障要看的是"缺了哪一步"） */
function fs_manifestGuard(m) {
	try { writeFileSync(join(DIR, "index.json"), JSON.stringify({ at: new Date().toISOString(), port: PORT, shots: m }, null, 2)); } catch (e) { /* 落盘失败不改结论 */ }
}
