/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：设计图工作室（铺满全屏 · 可拖拽编辑 · 左侧交互逻辑 · 底部专用对话）
 * 引用：V16 诉求 2 · 3 · 5（全屏工作室 / 审美 / 设计图插件）+ 2026-09-12 诉求 8（顶栏功能未实现）· 11（审美完善）
 * 上游：client-entry.js, mount.js
 * 下游：store/design-schema.js, store/design.js, util/debug.js, logic/flow.js, util/safe-area.js, components/VersionPanel.js, components/PersonalizePanel.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 D1–D6（设计图工作室五区）· E1–E2（顶栏四区 / 保存两态）· E5（顶栏避让）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/DesignStudio.js — 设计图工作室（铺满全屏 · 可拖拽编辑 · 左侧交互逻辑 · 底部专用对话）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html  【板块 D】
 *   ├─ D1 全屏工作室布局   → 本文件 DesignStudio（顶栏 / 工具栏 / 左栏 / 画布 / 底栏）
 *   ├─ D2 元素类型库       → store/design-schema.js ELEMENT_KINDS（18 类）
 *   ├─ D3 元素交互逻辑面板 → 本文件 LogicPanel（七元组，可编辑）
 *   ├─ D4 标准框架模板     → store/design-schema.js STANDARD_FRAMES
 *   ├─ D5 元素操作         → store/design.js（纯函数：增删改移缩）
 *   └─ D6 设计图专用对话   → 本文件 ThreadBar（**只处理设计图**，不碰宿主会话）
 *
 *  需求原文（用户）：「在总监页面单独加一个设计图的插件吧，按钮形式 点击铺满全屏，
 *  允许调整修改拖拽增加元素，最下面对话保留，这个对话处理设计图的修订 属于新开的临时对话
 *  只处理设计图，然后每一个元素可以点击 点击在左侧显示交互逻辑」
 *
 * ══════════════════════════════════════════════════════════════════
 *  五块区域与需求的一一对应（改布局时按此表定位）
 * ══════════════════════════════════════════════════════════════════
 *   ┌──────────── 顶栏 TopBar ────────────┐  D1  ：文档切换 / 载入标准框架 / 适应屏幕 / 关闭
 *   ├──── 工具栏 KindBar ─────────────────┤  D2  ：点类型 → 增加元素
 *   ├─ 左栏 ┬────────── 画布 ─────────────┤  D3  ：选中元素的交互逻辑（七元组，可改）
 *   │Logic │   Canvas（拖拽 / 缩放 / 选择）│  D5  ：元素操作
 *   ├───────┴─────────────────────────────┤
 *   └──── 底栏 ThreadBar（设计图专用对话）─┘  D6  ：只处理本图修订
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么"左侧显示交互逻辑"是这个功能的重点（而不是附属）
 * ══════════════════════════════════════════════════════════════════
 *  前面三版设计稿的共同失败点是：**图与逻辑分离**。画了一张图，逻辑写在另一份文档里，
 *  两边靠"请在右区第三栏加个按钮"这种文字对指 —— 一旦改图，逻辑就跟不上。
 *  ⇒ 本组件把逻辑**绑在元素上**：选中即见、改图即改逻辑、导出即带逻辑。
 *  ⇒ 于是设计图本身成为**可执行的规格**，而不是一张需要解读的图片。
 *
 * ⚠️ 构建约束：`react` / `react/jsx-runtime` 为平台冻结模块（ADR-001），构建期外置。
 *    本文件用 `react.createElement`（h）形态，不使用 JSX。
 */

import * as react from "react";
import {
	ELEMENT_KINDS, LOGIC_FIELDS, CANVAS_W, CANVAS_H, kindsByGroup, docStats, VERSION_LIMIT,
	layerOf,
	/* 画面 / 层（2026-09-14 新增 · 需求「元素层层堆叠、不知道该从哪改」） */
	SCREENS, SCREEN_ORDER
} from "../store/design-schema.js";
import {
	getActiveDoc, getState, subscribe, newDoc, saveDoc, deleteDoc, setActiveDoc, listDocs,
	addElement, moveElement, resizeElement, removeElement, duplicateElement, reorderElement,
	updateElement, updateLogic, focusView, loadStandardFrame,
	appendThread, parseDesignCommand, applyOps, DESIGN_ROLE,
	/* 版本快照（2026-09-12 新增 · 用户要求「也没有保存 和不同版本的选择」） */
	saveVersion, listVersions, restoreVersion, deleteVersion,
	renameDoc, duplicateDoc, getVersionState,
	/* 结构视图（2026-09-14 新增 · V20 §B/§D/§E） */
	outlineOf, designStats, layerOverlaps, setElementFlags, setScreenHidden, reorderInScreen,
	toDesignDSL
} from "../store/design.js";
import { dshLog } from "../util/debug.js";
import { flowStore, lastFlowIdFor, flowOrigin, DIM } from "../logic/flow.js";
/* 窗口控件安全区 —— 根治「设计图的关闭按钮和标准软件的关闭按钮重叠了」。
 * 详见 util/safe-area.js 头注（含真机取证的 137px 数字）。 */
import { readInset, watchInset } from "../util/safe-area.js";
import { VersionPanel } from "./VersionPanel.js";
/* 右上角「⚙ 个性化」—— 与总监页 / 总监弹窗 / 分支导图**共用同一个组件、同一份持久化**。
 * 用户原文：「…还有三个插件页面 文字背景，全部找审美重新审核一下质感加上，
 * 同时都在右上角加自定义个性化设定」⇒ 四处必须真的一致，各写一份迟早漂移。 */
import { PersonalizePanel } from "./PersonalizePanel.js";

const h = react.createElement;

/** 工作室根节点 id（真机逐交互脚本的入口锚点，不可改名） */
export const STUDIO_ID = "dsh-design-studio";

/* ══════════════════════════════════════════════════════════════════
 * 分组色板（D2 审美调优 · 2026-09-12）
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它：标准框架一张图铺 20 个元素，原先**全是同一个紫色**
 *  ⇒ 画布上糊成一片，沟通时只能读字指认（"那个…第三个方块"）。
 *  按 `ELEMENT_KINDS[kind].group` 三色区分后，可以直接说「把青色那排按钮右移」。
 *
 *  三个字段的用法（`el()` 里用字符串拼接消费，故 `rgb` 存**不带 alpha 的前缀**）：
 *    base —— 选中态的实色边框（纯色，不用拼）
 *    rgb  —— `"rgba(r,g,b,"` 前缀：拼 `.45)` / `.22)` / `.08)` / `.8)` 得到不同透明度
 *    text —— 块内文字色（比 base 亮，保证 10.5px 小字在深底上可读）
 *
 *  ⚠️ 改这里必须同步 `kglabel` 的取色（工具栏组标题用同一套色 ⇒ 天然图例，
 *     否则用户看到画布有青色却找不到青色按钮从哪来）。
 * ══════════════════════════════════════════════════════════════════ */
const GROUP_COLOR = {
	"结构": { base: "#8957e5", rgb: "rgba(137,87,229,", text: "#c9b6f7" }, // 紫 —— 骨架（窗口/侧栏/分区/面板/画布）
	"控件": { base: "#22a3b8", rgb: "rgba(34,163,184,", text: "#9fe3ef" }, // 青 —— 可点可输入（按钮/输入框/列表/卡片…）
	"语义": { base: "#c9942b", rgb: "rgba(201,148,43,", text: "#efd08a" }  // 金 —— 表达含义（导图节点/连线/浮动按钮组）
};
/** 取分组色（未知分组回落到「结构」，保证永不 undefined 崩溃） */
const gc = (group) => GROUP_COLOR[group] || GROUP_COLOR["结构"];

/* ══════════════════════════════════════════════════════════════════
 * 样式（D1）—— 全部走 Harness 主题变量并给 fallback
 * ══════════════════════════════════════════════════════════════════ */

