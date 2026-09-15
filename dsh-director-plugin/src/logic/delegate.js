/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：委派模板与上下文装配
 * 引用：—
 * 上游：client-entry.js, components/OrchestratorPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 五（简报四段 · 交接五段 · 上下文裁剪）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/delegate.js — 委派模板与上下文装配
 *
 * ══════════════════════════════════════════════════════════════════
 *  两个问题，一处解决
 * ══════════════════════════════════════════════════════════════════
 *  ① **委派写不清楚**：给子任务的描述只有一句「整理一下这个需求」，
 *     下游就自由发挥。Anthropic 的实测口径是：子 agent 的任务描述必须含
 *     **目标 / 输出格式 / 工具与来源指引 / 明确的任务边界** 四要素，
 *     缺哪一条就在哪一条上跑偏。这是他们提升效果的主要杠杆之一。
 *  ② **上下文全量转发**：把所有历史一股脑塞给下游，是 token 与准确率
 *     **同时**劣化的最常见原因 —— 「lost in the middle」实测：相关内容落在
 *     长 prompt **中部**时性能显著下降，且随上下文变长进一步下降（U 型曲线）。
 *
 *  ⇒ 本文件把「怎么委派」与「给什么上下文」都变成纯函数：
 *     前者产出**四段式简报**，后者只拼 `depends_on` 命中的产出。
 *
 * ══════════════════════════════════════════════════════════════════
 *  交接的三级优先（压缩即交接）
 * ══════════════════════════════════════════════════════════════════
 *   结构化字段  >  摘要  >  原文
 *   原文只在**需要逐字引用或证据核对**时才注入。子 agent 回传的也应是
 *   `{ summary, structured, evidenceRefs }`，长文档留在存储层、只传引用 id。
 *   官方理由：搜索的本质是压缩，子 agent 的价值在于「把最重要的 token
 *   浓缩后交给 lead agent」，而不是把整篇原文搬回来。
 *
 * ⚠️ 本文件**零 import**（同规，便于离线单测）。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、四段式委派模板
 * ══════════════════════════════════════════════════════════════════ */

/** 四段（顺序即推荐书写顺序；缺段会被 validateBriefing 点名） */
export const SECTIONS = Object.freeze(["goal", "outputFormat", "sources", "boundary"]);

export const SECTION_LABEL = Object.freeze({
	goal: "目标",
	outputFormat: "输出格式",
	sources: "可用来源",
	boundary: "任务边界"
});

/** 每段为什么必须存在（缺失时的后果写清楚，避免"补个空标题"） */
export const SECTION_WHY = Object.freeze({
	goal: "不写目标 → 下游按自己的理解做，做完才发现做的是另一件事",
	outputFormat: "不写格式 → 回来一份无法被机器消费的自由文本，下游只能重读全文",
	sources: "不写来源 → 下游凭空编造，或去读它不该读的东西",
	boundary: "不写边界 → 越界改动、顺手重构、改坏没让它碰的文件"
});

/** 段内容最短长度（一个字的「无」不算写清楚） */
export const SECTION_MIN = 4;

/**
 * 组装四段式简报。
 * @param {object} parts { goal, outputFormat, sources, boundary }
 * @param {object} [opts] { title?:string }
 * @returns {string}
 */
export function buildBriefing(parts = {}, opts = {}) {
	const p = parts && typeof parts === "object" ? parts : {};
	const out = [];
	if (opts.title) out.push("# " + String(opts.title));
	for (const k of SECTIONS) {
		const v = p[k];
		out.push("## " + SECTION_LABEL[k]);
		out.push(v == null || String(v).trim() === "" ? "（未提供）" : String(v).trim());
	}
	return out.join("\n");
}

/**
 * 校验简报四段是否都写清了。
 * @returns {{ok:boolean, missing:string[], reasons:string[]}}
 */
export function validateBriefing(parts) {
	const p = parts && typeof parts === "object" ? parts : {};
	const missing = [];
	const reasons = [];
	for (const k of SECTIONS) {
		const v = p[k];
		if (v == null || String(v).trim().length < SECTION_MIN) {
			missing.push(k);
			reasons.push(SECTION_LABEL[k] + "：" + SECTION_WHY[k]);
		}
	}
	return { ok: missing.length === 0, missing, reasons };
}

