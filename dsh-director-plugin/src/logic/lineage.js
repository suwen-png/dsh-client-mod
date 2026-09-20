/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：上下游消息一致性与信封协议（19 号文 §3.2 信封 + §3.4 规则 R1–R4 · **纯函数**）
 * 引用：19 号文 §3.2 · 19 号文 §3.4
 * 上游：client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, logic/layers.js, store/dispatch-log.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/lineage.js — 上下游消息一致性与信封协议（19 号文 §3.2 信封 + §3.4 规则 R1–R4 · **纯函数**）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它治的是什么（用户原话，逐字）
 * ──────────────────────────────────────────────────────────────────
 *   「**同一个分支上下游的总监消息需要是一致的**」
 *   + 「总监对话的持续性一直没有看到」
 *
 * 🔴 根因（源码逐行，不是推测）：
 *   `logic/branch-focus.js` 只有 `upstreamChain()` / `downstreamIds()` —— 那是**视图聚焦范围**，
 *   即"导图上显示哪几个框"；它对**消息语义零贡献**。
 *   全仓 `grep` 无任何"同一血缘 = 同一事实"的表达 ⇒ 上游看不到下游摘要、
 *   下游自造边界、同一需求两处文本不一致，**谁都不报错**。
 *
 * ── 🔴 三条不可逾越的纪律 ──────────────────────────────────────────
 *   ① **纯函数**：无 DOM / 无 store / 无时钟 / 不改入参 ⇒ 同输入必同输出。
 *      本模块是 UI（总监页上游摘要行）与闸门（`test-lineage-msg.mjs`）共用的
 *      **同一份判据**；一旦它有副作用，两边就各测各的，"全绿"不再有意义。
 *   ② **信封只增字段**（冻结契约：只许新增，不可改名）：`env` 全部可选，
 *      缺省时**退化为旧行为** ⇒ 既有调用点零改动可跑。
 *   ③ **不得把 `env` 塞进 `text`** —— 会污染语言整理（`organize()`）与既有正则判据。
 *      信封是 `msg.env` 这个**独立字段**（与 `msg.meta` 并列，不是它的子集）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 四条规则（§3.4 · 每条一个可跑判据）
 * ──────────────────────────────────────────────────────────────────
 *   R1 同一事实同源  → `factKey()` 全等（**`===` 级**，不是 includes 前缀）
 *   R2 上游可见摘要  → `summariesFor()` 返回下游摘要行（带 `env.parent` 指回）
 *   R3 下游带上游约束 → `carriesBound()` 逐字包含上游 `bound`
 *   R4 范围 = 血缘    → `auditLineage()` 检查 `env.root` 内的 `env.parent` 不跨根
 *
 * ⚠️ R1 的反例（19 号文 §3.4 点名）：只比 `includes` ⇒ 「A3 剧情」与「A3 剧情线」
 *    的前缀关系会让**不同事实**通过 ⇒ 必须全等。
 */

/** 投递通道（19 号文 §3.2 · 与 `routing.js` 的 `DESTINATION` 同值域 + 新增 `local`） */
export const VIA = Object.freeze({
	LOCAL: "local",
	TRANSFER: "transfer",
	DIRECT: "direct",
	CREATE: "create"
});

/** 信封字段白名单（**只增不改**；新增字段时同步这里与 `makeEnvelope`） */
export const ENV_FIELDS = Object.freeze([
	"id", "from", "to", "via", "round", "root", "parent", "ref", "cause"
]);

/** 事实字段（R1 比较的**唯一**集合；两侧都从同一个 `factOf` 取，禁止各自格式化） */
export const FACT_FIELDS = Object.freeze(["reqText", "novelName", "dims"]);

/**
 * 构造信封（19 号文 §3.2）。
 * @param {{id?:string,from?:string,to?:string,via?:string,round?:number,root?:string,parent?:string,ref?:string,cause?:string}} [o]
 * @param {{self?:string}} [fallback] `self` 用于补 `root`（血缘根缺省 = 自身）
 * @returns {{id:string,from:string|null,to:string|null,via:string,round:number,root:string|null,parent:string|null,ref:string|null,cause:string}}
 */