const S = {
	// 铺满全屏：fixed + inset 0 + 最高层级。用户要求「点击铺满全屏」。
	root: {
		position: "fixed", inset: 0, zIndex: 2147483200, display: "flex", flexDirection: "column",
		/* 🔴 `background` **简写**会把 `background-image` 一起重置为 none ⇒ 个性化面板里选的
		 *    三档纹理（靠 `.dp-textured` 类的 background-image 上色）**一条都显示不出来**，
		 *    用户在面板里点「网格 / 点阵 / 玻璃」看到的是"点了没反应"。
		 *    ⇒ 必须写 `backgroundColor`（长写），让它与类上的 background-image **共存**。
		 *    同一坑在 MindMap / DirectorPage / DirectorDialog 上各有一处，一并修正。 */
		backgroundColor: "var(--dsw-alias-bg-base, #0f1013)",
		color: "var(--dsw-alias-label-primary, #e8eaed)",
		fontFamily: "inherit", fontSize: "calc(12.5px * var(--dp-font, 1))"
	},
	top: {
		display: "flex", alignItems: "center", gap: 8, height: 40, flex: "0 0 40px",
		padding: "0 10px", borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)",
		background: "var(--dsw-alias-bg-sunken, #17181c)"
	},
	topTitle: { fontWeight: 650, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" },
	// 工具栏（D2）：图元按组排布，点击即在画布落一个新元素
	kindBar: {
		display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", padding: "5px 10px",
		borderBottom: "1px solid var(--dsw-alias-border-l2, #31343a)", background: "var(--dsw-alias-bg-sunken, #1a1b20)", flex: "0 0 auto"
	},
	kgroup: { display: "flex", alignItems: "center", gap: 3, paddingRight: 8, marginRight: 4, borderRight: "1px solid #26282e" },
	kglabel: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", marginRight: 2 },
	kbtn: {
		display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 8px", cursor: "pointer",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", borderRadius: 5, fontSize: 11,
		background: "var(--dsw-alias-bg-base, #212429)", color: "var(--dsw-alias-label-secondary, #c3c8ce)", whiteSpace: "nowrap"
	},
	// 中段：左栏 + 画布
	mid: { flex: 1, minHeight: 0, display: "flex" },
	left: {
		width: 268, flex: "0 0 268px", borderRight: "1px solid var(--dsw-alias-border-l2, #31343a)",
		background: "var(--dsw-alias-bg-sunken, #141519)", display: "flex", flexDirection: "column", minHeight: 0
	},
	leftHead: { padding: "8px 10px 6px", borderBottom: "1px solid #26282e", display: "flex", alignItems: "center", gap: 6 },
	leftBody: { flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 9 },
	/* ── 结构大纲（2026-09-14 新增 · V20 §D1）─────────────────────────────
	 * 左栏改成**两段式**：大纲在上（占满可用高度、必要时滚动），逻辑面板在下。
	 * 🔴 为什么不改成 Tab 二选一：既有真机断言（verify-design-studio C9.1）
	 *    要求"选中元素后逻辑面板必须存在"，而选中是随时发生的 ——
	 *    若默认停在"大纲"页签，逻辑面板就不在 DOM 里 ⇒ 每次选中都要先切页签才能改逻辑，
	 *    这是把一次点击的成本从 1 次变成 2 次，且会让既有断言假红。
	 *
	 * 🔴 `flex` 必须写 `"0 1 auto"` + `maxHeight: "50%"`，**不能**写 `"1 1 auto"`：
	 *    写成 `1 1 auto` 时基准是**内容高度**（20 行 ≈ 600px），而逻辑面板的基准是 0，
	 *    于是剩余空间按 grow 平分 ⇒ 大纲吃到 ~657px、逻辑面板只剩 **20px**，
	 *    其内容（609px）被压进一条 20px 的缝里 ⇒ 「复制 / 置顶 / 删除」落在 y≈1308
	 *    （视口高 920）**既看不见也点不到**。
	 *    这不是估算：2026-09-14 真机实测 `ds-dup.y = 1308`、`ds-logic.clientHeight = 20`，
	 *    由 verify-design-studio 的 C7.2 / C17.1 两条同时转红抓到（落点 `landedOn: null`）。
	 *    根因是**用内容高度当基准**，所以修法不是调数字，而是把基准归零、只留一个上限。 */
	outlineWrap: { flex: "0 1 auto", maxHeight: "50%", minHeight: 120, display: "flex", flexDirection: "column", borderBottom: "1px solid #26282e" },
	outlineHead: { padding: "7px 10px 6px", display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" },
	outlineChips: { padding: "0 10px 6px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", flex: "0 0 auto" },
	outlineBody: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 6px 8px", display: "flex", flexDirection: "column", gap: 1 },
	screenRow: {
		display: "flex", alignItems: "center", gap: 5, padding: "4px 6px", marginTop: 3,
		borderRadius: 5, background: "var(--dsw-alias-bg-base, #1c1d21)", border: "1px solid #2b2e34",
		fontSize: 11, fontWeight: 650, cursor: "pointer"
	},
	layerRow: { display: "flex", alignItems: "center", gap: 5, padding: "2px 6px 2px 14px", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)" },
	oRow: {
		display: "flex", alignItems: "center", gap: 5, padding: "3px 6px 3px 20px", borderRadius: 4,
		fontSize: 11, cursor: "pointer", border: "1px solid transparent", whiteSpace: "nowrap", overflow: "hidden"
	},
	oRowGhost: { opacity: 0.45 },
	oRowLocked: { borderColor: "#6b5320", background: "rgba(210,153,34,.10)" },
	oNote: { fontSize: 10.5, padding: "0 6px 2px 34px", color: "var(--dsw-alias-label-tertiary, #6f757d)", lineHeight: 1.4 },
	oAct: {
		display: "inline-flex", alignItems: "center", justifyContent: "center", height: 16, minWidth: 16,
		padding: "0 3px", borderRadius: 3, fontSize: 10.5, cursor: "pointer", flex: "0 0 auto",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
		color: "var(--dsw-alias-label-secondary, #c3c8ce)"
	},
	oActOn: { borderColor: "#6b5320", background: "rgba(210,153,34,.18)", color: "#e0b341" },
	/* 聚焦态：非聚焦画面的元素**只做淡影**且不吃点击（pointerEvents:none）
	 * —— 保留"它们还在那儿"的空间感，同时保证聚焦画面的每个元素都点得中。 */
	elGhost: { position: "absolute", boxSizing: "border-box", pointerEvents: "none", opacity: 0.16, overflow: "hidden" },
	focusSel: {
		height: 22, borderRadius: 5, fontSize: 10.5, padding: "0 4px",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
		color: "var(--dsw-alias-label-secondary, #c3c8ce)"
	},
	lbl: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #8b9199)", letterSpacing: ".3px" },
	field: { display: "flex", flexDirection: "column", gap: 3 },
	fieldLabel: { fontSize: 11, color: "#b794f6", display: "flex", alignItems: "center", gap: 5 },
	fieldHint: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", lineHeight: 1.45 },
	fieldInput: {
		width: "100%", boxSizing: "border-box", minHeight: 26, borderRadius: 5, padding: "4px 7px", fontSize: 11.5,
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #1a1b20)",
		color: "var(--dsw-alias-label-primary, #e8eaed)", fontFamily: "inherit", resize: "vertical"
	},
	// 画布区（D5）
	canvasWrap: { flex: 1, minWidth: 0, position: "relative", overflow: "auto", background: "#0b0c0e" },
	/* 画布底 —— 🔴 网格修复（2026-09-12 审美审核 · 截图取证）：
	 *   原写法 `background: "linear-gradient(#15161a,#15161a), repeating-linear-gradient(…)"`
	 *   是**多层背景简写**，CSS 里**第一层在最上面** —— 而那层是**不透明的 #15161a**
	 *   ⇒ 后面的两条网格渐变层被完全遮死，画布成了一块没有任何刻度的纯色板。
	 *   （名字叫 grid、也确实写了网格代码，但**肉眼永远看不见**，属"看起来做了其实没做"。）
	 *   修正：底色改用 `backgroundColor`（不占层），网格用 `backgroundImage` 排在最上；
	 *   同时把线色从 #1d1f24 提到 #24272e，让 20px 刻度在深底上真的看得见 —— 
	 *   对齐元素时靠的就是这条刻度。 */
	grid: {
		position: "relative", width: CANVAS_W, height: CANVAS_H, margin: "18px auto",
		backgroundColor: "#15161a",
		backgroundImage: "repeating-linear-gradient(0deg, #24272e 0 1px, transparent 1px 20px), repeating-linear-gradient(90deg, #24272e 0 1px, transparent 1px 20px)",
		border: "1px solid #2a2d33", boxShadow: "0 10px 40px rgba(0,0,0,.5)"
	},
	/* 🔴 分组配色（2026-09-12 审美调优）：
	 *   原先所有元素都是同一种紫色 ⇒ 画布上 20 个块**糊成一片**，看不出哪些是骨架、
	 *   哪些是可点的控件、哪些是语义物件，沟通时只能靠读字。
	 *   改为按 ELEMENT_KINDS[kind].group 三色区分（见上方 GROUP_COLOR）：
	 *     结构=紫 / 控件=青 / 语义=金 —— 一眼分组，可以直接说"青色那排按钮"。
	 *   同时 `kind` 参数此前是**传了但没用**（死参数），这里让它真正参与配色。 */
	el: (sel, kind) => {
		const g = gc((ELEMENT_KINDS[kind] || {}).group);
		return {
			position: "absolute", boxSizing: "border-box", cursor: "move", overflow: "hidden",
			border: "1px solid " + (sel ? g.base : g.rgb + ".45)"),
			background: sel ? g.rgb + ".22)" : g.rgb + ".08)",
			color: g.text, borderRadius: 4, padding: "3px 6px", fontSize: 10.5,
			outline: sel ? "2px solid " + g.rgb + ".8)" : "none",
			display: "flex", alignItems: "flex-start", gap: 4, userSelect: "none"
		};
	},
	/* 缩放柄：颜色跟随所属元素分组（选中态用），保证缩放手和块是同一族的视觉 */
	elHandle: (kind) => {
		const g = gc((ELEMENT_KINDS[kind] || {}).group);
		return {
			position: "absolute", right: -1, bottom: -1, width: 10, height: 10, cursor: "nwse-resize",
			background: g.base, borderRadius: "6px 0 3px 0", border: "1px solid #0f1013"
		};
	},
	// 底栏（D6）
	bottom: {
		flex: "0 0 auto", borderTop: "1px solid var(--dsw-alias-border-l2, #31343a)",
		background: "var(--dsw-alias-bg-sunken, #141519)", display: "flex", flexDirection: "column",
		minHeight: 96, maxHeight: 260
	},
	threadHead: { display: "flex", alignItems: "center", gap: 7, padding: "6px 10px", borderBottom: "1px solid #26282e", fontSize: 11 },
	threadBody: { flex: 1, minHeight: 0, overflowY: "auto", padding: "7px 10px", display: "flex", flexDirection: "column", gap: 5 },
	tmsg: (role) => ({
		display: "flex", gap: 6, fontSize: 11.5, lineHeight: 1.55,
		color: role === DESIGN_ROLE.USER ? "#9fc2ff" : "var(--dsw-alias-label-secondary, #c3c8ce)"
	}),
	threadFoot: { display: "flex", gap: 6, alignItems: "center", padding: "7px 10px", borderTop: "1px solid #26282e" },
	input: {
		flex: 1, minWidth: 0, height: 28, borderRadius: 6, padding: "0 9px", fontSize: 11.5, boxSizing: "border-box",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #1a1b20)",
		color: "var(--dsw-alias-label-primary, #e8eaed)"
	},
	btn: {
		height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
		border: "1px solid var(--dsw-alias-border-l2, #3d4148)", background: "var(--dsw-alias-bg-base, #212429)",
		color: "var(--dsw-alias-label-secondary, #c3c8ce)"
	},
	btnPri: { height: 28, padding: "0 12px", borderRadius: "var(--dp-radius-sm, 6px)", cursor: "pointer", fontSize: "calc(11.5px * var(--dp-font, 1))", border: "1px solid var(--dp-ac2, #8957e5)", background: "var(--dp-ac2, #8957e5)", color: "#fff", whiteSpace: "nowrap" },
	btnDanger: { height: 26, padding: "0 10px", borderRadius: "var(--dp-radius-sm, 6px)", cursor: "pointer", fontSize: "calc(11.5px * var(--dp-font, 1))", border: "1px solid rgba(248,81,73,.45)", background: "rgba(248,81,73,.14)", color: "#f0877f", whiteSpace: "nowrap" },
	/* 徽章色 = 强调色。`--dp-ac2-soft/-line` 的默认值就是 `rgba(137,87,229,.16/.45)`
	 * ⇒ 与原先硬写的 `rgba(137,87,229,.16/.4)` 肉眼无差，但从此跟着个性化走。 */
	chip: { fontSize: "calc(10.5px * var(--dp-font, 1))", padding: "2px 7px", borderRadius: "var(--dp-radius-sm, 4px)", background: "var(--dp-ac2-soft, rgba(137,87,229,.16))", border: "1px solid var(--dp-ac2-line, rgba(137,87,229,.4))", color: "#b794f6" },
	/* ── 顶栏四区专用（2026-09-12 顶栏重构）── */
	/** 分区竖线：顶栏从左到右有 4 组动作（身份 / 图管理 / 版本 / 视图），
	 *  没有分隔线时 9 个同款按钮连成一排，看不出"哪几个是一伙的"。 */
	sep: { width: 1, height: 20, background: "var(--dsw-alias-border-l2, #35383f)", margin: "0 2px", flex: "0 0 1px" },
	/** 保存按钮 · 有未保存改动：主色实心 + 前置实心点（最需要被看见的状态） */
	btnSave: {
		height: 26, minWidth: 96, boxSizing: "border-box", textAlign: "center",
		padding: "0 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
		border: "1px solid #8957e5", background: "#8957e5", color: "#fff", fontWeight: 650
	},
	/** 保存按钮 · 已保存：与脏态**同宽同高，仅换色**。
	 *  🔴 `minWidth: 96` 不是审美偏好，是**点击可用性**（用户报「点击都不好用」的元凶之一）：
	 *    第一版只做了"两态共用同一按钮"（避免脏时才出现、把邻居挤走），却**没锁宽度**。
	 *    真机实测：「● 保存」57px / 「✓ 已保存 v3」84px，差 **27px**
	 *    ⇒ 点一下保存，右边 12 个按钮整体横移 27px；用户接着点下一个必然点空，
	 *      主观感受就是"按钮点了没反应 / 点不准"。
	 *    96px ≥ 最长的「✓ 已保存 v30」(90px) ⇒ 两态恒为 96px，零位移。
	 *    判据（可复跑）：scripts/cdp-mouse.mjs sweep ds-top 必须报"顶栏位移 0 个"。 */
	btnSaved: {
		height: 26, minWidth: 96, boxSizing: "border-box", textAlign: "center",
		padding: "0 11px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
		border: "1px solid rgba(63,185,80,.45)", background: "rgba(63,185,80,.12)", color: "#7ee787"
	},
	/** 删除按钮 · 已上膛（第一次点击后 2.5s 内的窗口）：实心红即"这一下真的会删"。
	 *  文字从「删除」换成「确认」—— **同为 2 字且 padding 与 btnDanger 完全一致(0 10px)**。
	 *  🔴 第一版这里写的是 `0 11px`（照抄了普通 btn），真机 sweep 实测上膛瞬间
	 *     后面 8 个按钮右移 **2px**、泄压时再左移 2px ⇒ 正是这 1px×2 的 padding 差。
	 *     这类"差 1-2px"的跳位最阴：肉眼几乎看不出，但用户伸手去点下一个按钮时就是差那么一点。
	 *  既给了肉眼可见的反馈（此前只有 toast，按钮本身毫无变化，用户以为按钮坏了），
	 *  又保证上膛/泄压两个方向都零位移。 */
	btnDangerArmed: {
		height: 26, padding: "0 10px", borderRadius: 6, cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap",
		border: "1px solid #f85149", background: "#f85149", color: "#fff", fontWeight: 650
	},
	/** 重命名输入框：占位与它替换掉的 <select> 同宽，避免提交后布局跳动 */
	nameInput: {
		/* T-A4 修复 C16.4/C16.2：必须 flex:0 0 auto —— select 有此声明保持 200px，
		 * input 缺了它会在顶栏空间紧张时被 flex 压缩到 154px ⇒ 改名切换整栏位移 46px */
		width: 200, flex: "0 0 auto", height: 26, boxSizing: "border-box", padding: "0 8px", fontSize: 11.5, borderRadius: 5,
		border: "1px solid #8957e5", background: "#212429", color: "#e8eaed"
	},
	/** 导出兜底浮层：位于右下、避开顶栏安全区与底栏对话区 */
	exportWrap: {
		position: "fixed", right: 20, bottom: 104, width: 460, maxHeight: 340, zIndex: 2147483300,
		background: "#17181c", border: "1px solid #3d4148", borderRadius: 8, padding: 10,
		display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 10px 30px rgba(0,0,0,.55)"
	},
	exportHead: { fontSize: 11, color: "#9aa0a6", lineHeight: 1.5 },
	exportArea: {
		flex: 1, minHeight: 190, resize: "none", fontSize: 11, lineHeight: 1.5, boxSizing: "border-box",
		background: "#0f1013", color: "#c3c8ce", border: "1px solid #2b2e34", borderRadius: 5, padding: 8,
		fontFamily: "ui-monospace, Menlo, Consolas, monospace"
	},
	muted: { fontSize: 10.5, color: "var(--dsw-alias-label-tertiary, #6f757d)", lineHeight: 1.55 }
};

/* ══════════════════════════════════════════════════════════════════
 * D-ST · 结构大纲（2026-09-14 新增 · V20 §D）
 *
 * 解决的是「元素层层堆叠，我不知道该从哪些部分、按什么顺序去修改」：
 *   ① 层级**看得见** —— 画面 → 层 → 元素三层树，缩进即从属；
 *   ② 元素**点得到** —— 画布上被上层盖住的元素（实测 9/20）在树里一行一个，
 *      点行即选中，不依赖画布命中测试；
 *   ③ 顺序**有名字** —— 画面按重叠序（＝修改顺序）排，层按 base→content→deco 排，
 *      图元行内还能上移/下移。
 * ══════════════════════════════════════════════════════════════════ */

function OutlinePanel({ doc, selected, focusScreen, onFocus, onSelect, onFlags, onReorder, onScreenHidden }) {
	const tree = react.useMemo(() => (doc ? outlineOf(doc) : []), [doc]);
	const stats = react.useMemo(() => (doc ? designStats(doc) : null), [doc]);
	if (!doc || !stats) {
		return h("div", { style: S.outlineWrap, "data-testid": "ds-outline-empty" }, [
			h("div", { key: "h", style: S.outlineHead }, [h("span", { key: "t", style: { fontWeight: 650, fontSize: 11.5 } }, "结构大纲")]),
			h("div", { key: "m", style: { ...S.muted, padding: "0 10px 8px" } }, "尚无设计图 —— 点「＋ 新建图」或「↺ 载入标准框架」开始。")
		]);
	}
	const collisions = layerOverlaps(doc);
	const hiddenTotal = stats.hidden, lockedTotal = stats.locked;
	return h("div", { style: S.outlineWrap, "data-testid": "ds-outline", "data-focus": focusScreen },
		[
			h("div", { key: "hd", style: S.outlineHead }, [
				h("span", { key: "t", style: { fontWeight: 650, fontSize: 11.5 } }, "结构大纲"),
				h("select", {
					key: "f", style: S.focusSel, "data-testid": "ds-focus",
					title: "聚焦某一幅画面 —— 其余画面只留淡影且不接收点击（消除跨画面遮挡）",
					value: focusScreen,
					onChange: (e) => onFocus(e.target.value)
				}, [
					h("option", { key: "all", value: "all" }, "全景（3 幅）"),
					...SCREEN_ORDER.map((sk) => h("option", { key: sk, value: sk },
						(SCREENS[sk] || {}).label + "（" + (stats.screens.find((s) => s.screen === sk) || { total: 0 }).total + "）"))
				]),
				h("span", { key: "n", style: { ...S.muted, marginLeft: "auto" } },
					selected ? selected : "未选中")
			]),
			h("div", { key: "ch", style: S.outlineChips }, [
				h("span", { key: "t", style: { ...S.chip, "data-testid": "ds-chip-total" } },
					"元素 " + stats.total),
				hiddenTotal ? h("span", { key: "h2", style: { ...S.chip, "data-testid": "ds-chip-hidden" } }, "隐藏 " + hiddenTotal) : null,
				lockedTotal ? h("span", { key: "l", style: { ...S.chip, "data-testid": "ds-chip-locked" } }, "锁定 " + lockedTotal) : null,
				/* 同层重叠是 N2 不变量的现场读数 —— 一旦摆歪立刻可见，不必等到截图时肉眼发现 */
				h("span", {
					key: "c", "data-testid": "ds-chip-collide",
					style: collisions.length
						? { ...S.chip, borderColor: "#6b2b28", background: "rgba(248,81,73,.14)", color: "#ff9a92" }
						: { ...S.chip, borderColor: "#2b6b3a", background: "rgba(63,185,80,.12)", color: "#8fd48f" },
					title: collisions.length
						? collisions.map((c) => c.a + " × " + c.b).join("；")
						: "同画面同层内没有元素互相遮挡"
				}, "同层重叠 " + collisions.length)
			]),
			h("div", { key: "bd", style: S.outlineBody }, tree.flatMap((sc) => {
				const rows = [h("div", {
					key: "sc-" + sc.screen, style: {
						...S.screenRow,
						// 聚焦中的画面高亮；其余压暗（但**仍可点**，点一下即切过去）
						opacity: focusScreen === "all" || focusScreen === sc.screen ? 1 : 0.55,
						borderColor: focusScreen === sc.screen ? "#2b3f5e" : "#2b2e34",
						background: focusScreen === sc.screen ? "#1d2739" : "var(--dsw-alias-bg-base, #1c1d21)"
					},
					"data-testid": "ds-screen-row", "data-screen": sc.screen,
					title: sc.hint + "（重叠序 " + sc.overlap + "）",
					onClick: () => onFocus(focusScreen === sc.screen ? "all" : sc.screen)
				}, [
					h("span", { key: "lv", style: { ...S.chip, padding: "0 5px", margin: 0 } }, "序" + sc.overlap),
					h("span", { key: "n", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, sc.label),
					h("span", { key: "c", style: { ...S.muted, fontSize: 10.5 } }, sc.stats.total + " 项"),
					h("span", {
						key: "eh", style: S.oAct, title: "整幅收起 / 展开",
						"data-testid": "ds-screen-hide-" + sc.screen,
						onClick: (e) => { e.stopPropagation(); onScreenHidden(sc.screen, sc.stats.visible > 0); }
					}, sc.stats.visible > 0 ? "◎" : "◌")
				])];
				for (const g of sc.layers) {
					rows.push(h("div", { key: "ly-" + sc.screen + "-" + g.layer, style: S.layerRow, "data-layer": g.layer, title: g.hint }, [
						h("span", { key: "d", style: { opacity: 0.6 } }, "└"),
						h("span", { key: "n" }, g.label),
						h("span", { key: "c", style: { marginLeft: "auto", opacity: 0.7 } }, g.items.length)
					]));
					for (const it of g.items) {
						const spec = ELEMENT_KINDS[it.kind] || { icon: "?", label: it.kind };
						const gg = gc(spec.group);
						const isSel = selected === it.id;
						rows.push(h("div", {
							key: "el-" + it.id,
							style: {
								...S.oRow,
								...(isSel ? { background: "#1d2739", borderColor: "#2b3f5e" } : null),
								...(it.hidden ? S.oRowGhost : null),
								...(it.locked ? S.oRowLocked : null)
							},
							"data-testid": "ds-oline", "data-el-id": it.id, "data-el-kind": it.kind,
							title: it.id + " · " + spec.label + " · " + it.x + "," + it.y + " " + it.w + "×" + it.h
								+ (it.note ? ("\n" + it.note) : ""),
							onClick: () => onSelect(it.id)
						}, [
							h("span", { key: "i", style: { color: gg.text } }, spec.icon),
							h("span", { key: "n", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } }, it.label),
							h("span", { key: "g", style: { ...S.muted, fontSize: 10.5 } }, it.x + "," + it.y),
							/* 行内动作：每个都 stopPropagation —— 否则点"隐藏"会顺带选中它 */
							h("span", {
								key: "v", style: { ...S.oAct, ...(it.hidden ? S.oActOn : null) },
								"data-testid": "ds-o-hide-" + it.id, title: it.hidden ? "显示" : "隐藏（不删，随时可回）",
								onClick: (e) => { e.stopPropagation(); onFlags(it.id, { hidden: !it.hidden }); }
							}, it.hidden ? "◌" : "◎"),
							h("span", {
								key: "k", style: { ...S.oAct, ...(it.locked ? S.oActOn : null) },
								"data-testid": "ds-o-lock-" + it.id, title: it.locked ? "解锁" : "锁定（防误拖）",
								onClick: (e) => { e.stopPropagation(); onFlags(it.id, { locked: !it.locked }); }
							}, it.locked ? "🔒" : "🔓"),
							h("span", {
								key: "u", style: { ...S.oAct }, "data-testid": "ds-o-up-" + it.id, title: "上移一位（本画面内）",
								onClick: (e) => { e.stopPropagation(); onReorder(it.id, "up"); }
							}, "↑"),
							h("span", {
								key: "d2", style: { ...S.oAct }, "data-testid": "ds-o-down-" + it.id, title: "下移一位（本画面内）",
								onClick: (e) => { e.stopPropagation(); onReorder(it.id, "down"); }
							}, "↓")
						]));
					}
				}
				return rows;
			})),
			h("div", { key: "ft", style: { ...S.muted, padding: "4px 10px 8px", flex: "0 0 auto", fontSize: 10.5 } },
				"改图顺序：① 选画面 → ② 按 base → content → deco 逐层改 → ③ 回全景核对。")
		]);
}

/* ══════════════════════════════════════════════════════════════════
 * D3 · 左侧交互逻辑面板 —— 显示并**可编辑**选中元素的七元组
 * ══════════════════════════════════════════════════════════════════ */

function LogicPanel({ doc, selected, onLogicChange, onRelabel, onDelete, onDuplicate, onReorder }) {
	// 🔴 **必须同时判 doc**（2026-09-12 真机事故 · 单点故障复盘）：
	//    设计图「打开态」是**持久化**的（layout.designStudioOpen），而文档是在
	//    `useEffect` 里**首帧渲染之后**才创建的 ⇒ 重启后必有一次「open=true 且 doc=null」
	//    的渲染。原写法 `selected && (doc.elements||[])` 只判了 selected（此时为 null）
	//    就短路，看似安全，但空分支里 `doc.title` 没有任何保护 ⇒ TypeError
	//    ⇒ 无 error boundary，React 卸载整个 Shell 根 ⇒ **浮动按钮组 / 弹窗 / 工作室全灭**，
	//    且因 open 标志已持久化，**每次重启都会再次复现**（自锁死）。
	//    ⇒ 修正：doc 为空时走"尚无设计图"分支，不触碰任何 doc 字段。
	const el = doc && selected ? (doc.elements || []).find((e) => e.id === selected) : null;
	if (!el) {
		return h("div", { style: S.leftBody, "data-testid": "ds-logic-empty" }, [
			h("div", { key: "t", style: S.lbl }, "D3 · 元素交互逻辑"),
			h("div", { key: "m", style: S.muted },
				"点画布上的任一元素 → 这里显示它绑定的交互逻辑（触发 / 行为 / 状态 / 数据 / 退化 / 快捷键 / 对应代码）。"),
			h("div", { key: "s", style: { ...S.muted, marginTop: 4 } },
				"逻辑直接绑在元素上，改图即改逻辑 —— 这样设计图本身就是可执行的规格，不用另开文档对指。"),
			h("div", { key: "c", style: { ...S.muted, marginTop: 6 } },
				doc ? ("当前图：" + doc.title + " · 元素 " + (doc.elements || []).length + " 个")
					: "尚无设计图 —— 点「＋ 新建图」或「↺ 载入标准框架」开始。")
		]);
	}
	const spec = ELEMENT_KINDS[el.kind] || { label: el.kind };
	const g = gc(spec.group); // 左栏标题与画布块同色 ⇒ 选中谁一眼对得上
	return h("div", { style: S.leftBody, "data-testid": "ds-logic", "data-el-id": el.id }, [
		h("div", { key: "h", style: { ...S.lbl, color: g.text } },
			"D3 · 交互逻辑 · " + el.id + " · " + (spec.group || "未分组")),
		// 元素标识（可改文案 —— 这样在对话里能指着名字说）
		h("div", { key: "id", style: S.field }, [
			h("div", { key: "l", style: { ...S.fieldLabel, color: g.text } }, [h("span", { key: "i" }, spec.icon || "▫"), h("span", { key: "t" }, "元素 · " + spec.label)]),
			h("input", {
				key: "in", style: S.fieldInput, value: el.label, "data-testid": "ds-el-label",
				onChange: (e) => onRelabel(e.target.value)
			}),
			h("div", { key: "geo", style: S.fieldHint }, "位置 " + el.x + "," + el.y + " · 尺寸 " + el.w + "×" + el.h + " · 层级 z" + el.z)
		]),
		// 七元组逐个可编辑
		...LOGIC_FIELDS.map((f) => h("div", { key: f.key, style: S.field, "data-logic-field": f.key }, [
			h("div", { key: "l", style: S.fieldLabel }, f.label),
			h("textarea", {
				key: "in", style: { ...S.fieldInput, minHeight: 30 }, value: (el.logic && el.logic[f.key]) || "",
				placeholder: f.hint, "data-testid": "ds-logic-" + f.key, rows: f.key === "action" ? 2 : 1,
				onChange: (e) => onLogicChange(f.key, e.target.value)
			})
		])),
		// 元素级动作 —— **常驻底部**（sticky）
		/* 🔴 为什么必须 sticky：这两段式左栏里，逻辑面板的内容（名称 + 七元组 + 动作行）约 609px，
		 *    而它能分到的可视高度 ≈ 325px ⇒ 若不常驻，用户每次「复制 / 置顶 / 删除」都要先滚到底。
		 *    实测这笔账很具体：不加 sticky 时 `ds-dup` 的矩形 y≈1308、视口 920 —— 按钮**压根在屏幕外**，
		 *    真机点击的落点是 `null`（打空），读起来像"复制功能坏了"。
		 *    `bottom: -10` 是抵消容器自身的 `padding: 10`，让它贴到底边而不是悬空 10px。 */
		h("div", {
			key: "ops",
			style: {
				position: "sticky", bottom: -10, zIndex: 2,
				display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2,
				padding: "8px 0", background: "var(--dsw-alias-bg-sunken, #141519)",
				borderTop: "1px solid #26282e"
			}
		}, [
			h("button", { key: "d", style: S.btn, "data-testid": "ds-dup", onClick: onDuplicate }, "复制"),
			h("button", { key: "t", style: S.btn, "data-testid": "ds-top", onClick: () => onReorder("top") }, "置顶"),
			h("button", { key: "x", style: S.btnDanger, "data-testid": "ds-del", onClick: onDelete }, "删除")
		]),
		h("div", { key: "note", style: S.muted }, "⚠「退化路径」与「对应代码」两栏是改代码时的路标：前者写「失败怎么办」，后者写「逻辑在哪个文件」。")
	]);
}

/* ══════════════════════════════════════════════════════════════════
 * D6 · 底部设计图专用临时对话 —— 只处理本图修订
 * ══════════════════════════════════════════════════════════════════ */

function ThreadBar({ doc, onCommit, onApply, onDiscard, pending, draft, setDraft, onExportDSL }) {
	// 🔴 同 LogicPanel：doc 可能为 null（首帧早于 useMemo/useEffect 建图）⇒ 一律走局部安全值
	const thread = (doc && doc.thread) || [];
	const hasDoc = Boolean(doc);
	return h("div", { style: S.bottom, "data-testid": "ds-thread" }, [
		h("div", { key: "hd", style: S.threadHead }, [
			h("span", { key: "i" }, "🖌"),
			h("span", { key: "t", style: { fontWeight: 650 } }, "设计图修订对话"),
			h("span", { key: "c", style: S.chip }, "临时 · 只处理本图"),
			/* 「导出结构 DSL」放在这里而不是顶栏，有两个理由：
			 *   ① 语义：这是**交给 AI 的那一份**，紧挨着"与 AI 说怎么改"的输入框最顺手；
			 *   ② 工程：顶栏已有 12 个按钮并在 1441 宽度下实测溢出过（V17 P2-2 的窄屏收纳就是为此），
			 *      再塞一个会把 C15.x 的溢出断言逼到临界。底栏这一行有 marginLeft:auto 的空档。 */
			h("button", {
				key: "dsl", style: { ...S.btn, height: 20, padding: "0 7px", fontSize: 10.5, marginLeft: "auto" },
				"data-testid": "ds-export-dsl",
				title: "导出结构 DSL —— 按「画面 → 元素 → 逻辑」的行式文本，AI 可直接读写（V20 §E）",
				onClick: onExportDSL
			}, "⤓ 导出 DSL"),
			h("span", { key: "n", style: { ...S.muted, marginLeft: 8 } },
				"不与宿主会话、也不与总监对话共用（三向隔离）")
		]),
		h("div", { key: "bd", style: { ...S.threadBody, flex: "0 1 auto", maxHeight: 104 } }, thread.length
			? (thread.slice(-20)).map((m) => h("div", { key: m.id, style: S.tmsg(m.role), "data-thread-id": m.id }, [
				h("span", { key: "b", style: { flex: "0 0 auto", color: m.role === DESIGN_ROLE.USER ? "#9fc2ff" : "#b794f6" } },
					m.role === DESIGN_ROLE.USER ? "你：" : "工作室："),
				h("span", { key: "t" }, m.text),
				m.ops && m.ops.length ? h("span", { key: "o", style: { ...S.muted, marginLeft: 4 } }, "（" + m.ops.length + " 项操作）") : null
			]))
			: h("div", { key: "e", style: S.muted, "data-testid": "ds-thread-empty" },
				"在这里说你想怎么改这张图，例如「移动 R1 顶部栏 下 20；删除 R6 记忆面板」。只对本图生效。")),
		// 待确认操作（不静默改图 —— 与总监路由的闸门规则一致，破坏性动作必须过确认）
		pending && pending.ops.length ? h("div", {
			key: "pd", style: { padding: "0 10px 6px", display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }, "data-testid": "ds-pending"
		}, [
			h("span", { key: "c", style: { ...S.chip, borderColor: "rgba(210,153,34,.45)", background: "rgba(210,153,34,.12)", color: "#e0b341" } },
				"待确认 " + pending.ops.length + " 项"),
			h("span", { key: "t", style: S.muted, flex: 1 },
				pending.ops.map((o) => o.op + " → " + o.target).join("；")),
			/* 🔴 `ds-apply` 必须绑 `onApply`（= onApplyPending），**不能绑 onCommit**（2026-09-12 真机事故）：
			 *   原写法 `onClick: onCommit` ⇒ 点「应用到图」实际又走了一遍 `onSubmitThread`，
			 *   而该函数开头就是 `if (!text || !doc) return`，此时 draft 已被上一次发送清空
			 *   ⇒ **静默什么都不做**（无报错、无提示、待确认区还在）——最难查的一类缺陷。
			 *   之所以一直没暴露：另有 `ds-apply-fab` 走的是正确的 onApplyPending，掩盖了本按钮。
			 *   教训：**同一语义的两个入口必须绑同一个 handler**，否则测试只覆盖其一就会漏。 */
			h("button", { key: "ok", style: S.btnPri, "data-testid": "ds-apply", onClick: onApply }, "应用到图"),
			h("button", { key: "no", style: S.btn, "data-testid": "ds-drop", onClick: onDiscard }, "不要")
		]) : null,
		h("div", { key: "ft", style: S.threadFoot }, [
			h("input", {
				key: "in", style: S.input, "data-testid": "ds-input", value: draft,
				disabled: !hasDoc,
				placeholder: hasDoc
					? "说怎么改（引用元素名或 id；**数字=像素**，如「移动 R1 顶部栏 左 30」；多条用「；」分隔）…"
					: "尚无设计图 —— 先新建或载入标准框架",
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onCommit(); } }
			}),
			h("button", { key: "s", style: S.btnPri, "data-testid": "ds-send", onClick: onCommit, disabled: !hasDoc }, "↑")
		])
	]);
}

