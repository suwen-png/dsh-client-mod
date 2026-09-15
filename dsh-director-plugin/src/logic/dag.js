/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：声明式步骤图
 * 引用：—
 * 上游：client-entry.js, components/OrchestratorPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 三（声明式执行图 · 6 类错误校验 · 波浪并行 · 条件与模板）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/dag.js — 声明式步骤图
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它
 * ══════════════════════════════════════════════════════════════════
 *  改之前：执行链是 `director-run.js` 里**写死的 5 个顺序块** ——
 *  想调顺序要改代码，想加一步要改代码，想并行**做不到**。
 *  agency-orchestrator 的做法是把它变成**一份声明**：
 *
 *      steps:
 *        - id: analyze   role: product/product-manager   output: requirements
 *        - id: tech      role: engineering/architect     depends_on: [analyze]
 *        - id: design    role: design/ux-researcher      depends_on: [analyze]
 *        - id: summary   depends_on: [tech, design]
 *
 *  引擎从 depends_on 自动构建 DAG，**同层无依赖的自动并行**（官方演示：
 *  「市场调研员和用户研究员自动并行执行，从 DAG 依赖关系检测」）。
 *
 *  ⇒ 本文件只做三件事：**建图、查错、排波次**。它是纯函数，不跑任何步骤。
 *
 * ══════════════════════════════════════════════════════════════════
 *  字段口径（逐项对应 agency-orchestrator 的原字段名，便于对照上游文档）
 * ══════════════════════════════════════════════════════════════════
 *   id              步骤唯一标识
 *   role            角色 id（本项目的 Agent Card id，对应上游的 分类/角色名 路径）
 *   task            任务描述（支持 {{变量}} 占位）
 *   output          输出变量名，供下游 {{}} 引用
 *   depends_on[]    依赖的步骤 id
 *   depends_on_mode "all"（默认）| "any_completed"
 *   condition       条件表达式，不满足则跳过
 *   type            "task" | "approval" | "human_input" | "assert"
 *   prompt          approval / human_input 节点的提示文本
 *   acceptance      验收标准（语义层，交模型评审）
 *   assert          机械断言（纯函数层，不过模型）
 *   loop            { back_to, max_iterations(1-10), exit_condition }
 *
 * 🔴 两条与上游**刻意不同**的地方（不照抄，因为上游的写法在本场景会埋雷）：
 *   ① 上游 `depends_on_mode: "any_completed"` 在**聚合类步骤**上是陷阱：
 *      只等一个上游就开跑，会拿到半份输入。本项目保留该字段但
 *      `validateGraph()` 会对它**告警**（而非直接判错），由调用方决定。
 *   ② 上游没有「依赖成环」的明确处置。本项目把**环**判为**硬错误**
 *      （exit 意义上等价于 FAIL），因为它意味着步骤永远排不出波次。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、常量
 * ══════════════════════════════════════════════════════════════════ */

/** 步骤类型（agency-orchestrator 的 type 字段 + 本项目补充） */
export const STEP_TYPE = Object.freeze({
	TASK: "task",                 // 普通执行步
	APPROVAL: "approval",         // 人工审批节点（跑到这里暂停，等人点通过）
	HUMAN_INPUT: "human_input",   // 人工输入节点（跑到这里暂停，读人的输入作为产出注入下游）
	ASSERT: "assert"              // 纯机械断言步（不过模型）
});

/** 依赖模式 */
export const DEP_MODE = Object.freeze({
	ALL: "all",
	ANY: "any_completed"
});

/** 需要人工介入的步骤类型（UI 上要显示闸门） */
export const GATE_TYPES = Object.freeze([STEP_TYPE.APPROVAL, STEP_TYPE.HUMAN_INPUT]);

/** 步骤 id 合法性：与角色 id 同规（便于日志与 URL 化） */
export const STEP_ID_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

/** 默认并行上限（与 agency-orchestrator 一致：concurrency 默认 2） */
export const DEFAULT_CONCURRENCY = 2;

