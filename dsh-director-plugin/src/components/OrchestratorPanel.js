/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：多智能体编排面板
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：logic/roles.js, logic/dag.js, logic/policy.js, logic/delegate.js, logic/verify.js, logic/orchestrate.js, logic/director-chain.js
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 九（四页签编排面板 · 数字全部实时算）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/OrchestratorPanel.js — 多智能体编排面板
 *
 * ══════════════════════════════════════════════════════════════════
 *  它回答什么问题
 * ══════════════════════════════════════════════════════════════════
 *  「我这个插件到底是怎么组织的？谁在干活？为什么是这个模型？
 *    要花多少？什么算做完？」
 *  改之前这些问题**没有界面可看** —— 五步职责写死在 `director-run.js` 里，
 *  用户只能在总监回复的文本里读到结果，看不到结构。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 两条铁律（本文件的设计约束，来自项目纪律与既有教训）
 * ══════════════════════════════════════════════════════════════════
 *  ① **不造没有数据源的元素**（`mindmap-schema.js` 的教训）：
 *     本面板每一个数字都来自真实调用 ——
 *     角色数来自 `roles.js#LAYERS` + `rolesInLayer()`；
 *     波次来自 `dag.js#planWaves()`；模式来自 `policy.js#decideMode()`；
 *     预算来自 `budgetFor()`；验收维度来自 `orchestrate.js#RUBRIC`。
 *     **没有任何一个是写死的常量**（全部现场计算，可复算）。
 *  ② **不做没有接口的动作**：面板只有两个按钮，都有真实实现 ——
 *     「导出编排计划」把当前结构导出成 Markdown 并复制；
 *     「生成委派简报」用 `delegate.js#buildBriefing()` 产出四段式模板并复制。
 *     禁止「点了只弹一个 toast」。
 *
 *  ⚠️ 同时**如实标注现状与建议的差别**：执行图展示的是「依赖关系允许的并行度」，
 *     而当前实现仍是串行 5 步。这个差别本身就是本面板的价值之一 ——
 *     它把「可以并行」这件事变成看得见的事实，而不是一句口号。
 */

import * as react from "react";
import {
	LAYERS, LAYER, BUILTIN_ROLES, rolesInLayer, contextFor, DISCLOSE,
	l1Budget, l1Manifest
} from "../logic/roles.js";
import { normalizeGraph, validateGraph, planWaves, graphStats, STEP_TYPE } from "../logic/dag.js";
import { MODES, POLICIES, decideMode, profileOf, budgetFor, estimateCost, explainMode } from "../logic/policy.js";
import { buildBriefing, validateBriefing } from "../logic/delegate.js";
import { LABEL } from "../logic/verify.js";
import { RUBRIC } from "../logic/orchestrate.js";
import { DIRECTOR_CHAIN, GATE_SAMPLE } from "../logic/director-chain.js";

const h = react.createElement;

/* ── 局部样式（与 PersonalizePanel / VersionPanel 同一套 token；不跨文件共享 S，避免耦合） ── */
const S = {
	panel: {
		position: "absolute", top: 40, zIndex: 11, width: 460, maxHeight: "76vh",
		display: "flex", flexDirection: "column",
		background: "var(--dsw-alias-bg-base, #17181c)", color: "var(--dsw-alias-label-primary, #e8eaed)",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 8,
		boxShadow: "0 14px 40px rgba(0,0,0,.55)", overflow: "hidden", fontSize: 11.5
	},
	head: { display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderBottom: "1px solid #26282e" },
	body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 },
	foot: {
		padding: "7px 10px", borderTop: "1px solid #26282e", fontSize: 10.5,
		color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.5
	},
	sec: { display: "flex", flexDirection: "column", gap: 5 },
	secT: { fontWeight: 600, fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 },
	muted: { color: "var(--dsw-alias-label-tertiary, #8b9199)", fontSize: 10.5, lineHeight: 1.5 },
	card: {
		border: "1px solid #2b2e35", borderRadius: 6, padding: "6px 8px",
		background: "rgba(255,255,255,.03)", display: "flex", flexDirection: "column", gap: 3
	},
	row: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
	btn: {
		height: 22, padding: "0 8px", fontSize: 10.5, cursor: "pointer",
		borderRadius: 5, border: "1px solid var(--dsw-alias-border-l2, #3d4148)",
		background: "var(--dsw-alias-bg-l2, #212429)", color: "inherit"
	},
	chip: {
		fontSize: 10.5, padding: "1px 6px", borderRadius: 4,
		border: "1px solid #33373f", background: "rgba(255,255,255,.04)", whiteSpace: "nowrap"
	},
	wave: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
	node: {
		fontSize: 10.5, padding: "2px 7px", borderRadius: 5,
		border: "1px solid rgba(137,87,229,.5)", background: "rgba(137,87,229,.12)",
		fontFamily: "ui-monospace,Consolas,monospace"
	},
	nodeGate: {
		fontSize: 10.5, padding: "2px 7px", borderRadius: 5,
		border: "1px solid rgba(201,148,43,.55)", background: "rgba(201,148,43,.14)",
		fontFamily: "ui-monospace,Consolas,monospace"
	},
	arrow: { color: "var(--dsw-alias-label-tertiary, #8b9199)", fontSize: 10.5 }
};