/* ══════════════════════════════════════════════════════════════════
 * D1 · 主组件
 * ══════════════════════════════════════════════════════════════════ */

export function DesignStudio({ open, onClose }) {
	const st = react.useSyncExternalStore(
		(fn) => subscribe(fn),
		() => getState(),
		() => getState()
	);
	const doc = react.useMemo(
		() => (st.docs || []).find((d) => d.docId === st.activeDocId) || null,
		[st]
	);
	const [selected, setSelected] = react.useState(null);
	const [draft, setDraft] = react.useState("");
	const [pending, setPending] = react.useState(null);
	const [toast, setToast] = react.useState("");
	/* V17 P3：跨界面流转同步反馈 —— 工作室打开期间，别的维度把消息送到设计图时轻提示 */
	const flowSnap = react.useSyncExternalStore(
		(fn) => flowStore.subscribe(fn),
		() => flowStore.getState(),
		() => flowStore.getState()
	);
	const dsSyncSeenRef = react.useRef(lastFlowIdFor(flowSnap.flows, DIM.DESIGN));
	react.useEffect(() => {
		const flows = flowSnap.flows;
		const latest = lastFlowIdFor(flows, DIM.DESIGN);
		if (!open) { dsSyncSeenRef.current = latest; return; } // 关闭期只追基线不提示，避免一打开弹旧账
		if (latest && latest !== dsSyncSeenRef.current) {
			dsSyncSeenRef.current = latest;
			const f = flows.find((x) => x.flowId === latest);
			if (f && flowOrigin(f) && flowOrigin(f) !== DIM.DESIGN) setToast("已同步到设计图");
		} else if (!latest) {
			dsSyncSeenRef.current = null;
		}
	}, [flowSnap, open]);
	const [scale, setScale] = react.useState(1);
	/* ── 画面聚焦（2026-09-14 新增 · V20 §C1 第 ② 步）─────────────────────
	 * 🔴 这是**纯视图态**：不落库、不进版本、不动任何元素的坐标或 z。
	 *    理由：聚焦只是"我现在改这一屏"，不是"图变了"。
	 *    若把它写进 doc，用户每看一屏就会多出一个"未保存改动"和一个内容相同的版本，
	 *    版本列表会被"我只是看了看"污染（同 sameElements 对 hidden/locked 的取舍）。
	 *    默认 `all` = 与改动前完全一致的渲染，既有断言不受影响。 */
	const [focusScreen, setFocusScreen] = react.useState("all");
	/* 版本面板开合 · 顶栏右侧安全区宽度 · 重命名输入态（null = 不在重命名） */
	const [verOpen, setVerOpen] = react.useState(false);
	/* 初值直接取一次真值（而不是 0 再等 effect 回调）—— 否则首帧 ✕ 会先出现在被压的位置再跳开 */
	const [inset, setInset] = react.useState(() => readInset());
	const [nameDraft, setNameDraft] = react.useState(null);
	/* 导出兜底：剪贴板被系统拒绝时，把 JSON 摆在这里让用户自己复制（见 onExportJson 三级降级） */
	const [exportText, setExportText] = react.useState(null);
	/* 右上角「⚙ 个性化」开合。🔴 与上面几条同样**必须排在 early return 之前**（React Hooks 规则）。 */
	const [pOpen, setPOpen] = react.useState(false);
	/* V17 P2-2：顶栏响应式 —— 窗口宽度 <1500 时次要按钮（复制/重载框架/导出）收入「更多」菜单。
	 * 阈值取 1500：顶栏按钮多，实测 1441 宽度下全平铺会溢出安全区 43px（C15.3/C15.5），
	 * 且溢出导致版本按钮被 flex 压缩、C16.10 负对照失效。这三个是低频动作，收入菜单合理。 */
	const [narrow, setNarrow] = react.useState(() => typeof window !== "undefined" && window.innerWidth < 1500);
	const [moreOpen, setMoreOpen] = react.useState(false);
	/* V17 审校补漏：「更多」菜单除 mouseleave 外，再支持点击外部 / Esc 关闭（鼠标不经过菜单边界也能收起） */
	react.useEffect(() => {
		if (!moreOpen) return undefined;
		const onDown = (e) => {
			const t = e.target;
			if (t && t.closest && t.closest('[data-testid="ds-more"],[data-testid="ds-more-menu"]')) return;
			setMoreOpen(false);
		};
		const onKey = (e) => { if (e.key === "Escape") { // 菜单打开时 Esc 只关菜单：截获并阻止冒泡到工作室全局 Esc（否则会连带关闭整张工作室）
			e.stopImmediatePropagation(); e.preventDefault(); setMoreOpen(false); } };
		document.addEventListener("pointerdown", onDown, true);
		document.addEventListener("keydown", onKey, true);
		return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); };
	}, [moreOpen]);
	react.useEffect(() => {
		if (typeof window === "undefined") return;
		const onResize = () => setNarrow(window.innerWidth < 1500);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	const dragRef = react.useRef(null);
	const gridRef = react.useRef(null);
	const wrapRef = react.useRef(null);

	/* 窗口控件安全区 —— 全屏工作室（fixed inset:0）必须躲开 Windows 原生窗口按钮。
	 * 实测：视口 1536 时右侧 137px 被原生层独占，且 z-index 对它无效 ⇒ 只能避让。
	 * watchInset 只在**值真的变化**时回调（resize 风暴里不会反复 setState）。 */
	react.useEffect(() => watchInset(setInset), []);

	/* 版本列表（顶栏角标 + 版本面板共用同一份，避免"角标说 3、面板列 2"）。
	 *
	 * 🔴 必须放在下方 `if (!open) return null;` 的**之前** —— React Hooks 规则：
	 *    所有 hook 必须无条件、且每次渲染按相同顺序调用。
	 *    本轮踩过这个坑：最初把 useMemo 写在 early return 之后 ⇒
	 *    `open` 由 false 变 true 的那一次渲染，hook 数量从 N 变成 N+1
	 *    ⇒ React 抛 "Rendered more hooks than during the previous render"
	 *    ⇒ DesignStudio 整层崩溃（被 SafeLayer 拦下、显示错误角标，工作室完全打不开）
	 *    ⇒ 真机 e2e 从 C2.1「工作室已挂载」起 54 项全红。
	 *    判据：**凡是 `if (!x) return` 出现在组件里，其后就不要再有任何 hook。** */
	const versions = react.useMemo(() => (doc ? listVersions(doc.docId) : []), [doc]);

	/* 首次打开且无图 ⇒ 自动铺一张标准框架（用户不必先"新建"） */
	react.useEffect(() => {
		if (!open) return;
		if (!(getState().docs || []).length) {
			newDoc({ title: "标准框架 · 三页签", frameKey: "threeTab" });
		}
	}, [open]);

	/* toast 自动消失（2.2s）。
	 * 🔴 原实现只在 onClick 里清 ⇒ **提示永不消失**，会一直压在画布上；
	 *    且位置在底栏之上（见下方 toast 样式注释），遮住输入框 ⇒ 必须自动走。 */
	react.useEffect(() => {
		if (!toast) return undefined;
		const t = setTimeout(() => setToast(""), 2200);
		return () => clearTimeout(t);
	}, [toast]);

	/* 打开时自动「适应容器」（等价于点一次「适应」）。
	 * 为什么需要：标准框架是 1180×644 的固定画布，而可视区宽约 800–1100px
	 * ⇒ 100% 打开必然右侧被裁、要用户自己发现右下角还有内容。
	 * 自动缩到刚好放得下（上限 1，不放大），用户仍可手动 ± / 适应 覆盖。
	 * 容器尺寸首帧可能还是 0，故补一次 400ms 后复测。 */
	react.useEffect(() => {
		if (!open) return undefined;
		const fit = () => {
			try {
				const w = wrapRef.current ? wrapRef.current.clientWidth : 0;
				if (!w) return;
				setScale(Math.max(0.2, Math.min(1, Number(((w - 40) / CANVAS_W).toFixed(2)))));
			} catch (e) { /* 布局未就绪则保持原值 */ }
		};
		fit();
		const t = setTimeout(fit, 400);
		return () => clearTimeout(t);
	}, [open]);

	/** 提交一个 doc 变更（统一出口：写库 + 清选中兜底） */
	const commit = react.useCallback((next) => {
		if (!next) return;
		saveDoc(next);
		if (selected && !(next.elements || []).some((e) => e.id === selected)) setSelected(null);
	}, [selected]);

	/* ── 拖拽 / 缩放（D5）──────────────────────────────────────────
	 * 🔴 与 DirectorDialog 同一教训：`pointerdown → pointermove → pointerup` 若落在
	 *    同一个 task（自动化脚本连发），依赖 state 记录起点会拿到旧值 ⇒ 位移静默丢失。
	 *    故起点与实时值都放 ref，pointerup 时以事件坐标**兜底重算**，两者幂等。
	 */
	const onElPointerDown = (e, el, mode) => {
		e.stopPropagation();
		// 🔴 同 MindMap：阻止原生文本选择/原生拖拽把渲染主线程挂进桌面壳原生交互状态机
		e.preventDefault();
		setSelected(el.id);
		/* 锁定元素：**仍可被选中**（要能看见它的逻辑、要能解锁），但不起拖拽。
		 * 🔴 不用 early return 跳过 setSelected —— 那样点一下锁住的东西会"什么反应都没有"，
		 *    用户分不清是"锁了"还是"这个元素坏了"。选中 + 一条明确提示才说得清。 */
		if (el.locked) {
			setToast("已锁定：「" + el.label + "」 —— 点大纲里的 🔒 解锁后才能拖动 / 缩放");
			return;
		}
		dragRef.current = {
			mode, id: el.id, x0: e.clientX, y0: e.clientY,
			ex0: el.x, ey0: el.y, w0: el.w, h0: el.h,
			/* 🔴 缩放系数必须随拖拽一起冻结（2026-09-12 审美审核时发现的逻辑缺陷）：
			 *   画布用 `transform: scale(k)` 呈现，鼠标位移是**屏幕像素**，而元素坐标是**模型像素**。
			 *   原实现直接把屏幕位移当模型位移用 ⇒ 缩小到 50% 时拖一格元素跑两格（视觉与手感背离），
			 *   放大到 200% 时又拖不动。故在此冻结开局 k，位移一律 `÷k`。
			 *   取自 ref 而非入参，避免 pointermove 闭包读到旧 scale。 */
			scale: scale || 1
		};
		const move = (ev) => {
			const d = dragRef.current;
			if (!d) return;
			const k = d.scale || 1;
			const dx = (ev.clientX - d.x0) / k;
			const dy = (ev.clientY - d.y0) / k;
			const cur = getActiveDoc();
			if (!cur) return;
			const next = d.mode === "resize"
				? resizeElement(cur, d.id, d.w0 + dx, d.h0 + dy)
				: moveElement(cur, d.id, d.ex0 + dx, d.ey0 + dy);
			saveDoc(next);
		};
		const up = () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			dragRef.current = null;
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
	};

	/* ── 键盘（D5）：Delete 删除 / 方向键微移 / Ctrl+D 复制 ── */
	react.useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => {
			const tag = (e.target && e.target.tagName) || "";
			if (/INPUT|TEXTAREA|SELECT/.test(tag)) return; // 编辑逻辑字段时不抢键
			if (e.key === "Escape") {
				// Esc 只退最上层：先关个性化面板，再取消待确认，再清选中，最后才关工作室（V16 C1 的 Esc 契约）
				/* 个性化面板自己的 window-capture 监听已经 stopPropagation（正常情况走不到这），
				 * 这里再留一层：面板是 fixed 浮层，若它因任何原因没接住事件，
				 * **不能变成"按 Esc 直接把整个工作室关掉"**（用户丢的是一张没保存的图）。 */
				if (pOpen) { setPOpen(false); return; }
				if (pending) { setPending(null); return; }
				if (selected) { setSelected(null); return; }
				onClose && onClose();
				return;
			}
			if (!selected) return;
			const cur = getActiveDoc();
			if (!cur) return;
			/* 锁定元素不吃键盘编辑：与拖拽同一条口径
			 * （否则"我把它锁住了，方向键还是能挪走"）。Escape 已在上面单独处理并 return，
			 * 所以这里只需拦"改图"的那些键。 */
			const selEl = (cur.elements || []).find((x) => x.id === selected);
			if (selEl && selEl.locked) return;
			const STEP = e.shiftKey ? 1 : 10;
			if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(removeElement(cur, selected)); }
			else if (e.key === "ArrowLeft") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: -STEP, dy: 0 } }])); }
			else if (e.key === "ArrowRight") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: STEP, dy: 0 } }])); }
			else if (e.key === "ArrowUp") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: 0, dy: -STEP } }])); }
			else if (e.key === "ArrowDown") { e.preventDefault(); commit(applyOps(cur, [{ op: "move", target: selected, args: { dx: 0, dy: STEP } }])); }
			else if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(duplicateElement(cur, selected)); }
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, selected, pending, commit, onClose, pOpen]);

	/* ── 底部对话：解析 → 待确认 → 应用（D6）── */
	const onSubmitThread = () => {
		const text = draft.trim();
		if (!text || !doc) return;
		const { ops, unresolved } = parseDesignCommand(doc, text);
		let withMsg = appendThread(doc, { role: DESIGN_ROLE.USER, text, ops });
		if (unresolved.length) {
			withMsg = appendThread(withMsg, {
				role: DESIGN_ROLE.STUDIO,
				text: "认不出这几段（请用元素名或 id）：" + unresolved.join(" / ")
			});
		}
		if (ops.length) withMsg = appendThread(withMsg, { role: DESIGN_ROLE.STUDIO, text: "解析出 " + ops.length + " 项操作，待你确认后应用到图。" });
		commit(withMsg);
		setPending({ ops, text });
		setDraft("");
		if (!ops.length) { setToast("没有可执行的操作"); }
	};
	const onApplyPending = () => {
		const cur = getActiveDoc();
		if (!cur || !pending) return;
		let next = applyOps(cur, pending.ops);
		next = appendThread(next, { role: DESIGN_ROLE.STUDIO, text: "已应用 " + pending.ops.length + " 项操作（revision " + (cur.revision + 1) + "）。" });
		commit(next);
		setPending(null);
		setToast("已应用 " + pending.ops.length + " 项");
	};

	/* ── 工具栏：点类型 → 增加元素（D2）── */
	const onAddKind = (kind) => {
		if (!doc) return;
		/* 聚焦某画面时，新元素归到**当前画面**（不然它会按 z 落到模态区间，
		 * 而你正在改的那一屏里什么也没出现 —— 看起来像"点了工具栏没反应"）。
		 * 未聚焦时不传 screen，落到既有行为（逐字不变）。 */
		const next = addElement(doc, kind, {}, focusScreen === "all" ? {} : { screen: focusScreen });
		commit(next);
		const added = (next.elements || [])[(next.elements || []).length - 1];
		if (added) setSelected(added.id);
		setToast("已添加：" + (ELEMENT_KINDS[kind] || {}).label
			+ (focusScreen === "all" ? "" : ("（归入「" + (SCREENS[focusScreen] || {}).label + "」）")));
	};

	/* ── 顶栏动作 ── */
	const onNewDoc = () => { const d = newDoc({ title: "设计图 " + (listDocs().length + 1), frameKey: "threeTab" }); setSelected(null); setToast("已新建：" + d.title); };
	const onLoadFrame = () => {
		if (!doc) return;
		commit(loadStandardFrame(doc, "threeTab"));
		setToast("已重新铺设标准框架");
	};
	/* ── 顶栏动作 · 图管理 ──────────────────────────────────────────────
	 * 🔴 本组函数补齐的是用户报「最上面这一列功能未实现」：
	 *    原顶栏只有「切换图 / 新建 / 载入框架 / 缩放 / 关闭」6 个动作，
	 *    而 **删除、重命名、复制、导出** 四个在数据层早就写好了 ——
	 *    其中 `onDeleteDoc` 甚至是**定义了从未被调用**的死代码（写了没接线）。
	 *    这也是"看起来做了其实没做"的另一种形态：函数在、能力在、入口不在。 */
	const delArmRef = react.useRef(0);
	const [delArmed, setDelArmed] = react.useState(false);
	/* 上膛 2.5s 后自动泄压。
	 * 🔴 泄压必须由**状态**驱动（而非只存 ref 时间戳）：原实现点完「删除」只有一条 toast 变了，
	 *    **按钮外观毫无变化** ⇒ 用户看不到"我这一下点到了、还要再点一次"，
	 *    主观结论就是"按钮坏了"（用户原话：「目前点击都不好用」）。
	 *    这里让按钮自己变成实心红的「确认」，2.5s 后自动变回「删除」。 */
	react.useEffect(() => {
		if (!delArmed) return undefined;
		const t = setTimeout(() => { setDelArmed(false); delArmRef.current = 0; }, 2500);
		return () => clearTimeout(t);
	}, [delArmed]);
	const onDeleteDoc = () => {
		if (!doc) return;
		/* 删图不可逆 ⇒ 二次点击确认（不用 window.confirm：桌面壳里会被拦或被静默忽略）。
		 * 首次点击只"上膛"并提示，2.5s 内不再点即自动泄压，避免误触。 */
		const t = Date.now();
		if (t - (delArmRef.current || 0) > 2500) {
			delArmRef.current = t;
			setDelArmed(true);
			setToast("再点一次「确认」删除「" + doc.title + "」（不可撤销）");
			return;
		}
		delArmRef.current = 0;
		setDelArmed(false);
		deleteDoc(doc.docId);
		setSelected(null);
		setVerOpen(false);
		setToast("已删除该设计图");
	};

	const onRenameStart = () => { if (doc) setNameDraft(String(doc.title || "")); };
	const onRenameCancel = () => setNameDraft(null);
	const onRenameCommit = () => {
		if (!doc) { setNameDraft(null); return; }
		const t = String(nameDraft == null ? "" : nameDraft).trim();
		if (!t) { setToast("名字不能为空"); return; }   // 与 renameDoc 的拒绝一致：不静默改成"未命名"
		const r = renameDoc(doc.docId, t);
		setNameDraft(null);
		setToast(r ? ("已重命名为「" + r.title + "」") : "重命名失败");
	};

	const onDuplicateDoc = () => {
		const c = duplicateDoc(doc ? doc.docId : null);
		if (!c) { setToast("没有可复制的图"); return; }
		setSelected(null);
		setToast("已复制为：" + c.title + "（不含版本历史）");
	};

	/* 导出：走**剪贴板**而不是下载文件 —— 桌面壳对 <a download> 的拦截行为不稳定，
	 * 而"把 JSON 贴进对话/工单"才是这一步的真实用途（沟通，不是归档）。
	 * 🔴 真机实测过 `{"expToast":"复制失败：剪贴板不可用"}`：`navigator.clipboard` 在
	 *    桌面壳的非安全上下文里**存在但会 reject** ⇒ 原实现直接判"失败"，功能等于没有。
	 *    现在三级降级，保证**一定能把数据交到用户手上**：
	 *      ① navigator.clipboard.writeText（最优）
	 *      ② document.execCommand("copy") + 离屏 textarea（老 API，Electron 里通常可用）
	 *      ③ 展开一个只读文本域让用户自己全选复制（剪贴板被系统级拒绝时的兜底）
	 *    判据：任何环境点「导出」都不得停在"没有数据可拿"。 */
	const copyViaExecCommand = (text) => {
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "readonly");
			/* 必须真在文档里且可选中（否则 execCommand 拿不到内容）；
			 * 用 fixed + 移出视口，避免 absolute 到页底把文档撑高造成滚动跳动。 */
			ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
			document.body.appendChild(ta);
			ta.select();
			ta.setSelectionRange(0, text.length);
			const ok = document.execCommand("copy");
			document.body.removeChild(ta);
			return !!ok;
		} catch (e) { return false; }
	};

	/**
	 * 统一的"把一段文本交到用户手上"—— 三级降级：剪贴板 API → execCommand → 摆出文本框。
	 * 🔴 抽出来是因为现在有两个导出（JSON / 结构 DSL），而**三级降级是有顺序要求的**：
	 *    `navigator.clipboard` 在桌面壳里会 reject，此时必须落到 execCommand；
	 *    execCommand 也可能被拒，此时必须把文本摆出来（而不是只报一句"复制失败"）。
	 *    两个导出各抄一份，早晚会有一个漏掉第三级 —— 那就是"功能在、数据出不来"。
	 */
	const copyOut = (text, label, fallbackNote) => {
		const fallback = () => {
			if (copyViaExecCommand(text)) { setToast("已复制" + label + "到剪贴板（" + text.length + " 字符）"); return; }
			setExportText(text);
			setToast("系统剪贴板不可用，已展开" + (fallbackNote || label) + "供手动复制");
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(
				() => setToast("已复制" + label + "到剪贴板（" + text.length + " 字符）"),
				fallback
			);
		} else fallback();
	};

	const onExportJson = () => {
		if (!doc) { setToast("没有可导出的图"); return; }
		try {
			copyOut(JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), doc }, null, 2), " JSON", " JSON");
		} catch (e) { setToast("导出失败：" + String((e && e.message) || e)); }
	};

	/**
	 * 导出**结构 DSL**（V20 §E）—— 这是给 AI 读的那一份，与 JSON 的区别不在"格式新旧"，
	 * 而在于：JSON 里 20 个元素是**一张没有从属关系的坐标表**，AI 每次都要重新推断
	 * "这图里有几幅画面"；DSL 把画面/层/次序写成了文本结构，推理成本降到"读行"。
	 * 带 `logic:true` ⇒ 七元组一并导出，**逐字段可回读**（含被清空的字段，见 toDesignDSL 注释）。
	 */
	const onExportDSL = () => {
		if (!doc) { setToast("没有可导出的图"); return; }
		try {
			const text = toDesignDSL(doc, { logic: true });
			copyOut(text, "结构 DSL", " DSL");
		} catch (e) { setToast("导出失败：" + String((e && e.message) || e)); }
	};

	/* ── 顶栏动作 · 版本（"保存"与"不同版本的选择"）────────────────────── */
	const onSaveVersion = () => {
		if (!doc) { setToast("没有可保存的图"); return; }
		/* 版本说明自动取「底栏对话里最近一条用户指令」—— 那正是"这次改了什么"的自然记录，
		 * 零额外输入成本；没有对话历史时留空，面板显示"（未写说明）"。 */
		const th = doc.thread || [];
		let lastUser = null;
		for (let i = th.length - 1; i >= 0; i--) { if (th[i] && th[i].role === DESIGN_ROLE.USER) { lastUser = th[i]; break; } }
		const note = lastUser ? String(lastUser.text || "").slice(0, 80) : "";
		const r = saveVersion(doc, note);
		if (!r) { setToast("保存失败"); return; }
		setToast(r.dropped
			? ("已保存 " + r.version.label + "（超出上限，已淘汰最早的 " + r.dropped + " 个）")
			: ("已保存 " + r.version.label));
	};

	const onRestoreVersion = (vid) => {
		if (!doc) return;
		const r = restoreVersion(doc.docId, vid);
		if (!r) { setToast("该版本不存在（可能已被删除）"); return; }
		setSelected(null);
		setPending(null);      // 待确认操作基于旧内容，回滚后必须作废（否则会"改到刚回滚的图上"）
		setVerOpen(false);
		setToast("已回到 " + r.from.label + (r.autoSaved ? "（当前样子已自动存档）" : ""));
	};

	const onDeleteVersion = (vid) => {
		if (!doc) return;
		if (deleteVersion(doc.docId, vid)) setToast("已删除该版本记录（当前图内容未变）");
		else setToast("版本不存在");
	};

	const onToggleVersions = () => setVerOpen((v) => !v);
	const onZoom = (delta) => setScale((s) => Math.max(0.2, Math.min(2, Number((s + delta).toFixed(2)))));
	/* 「适应」= 缩到容器放得下（与打开时的自动行为同一算法，用户手动可复现）；
	 * 「1:1」= 回到 100% 真实像素（审尺寸时用）。两者分开，避免"适应"点了却是 1000% 的困惑。 */
	const onFit = () => {
		try {
			const w = wrapRef.current ? wrapRef.current.clientWidth : 0;
			if (!w) { setScale(1); setToast("已回到 100%（容器尺寸未就绪）"); return; }
			const k = Math.max(0.2, Math.min(1, Number(((w - 40) / CANVAS_W).toFixed(2))));
			setScale(k);
			/* 🔴 必须给反馈：若当前已是 95% 而算出来也是 95%，**值不变 ⇒ 页面零变化**，
			 *    用户点完看到"什么都没发生"，判定为"按钮坏了"。
			 *    真机 sweep 里它是 14 个按钮中唯一"无任何状态变化"的一个 —— 实际是幂等而非故障，
			 *    但幂等必须靠文案讲明白，否则与故障在用户眼里没有区别。 */
			setToast("已适应容器：" + Math.round(k * 100) + "%（画布宽 " + CANVAS_W + "px）");
		} catch (e) { setScale(1); setToast("已回到 100%"); }
	};

	if (!open) return null;

	const stats = doc ? docStats(doc) : { total: 0, missingLogic: 0, thread: 0 };
	const groups = kindsByGroup();
	/* 版本状态一屏取（dirty 两态 + 角标数 + 面板文案都从这里出，一处算三处用） */
	const vstate = getVersionState(doc);
	/* 聚焦视图（N6）从**数据层**取，不在本组件里 filter ——
	 * 见 store/design.js `focusView()` 的说明：遮挡类缺陷的表现是
	 * "点了上面的按钮没反应"，必须在离线闸门里就能逐画面断言，而不是只能靠真机碰。 */
	const view = focusView(doc, focusScreen);

	return h("div", {
		id: STUDIO_ID, style: S.root, "data-testid": "ds-root", role: "dialog", "aria-label": "设计图工作室",
		/* 质感类：个性化里的三档纹理由 store/personalize.js 注入的样式表按
		 * `html[data-dp-texture=...] .dp-textured` 命中（伪元素 / background-image **无法**用 inline 写）。 */
		className: "dp-textured dp-overlay-in", "data-personalize-open": pOpen ? "1" : "0"
	}, [
		/* ══ 顶栏（D1 · 四区 + 安全区）══════════════════════════════════════════
		 * 🔴 安全区 —— 修用户报的「设计图的关闭按钮和标准软件的关闭按钮重叠了」：
		 *    Harness 桌面端右上角有**原生窗口控件覆盖层**（最小化/最大化/关闭），
		 *    真机实测：视口 1536、`getTitlebarAreaRect().width = 1399`
		 *    ⇒ **右侧 137px 不归网页管**，且它是原生图层、z-index 对它无效。
		 *    此前顶栏右内边距只有 10px，✕ 落在 x=1495（距右 41px）⇒ 必然被压住，
		 *    连右边那句「修订记录 2」也被压掉一截。
		 *    ⇒ 根治办法不是把 ✕ 左移几像素（那只是把洞挪个位置），而是让整条顶栏
		 *      `paddingRight = inset + 10`，所有内容排进安全区左侧。
		 *      inset 由 util/safe-area.js 三级读取（WCO API → env() → 桌面兜底）
		 *      并监听 resize / geometrychange 实时更新。
		 *
		 * 四区（用竖线分组 —— 9 个同款按钮连成一排，看不出哪几个是一伙的）：
		 *   ① 保存（按钮即状态）  ② 图管理  ③ 版本历史  ④ 视图   ⟶  统计 · 关闭
		 */
		h("div", {
			key: "top", style: { ...S.top, paddingRight: Math.max(10, inset + 10) }, "data-testid": "ds-top"
		}, [
			/* ── 域标识（V17 P0：用户始终知道自己在哪个域） ── */
			h("span", { key: "dom", style: { fontSize: "calc(10.5px * var(--dp-font))", fontWeight: 600, color: "#7fe3e8", marginRight: 4, letterSpacing: ".3px", whiteSpace: "nowrap" }, "data-testid": "ds-domain" }, "◈ 设计图"),
			/* ── ① 保存：**按钮即状态** ────────────────────────────────────────
			 * 脏（有未保存改动）= 主色实心「● 保存」（最需要被看见）
			 * 净（已保存）    = 绿色描边「✓ 已保存 vN」
			 * 两态**共用同一按钮、同一尺寸**：若做成"脏时才出现"，它一出现就把
			 * 右边的按钮整体挤走 ⇒ 用户点到的会是删除（删除就在旁边）。 */
			h("button", {
				key: "sv", "data-testid": "ds-save",
				style: { ...(vstate.dirty ? S.btnSave : S.btnSaved), opacity: doc ? 1 : 0.5 },
				title: "把当前这张图存成一个版本"
					+ (doc ? "（自动落盘代数 revision " + (doc.revision || 0) + "，那不是版本号）" : ""),
				onClick: onSaveVersion
			}, vstate.dirty ? "● 保存" : ("✓ 已保存" + (vstate.match ? " " + vstate.match.label : ""))),

			h("span", { key: "s1", style: S.sep }),

			/* ── ② 图管理 ────────────────────────────────────────────────────
			 * 重命名：点 ✎ 后把 <select> **原地换成输入框**，提交后布局不跳
			 * （Enter 提交 / Esc 取消 / 失焦提交 —— 三种退出路径都有，不把人卡在编辑态）。
			 * 🔴 这里曾写 `maxWidth: 200` 而输入框写 `width: 200` —— 两者**根本不同宽**：
			 *    select 的宽度由内容撑，真机实测只有 **146px**，输入框 200px，
			 *    差 **54px** ⇒ 点「✎ 改名」整条顶栏右移 54px，提交后又弹回 54px。
			 *    注释当时写的是"同宽 200，提交后布局不跳"，**承诺与实现不符**
			 *    （而 div 配平 / 单元测试 / el.click() 型 e2e 全都测不到"布局跳位"）。
			 *    ⇒ 改成 `width: 200` 硬锁。判据同 btnSaved：sweep 必须报"顶栏位移 0 个"。 */
			nameDraft == null
				? h("select", {
					key: "sel", "data-testid": "ds-doclist", "aria-label": "切换设计图", value: (doc && doc.docId) || "",
					onChange: (e) => { setActiveDoc(e.target.value); setSelected(null); setVerOpen(false); },
					style: { width: 200, flex: "0 0 auto", height: 26, fontSize: 11.5, borderRadius: 5, border: "1px solid #3d4148", background: "#212429", color: "#c3c8ce" }
				}, (st.docs || []).map((d) => h("option", { key: d.docId, value: d.docId }, d.title + "（" + (d.elements || []).length + "）")))
				: h("input", {
					key: "sel", "data-testid": "ds-docname", style: S.nameInput, value: nameDraft,
					autoFocus: true, "aria-label": "重命名设计图",
					onChange: (e) => setNameDraft(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter") { e.preventDefault(); onRenameCommit(); }
						else if (e.key === "Escape") { e.preventDefault(); onRenameCancel(); }
					},
					onBlur: onRenameCommit
				}),
			h("button", {
				key: "rn", style: S.btn, "data-testid": "ds-rename", "aria-label": "重命名设计图",
				title: nameDraft == null ? "重命名这张设计图" : "取消重命名",
				onClick: nameDraft == null ? onRenameStart : onRenameCancel
			}, "✎ 改名"),
			h("button", { key: "n", style: S.btn, "data-testid": "ds-new", "aria-label": "新建设计图", title: "新建一张设计图（自带标准框架 20 元素）", onClick: onNewDoc }, "＋ 新建图"),
			/* V17 P2-2：窄窗口时复制/重载框架/导出收入「更多」菜单 */
			narrow ? h("div", { key: "more", style: { position: "relative", display: "inline-block" } }, [
				h("button", { key: "mb", style: S.btn, "data-testid": "ds-more", "aria-label": "更多操作", "aria-expanded": moreOpen, onClick: (e) => { e.stopPropagation(); setMoreOpen((v) => !v); } }, "更多 ▾"),
				moreOpen ? h("div", {
					key: "menu", style: { position: "absolute", top: "100%", left: 0, zIndex: 50, background: "#212429", border: "1px solid #3d4148", borderRadius: 6, padding: "4px 0", minWidth: 130, boxShadow: "0 6px 20px rgba(0,0,0,.4)" },
					"data-testid": "ds-more-menu",
					onMouseLeave: () => setMoreOpen(false)
				}, [
					h("button", { key: "cp", style: { ...S.btn, display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0 }, "data-testid": "ds-dup-doc", title: "复制这张设计图（内容带走，版本历史不带）", onClick: (e) => { e.stopPropagation(); setMoreOpen(false); onDuplicateDoc(); } }, "⧉ 复制"),
					h("button", { key: "f", style: { ...S.btn, display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0 }, "data-testid": "ds-frame", title: "把标准框架重新铺一遍（会覆盖当前图内容）", onClick: (e) => { e.stopPropagation(); setMoreOpen(false); onLoadFrame(); } }, "↺ 重载框架"),
					h("button", { key: "ex", style: { ...S.btn, display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 0 }, "data-testid": "ds-export", title: "把这张图（含每个元素的逻辑）复制成 JSON", onClick: (e) => { e.stopPropagation(); setMoreOpen(false); onExportJson(); } }, "导出 JSON")
				]) : null
			]) : [
				h("button", { key: "cp", style: S.btn, "data-testid": "ds-dup-doc", "aria-label": "复制设计图", title: "复制这张设计图（内容带走，版本历史不带）", onClick: onDuplicateDoc }, "⧉ 复制"),
				h("button", { key: "f", style: S.btn, "data-testid": "ds-frame", "aria-label": "重载标准框架", title: "把标准框架重新铺一遍（会覆盖当前图内容）", onClick: onLoadFrame }, "↺ 重载框架"),
				h("button", { key: "ex", style: S.btn, "data-testid": "ds-export", "aria-label": "导出设计图 JSON", title: "把这张图（含每个元素的逻辑）复制成 JSON", onClick: onExportJson }, "导出")
			],
			/* 危险动作只保留一个（删图）。原文案「🗑」是**彩色 emoji**，与同排的单色字形
			 * （✎ / ⧉ / ↺）割裂；且 emoji 不继承 currentColor ⇒ btnDanger 的红色对它无效。
			 * 改文字后颜色与描边真正生效，红=危险 的语义才传得到。
			 * 上膛态换「确认」而非「确认删除」：**同为 2 字 ⇒ 宽度不变**，
			 * 既让"这一下点到了"肉眼可见，又不把右边的版本/缩放按钮推走。 */
			h("button", {
				key: "del",
				style: doc ? (delArmed ? S.btnDangerArmed : S.btnDanger) : S.btn,
				"data-testid": "ds-del-doc", "data-armed": delArmed ? "1" : "0",
				"aria-label": delArmed ? "确认删除设计图" : "删除设计图",
				title: delArmed ? "再点一次即永久删除（不可撤销）" : "删除这张设计图（点两次确认，不可撤销）",
				onClick: onDeleteDoc
			}, delArmed ? "确认" : "删除"),

			h("span", { key: "s2", style: S.sep }),

			/* ── ③ 版本历史 ────────────────────────────────────────────────────
			 * 锁宽：`版本 0`(54px) ↔ `版本 30`(+6px) 会把右边的缩放组推着走。
			 * 🔴 这条差点漏掉 —— 第一次改的时候 new_string 里把 minWidth 写丢了，
			 *    真机 computed 仍是 `minWidth: auto`、宽度 53.95px。
			 *    为什么没被现有断言抓到：**宽度只在文字真的变长时才暴露**，
			 *    而一次验证里版本号不会从 1 涨到 30 ⇒ 永远测不到。
			 *    故 e2e 补了 C16.9：用"临时替换文字量宽度"的方式，把每个会变文字的按钮
			 *    **在极值文案下全部量一遍**，不依赖运行中出现那个数字。 */
			h("button", {
				key: "v", style: { ...S.btn, minWidth: 74, textAlign: "center", boxSizing: "border-box" },
				"data-testid": "ds-ver-toggle", "aria-label": "历史版本",
				title: "历史版本：选任一个回到当时的样子（回滚前会自动存档当前）",
				onClick: onToggleVersions
			}, "版本 " + vstate.count),

			h("span", { key: "s3", style: S.sep }),

			/* ── ④ 视图 ────────────────────────────────────────────────────────
			 * 顺序按行业惯例把数值**夹在中间**（－ 95% ＋）：原先是「－ ＋ 95%」，
			 * 两个方向键并排、数值甩到右边，读起来像"两个按钮 + 一个标签"而不是一组缩放。 */
			h("button", { key: "zo", style: S.btn, "data-testid": "ds-zoom-out", "aria-label": "缩小", title: "缩小", onClick: () => onZoom(-0.1) }, "－"),
			h("span", {
				key: "zs", "data-testid": "ds-zoom", "aria-live": "polite",
				/* 锁宽：`95%`(3 字) ↔ `100%`(4 字) 差 6px，会把右边的「＋ / 适应 / 1:1」推着走 */
				style: { ...S.muted, display: "inline-block", minWidth: 40, textAlign: "center", boxSizing: "border-box" }
			}, Math.round(scale * 100) + "%"),
			h("button", { key: "zi", style: S.btn, "data-testid": "ds-zoom-in", "aria-label": "放大", title: "放大", onClick: () => onZoom(0.1) }, "＋"),
			h("button", { key: "zf", style: S.btn, "data-testid": "ds-zoom-fit", "aria-label": "适应容器", title: "缩到容器放得下", onClick: onFit }, "适应"),
			h("button", { key: "z1", style: S.btn, "data-testid": "ds-zoom-100", "aria-label": "回到 100%", title: "回到 100% 真实像素", onClick: () => setScale(1) }, "1:1"),

			/* ── 统计（revision 转入 title —— 它此前被当成"版本号"展示，实际是自动落盘代数）──
			 * 版本数**只出现在「版本 N」按钮上**：同屏两处显示同一个数字，除了占位没有信息量，
			 * 还会让人以为是两个不同的计数器。 */
			h("span", {
				key: "st",
				/* 锁定最小宽度 + 右对齐：统计条靠 `marginLeft:auto` 贴最右，元素数变化只会让它**向左**膨胀
				 * （不影响任何按钮的可点性），但文字会左右跳一下；锁宽后连这一下也消失。 */
				style: { ...S.muted, marginLeft: "auto", minWidth: 110, textAlign: "right", boxSizing: "border-box" },
				"data-testid": "ds-stats",
				"data-revision": (doc && doc.revision) || 0,
				"data-version-count": vstate.count,
				title: "自动落盘代数 revision " + ((doc && doc.revision) || 0) + "（每次写库 +1，不是版本号）"
			}, "元素 " + stats.total + " · 逻辑缺口 " + stats.missingLogic),

			/* ── ⑤ 个性化（右上角）─────────────────────────────────────────────
			 * 用户要求「都在右上角加自定义个性化设定」⇒ 本按钮与总监页 / 总监弹窗 /
			 * 分支导图上的那个是**同一个面板**（同一份 localStorage、同一批 CSS 变量）。
			 * 🔴 位置：统计与 ✕ **之间**，整条顶栏仍受 `paddingRight = inset + 10` 约束
			 *    ⇒ 按钮自动落在原生窗口控件左侧，不会重演"✕ 被盖住"。 */
			h("button", {
				key: "pz", style: S.btn, "data-testid": "ds-personalize",
				"aria-label": "个性化设定", "data-on": pOpen ? "1" : "0",
				title: "个性化设定：主色 / 质感 / 密度 / 字号 / 圆角（与总监页 / 弹窗 / 导图共用同一份）",
				onClick: () => setPOpen((v) => !v)
			}, "⚙ 设置"),

			/* 关闭按钮 —— 现在位于安全区左侧（原位置被原生窗口按钮盖住） */
			h("button", {
				key: "x", style: S.btn, "data-testid": "ds-close", "aria-label": "关闭设计图工作室",
				title: "关闭（Esc 逐层退）", onClick: onClose
			}, "✕")
		]),

		/* ── 导出兜底浮层（仅在系统剪贴板被拒时出现）──
		 * 桌面壳里 navigator.clipboard 会 reject，execCommand 也可能被拒；
		 * 此时**把 JSON 摆出来**远比报一句"复制失败"有用：功能至少要能把数据交到用户手上。 */
		exportText == null ? null : h("div", { key: "exp", style: S.exportWrap, "data-testid": "ds-export-panel" }, [
			h("div", { key: "h", style: S.exportHead }, "导出 JSON · " + exportText.length + " 字符 · 系统剪贴板不可用，请点框内全选复制"),
			h("textarea", {
				key: "ta", "data-testid": "ds-export-text", style: S.exportArea, value: exportText, readOnly: true,
				onFocus: (e) => { try { e.target.select(); } catch (err) { /* 选中失败也不影响手动复制 */ } },
				onKeyDown: (e) => { if (e.key === "Escape") { e.preventDefault(); setExportText(null); } }
			}),
			h("button", { key: "c", style: S.btn, "data-testid": "ds-export-close", onClick: () => setExportText(null) }, "关闭")
		]),

		/* ── 工具栏（D2）──
		 * 工具栏也留安全区：原生窗口控件高 44px > 顶栏 40px，会向下溢出 4px，
		 * 若工具栏首行右端正好有按钮就会被压 ⇒ 一并避让（右侧本为空白，代价为零）。 */
		h("div", { key: "kinds", style: { ...S.kindBar, paddingRight: Math.max(10, inset + 10) }, "data-testid": "ds-kinds" },
			Object.keys(groups).map((g) => h("div", { key: g, style: S.kgroup }, [
				// 组标题直接用该组的分组色 ⇒ 工具栏本身就是画布的图例（无需另加 legend 行）
				h("span", { key: "l", style: { ...S.kglabel, color: gc(g).text, fontWeight: 650 }, "data-testid": "ds-kglabel-" + g }, "● " + g),
				...groups[g].map((k) => h("button", {
					key: k,
					style: { ...S.kbtn, borderLeft: "2px solid " + gc(g).base },
					"data-testid": "ds-add-" + k, title: (ELEMENT_KINDS[k].logic && ELEMENT_KINDS[k].logic.action) || "",
					onClick: () => onAddKind(k)
				}, [h("span", { key: "i" }, ELEMENT_KINDS[k].icon), h("span", { key: "t" }, ELEMENT_KINDS[k].label)]))
			]))),

		/* ── 中段：左栏 + 画布 ── */
		h("div", { key: "mid", style: S.mid }, [
			h("div", { key: "l", style: S.left }, [
				/* 上段 · 结构大纲（画面 → 层 → 元素）
				 * 🔴 与逻辑面板**同时存在**而不是二选一 Tab：
				 *    选中是随时发生的，若逻辑面板藏在另一个页签后面，
				 *    "选中 → 看逻辑"就从 1 次点击变成 2 次，且既有断言（C9.1）会假红。 */
				h(OutlinePanel, {
					key: "ol", doc, selected, focusScreen,
					onFocus: setFocusScreen,
					onSelect: setSelected,
					onFlags: (id, p) => commit(setElementFlags(getActiveDoc(), id, p)),
					onReorder: (id, dir) => commit(reorderInScreen(getActiveDoc(), id, dir)),
					onScreenHidden: (sc, hid) => commit(setScreenHidden(getActiveDoc(), sc, hid))
				}),
				h("div", { key: "lh", style: S.leftHead }, [
					h("span", { key: "t", style: { fontWeight: 650, fontSize: 11.5 } }, "元素交互逻辑"),
					h("span", { key: "s", style: { ...S.muted, marginLeft: "auto" } }, selected ? selected : "未选中")
				]),
				h(LogicPanel, {
					key: "lb", doc, selected,
					onLogicChange: (k, v) => commit(updateLogic(getActiveDoc(), selected, { [k]: v })),
					onRelabel: (v) => commit(updateElement(getActiveDoc(), selected, { label: v })),
					onDelete: () => commit(removeElement(getActiveDoc(), selected)),
					onDuplicate: () => commit(duplicateElement(getActiveDoc(), selected)),
					onReorder: (w) => commit(reorderElement(getActiveDoc(), selected, w))
				})
			]),
			h("div", { key: "c", style: S.canvasWrap, ref: wrapRef, "data-testid": "ds-canvas-wrap" },
				h("div", {
					key: "g", ref: gridRef, style: { ...S.grid, transform: "scale(" + scale + ")", transformOrigin: "top left" },
					"data-testid": "ds-canvas", "data-focus": focusScreen,
					onPointerDown: () => setSelected(null) // 点空白 = 取消选中
				}, [
					/* 聚焦时：非当前画面的元素先画成**淡影**（有序、在最下层），
					 * `pointerEvents:none` + 不带 `data-testid=ds-el` ⇒
					 * 它们既不被命中、也不被元素计数算进去 —— 这就是"跨画面遮挡归零"的落点。 */
					...view.ghost
						.map((el) => h("div", {
							key: "ghost-" + el.id, style: { ...S.elGhost, left: el.x, top: el.y, width: el.w, height: el.h },
							"data-testid": "ds-ghost", "data-el-id": el.id
						}, h("span", { key: "t", style: { fontSize: 10.5 } }, (ELEMENT_KINDS[el.kind] || {}).icon + " " + el.label))),
					...view.interactive
						.map((el) => h("div", {
							key: el.id,
							/* 🔴 坐标必须写进 `style`（2026-09-12 真机事故 · 单点故障复盘）：
							 *   原写法把 `left / top / width / height / transform` 放在 **props 顶层**，
							 *   它们不是合法 DOM 属性 ⇒ React 不当作 CSS ⇒ **坐标被静默丢弃**
							 *   ⇒ 元素退回文档流按顺序堆叠（`getComputedStyle().transform === "none"`）。
							 *   后果：拖拽 / 缩放 / 方向键在**数据层完全正确**（回读 model 已改），
							 *   但 DOM 纹丝不动 ⇒ 表现为"四个交互全坏"，实际只有这一行在坏。
							 *   本轮 e2e 的 C4.1（拖拽位移断言）正是靠"比对 DOM 实际位移"抓到了它。
							 *   判据：**只要模型改了而 getBoundingClientRect 不变，就先查 style 有没有生效**。 */
							style: {
								...S.el(selected === el.id, el.kind),
								left: el.x, top: el.y, width: el.w, height: el.h,
								/* 锁定态给一个可见的实线边框差异 —— 拖不动但看不出为什么 = 说不清的缺陷 */
								...(el.locked ? { outline: "1px dashed #d29922", outlineOffset: -1 } : null),
								/* 🔴 base 层 = 背景板，**不接收画布指针事件**。
								 *   本缺陷的现场（2026-09-14 真机，verify-design-studio C5.0）：
								 *     整屏底板 `window`（0,0 1180×644）铺满整个画布 ⇒ 它成了
								 *     "点哪儿都命中它"的元素。于是：
								 *       ① 想点空白取消选中 → 选中的是底板（`selected = el-2-win`）；
								 *       ② 底板同时是 **locked**，键盘守卫随之 early-return
								 *          ⇒ 方向键 / Ctrl+D / Delete **一条都不生效**，
								 *          后续 C5.1 / C8.4 / C12.1–C12.4 六条连锁红，
								 *          而每条的现场读数都指向"功能坏了"，与真因隔了两层；
								 *       ③ 用户侧的表现就是原始需求里那句话 ——「元素层层堆叠，
								 *          我不知道该从哪些部分改」：他点到的永远是**最底下那层背景**。
								 *   修法取"正交"而非"特判"：**按层判定**，凡 base 层一律不参与画布命中，
								 *     与具体是 window 还是 canvas 无关（两者都是背景板）。
								 *     点空白于是回到 `ds-canvas` 网格自己的 onPointerDown ⇒ 正常取消选中。
								 *   底板**仍然可选中** —— 从**结构大纲**里点它那一行即可（那里是"看它的逻辑 /
								 *     解锁 / 改显示"的正确入口），只是不再从画布上抢点击。
								 *   ⚠️ 不要改成 `display:none` 或从 `visibleElements` 里剔除：
								 *     底板是**看得见的**背景，删掉它整幅图会失去底色，
								 *     且会破坏 N1（画面全覆盖）与 C10.1（元素计数）两条既有判据。 */
								...(layerOf(el) === "base" ? { pointerEvents: "none" } : null)
							},
							"data-testid": "ds-el", "data-el-id": el.id, "data-el-kind": el.kind,
							"data-el-locked": el.locked ? "1" : "0",
							"data-el-layer": layerOf(el),
							title: el.id + " · " + (ELEMENT_KINDS[el.kind] || {}).label + " · " + ((el.logic && el.logic.action) || "")
								+ (el.locked ? "（已锁定）" : "")
								+ (layerOf(el) === "base" ? "（背景板：从左侧结构大纲点选）" : ""),
							/* base 层不挂指针处理器：`pointerEvents:none` 已保证它收不到事件，
							 * 这里再显式不绑，避免"读代码以为它能拖动"。 */
							onPointerDown: layerOf(el) === "base" ? undefined : (e) => onElPointerDown(e, el, "move")
						}, [
							h("span", { key: "t", style: { pointerEvents: "none", lineHeight: 1.35 } }, (ELEMENT_KINDS[el.kind] || {}).icon + " " + el.label),
							selected === el.id ? h("div", {
								key: "h", style: S.elHandle(el.kind), "data-testid": "ds-handle",
								onPointerDown: (e) => onElPointerDown(e, el, "resize")
							}) : null
						]))
				])
			)
		]),

		/* ── 底栏（D6）── */
		h(ThreadBar, {
			key: "b", doc: doc || { thread: [], title: "" }, draft, setDraft, pending,
			onCommit: onSubmitThread,          // 发送：解析指令 → 生成待确认
			onApply: onApplyPending,           // 应用到图：真正落库（两个入口共用）
			onDiscard: () => { setPending(null); setToast("已丢弃"); },
			onExportDSL: onExportDSL           // 导出给 AI 读的结构 DSL（V20 §E）
		}),
		pending && pending.ops.length ? h("div", {
			key: "apply", style: { position: "absolute", right: 14, bottom: 150, display: "flex", gap: 6 }
		}, [h("button", { key: "a", style: S.btnPri, "data-testid": "ds-apply-fab", onClick: onApplyPending }, "应用 " + pending.ops.length + " 项")]) : null,
		/* ── 版本历史面板（顶栏「🕘 版本 N」拉起）──
		 * key 放在 props 里由 React 提取；面板自身 `open=false` 时返回 null。 */
		h(VersionPanel, {
			key: "ver", doc, versions, open: verOpen, inset, limit: VERSION_LIMIT,
			onClose: () => setVerOpen(false),
			onRestore: onRestoreVersion,
			onDelete: onDeleteVersion
		}),

		toast ? h("div", {
			key: "toast", style: {
				/* 🔴 位置修正（2026-09-12 审美审核 · 截图取证）：
				 *   原为 `left:12, bottom:12` ⇒ 正好压在底栏「输入框 + 发送」那一行上
				 *   （底栏 minHeight 96，输入行占最下 ~42px）⇒ 提示遮住用户刚要敲的输入框。
				 *   改为**顶部居中浮动药丸**：既避开底栏（高度可变，无法用固定 bottom 绕开），
				 *   又落在视线正上方（视线从画布收回时先经过顶部）。
				 *   同批修正：原 toast **永不自动消失**（只有手点才清），现 2.2s 自动淡出，
				 *   且 `pointerEvents:none` 不挡点击（原写法会吃掉底栏那一片的点击）。 */
				position: "absolute", top: 48, left: "50%", transform: "translateX(-50%)",
				padding: "6px 14px", borderRadius: 999, pointerEvents: "none", maxWidth: "60%",
				background: "rgba(47,111,235,.92)", border: "1px solid rgba(159,194,255,.55)",
				color: "#fff", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap",
				overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 6px 22px rgba(0,0,0,.55)"
			}, "data-testid": "ds-toast"
		}, toast) : null,

		/* 个性化面板 —— 顶栏 40px ⇒ 面板从 46px 起落，正好压在顶栏下方、贴着右上角。
		 * `inset` 由本组件已持有的真机安全区值传入（见 util/safe-area.js），
		 * 面板内部会算 `right = max(10, inset + 10)`，不会钻到原生窗口按钮下面。 */
		h(PersonalizePanel, {
			key: "pp", open: pOpen, onClose: () => setPOpen(false),
			inset: inset, top: 46, scope: "设计图"
		})
	]);
}

export default DesignStudio;