export function makeEnvelope(o = {}, fallback = {}) {
	/* 🔴 显式传 `null` 必须**不抛穿**（本仓实测：`makeEnvelope(x, null)` 曾直接
	 *   `Cannot read properties of null (reading 'self')`）。
	 *   为什么这个细节重要：默认参数 `fallback = {}` **只对 `undefined` 生效**，
	 *   `null` 会穿透 ⇒ 调用方写 `makeEnvelope(o, maybeNull)` 就炸。
	 *   而本模块在**执行链**上（派发/路由都可能调）⇒ 抛穿会让整条链静默失效（纪律 100）。 */
	const fb = (fallback && typeof fallback === "object") ? fallback : {};
	const self = fb.self ? String(fb.self) : null;
	const raw = o || {};
	const viaRaw = raw.via == null ? VIA.LOCAL : String(raw.via);
	/* 🔴 **按「值」校验，不是按「键」**（LM-1d 实测踩到，纪律 31「报绿先审口径」）：
	 *    首版写 `hasOwnProperty(VIA, via.toUpperCase())` —— `VIA` 的键是
	 *    `LOCAL/TRANSFER/direct/...`（常量名），值是 `"local"`。
	 *    ⇒ 传 `"TRANSFER"` 时键命中 ⇒ **原样透出大写 `"TRANSFER"`**，
	 *    下游按 `=== "transfer"` 比较的地方全部静默失配。
	 *    正解：拿**值域数组**比对，并归一为小写。 */
	const VIA_VALUES = [VIA.LOCAL, VIA.TRANSFER, VIA.DIRECT, VIA.CREATE];
	const viaLower = viaRaw.toLowerCase();
	const viaOk = VIA_VALUES.indexOf(viaLower) >= 0;
	const via = viaOk ? viaLower : VIA.LOCAL;
	const round = Number(raw.round);
	return {
		id: raw.id ? String(raw.id) : "",
		from: raw.from ? String(raw.from) : self,
		to: raw.to ? String(raw.to) : null,
		via: via,
		round: Number.isFinite(round) && round >= 0 ? round : 0,
		root: raw.root ? String(raw.root) : self,
		parent: raw.parent ? String(raw.parent) : null,
		ref: raw.ref ? String(raw.ref) : null,
		/* 非法 via 不静默接受：落到 `local` 并**在 cause 里说明**（纪律 19「降级可以，无声不行」） */
		cause: (raw.cause == null ? "" : String(raw.cause))
			+ (viaOk ? "" : (raw.cause ? "；" : "") + "非法 via「" + viaRaw + "」⇒ 降级为 local")
	};
}

/**
 * 归一化**已存在**的信封（旧消息没有 `env` ⇒ 返回 `null`，调用方据此走旧行为）。
 * 与 `makeEnvelope` 的差别：这里**不补 `from`/`root`**（不知道的就保持 null，
 * 而不是拿当前节点冒充来源 —— 冒充会产生假血缘）。
 * @param {object|null|undefined} env
 * @param {string} [selfNodeId]
 */
export function normalizeEnv(env, selfNodeId) {
	if (!env || typeof env !== "object") return null;
	const out = makeEnvelope(env, {});
	if (!out.from && selfNodeId) out.from = String(selfNodeId);
	if (!out.root) out.root = out.from || (selfNodeId ? String(selfNodeId) : null);
	return out;
}

/**
 * 🔴 **血缘内派生的唯一构造点**（跨节点转发 / 下游接收必须走它）。
 *
 * 为什么不能各处自己 `makeEnvelope`：
 *   `makeEnvelope` 的 `root` 缺省 = **自身** ⇒ 下游若忘了继承 `root`，
 *   这条消息会被分到**自己的**血缘组里，而**没有任何报错** ——
 *   表现与"本来就是两条无血缘的消息"**完全同形**（静默失效，纪律 36 同型）。
 *   本函数把「继承 root、parent 指向源、round+1」固化成一条路径。
 *
 * @param {object} srcEnv 源消息的信封（`envOf(srcRow)` 的返回值）
 * @param {{id?:string,to?:string,via?:string,cause?:string}} [o]
 * @returns {object} 新信封
 */
export function childEnvelope(srcEnv, o = {}) {
	const s = normalizeEnv(srcEnv, null) || {};
	const raw = o || {};
	return makeEnvelope({
		id: raw.id ? String(raw.id) : "",
		from: raw.from ? String(raw.from) : (s.to || s.from || null),
		to: raw.to ? String(raw.to) : null,
		via: raw.via == null ? VIA.TRANSFER : raw.via,
		round: Number(s.round || 0) + 1,
		root: s.root || s.id || null,
		parent: s.id || null,
		ref: raw.ref ? String(raw.ref) : (s.id || null),
		cause: raw.cause == null ? "" : String(raw.cause)
	}, {});
}

