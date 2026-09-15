/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：技能与智能体的**指向表**（单一真相源）
 * 引用：—
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, store/agent-runs.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/catalog.js — 技能与智能体的**指向表**（单一真相源）
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（用户原话 · 第 6 批）
 * ══════════════════════════════════════════════════════════════════
 *  「完善技能和智能体的指向」
 *
 *  改之前的两处缺陷（都是"名字在、指向不在"）：
 *   ① `components/DirectorDialog.js` 里 `AGENTS`(5 条) / `SKILLS`(4 条) 是**陈旧硬编码**：
 *      · 与 `logic/roles.js` 的 12 角色注册表**并存但不同源** ⇒ 界面上看到的名册
 *        和真正参与执行的注册表**是两份**，改一份另一份不动。
 *      · 每条**只有 label**，没有「它到底指向哪个执行入口」⇒ 点进去、查不到、
 *        也无法机械校验「这个条目是不是真的存在」。
 *   ② `SKILLS` 的 key 是技能**目录名**，但目录名与技能名**不等价**：
 *      实测 `mermaid-diagram` 在磁盘上是 `mermaid-diagram__skillhub/`
 *      ⇒ 按 key 拼路径会**找不到**（且失败无声）。
 *
 *  ⇒ 本文件的职责只有一个：**给每一条技能 / 智能体一个可机械校验的指向**
 *     （`module#symbol` 或 `目录`），并提供 `auditCatalog()` 做自审。
 *
 * ── 设计约束 ─────────────────────────────────────────────────────
 *  · **零 import**（与 `logic/roles.js` / `logic/routing.js` 同款理由）：
 *    logic/** 的纯函数模块必须能被离线单测直接 import（项目无 node_modules）。
 *    故这里**不**import roles.js —— 角色侧的 target 写在 roles.js 自己的条目上，
 *    本文件只负责「技能侧 + 五步链路侧」的指向，以及两侧的**合流视图**。
 *  · **不许编造**：每条 target 都必须能在仓库里 grep 到（`export` 符号 / 目录）。
 *    校验器见 `scripts/verify-catalog.mjs`（不可解析 ⇒ 红）。
 *  · **绝不抛**：全部查询函数对非法入参返回 null / 空串，不抛异常。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、技能指向（真实技能 id → 真实磁盘目录）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 技能注册表。
 *
 * 字段：
 *   key    —— 技能**真实 name**（取 SKILL.md frontmatter 的 `name`，路由信号就是它）
 *   label  —— 界面显示名
 *   dir    —— **真实磁盘目录名**（🔴 与 key 不一定相同，这就是要单独存 dir 的原因）
 *   mode   —— 默认调用方式 auto / manual
 *   desc   —— 一句话；**开头 29 字符必须独立达意**（路由面只暴露这么多）
 *   noUse  —— 反触发：什么情况下**不要**用（防止被误挂到不相关的步骤上）
 *
 * ⚠️ dir 的基准根是用户级技能目录 `<USER_HOME>/.workbuddy/skills/`。
 *    这里**只存相对目录名**，不存绝对路径 —— 绝对路径会随机器迁移而假红。
 */
