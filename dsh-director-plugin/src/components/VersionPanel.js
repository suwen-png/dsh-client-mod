/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：版本历史面板（"不同版本的选择"）
 * 引用：2026-09-12 诉求 10（不同版本的选择）
 * 上游：components/DesignStudio.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 E4（版本历史面板）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/VersionPanel.js — 版本历史面板（"不同版本的选择"）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 E · 版本与保存】
 *  上游     components/DesignStudio.js（顶栏「版本 ▾」按钮拉起本面板）
 *  下游     store/design.js  listVersions / restoreVersion / deleteVersion
 *
 * ══════════════════════════════════════════════════════════════════
 *  它解决什么（用户原话）
 * ══════════════════════════════════════════════════════════════════
 *  「也没有保存 和不同版本的选择」
 *
 *  关键区分（这也是设计图能"指着说"的前提）：
 *    自动落盘代数 revision ≠ 用户保存的版本。
 *    revision 是 605 这种数字（拖一下就 +1），它答不了「回到刚才那个布局」。
 *    本面板列的是**用户显式保存过的**版本，每条带**说明文本** ——
 *    于是沟通可以变成「回到『底栏加高』那版」，而不是「回到第 3 个」。
 *
 * ══════════════════════════════════════════════════════════════════
 *  两条安全设计
 * ══════════════════════════════════════════════════════════════════
 *   ① 回滚是**破坏性**操作：面板顶部常显提示"回滚会先把当前样子自动存一份"，
 *      且 store 层 `restoreVersion` 真的会存（不是文案）。用户看得见才有信心点。
 *   ② 删除版本用**文字按钮**而非图标 ✕ —— 它与「回到此版」在同一行，
 *      图标按钮容易被误点成回滚（两者都会改变列表，但后果差一个量级）。
 */

import * as react from "react";

const h = react.createElement;

/* ── 局部样式（与 DesignStudio 同一套 design token；不跨文件共享 S，避免耦合） ── */
const V = {
	panel: {
		position: "absolute", top: 44, zIndex: 10, width: 340, maxHeight: "58vh",
		display: "flex", flexDirection: "column",
		background: "var(--dsw-alias-bg-base, #17181c)", color: "var(--dsw-alias-label-primary, #e8eaed)",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 8,
		boxShadow: "0 14px 40px rgba(0,0,0,.55)", overflow: "hidden", fontSize: 11.5
	},
	head: { display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderBottom: "1px solid #26282e" },
	body: { flex: 1, minHeight: 0, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 4 },
	foot: { padding: "7px 10px", borderTop: "1px solid #26282e", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.5 },
	row: {
		display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6,
		border: "1px solid transparent", background: "rgba(255,255,255,.03)"
	},
	tag: {
		fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, padding: "1px 6px", borderRadius: 4,
		background: "rgba(137,87,229,.18)", border: "1px solid rgba(137,87,229,.45)", color: "#b794f6", whiteSpace: "nowrap"
	},
	note: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
	meta: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", whiteSpace: "nowrap" },
	btn: {
		height: 24, padding: "0 8px", borderRadius: 5, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
		color: "var(--dsw-alias-label-secondary, #c3c8ce)"
	},
	btnDel: {
		height: 24, padding: "0 7px", borderRadius: 5, cursor: "pointer", fontSize: 11, whiteSpace: "nowrap",
		border: "1px solid rgba(248,81,73,.4)", background: "rgba(248,81,73,.12)", color: "#f0877f"
	},
	empty: { padding: "18px 12px", textAlign: "center", color: "var(--dsw-alias-label-tertiary, #8b9199)", lineHeight: 1.7 }
};

/** 版本时间显示：同一天只显时分，跨天补月-日（列表里最常看的是"刚才那版"，时分最有用） */
function fmtTime(ts) {
	if (!ts) return "—";
	try {
		const d = new Date(ts);
		const now = new Date();
		const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
		const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
		if (sameDay) return hm;
		return (d.getMonth() + 1) + "-" + d.getDate() + " " + hm;
	} catch (e) { return "—"; }
}

/**
 * @param {object}   props
 * @param {object}   props.doc        当前设计图
 * @param {Array}    props.versions   版本摘要列表（**新的在前**，来自 listVersions）
 * @param {boolean}  props.open
 * @param {number}   props.inset      窗口控件安全区宽度（面板右对齐时要躲开原生按钮）
 * @param {Function} props.onClose
 * @param {Function} props.onRestore  (vid) => void
 * @param {Function} props.onDelete   (vid) => void
 * @param {number}   [props.limit]    版本上限（提示用）
 */
export function VersionPanel({ doc, versions, open, inset, onClose, onRestore, onDelete, limit }) {
	if (!open) return null;

	const list = Array.isArray(versions) ? versions : [];
	const cap = Number(limit || 30);
	const rightPx = Math.max(10, Number(inset || 0) + 8);

	return h("div", {
		style: { ...V.panel, right: rightPx },
		"data-testid": "ds-ver-panel", role: "dialog", "aria-label": "版本历史"
	}, [
		h("div", { key: "hd", style: V.head }, [
			h("span", { key: "t", style: { fontWeight: 650 } }, "🕘 版本历史"),
			h("span", { key: "c", style: V.meta, "data-testid": "ds-ver-count" }, "共 " + list.length + " / " + cap + " 个"),
			h("button", {
				key: "x", style: { ...V.btn, marginLeft: "auto" }, "data-testid": "ds-ver-close",
				"aria-label": "关闭版本历史", onClick: onClose
			}, "✕")
		]),

		list.length
			? h("div", { key: "bd", style: V.body, "data-testid": "ds-ver-list" },
				list.map((v) => h("div", { key: v.vid, style: V.row, "data-testid": "ds-ver-row", "data-vid": v.vid }, [
					h("span", { key: "l", style: V.tag }, v.label),
					h("span", { key: "n", style: V.note, title: v.note || "（未写说明）" }, v.note || "（未写说明）"),
					h("span", { key: "m", style: V.meta }, v.count + " 元素 · " + fmtTime(v.savedAt)),
					h("button", {
						key: "r", style: V.btn, "data-testid": "ds-ver-restore", "data-vid": v.vid,
						title: "把图的内容换成这一版（当前样子会先自动存一份）",
						onClick: () => onRestore && onRestore(v.vid)
					}, "回到此版"),
					h("button", {
						key: "d", style: V.btnDel, "data-testid": "ds-ver-del", "data-vid": v.vid,
						title: "删除这个版本记录（不影响当前图的内容）",
						onClick: () => onDelete && onDelete(v.vid)
					}, "删除")
				])))
			: h("div", { key: "em", style: V.empty, "data-testid": "ds-ver-empty" }, [
				h("div", { key: "a" }, "还没有保存过版本"),
				h("div", { key: "b", style: { marginTop: 4 } }, "顶栏点【保存】会把当前这张图存成一个版本，")
			]),

		h("div", { key: "ft", style: V.foot },
			"回滚会把图的内容换成所选版本；当前样子会**先自动存一份**（说明写「回滚前自动存档」），不会丢。")
	]);
}