/* 五步链的依赖声明已上移到 `logic/director-chain.js`（纯数据，零 react 依赖）。
 * 为什么搬走：数据埋在组件里会让**所有消费者被迫依赖 react** ——
 * 本仓库按 ADR-001 不装 node_modules，离线闸门 import 组件会直接 MODULE_NOT_FOUND，
 * 于是只能把节点数/波次硬编码，产品一改就假红。现在两边共用同一份图。 */

/**
 * 编排面板。
 * @param {object} props
 *   { open, onClose, inset:{right?:number}, top?, scope?, onCopy?(text,label) }
 */
export function OrchestratorPanel(props = {}) {
	const { open, onClose, inset, top = 40, scope = "总监页", onCopy } = props;
	const [tab, setTab] = react.useState("org");
	const [roleId, setRoleId] = react.useState(null);
	const [toast, setToast] = react.useState("");
	/* 剪贴板两级都失败时的**最后一级**：把待复制文本摆出来（见 `copy()` 注释）。
	 * 与 `toast` 分开存：toast 是"结果播报"（2.2s 自动消失），这里是"交付物"（用户没说走就留着）。 */
	const [fallback, setFallback] = react.useState("");

	/* 🔴 hooks 必须在早退之前（纪律 21） */
	react.useEffect(() => {
		if (!toast) return undefined;
		const id = setTimeout(() => setToast(""), 2200);
		return () => clearTimeout(id);
	}, [toast]);

	if (!open) return null;

	/* ── 全部数字现场计算（可复算、可核对） ── */
	const graph = normalizeGraph(DIRECTOR_CHAIN);
	const vres = validateGraph(graph);
	const waves = planWaves(graph, { concurrency: 2 });
	const stats = graphStats(graph);
	const profile = profileOf(stats, { risk: 2 });
	const decision = decideMode(profile, "balanced");
	const budget = budgetFor(decision.mode, "balanced", profile);
	const tiers = graph.map((s) => {
		const r = BUILTIN_ROLES.find((x) => x.id === s.role);
		return r ? r.modelTier : "standard";
	});
	const cost = estimateCost(decision.mode, graph, tiers.map((x) => (x === "strong" ? 6 : x === "cheap" ? 1 : 2)));
	const l1 = l1Budget();
	const l1Count = l1Manifest().length;

	/** 复制到剪贴板（真实动作；失败时降级为提示，不静默）
	 *  🔴 失败文案必须**带上目标标签**（2026-09-14 修正）：
	 *    起因是闸门报"点生成委派简报无反馈"。查下去发现面板其实每次都发了 toast，
	 *    发的是「复制失败：系统剪贴板不可用，请手动复制」——**一次正确的显式降级**。
	 *    机理：Chrome 的**瞬时用户激活会被第一次剪贴板写入消耗**，
	 *    因此同一会话里第二次 `writeText` 必然 `NotAllowedError`（实测逐次复现）。
	 *    闸门把"成功文案含简报"当成唯一通过条件，于是把这次正确的降级读成红。
	 *    修产品这一侧的理由**不是为了让闸门变绿**，而是：面板上并排两个复制按钮，
	 *    只报「复制失败」用户不知道是哪一个 —— 带上标签才是真的可操作。
	 *
	 *  🔴 再加**第三级**：把文本摆出来（2026-09-14）。起因是上面那条修完之后，闸门在真机连跑里
	 *    稳定拿到「复制失败（编排计划）：系统剪贴板不可用，请手动复制」——**而界面上没有任何东西可复制**。
	 *    一句话"请手动复制"却让人无从下手，等于功能没有：
	 *      · `navigator.clipboard.writeText` 需要**瞬时用户激活**，实测真机连点两次里第二次必拒；
	 *      · 旧兜底 `document.execCommand("copy")` 实测**也返回 false**（本环境直接不可用）。
	 *    两条都封死 ⇒ 必须补最后一级：把文本塞进可选中文本域摆在面板里，
	 *    用户至少能手动选中复制。这与 `DesignStudio`「剪贴板成功 **或** 展开可复制文本域」是同一约定
	 *    （`verify-design-studio` C16.5 已把它钉成硬判据：不得停在「复制失败」）。
	 *    ⚠️ 兜底**不许假成功**：只在真正摆出文本后才改口，且文案明说"已把文本摆到下方"。 */
	const copy = (text, label) => {
		const s = String(text == null ? "" : text);
		const reveal = (why) => {
			setFallback(s + "\n\n—— " + label);
			setToast("复制失败（" + label + "）：" + why + "，已把文本摆到下方，请手动选中复制");
		};
		const legacy = () => {
			try {
				if (typeof document === "undefined" || !document.body) return false;
				const ta = document.createElement("textarea");
				ta.value = s;
				ta.setAttribute("readonly", "");
				ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.left = "-1000px"; ta.style.opacity = "0";
				document.body.appendChild(ta);
				let ok = false;
				try { ta.select(); ok = document.execCommand("copy") === true; }
				finally { if (ta.parentNode) ta.parentNode.removeChild(ta); }
				return ok;
			} catch (e) { return false; }
		};
		try {
			if (typeof onCopy === "function") { onCopy(s, label); setToast("已复制：" + label); return; }
			if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
				/* 🔴 `writeText` 返回的是 **Promise**：失败（无用户手势时必拒 `NotAllowedError`）
				 *    不会被外层 `try/catch` 接住，而是变成 **unhandledrejection**。
				 *    实测后果（2026-09-14 第 6 批）：污染 `verify-v17-sync` 的 E2
				 *    「全过程无新增 window.onerror / unhandledrejection」，让别人的闸门假红。
				 *    ⇒ 必须显式接住，并把失败如实播报出来（降级可以，无声不行）。
				 *    ⚠️ 这与 `DesignStudio.copy`（`.then(ok, fallback)` 双参）是同一套做法。 */
				navigator.clipboard.writeText(s).then(
					() => { setFallback(""); setToast("已复制：" + label); },
					() => { if (legacy()) { setFallback(""); setToast("已复制：" + label); } else reveal("系统剪贴板不可用"); }
				);
				return;
			}
			if (legacy()) { setFallback(""); setToast("已复制：" + label); return; }
			reveal("当前环境无剪贴板接口");
		} catch (e) {
			reveal(e && e.message ? e.message : String(e));
		}
	};

	/** 导出的编排计划（Markdown，供贴进文档或交给 AI） */
	const buildPlan = () => {
		const L = [];
		L.push("# 总监编排计划（" + scope + "）");
		L.push("");
		L.push("## 执行模式");
		L.push("- 模式：" + explainMode(decision.mode));
		L.push("- 决策依据：" + decision.reason);
		L.push("");
		L.push("## 执行图（" + stats.steps + " 步 / " + stats.levels + " 层 / 最大并行 " + stats.maxParallel + "）");
		for (const w of waves) {
			L.push("- 第 " + (w.index + 1) + " 波（层 " + w.level + "）：" + w.ids.join(" + "));
		}
		L.push("");
		L.push("## 硬上限");
		L.push("- 调用数 ≤ " + budget.maxCalls + "｜并发 ≤ " + budget.maxParallel
			+ "｜轮数 " + (budget.maxRounds === 0 ? "不限" : "≤ " + budget.maxRounds)
			+ "｜上下文 ≤ " + budget.maxBytes + " B");
		L.push("- 成本量级：" + cost.text);
		L.push("");
		L.push("## 步骤清单");
		for (const s of graph) {
			const r = BUILTIN_ROLES.find((x) => x.id === s.role);
			L.push("- [" + s.id + "] " + (r ? r.name + "（" + r.layer + "）" : s.role || "未指派角色")
				+ (s.depends_on.length ? " ← 依赖 " + s.depends_on.join("、") : "")
				+ " · 档位 " + (r ? r.modelTier : "-"));
		}
		L.push("");
		L.push("## 验收");
		L.push("- 机械层：emits_files / min_bytes / max_bytes / matches / contains（纯函数，不过模型）");
		L.push("- 语义层：三态 " + Object.values(LABEL).join(" / ") + "，判 FAIL 必须举证，跨族评审，成对比较位置交换");
		L.push("- 合议：机械层不过 ⇒ 直接 FAIL 且**不再询问模型**");
		return L.join("\n");
	};

	const tabs = [
		{ key: "org", label: "四层组织" },
		{ key: "graph", label: "执行图" },
		{ key: "budget", label: "策略与预算" },
		{ key: "accept", label: "验收标准" }
	];

	const panelStyle = { ...S.panel, top };
	if (inset && typeof inset.right === "number") panelStyle.right = inset.right;

	return h("div", { style: panelStyle, "data-testid": "dp-orch-panel", "data-tab": tab, "data-scope": scope }, [
		/* ── 头 ── */
		h("div", { key: "h", style: S.head }, [
			h("span", { key: "t", style: { fontWeight: 600 } }, "⧉ 编排体系"),
			h("span", { key: "s", style: { ...S.muted, marginLeft: "auto" } },
				"多智能体三层组织 · 每个数字现场算"),
			h("button", { key: "c", style: { ...S.btn, height: 20 }, "data-testid": "dp-orch-close", onClick: onClose }, "✕")
		]),

		/* ── 页签 ── */
		h("div", { key: "tb", style: { ...S.row, padding: "7px 10px", borderBottom: "1px solid #26282e" } },
			tabs.map((x) => h("button", {
				key: x.key,
				style: { ...S.btn, borderColor: tab === x.key ? "var(--dp-ac, #9fc2ff)" : "var(--dsw-alias-border-l2, #3d4148)" },
				"data-testid": "dp-orch-tab-" + x.key,
				onClick: () => setTab(x.key)
			}, x.label))),

		/* ── 主体 ── */
		h("div", { key: "b", style: S.body }, tab === "org" ? renderOrg({ roleId, setRoleId }) : null,
			tab === "graph" ? renderGraph({ waves, stats, vres }) : null,
			tab === "budget" ? renderBudget({ decision, budget, cost, l1, l1Count }) : null,
			tab === "accept" ? renderAccept() : null),

		/* ── 脚：两个真实动作 ── */
		h("div", { key: "f", style: S.foot }, [
			h("div", { key: "r", style: S.row }, [
				h("button", {
					key: "p", style: S.btn, "data-testid": "dp-orch-export",
					title: "把当前编排计划导出为 Markdown 并复制",
					onClick: () => copy(buildPlan(), "编排计划")
				}, "⤓ 导出编排计划"),
				h("button", {
					key: "d", style: S.btn, "data-testid": "dp-orch-briefing",
					title: "按四段式模板生成一份委派简报并复制",
					onClick: () => {
						const bid = roleId || "doc-writer";
						const r = BUILTIN_ROLES.find((x) => x.id === bid);
						const text = buildBriefing({
							goal: (r ? r.goal : "按角色目标执行"),
							outputFormat: "按该角色 summary 约定的产出形态；缺形态则先补形态再动手",
							sources: "仅使用「执行图」里 dependencies 命中的上游产出（禁止全量转发历史）",
							boundary: "只做本步职责；不改其它步骤的产出；不越界重构"
						}, { title: "委派简报 · " + (r ? r.name : bid) });
						const chk = validateBriefing({
							goal: r ? r.goal : "x", outputFormat: "y", sources: "z", boundary: "w"
						});
						copy(text + (chk.ok ? "" : "\n\n⚠ 四段校验未过：" + chk.missing.join("、")), "委派简报");
					}
				}, "✎ 生成委派简报"),
				toast ? h("span", { key: "x", "data-testid": "dp-orch-toast", style: S.muted }, toast) : null
			]),
			/* 最后一级交付物：**只读可选中**的文本域。用 `readOnly` 而非 `disabled` ——
			 * disabled 的元素无法选中文本，"手动复制"又会落空。 */
			fallback ? h("div", { key: "fb", style: { ...S.card, marginTop: 6 } }, [
				h("div", { key: "h", style: S.muted }, "剪贴板不可用 · 请直接在下面全选复制（点框内 → Ctrl+A → Ctrl+C）"),
				h("textarea", {
					key: "t", readOnly: true, value: fallback,
					"data-testid": "dp-orch-fallback",
					onFocus: (e) => { try { e.target.select(); } catch (er) { /* 选中失败不影响用户手选 */ } },
					style: { width: "100%", minHeight: 96, marginTop: 4, fontFamily: "inherit", fontSize: 11, lineHeight: 1.5, color: "var(--dp-fg, #d7dae0)", background: "#1b1d22", border: "1px solid #33373f", borderRadius: 6, padding: 8, resize: "vertical" }
				}),
				h("button", { key: "c", style: S.btn, "data-testid": "dp-orch-fallback-close", onClick: () => setFallback("") }, "收起")
			]) : null,
			h("div", { key: "n", style: { marginTop: 4 } },
				"数据源：roles.js（" + BUILTIN_ROLES.length + " 角色）· dag.js（" + stats.steps + " 步 / " + stats.waves + " 波）· policy.js（"
				+ MODES.length + " 模式 × " + POLICIES.length + " 策略）· verify.js（双层验收）")
		])
	]);
}

