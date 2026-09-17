#!/usr/bin/env node
/**
 * test-branch-tree-archive.mjs —— 分支树**摄取点**的两条新契约（第 21 批）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「现在会话有问题, 重复创建了一百多个会话」+「（每个会话）都有自己的总监,
 *            存在自己的会话总结文档」
 *
 * 🔴 两条被测契约，都落在 `refreshBranchTree()` 这**唯一摄取点**上：
 *   ① **D1**：宿主快照 `ids` 里**包含已归档会话**（实测 126 条里 125 条是幽灵），
 *      旧版把它们**全画进导图** ⇒ 用户看到 126 个框 ⇒ 这是"一百多个会话"的**真因**。
 *      ⇒ 摄取点必须按 `archivedSessionIds()` 过滤。
 *   ② **D2**：`applyDossiers` 第 19 批**全仓零调用** ⇒ 档案写了却从不显示。
 *      ⇒ 摄取点必须把档案挂到树上。
 *
 * 🔴 三处最容易"看起来对"的地方（本测试的重点）：
 *    · **`[]` 与 `null` 处置相反**：`[]` = 真的没有归档（可放心过滤）；
 *      `null` = 读不到（**不许过滤** —— 把"读不到"当"全归档"会一次清空导图）。
 *      只测 `[]` 一侧，恰好把最危险的那一侧（null）漏掉。
 *    · **"全是归档" ≠ "没有会话"**：过滤后为 0 必须是**空树**，
 *      绝不能回退 `fallbackFromDiscover()` —— 那会用伪造的平铺树盖住真相。
 *    · **过滤是否真的发生了**：必须拿**未过滤**的树做对照（反例上会不会也通过）。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | SA-1  | 🔴 归档会话被排除出树 | `rows` 不含任何归档 id |
 *  | SA-2  | 🔴 `archivedSessionIds()` 为 `null` ⇒ **不过滤** | `rows` = 全部（不清空） |
 *  | SA-3  | 对账：`rows + archivedExcluded = rawCount` | 逐格相符（不许静默丢） |
 *  | SA-4  | 🔴 全部归档 ⇒ **空树**且 `source="ctx.sessions"` | 不回退 discover |
 *  | SA-5  | 🔴 `applyDossiers` 接入 | 行上有 `dossierRole` / `dossierSummaryReason` |
 *  | SA-6  | 负对照：无档案的行**不挂**字段 | `hasDossier` 为 `undefined` |
 *  | SA-7  | `dossierApplied` **只数 rows** | = 命中行数（byId 不重复计数） |
 *  | SA-8  | 🔴 **正负对照（校准）** | 同批会话**不过滤**时**确实含**归档 id |
 *
 * 用法：node scripts/test-branch-tree-archive.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

/* localStorage stub（与 test-session-dossier.mjs 同写法） */
const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const { installBranchTreeApi, refreshBranchTree, buildBranchTree } =
	await import("../src/logic/branch-tree.js");
const { putDossier, clearDossiers, resetDossierCache, DOSSIER_KEY } =
	await import("../src/store/session-dossier.js");

/* ══════════════════════════════════════════════════════════════════
 * 断言框架（与既有套件同风格：唯一编号自检 + 证据行）
 * ══════════════════════════════════════════════════════════════════ */
let pass = 0, fail = 0;
const failures = [];
const seen = new Set();
function t(id, name, cond, evidence) {
	if (seen.has(id)) throw new Error("断言编号重复：" + id);
	seen.add(id);
	if (cond) { pass++; console.log("  ✅ " + id + " " + name + (evidence ? " · " + evidence : "")); }
	else { fail++; failures.push(id + " " + name); console.log("  ❌ " + id + " " + name + (evidence ? " · " + evidence : "")); }
}

/* ══════════════════════════════════════════════════════════════════
 * 假宿主 ctx（只实现本文件用到的三个面）
 * ══════════════════════════════════════════════════════════════════ */
function fakeCtx(list, archived) {
	return {
		sessions: {
			list: {
				getSnapshot() {
					const ids = list.map((s) => s.id);
					const byId = {};
					for (const s of list) byId[s.id] = s;
					return { ids, byId, current: ids[0] };
				}
			},
			manager: {
				api: {
					workspace: {
						list: async () => {
							if (archived === null) throw new Error("模拟：归档集读不到");
							return { result: { ok: true, value: { items: [], archivedSessionIds: archived } } };
						}
					}
				}
			}
		}
	};
}