export const SKILL_CATALOG = Object.freeze([
	{
		key: "execution-standards", label: "执行标准规范", dir: "execution-standards",
		mode: "auto",
		desc: "需要按 L1–L4 链路 / 检查点 / 终止条件推进多步任务时用。",
		noUse: "单步问答、纯查询入口不要挂它（会把一次回答变成一次流程）。"
	},
	{
		key: "codebase-inspection", label: "代码库勘察", dir: "codebase-inspection",
		mode: "manual",
		desc: "需要先盘清代码规模 / 语言构成 / 文件数再动手时用。",
		noUse: "已知目标文件时直接读，不必先做全库勘察。"
	},
	{
		key: "mermaid-diagram", label: "图表生成", dir: "mermaid-diagram__skillhub",
		mode: "manual",
		desc: "要把流程 / 时序 / 架构画成图时才用。",
		noUse: "文档里已有同源图时不要重画（会两处不同步）。"
	},
	{
		key: "browser-skill", label: "浏览器操作", dir: "browser-skill",
		mode: "manual",
		desc: "需要真实点击 / 导航 / 截图来取证时用。",
		noUse: "只是读一个已知 URL 的文本时用抓取即可，不必开浏览器。"
	},
	{
		key: "design-doc-gap-audit", label: "设计文档补全审计", dir: "design-doc-gap-audit",
		mode: "manual",
		desc: "只读分析设计文档库、找缺口与冲突时用。",
		noUse: "要改文档时不要用它 —— 它是**只读**审计，不改文件。"
	},
	{
		key: "delivery-artifact", label: "交付物产出", dir: "delivery-artifact",
		mode: "manual",
		desc: "要把成果做成单文件 HTML 交付物时用。",
		noUse: "内部核对用的临时产物不要做成交付物（会污染交付目录）。"
	}
]);

/** 技能 id → 目录（取不到返回 null，调用方必须显式处理"指向缺失"） */
export function skillDirOf(key) {
	const s = SKILL_CATALOG.find((x) => x && x.key === key);
	return s && s.dir ? s.dir : null;
}

/* ══════════════════════════════════════════════════════════════════
 * 二、链条指向（总监五步 + 投递 + 本地模型）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 五步链路 → 真实执行入口 + 承担角色。
 *
 * 🔴 为什么单独存一份而不是从 `director-run.js` 反推：
 *    `director-run.js` 里五步是**内联过程代码**（没有"第几步由谁做"的元数据），
 *    从代码反推角色属**猜测**。此处把「步骤 → 角色 → 执行入口」写成**声明**，
 *    并由 `scripts/verify-catalog.mjs` 校验：
 *      ① 每个 module#symbol 真实存在；
 *      ② 步骤号与 `director-run.js` 里的 `push(n, name, ...)` **同名对齐**
 *         （改一处不改另一处 ⇒ 闸门红，不会静默错位）。
 */
export const CHAIN_STEPS = Object.freeze([
	{ n: 1, name: "整理语言", roleId: "polisher", module: "config/model.js", symbol: "polishLanguage" },
	{ n: 2, name: "切换分支", roleId: "branch-judge", module: "logic/director-run.js", symbol: "judgeBranch" },
	{ n: 3, name: "调整模型", roleId: "model-router", module: "logic/routing.js", symbol: "classifyIntent" },
	{ n: 4, name: "上下文筛选", roleId: "context-picker", module: "logic/director-run.js", symbol: "pickContext" },
	{ n: 5, name: "自动审核产出", roleId: "output-reviewer", module: "logic/director-run.js", symbol: "reviewOutput" }
]);

/** 链条上的两个**非步骤**环节（它们不占五步号，但用户最关心「成没成」） */
export const CHAIN_TARGETS = Object.freeze({
	model: { name: "本地模型", module: "config/model.js", symbol: "callLocalModel" },
	deliver: { name: "投递到对话", module: "bridge/chat-bridge.js", symbol: "deliverToChat" },
	record: { name: "处理链落库", module: "store/plugin-db.js", symbol: "appendDirectorMessage" }
});