/* ══════════════════════════════════════════════════════════════════
 *  页签一：四层组织
 * ══════════════════════════════════════════════════════════════════ */
function renderOrg(ctx) {
	const { roleId, setRoleId } = ctx;
	const role = roleId ? BUILTIN_ROLES.find((r) => r.id === roleId) : null;

	return [
		h("div", { key: "t", style: S.secT }, "◎ 四层组织",
			h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } },
				"治理 / 编排 / 执行 / 合规 —— 合规层必须独立于产出者")),

		...LAYERS.map((lay) => {
			const list = rolesInLayer(lay.key);
			return h("div", { key: lay.key, style: S.card, "data-testid": "dp-orch-layer", "data-layer": lay.key }, [
				h("div", { key: "h", style: S.row }, [
					h("span", { key: "i" }, lay.icon),
					h("b", { key: "l" }, lay.label),
					h("span", { key: "d", style: S.muted }, lay.duty),
					h("span", { key: "c", style: { ...S.chip, marginLeft: "auto" } }, list.length + " 个角色")
				]),
				h("div", { key: "n", style: S.muted }, lay.note),
				h("div", { key: "r", style: S.row }, list.map((r) => h("button", {
					key: r.id,
					style: {
						...S.chip, cursor: "pointer",
						borderColor: roleId === r.id ? "var(--dp-ac, #9fc2ff)" : "#33373f"
					},
					"data-testid": "dp-orch-role", "data-role": r.id,
					title: r.description,
					onClick: () => setRoleId(roleId === r.id ? null : r.id)
				}, r.icon + " " + r.name)))
			]);
		}),

		/* `data-role` 是给闸门用的**确定性锚点**（2026-09-14 新增）：
		 * 面板 `open=false` 时只 `return null`、**组件仍挂载** ⇒ `roleId` 等 state 会跨"关→开"
		 * 甚至跨运行存活。闸门若不假设起点、要显式建立"未选中"，就必须能精确点回**当前选中的那个角色**
		 * （角色按钮是开关；点错一个会变成"换成另一个"而不是"取消"）。
		 * 卡里记下自己的 roleId，闸门就能点回同一个 ⇒ 归零可复算、不靠猜 DOM 顺序。 */
		role ? h("div", { key: "card", style: { ...S.card, borderColor: "var(--dp-ac, #9fc2ff)" }, "data-testid": "dp-orch-rolecard", "data-role": roleId }, [
			h("div", { key: "t", style: S.row }, [
				h("b", { key: "n" }, role.icon + " " + role.name),
				h("span", { key: "id", style: S.chip }, role.id),
				h("span", { key: "m", style: S.chip }, role.modelTier),
				role.readOnly ? h("span", { key: "ro", style: S.chip }, "只读") : null,
				role.allowDelegation ? h("span", { key: "dl", style: S.chip }, "可委派") : null
			]),
			h("div", { key: "g", style: S.muted }, "目标：" + role.goal),
			h("div", { key: "b", style: S.muted }, "行为先验：" + role.backstory),
			h("div", { key: "d", style: S.muted }, "何时找我：" + role.description),
			h("div", { key: "w", style: S.muted }, "怎么干：" + role.body),
			h("div", { key: "s", style: S.muted }, "来源：" + role.src),
			h("div", { key: "l1", style: S.muted },
				"L1 常驻段（" + contextFor(role, DISCLOSE.L1).length + " 字符）：" + contextFor(role, DISCLOSE.L1))
		]) : null
	];
}