function sess(id, title, running) {
	return { id, displayTitle: title, running: running === true, blank: false, updatedAt: 1789564000000 };
}

function reset() {
	store.clear();
	resetDossierCache();
}

/* ══════════════════════════════════════════════════════════════════
 * 场景构造：8 条分流会话 + 3 条「别的活会话」，其中 8 条已被归档
 * ══════════════════════════════════════════════════════════════════ */
const LIVE = [sess("session-live-1", "别的活会话 A"), sess("session-live-2", "别的活会话 B")];
const GHOSTS = [];
for (let i = 0; i < 8; i++) GHOSTS.push(sess("session-ghost-" + i, "「A" + (i + 1) + " 维度」《灵能修仙》"));
const ALL = LIVE.concat(GHOSTS);
const ARCHIVED = GHOSTS.map((s) => s.id);

console.log("═══ test-branch-tree-archive · 分支树摄取点契约（第 21 批）═══");
console.log("  场景：宿主快照 " + ALL.length + " 条，其中 " + ARCHIVED.length + " 条已归档");

/* ── SA-1：归档被排除 ───────────────────────────────────────────── */
{
	reset();
	clearDossiers();
	installBranchTreeApi(fakeCtx(ALL, ARCHIVED));
	const snap = await refreshBranchTree();
	const ids = snap.tree.rows.map((r) => r.sessionId);
	const leaked = ids.filter((x) => ARCHIVED.indexOf(x) >= 0);
	t("SA-1", "归档会话被排除出树", ids.length === LIVE.length && leaked.length === 0,
		"rows=" + ids.length + " 泄漏=" + leaked.length + " 期望=" + LIVE.length);

	/* ── SA-3：对账 ─────────────────────────────────────────────── */
	const raw = snap.diag.rawCount;
	const ex = snap.diag.archivedExcluded;
	t("SA-3", "对账 rows + 排除数 = 快照数", ids.length + ex === raw,
		ids.length + " + " + ex + " = " + raw + "（快照 " + raw + "）");

	/* ── SA-1b：diag 如实上报归档集本身 ─────────────────────────── */
	t("SA-1b", "diag 报出归档集与可用性", snap.diag.archivedKnown === true && snap.diag.archivedN === ARCHIVED.length,
		"archivedKnown=" + snap.diag.archivedKnown + " archivedN=" + snap.diag.archivedN);
}

/* ── SA-2：`null` ⇒ 不过滤（最危险的一侧）───────────────────────── */
{
	reset();
	installBranchTreeApi(fakeCtx(ALL, null));
	const snap = await refreshBranchTree();
	const n = snap.tree.rows.length;
	t("SA-2", "归档集读不到 ⇒ 不过滤（不清空导图）", n === ALL.length,
		"rows=" + n + " 期望=" + ALL.length + " archivedKnown=" + snap.diag.archivedKnown);
	/* 空数组（真没有归档）也必须 = 全部 */
	reset();
	installBranchTreeApi(fakeCtx(ALL, []));
	const snap2 = await refreshBranchTree();
	t("SA-2b", "归档集为空数组 ⇒ 也保留全部", snap2.tree.rows.length === ALL.length,
		"rows=" + snap2.tree.rows.length + " 期望=" + ALL.length);
}

/* ── SA-4：全部归档 ⇒ 空树（不回退 discover）────────────────────── */
{
	reset();
	installBranchTreeApi(fakeCtx(LIVE, LIVE.map((s) => s.id)));
	const snap = await refreshBranchTree();
	t("SA-4", "全部归档 ⇒ 空树且不回退 discover",
		snap.tree.rows.length === 0 && snap.source === "ctx.sessions",
		"rows=" + snap.tree.rows.length + " source=" + snap.source);
}

/* ── SA-8：正负对照 —— 不过滤时**确实含**归档 id ───────────────── */
{
	reset();
	installBranchTreeApi(fakeCtx(ALL, ARCHIVED));
	const snap = await refreshBranchTree();
	const ids = snap.tree.rows.map((r) => r.sessionId);
	const unfiltered = buildBranchTree(ALL).rows.map((r) => r.sessionId);
	const ghostInRaw = unfiltered.filter((x) => ARCHIVED.indexOf(x) >= 0).length;
	t("SA-8", "正负对照：源数据里确实有归档（过滤才使它们消失）",
		ghostInRaw === ARCHIVED.length && ids.length === LIVE.length,
		"未过滤树含归档=" + ghostInRaw + " 过滤后 rows=" + ids.length);
}