/* ══════════════════════════════════════════════════════════════════
 * 二、上下文装配（只拼依赖命中的，禁止全量转发）
 * ══════════════════════════════════════════════════════════════════ */

/** 交接内容的三种形态（优先级从高到低） */
export const HANDOFF = Object.freeze({
	STRUCTURED: "structured",
	SUMMARY: "summary",
	RAW: "raw"
});

/**
 * 归一化一条产出记录。
 *
 * 🔴 `raw` 字段**必须显式传**才会被采用 —— 绝不默认把整篇原文带上。
 *    这是本模块的核心防线：默认值决定系统行为，所以默认值必须是「不给」。
 *
 * @param {object} r { stepId?, output?, summary?, structured?, raw?, bytes?, model? }
 * @returns {object}
 */
export function normalizeArtifact(r) {
	const a = r && typeof r === "object" ? r : {};
	const structured = a.structured && typeof a.structured === "object" ? a.structured : null;
	return {
		stepId: a.stepId ? String(a.stepId) : (a.output ? String(a.output) : ""),
		output: a.output ? String(a.output) : "",
		summary: a.summary != null ? String(a.summary) : "",
		structured,
		raw: a.raw != null ? String(a.raw) : null,
		bytes: a.bytes != null ? Number(a.bytes) : null,
		model: a.model ? String(a.model) : "",
		evidenceRefs: Array.isArray(a.evidenceRefs) ? a.evidenceRefs.map(String) : []
	};
}

/**
 * 为某个步骤装配上下文。
 *
 * 命中规则：只取 `depends_on` 里出现的产出（**显式依赖优于隐式全量转发**），
 * 若步骤里用 `{{name}}` 引用了别的产出，也一并纳入（模板即声明）。
 *
 * @param {object} step 归一化前后的步骤
 * @param {Array} artifacts 全部产出记录
 * @param {object} [opts]
 *   { needRaw?:string[], maxBytes?:number, refs?:string[] }
 *   needRaw = 明确要求带原文的产出名（逐字引用 / 证据核对场景）
 * @returns {{text:string, used:string[], skipped:string[], omitted:string[], level:string}}
 */
export function buildContext(step, artifacts = [], opts = {}) {
	const s = step && typeof step === "object" ? step : {};
	const deps = Array.isArray(s.depends_on) ? s.depends_on.map(String) : [];
	/* 模板引用也算依赖声明（{{x}} 出现在 task / condition / acceptance 里） */
	const refs = Array.isArray(opts.refs) ? opts.refs.map(String) : [];
	const wantRaw = new Set(Array.isArray(opts.needRaw) ? opts.needRaw.map(String) : []);
	const maxBytes = Number.isFinite(opts.maxBytes) ? Number(opts.maxBytes) : 0;

	const list = (Array.isArray(artifacts) ? artifacts : []).map(normalizeArtifact);
	const wanted = new Set([...deps, ...refs]);

	const used = [];
	const skipped = [];
	const omitted = [];
	const blocks = [];
	let budget = maxBytes;

	for (const a of list) {
		const key = a.output || a.stepId;
		if (!wanted.has(key) && !wanted.has(a.stepId)) { skipped.push(key); continue; }

		/* 三级优先：结构化 > 摘要 > 原文 */
		let level = HANDOFF.SUMMARY;
		let body = "";

		if (a.structured && !wantRaw.has(key)) {
			level = HANDOFF.STRUCTURED;
			body = "```json\n" + safeJson(a.structured) + "\n```";
		} else if (wantRaw.has(key) && a.raw != null) {
			level = HANDOFF.RAW;
			body = a.raw;
		} else if (a.summary) {
			level = HANDOFF.SUMMARY;
			body = a.summary;
		} else if (a.raw != null) {
			/* 没摘要也没结构化，又不是显式要原文 ⇒ **不放行原文**，只报"缺摘要" */
			omitted.push(key + "（只有原文、无摘要/结构化，且未显式请求原文）");
			continue;
		} else {
			omitted.push(key + "（无任何可用内容）");
			continue;
		}

		if (budget > 0) {
			const len = byteLength(body);
			if (len > budget) {
				omitted.push(key + "（超出剩余预算 " + budget + " B）");
				continue;
			}
			budget -= len;
		}

		used.push(key);
		blocks.push("### " + key + " [" + level + "]\n" + body);
	}

	return {
		text: blocks.length ? blocks.join("\n\n") : "",
		used, skipped, omitted,
		level: blocks.length === 0 ? "none" : (used.length === list.filter((a) => wanted.has(a.output || a.stepId)).length ? "full" : "partial")
	};
}

