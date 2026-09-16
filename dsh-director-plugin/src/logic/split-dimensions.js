/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：按维度拆线（**纯函数**：无 DOM、无 store、无副作用）
 * 引用：—
 * 上游：components/DirectorPage.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/split-dimensions.js — 按维度拆线（**纯函数**：无 DOM、无 store、无副作用）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 需求来源（第 16 批用户原话）
 * ───────────────────────────────────────────────────────────────────
 *   「按照一个流程跑一遍 写小说吧,调用小说技能」
 *   「然后按照世界观剧情等应该自动分到不同的对话分支 然后思维导图应该能看出来」
 *
 * 🔴 关键判断：**不新造一套维度**。维度来自用户点名的小说技能
 *    `multi-agent-novel-brain` 的 **A1–A8 分工表**（该技能的核心就是
 *    "8 个智能体 + 各自的文件边界"，见其 SKILL.md「智能体分工与文件边界」）。
 *    用户说"世界观剧情等"里的"等"，正对应 A2/A4/A5/A6/A7/A8 —— 一个不落地对应过去，
 *    才是"自动分开"；只在插件里凭空列 3 个维度，等于把技能的边界模型丢了。
 *
 * 🔴 每条维度都带 **files（只读/可写目录）**：技能的关键约束是"每个智能体只读/只写
 *    自己的目录"。把这条边界**随简报一起投递**，分支里的智能体才不会越界去写别人的域
 *    （越界的后果是静默的：两个分支同时改世界观文件，谁也不报错）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 契约
 * ═══════════════════════════════════════════════════════════════════
 *   · `SPLIT_DIMENSIONS` 的 `key` 是**稳定标识**：进 `data-*` 与节点 id，改名即断血缘
 *   · `label` 是用户可见名（**分支名与导图标签**都用它开头 ⇒ 导图上一眼看出结构）
 *   · 纯函数：同输入必同输出（可离线单测；也是 UI 与闸门共用的**同一份判据**）
 */

/**
 * 小说场景的八个维度（**逐条对应** `multi-agent-novel-brain` 的 A1–A8）。
 * `files` = 该维度**应当只读/只写**的目录（技能的文件边界，随简报投递）。
 * `stage` = 工序阶段，用于排序（先设定、后写正文、最后审校）。
 */
export const SPLIT_DIMENSIONS = Object.freeze([
	{ key: "world", label: "A1 世界观", stage: 1, files: ["01-世界观/"], brief: "搭建世界规则 / 地理 / 历史 / 势力" },
	{ key: "power", label: "A2 力量体系", stage: 1, files: ["01-世界观/world-rules", "02-力量体系/"], brief: "设计修行 / 等级 / 技能 / 代价" },
	{ key: "plot", label: "A3 剧情", stage: 2, files: ["01-世界观/", "02-力量体系/", "03-剧情架构/"], brief: "Hook / 分卷 / 章纲 / 支线" },
	{ key: "chars", label: "A4 人物", stage: 2, files: ["01-世界观/factions", "03-剧情架构/arc-plan", "04-人物档案/"], brief: "角色心理学档案 / 关系网" },
	{ key: "prose", label: "A5 正文", stage: 3, files: ["03-剧情架构/chapter-outline", "04-人物档案/", "05-正文/"], brief: "按章纲写正文，并保持与前文一致" },
	{ key: "polish", label: "A6 打磨", stage: 4, files: ["05-正文/", "07-风格语料/"], brief: "润色 / 去 AI 味" },
	{ key: "review", label: "A7 审查", stage: 4, files: ["03-剧情架构/", "04-人物档案/", "05-正文/", "08-审查/"], brief: "六关一致性审查（剧情 / 人物 / 设定 / 文风 / 推进 / 逻辑）" },
	{ key: "distill", label: "A8 蒸馏", stage: 5, files: ["_memory/", "08-审查/"], brief: "跨对话记忆蒸馏（把各分支产出汇成一份可复用的记忆）" }
]);

/** 小说意图关键词（命中任一 ⇒ 判为小说场景）。**全部小写比对**，调用方先归一化。 */
export const NOVEL_HINTS = Object.freeze([
	"小说", "世界观", "力量体系", "剧情", "章纲", "章节", "人物档案", "正文", "润色",
	"novel", "chapter", "worldbuilding", "outline"
]);

/** 通用场景的兜底维度（识别不到小说意图时**不硬套** A1–A8 —— 那会建出一堆空分支）。 */
export const GENERIC_DIMENSIONS = Object.freeze([
	{ key: "plan", label: "方案", stage: 1, files: [], brief: "把需求拆成可执行的方案" },
	{ key: "build", label: "执行", stage: 2, files: [], brief: "按方案落地" },
	{ key: "verify", label: "验证", stage: 3, files: [], brief: "验证产出是否达成目标" }
]);

/** 中文书名号提取：《我的小说》 ⇒ "我的小说"；取不到返回空串（**不编名字**） */
export function novelNameOf(text) {
	const s = String(text == null ? "" : text);
	const m = s.match(/《([^》]{1,40})》/);
	return m ? m[1] : "";
}

/** 是否小说意图（纯函数；空文本 ⇒ false，不许"默认当小说"） */
export function isNovelIntent(text, extraHints) {
	const s = String(text == null ? "" : text).toLowerCase();
	if (!s.trim()) return false;
	const hints = Array.isArray(extraHints) && extraHints.length ? extraHints : NOVEL_HINTS;
	return hints.some((k) => s.indexOf(String(k).toLowerCase()) >= 0);
}