/** 循环上限（上游限定 1 到 10，本项目沿用） */
export const MAX_LOOP = 10;

/* ══════════════════════════════════════════════════════════════════
 * 二、归一化
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 归一化一个步骤：补默认值、修类型、去重依赖。
 * 🔴 不猜「缺失的 depends_on」—— 缺就是无依赖（= 第一波），
 *    这比按数组顺序推断更安全（顺序推断会把并行悄悄变成串行）。
 * @param {object} raw
 * @param {number} [index] 数组下标，仅用于给缺 id 的步骤造一个可报错的名字
 * @returns {object}
 */
export function normalizeStep(raw, index = 0) {
	const s = raw && typeof raw === "object" ? raw : {};
	const deps = Array.isArray(s.depends_on)
		? [...new Set(s.depends_on.filter((d) => d != null && String(d).trim()).map((d) => String(d).trim()))]
		: [];
	const loop = s.loop && typeof s.loop === "object" && s.loop.back_to
		? {
			back_to: String(s.loop.back_to),
			max_iterations: clampInt(s.loop.max_iterations, 1, MAX_LOOP, 3),
			exit_condition: s.loop.exit_condition ? String(s.loop.exit_condition) : ""
		}
		: null;

	return {
		id: s.id != null && String(s.id).trim() ? String(s.id).trim() : ("step-" + (index + 1)),
		role: s.role ? String(s.role) : "",
		task: s.task != null ? String(s.task) : "",
		output: s.output ? String(s.output) : "",
		depends_on: deps,
		depends_on_mode: s.depends_on_mode === DEP_MODE.ANY ? DEP_MODE.ANY : DEP_MODE.ALL,
		condition: s.condition ? String(s.condition) : "",
		type: Object.values(STEP_TYPE).includes(s.type) ? s.type : STEP_TYPE.TASK,
		prompt: s.prompt != null ? String(s.prompt) : "",
		acceptance: s.acceptance != null ? String(s.acceptance) : "",
		assert: s.assert && typeof s.assert === "object" ? { ...s.assert } : null,
		loop
	};
}

function clampInt(v, min, max, dflt) {
	const n = Number(v);
	if (!Number.isFinite(n)) return dflt;
	return Math.max(min, Math.min(max, Math.round(n)));
}

/** 归一化整张图 */
export function normalizeGraph(steps) {
	return (Array.isArray(steps) ? steps : []).map((s, i) => normalizeStep(s, i));
}

/* ══════════════════════════════════════════════════════════════════
 * 三、校验（查错要**点名**，不能只说「图有问题」）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 校验步骤图。
 * @param {Array} steps 原始或已归一化的步骤
 * @returns {{ok:boolean, errors:string[], warnings:string[], ids:string[]}}
 *   errors   = 硬错误（图不可执行）：重复 id / 悬空依赖 / 依赖成环 / id 非法
 *   warnings = 软问题（可执行但有风险）：any_completed 聚合 / 无 output 却被人依赖 /
 *              闸门步缺 prompt / 循环缺 exit_condition
 */