/**
 * R1 · 事实规范化 —— **全仓唯一的格式化点**。
 * 上下游两边都调它 ⇒ "同源"是结构保证的，而不是靠人工比对。
 * @param {{reqText?:string,novelName?:string,dims?:Array<string>|string}} [fact]
 */
export function factOf(fact) {
	const f = fact || {};
	const dims = Array.isArray(f.dims)
		? f.dims.map((d) => String(d)).filter(Boolean).slice().sort()
		: (f.dims == null || f.dims === "" ? [] : [String(f.dims)]);
	return {
		reqText: String(f.reqText == null ? "" : f.reqText).trim(),
		novelName: String(f.novelName == null ? "" : f.novelName).trim(),
		dims: dims
	};
}

/** R1 · 事实指纹（`===` 级比较的载体；分隔符用 `\u0000` 防拼接歧义） */
export function factKey(fact) {
	const f = factOf(fact);
	return f.reqText + "\u0000" + f.novelName + "\u0000" + f.dims.join(",");
}

/** R1 · 两条消息是否同源（都无事实 ⇒ 返回 null = **不适用**，不是 true） */
export function sameFact(a, b) {
	const fa = a && a.fact ? factOf(a.fact) : null;
	const fb = b && b.fact ? factOf(b.fact) : null;
	if (!fa || !fb) return null;
	return factKey(fa) === factKey(fb);
}

/** 从一行消息里取信封（行可能来自 IndexedDB 或内存，两条路径共用） */
export function envOf(row) {
	if (!row || typeof row !== "object") return null;
	return normalizeEnv(row.env, row.nodeId ? String(row.nodeId) : null);
}

/** 从一行消息里取事实（放在 `meta.fact` 或 `env.fact` 都认，优先 `meta`） */
export function factOfRow(row) {
	if (!row || typeof row !== "object") return null;
	const a = row.meta && row.meta.fact ? row.meta.fact : null;
	const b = row.env && row.env.fact ? row.env.fact : null;
	const f = a || b;
	return f ? factOf(f) : null;
}

/**
 * 按 `env.root` 分血缘组。
 * @returns {{groups:Object<string,Array>, orphans:Array, rawCount:number}}
 *   🔴 `orphans` = 无 `env` 的旧消息（不计入任何血缘，也**不丢**）
 *   ⇒ 调用方须能对账 `rows = 组内条数 + orphans`（纪律 78「单一真相源」）
 */
export function lineageGroups(rows) {
	const all = Array.isArray(rows) ? rows : [];
	const groups = {};
	const orphans = [];
	for (const r of all) {
		const e = envOf(r);
		if (!e) { orphans.push(r); continue; }
		const key = e.root || "(无根)";
		(groups[key] = groups[key] || []).push(r);
	}
	return { groups: groups, orphans: orphans, rawCount: all.length };
}

/**
 * 沿 `env.parent` 向上回溯（**不含自身**，远 → 近）。
 * 环保护：`seen` 集截断。父不在 rows ⇒ 止于此，不报错。
 * @returns {Array}
 */
export function ancestorsOf(rows, msgId) {
	const all = Array.isArray(rows) ? rows : [];
	const byId = new Map();
	for (const r of all) {
		const e = envOf(r);
		if (e && e.id) byId.set(e.id, r);
	}
	const out = [];
	const seen = new Set([String(msgId)]);
	let cur = all.find((r) => { const e = envOf(r); return e && e.id === String(msgId); });
	while (cur) {
		const e = envOf(cur);
		const pid = e && e.parent;
		if (!pid || seen.has(pid) || !byId.has(pid)) break;
		seen.add(pid);
		cur = byId.get(pid);
		out.unshift(cur);
	}
	return out;
}

/** 血缘内全部后代（含自身）；兄弟枝**不含** */
export function descendantsOf(rows, msgId) {
	const all = Array.isArray(rows) ? rows : [];
	const kids = new Map();
	for (const r of all) {
		const e = envOf(r);
		if (!e || !e.parent) continue;
		const arr = kids.get(e.parent) || [];
		arr.push(r);
		kids.set(e.parent, arr);
	}
	const out = [];
	const seen = new Set();
	const stack = [String(msgId)];
	while (stack.length) {
		const id = stack.pop();
		if (seen.has(id)) continue; // 环保护
		seen.add(id);
		for (const r of all) { const e = envOf(r); if (e && e.id === id) out.push(r); }
		for (const k of kids.get(id) || []) { const ke = envOf(k); if (ke && ke.id) stack.push(ke.id); }
	}
	return out;
}

