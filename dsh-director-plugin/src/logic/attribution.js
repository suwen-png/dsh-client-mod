/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：归属判定（19 号文 §3.3 / N1 · **纯函数**）
 * 引用：19 号文 §3.3
 * 上游：components/DirectorPage.js, logic/split-dimensions.js
 * 下游：logic/split-dimensions.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/attribution.js — 归属判定（19 号文 §3.3 / N1 · **纯函数**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（用户原话，逐字）
 * ──────────────────────────────────────────────────────────────────
 *   「补充 A3 剧情第三章支线」⇒ 总监仍按 A1–A8 **全 8 维**建/派。
 *
 * 🔴 根因（源码逐行，不是推测）：
 *   `logic/split-dimensions.js#plan()` 里
 *     `const pool = novel ? SPLIT_DIMENSIONS : GENERIC_DIMENSIONS; let dims = pool.slice();`
 *   ⇒ **`o.only` 未传时恒为全量**；全仓**无**"按内容选维度"的函数。
 *
 * ── 🔴 两条不可逾越的纪律 ──────────────────────────────────────────
 *   ① **词表必须从 `SPLIT_DIMENSIONS` 派生**（`label` + `files` + `brief`），
 *      **禁止另立一份词表** —— 两份词表必漂移，且漂移是**静默**的
 *      （维度改了名，词表还在按旧名匹配 ⇒ 归属静默失效，谁也不报错）。
 *   ② **纯函数**：无 DOM、无 store、无时钟、不改入参 ⇒ 同输入必同输出。
 *      本模块是 UI（总监页读数）与闸门（`test-attribution.mjs` / `verify-*.mjs`）
 *      共用的**同一份判据**；一旦它有副作用，两边就各测各的，"全绿"不再有意义。
 *
 * ══════════════════════════════════════════════════════════════════
 * 判定规则（可解释、可测、非黑箱 —— 19 号文 §3.3 逐条落地）
 * ──────────────────────────────────────────────────────────────────
 *   1. **前置**：先过 `noiseReasonOf()`；命中 ⇒ `kind="noise"`、`dims=[]`，
 *      **不建任何分支**（保留 `plan()` 第 23 批的既有行为）。
 *   2. **词表派生**：见 `deriveDimensionTerms()`。
 *   3. **打分**：命中词数 × 权重；**信号分三级**（label > 目录 > 职责词）。
 *      🔴 分级是必须的，不是优化：`prose.files` 里含 `04-人物档案/`
 *      （**读**别人的目录），若不分级，「补充人物档案」会同时命中 `chars` 与 `prose`
 *      ⇒ 多派一条给正文分支。分级后 `chars` 靠 `label` 胜出，`prose` 出局。
 *   4. **多维度**：允许返回多个（用户一句话可含"世界观 + 剧情"）；
 *      **不得**因为"保险"而返回全部 8 维（那正是本条需求要治的病）。
 *   5. **显式全量**：仅当文本含全量信号**且**确为小说场景 ⇒ `extent="full"` 返回 8 维。
 *      🔴 反例（19 号文 N1 反例，逐字）：判据若写成"含『全』字" ⇒
 *      「全局变量改名」会被误判 full ⇒ **必须用词组**，且**加负对照**。
 *   6. **歧义**：`ambiguous=true` 时**不得静默选一个** —— 上层（总监页）须走确认通道。
 *      触发条件 = 命中 ≥2 维 **且** 存在 `stage` 相邻对
 *      （工序边界模糊才是真歧义；`world`+`power` 同属 stage 1 = 用户明确要两维，不算）。
 *   7. **零命中**：小说场景 ⇒ 8 维（**保留既有行为**：用户说了小说、没说维度，
 *      按 A1–A8 分线是技能本身的定义）；非小说场景 ⇒ `kind="generic"`、通用三段。
 *      ⚠️ 两者都**不得**判噪声（"没说维度"≠"没有内容"）。
 *
 * ══════════════════════════════════════════════════════════════════
 * @param {string} text 需求原文
 * @param {object} [opts]
 * @param {string[]} [opts.excludeKeys] 强制排除的维度 key（如"已确认归属其他分支"）
 * @param {string} [opts.currentDim] 当前所在维度 key（配合 `continuous`）
 * @param {boolean} [opts.continuous] 话题是否与上文连续（`runDirector` 步骤 2 的产物）
 *        🔴 `continuous === false` ⇒ **候选集排除 `currentDim`**
 *        —— 这是把"总监判了连续性却不用它"（19 号文 §5.1 决定性事实 1 / F10）接上的唯一落点。
 * @param {boolean} [opts.generic] 强制走通用维度（与 `plan()` 同语义）
 * @returns {{kind:"novel"|"generic"|"noise"|"none", dims:Array<{key,label,reason,score}>,
 *            reason:string, confidence:number, ambiguous:boolean, extent:"full"|"partial",
 *            signal:"label"|"dir"|"brief"|"full"|"none", excluded:string[]}}
 */