/* ══════════════════════════════════════════════════════════════════
 *  页签二：执行图
 * ══════════════════════════════════════════════════════════════════ */
function renderGraph({ waves, stats, vres }) {
	return [
		h("div", { key: "t", style: S.secT }, "◫ 执行图（由依赖关系现算）",
			h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } },
				stats.steps + " 步 · " + stats.levels + " 层 · " + stats.waves + " 波 · 最大并行 " + stats.maxParallel)),

		...waves.map((w) => h("div", {
			key: w.index, style: S.wave, "data-testid": "dp-orch-wave", "data-wave": String(w.index),
			"data-size": String(w.ids.length)
		}, [
			h("span", { key: "l", style: { ...S.chip, minWidth: 54, textAlign: "center" } }, "第 " + (w.index + 1) + " 波"),
			...w.ids.flatMap((id, i) => {
				const s = DIRECTOR_CHAIN.find((x) => x.id === id) || { id };
				const isGate = Object.values(STEP_TYPE).slice(1).indexOf(s.type) >= 0;
				return [
					i > 0 ? h("span", { key: id + "-a", style: S.arrow }, "+") : null,
					h("span", {
						key: id, style: isGate ? S.nodeGate : S.node,
						"data-testid": "dp-orch-node", "data-node": id
					}, id)
				].filter(Boolean);
			}),
			w.ids.length > 1 ? h("span", { key: "p", style: { ...S.chip, borderColor: "rgba(57,197,207,.5)" } }, "并行") : null
		])),

		h("div", { key: "n", style: S.card, "data-testid": "dp-orch-parallel-note" }, [
			h("b", { key: "t" }, "架构补全点：可并行的那一波"),
			h("div", { key: "b", style: S.muted },
				"第 1 波（branch + model）互不依赖 ⇒ 依赖关系**允许并行**；"
				+ "当前 director-run.js 仍是串行执行这两步。本面板如实显示「允许的并行度」，"
				+ "以便判断值不值得真的并行（并行收益 = 省下一次串行等待，代价 = 并发保护复杂度）。"),
			h("div", { key: "c", style: S.muted },
				"校验：" + (vres.ok ? "图合法（0 错误）" : "⚠ " + vres.errors.join("；"))
				+ (vres.warnings.length ? " · 提示 " + vres.warnings.length + " 条" : ""))
		]),

		GATE_SAMPLE ? h("div", { key: "g", style: S.card }, GATE_SAMPLE) : null,

		h("div", { key: "l", style: S.card }, [
			h("b", { key: "t" }, "图例"),
			h("div", { key: "r", style: S.row }, [
				h("span", { key: "a", style: S.node }, "普通步骤"),
				h("span", { key: "b", style: S.nodeGate }, "人工闸门（approval / human_input）"),
				h("span", { key: "c", style: S.arrow }, "+ = 同波并行")
			]),
			h("div", { key: "n", style: S.muted },
				"依赖语义：depends_on 默认 all（全等齐才开跑）；any_completed 会在多上游时告警（只等一个会拿到半份输入）。")
		])
	];
}

