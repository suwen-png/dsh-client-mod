/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：双层验收与评审去偏
 * 引用：—
 * 上游：client-entry.js, components/OrchestratorPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 四（两层验收 · 三态标签 · 成对交换去偏）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/verify.js — 双层验收与评审去偏
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（这是本轮补全里**最重要**的一块）
 * ══════════════════════════════════════════════════════════════════
 *  改之前的「审核」= `director-run.js#reviewOutput(original, output)`：
 *  它审的是**总监自己组装的报文**。产出者与审核者是同一段代码 ⇒
 *  **同源自评** ⇒ 同错同绿。项目纪律 27 早就点破过这件事：
 *  「看起来相等 ≠ 同源：须改一方看另一方是否联动」。
 *
 *  ⇒ 本文件提供三样东西，缺一不可：
 *    ① **机械断言层**（assert）：纯函数、零模型、零网络。跑得最快、判得最硬。
 *    ② **语义评审层**（judge）：交模型，但必须走**去偏协议**。
 *    ③ **合议规则**：两层怎么合成一个结论，以及「判不了」这个第三态怎么表达。
 *
 * ══════════════════════════════════════════════════════════════════
 *  去偏的三条硬约束（每一条都对着一个已量化的偏差）
 * ══════════════════════════════════════════════════════════════════
 *   ① **跨族评审**：同族模型自评有 **10 到 25 个百分点**的自我偏好。
 *      ⇒ `isCrossFamily()` 把「产出族 == 评审族」判为**违规**，不是「建议」。
 *   ② **位置交换**：成对比较有 **10 到 15 分位**的位置偏差，且
 *      「在 prompt 里请求公平」实测效果约等于 0 —— 偏差在自回归解码里，不在 prompt 里。
 *      ⇒ 唯一有效做法是**两个顺序都跑一遍**，结论不一致即判平局。
 *   ③ **FAIL 必须举证**：判失败必须给出 `evidence[]`，无证据一律降级为
 *      CANNOT_JUDGE。否则 judge 会为了「显得在干活」而瞎判。
 *
 *  🔴 顺序不可颠倒：**assert 不过 ⇒ 直接结束，不问模型**。
 *     先问模型再跑断言，等于为一个已经确定的失败付一次模型调用。
 *
 * ⚠️ 本文件**零 import**（与 roles.js / dag.js 同规，便于离线单测）。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、机械断言层（纯函数，不过模型）
 * ══════════════════════════════════════════════════════════════════ */

/** 可用断言字段（与 agency-orchestrator 的 assert 字段同名同义） */
export const ASSERT_KEYS = Object.freeze(["emits_files", "min_bytes", "max_bytes", "matches", "contains"]);

/** UTF-8 字节长度（node 与浏览器通用） */
export function byteLen(s) {
	const t = String(s == null ? "" : s);
	if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(t).length;
	/* 兜底：手算（仅当 TextEncoder 不可用时） */
	let n = 0;
	for (const ch of t) {
		const c = ch.codePointAt(0);
		n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
	}
	return n;
}

/**
 * 数产出里的「文件块」个数。
 * 判据（两条都数，取较大者，兼容两种常见写法）：
 *   ① 显式分隔符 `--- FILE: xxx ---`
 *   ② fenced code block（``` 起止对）
 * @param {string} text
 * @returns {{count:number, by:"marker"|"fence"|"none"}}
 */