export function validateGraph(steps) {
	const list = normalizeGraph(steps);
	const errors = [];
	const warnings = [];

	if (!list.length) return { ok: false, errors: ["步骤图为空"], warnings, ids: [] };

	/* ① id 合法且唯一 */
	const seen = new Set();
	for (const s of list) {
		if (!STEP_ID_RE.test(s.id)) errors.push("步骤 id 非法：" + s.id + "（须小写字母数字，可用 _ 或 - 连接）");
		if (seen.has(s.id)) errors.push("步骤 id 重复：" + s.id);
		seen.add(s.id);
	}

	/* ② 悬空依赖（指向不存在的步骤） */
	for (const s of list) {
		for (const d of s.depends_on) {
			if (!seen.has(d)) errors.push(s.id + " 依赖了不存在的步骤：" + d);
			if (d === s.id) errors.push(s.id + " 依赖了自己");
		}
	}

	/* ③ 成环（环 = 永远排不出波次，属硬错误） */
	const cycle = findCycle(list);
	if (cycle) errors.push("依赖成环：" + cycle.join(" → "));

	/* ④ 软问题 */
	for (const s of list) {
		if (GATE_TYPES.includes(s.type) && !s.prompt.trim()) {
			warnings.push(s.id + " 是人工闸门但没写 prompt（用户不知道要确认什么）");
		}
		if (s.depends_on_mode === DEP_MODE.ANY && s.depends_on.length > 1) {
			warnings.push(s.id + " 用 any_completed 且有多个上游：只等一个就开跑，会拿到半份输入");
		}
		if (s.loop && !s.loop.exit_condition) {
			warnings.push(s.id + " 有循环但没写 exit_condition（只能靠 max_iterations 兜底）");
		}
		if (s.loop && !seen.has(s.loop.back_to)) {
			errors.push(s.id + " 的 loop.back_to 指向不存在的步骤：" + s.loop.back_to);
		}
	}

	/* ⑤ 被人依赖却没有 output 名（下游无法用 {{}} 引用它） */
	for (const s of list) {
		const dependents = list.filter((x) => x.depends_on.includes(s.id));
		if (dependents.length && !s.output) {
			warnings.push(s.id + " 没有 output 名，但被 " + dependents.map((x) => x.id).join("、") + " 依赖（下游拿不到它的产出）");
		}
	}

	return { ok: errors.length === 0, errors, warnings, ids: list.map((s) => s.id) };
}

/**
 * 找一条环（DFS 三色标记）。
 * @returns {string[]|null} 环上的 id 序列，无环返回 null
 */
