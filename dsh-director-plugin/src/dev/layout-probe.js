/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：C1 V9-Design 布局探针
 * 引用：—
 * 上游：client-entry.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * dev/layout-probe.js — C1 V9-Design 布局探针
 *
 * 迁移源：client.js 6545 ~ 6614（70 行）
 *   区块标记：`// ========== V9-Design: 布局探针（让AI能看到页面真实布局） ==========`
 *
 * 职责：让 AI「看见」页面真实布局 —— 遍历 DOM（上限 400 节点）采集几何/层叠信息，
 *      计算重叠对（inter > 30% 较小面积 且 至少一方非 static），输出文本或 JSON。
 *
 * 全局契约：`window.__dshLayoutProbe()` + `.text()` + `.export()`
 *
 * ── 迁移改造（2 处）─────────────────────────────────────────
 * ① `dshProbeCollect()` 的 `build` 字段原读 `DSH_DOCS_INDEX.generatedAt`。
 *    该常量已随 A14 剥离移除 → 改走 `getDocsIndexSync()`（A13 模块），
 *    无索引时回落到同样的 "索引未注入"。
 * ② 本模块为 **dev-only 工具**，建议按 `import.meta.env.DEV` 或宿主开关条件加载，
 *    生产构建可不打包（清单 §一 C 区已标注「可 dev-only 条件加载」）。
 */

/** DOM 遍历节点上限（原实现硬编码 400） */
export const PROBE_MAX_NODES = 400;
/** 重叠判定：交集面积须 > 较小面积的 30%（原实现硬编码 0.3） */
export const PROBE_OVERLAP_RATIO = 0.3;
/** 重叠判定：交集边长须 > 20px（原实现硬编码 20） */
export const PROBE_OVERLAP_MIN_EDGE = 20;
/** 输出 overlaps 上限（原实现硬编码 50） */
export const PROBE_OVERLAP_OUTPUT_LIMIT = 50;

/** 采集页面布局快照 */
export function dshProbeCollect(getDocsIndex) {
	const root = document.querySelector(".director-view") || document.body;
	const items = [];
	const queue = [root];
	let count = 0;
	while (queue.length && count < PROBE_MAX_NODES) {
		const el = queue.shift();
		if (!el || el.nodeType !== 1) continue;
		count++;
		const r = el.getBoundingClientRect();
		if (r.width > 1 && r.height > 1) {
			const cs = window.getComputedStyle(el);
			items.push({
				i: items.length,
				tag: el.tagName.toLowerCase(),
				cls: (el.className && String(el.className).slice(0, 36)) || "",
				txt: (el.childElementCount === 0 ? (el.textContent || "").trim().slice(0, 22) : ""),
				rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
				pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
				disp: cs.display, vis: cs.visibility
			});
		}
		for (let k = 0; k < el.children.length; k++) queue.push(el.children[k]);
	}
	const overlaps = [];
	for (let a = 0; a < items.length; a++) {
		for (let b = a + 1; b < items.length; b++) {
			const A = items[a], B = items[b];
			const ox = Math.min(A.rect[0] + A.rect[2], B.rect[0] + B.rect[2]) - Math.max(A.rect[0], B.rect[0]);
			const oy = Math.min(A.rect[1] + A.rect[3], B.rect[1] + B.rect[3]) - Math.max(A.rect[1], B.rect[1]);
			if (ox > PROBE_OVERLAP_MIN_EDGE && oy > PROBE_OVERLAP_MIN_EDGE) {
				const inter = ox * oy;
				const minArea = Math.min(A.rect[2] * A.rect[3], B.rect[2] * B.rect[3]);
				if (inter > PROBE_OVERLAP_RATIO * minArea && (A.pos !== "static" || B.pos !== "static" || A.z !== "auto" || B.z !== "auto")) {
					overlaps.push({ a: A.i, b: B.i, aDesc: (A.txt || A.cls || A.tag).slice(0, 20), bDesc: (B.txt || B.cls || B.tag).slice(0, 20), aPos: A.pos + "/" + A.z, bPos: B.pos + "/" + B.z });
				}
			}
		}
	}
	// 改造点①：原读 DSH_DOCS_INDEX.generatedAt，现走 A13 模块
	const idx = typeof getDocsIndex === "function" ? getDocsIndex() : null;
	return {
		build: (idx && idx.generatedAt) || "索引未注入",
		ts: new Date().toISOString(),
		viewport: [window.innerWidth, window.innerHeight],
		itemCount: items.length,
		overlapCount: overlaps.length,
		overlaps: overlaps.slice(0, PROBE_OVERLAP_OUTPUT_LIMIT),
		items: items
	};
}

/** 采集并格式化为可读文本 */
export function dshProbeText(getDocsIndex) {
	const s = dshProbeCollect(getDocsIndex);
	const lines = ["DSH-LAYOUT build=" + s.build + " viewport=" + s.viewport.join("x") + " items=" + s.itemCount + " overlaps=" + s.overlapCount];
	for (const o of s.overlaps) lines.push("OVERLAP #" + o.a + "(" + o.aDesc + " " + o.aPos + ") x #" + o.b + "(" + o.bDesc + " " + o.bPos + ")");
	for (const it of s.items) lines.push("#" + it.i + " " + it.tag + " r=[" + it.rect.join(",") + "] " + it.pos + "/" + it.z + (it.txt ? " \"" + it.txt + "\"" : "") + (it.cls ? " ." + it.cls.split(" ")[0] : ""));
	return lines.join("\n");
}

/** 安装全局探针 API */
export function installLayoutProbe(getDocsIndex) {
	if (typeof window === "undefined") return null;
	if (window.__dshLayoutProbe) return window.__dshLayoutProbe;
	window.__dshLayoutProbe = function() { const s = dshProbeCollect(getDocsIndex); console.log("DSH-LAYOUT", s); return s; };
	window.__dshLayoutProbe.text = function() { const t = dshProbeText(getDocsIndex); console.log(t); return t; };
	window.__dshLayoutProbe.export = function() {
		const s = dshProbeCollect(getDocsIndex);
		const blob = new Blob([JSON.stringify(s, null, 1)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "dsh-layout-" + Date.now() + ".json";
		a.click();
	};
	return window.__dshLayoutProbe;
}
