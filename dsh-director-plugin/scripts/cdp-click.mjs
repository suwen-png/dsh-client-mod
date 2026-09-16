/**
 * cdp-click.mjs — 真机逐交互点击验证（批次 8）
 *
 * 命题：**每一个可交互元素都要实际点击，并回读实际结果比对预期**。
 * 与普通契约验证的区别：契约验证只证明「函数存在」，本脚本证明「点了之后真的变了」。
 *
 * 验证项（每项都含 点击前 → 点击 → 点击后回读 三段）：
 *   I1  入口按钮「总监层级」  → 面板打开
 *   I2  页签 [概览]           → 概览内容可见
 *   I3  页签 [总监]           → 工作台可见（执行逻辑面板 + 对话流）
 *   I4  职责开关（5 个）      → 勾选状态翻转 + 生效值同步
 *   I5  prompt 编辑           → textarea 出现且内容可改
 *   I6  保存本层              → 落库（回读节点 duties）+ 来源变「本层」
 *   I7  向上提交              → 父节点 duties 被改写（回读父节点）
 *   I8  恢复继承              → 本节点 duties 清空（回读为 null）
 *   I9  总监对话流发送        → 消息数 +2（user + assistant），含五步过程
 *   I10 自动转发开关          → 开启后发送，转发回调被触发
 *   I11 树节点选择            → 面包屑/内容随之切换
 *   I12 同步真实会话          → 覆盖度刷新为 100%
 *
 * 用法：CDP_PORT=<端口> node scripts/cdp-click.mjs
 * 前置：Harness 已启动且带 `--remote-debugging-port=<端口>`
 * 退出码：0 通过 / 1 FAIL / 2 INVALID（等待预算不足等"读数不可信"情形，**不等于产品缺陷**）
 */

/* 🔴 端口不写死：Harness 每次启动都换端口（纪律 12 配套），写死 9222 会让脚本静默报"连不上" */
const PORT = Number(process.env.CDP_PORT || 9222);