/* ══════════════════════════════════════════════════════════════════
 *  页签三：策略与预算
 * ══════════════════════════════════════════════════════════════════ */
function renderBudget({ decision, budget, cost, l1, l1Count }) {
	return [
		h("div", { key: "t", style: S.secT }, "⚖ 策略与预算",
			h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } }, "默认 direct 起步，升档要有证据")),

		h("div", { key: "d", style: S.card, "data-testid": "dp-orch-decision" }, [
			h("div", { key: "r", style: S.row }, [
				h("span", { key: "l" }, "本次决策"),
				h("b", { key: "m", "data-testid": "dp-orch-mode" }, decision.mode),
				decision.capped ? h("span", { key: "c", style: { ...S.chip, borderColor: "rgba(210,153,34,.55)" } }, "被策略压档") : null
			]),
			h("div", { key: "rs", style: S.muted }, decision.reason),
			h("div", { key: "b", style: S.muted }, budget.note)
		]),

		h("div", { key: "m", style: S.card }, [
			h("b", { key: "t" }, "三种模式的代价与自身风险"),
			...MODES.map((mo) => h("div", { key: mo.key, style: S.muted },
				mo.icon + " " + mo.label + "（约 " + mo.multiplier + " 倍）：" + mo.when + " —— 风险：" + mo.failMode))
		]),

		h("div", { key: "c", style: S.card }, [
			h("b", { key: "t" }, "硬上限（没有兜底上限的系统，坏起来是无声的）"),
			h("div", { key: "r", style: S.row }, [
				h("span", { key: "a", style: S.chip }, "调用 ≤ " + budget.maxCalls),
				h("span", { key: "b", style: S.chip }, "并发 ≤ " + budget.maxParallel),
				h("span", { key: "c", style: S.chip }, "轮数 " + (budget.maxRounds === 0 ? "不限" : "≤ " + budget.maxRounds)),
				h("span", { key: "d", style: S.chip }, "上下文 ≤ " + budget.maxBytes + " B")
			]),
			h("div", { key: "n", style: S.muted }, "成本量级：" + cost.text)
		]),

		h("div", { key: "ctx", style: S.card, "data-testid": "dp-orch-l1" }, [
			h("b", { key: "t" }, "上下文预算（渐进式披露）"),
			h("div", { key: "n", style: S.muted },
				l1Count + " 个角色的 L1 常驻段合计 **" + l1 + " 字符** —— 全部常驻也只占这么点，"
				+ "因为 L1 只写「我是谁、能干什么」，流程放 L2、依据放 L3，按需加载。"),
			h("div", { key: "n2", style: S.muted },
				"实测口径：工具定义超过 10 个准确率开始下降，50+ 工具可吃掉 5 万 token；"
				+ "相关内容落在长 prompt 中部时性能显著下降（U 型曲线）—— 所以「少给、给对位置」比「多给保险」更准。")
		])
	];
}