export function countFiles(text) {
	const t = String(text == null ? "" : text);
	const markers = [...t.matchAll(/^---\s*FILE:\s*.+?\s*---\s*$/gmi)].length;
	const fences = Math.floor([...t.matchAll(/^\s*```/gm)].length / 2);
	if (markers >= fences && markers > 0) return { count: markers, by: "marker" };
	if (fences > 0) return { count: fences, by: "fence" };
	return { count: 0, by: "none" };
}

/**
 * 跑机械断言。**这是验收的第一道门，且永远先跑。**
 *
 * @param {string} text 产出正文
 * @param {object} spec 断言规格（{ emits_files, min_bytes, max_bytes, matches, contains }）
 * @returns {{ok:boolean, checks:Array<{key,ok,detail}>, fails:string[], grade:string}}
 */
export function runAssert(text, spec) {
	const t = String(text == null ? "" : text);
	const s = spec && typeof spec === "object" ? spec : {};
	const checks = [];
	const push = (key, ok, detail) => checks.push({ key, ok, detail });

	const bytes = byteLen(t);

	if (s.min_bytes != null) {
		const min = Number(s.min_bytes);
		const ok = bytes >= min;
		push("min_bytes", ok, bytes + " B " + (ok ? ">=" : "<") + " 下限 " + min);
	}
	if (s.max_bytes != null) {
		const max = Number(s.max_bytes);
		const ok = bytes <= max;
		push("max_bytes", ok, bytes + " B " + (ok ? "<=" : ">") + " 上限 " + max);
	}
	if (s.emits_files != null) {
		const want = Number(s.emits_files);
		const got = countFiles(t);
		push("emits_files", got.count === want, "实得 " + got.count + "（按 " + got.by + "）· 期望 " + want);
	}
	if (s.contains != null) {
		const list = Array.isArray(s.contains) ? s.contains : [s.contains];
		for (const c of list) {
			const needle = String(c);
			push("contains:" + needle, t.indexOf(needle) >= 0, t.indexOf(needle) >= 0 ? "出现" : "未出现");
		}
	}
	if (s.matches != null && typeof s.matches === "object") {
		for (const [pat, want] of Object.entries(s.matches)) {
			let got = 0;
			let err = "";
			try {
				got = [...t.matchAll(new RegExp(pat, "gm"))].length;
			} catch (e) {
				err = "正则非法：" + (e && e.message ? e.message : String(e));
			}
			push("matches:" + pat, !err && got === Number(want), err || ("命中 " + got + " · 期望 " + Number(want)));
		}
	}

	/* min > max 是规格本身的错，属"标准不可用"，不能算产出不过 */
	const minB = s.min_bytes != null ? Number(s.min_bytes) : null;
	const maxB = s.max_bytes != null ? Number(s.max_bytes) : null;
	if (minB != null && maxB != null && minB > maxB) {
		checks.push({ key: "spec", ok: false, detail: "min_bytes(" + minB + ") > max_bytes(" + maxB + ")：规格本身矛盾" });
	}

	const fails = checks.filter((c) => !c.ok).map((c) => c.key + "（" + c.detail + "）");
	const hasSpec = Object.keys(s).filter((k) => ASSERT_KEYS.includes(k)).length > 0;
	return {
		ok: hasSpec ? fails.length === 0 : true,
		checks, fails,
		grade: "G0",
		note: hasSpec ? "" : "未配置机械断言 → 直接进入语义评审"
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 二、语义评审层（judge）与去偏协议
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 判定三态。
 * 🔴 CANNOT_JUDGE 是**必需**的第三态：证据缺失或矛盾时，
 *    正确结果可能是「不可评级」，而不是低分。没有它，judge 会被迫在
 *    证据不足时瞎判（给出一个看起来有区分度的数字）。
 */
export const LABEL = Object.freeze({
	PASS: "PASS",
	FAIL: "FAIL",
	CANNOT_JUDGE: "CANNOT_JUDGE"
});

/** 模型族：跨族评审是硬约束。取 id 的前缀（deepseek / claude / gpt / qwen ...） */
export function familyOf(model) {
	const m = String(model || "").trim().toLowerCase();
	if (!m) return "unknown";
	if (/^(deepseek|ds)/.test(m)) return "deepseek";
	if (/^(claude|anthropic)/.test(m)) return "anthropic";
	if (/^(gpt|o[1-9]|openai)/.test(m)) return "openai";
	if (/^(qwen|tongyi)/.test(m)) return "qwen";
	if (/^(glm|zhipu|chatglm)/.test(m)) return "zhipu";
	if (/^(gemini|google)/.test(m)) return "google";
	if (/^(llama|meta)/.test(m)) return "meta";
	if (/^(moonshot|kimi)/.test(m)) return "moonshot";
	return m.split(/[-_:/]/)[0] || "unknown";
}

/**
 * 是否跨族。
 * @returns {{ok:boolean, reason:string}} ok:false = **违规**（同族自评）
 */
export function isCrossFamily(producerModel, judgeModel) {
	const a = familyOf(producerModel);
	const b = familyOf(judgeModel);
	if (a === "unknown" || b === "unknown") {
		return { ok: false, reason: "模型族未知（产出 " + a + " / 评审 " + b + "）→ 无法证明跨族，按违规处理" };
	}
	if (a === b) {
		return { ok: false, reason: "同族自评：" + a + " 评 " + b + "（自我偏好偏差 10 到 25 个百分点）" };
	}
	return { ok: true, reason: "跨族：" + a + " 产出 / " + b + " 评审" };
}

/**
 * 校验一条 judge 结论的**结构合法性**。
 * 三条硬规则：
 *   ① label 必须是三态之一
 *   ② 判 FAIL 必须有非空 evidence
 *   ③ evidence 必须是字符串数组（不允许一个自由文本糊过去）
 * @returns {{ok:boolean, fails:string[], normalized:object}}
 */
export function validateJudgment(j) {
	const fails = [];
	const src = j && typeof j === "object" ? j : {};
	const label = String(src.label || "").toUpperCase();
	const ev = src.evidence;

	if (!Object.values(LABEL).includes(label)) fails.push("label 非法（须 PASS / FAIL / CANNOT_JUDGE）：" + (src.label || "(空)"));
	if (ev != null && !Array.isArray(ev)) fails.push("evidence 必须是字符串数组");
	if (Array.isArray(ev) && ev.some((x) => typeof x !== "string")) fails.push("evidence 含非字符串项");

	const evidence = Array.isArray(ev) ? ev.filter((x) => String(x || "").trim()) : [];
	if (label === LABEL.FAIL && evidence.length === 0) {
		fails.push("判 FAIL 但未举证 → 降级为 CANNOT_JUDGE");
	}

	const normalized = {
		label: fails.length && label === LABEL.FAIL ? LABEL.CANNOT_JUDGE : label,
		evidence,
		dim: src.dim ? String(src.dim) : "",
		reason: src.reason ? String(src.reason) : "",
		judgeModel: src.judgeModel ? String(src.judgeModel) : "",
		producerModel: src.producerModel ? String(src.producerModel) : "",
		downgraded: fails.some((f) => f.indexOf("降级") >= 0)
	};

	/* 单一维度原则：一条 judge 只判一个维度（多维度混判 = 一个分数掩盖风险） */
	if (!normalized.dim) fails.push("缺 dim：一条评审只能判一个维度（禁止把准确性、完整性、风格混成一个总分）");

	return { ok: fails.length === 0, fails, normalized };
}

/**
 * 位置交换（pair-with-swap）—— 去位置偏差的唯一有效做法。
 *
 * 🔴 为什么不是「在 prompt 里请评委公平对待」：偏差在自回归解码里，
 *    不在 prompt 里，这类指令实测效果约等于 0。
 *
 * `run(order)` 由调用方提供：接收 `["A","B"]` 或 `["B","A"]`（谁在前），
 * 返回 `{label}`。两次结论**不一致即判平局**（CANNOT_JUDGE），而不是取其一。
 *
 * @param {(order:string[])=>object} run
 * @param {string[]} [pair=["A","B"]]
 * @returns {{label:string, swapped:boolean, flip:boolean, first:object, second:object, reason:string}}
 */
export function pairWithSwap(run, pair = ["A", "B"]) {
	if (typeof run !== "function") return { label: LABEL.CANNOT_JUDGE, swapped: true, flip: false, first: null, second: null, reason: "未提供评审函数" };
	const ctx = pair.slice(0, 2);
	const first = safeRun(run, ctx);
	const second = safeRun(run, [ctx[1], ctx[0]]);
	const a = (first && first.label) || LABEL.CANNOT_JUDGE;
	const b = (second && second.label) || LABEL.CANNOT_JUDGE;
	const flip = a !== b;
	return {
		label: flip ? LABEL.CANNOT_JUDGE : a,
		swapped: true,
		flip,
		first, second,
		reason: flip
			? ("位置交换后结论翻转（" + a + " → " + b + "）⇒ 判平局，说明该次比较受位置偏差影响")
			: ("两个顺序结论一致（" + a + "）")
	};
}

function safeRun(fn, arg) {
	try {
		return fn(arg) || null;
	} catch (e) {
		return { label: LABEL.CANNOT_JUDGE, reason: "评审函数抛错：" + (e && e.message ? e.message : String(e)) };
	}
}

/**
 * 多评委聚合。
 * @param {Array<{label:string}>} votes
 * @param {"all"|"majority"|"any"} [mode="majority"]
 * @returns {{label:string, agree:number, total:number, mode:string}}
 */
export function aggregateVotes(votes, mode = "majority") {
	const list = Array.isArray(votes) ? votes.filter(Boolean) : [];
	const total = list.length;
	if (!total) return { label: LABEL.CANNOT_JUDGE, agree: 0, total: 0, mode };
	let pass = 0, fail = 0, cannot = 0;
	for (const v of list) {
		const l = String(v.label || "").toUpperCase();
		if (l === LABEL.PASS) pass++;
		else if (l === LABEL.FAIL) fail++;
		else cannot++;
	}
	let label;
	if (mode === "all") label = fail === 0 && cannot === 0 ? LABEL.PASS : (fail ? LABEL.FAIL : LABEL.CANNOT_JUDGE);
	else if (mode === "any") label = pass > 0 ? LABEL.PASS : (fail === total ? LABEL.FAIL : LABEL.CANNOT_JUDGE);
	else label = pass >= Math.ceil(total * 0.66) ? LABEL.PASS : (fail >= Math.ceil(total * 0.66) ? LABEL.FAIL : LABEL.CANNOT_JUDGE);

	const agree = Math.max(pass, fail, cannot);
	return { label, agree, total, mode };
}

/**
 * 按风险等级选聚合模式（高风险用全票，普通用多数票）。
 * @param {number} risk 0 到 5
 */
export function modeForRisk(risk) {
	const r = Number(risk);
	if (!Number.isFinite(r)) return "majority";
	if (r >= 4) return "all";
	if (r <= 1) return "any";
	return "majority";
}

/* ══════════════════════════════════════════════════════════════════
 * 三、合议（两层怎么合成一个结论）
 * ══════════════════════════════════════════════════════════════════ */

/** 合议结论 */
export const VERDICT = Object.freeze({
	PASS: "PASS",
	FAIL: "FAIL",
	NEEDS_HUMAN: "NEEDS_HUMAN",   // 判不了 → 交人工（对应 A2A 的 INPUT_REQUIRED）
	INVALID_SPEC: "INVALID_SPEC"  // 规格本身坏了 → 与 FAIL 区分（对应退出码 2）
});

/**
 * 双层合议。
 *
 * 顺序（不可颠倒）：
 *   ① 机械断言 → 不过 ⇒ 直接 FAIL（**不问模型**，省一次调用）
 *   ② 规格矛盾 ⇒ INVALID_SPEC（这不是产出者的错）
 *   ③ 语义评审 → PASS / FAIL / CANNOT_JUDGE
 *   ④ 跨族检查不合格 ⇒ 结论降级为 NEEDS_HUMAN（不采信同族评审）
 *
 * @param {object} p
 * @param {{ok:boolean,fails:string[],checks:Array}} p.assertResult runAssert 的返回
 * @param {object} [p.judgment] validateJudgment 的 normalized
 * @param {{ok:boolean,reason:string}} [p.crossFamily]
 * @returns {{verdict:string, reason:string, evidence:string[], trace:string[]}}
 */
export function decideVerdict({ assertResult, judgment, crossFamily } = {}) {
	const trace = [];
	const evidence = [];

	/* ① 规格自相矛盾：先把这一层摘出来，否则会被读成"产出不合格" */
	const specBad = (assertResult && assertResult.checks || []).find((c) => c.key === "spec" && !c.ok);
	if (specBad) {
		trace.push("规格矛盾 → INVALID_SPEC");
		return { verdict: VERDICT.INVALID_SPEC, reason: specBad.detail, evidence, trace };
	}

	/* ② 机械断言 */
	if (assertResult && assertResult.ok === false) {
		trace.push("机械断言未过（" + assertResult.fails.length + " 项）→ FAIL，不再询问模型");
		return {
			verdict: VERDICT.FAIL,
			reason: "机械断言未过：" + assertResult.fails.join("；"),
			evidence: assertResult.fails.slice(),
			trace
		};
	}
	trace.push("机械断言通过");

	/* ③ 没配机械断言且没有语义评审 ⇒ 无证据可判（**不判通过**） */
	if (!judgment) {
		trace.push("无语义评审结论 → 无证据，不判通过");
		return { verdict: VERDICT.NEEDS_HUMAN, reason: "只有机械断言、无语义评审，证据不足以判通过", evidence, trace };
	}

	/* ④ 跨族检查：不合格则不采信（同族自评） */
	if (crossFamily && crossFamily.ok === false) {
		trace.push("跨族检查未过：" + crossFamily.reason + " → 不采信该评审");
		return {
			verdict: VERDICT.NEEDS_HUMAN,
			reason: "评审与产出同源，结论不可采信：" + crossFamily.reason,
			evidence: judgment.evidence || [],
			trace
		};
	}
	if (crossFamily && crossFamily.ok) trace.push(crossFamily.reason);

	/* ⑤ 语义结论 */
	if (Array.isArray(judgment.evidence)) evidence.push(...judgment.evidence);
	if (judgment.label === LABEL.PASS) {
		trace.push("语义评审 PASS");
		return { verdict: VERDICT.PASS, reason: judgment.reason || "机械断言与语义评审均通过", evidence, trace };
	}
	if (judgment.label === LABEL.FAIL) {
		trace.push("语义评审 FAIL（已举证 " + evidence.length + " 条）");
		return { verdict: VERDICT.FAIL, reason: judgment.reason || "语义评审未通过", evidence, trace };
	}
	trace.push("语义评审 CANNOT_JUDGE → 交人工");
	return { verdict: VERDICT.NEEDS_HUMAN, reason: judgment.reason || "证据不足，无法判定", evidence, trace };
}

/* ══════════════════════════════════════════════════════════════════
 * 四、校准（这套东西自己也要被验）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 判据自检：**用已知答案的样本反跑一遍**。
 * 这不是单元测试的替代品，而是给 UI 用的「这套验收标准现在还有效吗」按钮 ——
 * 换 judge 模型、改 rubric、升小版本都会产生校准漂移（3 到 8 分），
 * 故需要可随时重跑的证据。
 *
 * @param {Array<{name:string, text:string, spec:object, expect:boolean}>} samples
 * @returns {{ok:boolean, total:number, hit:number, misses:Array}}
 */
export function selfCheck(samples) {
	const list = Array.isArray(samples) ? samples : [];
	const misses = [];
	let hit = 0;
	for (const s of list) {
		const r = runAssert(s.text, s.spec);
		if (r.ok === Boolean(s.expect)) hit++;
		else misses.push({ name: s.name, expect: Boolean(s.expect), got: r.ok, fails: r.fails });
	}
	return { ok: misses.length === 0 && list.length > 0, total: list.length, hit, misses };
}

/* ══════════════════════════════════════════════════════════════════
 * 五、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installVerifyApi() {
	if (typeof window === "undefined") return null;
	window.__dshVerify = {
		ASSERT_KEYS, LABEL, VERDICT,
		runAssert, countFiles, byteLen,
		validateJudgment, isCrossFamily, familyOf,
		pairWithSwap, aggregateVotes, modeForRisk,
		decideVerdict, selfCheck
	};
	return window.__dshVerify;
}