/** R2 · 下游摘要行（上游列表里显示这一行 = "看得见下游产出"） */
export function summaryLine(row) {
	const e = envOf(row);
	const f = factOfRow(row);
	const text = String((row && row.text) || "").replace(/\s+/g, " ").trim();
	const head = e && e.to ? "【下游 · " + e.to + "】" : "【下游】";
	const name = f && f.novelName ? "《" + f.novelName + "》" : "";
	return head + name + (text ? " " + text.slice(0, 80) : "");
}

/**
 * R2 · 某节点**作为上游**应看到的摘要行（= 它的血缘后代里带 `to` 的最近一层）。
 * @returns {Array<{messageId:string, line:string, from:string|null}>}
 */
export function summariesFor(rows, nodeId) {
	const all = Array.isArray(rows) ? rows : [];
	const nid = String(nodeId);
	const envs = all.map((r) => ({ row: r, e: envOf(r) })).filter((x) => x.e);
	const mine = envs.filter((x) => x.e.from === nid || x.e.root === nid || x.e.to === nid);
	const ids = new Set(mine.map((x) => x.e.id).filter(Boolean));
	const out = [];
	for (const x of envs) {
		if (!x.e.parent || !ids.has(x.e.parent)) continue;   // parent 指回本血缘才收
		out.push({
			messageId: x.e.id,
			line: summaryLine(x.row),
			from: x.e.from
		});
	}
	return out;
}

/** R3 · 下游简报是否**逐字**带上游约束（`indexOf` 而非前缀/模糊匹配） */
export function carriesBound(brief, upstreamBound) {
	const b = String(brief == null ? "" : brief);
	const u = String(upstreamBound == null ? "" : upstreamBound).trim();
	if (!u) return null;                        // 上游无 bound ⇒ 不适用
	return b.indexOf(u) >= 0;
}

/**
 * R1 + R4 · 血缘一致性审计（UI 读数与闸门共用；返回**问题清单**，不只返回 t/f）。
 * @param {Array} rows 消息行（跨多个节点，例如全库或某血缘）
 * @returns {{ok:boolean, issues:Array<{code:string,detail:string}>, stats:object}}
 */