/* ── SA-5 / SA-6 / SA-7：档案接入 ───────────────────────────────── */
{
	reset();
	clearDossiers();
	/* 8 条幽灵会话各有档案（总监角色各不同 + 一条带"无产出原因"） */
	for (let i = 0; i < GHOSTS.length; i++) {
		putDossier(GHOSTS[i].id, {
			dim: "d" + i,
			director: { role: "A" + (i + 1) + " 维度 总监", name: "灵能修仙", at: 1 },
			summary: { text: "", at: 1, source: "none", ok: false, reason: "宿主本轮运行失败：Insufficient Balance（QUOTA 402）" }
		});
	}
	/* 活会话只给一条档案，另一条**没有**（负对照） */
	putDossier(LIVE[0].id, {
		dim: "x",
		director: { role: "A9 统筹 总监", name: "灵能修仙", at: 1 },
		summary: { text: "已产出正文", at: 1, source: "collect", ok: true }
	});
	resetDossierCache();
	installBranchTreeApi(fakeCtx(ALL, ARCHIVED));
	const snap = await refreshBranchTree();
	const rows = snap.tree.rows;
	const r0 = rows.find((r) => r.sessionId === LIVE[0].id);
	const r1 = rows.find((r) => r.sessionId === LIVE[1].id);

	t("SA-5", "档案被挂上树（角色 + 正文 + 来源）",
		Boolean(r0) && r0.dossierRole === "A9 统筹 总监" && r0.dossierSummary === "已产出正文" && r0.dossierSummarySrc === "collect",
		"role=" + (r0 && r0.dossierRole) + " summary=[" + (r0 && r0.dossierSummary) + "] src=" + (r0 && r0.dossierSummarySrc));

	t("SA-6", "负对照：无档案的行不挂任何 dossier 字段",
		Boolean(r1) && r1.hasDossier === undefined && r1.dossierRole === undefined,
		"hasDossier=" + (r1 && r1.hasDossier));

	t("SA-7", "dossierApplied 只数 rows（byId 不重复计数）",
		snap.diag.dossierApplied === 1,
		"applied=" + snap.diag.dossierApplied + " 期望=1（只有 1 条活会话有档案）");

	/* 归档会话的档案**不该**出现在树上（它们被过滤了） */
	const ghostOnTree = rows.filter((r) => ARCHIVED.indexOf(r.sessionId) >= 0).length;
	t("SA-9", "归档会话的档案也不上树（过滤先于挂档案）", ghostOnTree === 0,
		"树上归档行=" + ghostOnTree);
}

/* ── SA-10：reason 只在无正文时保留（有正文不带理由）────────────── */
{
	reset();
	clearDossiers();
	putDossier("session-live-1", {
		dim: "x",
		director: { role: "A9 统筹 总监", name: "n", at: 1 },
		summary: { text: "有正文", at: 1, source: "collect", ok: true, reason: "这句不该被保留" }
	});
	putDossier("session-live-2", {
		dim: "y",
		director: { role: "A8 蒸馏 总监", name: "n", at: 1 },
		summary: { text: "", at: 1, source: "none", ok: false, reason: "只有用户侧条目，没有助手回复" }
	});
	resetDossierCache();
	installBranchTreeApi(fakeCtx(ALL, ARCHIVED));
	const snap = await refreshBranchTree();
	const a = snap.tree.rows.find((r) => r.sessionId === "session-live-1");
	const b = snap.tree.rows.find((r) => r.sessionId === "session-live-2");
	t("SA-10", "有正文 ⇒ reason 为空串；无正文 ⇒ 原样保留",
		a.dossierSummaryReason === "" && b.dossierSummaryReason === "只有用户侧条目，没有助手回复",
		"a=[" + a.dossierSummaryReason + "] b=[" + b.dossierSummaryReason + "]");
	t("SA-10b", "无正文时 ok 强制 false（不许「有 ok 没正文」）", b.dossierSummaryOk === false && a.dossierSummaryOk === true,
		"a.ok=" + a.dossierSummaryOk + " b.ok=" + b.dossierSummaryOk);
}

/* ══════════════════════════════════════════════════════════════════ */
console.log("═══════════════════════════════════════════════════════════");
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) console.log("  失败项：" + failures.join(" | "));
console.log("  IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