/**
 * 分支名（纯函数）：**维度名在前** + 书名（有则带上）。
 * 为什么维度名必须在前：导图里节点按 `label` 排序阅读时，"A1/A2/A3…"这层结构
 * 一眼可见；把书名放前面（"《X》· A1 世界观"）会让八个节点的**共同前缀**占满可视区，
 * 反而看不出结构（这也是本项目"路由面只暴露前 29 字符"那条教训的同型问题）。
 */
export function branchTitle(dim, novelName) {
	const n = String(novelName == null ? "" : novelName).trim();
	return "「" + String(dim && dim.label ? dim.label : "维度") + "」" + (n ? "《" + n + "》" : "");
}

/**
 * 生成分流计划（纯函数）。
 * @param {string} text 需求原文
 * @param {{only?:string[], all?:boolean, max?:number, generic?:boolean}} [opts]
 *   `only` 只要这几条维度（key 数组）；`max` 上限（防一次建太多）；
 *   `generic: true` 强制走通用维度；`generic: false` **严格模式**（未命中小说意图 ⇒ `none`，不兜底）
 * @returns {{kind:"novel"|"generic"|"none", dims:Array, name:string, reason:string}}
 */
export function plan(text, opts = {}) {
	const o = opts || {};
	const src = String(text == null ? "" : text).trim();
	const name = novelNameOf(text);
	/* 🔴 空需求 ⇒ **不建任何分支**：不猜、也不给"默认三条"。
	 *    建出来的是**空壳分支**，而且会让导图变脏 —— 用户看到多出 3 个不知道干什么的节点，
	 *    比"什么都没发生"更糟（纪律 19 的反面：宁可如实说"没识别到"，也不无声造垃圾）。 */
	if (!src) return { kind: "none", dims: [], name, reason: "需求文本为空 ⇒ 不自动建分支" };
	const novel = o.generic ? false : isNovelIntent(src);
	if (o.generic === false && !novel) {
		return { kind: "none", dims: [], name, reason: "既不是小说意图，也未指定通用维度 —— 不自动建分支" };
	}
	const pool = novel ? SPLIT_DIMENSIONS : GENERIC_DIMENSIONS;
	let dims = pool.slice();
	if (Array.isArray(o.only) && o.only.length) {
		const want = o.only.map((k) => String(k));
		dims = dims.filter((d) => want.indexOf(d.key) >= 0);
	}
	/* 排序：先按工序阶段（设定 → 剧情/人物 → 正文 → 打磨/审查 → 蒸馏），
	 * 同阶段**按表内原始序**（= A1→A8 的固定次序）。
	 * 🔴 同阶段**不能用 key 字典序**：那会把 A2 力量体系排到 A1 世界观前面
	 *    （"power" < "world"），导图第一眼就读成「没有按工序来」。
	 *    显式用表内下标排序，**不依赖 Array#sort 的稳定性**（少一个隐性前提）。 */
	const order = new Map(pool.map((d, i) => [d.key, i]));
	dims.sort((a, b) => (a.stage - b.stage) || (order.get(a.key) - order.get(b.key)));
	const max = Number.isFinite(Number(o.max)) && Number(o.max) > 0 ? Math.round(Number(o.max)) : 0;
	if (max && dims.length > max) dims = dims.slice(0, max);
	return {
		kind: novel ? "novel" : "generic",
		dims,
		name,
		reason: novel ? "命中小说意图 ⇒ 按小说技能的 A1–A8 分工分线" : "未命中小说意图 ⇒ 按通用三段分线"
	};
}

/**
 * 每条维度要投递的**简报文本**（纯函数）。
 * 🔴 必须显式带上：① 它的角色名 ② 它能读/能写的目录边界 ③ 不要越界的告诫。
 *    只发一句"你去写世界观"会让分支里的智能体**去改剧情文件**——而且不报错。
 */
export function briefOf(dim, text, novelName) {
	const name = String(novelName == null ? "" : novelName).trim();
	const label = String((dim && dim.label) || "");
	const head = "【" + label + "】" + (name ? "《" + name + "》" : "") + " —— " + String((dim && dim.brief) || "");
	const files = Array.isArray(dim && dim.files) ? dim.files : [];
	const bound = files.length
		? "边界：只读/只写 " + files.join("、") + "；**不要**修改未列出的目录（越界改动在两个分支之间是静默冲突）。"
		: "边界：无文件域限制（通用维度）。";
	/* 🔴 用户原话「按照一个流程跑一遍 写小说吧,**调用小说技能**」——
	 *    插件**不能**替分支加载技能（宿主渲染进程里没有 WorkBuddy 的技能注册表），
	 *    能做且必须做的是：**把技能名与角色身份写进简报**，让分支里的智能体自己去加载。
	 *    只发一句"你去写世界观"的后果：分支不会加载技能、也不会读 `_memory/A{N}_MEMORY.md`
	 *    ⇒ 八个分支各自从零开始，技能里的"Token 最小化 / 记忆蒸馏"整套机制全部落空。
	 *    没写这行的表现与"写了但分支没照做"在读数上**无法区分** ⇒ 必须先把它送出去。 */
	const who = (label.match(/^A[1-8]/) || [""])[0];
	const skill = who
		? "技能：加载 multi-agent-novel-brain，担任 " + who + "；启动先读 _BRAIN.md §一路由 + §三状态，再读 _memory/" + who + "_MEMORY.md 与 _memory/CHANGE_LOG.md。"
		: "技能：通用维度，不加载小说技能。";
	const src = String(text == null ? "" : text).trim();
	return [head, skill, bound, src ? "需求原文：" + src : ""].filter(Boolean).join("\n");
}