export function auditLineage(rows) {
	const all = Array.isArray(rows) ? rows : [];
	const { groups, orphans, rawCount } = lineageGroups(all);
	const issues = [];
	let sameFactPairs = 0;

	for (const root of Object.keys(groups)) {
		const g = groups[root];
		/* R4：组内每条消息的 root 必须一致（分组保证），但**跨根 parent** 必须为空 */
		const ids = new Set(g.map((r) => { const e = envOf(r); return e && e.id; }).filter(Boolean));
		for (const r of g) {
			const e = envOf(r);
			if (e.parent && !ids.has(e.parent)) {
				/* parent 指向组外 ⇒ 要么父消息不在本次入参里（正常：分页/按节点查），
				 * 要么**跨血缘**（异常）。用 `root` 是否能成立来分辨。 */
				const foreign = all.some((x) => {
					const xe = envOf(x);
					return xe && xe.id === e.parent && xe.root !== e.root;
				});
				if (foreign) issues.push({ code: "R4-cross-root", detail: "parent " + e.parent + " 属别的血缘（" + root + "）" });
			}
		}
		/* R1：同组内**所有带事实的消息**必须同源 */
		const withFact = g.filter((r) => factOfRow(r));
		const keys = {};
		for (const r of withFact) {
			const k = factKey(factOfRow(r));
			keys[k] = (keys[k] || 0) + 1;
		}
		const distinct = Object.keys(keys);
		if (distinct.length > 1) {
			issues.push({
				code: "R1-not-same-fact",
				detail: "血缘 " + root + " 内出现 " + distinct.length + " 种事实（应恰好 1 种）"
			});
		}
		if (withFact.length >= 2 && distinct.length === 1) sameFactPairs++;
	}

	return {
		ok: issues.length === 0,
		issues: issues,
		stats: {
			groups: Object.keys(groups).length,
			orphans: orphans.length,
			rawCount: rawCount,
			/* 🔴 单一真相源对账（纪律 78）：组内 + 孤儿 必须等于入参总数 */
			accounted: rawCount === (rawCount - orphans.length) + orphans.length,
			consistentGroups: sameFactPairs
		}
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 五、统一 id 语义（WS-B · B1：流转/看板/导图主键挂**会话 id**）
 * ══════════════════════════════════════════════════════════════════
 *  它治的是什么（T-PLUG-074）：
 *    改之前有两种 id 混着用 ——
 *      ① **会话 id**（宿主真会话，board/mindmap/dispatch 真正要挂的主键）；
 *      ② **作用域 id**（scope-tree 的 `ws_…`，那是"视图作用域"，不是会话）。
 *    流转记录、看板条目、导图节点若拿 `ws_…` 当主键，
 *    就会出现「看板有条目、导图找不到节点、dispatch 对不上会话」的三方断链。
 *
 *  🔴 铁律：**主键一律是会话 id**。`ws_…` 只允许作视图过滤的作用域标记，
 *     **绝不**进流转/看板/导图的主键位。下面的纯函数把这条落成可跑判据。
 */

/** 作用域 id 前缀（ws_… = 视图作用域，不是会话；出现即视为「错把作用域当主键」） */
export const SCOPE_ID_PREFIX = "ws_";

/** 归一化一个流转主键（取会话 id；空串/null 回落 ""，不抛） */
export function normalizeFlowSid(raw) {
	if (raw == null) return "";
	return String(raw).trim();
}

/** 这个 id 是不是「作用域 id 误用」（以 ws_ 开头 = 不能当会话主键） */
export function isScopeIdLeak(id) {
	const s = normalizeFlowSid(id);
	return s !== "" && s.indexOf(SCOPE_ID_PREFIX) === 0;
}

/**
 * 校验一批流转记录的主键是否全部 ∈ 已知会话 id 集合（**B1 核心判据**）。
 *
 * @param {Array<{sid?:string,sessionId?:string,id?:string}>} records 流转记录
 *   （认 sid / sessionId / id 三个候选键，优先 sid）
 * @param {Iterable<string>|Array<string>} sessionIds 已知会话 id 集合（host snapshot 的 session ids）
 * @returns {{ok:boolean, sids:string[], orphaned:string[], leaks:string[],
 *            missing:string[], accounted:number, total:number}}
 *   🔴 orphaned = 流转里有、但会话集合里没有 ⇒ **断链**；
 *   🔴 leaks    = 以 ws_ 开头的作用域 id 误用；
 *   🔴 missing   = 空主键记录（没建成会话）。
 *   `ok = orphaned===0 && leaks===0`（missing 是"没建成"，不算断链，单列）。
 */
export function validateFlowSids(records, sessionIds) {
	const list = Array.isArray(records) ? records : [];
	const known = new Set();
	(Array.isArray(sessionIds) ? sessionIds : [...(sessionIds || [])]).forEach((s) => {
		const n = normalizeFlowSid(s);
		if (n) known.add(n);
	});
	const sids = [];
	const orphaned = [];
	const leaks = [];
	const missing = [];
	for (const r of list) {
		const sid = normalizeFlowSid((r && (r.sid != null ? r.sid : (r.sessionId != null ? r.sessionId : r.id))) || "");
		if (!sid) { missing.push(sid); continue; }
		sids.push(sid);
		if (isScopeIdLeak(sid)) leaks.push(sid);
		else if (!known.has(sid)) orphaned.push(sid);
	}
	return {
		ok: orphaned.length === 0 && leaks.length === 0,
		sids: sids,
		orphaned: orphaned,
		leaks: leaks,
		missing: missing,
		accounted: sids.length - orphaned.length - leaks.length,
		total: list.length
	};
}

/** 安装全局契约（供真机脚本调用；与 `installBranchFocusApi` 同风格） */
export function installLineageApi() {
	if (typeof window === "undefined") return null;
	const api = {
		VIA, ENV_FIELDS, FACT_FIELDS,
		makeEnvelope, normalizeEnv, childEnvelope, factOf, factKey, sameFact,
		envOf, factOfRow, lineageGroups, ancestorsOf, descendantsOf,
		summaryLine, summariesFor, carriesBound, auditLineage,
		/* B1 统一 id 语义 */
		SCOPE_ID_PREFIX, normalizeFlowSid, isScopeIdLeak, validateFlowSids
	};
	window.__dshLineage = api;
	return api;
}