export function findCycle(steps) {
	const list = normalizeGraph(steps);
	const byId = new Map(list.map((s) => [s.id, s]));
	const WHITE = 0, GRAY = 1, BLACK = 2;
	const color = new Map();
	const stack = [];

	let found = null;
	const visit = (id) => {
		if (found) return;
		const node = byId.get(id);
		if (!node) return;
		const c = color.get(id) || WHITE;
		if (c === GRAY) {
			const at = stack.indexOf(id);
			found = stack.slice(at >= 0 ? at : 0).concat(id);
			return;
		}
		if (c === BLACK) return;
		color.set(id, GRAY);
		stack.push(id);
		for (const d of node.depends_on) visit(d);
		stack.pop();
		color.set(id, BLACK);
	};

	for (const s of list) if (!color.get(s.id)) visit(s.id);
	return found;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、拓扑排序与波次
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 拓扑序（Kahn 算法，同层按原数组顺序稳定输出）。
 *
 * 🔴 成环时**不抛错也不返回半张图** —— 返回 null 并交由 `validateGraph()` 报错。
 *    返回半张图会让调用方「看起来跑完了」，那是静默失败。
 * @returns {string[]|null}
 */
export function topoSort(steps) {
	const list = normalizeGraph(steps);
	if (findCycle(list)) return null;

	const indeg = new Map(list.map((s) => [s.id, 0]));
	const outs = new Map(list.map((s) => [s.id, []]));
	for (const s of list) {
		for (const d of s.depends_on) {
			if (!indeg.has(d)) continue;
			indeg.set(s.id, indeg.get(s.id) + 1);
			outs.get(d).push(s.id);
		}
	}

	const order = [];
	let frontier = list.filter((s) => indeg.get(s.id) === 0).map((s) => s.id);
	while (frontier.length) {
		for (const id of frontier) order.push(id);
		const next = [];
		for (const id of frontier) {
			for (const o of outs.get(id) || []) {
				indeg.set(o, indeg.get(o) - 1);
				if (indeg.get(o) === 0) next.push(o);
			}
		}
		frontier = next;
	}
	return order.length === list.length ? order : null;
}

/**
 * 拓扑分层：同层 = 互不依赖 = **可并行**。
 * @returns {string[][]} 层数组；成环返回 []
 */
export function topoLevels(steps) {
	const list = normalizeGraph(steps);
	if (findCycle(list)) return [];

	const depth = new Map();
	const byId = new Map(list.map((s) => [s.id, s]));
	const depthOf = (id, guard = new Set()) => {
		if (depth.has(id)) return depth.get(id);
		if (guard.has(id)) return 0;         // 防御：理论上到不了这里（已查过环）
		guard.add(id);
		const n = byId.get(id);
		if (!n) return 0;
		let d = 0;
		for (const p of n.depends_on) d = Math.max(d, depthOf(p, guard) + 1);
		guard.delete(id);
		depth.set(id, d);
		return d;
	};

	for (const s of list) depthOf(s.id);

	const maxD = Math.max(0, ...list.map((s) => depth.get(s.id) || 0));
	const levels = [];
	for (let i = 0; i <= maxD; i++) {
		const ids = list.filter((s) => (depth.get(s.id) || 0) === i).map((s) => s.id);
		if (ids.length) levels.push(ids);
	}
	return levels;
}

/**
 * 排执行波次：把拓扑层按 `concurrency` 上限切成一批批。
 *
 * 🔴 为什么不能只给「层」：层内 5 个步骤在 concurrency=2 时**不能一次全发**，
 *    否则上限形同虚设。故这里切到「每一波内步骤数不超过 concurrency」，
 *    并把波次编号一起返回（UI 上直接画进度）。
 *
 * @param {Array} steps
 * @param {object} [opts] { concurrency?:number }
 * @returns {Array<{index:number, level:number, ids:string[]}>}
 */
export function planWaves(steps, opts = {}) {
	const concurrency = Math.max(1, clampInt(opts.concurrency, 1, 64, DEFAULT_CONCURRENCY));
	const levels = topoLevels(steps);
	const waves = [];
	for (let li = 0; li < levels.length; li++) {
		const ids = levels[li];
		for (let i = 0; i < ids.length; i += concurrency) {
			waves.push({ index: waves.length, level: li, ids: ids.slice(i, i + concurrency) });
		}
	}
	return waves;
}

/**
 * 就绪集：依赖已满足、且尚未完成的步骤。
 * @param {Array} steps
 * @param {string[]} done 已完成的步骤 id
 * @param {object} [opts] { concurrency?:number } 本波剩余可发数
 * @returns {string[]}
 */
export function readySteps(steps, done = [], opts = {}) {
	const list = normalizeGraph(steps);
	const doneSet = new Set(done);
	const cap = opts.concurrency ? Math.max(1, clampInt(opts.concurrency, 1, 64, DEFAULT_CONCURRENCY)) : Infinity;

	const ready = [];
	for (const s of list) {
		if (doneSet.has(s.id)) continue;
		if (s.depends_on.length === 0) { ready.push(s.id); continue; }
		if (s.depends_on_mode === DEP_MODE.ANY) {
			if (s.depends_on.some((d) => doneSet.has(d))) ready.push(s.id);
		} else {
			if (s.depends_on.every((d) => doneSet.has(d))) ready.push(s.id);
		}
	}
	return ready.slice(0, cap === Infinity ? ready.length : cap);
}

/** 图规模统计（UI 与成本预估共用） */
export function graphStats(steps) {
	const list = normalizeGraph(steps);
	const levels = topoLevels(list);
	const waves = planWaves(list);
	return {
		steps: list.length,
		edges: list.reduce((n, s) => n + s.depends_on.length, 0),
		levels: levels.length,
		waves: waves.length,
		/* 最大并行度 = 单层最多几个（这才是「并行到底有没有用」的判据） */
		maxParallel: levels.reduce((m, l) => Math.max(m, l.length), 0),
		gates: list.filter((s) => GATE_TYPES.includes(s.type)).length,
		loops: list.filter((s) => s.loop).length
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 五、条件表达式（极简，刻意不用 eval）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 求值 `condition`。
 * 支持四种最小形式（对应 agency-orchestrator 文档里的 `{{var}} contains 技术`）：
 *   {{var}} exists
 *   {{var}} contains 子串
 *   {{var}} equals 值
 *   !{{var}} exists
 *
 * 🔴 刻意**不用 eval / new Function**：条件字符串来自工作流定义，
 *    在插件里它是可被用户编辑的数据 —— 用 eval 等于给这份数据开了执行权限。
 * 🔴 变量缺失时返回 `false` 且 `reason` 写明「变量不存在」——
 *    静默当 true 会让「本该跳过的步骤」照跑。
 *
 * @param {string} expr
 * @param {object} vars
 * @returns {{ok:boolean, reason:string}}
 */
export function evalCondition(expr, vars = {}) {
	const raw = String(expr || "").trim();
	if (!raw) return { ok: true, reason: "无条件 → 执行" };

	const m = raw.match(/^(!?)\s*\{\{\s*([\w.]+)\s*\}\}\s*(exists|contains|equals)?\s*([\s\S]*)$/);
	if (!m) return { ok: false, reason: "条件语法不支持：" + raw + "（支持 exists / contains / equals）" };

	const negate = m[1] === "!";
	const key = m[2];
	const arg = String(m[4] || "").trim();
	/* 🔴 没有操作符但尾部还有内容 ⇒ **语法不支持**，不得静默按 exists 处理。
	 *   实测（2026-09-14）：`{{k}} 大约等于 5` 曾被当成 `exists` 而**返回真**，
	 *   于是「本该跳过的步骤照跑」且没有任何提示 —— 与纪律 18「跳过比红更危险」同源。 */
	if (!m[3] && arg) {
		return { ok: false, reason: "条件语法不支持：" + raw + "（支持 exists / contains / equals）" };
	}
	const op = m[3] || "exists";

	if (!(key in vars) || vars[key] == null) {
		return { ok: negate, reason: "变量 " + key + " 不存在" };
	}
	const val = String(vars[key]);

	let hit;
	if (op === "exists") hit = val.trim().length > 0;
	else if (op === "contains") hit = val.indexOf(arg) >= 0;
	else hit = val === arg;

	const ok = negate ? !hit : hit;
	return { ok, reason: "{{" + key + "}} " + op + (arg ? " " + arg : "") + " → " + (hit ? "真" : "假") };
}

/** 步骤是否应执行（condition 为空 = 执行） */
export function shouldRun(step, vars = {}) {
	const s = normalizeStep(step);
	if (!s.condition) return { run: true, reason: "无条件" };
	const r = evalCondition(s.condition, vars);
	return { run: r.ok, reason: r.reason };
}

/* ══════════════════════════════════════════════════════════════════
 * 六、变量替换与产出引用
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 替换 `task` 里的 {{变量}}。
 * 未命中的占位**原样保留**并记进 `missing` —— 替换成空串会让下游看到
 * 一句语法通顺但缺了关键输入的指令，比留着一个显眼的 {{x}} 更危险。
 * @returns {{text:string, missing:string[]}}
 */
export function fillTemplate(tpl, vars = {}) {
	const missing = [];
	const text = String(tpl == null ? "" : tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (all, key) => {
		if (key in vars && vars[key] != null) return String(vars[key]);
		missing.push(key);
		return all;
	});
	return { text, missing };
}

/** 该步骤引用了哪些上游产出（用于上下文装配，防「全量转发」） */
export function refsOf(step) {
	const s = normalizeStep(step);
	const found = new Set();
	for (const m of s.task.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
	if (s.condition) for (const m of s.condition.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
	for (const m of String(s.acceptance || "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
	return [...found];
}

/* ══════════════════════════════════════════════════════════════════
 * 七、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installDagApi() {
	if (typeof window === "undefined") return null;
	window.__dshDag = {
		STEP_TYPE, DEP_MODE, GATE_TYPES, DEFAULT_CONCURRENCY,
		normalize: normalizeGraph,
		validate: validateGraph,
		findCycle,
		topoSort,
		topoLevels,
		planWaves,
		readySteps,
		graphStats,
		evalCondition,
		shouldRun,
		fillTemplate,
		refsOf
	};
	return window.__dshDag;
}