import * as SD from "./split-dimensions.js";

/* ══════════════════════════════════════════════════════════════════
 * 一、显式全量信号（**词组**，不是单字）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 「我要求走全套流程」的显式词组。
 * 🔴 必须是**词组**：单字/单字组合会误伤（"全"字见 19 号文 N1 反例逐字）。
 * 🔴 只在**确为小说场景**时才生效（见 `planAttribution`）：否则「端到端测试」这类
 *    通用说法会命中 `端到端` ⇒ 在一个非小说需求上返回 8 个小说维度。
 */
export const FULL_SIGNALS = Object.freeze([
	"全流程", "整个流程", "整套流程", "全量", "全部维度", "所有维度", "全维度",
	"八个维度", "8个维度", "8 个维度", "八条线", "从设定到正文", "从世界观到正文"
]);

/* ══════════════════════════════════════════════════════════════════
 * 二、词表派生（**唯一来源 = SPLIT_DIMENSIONS**）
 * ══════════════════════════════════════════════════════════════════ */

/** 去掉 `A1 ` 这类工序前缀（label 形如 `A1 世界观` ⇒ `世界观`） */
const LABEL_PREFIX_RE = /^[A-Za-z]{1,3}\d+\s*/;
/** 目录名去掉 `01-` / `08_` 这类排序前缀 */
const DIR_PREFIX_RE = /^\d+[-_]/;
/** 中文/英文标点清洗（brief 切出来的段可能带尾巴括号） */
const EDGE_PUNCT_RE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu;

/**
 * 从维度定义派生判定词表（纯函数）。
 *
 * 🔴 派生源与理由（**每一路都有它不可替代的作用**，删任一路都会掉命中率）：
 *   · `label`（`A1 世界观` → `世界观`）—— 用户最常说这个词，**最强信号**；
 *   · `files` 的**目录名** —— 用户会用目录名指代（"改 05-正文 里的东西"）；
 *     ⚠️ `files` 是"该维度**读**哪些目录 + **写**哪个目录"，因此**下游维度会带上游的目录**
 *     （`prose.files` 含 `04-人物档案/`）⇒ 目录命中**必须弱于 label 命中**（见文件头规则 3）；
 *   · `brief` 的分句（按 `/`、`、`、`，` 切）—— 覆盖"润色 / 关系网 / 支线"这类
 *     **只有职责描述里才有**的说法（用户就是照着技能表说话的）；
 *     ⚠️ 超过 12 字的整句**丢弃**（那不是"词"，用户不会原样念一句话）。
 *
 * @param {Array} dims 维度表（默认 `SPLIT_DIMENSIONS`）
 * @returns {Array<{key:string,label:string,stage:number,labelTerm:string,dirTerms:string[],briefTerms:string[]}>}
 */