/** 步骤号 → 链条元数据（取不到返回 null） */
export function stepMeta(n) {
	const x = CHAIN_STEPS.find((s) => s && s.n === n);
	return x || null;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、指向的字符串形态与解析
 * ══════════════════════════════════════════════════════════════════ */

/** 把 {module, symbol} 拼成可 grep 的指向串（symbol 缺省时只给模块） */
export function targetOf(module, symbol) {
	const m = String(module || "").trim();
	const s = String(symbol || "").trim();
	if (!m) return "";
	return s ? (m + "#" + s) : m;
}

/**
 * 解析指向串。
 * 🔴 解析失败返回 `{ok:false, module:"", symbol:"", raw}` 而**不是** null ——
 *    调用方要能把"这条指向坏了"显示出来（纪律 19：降级可以，无声不行）。
 */
export function parseTarget(raw) {
	const out = { ok: false, module: "", symbol: "", raw: String(raw || "") };
	const i = out.raw.indexOf("#");
	if (i < 0) { out.module = out.raw; out.ok = out.raw.length > 0; return out; }
	out.module = out.raw.slice(0, i);
	out.symbol = out.raw.slice(i + 1);
	out.ok = out.module.length > 0 && out.symbol.length > 0;
	return out;
}

/** 显示的短形态：只给文件名（+符号），不给整条路径 —— 浮窗宽度有限 */
export function shortTarget(raw) {
	const t = parseTarget(raw);
	if (!t.module) return "（无指向）";
	const file = t.module.split("/").slice(-1)[0];
	return t.symbol ? (file + "#" + t.symbol) : file;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、自审（机械断言；由 scripts/verify-catalog.mjs 调用）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 指向表自审（**只看表内自洽**，不复核源码存在性 —— 那件事必须由脚本 grep 做）。
 * @returns {{ok:boolean, fails:string[], counts:object}}
 */
export function auditCatalog() {
	const fails = [];
	const counts = { skills: 0, steps: 0, chainTargets: 0 };

	const seenSkill = new Set();
	for (const s of SKILL_CATALOG) {
		counts.skills++;
		if (!s || !s.key) { fails.push("技能缺 key"); continue; }
		if (seenSkill.has(s.key)) fails.push("技能 key 重复：" + s.key);
		seenSkill.add(s.key);
		if (!s.dir) fails.push("技能缺 dir（无法定位磁盘目录）：" + s.key);
		if (!s.label) fails.push("技能缺 label：" + s.key);
		if (!s.mode) fails.push("技能缺 mode：" + s.key);
		const d = String(s.desc || "");
		if (!d) fails.push("技能缺 desc（路由无信号）：" + s.key);
		else if (d.length < 12) fails.push("技能 desc 过短（少于 12）：" + s.key);
		if (!String(s.noUse || "").trim()) fails.push("技能缺 noUse（无反触发，会被误挂）：" + s.key);
	}

	const seenN = new Set();
	for (const c of CHAIN_STEPS) {
		counts.steps++;
		if (!c || typeof c.n !== "number") { fails.push("链条步骤缺 n"); continue; }
		if (seenN.has(c.n)) fails.push("链条步骤号重复：" + c.n);
		seenN.add(c.n);
		if (!c.name) fails.push("链条步骤缺 name：" + c.n);
		if (!c.roleId) fails.push("链条步骤缺 roleId（无法指向智能体）：" + c.n);
		if (!c.module || !c.symbol) fails.push("链条步骤缺 module#symbol：" + c.n);
	}
	/* 步骤号必须是连续的 1..N —— 断号说明有人插了一步却没改号 */
	const ns = CHAIN_STEPS.map((c) => c.n).sort((a, b) => a - b);
	for (let i = 0; i < ns.length; i++) {
		if (ns[i] !== i + 1) { fails.push("链条步骤号不连续：期望 " + (i + 1) + "，实际 " + ns[i]); break; }
	}

	for (const k of Object.keys(CHAIN_TARGETS)) {
		counts.chainTargets++;
		const t = CHAIN_TARGETS[k];
		if (!t || !t.name || !t.module || !t.symbol) fails.push("链条环节指向不完整：" + k);
	}

	return { ok: fails.length === 0, fails, counts };
}

/** 指向表自挂（与 roles.js/layout.js 同款：构造时即可被真机读到） */
export function installCatalogApi() {
	if (typeof window === "undefined") return null;
	try {
		window.__dshDirectorCatalog = {
			SKILL_CATALOG, CHAIN_STEPS, CHAIN_TARGETS,
			auditCatalog, skillDirOf, stepMeta, targetOf, parseTarget, shortTarget
		};
		return window.__dshDirectorCatalog;
	} catch (e) { return null; }
}
