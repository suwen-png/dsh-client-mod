/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：三层职责边界 + 跨层消息信封（**纯函数**：无 DOM / 无 store / 无副作用）
 * 引用：—
 * 上游：client-entry.js
 * 下游：logic/roles.js, logic/lineage.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/layers.js — 三层职责边界 + 跨层消息信封（**纯函数**：无 DOM / 无 store / 无副作用）
 *
 * ── 为什么单独一层（WS-B · B6）─────────────────────────────────────
 *   最高权重需求：「插件只执行，模型做语义判断」。但"谁能把活派给谁"
 *   是一条**结构铁律**，不能让模型自由发挥 —— 否则会出现「执行层反过来
 *   指挥治理层」「合规层直接改产出」这种架构倒灌。
 *
 *   改之前：`roles.js` 里有 `LAYER` 词汇表（governance/orchestration/
 *   execution/compliance）和每个角色的 `layer` 字段，但**没有任何函数**
 *   回答「从 X 层派到 Y 层合不合法」「一条跨层消息的信封长什么样」。
 *   ⇒ 本模块把这条铁律收成**唯一真相源**的纯函数。
 *
 * ── 复用（纪律 126：同一语义只一处实现）─────────────────────────────
 *   · 层词汇 `LAYER` / `LAYERS` 来自 `roles.js`（不另造）；
 *   · 信封 `makeEnvelope` / `childEnvelope` / `normalizeEnv` 来自 `lineage.js`
 *     （跨层信封 = 信封协议 + 一个 `layer` 元字段，不新发明一套信封格式）。
 *
 * ── 🔴 三条硬边界 ────────────────────────────────────────────────
 *   · 零 DOM / 零 localStorage（离线单测裸跑）；
 *   · 复用层词汇与信封协议，不重定义；
 *   · `replayLayerChain` 纯函数可回放（同输入必同输出），闸门据此验四层链。
 */

import { LAYER, LAYERS, layerOf } from "./roles.js";
import { makeEnvelope, childEnvelope, normalizeEnv } from "./lineage.js";

/* 透传层词汇（复用 roles.js，不另造；闸门与 UI 从本模块一处拿全） */
export { LAYER, LAYERS, layerOf };

/* ══════════════════════════════════════════════════════════════════
 * 一、派任边界（谁能把活派给谁）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 合法派任目标表（层 → 允许派到的层）。
 * 🔴 execution/compliance 无出边：执行层不往上派（它是干活的尽头），
 *    合规层只读不派（它验收，不指挥）。
 */
export const DELEGATE_TARGETS = Object.freeze({
	[LAYER.GOVERNANCE]: [LAYER.ORCHESTRATION, LAYER.EXECUTION],
	[LAYER.ORCHESTRATION]: [LAYER.EXECUTION],
	[LAYER.EXECUTION]: [],
	[LAYER.COMPLIANCE]: []
});

/**
 * 从 fromLayer 派到 toLayer 合不合法。
 * @returns {{ok:boolean, reason:string}}
 */
export function canDelegate(fromLayer, toLayer) {
	const f = layerOf(fromLayer).key;
	const t = layerOf(toLayer).key;
	if (f === t) return { ok: false, reason: layerOf(f).label + " 不能派到自己（同层不跨层）" };
	const allowed = DELEGATE_TARGETS[f] || [];
	if (!allowed.includes(t)) {
		return {
			ok: false,
			reason: layerOf(f).label + " 无权派到 " + layerOf(t).label
				+ "（允许：" + (allowed.map((x) => layerOf(x).label).join("、") || "无") + "）"
		};
	}
	return { ok: true, reason: layerOf(f).label + " → " + layerOf(t).label };
}

/** 某角色属于哪一层（从角色表查；角色表 = roles.js 的 BUILTIN_ROLES 同形） */
export function layerOfRole(roleId, rolesTable) {
	const id = String(roleId || "");
	const table = Array.isArray(rolesTable) ? rolesTable : [];
	for (let i = 0; i < table.length; i++) {
		const r = table[i];
		if (r && (r.id === id || r.name === id)) {
			/* 命中 ⇒ 返回与 layerOf 同形的层对象，外加 unknown:false */
			const hit = layerOf(r.layer || LAYER.GOVERNANCE);
			return Object.assign({}, hit, { unknown: false });
		}
	}
	/* 查不到 ⇒ 回落治理层（不抛；调用方可据 unknown:true 发现"未知角色"） */
	return Object.assign({}, layerOf(LAYER.GOVERNANCE), { unknown: true });
}

/* ══════════════════════════════════════════════════════════════════
 * 二、跨层消息信封（复用 lineage 信封协议 + layer 元字段）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 构造一条跨层消息信封。
 *
 * 🔴 不新发明信封格式：在 lineage 的 `makeEnvelope` 之上加一个 `layer` 字段
 *   （fromLayer/toLayer），`round` 仍表示血缘代数。这样跨层消息与血缘消息
 *   共用同一条 `envOf` 解析路径，闸门和 UI 不用维护两套格式。
 *
 * @param {{fromLayer?:string,toLayer?:string,id?:string,to?:string,via?:string,cause?:string}} o
 * @param {object} [srcEnv] 源消息信封（有则继承 root/parent/round）
 * @returns {{env:object, fromLayer:string, toLayer:string, ok:boolean, reason:string}}
 */