/* ══════════════════════════════════════════════════════════════════
 *  页签四：验收标准
 * ══════════════════════════════════════════════════════════════════ */
function renderAccept() {
	return [
		h("div", { key: "t", style: S.secT }, "⛨ 验收标准",
			h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } }, "机械层先跑，不过不问模型")),

		h("div", { key: "l", style: S.card }, [
			h("b", { key: "t" }, "第 1 层 · 机械断言（纯函数，不过模型）"),
			h("div", { key: "r", style: S.row }, ["emits_files", "min_bytes", "max_bytes", "matches", "contains"].map((k) => h("span", { key: k, style: S.chip }, k))),
			h("div", { key: "n", style: S.muted },
				"有唯一正确答案的问题不交给模型：字数、正则命中数、必需串是否出现。"
				+ "不过 ⇒ 直接 FAIL，**不再询问模型**（省一次调用，且结论更硬）。")
		]),

		h("div", { key: "j", style: S.card }, [
			h("b", { key: "t" }, "第 2 层 · 语义评审（去偏协议）"),
			h("div", { key: "r", style: S.row }, Object.values(LABEL).map((k) => h("span", { key: k, style: S.chip }, k))),
			h("div", { key: "n", style: S.muted },
				"① 跨族评审：同族模型自评有 10 到 25 个百分点的自我偏好偏差 ⇒ 同族一律不采信；"),
			h("div", { key: "n2", style: S.muted },
				"② 位置交换：成对比较有 10 到 15 分位的位置偏差，而「在提示里请求公平」实测约等于无效 ⇒ "
				+ "两个顺序都跑，结论翻转即判平局；"),
			h("div", { key: "n3", style: S.muted },
				"③ FAIL 必须举证：无证据一律降级为 " + LABEL.CANNOT_JUDGE + "，"
				+ "并保留第三态 —— 证据不足时正确结果是「判不了」，不是低分。")
		]),

		h("div", { key: "r", style: S.card }, [
			h("b", { key: "t" }, "打分维度（" + RUBRIC.length + " 维 · 打分标准自身也要被审）"),
			...RUBRIC.map((r) => h("div", { key: r.key, style: S.row }, [
				h("span", { key: "n", style: S.chip }, r.label + " ×" + r.weight),
				h("span", { key: "c", style: S.muted }, r.criterion)
			])),
			h("div", { key: "n", style: S.muted },
				"标准自审三条：可达性（每维都有判据与证据来源）/ 不重叠（维度两两不同）/ "
				+ "可证伪（每维都定义了 0 分）—— 三条不全过，这套标准**不允许拿来打分**。")
		])
	];
}

export default OrchestratorPanel;