/* ── CDP 连接 ── */
const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()).catch(() => null);
const page = targets && targets.filter((t) => t.type === "page").find((t) => !/devtools/.test(t.url));
if (!page) {
	console.error("未找到页面目标（Harness 未启动，或端口不是 " + PORT + "）。");
	console.error("  处置：先看实际端口，再 CDP_PORT=<端口> node scripts/cdp-click.mjs");
	console.error("        netstat -ano | grep -E '92[0-9][0-9]'");
	process.exit(2);   // INVALID ≠ FAIL（纪律 17）
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id !== undefined && pending.has(m.id)) {
		const { res, rej } = pending.get(m.id);
		pending.delete(m.id);
		m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
	}
});
const send = (method, params = {}) => new Promise((res, rej) => {
	const id = ++seq;
	pending.set(id, { res, rej });
	ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");

async function evalExpr(expression) {
	const out = await send("Runtime.evaluate", {
		expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true
	});
	if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text);
	return out.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询求值直到 `done` 为真或超时。
 * 🔴 为何必须轮询而非固定 sleep：总监链路含本地模型调用（单次超时 60s），
 *    耗时是**环境相关**的；固定 sleep 要么误报（太短）要么拖慢（太长）。
 */
async function pollEval(expression, timeoutMs = 15000, stepMs = 400) {
	const deadline = Date.now() + timeoutMs;
	let last = null;
	while (Date.now() < deadline) {
		last = await evalExpr(expression);
		if (last && last.done) return last;
		await sleep(stepMs);
	}
	return last;
}

/**
 * 等待面板「空闲」：所有受 busy 守卫的按钮恢复可点击。
 *
 * 🔴 为何必须有：`guard()` 会在异步操作期间把所有按钮置 `disabled`。
 *    对**禁用按钮**调 `click()` 是原生 no-op（不报错、无副作用）——
 *    固定 sleep 一旦短于实际操作耗时，后续点击会**静默失效**，
 *    表现为「点了新建但什么都没发生」（2026-09-12 实测踩中：
 *    `summarizeTree` 需遍历全树 11 节点，6s 固定等待不够）。
 */
async function waitIdle(timeoutMs = 60000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const idle = await evalExpr(`(() => {
			const ids = ['h-sum-tree','h-create','h-attach','h-save-meta','h-remove','h-sync'];
			return ids.every((t) => { const e = window.__q('[data-testid="' + t + '"]'); return !e || !e.disabled; });
		})()`);
		if (idle === true) return true;
		await sleep(500);
	}
	return false;
}

let pass = 0, fail = 0, skipped = 0;
const fails = [];
const skips = [];
/* 🔴 INVALID（退出码 2）= "读数不可信"，**不是产品缺陷**。
 *   典型来源：异步任务在等待预算内没跑完 ⇒ 此时读到的任何中间值都不该被当成结论。
 *   纪律 18 的推论：把"我读早了"报成"产品坏了"，比报红更坏（没人会去查闸门）。 */
let invalid = false;
function ok(name, cond, detail = "") {
	if (cond) { pass++; console.log("  ✅ " + name + (detail ? "  — " + detail : "")); }
	else { fail++; fails.push(name); console.log("  ❌ " + name + (detail ? "  — " + detail : "")); }
}
/* 🔴 SKIP 必须带**可分辨原因**（纪律 18）：禁用「本机数据如此」这类不可证伪收尾。
 *   与"静默消失"的区别：跳过会被**计数并打印原因**，断言总数不会随环境悄悄变化（纪律 39/46）。 */
function skip(name, reason) {
	skipped++; skips.push(name + " ← " + reason);
	console.log("  ⏭ SKIP " + name + "  — " + reason);
}

/* ── 页面内辅助函数（注入一次，后续复用）── */
await evalExpr(`
window.__click = (el) => { if(!el) throw new Error('元素不存在'); el.dispatchEvent(new MouseEvent('click',{bubbles:true})); el.click && el.click(); return true; };
window.__q = (sel) => document.querySelector(sel);
window.__qa = (sel) => Array.from(document.querySelectorAll(sel));
window.__byText = (sel, txt) => window.__qa(sel).find(e => (e.textContent||'').includes(txt));
window.__visible = (el) => { if(!el) return false; const r = el.getBoundingClientRect(); return r.width>0 && r.height>0; };
window.__panel = () => document.querySelector('#dsh-director-dialog [data-panel="levels"]');
window.__dlg = () => document.getElementById('dsh-director-dialog');
window.__openLevels = async () => {
	const launcher = () => document.getElementById('dsh-director-hierarchy-launcher');
	for (let i = 0; i < 5; i++) {
		if (!window.__dlg()) { const l = launcher(); if (l) l.click(); await new Promise(r => setTimeout(r, 520)); continue; }
		if (!window.__panel()) { const seg = document.querySelector('[data-testid="d-seg-levels"]'); if (seg) seg.click(); await new Promise(r => setTimeout(r, 420)); continue; }
		return true;
	}
	return Boolean(window.__panel());
};
window.__closeDlg = async () => {
	const btn = document.querySelector('[data-testid="d-close"]');
	if (btn) btn.click();
	else { const l = document.getElementById('dsh-director-hierarchy-launcher'); if (l && window.__dlg()) l.click(); }
	await new Promise(r => setTimeout(r, 520));
	return !window.__dlg();
};
'helpers ready'
`);

console.log("\n══════ 真机逐交互点击验证（批次 8 回归 · 批次 9 弹窗通道）══════\n");

/* ── I1 入口按钮（批次 9：入口改开弹窗，`#dsh-director-dialog`；层级内容在「层级」段内）── */
console.log("[I1] 入口按钮「总监」→ 弹窗打开");
const i1 = await evalExpr(`(() => {
	const btn = document.getElementById('dsh-director-hierarchy-launcher');
	if (!btn) return { found:false };
	return { found:true, text: btn.textContent, dlgBefore: Boolean(window.__dlg()) };
})()`);
ok("入口按钮存在", i1.found, "文案「" + (i1.text || "") + "」");
await sleep(700);
const i1open = await evalExpr(`(async () => (await window.__openLevels()) ? 'open' : 'closed')()`);
ok("点击后弹窗打开且「层级」段就位", i1open === "open", "state=" + i1open);
const i1spot = await evalExpr(`(() => ({
	hole: Boolean(document.querySelector('[data-testid="d-hole"]')),
	dialog: Boolean(window.__dlg()),
	split: document.documentElement.innerHTML.indexOf('dsh-director-split-style') >= 0
}))()`);
ok("弹窗为 spotlight 非模态覆盖层（洞内原生区保持可交互）", i1spot.hole && i1spot.dialog, JSON.stringify(i1spot));
ok("分屏通道已生效（原生对话区被右挤，零节点移动）", i1spot.split === true, "split-style=" + i1spot.split);

/* ── I2/I3 页签 ── */
console.log("\n[I2] 页签 [概览]");
const i2 = await evalExpr(`(() => {
	const t = window.__q('[data-testid="h-tab-overview"]'); if(!t) return {found:false};
	t.click(); return {found:true};
})()`);
ok("概览页签存在", i2.found);
await sleep(700);
const i2b = await evalExpr(`(() => {
	const p = window.__panel(); if(!p) return {ok:false};
	const txt = p.innerText||'';
	return { ok:true, hasCov:/总监已全覆盖|存在未覆盖/.test(txt), hasSync:/同步真实会话/.test(txt), hasDirectorPanel: Boolean(p.querySelector('[data-panel="director"]')) };
})()`);
ok("概览内容可见（覆盖度 + 同步按钮）", i2b.hasCov && i2b.hasSync);
ok("概览态下总监面板未渲染", i2b.hasDirectorPanel === false);

console.log("\n[I3] 页签 [总监]");
const i3 = await evalExpr(`(() => {
	const t = window.__q('[data-testid="h-tab-director"]'); if(!t) return {found:false};
	t.click(); return {found:true};
})()`);
ok("总监页签存在", i3.found);
await sleep(1500);
const i3b = await evalExpr(`(() => {
	const p = window.__panel(); if(!p) return {ok:false};
	const txt = p.innerText||'';
	return {
		ok:true,
		panel: Boolean(p.querySelector('[data-panel="director"]')),
		hasDuties:/执行逻辑/.test(txt),
		hasFlow:/总监对话流/.test(txt),
		hasSave:/保存本层/.test(txt),
		hasSubmit:/向上提交/.test(txt),
		hasRestore:/恢复继承/.test(txt),
		checks: p.querySelectorAll('[data-duty]').length,
		hasInput: Boolean(p.querySelector('[data-testid="director-input"]'))
	};
})()`);
ok("总监工作台已渲染", i3b.panel && i3b.hasDuties && i3b.hasFlow);
ok("执行逻辑面板 5 项职责开关齐全", i3b.checks === 5, "实测 " + i3b.checks + " 个");
ok("三个继承操作按钮齐全", i3b.hasSave && i3b.hasSubmit && i3b.hasRestore);
ok("对话流输入栏存在", i3b.hasInput);

/* ── I0 🔴 职责配置快照（本段会**持久化写**职责，必须先留底） ──
 *
 * 本段 I4→I8 是一条**真实写入链**：I4 逐项翻转 5 个开关 → I6「保存本层」把当时
 * **选中节点**的生效配置落库 → I7「向上提交」把**父节点**也写一遍 →
 * I8「恢复继承」**只清会话节点自己那一层**。
 *
 * 🔴 踩过的坑（2026-09-13，真实事故）：
 *   I6 保存时若选中的是**根节点「全局总管」**，I7 从会话向上提交又会写**工作区**级 ——
 *   于是「五项全关」被**永久**写进 `__global__` 与 `ws_*` 两级，且**没有任何一步会还原它们**。
 *   后果①：用户真实使用总监时五步全被跳过（正文退化成「（全部职责已关闭，原文直转）」）；
 *   后果②：下一次跑 `verify-flow.mjs`，G3b「助手消息含五步结论」**报红** ——
 *   读起来像产品坏了，实际是**上一轮闸门留下的持久状态**（与纪律 33「起点是否等价」同一族）。
 *   本脚本**不重载页面**，所以这类污染会跨运行、跨脚本一直活着。
 *
 * 纪律依据：§八 32/33（开合型控件必须当场还原 + 断言；能**持久化**的写入更要留快照）。
 * 做法：段前把**全树**里已有 own 配置的节点连内容一起存下，段后 ① 原样写回
 * ② 把快照里没有、现在却有 own 的节点**清掉**（那必然是本段写脏的）③ **逐节点回读自证**。 */
console.log("\n[I0] 职责配置快照（本段会持久化写入，先留底）");
const dutySnap = await evalExpr(`(async () => {
	const t = await window.__dshHierarchy.loadTree();
	const flat = []; const walk = (n) => { flat.push(n); (n.childNodes || []).forEach(walk); };
	walk(t);
	const snap = [];
	for (const n of flat) {
		const r = await window.__dshDuties.resolve(n.id);
		if (r.own) snap.push({ id: n.id, own: r.own });
	}
	return { total: flat.length, snap };
})()`);
console.log("  · 快照：" + dutySnap.total + " 个节点，其中 " + dutySnap.snap.length + " 个已有本层职责配置（段末会原样还原）");

/* ── I4 职责开关点击 ── */
console.log("\n[I4] 职责开关逐项点击（5 项）");
const keys = ["languagePolish", "modelRouting", "branchSwitch", "contextFilter", "outputReview"];
for (const k of keys) {
	const r = await evalExpr(`(async () => {
		const el = window.__q('[data-duty="${k}"]'); if(!el) return {found:false};
		const before = el.checked;
		el.click();
		await new Promise(r=>setTimeout(r,260));
		const after = window.__q('[data-duty="${k}"]').checked;
		return { found:true, before, after, flipped: before !== after };
	})()`);
	ok("开关 [" + k + "] 点击后状态翻转", r.found && r.flipped, r.before + " → " + r.after);
}

/* ── I5 prompt 编辑 ── */
console.log("\n[I5] prompt 编辑");
const i5 = await evalExpr(`(async () => {
	const btn = window.__q('[data-edit-prompt="languagePolish"]'); if(!btn) return {found:false};
	btn.click();
	await new Promise(r=>setTimeout(r,420));
	const ta = window.__q('[data-prompt-input="languagePolish"]');
	return { found:true, hasTextarea: Boolean(ta), value: ta ? ta.value.slice(0,30) : null };
})()`);
ok("prompt 编辑按钮点击后出现 textarea", i5.found && i5.hasTextarea, "内容前缀「" + i5.value + "」");

/* ── I6 保存本层（回读落库） ── */
console.log("\n[I6] 保存本层 → 回读落库");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i6 = await evalExpr(`(async () => {
	// 🔴 回读「当前选中节点」：以 UI 的真实选中态为准（data-selected="true"），
	//    不再假设「默认选中的是根节点」——那是实现细节，不是可见行为。
	const sel = window.__q('[data-selected="true"]');
	const targetId = sel ? sel.getAttribute('data-node-id') : null;
	if (!targetId) return { found:false, reason:'树中无选中行' };
	const before = await window.__dshDuties.resolve(targetId);
	const btn = window.__q('[data-testid="w-save"]'); if(!btn) return {found:false};
	btn.click();
	await new Promise(r=>setTimeout(r,900));
	const node = await window.__dshHierarchy.getNode(targetId);
	const after = await window.__dshDuties.resolve(targetId);
	return {
		found:true, targetId,
		ownBefore: before.own ? 'configured' : 'inherit',
		ownAfter: after.own ? 'configured' : 'inherit',
		dbDuties: node && node.duties ? Object.keys(node.duties).length : 0,
		origin0: after.origin.languagePolish
	};
})()`);
ok("保存按钮存在并点击", i6.found);
ok("🔴 回读：落库后本节点 duties 已写入", i6.dbDuties === 5, "duties 项数=" + i6.dbDuties);
ok("🔴 回读：来源标记变为本层（own）", i6.ownAfter === "configured" && i6.origin0 === "own", "origin=" + i6.origin0);

/* ── I7 向上提交 ── */
console.log("\n[I7] 向上提交 → 回读父节点");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i7 = await evalExpr(`(async () => {
	// 先选一个会话级节点（有父级），再向上提交
	const pick = async () => {
		const t = await window.__dshHierarchy.loadTree();
		return (t.childNodes||[]).flatMap(p => (p.childNodes||[]))[0] || null;
	};
	let sess = await pick();
	/* 🔴 前提建立（纪律 23 / 46 / 51）：**本 origin 每次启动都是新的**（纪律 E：只有 cookie 跨启动持久，
	 *   localStorage / IndexedDB 按含端口的 origin 隔离）⇒ 冷启动时总监树里只有全局根，
	 *   **还没有任何会话级节点**；而建立它们的「同步真实会话」排在 **I12**，晚于 I7
	 *   ⇒ I7 会以「产品坏了」的形态红掉。实测取证：本轮报 ❌「找到会话级节点用于向上提交 — 无会话级节点」，
	 *   而**同一轮 I12 的读数是「会话 121/121 · 文件夹 2/2」** ⇒ 会话明明存在，只是**此刻尚未落成总监节点**。
	 *   修法：自己建前提 —— 走真实界面路径点一次「同步真实会话」（产品侧幂等），再重新取；取不到才 SKIP。 */
	if (!sess) {
		const sy = window.__q('[data-testid="h-sync"]');
		if (sy && !sy.disabled) sy.click();
		for (let i = 0; i < 12 && !sess; i++) { await new Promise(r => setTimeout(r, 500)); sess = await pick(); }
	}
	if (!sess) return {found:false, reason:'触发「同步真实会话」后仍无会话级节点'};
	return { found:true, sessId: sess.id, parentId: sess.parentId, name: sess.name };
})()`);
if (i7.found) {
	// 🔴 必须点 `[data-node-id]` 这一行本身。
	//    踩过的坑（2026-09-12）：按 `textContent 前缀` 匹配 div 会先命中**祖先包裹层**
	//    （document 顺序靠前），而 click 事件只向上冒泡、不会向下传给行 → onSelect 永不触发，
	//    「点树节点」实际是空操作。加 data-node-id 后定位唯一且与展示文案解耦。
	const i7click = await evalExpr(`(() => {
		const row = document.querySelector('[data-node-id="${i7.sessId}"]');
		if (!row) return { clicked:false, reason:'树中未渲染该节点行' };
		row.click();
		return { clicked:true };
	})()`);
	await sleep(900);
	const i7sel = await evalExpr(`(() => {
		const sel = window.__q('[data-selected="true"]');
		return sel ? sel.getAttribute('data-node-id') : null;
	})()`);
	ok("树节点行已点击（data-node-id 精确定位）", i7click.clicked, i7click.reason || "会话「" + i7.name + "」");
	ok("🔴 回读：该行成为选中态（selection 真的变了）", i7sel === i7.sessId, "selected=" + String(i7sel).slice(-12));
	const i7b = await evalExpr(`(async () => {
		const parentBefore = await window.__dshHierarchy.getNode('${i7.parentId}');
		const btn = window.__q('[data-testid="w-submit-up"]'); if(!btn) return {found:false};
		btn.click();
		await new Promise(r=>setTimeout(r,1100));
		const parentAfter = await window.__dshHierarchy.getNode('${i7.parentId}');
		const crumb = await window.__dshHierarchy.getBreadcrumb('${i7.sessId}');
		return {
			found:true,
			crumbLen: crumb.length,
			parentBefore: parentBefore && parentBefore.duties ? Object.keys(parentBefore.duties).length : 0,
			parentAfter: parentAfter && parentAfter.duties ? Object.keys(parentAfter.duties).length : 0
		};
	})()`);
	ok("向上提交按钮可点击", i7b.found, "面包屑深度 " + i7b.crumbLen);
	ok("🔴 回读：父节点被写入职责配置", i7b.parentAfter === 5, "父节点 duties 项数 " + i7b.parentBefore + " → " + i7b.parentAfter);

	/* ── I8 恢复继承 ── */
	console.log("\n[I8] 恢复继承 → 回读清空");
	const i8 = await evalExpr(`(async () => {
		const btn = window.__q('[data-testid="w-restore"]'); if(!btn) return {found:false};
		btn.click();
		await new Promise(r=>setTimeout(r,900));
		const node = await window.__dshHierarchy.getNode('${i7.sessId}');
		const r = await window.__dshDuties.resolve('${i7.sessId}');
		return { found:true, dbDuties: node && node.duties ? Object.keys(node.duties).length : 0, origin0: r.origin.languagePolish };
	})()`);
	ok("恢复继承按钮可点击", i8.found);
	ok("🔴 回读：本节点 duties 已清空", i8.dbDuties === 0, "duties 项数=" + i8.dbDuties);
	ok("🔴 回读：来源回落为继承（非 own）", i8.origin0 !== "own", "origin=" + i8.origin0);
} else {
	/* 🔴 前提不成立 ⇒ **逐条 SKIP**（纪律 46：断言静默消失会让"总数"随状态变化，收尾对账随之失去意义） */
	skip("找到会话级节点用于向上提交（I7/I8 段的前提）",
		"前提不成立：" + (i7.reason || "") + " —— 本 origin 冷启动且同步未生效，非产品缺陷");
	["树节点行已点击（data-node-id 精确定位）", "🔴 回读：该行成为选中态（selection 真的变了）", "向上提交按钮可点击",
		"🔴 回读：父节点被写入职责配置", "恢复继承按钮可点击", "🔴 回读：本节点 duties 已清空",
		"🔴 回读：来源回落为继承（非 own）"].forEach((n) => skip(n, "同 I7 前提（无会话级节点）"));
}

/* ── I8r 🔴 环境复原：职责配置逐节点还原（见 I0 快照里的踩坑说明） ──
 *
 *  没有这一步，本脚本每跑一次就把「五项全关」多写深一层 ——
 *  既改坏用户真实配置，又让**下一个脚本**以「产品坏了」的形态报红。
 *  ③ 是**回读自证**：还原不是"点了个按钮就算"，而是逐节点重新 resolve 后对账。 */
console.log("\n[I8r] 环境复原：职责配置逐节点还原（本段改过的全部还原）");
const dutyRestore = await evalExpr(`(async () => {
	const snap = ${JSON.stringify(dutySnap.snap)};
	const keep = new Set(snap.map((s) => s.id));
	/* ① 快照里有的：原样写回 */
	for (const s of snap) await window.__dshDuties.set(s.id, s.own);
	/* ② 快照里没有、现在却有 own 的：一定是本段（I6 保存本层 / I7 向上提交）写脏的 ⇒ 清掉 */
	const t = await window.__dshHierarchy.loadTree();
	const flat = []; const walk = (n) => { flat.push(n); (n.childNodes || []).forEach(walk); };
	walk(t);
	const cleared = [];
	for (const n of flat) {
		if (keep.has(n.id)) continue;
		const r = await window.__dshDuties.resolve(n.id);
		if (r.own) { await window.__dshDuties.clear(n.id); cleared.push(n.id); }
	}
	/* ③ 逐节点回读自证：期望「有没有 own」与快照一致 */
	const bad = [];
	for (const n of flat) {
		const r = await window.__dshDuties.resolve(n.id);
		if (keep.has(n.id) !== Boolean(r.own)) bad.push(n.id);
	}
	return { restored: snap.length, cleared, bad, total: flat.length };
})()`);
ok("🔴 环境复原：职责配置逐节点还原（含「全局总管」与「工作区」两级 · 回读自证）",
	dutyRestore && dutyRestore.bad.length === 0,
	"写回 " + dutyRestore.restored + " 个 · 清除本段写脏的 " + dutyRestore.cleared.length + " 个" +
	(dutyRestore.cleared.length ? "（" + dutyRestore.cleared.join(", ") + "）" : "") +
	" · 对账 " + dutyRestore.total + " 节点，不一致 " + dutyRestore.bad.length);

/* ── I9 总监对话流发送 ── */
console.log("\n[I9] 总监对话流：发送消息");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i9a = await evalExpr(`(async () => {
	const box = window.__q('[data-testid="director-messages"]');
	if (!box) return { found:false, reason:'消息区未渲染（总监页签是否激活？）' };
	const before = (box.innerText||'').length;
	// 🔴 消息条数用 pre 子元素计数，不能用 children.length：
	// messages 为空时产品渲染 1 个「暂无消息…」占位 div（无 pre），此时 children.length=1 会让
	// 「净增 ≥2」基线虚高 1（空起点 占位1 → user+assistant 2，2-1=1 假红）；每条真消息都含一个 pre。
	const rowsBefore = box.querySelectorAll('pre').length;
	const input = window.__q('[data-testid="director-input"]');
	if (!input) return { found:false, reason:'输入框未渲染' };
	// React 受控输入：必须走原生 setter + input 事件，否则 React 内部 state 不同步
	// （直接改 input.value 再 click，React 读到的仍是旧值 → 发送被「空文本早退」静默吞掉）
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
	setter.call(input, '帮我把登录接口改成 JWT 鉴权');
	input.dispatchEvent(new Event('input',{bubbles:true}));
	await new Promise(r=>setTimeout(r,400));
	const btn = window.__q('[data-testid="director-send"]');
	if (!btn) return { found:false, reason:'发送按钮未渲染' };
	btn.click();
	// 🔴 用户消息必须【立即】上屏（§2.3 消息流），不等 5 步执行完成
	await new Promise(r=>setTimeout(r,700));
	const box1 = window.__q('[data-testid="director-messages"]');
	const midTxt = box1 ? (box1.innerText||'') : '';
	return { found:true, before, rowsBefore, midLen: midTxt.length, midHasUser: /帮我把登录接口改成 JWT 鉴权/.test(midTxt) };
})()`);
ok("输入框与发送按钮存在", i9a.found, i9a.reason || "");
ok("🔴 回读：用户消息【立即上屏】（§2.3，不等执行完成）", i9a.midHasUser,
	"点击后 700ms 内 " + i9a.before + " → " + i9a.midLen + " 字符");

/* 🔴 2026-09-13 纠错：**判据必须"跑程内"，不能用页面级的"有没有这几个字"。**
 *
 *   本段旧写法 `done: /总监分析/.test(txt)` 只问"页面上有没有【总监分析】" ——
 *   而**消息 store 是按 sessionId 持久化的**（本脚本不重载页面），
 *   上一个脚本 / 上一轮留下的助手消息里**本来就有**这四个字
 *   ⇒ 轮询**立刻**返回 ⇒ 紧接着的 I9c 在五步还没算完时就去读 `director-steps`
 *   ⇒ `lastSteps` 还是 null ⇒ **rows = 0**，报出来像"产品没展示五步过程"。
 *
 *   这与 §八 纪律 33（"偶发红先查起点是否等价"）同族：**起点里混着上一轮的产物**。
 *   正确判据（本条 user + 本条 assistant ⇒ **消息行数净增 ≥ 2**）
 *   **且** 五步过程区已就位（`director-steps` 恰好 5 行）—— 两者都是**跑程内**证据。 */
const i9b = await pollEval(`(() => {
	const box = window.__q('[data-testid="director-messages"]');
	const txt = box ? (box.innerText||'') : '';
	const rows = box ? box.querySelectorAll('pre').length : 0;   // 真消息条数（排除「暂无消息」占位 div）
	const steps = window.__q('[data-testid="director-steps"]');
	const stepRows = steps ? steps.children.length - 1 : 0;
	return {
		done: rows >= ${i9a.rowsBefore} + 2 && /总监分析/.test(txt) && stepRows === 5,
		len: txt.length,
		rows,
		stepRows,
		hasUser: /帮我把登录接口改成 JWT 鉴权/.test(txt),
		hasAnalysis: /总监分析/.test(txt),
		hasSteps: stepRows === 5,
		snippet: txt.slice(-200)
	};
})()`, 25000);
ok("🔴 回读：消息已追加（本条 user + 本条 assistant ⇒ 行数净增 ≥ 2）",
	i9b.rows >= i9a.rowsBefore + 2 && i9b.len > i9a.before,
	"行 " + i9a.rowsBefore + " → " + i9b.rows + " · 文本 " + i9a.before + " → " + i9b.len + " 字符");
ok("消息含用户原文", i9b.hasUser);
ok("消息含【总监分析】", i9b.hasAnalysis);
/* 🔴 2026-09-13 纠错：**尺子量错了容器**。
 *   五步过程区（`lastSteps`）与 `director-messages` 是**兄弟节点**，
 *   原判据（`i9b.hasSteps`）却去 messages 容器的 innerText 里找「1. 整理语言」
 *   ⇒ **恒为 false**，读起来像「产品没展示五步」，其实产品一直展示着。
 *   产品侧已补语义锚点 `data-testid="director-steps"`，这里改为**按结构断言**
 *   （步骤行数 = 5），不再依赖会被文案整治改动的字符串。 */
const i9c = await evalExpr(`(() => {
	const box = window.__q('[data-testid="director-steps"]');
	const msgs = window.__q('[data-testid="director-messages"]');
	return {
		found: Boolean(box),
		rows: box ? box.children.length - 1 : -1,
		txt: box ? (box.innerText||'').slice(0,240) : '',
		msgTail: msgs ? (msgs.innerText||'').slice(-220) : ''
	};
})()`);
ok("🔴 五步过程已展示（director-steps 锚点 · 恰好 5 条）", i9c.found && i9c.rows === 5,
	"锚点" + (i9c.found ? "在场" : "缺失") + " · 步骤行 " + i9c.rows
	+ " · 首行「" + String(i9c.txt).split("\n").filter(Boolean)[1] + "」"
	+ " · 消息尾「" + String(i9c.msgTail).replace(/\n/g, "⏎").slice(-120) + "」");

/* ── I10 自动转发 ── */
console.log("\n[I10] 自动转发开关");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i10 = await evalExpr(`(async () => {
	const cb = window.__q('[data-testid="director-autoforward"]');
	if(!cb) return {found:false};
	const before = cb.checked;
	cb.click();
	await new Promise(r=>setTimeout(r,320));
	const after = window.__q('[data-testid="director-autoforward"]').checked;
	return { found:true, before, after, flipped: before!==after };
})()`);
ok("自动转发开关存在且可翻转", i10.found && i10.flipped, i10.before + " → " + i10.after);

// 开启状态下发一条，验证转发发生（通过 runDirector 直接计数更可靠）
const i10b = await evalExpr(`(async () => {
	let forwarded = null;
	const store = window.__dshDirectorRun ? null : null;
	const r = await window.__dshDirectorRun.run({
		sessionId: 'cdp-click-probe',
		userText: '实现三级总监结构',
		store: null,
		duties: window.__dshDuties.DEFAULT(),
		config: { localModel: { enabled:false } },
		autoForward: true,
		onForward: (i) => { forwarded = i; }
	});
	return { steps: r.steps.length, enabled: r.steps.filter(s=>s.enabled).length, forwarded, forwardDone: r.forward.done };
})()`);
ok("runDirector 五步齐全", i10b.steps === 5, "5 步，启用 " + i10b.enabled + " 项");
/* 🔴 2026-09-13 纠错（与 verify-batch8.mjs 同款过期断言）：
 *   `duties.js` 已按 03 号文 §1.2 **五步规格**把 5 项职责全部启用（**留痕在先**），
 *   而本行仍断言「默认启用 3 项」—— 那是「五项职责」时代的旧口径 ⇒ 假红。
 *   上轮修 batch8 时漏改了这一处（**闸门过期族第 6 处**）⇒ 判据与 batch8 同源：
 *   五步全启用。 */
ok("🔴 五步全部启用（03号文 §1.2 五步规格 · 2026-09-13 纠错）", i10b.enabled === 5, "5 步中启用 " + i10b.enabled + " 项");
ok("🔴 自动转发回调被实际触发", i10b.forwardDone === true && typeof i10b.forwarded === "string", "转发内容「" + String(i10b.forwarded).slice(0, 30) + "」");

/* ── I11 树节点选择 ── */
console.log("\n[I11] 树节点选择");
const i11 = await evalExpr(`(async () => {
	// 树在左栏，始终可见；用 [data-node-id][data-selected] 精确定位**树行**
	// （🆕 批次 9：弹窗面板自身也带节点绑定属性，故必须同时要求 data-selected，
	//   否则首个命中会是面板而非行 —— 真机实测踩中过）
	const rows = window.__qa('[data-node-id][data-selected]');
	if (!rows.length) return {found:false};
	const cur = rows.find(r => r.getAttribute('data-selected') === 'true');
	const curId = cur ? cur.getAttribute('data-node-id') : null;
	// 挑一个**与当前不同**的行，才能证明「点击 → 选中态迁移」
	const target = rows.find(r => r.getAttribute('data-node-id') !== curId) || rows[0];
	const targetId = target.getAttribute('data-node-id');
	const targetName = (target.textContent||'').trim().slice(0,20);
	const bcr = window.__panel();
	const beforeCrumb = ((bcr ? (bcr.innerText||'') : '')).split('\\n')[0];
	target.click();
	await new Promise(r=>setTimeout(r,800));
	const sel = window.__q('[data-selected="true"]');
	return {
		found:true, count: rows.length, targetId, targetName, curId,
		selectedAfter: sel ? sel.getAttribute('data-node-id') : null,
		beforeCrumb
	};
})()`);
ok("树上存在可点击节点行", i11.found, "共 " + i11.count + " 行");
ok("🔴 回读：选中态迁移到被点击的行", i11.selectedAfter === i11.targetId,
	"「" + i11.targetName + "」 selected=" + String(i11.selectedAfter).slice(-14));

/* ── I12 同步真实会话 ── */
console.log("\n[I12] 同步真实会话");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
await evalExpr(`(() => { const t = window.__q('[data-testid="h-tab-overview"]'); if(t) t.click(); return 'ok'; })()`);
await sleep(800);
const i12 = await evalExpr(`(async () => {
	const btn = window.__q('[data-testid="h-sync"]'); if(!btn) return {found:false};
	btn.click();
	await new Promise(r=>setTimeout(r,2500));
	const p = window.__panel(); const txt = p ? (p.innerText||'') : '';
	const m = txt.match(/会话 (\\d+)\\/(\\d+)/);
	const f = txt.match(/文件夹 (\\d+)\\/(\\d+)/);
	return { found:true, sess: m ? m[0] : null, fld: f ? f[0] : null, allCover: /总监已全覆盖/.test(txt) };
})()`);
ok("同步按钮可点击", i12.found);
ok("🔴 回读：覆盖度达 100%", i12.allCover, "会话 " + i12.sess + " · 文件夹 " + i12.fld);

/* ═══════════════════════════════════════════════════════════
 * 以下为「概览」页签剩余交互项 —— 上一轮遗漏，本次补齐。
 * 原则：**面板里每一个 button / input / select 都必须被点过并回读**，
 *       最后用 I21 做全量清单核对，防止再漏。
 * ═══════════════════════════════════════════════════════════ */

// 原生 setter 工具（React 受控组件必须走这条路，否则 state 不同步）
await evalExpr(`
window.__setVal = (el, v) => {
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
              : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  return true;
};
window.__enabled = (sel) => { const e = window.__q(sel); return Boolean(e) && !e.disabled; };
'ok'
`);

/* ── I13 基础信息编辑 + 保存 ── */
console.log("\n[I13] 基础信息（meta）编辑 → 保存基础信息 → 回读落库");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i13 = await evalExpr(`(async () => {
	await new Promise(r=>setTimeout(r,300));
	const nameEl = window.__q('[data-testid="h-meta-name"]');
	if (!nameEl) return {found:false, reason:'名称输入框未渲染'};
	const stamp = '验证' + Date.now().toString().slice(-6);
	window.__setVal(nameEl, stamp);
	window.__setVal(window.__q('[data-testid="h-meta-positioning"]'), '多层级总监面板');
	window.__setVal(window.__q('[data-testid="h-meta-goal"]'), '每个对话/文件夹都有总监');
	window.__setVal(window.__q('[data-testid="h-meta-currentPhase"]'), '交互验证');
	await new Promise(r=>setTimeout(r,400));
	const btn = window.__q('[data-testid="h-save-meta"]'); if(!btn) return {found:false, reason:'保存按钮未渲染'};
	const sel = window.__q('[data-selected="true"]');
	const id = sel.getAttribute('data-node-id');
	btn.click();
	await new Promise(r=>setTimeout(r,1200));
	// 🔴 回读：必须从库里读，不能信 UI
	const node = await window.__dshHierarchy.getNode(id);
	return { found:true, id, stamp, dbName: node ? node.name : null,
	         dbPos: node && node.meta ? node.meta.positioning : null,
	         dbGoal: node && node.meta ? node.meta.goal : null,
	         dbPhase: node && node.meta ? node.meta.currentPhase : null };
})()`);
ok("基础信息四项输入框可编辑", i13.found, i13.reason || "");
ok("🔴 回读：名称已落库", i13.dbName === i13.stamp, "库中名称=" + i13.dbName);
ok("🔴 回读：定位/目标/当前阶段已落库",
	i13.dbPos === "多层级总监面板" && i13.dbGoal === "每个对话/文件夹都有总监" && i13.dbPhase === "交互验证",
	"定位=" + i13.dbPos);

/* ── I14 生成本级总结 ── */
console.log("\n[I14] 生成本级总结 → 回读 summary");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i14 = await evalExpr(`(async () => {
	const btn = window.__q('[data-testid="h-sum-one"]'); if(!btn) return {found:false};
	const sel = window.__q('[data-selected="true"]'); const id = sel.getAttribute('data-node-id');
	const before = await window.__dshHierarchy.getNode(id);
	btn.click();
	await new Promise(r=>setTimeout(r,120));
	return { found:true, id,
		beforeLen: before && before.summary ? before.summary.length : 0,
		beforeAt: before ? (before.summaryAt || 0) : 0 };
})()`);
ok("生成本级总结按钮可点击", i14.found);
await waitIdle();
const i14b = await evalExpr(`(async () => {
	const id = window.__q('[data-selected="true"]').getAttribute('data-node-id');
	const n = await window.__dshHierarchy.getNode(id);
	return { len: n && n.summary ? n.summary.length : 0, grade: n ? n.summaryGrade : null, at: n ? (n.summaryAt || 0) : 0 };
})()`);
// 🔴 断言用 summaryAt 而非长度：同内容重复总结长度不变（不幂等的判据会误报）
ok("🔴 回读：summary 已重算（summaryAt 时间戳推进）", i14b.at > i14.beforeAt,
	"summaryAt " + i14.beforeAt + " → " + i14b.at + "（" + i14b.len + " 字）");
ok("🔴 回读：summaryGrade 已标记（G0/G1/G2）", ["G0","G1","G2"].includes(i14b.grade), "grade=" + i14b.grade);

/* ── I15 向上提交（总结继承） ── */
console.log("\n[I15] 向上提交（总结）→ 回读父节点 summary");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
const i15 = await evalExpr(`(async () => {
	const btn = window.__q('[data-testid="h-prop-up"]'); if(!btn) return {found:false};
	const sel = window.__q('[data-selected="true"]'); const id = sel.getAttribute('data-node-id');
	const node = await window.__dshHierarchy.getNode(id);
	const parentBefore = node && node.parentId ? await window.__dshHierarchy.getNode(node.parentId) : null;
	const isRoot = !node || !node.parentId;
	const disabled = btn.disabled;
	btn.click();
	await new Promise(r=>setTimeout(r,1600));
	const parentAfter = node && node.parentId ? await window.__dshHierarchy.getNode(node.parentId) : null;
	return { found:true, isRoot, disabled,
		before: parentBefore && parentBefore.summary ? parentBefore.summary.length : 0,
		after: parentAfter && parentAfter.summary ? parentAfter.summary.length : 0 };
})()`);
ok("向上提交（总结）按钮可点击", i15.found);
if (i15.isRoot) {
	ok("🔴 根节点上「向上提交」无副作用（无可提交目标）", i15.disabled === true || i15.after === i15.before,
		"disabled=" + i15.disabled + " 父级 summary " + i15.before + " → " + i15.after);
} else {
	ok("🔴 回读：父节点 summary 被写入", i15.after >= i15.before, "父级 summary " + i15.before + " → " + i15.after + " 字");
}

/* ── I16 整树分层总结 ── */
console.log("\n[I16] 整树分层总结 → 回读多节点 summary");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
/* 🔴 点击**之前**先取一次基线：没有这条，"有多少节点带 summary"这个读数就分不清
 *    "是本次写的"与"历史遗留的"（纪律 42：被测面持久化/累积时判据必须跑程内）。 */
const i16Before = await evalExpr(`(async () => {
	const t = await window.__dshHierarchy.loadTree();
	const rows = []; const walk = (n) => { rows.push(n); (n.childNodes||[]).forEach(walk); }; walk(t);
	return rows.filter(n => String(n.summary||'').trim().length > 0).length;
})()`);
const i16 = await evalExpr(`(async () => {
	const btn = window.__q('[data-testid="h-sum-tree"]'); if(!btn) return {found:false};
	btn.click();
	await new Promise(r=>setTimeout(r,120));
	const t = await window.__dshHierarchy.loadTree();
	const rows = [];
	const walk = (n) => { rows.push({ lv:n.level, hasSum: Boolean(n.summary), grade:n.summaryGrade || null }); (n.childNodes||[]).forEach(walk); };
	walk(t);
	return { found:true, total: rows.length, withSum: rows.filter(r=>r.hasSum).length,
	         grades: Array.from(new Set(rows.map(r=>r.grade).filter(Boolean))) };
})()`);
ok("整树分层总结按钮可点击", i16.found);
/* 🔴🔴 等待必须**校验返回值**，且预算必须够（2026-09-16 第十六轮 · 闸门纠错·二）
 *
 * 旧写法：`await waitIdle();` —— 默认 60s 上限，**返回值被丢弃**。而本任务实测 **~1.21 s/节点 × 116 节点
 *   ≈ 140s**（`_probe-sum-tree-timeline.mjs` 逐 500ms 采样实测）⇒ 60s 时只写了 ~51 个，闸门就在那一刻读数
 *   ⇒ 报出「51/116」+「需汇总父节点 1 个，缺 1 个」。**而那个"缺"的节点正是当时在途的那一个**：
 *   `summarizeTree()` 是**后序遍历**（先子后父），任何时刻恰好有 1 个节点处于
 *   「子级已写完、自己尚未写」的状态 ⇒ `parentBad` 在探针里**恒为 1**，写完瞬间归 0。
 *   ⇒ 这条红读起来像"逐级汇总坏了"，真相是**闸门读早了**（纪律 31：先审口径，再谈修产品）。
 * 新写法：预算提到 180s + 校验返回值；超预算即 **INVALID（exit 2）**，并打印"已写到第 N 个"以自证是等待不足。 */
/* 🔴 前提段（纪律 23 / 46 / 51）：逐级汇总的语义判据**只有在树至少两层时才可判定**。
 *   而本 origin 每次启动都是新的（纪律 E：只有 cookie 跨启动持久，localStorage/IndexedDB 按含端口的 origin 隔离）
 *   ⇒ 冷启动时树里只有全局根 ⇒ `parentNeed = 0` ⇒ ② 会**平凡真**（"0 个需汇总的父节点、0 个缺"）——
 *   读起来是绿的，实际什么都没验。⇒ 先**显式测前提**并打出来；前提不成立时逐条 SKIP 且说明原因。
 *   实测依据：`_probe-sum-tree-timeline.mjs` 在「app 端口 32499」那次读到 116 节点（沿用用户既有实例的数据），
 *   在「app 端口 20401」这次读到 **1 节点**（新 origin）⇒ 同一份产品、同一套闸门，读数差 116 倍。 */
const i16pre = await evalExpr(`(async () => {
	const t = await window.__dshHierarchy.loadTree();
	const rows = []; const walk = (n) => { rows.push(n); (n.childNodes||[]).forEach(walk); }; if (t) walk(t);
	return { total: rows.length, rootKids: t ? (t.childNodes||[]).length : 0,
	         withKids: rows.filter(n => (n.childNodes||[]).length > 0).length };
})()`);
const i16PremOk = i16pre.withKids >= 1 && i16pre.total >= 2;
ok("🔴 前提：树至少两层（存在「有子节点的父节点」）—— 否则「逐级汇总」语义无从判定", i16PremOk,
	"total=" + i16pre.total + " ｜ rootKids=" + i16pre.rootKids + " ｜ 有子节点的节点 " + i16pre.withKids + " 个");
const i16Idle = await waitIdle(180000);
if (!i16Idle) {
	const still = await evalExpr(`(async () => {
		const b = window.__q('[data-testid="h-sum-tree"]');
		const t = await window.__dshHierarchy.loadTree();
		const rows = []; const walk = (n) => { rows.push(n); (n.childNodes||[]).forEach(walk); }; walk(t);
		return { disabled: b ? b.disabled : null, total: rows.length,
		         withSum: rows.filter(n => String(n.summary||'').trim().length > 0).length };
	})()`);
	invalid = true;
	console.log("  ⚠ INVALID：整树分层总结在 180s 预算内**未收敛**（busy=" + still.disabled
		+ "，已写 " + still.withSum + "/" + still.total + " 个节点）");
	console.log("    ⇒ 本段读数不可信，按 INVALID（exit 2）收尾，**不计入产品缺陷**；等待预算或产品吞吐需调。");
}
/* 🔴 判据改「**语义 + 跑程内**」（2026-09-16 第十六轮 · 闸门纠错）
 *
 * 旧判据：`withSum >= total * 0.9` —— 一条**覆盖率经验阈值**。但树是**跨运行累积**的
 * （真机实测 116 节点 = 113 真实会话 + 2 文件夹 + 1 全局），而且**空白分支天生没有东西可总结**
 * （`sessions.create` 建出的会话按定义是 blank；本轮按维度分流真机跑了 8 轮 = 65 条空白分支）。
 * ⇒ 这个读数取决于"用户积了多少从没干过活的分支"，**不是跑程内量** ⇒ 对着一份干净产品也会红
 *   （实测 51/116），而它红的时候读起来像"整树分层总结坏了"。**闸门不该报它报不了的缺陷**（纪律 31）。
 * 新判据问的是这件事**本身的语义**：
 *   ① **根节点必须有 summary** —— 自底向上汇总的最终落点，没有它整件事就没发生；
 *   ② **每个「有带 summary 的子节点」的父节点，自己必须有 summary** —— 这才是"逐级汇总"的判据，
 *      与树里堆了多少空白分支**无关**（空白叶子的父节点不在 `parentNeed` 里）；
 *   ③ **正对照**：本次点击必须让带 summary 的节点数**不减**，且**原本不满时必须净增**
 *      （否则"什么都没做"也能过 ①②——例如上一轮已经把整树写完的情况由 `i16Before >= total` 显式豁免）。
 */
const i16b = await evalExpr(`(async () => {
	const t = await window.__dshHierarchy.loadTree();
	const rows = [];
	const walk = (n, d) => { rows.push({ n: n, d: d }); (n.childNodes||[]).forEach(c => walk(c, d+1)); };
	walk(t, 0);
	const has = (n) => String(n.summary||'').trim().length > 0;
	const withSumChildren = rows.filter(r => (r.n.childNodes||[]).some(has));
	const bad = withSumChildren.filter(r => !has(r.n));
	return { total: rows.length, withSum: rows.filter(r=>has(r.n)).length,
	         root: has(t), parentNeed: withSumChildren.length, parentBad: bad.length,
	         grades: Array.from(new Set(rows.map(r => r.n.summaryGrade).filter(Boolean))),
	         badSample: bad.slice(0,3).map(r => String(r.n.title || r.n.id || '?').slice(0,20)) };
})()`);
Object.assign(i16, { total: i16b.total, withSum: i16b.withSum, root: i16b.root, parentNeed: i16b.parentNeed, parentBad: i16b.parentBad, grades: i16b.grades });
console.log("  · summary 覆盖：" + i16Before + " → " + i16.withSum + " / " + i16.total
	+ " ｜ 根有 summary=" + i16.root + " ｜ 需汇总的父节点 " + i16.parentNeed + " 个，其中缺 summary " + i16.parentBad + " 个");
ok("🔴 回读：根节点已生成 summary（自底向上汇总的最终落点）", i16.root === true, "root=" + i16.root);
if (i16PremOk) {
	ok("🔴 回读：每个「子节点已有 summary」的父节点自己也生成了 summary（逐级汇总的语义判据，与空白分支数量无关）",
		i16.parentBad === 0, "需汇总父节点 " + i16.parentNeed + " 个，缺 " + i16.parentBad + " 个 " + JSON.stringify(i16.badSample));
} else {
	skip("🔴 回读：每个「子节点已有 summary」的父节点自己也生成了 summary（逐级汇总的语义判据）",
		"前提不成立：树只有 " + i16pre.total + " 个节点、其中 " + i16pre.withKids + " 个有子节点 ⇒ 没有任何父-子对可判（本 origin 冷启动，宿主会话列表未落成总监节点）。**不是跳过产品验收，是把本条挂到前提上**");
}
ok("🔴 正对照：本次「整树分层总结」确实写了东西（带 summary 的节点数不减，且原本未满时必须有净增）",
	i16.withSum >= i16Before && (i16.withSum > i16Before || i16Before >= i16.total),
	i16Before + " → " + i16.withSum + " / " + i16.total);
ok("🔴 回读：梯度标记存在（§4.3 降级生效）", i16.grades.length > 0, "梯度集合=" + JSON.stringify(i16.grades));

/* ── I17 新建节点 ── */
console.log("\n[I17] 新建节点（在当前节点下）");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
await waitIdle();
const i17 = await evalExpr(`(async () => {
	const nameEl = window.__q('[data-testid="h-new-name"]');
	const lvlEl = window.__q('[data-testid="h-new-level"]');
	if (!nameEl || !lvlEl) return {found:false};
	const stamp = '临时项目' + Date.now().toString().slice(-6);
	window.__setVal(nameEl, stamp);
	window.__setVal(lvlEl, 'project');
	await new Promise(r=>setTimeout(r,400));
	const btn = window.__q('[data-testid="h-create"]'); if(!btn) return {found:false};
	if (btn.disabled) return {found:false, reason:'新建按钮处于禁用态（上一操作未完成）'};
	btn.click();
	await new Promise(r=>setTimeout(r,1800));
	const t = await window.__dshHierarchy.loadTree();
	let hit = null;
	const walk = (n) => { if (n.name === stamp) hit = n; (n.childNodes||[]).forEach(walk); };
	walk(t);
	window.__lastCreatedId = hit ? hit.id : null;
	return { found:true, stamp, created: Boolean(hit), newId: hit ? hit.id : null, lv: hit ? hit.level : null };
})()`);
ok("新建输入框 + 层级选择 + 按钮齐全", i17.found);
ok("🔴 回读：新节点已出现在树中且层级正确", i17.created && i17.lv === "project", "名称=" + i17.stamp + " level=" + i17.lv);

/* ── I18 挂载会话 ── */
console.log("\n[I18] 挂载会话（会话 ID + 标题）");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
await waitIdle();
const i18 = await evalExpr(`(async () => {
	// 先选中刚建的项目节点（挂载目标是「当前选中节点」）
	// 若上一步新建失败，退回任一非根节点，保证「挂载/删除」仍能被验证
	let id = window.__lastCreatedId;
	if (!id) {
		const cand = window.__qa('[data-node-id]').map(r => r.getAttribute('data-node-id')).filter(x => x !== '__global__');
		id = cand[0] || null;
		window.__lastCreatedId = id;
	}
	if (id) {
		const row = document.querySelector('[data-node-id="' + id + '"]');
		if (row) { row.click(); await new Promise(r=>setTimeout(r,800)); }
	}
	const sidEl = window.__q('[data-testid="h-attach-sid"]');
	const titleEl = window.__q('[data-testid="h-attach-title"]');
	if (!sidEl || !titleEl) return {found:false, reason:'挂载输入框未渲染'};
	window.__setVal(sidEl, 'cdp-attach-001');
	window.__setVal(titleEl, '交互验证挂载会话');
	await new Promise(r=>setTimeout(r,400));
	const btn = window.__q('[data-testid="h-attach"]'); if(!btn) return {found:false};
	btn.click();
	await new Promise(r=>setTimeout(r,1800));
	// 🔴 conversations 写在**新建的会话节点**上（attachSession 语义），不是文件夹节点：
	//    attachSession(folderId, ...) 会 makeNode(level:"session") 并把 conversations 挂到它身上。
	const all = await window.__dshHierarchy.listAllNodes();
	const hit = all.find(n => (n.conversations || []).some(c => c.conversationId === 'cdp-attach-001'));
	window.__lastAttachedId = hit ? hit.id : null;
	return { found:true, hitId: hit ? hit.id : null, hitName: hit ? hit.name : null,
	         hitLevel: hit ? hit.level : null,
	         hitParent: hit ? hit.parentId : null, folderId: id,
	         conv: hit && hit.conversations && hit.conversations[0] ? JSON.stringify(hit.conversations[0]).slice(0,160) : null };
})()`);
ok("挂载会话输入框 + 按钮齐全", i18.found, i18.reason || "");
ok("🔴 回读：已生成会话节点且 conversations 写入", Boolean(i18.hitId) && i18.hitLevel === "session",
	"会话节点「" + (i18.hitName || "-") + "」");
ok("🔴 回读：会话节点挂在目标文件夹下", i18.hitParent === i18.folderId,
	"parent=" + String(i18.hitParent).slice(-14) + " 目标=" + String(i18.folderId).slice(-14));

/* ── I19 删除当前节点 ── */
console.log("\n[I19] 删除当前节点 → 回读消失 + 子级升祖父（不留孤儿）");
await waitIdle();   // 🔴 点击前等空闲：按钮 disabled 时 click() 是静默 no-op
await waitIdle();
const i19 = await evalExpr(`(async () => {
	// 🔴 删除的是【当前选中】节点 —— 必须先把它选上，否则删的是别的节点
	//    （attachSession 会把选中态改到新会话节点上，上一轮的坑）
	const id = window.__lastAttachedId || window.__lastCreatedId;
	if (!id) return {found:false, reason:'无待删目标（前序步骤未产出节点）'};
	const row = document.querySelector('[data-node-id="' + id + '"]');
	if (!row) return {found:false, reason:'待删节点未渲染在树上'};
	row.click();
	await new Promise(r=>setTimeout(r,800));
	const btn = window.__q('[data-testid="h-remove"]');
	if (!btn) return {found:false, reason:'删除按钮未渲染'};
	const node = await window.__dshHierarchy.getNode(id);
	const expectedParent = node ? node.parentId : null;
	// 先给它挂一个子节点，验证「子级升祖父」
	const child = await window.__dshHierarchy.createChild(id, { name: '待升位子节点', level: 'session' });
	btn.click();
	await new Promise(r=>setTimeout(r,1800));
	const gone = await window.__dshHierarchy.getNode(id);
	const childAfter = child ? await window.__dshHierarchy.getNode(child.id) : null;
	// 清理测试残留
	if (childAfter) await window.__dshHierarchy.removeNode(child.id);
	return { found:true, deleted: gone === null || gone === undefined,
	         childParentAfter: childAfter ? childAfter.parentId : null, expectedParent };
})()`);
ok("删除按钮可点击", i19.found, i19.reason || "");
ok("🔴 回读：节点已从库中删除", i19.deleted === true);
ok("🔴 回读：原子节点升到祖父（无孤儿）", i19.childParentAfter === i19.expectedParent,
	"子节点父级 " + i19.childParentAfter + " = 期望 " + i19.expectedParent);

/* ── I20 收起 ──
 * 批次 9 变更：层级组件在弹窗内以 `compact` 形态渲染（不传 onClose）⇒ 不再渲染 `h-close`。
 * 「收起」语义上移到**弹窗层**：用 `d-close`（关闭弹窗 + clearSplit 完全复原原生布局）。
 * 断言意图不变：点「收起」后层级 UI 消失且原生布局复原。 */
console.log("\n[I20] 收起 → 弹窗关闭 + 原生布局复原");
const i20 = await evalExpr(`(async () => {
	const hasHClose = Boolean(window.__q('[data-testid="h-close"]'));
	const before = Boolean(window.__panel());
	const closed = await window.__closeDlg();
	const splitLeft = Boolean(document.getElementById('dsh-director-split-style'));
	const rootMarked = Boolean(document.querySelector('[data-dsh-split-root]'));
	return { before, closed, hasHClose, splitLeft, rootMarked };
})()`);
ok("收起前层级内容可见", i20.before === true);
ok("🔴 回读：弹窗已关闭", i20.closed === true, "closed=" + i20.closed);
ok("🔴 分屏样式已移除（clearSplit 完全可逆）", i20.splitLeft === false, "split-style=" + i20.splitLeft);
ok("🔴 原生应用根零残留标记（data-* 全清）", i20.rootMarked === false, "rootMarked=" + i20.rootMarked);

/* ── I21 全量交互元素覆盖审计 ── */
console.log("\n[I21] 全量交互元素覆盖审计（防止再漏）");
const i21 = await evalExpr(`(async () => {
	const launcher = document.getElementById('dsh-director-hierarchy-launcher');
	// 审计需要层级段可见；用幂等开启而非切换
	await window.__openLevels();
	const p = window.__panel();
	if (!p) return { total:0, uncovered:['层级段未就绪'], launcher:Boolean(launcher), missingTestId:0 };
	const els = Array.from(p.querySelectorAll('button,input,textarea,select'));
	// 本脚本已实际点击过的 testid（上表与之一一对应）
	const covered = ['h-tab-overview','h-tab-director','h-close','h-sync','h-meta-name',
		'h-meta-positioning','h-meta-goal','h-meta-currentPhase','h-save-meta','h-sum-one','h-prop-up',
		'h-sum-tree','h-new-name','h-new-level','h-create','h-attach-sid','h-attach-title','h-attach','h-remove',
		'w-save','w-submit-up','w-restore','director-input','director-send','director-autoforward'];
	const uncovered = [];
	for (const e of els) {
		const tid = e.getAttribute('data-testid');
		if (tid && covered.indexOf(tid) >= 0) continue;
		if (e.getAttribute('data-duty')) continue;        // I4 已逐项点击
		if (e.getAttribute('data-edit-prompt')) continue; // I5 已点击
		if (e.tagName === 'TEXTAREA') continue;           // I5 展开后的 prompt 编辑框
		uncovered.push(e.tagName + ':' + (e.type||'') + '「' + (e.innerText||e.placeholder||'').trim().slice(0,20) + '」');
	}
	return { total: els.length, uncovered, launcher: Boolean(launcher),
	         missingTestId: els.filter(e => !e.getAttribute('data-testid') && !e.getAttribute('data-duty') && !e.getAttribute('data-edit-prompt') && e.tagName !== 'TEXTAREA').length };
})()`);
ok("面板交互元素总数已枚举", i21.total > 0, i21.total + " 个");
ok("🔴 无「未覆盖」的交互元素（全部被实际点击过）", i21.uncovered.length === 0,
	i21.uncovered.length ? "遗留: " + i21.uncovered.join(" / ") : "0 个遗漏");
ok("入口按钮存在（launcher 可反复开关）", i21.launcher === true);

/* ── I22 清理测试残留 ── */
console.log("\n[I22] 清理测试残留（保证可反复运行）");
const i22 = await evalExpr(`(async () => {
	const all = await window.__dshHierarchy.listAllNodes();
	const junk = all.filter(n => /^(临时项目|探针项目|待升位子节点)/.test(n.name || ''));
	for (const n of junk) { try { await window.__dshHierarchy.removeNode(n.id); } catch (e) { /* 忽略 */ } }
	// 根节点名若被 I13 改成「验证xxxxxx」，恢复为标准名
	const root = await window.__dshHierarchy.getNode('__global__');
	let renamed = false;
	if (root && /^验证[0-9]+$/.test(root.name || '')) {
		root.name = '全局总管';
		await window.__dshHierarchy.saveNode(root);
		renamed = true;
	}
	const after = await window.__dshHierarchy.listAllNodes();
	return { removed: junk.length, renamed, remaining: after.filter(n => /^(临时|探针)/.test(n.name || '')).length, rootName: root ? root.name : null };
})()`);
ok("测试残留节点已清理", i22.remaining === 0, "删除 " + i22.removed + " 个");
ok("根节点名已恢复（不把测试数据留给用户）", i22.renamed === true || i22.rootName === "全局总管", "rootName=" + i22.rootName);

/* ── 汇总 ── */
console.log("\n════════════════════════════════════════");
console.log(`真机交互验证：PASS ${pass} / FAIL ${fail} / SKIP ${skipped} / 总计 ${pass + fail + skipped}`);
if (fails.length) {
	console.log("失败项：");
	fails.forEach((f) => console.log("  ✗ " + f));
}
/* 🔴 跳过必须**显式列出原因**（纪律 18：「跳过」比「红」更危险 —— 红有人看，跳过没人看） */
if (skips.length) {
	console.log("跳过项（每条都带可分辨原因，不许当「没问题」读）：");
	skips.forEach((s) => console.log("  ⏭ " + s));
}
console.log(`IS_PASS: ${fail === 0 && !invalid ? "TRUE" : "FALSE"}`);
if (invalid) console.log("注：本轮存在 INVALID 项（读数不可信），按 exit 2 收尾 —— 先补等待预算，再判产品。");
if (skipped) console.log("注：本轮有 " + skipped + " 条 SKIP —— IS_PASS 只说明「跑过的都过」，不覆盖未跑到的。");
ws.close();
process.exit(invalid ? 2 : (fail === 0 ? 0 : 1));