export function buildCrossLayerEnvelope(o = {}, srcEnv) {
	const raw = o && typeof o === "object" ? o : {};
	const fromLayer = layerOf(raw.fromLayer || (srcEnv && srcEnv.fromLayer) || LAYER.GOVERNANCE).key;
	const toLayer = layerOf(raw.toLayer || LAYER.EXECUTION).key;
	const chk = canDelegate(fromLayer, toLayer);
	const base = srcEnv
		? childEnvelope(srcEnv, { id: raw.id, to: raw.to, via: raw.via, cause: raw.cause })
		: makeEnvelope({ id: raw.id, to: raw.to, via: raw.via, cause: raw.cause }, { self: raw.id });
	const env = Object.assign({}, base, { fromLayer, toLayer });
	return { env, fromLayer, toLayer, ok: chk.ok, reason: chk.ok ? chk.reason : chk.reason };
}

/** 从一行消息里取跨层信封（行可能来自 IndexedDB 或内存，两条路径共用） */
export function layerEnvOf(row) {
	if (!row || typeof row !== "object") return null;
	const env = normalizeEnv(row.env, row.nodeId ? String(row.nodeId) : null);
	if (!env) return null;
	/* 🔴 normalizeEnv 只保留 lineage 白名单字段（ENV_FIELDS），会剥掉
	 *    fromLayer/toLayer —— 这两个字段必须从**原始** row.env 直读，
	 *    否则跨层信封一解析就丢层（闸门量不到层）。 */
	const rawLayer = (row.env && typeof row.env === "object") ? row.env : {};
	return Object.assign({}, env, {
		fromLayer: rawLayer.fromLayer ? String(rawLayer.fromLayer) : null,
		toLayer: rawLayer.toLayer ? String(rawLayer.toLayer) : null
	});
}

/* ══════════════════════════════════════════════════════════════════
 * 三、四层链回放（纯函数可回放；闸门据此验「一条活是否走对了层」）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 回放一条跨层调用链。
 *
 * @param {Array<{fromLayer:string,toLayer:string,at?:number,note?:string}>} steps
 *   每一步 = 一次派任。纯函数：不改入参，同输入必同输出。
 * @returns {{steps:Array<{seq:number,fromLayer:string,toLayer:string,ok:boolean,reason:string,at:number,note:string}>,
 *            ok:boolean, violations:number, layersTouched:number}}
 *   🔴 `ok` = **全部步合法**；任一步架构倒灌 ⇒ ok=false，违规步带 reason。
 */
export function replayLayerChain(steps) {
	const list = Array.isArray(steps) ? steps : [];
	const touched = new Set();
	const out = [];
	let violations = 0;
	list.forEach((s, i) => {
		const st = s && typeof s === "object" ? s : {};
		const f = layerOf(st.fromLayer).key;
		const t = layerOf(st.toLayer).key;
		/* 自循环（同层）算违规，但记进回放不抛 */
		const chk = canDelegate(f, t);
		if (!chk.ok) violations++;
		touched.add(f); touched.add(t);
		out.push({
			seq: i + 1,
			fromLayer: f,
			toLayer: t,
			ok: chk.ok,
			reason: chk.reason,
			at: Number.isFinite(Number(st.at)) ? Number(st.at) : 0,
			note: st.note ? String(st.note) : ""
		});
	});
	return {
		steps: out,
		ok: violations === 0,
		violations: violations,
		layersTouched: touched.size
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 四、结构自检（这套边界自己也要被验）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 边界结构自检：
 *   ① 每层的派任目标都是已定义层；
 *   ② execution / compliance 出边必须为 0；
 *   ③ governance 必须能到 orchestration 与 execution（治理是源头）。
 * @returns {{ok:boolean, fails:string[]}}
 */
export function auditLayerBoundaries() {
	const fails = [];
	const validKeys = LAYERS.map((l) => l.key);
	for (const [from, tos] of Object.entries(DELEGATE_TARGETS)) {
		if (!validKeys.includes(from)) fails.push("未知层作为派任源：" + from);
		for (const to of tos) {
			if (!validKeys.includes(to)) fails.push(from + " 派到未定义层：" + to);
		}
	}
	const execTargets = DELEGATE_TARGETS[LAYER.EXECUTION] || [];
	if (execTargets.length > 0) fails.push("执行层不应有派任出边：" + execTargets.join("、"));
	const compTargets = DELEGATE_TARGETS[LAYER.COMPLIANCE] || [];
	if (compTargets.length > 0) fails.push("合规层不应有派任出边：" + compTargets.join("、"));
	const gov = DELEGATE_TARGETS[LAYER.GOVERNANCE] || [];
	if (!gov.includes(LAYER.ORCHESTRATION) || !gov.includes(LAYER.EXECUTION)) {
		fails.push("治理层必须能派到编排层与执行层，实得：" + gov.join("、"));
	}
	return { ok: fails.length === 0, fails: fails };
}

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installLayersApi() {
	if (typeof window === "undefined") return null;
	window.__dshLayers = {
		LAYER, LAYERS, DELEGATE_TARGETS,
		layerOf, canDelegate, layerOfRole,
		buildCrossLayerEnvelope, layerEnvOf,
		replayLayerChain, auditLayerBoundaries
	};
	return window.__dshLayers;
}