function safeJson(o) {
	try {
		return JSON.stringify(o, null, 2);
	} catch (e) {
		return "{\"_error\":\"序列化失败：" + String(e && e.message ? e.message : e) + "\"}";
	}
}

function byteLength(s) {
	const t = String(s == null ? "" : s);
	if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(t).length;
	let n = 0;
	for (const ch of t) {
		const c = ch.codePointAt(0);
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
}

/* ══════════════════════════════════════════════════════════════════
 * 三、交接归一（子 agent 回传什么）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 归一化一次交接。用于「子 agent 回传给编排层」的场景。
 *
 * 🔴 三条硬规则（每条都对着一个真实失败模式）：
 *   ① 必须有 summary —— 没有摘要的交接等于把原文搬回来，压缩没发生
 *   ② structured 若给了，必须是对象而不是字符串（字符串本质上还是自由文本）
 *   ③ raw 允许为 null，且**不落进下游上下文**（只留 evidenceRefs 引用）
 *
 * @returns {{ok:boolean, fails:string[], handoff:object, downstreamText:string}}
 */
export function normalizeHandoff(input) {
	const fails = [];
	const a = input && typeof input === "object" ? input : {};
	const summary = a.summary != null ? String(a.summary).trim() : "";
	if (!summary) fails.push("缺 summary：交接必须是压缩后的摘要，不能是原文搬运");

	let structured = null;
	if (a.structured != null) {
		if (typeof a.structured !== "object" || Array.isArray(a.structured)) {
			fails.push("structured 必须是对象（字符串本质上仍是自由文本，下游无法按字段消费）");
		} else {
			structured = a.structured;
		}
	}

	const handoff = {
		stepId: a.stepId ? String(a.stepId) : "",
		output: a.output ? String(a.output) : "",
		summary,
		structured,
		raw: a.raw != null ? String(a.raw) : null,
		bytes: a.raw != null ? byteLength(String(a.raw)) : byteLength(summary),
		model: a.model ? String(a.model) : "",
		evidenceRefs: Array.isArray(a.evidenceRefs) ? a.evidenceRefs.map(String) : []
	};

	const parts = [summary];
	if (structured) parts.push("结构化字段：" + JSON.stringify(structured));
	if (handoff.evidenceRefs.length) parts.push("证据引用：" + handoff.evidenceRefs.join("、"));
	return { ok: fails.length === 0, fails, handoff, downstreamText: parts.join("\n") };
}

/**
 * 估算上下文装配省下了多少（用于 UI 上如实告诉用户「隔离带来了什么」）。
 * 口径：省下 = 全量原文总量 减 实际装配送出的量。
 */
export function contextSaving(artifacts = [], ctx) {
	const all = (Array.isArray(artifacts) ? artifacts : []).map(normalizeArtifact);
	const totalRaw = all.reduce((n, a) => n + (a.raw != null ? byteLength(a.raw) : byteLength(a.summary)), 0);
	const sent = byteLength(ctx && ctx.text ? ctx.text : "");
	return {
		rawBytes: totalRaw,
		sentBytes: sent,
		savedBytes: Math.max(0, totalRaw - sent),
		ratio: totalRaw ? Math.max(0, totalRaw - sent) / totalRaw : 0
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 四、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installDelegateApi() {
	if (typeof window === "undefined") return null;
	window.__dshDelegate = {
		SECTIONS, SECTION_LABEL, SECTION_WHY, HANDOFF,
		buildBriefing, validateBriefing,
		normalizeArtifact, buildContext, contextSaving,
		normalizeHandoff
	};
	return window.__dshDelegate;
}
