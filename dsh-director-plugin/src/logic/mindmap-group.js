/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：导图分组布局（纯函数：零 import、无 DOM / 无 store / 无时钟）
 * 引用：—
 * 上游：components/MindMap.js
 * 下游：logic/grouping.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/mindmap-group.js — 导图分组布局（纯函数：零 import、无 DOM / 无 store / 无时钟）
 *
 * ══════════════════════════════════════════════════════════════════
 *  它解决什么（用户 2026-09-18 原话）
 * ══════════════════════════════════════════════════════════════════
 *  「按照项目分一个组，不然全堆在一起看看太麻烦了」
 *  「按照项目分组，然后再按照分支同一个分支的一个维度分组」
 *
 *  实测前提（第 37 轮普查，28 条会话）：`splitDim` 命中 **0** 条
 *  ⇒ 「按维度分组」在真实数据上必然落空 ⇒ 必须有**标题兜底**，且兜不住时
 *  如实落在「未分流」桶里（纪律 60「数出 0 ≠ 没有」：落空要看得见，不能悄悄不分组）。
 *
 * ══════════════════════════════════════════════════════════════════
 *  与 `buildBranchTree` 的分工（改这块前先看这条）
 * ══════════════════════════════════════════════════════════════════
 *  `branch-tree.js` 算的是**血缘局部坐标**（x = 深度，y = 父居中后的槽位）。
 *  本文件做的是**后置的分区变换**：把行按 (作品, 维度) 归集，整组平移 y，
 *  并为每个分区产出可渲染的矩形（`sections`）。
 *
 *  🔴 为什么不做进 `buildBranchTree`：血缘是**宿主真值**（`parentSessionId` 由 fork 固化），
 *     分组是**视图组织**，两者正交 —— 一个血缘子树可以跨分区（父在 A 组、子在 B 组）。
 *     把分组揉进树构建会让「血缘错了」与「分组错了」再也分不开。
 *
 *  🔴 `sections` 在界面上**必须 `pointerEvents:none`** —— 分区框是背景，
 *     一旦吃掉指针事件，节点就"拖不动了"，而用户看到的是"有些框能拖有些不能"，
 *     完全不像分组的问题（正是本轮要保住的那条：**所有节点都要能拖**）。
 */

import {
	projectCandidates, projectKeyOf, dimKeyOf, dimOrder, normKey, bookRawOf, dimLabel,
	UNGROUPED, NODIM, FALLBACK_LABEL, GROUP_GEOM
} from "./grouping.js";

/** 分区框最小宽度（节点很少时也不至于缩成一条线） */
const MIN_SECTION_W = 360;

/**
 * 把**用户拖动过的位置**覆盖到分区结果上。
 *
 * 🔴 为什么它必须是一个**独立的后置步骤**，而不是"先把用户位置并进 rows 再分组"
 *    （第 37 轮真机抓到的真缺陷，症状与真因毫无表面关联）：
 *
 *    `buildGroups` 的分区平移是 `shift = cursor - minY`，其中 `minY` 取**组内最小 y**。
 *    若用户位置先并进去：
 *      · 分区内只有一行（或用户拖的正是 `minY` 那行）⇒ `shift = cursor - y`
 *        ⇒ `ny = cursor` —— **用户拖到哪，它就被拉回分区槽位**。
 *        真机读数：拖动目标 `{"l":48,"t":44} → {"l":548,"t":44}`，
 *        X 位移 500 / **Y 位移 0** —— 看上去像"拖拽只响应横向"，其实是 X 分组不动、
 *        Y 被分组吸收（X 与 Y 走的是两条完全不同的路径，所以只有一边坏）。
 *      · 分区内有多个成员 ⇒ 拖一行会改变 `minY` ⇒ `shift` 变化 ⇒
 *        **同组其他成员全部跟着平移**（拖一个动一群）。
 *
 *    ⇒ 顺序铁律：**先在"自动布局"上分区（`buildGroups(baseRows)`），再叠加用户位置**。
 *      这样分区平移量只由自动布局决定 ⇒ 拖动一行不会带动任何其他行，
 *      且单成员分区的拖动被完整保留。
 *
 *    分区框（`sections`）仍按自动布局算 ⇒ 框整齐、稳定；
 *    被拖出框外的节点就**如实显示在框外**（回答"为什么它在框外面"：因为是你拖的），
 *    归位交给「▦ 自动布局」。
 *
 * @param {Array} rows `buildGroups(...).rows` 或未分组时的行（**均须为自动布局行**）
 * @param {object} [posMap] `{ [sessionId]: { x, y } }` 用户位置（画布绝对坐标）
 * @returns {Array} 新数组；命中者带 `moved:true`，未命中者原样返回
 */