export function deriveDimensionTerms(dims) {
	const list = Array.isArray(dims) && dims.length ? dims : SD.SPLIT_DIMENSIONS;
	const out = [];
	for (let i = 0; i < list.length; i++) {
		const d = list[i] && typeof list[i] === "object" ? list[i] : {};
		const label = String(d.label == null ? "" : d.label);
		const labelTerm = label.replace(LABEL_PREFIX_RE, "").trim();
		const files = Array.isArray(d.files) ? d.files : [];
		const dirTerms = [];
		for (let j = 0; j < files.length; j++) {
			const seg = String(files[j] == null ? "" : files[j]).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
			const t = seg.replace(DIR_PREFIX_RE, "").replace(/^_+/, "").trim();
			if (t.length >= 2 && dirTerms.indexOf(t) < 0) dirTerms.push(t);
		}
		/* 🔴 `ownDir` = **files 的末项**（= 该维度的**产出**目录；技能约定"读前面的、写最后一个"）。
		 * 它必须与 `dirTerms` 分开记，因为两件事完全不同：
		 *   · 命中**别人的读目录** ⇒ 理应被分级压掉（`prose` 要读 `04-人物档案/`，
		 *     否则「补充人物档案」会连正文分支一起派）；
		 *   · 命中**自己的产出目录** ⇒ 用户**真的在说这个维度**（见 `ambiguous` 判据）。
		 * 第一版把两者混为一谈 ⇒ `AT-9c/9d` 抓出「世界观和力量体系一起改」被误判歧义
		 * （`plot` 因读 `01-世界观/` 而命中、被压 ⇒ 触发歧义）。 */
		const lastSeg = files.length
			? String(files[files.length - 1] == null ? "" : files[files.length - 1])
				.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || ""
			: "";
		const ownDir = lastSeg.replace(DIR_PREFIX_RE, "").replace(/^_+/, "").trim();
		const briefTerms = [];
		const parts = String(d.brief == null ? "" : d.brief).split(/[\/、，,；;·|]/);
		for (let j = 0; j < parts.length; j++) {
			const t = String(parts[j] == null ? "" : parts[j]).replace(EDGE_PUNCT_RE, "").trim();
			if (t.length >= 2 && t.length <= 12 && briefTerms.indexOf(t) < 0) briefTerms.push(t);
		}
		out.push({
			key: String(d.key == null ? "" : d.key),
			label: label,
			stage: Number(d.stage) || 0,
			labelTerm: labelTerm,
			dirTerms: dirTerms,
			ownDir: ownDir,
			briefTerms: briefTerms
		});
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、打分与分级
 * ══════════════════════════════════════════════════════════════════ */

/** 三级信号的权重（label > dir > brief —— 分量级，不是微调） */
export const TERM_WEIGHT = Object.freeze({ label: 3, dir: 2.5, brief: 1 });

/** 单维度打分（纯函数） */
function scoreOf(low, t) {
	let score = 0;
	let labelHit = 0;
	let dirHit = 0;
	let ownHit = 0;
	let briefHit = 0;
	const reasons = [];
	if (t.labelTerm.length >= 2 && low.indexOf(t.labelTerm.toLowerCase()) >= 0) {
		labelHit += 1; score += TERM_WEIGHT.label; reasons.push("标签「" + t.labelTerm + "」");
	}
	for (let i = 0; i < t.dirTerms.length; i++) {
		if (low.indexOf(t.dirTerms[i].toLowerCase()) >= 0) {
			dirHit += 1; score += TERM_WEIGHT.dir; reasons.push("目录「" + t.dirTerms[i] + "」");
			/* 命中**自己的产出目录** ⇒ 单独记（它是"用户真的在说这个维度"的证据） */
			if (t.ownDir && t.dirTerms[i] === t.ownDir) ownHit += 1;
		}
	}
	for (let i = 0; i < t.briefTerms.length; i++) {
		if (low.indexOf(t.briefTerms[i].toLowerCase()) >= 0) {
			briefHit += 1; score += TERM_WEIGHT.brief; reasons.push("职责「" + t.briefTerms[i] + "」");
		}
	}
	return {
		score: Math.round(score * 100) / 100,
		labelHit: labelHit, dirHit: dirHit, ownHit: ownHit, briefHit: briefHit, reasons: reasons
	};
}

/** 置信度：0.5 起步（"命中"本身已是一个信号）+ 分数加成；多维度略降（选项多了更难确定） */
function confidenceOf(signal, topScore, n) {
	if (signal === "none") return 0.35;
	if (signal === "full") return 0.9;
	const base = 0.5 + Math.min(0.45, topScore / 10);
	return Math.round(Math.min(0.95, n >= 2 ? base - 0.05 : base) * 100) / 100;
}

/* ══════════════════════════════════════════════════════════════════
 * 四、主入口
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 归属判定（纯函数，见文件头契约）。
 * @param {string} text
 * @param {object} [opts]
 * @returns {object}
 */
export function planAttribution(text, opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const src = String(text == null ? "" : text).trim();
	const excluded = [];

	/* ── 规则 1：空 / 噪声 ⇒ 什么都不建（保留既有行为） ────────────── */
	if (!src) {
		return done("none", [], "需求文本为空 ⇒ 无归属", 0, false, "partial", "none", excluded);
	}
	const nr = SD.noiseReasonOf(src);
	if (nr) {
		return done("noise", [], "未识别到可执行需求（" + nr + "）⇒ 不建任何分支", 0.95, false, "partial", "none", excluded);
	}

	const novel = o.generic ? false : SD.isNovelIntent(src);
	const pool = novel ? SD.SPLIT_DIMENSIONS : SD.GENERIC_DIMENSIONS;

	/* ── 规则 7（前半）：非小说场景 ⇒ 通用三段（不做维度词表匹配） ────
	 * 🔴 为什么非小说**不**做词匹配：通用维度只有 `方案/执行/验证`，
	 *    拿它们去匹配任意文本必然零命中或误命中；而"通用任务"本身的三段分法
	 *    就是既有行为（第 16 批定的），保留它才不会让老判据变红。 */
	if (!novel) {
		const dims = SD.GENERIC_DIMENSIONS.map((d) => ({
			key: d.key, label: d.label, score: 0, reason: "通用场景 ⇒ 按通用三段分线"
		}));
		return done("generic", dims, "非小说场景 ⇒ 按通用三段分线（方案 / 执行 / 验证）",
			confidenceOf("none", 0, dims.length), false, "partial", "none", excluded);
	}

	/* ── 规则 5：显式全量（仅小说场景；词组匹配，见 FULL_SIGNALS 注释） ── */
	const low = src.toLowerCase();
	for (let i = 0; i < FULL_SIGNALS.length; i++) {
		if (low.indexOf(String(FULL_SIGNALS[i]).toLowerCase()) >= 0) {
			const dims = SD.SPLIT_DIMENSIONS.map((d) => ({
				key: d.key, label: d.label, score: 0,
				reason: "显式全量信号「" + FULL_SIGNALS[i] + "」⇒ 全套 A1–A8"
			}));
			return done("novel", dims, "命中显式全量信号「" + FULL_SIGNALS[i] + "」⇒ 走全套 A1–A8",
				confidenceOf("full", 0, dims.length), false, "full", "full", excluded);
		}
	}

	/* ── 规则 2/3/4：词表打分 + 信号分级 ─────────────────────────── */
	const terms = deriveDimensionTerms(pool);
	const scored = [];
	for (let i = 0; i < terms.length; i++) {
		const s = scoreOf(low, terms[i]);
		if (s.score <= 0) continue;
		scored.push({
			key: terms[i].key, label: terms[i].label, stage: terms[i].stage,
			score: s.score, reason: s.reasons.join("；"),
			labelHit: s.labelHit, dirHit: s.dirHit, ownHit: s.ownHit, briefHit: s.briefHit
		});
	}

	const byLabel = scored.filter((x) => x.labelHit > 0);
	const byDir = scored.filter((x) => x.labelHit === 0 && x.dirHit > 0);
	const byBrief = scored.filter((x) => x.labelHit === 0 && x.dirHit === 0 && x.briefHit > 0);
	const signal = byLabel.length ? "label" : (byDir.length ? "dir" : (byBrief.length ? "brief" : "none"));
	let picked = byLabel.length ? byLabel : (byDir.length ? byDir : byBrief);

	/* ── 规则 7（后半）：零命中 + 小说场景 ⇒ 8 维（保留既有行为） ────
	 * 🔴 这是**保守**选择：用户说了"小说"但没说哪个维度 ⇒ 按技能 A1–A8 分线；
	 *    绝不判噪声（"没说维度" ≠ "没有内容"），也不降到 3 维（那会丢工序）。 */
	if (!picked.length) {
		const dims = SD.SPLIT_DIMENSIONS.map((d) => ({
			key: d.key, label: d.label, score: 0,
			reason: "仅命中小说场景、未指明维度 ⇒ 按 A1–A8 分线（既有行为，保守不误杀）"
		}));
		return done("novel", dims, "命中小说场景但未指明维度 ⇒ 按 A1–A8 全量分线（保守：宁可多派一条，也不漏掉用户没说出口的维度）",
			confidenceOf("none", 0, dims.length), false, "partial", "none", excluded);
	}

	/* ── 规则 6 的输入之一（19 号文 N9 / F10）：不连续 ⇒ 排除当前维度 ──
	 * 说明：这一步在**分级之后**做，而不是在打分时做 —— 否则"命中当前维度"这条
	 * 事实会在排序前就消失，`excluded` 也就无从如实上报（纪律 19：降级可以，无声不行）。 */
	const ex = new Set();
	if (Array.isArray(o.excludeKeys)) {
		for (let i = 0; i < o.excludeKeys.length; i++) ex.add(String(o.excludeKeys[i]));
	}
	if (o.continuous === false && o.currentDim) ex.add(String(o.currentDim));
	if (ex.size) {
		const kept = [];
		for (let i = 0; i < picked.length; i++) {
			if (ex.has(picked[i].key)) { excluded.push(picked[i].key); continue; }
			kept.push(picked[i]);
		}
		picked = kept;
		if (!picked.length) {
			return done("none", [],
				"命中的维度只有当前维度（" + excluded.join("、") + "），且判定话题不连续 ⇒ 无归属，不派发",
				0, false, "partial", signal, excluded);
		}
	}

	/* ── 排序：分数降序，同分按工序 stage 升序（保证同输入必同输出）── */
	picked.sort((a, b) => (b.score - a.score) || (a.stage - b.stage));

	/* ── 规则 6：歧义 = **有候选被信号分级压制，且它与入选者工序相邻** ──────
	 * 🔴 第一版写法是"入选 ≥2 且存在相邻 stage" —— 被 `AT-9a` 抓出**设计错误**：
	 *    用户明确列举两个维度时（「世界观和力量体系一起改」「审查和蒸馏都要」）
	 *    两个都会入选 ⇒ 用户已经说清楚了 ⇒ 再标歧义只会让他多点一次确认。
	 *    真正的歧义是另一件事：**某个维度也命中了，却被分级规则压掉** ——
	 *    此时"用户到底要哪一个"是**规则替他做的决定**，而相邻工序（上游 ↔ 下游）
	 *    尤其危险：「正文润色」里入选的是 `prose`（标签「正文」），被压掉的 `polish`
	 *    恰恰命中「润色」这个**动作** ⇒ 用户很可能要的就是后者。 */
	const pickedKeys = new Set();
	for (let i = 0; i < picked.length; i++) pickedKeys.add(picked[i].key);
	const dropped = scored.filter((x) => !pickedKeys.has(x.key));
	/* 🔴 被压候选必须分两类（这是 `AT-9c/9d` 抓出的**第二个**设计错误）：
	 *   · **仅靠"别人的读目录"命中** ⇒ 分级压得对，**不算歧义**
	 *     （`plot` 因要读 `01-世界观/` 而在「世界观和力量体系一起改」里命中 —— 压掉它是对的）；
	 *   · **命中自己的产出目录 / 自己的职责词** ⇒ 用户**可能在说它**
	 *     （「正文和风格语料都要改」里被压的 `polish`，命中的正是它的产出目录 `07-风格语料/`）。 */
	const risky = dropped.filter((x) => x.ownHit > 0 || x.briefHit > 0);
	let crossStage = false;
	for (let i = 0; i < risky.length && !crossStage; i++) {
		for (let j = 0; j < picked.length; j++) {
			if (Math.abs((risky[i].stage || 0) - (picked[j].stage || 0)) === 1) { crossStage = true; break; }
		}
	}
	const ambiguous = risky.length > 0 && picked.length > 0 && crossStage;

	const dims = picked.map((x) => ({ key: x.key, label: x.label, score: x.score, reason: x.reason }));
	const why = dims.map((d) => d.label + "（" + d.reason + "）").join("；");
	const droppedNote = ambiguous
		? " ⚠️ 另有相邻工序维度也被命中、但被规则压制：" + risky.map((d) => d.label).join("、")
			+ " ⇒ 需用户确认（不得静默选一个）"
		: "";
	return done("novel", dims,
		"命中小说场景 ⇒ 归属 " + dims.length + " 个维度：" + why + droppedNote,
		confidenceOf(signal, dims[0].score, dims.length), ambiguous, "partial", signal, excluded);
}

/** 统一出口（保证返回体形状恒定 —— 调用方无需做 undefined 防御） */
function done(kind, dims, reason, confidence, ambiguous, extent, signal, excluded) {
	return {
		kind: kind, dims: dims, reason: reason,
		confidence: confidence, ambiguous: ambiguous, extent: extent, signal: signal,
		excluded: (excluded || []).slice()
	};
}

/**
 * 归属判定的**一句话读数**（纯函数，供总监页常驻读数用 —— 19 号文 N8）。
 * 🔴 与判定同源：读数不是"另算一遍"，就是判定的输出 ⇒ 读数与判定不可能不一致。
 * @param {object} att `planAttribution()` 的返回
 * @returns {string}
 */
export function attributionSummary(att) {
	const a = att && typeof att === "object" ? att : {};
	if (a.kind === "noise") return "归属：噪声 ⇒ 未建分支";
	if (a.kind === "none") return "归属：无（" + String(a.reason || "") + "）";
	if (!Array.isArray(a.dims) || !a.dims.length) return "归属：无";
	const labels = a.dims.map((d) => d.label).join(" + ");
	/* 🔴 措辞更正（N8 接线时发现）：这里原本写「**通道**」，而 N8 的常驻读数里
	 *    "通道"指的是**路由通道**（`local` / `transfer`，见 `routing.js#DESTINATION`）。
	 *    同一个词在一行读数里指两件事 ⇒ 用户必然读错（"通道局部"是什么？）。
	 *    ⇒ 本字段改称「**范围**」（`extent`：局部 / 全量 / 待确认），
	 *      "通道" 一词**只留给路由**。改的是文案，不是语义（`extent` 取值一字未动）。 */
	return "归属 " + labels + " · 置信 " + Number(a.confidence || 0).toFixed(2)
		+ " · 范围" + (a.ambiguous ? "待确认" : (a.extent === "full" ? "全量" : "局部"));
}