export function applyUserPos(rows, posMap) {
	const list = Array.isArray(rows) ? rows : [];
	const map = posMap && typeof posMap === "object" ? posMap : null;
	if (!map) return list;
	return list.map((r) => {
		const p = map[r && r.sessionId];
		if (!p) return r;
		const x = Number(p.x), y = Number(p.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) return r;
		return { ...r, x: Math.max(0, x), y: Math.max(0, y), moved: true };
	});
}

/** 自然序比较（同名时不依赖 Array.sort 的稳定性假设） */
function cmpKey(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 把血缘行按 (作品, 维度) 分区重排 y，并产出分区矩形。
 *
 * 契约：
 *  · **行数守恒** —— 出参 `rows` 与入参逐条同 sessionId、同条数（不丢不重，兜底桶必须接住）
 *  · 组内**相对 y 顺序保持**（分区只平移，不重排组内上下关系）
 *  · 出参行**不修改入参**（新对象），未变化的字段原样带过
 *
 * @param {Array} rows `buildBranchTree().rows`（可已叠加用户拖动位置）
 * @param {object} [opts]
 * @param {string[]} [opts.candidates] 预置候选集（不传则由本批标题推）
 * @param {number} [opts.nodeH] 节点高（不传则从行上取最普遍的 h，最后退回 72）
 * @param {number} [opts.width] 分区框宽
 * @param {object} [opts.dimLabels] 维度键 → 中文显示名（如 `{ chars: "A4 人物" }`）——
 *        由调用方从 `logic/split-dimensions.js` 注入，本模块**不 import 它**
 *        （该文件与 `attribution.js` 互为循环，且本模块签了纯函数零依赖契约）。
 *        不传则退化显示内部键（**调用方必须传**，见 `dimLabel()` 头注）。
 * @returns {{rows:Array, sections:Array, stats:object, height:number}}
 */
export function buildGroups(rows, opts = {}) {
	const list = Array.isArray(rows) ? rows : [];
	if (!list.length) {
		return {
			rows: list, sections: [], height: GROUP_GEOM.top,
			stats: { total: 0, projN: 0, dimN: 0, ungrouped: 0, nodim: 0 }
		};
	}
	const G = GROUP_GEOM;
	const left = G.left;
	const nodeH = Number.isFinite(opts.nodeH) ? opts.nodeH
		: (Number.isFinite(list[0].h) ? list[0].h : 72);

	const cands = Array.isArray(opts.candidates) ? opts.candidates : projectCandidates(list.map((r) => r && r.title));

	/* ── 1. 归集：作品 → 维度 → 行 ───────────────────────────────── */
	const projMap = new Map();
	/** 显示名（key → 原文）：能拿到书名号原文就用原文，否则退回键 */
	const labelMap = new Map();
	for (const r of list) {
		const pk = projectKeyOf(r && r.title, cands);
		const dk = dimKeyOf(r);
		if (pk !== UNGROUPED && !labelMap.has(pk)) {
			const raw = bookRawOf(r && r.title);
			if (raw && normKey(raw) === pk) labelMap.set(pk, raw);
		}
		let p = projMap.get(pk);
		if (!p) { p = { key: pk, items: [], dims: new Map() }; projMap.set(pk, p); }
		p.items.push(r);
		let d = p.dims.get(dk.key);
		if (!d) { d = { key: dk.key, source: dk.source, items: [] }; p.dims.set(dk.key, d); }
		d.items.push(r);
		if (dk.source === "split") d.source = "split";   // 真值优先：任一行为真即标真
	}

	/* ── 2. 排序：作品按规模降序（兜底桶恒最后），维度按自然序 ─────── */
	const projects = Array.from(projMap.values());
	projects.sort((a, b) => {
		if (a.key === UNGROUPED) return 1;
		if (b.key === UNGROUPED) return -1;
		return (b.items.length - a.items.length) || cmpKey(a.key, b.key);
	});
	for (const p of projects) {
		p.dimList = Array.from(p.dims.values()).sort((a, b) => {
			if (a.key === NODIM) return 1;
			if (b.key === NODIM) return -1;
			return (dimOrder(a.key) - dimOrder(b.key)) || cmpKey(a.key, b.key);
		});
	}

	/* ── 3. 分配 y：逐分区平移（组内只平移，不重排） ───────────────── */
	const outRows = [];
	const sections = [];
	const newY = new Map();
	/** 分区框宽：取整幅内容宽度，泳道视觉才整齐（不按组内最右节点收窄） */
	const width = Math.max(Number(opts.width) || 0, MIN_SECTION_W);
	let cursor = G.top;
	let dimN = 0;

	for (const p of projects) {
		const pTop = cursor;
		cursor += G.head;
		/* 只有一个「未分流」子维度 ⇒ 二级标题不提供任何信息，只画项目框（仍产 section 并标 hidden，
		 * 让闸门能分辨"没画"与"没算出来" —— 纪律 58「没跑成 ≠ 失败」同族）。 */
		const showSub = !(p.dimList.length === 1 && p.dimList[0].key === NODIM);
		for (const d of p.dimList) {
			const dTop = cursor;
			if (showSub) cursor += G.subHead;
			let minY = Infinity, maxY = -Infinity;
			for (const r of d.items) {
				const y = Number(r && r.y);
				if (Number.isFinite(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
			}
			if (!Number.isFinite(minY)) { minY = 0; maxY = 0; }
			const shift = cursor - minY;
			for (const r of d.items) {
				const y = Number(r && r.y);
				const ny = Number.isFinite(y) ? Math.round((y + shift) * 10) / 10 : cursor;
				newY.set(r.sessionId, ny);
			}
			cursor += (maxY - minY) + nodeH + G.dimGap;
			const dH = (maxY - minY) + nodeH + G.subHead;   // 含维度标题带
			if (showSub) {
				dimN += 1;
				sections.push({
					kind: "dim", projectKey: p.key, key: d.key,
					label: d.key === NODIM ? FALLBACK_LABEL[NODIM] : dimLabel(d.key, opts.dimLabels),
					source: d.source, count: d.items.length, hidden: false,
					x: left, y: dTop, w: width, h: (maxY - minY) + nodeH + G.pad
				});
			} else {
				sections.push({
					kind: "dim", projectKey: p.key, key: d.key,
					label: d.key === NODIM ? FALLBACK_LABEL[NODIM] : dimLabel(d.key),
					source: d.source, count: d.items.length, hidden: true,
					x: left, y: dTop, w: width, h: (maxY - minY) + nodeH + G.pad
				});
			}
			void dH;
		}
		const pBottom = cursor - G.dimGap;
		sections.push({
			kind: "project", key: p.key,
			label: p.key === UNGROUPED ? FALLBACK_LABEL[UNGROUPED] : (labelMap.get(p.key) || p.key),
			/* `dimsN` = 本项目**实际画出**的二级分区数（0 = 该项目的维度信息为零，不画二级）
			 * ⇒ 让"没画二级"与"算不出二级"在 DOM 上可分（纪律 58：没跑成 ≠ 失败）。 */
			count: p.items.length, hidden: false, dimsN: showSub ? p.dimList.length : 0,
			x: left - G.pad, y: pTop, w: width + G.pad * 2, h: Math.max(pBottom - pTop, nodeH) + G.pad
		});
		cursor += G.projectGap;
	}

	/* 行顺序保持入参顺序（渲染序不变），只换 y */
	for (const r of list) {
		const ny = newY.get(r.sessionId);
		outRows.push(Number.isFinite(ny) ? { ...r, y: ny, groupKey: projectKeyOf(r && r.title, cands) } : r);
	}

	const ungrouped = projMap.has(UNGROUPED) ? projMap.get(UNGROUPED).items.length : 0;
	let nodim = 0;
	for (const p of projects) for (const d of p.dimList) if (d.key === NODIM) nodim += d.items.length;

	return {
		rows: outRows,
		sections,
		height: Math.max(cursor - G.projectGap + G.pad, 0),
		stats: { total: list.length, projN: projects.length, dimN, ungrouped, nodim }
	};
}
