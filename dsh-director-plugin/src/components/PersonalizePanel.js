/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：右上角「⚙ 个性化」面板（四个界面共用一个组件）
 * 引用：—
 * 上游：client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js
 * 下游：store/personalize.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/PersonalizePanel.js — 右上角「⚙ 个性化」面板（四个界面共用一个组件）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  需求原文（用户）：「目前总监 tap 页面，还有三个插件页面 文字背景，全部找审美
 *   重新审核一下质感加上，同时都在右上角加自定义个性化设定」
 *
 *  ⇒ 落地口径：四处（总监页 / 总监弹窗 / 设计图工作室 / 分支导图）**右上角是同一个
 *    组件、同一批选项、同一份持久化**。这样"改一次，四处都变"是可验证的；
 *    若各写一份，迟早出现"设计图里改了但导图没变"。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 三条实现纪律
 * ══════════════════════════════════════════════════════════════════
 *  ① **必须避让窗口控件安全区**：本面板贴右上角，而 Windows 的最小化/最大化/关闭是
 *     **操作系统图层**（z-index 无效，实测 138px）。所以面板的 `right` 由传进来的
 *     `inset` 决定 —— 与 MindMap 顶栏同一套口径（util/safe-area.js）。
 *  ② **每个选项都要说清"改了什么"**：`title` 写明效果，不写空话（本项目纪律：
 *     用户反复投诉"点了不知道有没有生效"）。
 *  ③ **即时生效 + 可一键复位**：改完立刻写 CSS 变量（无需确认）；"恢复默认"必须存在，
 *     否则用户改乱了回不去（这是上一轮版本面板吃过的教训）。
 *
 * ⚠️ 构建约束：react / react/jsx-runtime 为平台冻结模块（ADR-001），构建期外置。
 */

import * as react from "react";
import {
	personalizeStore, P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE, P_DIALOG_BG, P_DEFAULTS,
	readImageAsDataUrl
} from "../store/personalize.js";

const h = react.createElement;
export const PERSONALIZE_PANEL_ID = "dsh-personalize-panel";

const S = {
	wrap: (right, top) => ({
		position: "fixed", right, top, zIndex: 2147483300, width: 296, maxHeight: "calc(100vh - " + (top + 16) + "px)",
		overflowY: "auto", display: "flex", flexDirection: "column", gap: 0,
		background: "var(--dp-bg-1, #141519)", border: "1px solid var(--dp-line, #31343a)",
		borderRadius: "var(--dp-radius-lg, 12px)", boxShadow: "var(--dp-shadow, 0 10px 30px rgba(0,0,0,.45))",
		color: "var(--dp-t1, #e8eaed)", fontSize: "calc(12px * var(--dp-font, 1))", padding: 10
	}),
	hd: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8 },
	ttl: { fontWeight: 650, fontSize: "calc(12.5px * var(--dp-font, 1))" },
	sec: { marginBottom: 9 },
	secT: { fontSize: "calc(10.5px * var(--dp-font, 1))", color: "var(--dp-t3, #8b9199)", letterSpacing: ".4px", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 },
	row: { display: "flex", flexWrap: "wrap", gap: 5 },
	opt: (on, big) => ({
		display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer",
		padding: big ? "4px 8px" : "3px 7px", borderRadius: "var(--dp-radius-sm, 5px)",
		fontSize: "calc(11px * var(--dp-font, 1))",
		border: "1px solid " + (on ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
		background: on ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, #1c1e23)",
		color: on ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)",
		fontWeight: on ? 600 : 400, whiteSpace: "nowrap"
	}),
	swatch: (on, hex) => ({
		width: 26, height: 20, borderRadius: "var(--dp-radius-sm, 5px)", background: hex, cursor: "pointer",
		border: on ? "2px solid var(--dp-t1, #e8eaed)" : "1px solid var(--dp-line, #31343a)", boxSizing: "border-box"
	}),
	/* 取色器的一项：外框和 opt 一致，里面塞一个原生 color input（点哪都能开色盘） */
	pick: (on) => ({
		display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
		padding: "2px 7px", borderRadius: "var(--dp-radius-sm, 5px)",
		fontSize: "calc(11px * var(--dp-font, 1))",
		border: "1px solid " + (on ? "var(--dp-ac-line, rgba(47,111,235,.45))" : "var(--dp-line, #31343a)"),
		background: on ? "var(--dp-ac-soft, rgba(47,111,235,.16))" : "var(--dp-bg-2, #1c1e23)",
		color: on ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)", fontWeight: on ? 600 : 400
	}),
	toggle: (on) => ({
		display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
		padding: "3px 8px", borderRadius: "var(--dp-radius-sm, 5px)",
		fontSize: "calc(11px * var(--dp-font, 1))",
		border: "1px solid var(--dp-line, #31343a)", background: "var(--dp-bg-2, #1c1e23)",
		color: on ? "var(--dp-t1, #e8eaed)" : "var(--dp-t3, #8b9199)"
	}),
	foot: { display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--dp-line, #31343a)" }
};

function Section({ title, hint, children }) {
	return h("div", { style: S.sec }, [
		h("div", { key: "t", style: S.secT }, [h("span", { key: "l" }, title), hint ? h("span", { key: "h", style: { opacity: 0.75 } }, hint) : null]),
		h("div", { key: "b", style: S.row }, children)
	]);
}

/**
 * 个性化面板。
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number} [props.inset] 右侧原生窗口控件覆盖宽度（默认 0，来自 util/safe-area）
 * @param {number} [props.top] 面板上边距（默认 44，避开各界面自己的顶栏）
 * @param {string} [props.scope] 调用方名称（显示在标题右侧，e2e 用来确认"四处同一个面板"）
 */
export function PersonalizePanel(props = {}) {
	const { open, onClose, inset = 0, top = 44, scope = "" } = props;
	const p = react.useSyncExternalStore(
		(fn) => personalizeStore.subscribe(fn),
		() => personalizeStore.getState(),
		() => personalizeStore.getState()
	);

	/* 背景图：文件选择 → 压缩 → 落库。
	 * 🔴 必须把"存不上"讲出来（配额满 / 图片过大）：savePersonalize 失败是**静默**的，
	 *    不讲的话用户会以为换成功了，重启一看还是旧图 —— 本项目纪律 54「静默半成功更坏」。 */
	const fileRef = react.useRef(null);
	const [bgMsg, setBgMsg] = react.useState("");
	const onPickFile = react.useCallback((e) => {
		const f = e && e.target && e.target.files ? e.target.files[0] : null;
		if (e && e.target) e.target.value = "";
		if (!f) return;
		setBgMsg("正在压缩图片…");
		readImageAsDataUrl(f).then((url) => {
			if (!url) { setBgMsg("图片处理失败：换一张 JPG / PNG 再试"); return; }
			const ok = personalizeStore.set("dialogBgImage", url);
			setBgMsg(ok
				? "已应用背景图 · " + Math.round(url.length / 1024) + " KB（仅存本机）"
				: "保存失败：本地存储空间不足，换一张更小的图");
		});
	}, []);

	/* Esc 关闭 —— 与导图/工作室的"逐层退"一致：本面板在最上层，先关它 */
	react.useEffect(() => {
		if (!open) return undefined;
		const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose && onClose(); } };
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open, onClose]);

	if (!open) return null;

	const set = (k, v) => personalizeStore.set(k, v);
	const swatchRow = (list, cur, key) => list.map((o) => h("div", {
		key: o.key, "data-testid": "pp-" + key + "-" + String(o.key).replace("#", ""), "data-on": String(o.key) === String(cur) ? "1" : "0",
		style: S.swatch(String(o.key) === String(cur), o.key), title: o.label + (o.desc ? " —— " + o.desc : ""),
		"data-label": o.label,
		onClick: () => set(key, o.key)
	}));
	const optionRow = (list, cur, key) => list.map((o) => h("div", {
		key: String(o.key), "data-testid": "pp-" + key + "-" + String(o.key), "data-on": String(o.key) === String(cur) ? "1" : "0",
		style: S.opt(String(o.key) === String(cur)), title: o.desc || o.label,
		onClick: () => set(key, o.key)
	}, o.label));

	return h("div", {
		id: PERSONALIZE_PANEL_ID, style: S.wrap(Math.max(10, inset + 10), top),
		"data-testid": "pp-panel", "data-scope": scope, "data-inset": inset, role: "dialog", "aria-label": "个性化设定"
	}, [
		/* 标题栏 */
		h("div", { key: "hd", style: S.hd }, [
			h("span", { key: "i" }, "⚙"),
			h("span", { key: "t", style: S.ttl }, "个性化设定"),
			h("span", { key: "s", style: { ...S.secT, marginBottom: 0 } }, scope ? "· " + scope : ""),
			h("button", {
				key: "x", style: { ...S.opt(false) }, "data-testid": "pp-close", "aria-label": "关闭个性化设定",
				title: "关闭（Esc 亦可）", onClick: () => onClose && onClose()
			}, "✕")
		]),

		h(Section, {
			key: "ac", title: "主色", hint: "按钮 / 徽章 / 连线高亮",
			children: swatchRow(P_ACCENTS, p.accent, "accent")
		}),
		h(Section, {
			key: "ac2", title: "强调色", hint: "「待审 / 建议」类徽章",
			children: swatchRow(P_ACCENT2, p.accent2, "accent2")
		}),
		h(Section, {
			key: "tx", title: "质感", hint: "背景纹理 —— 这一项就是用户说的「文字背景」",
			children: optionRow(P_TEXTURES, p.texture, "texture")
		}),
		/* ── 总监弹窗背景 ──
		 * 用户原话：「左侧点击总监按钮，总监的弹窗，背景是黑色的。按人眼最舒服温馨的风格调整
		 *   背景和文字的颜色；同时增加自定义背景颜色的选项，可以上传图片作为背景；
		 *   默认的话可以跟随软件的背景主题」
		 * 四档 + 取色器 + 传图 + 遮罩浓度。**只有弹窗受它影响**，所以 hint 里写明范围，
		 * 否则用户会以为"改了没生效"（总监页/导图/工作室各有各的宿主桥接，不由这一档管）。 */
		h(Section, {
			key: "dlg", title: "总监弹窗背景", hint: "只改总监弹窗（左侧「总监」开的那一扇）· 文字按底色自动配深浅",
			children: [
				optionRow(P_DIALOG_BG, p.dialogBg, "dlgbg"),
				h("label", {
					key: "col", style: S.pick(p.dialogBg === "custom"), "data-testid": "pp-dlgbg-color-wrap",
					title: "自选底色；点开色盘即切到「自定义」档（文字深浅按底色亮度自动配，保证看得清）"
				}, [
					h("span", { key: "l" }, "底色"),
					h("input", {
						key: "i", type: "color", value: p.dialogBgColor, "data-testid": "pp-dlgbg-color",
						"aria-label": "自定义弹窗底色",
						style: { width: 26, height: 20, border: "none", background: "transparent", padding: 0, cursor: "pointer" },
						onChange: (e) => personalizeStore.patch({ dialogBg: "custom", dialogBgColor: e.target.value })
					})
				]),
				h("div", {
					key: "up", style: S.opt(p.dialogBgImage ? "1" : "0"), "data-testid": "pp-dlgbg-upload",
					title: "选一张本地图片：自动压到 1920px 内并转 JPEG 后存本机（不上传）；卡片会变半透明让图透出来",
					onClick: () => { if (fileRef.current) fileRef.current.click(); }
				}, p.dialogBgImage ? "换一张图" : "上传图片"),
				p.dialogBgImage ? h("div", {
					key: "clr", style: S.opt(false), "data-testid": "pp-dlgbg-clear",
					title: "只移除图片，底色方案保留",
					onClick: () => { personalizeStore.set("dialogBgImage", ""); setBgMsg("已移除背景图"); }
				}, "移除图片") : null,
				h("input", {
					key: "f", ref: fileRef, type: "file", accept: "image/*",
					"data-testid": "pp-dlgbg-file", "aria-label": "选择弹窗背景图片",
					style: { display: "none" }, onChange: onPickFile
				})
			]
		}),
		/* 遮罩浓度：只在有图时出现 —— 它是"照片与文字"的唯一权衡旋钮，默认 72% 已够读 */
		p.dialogBgImage ? h("div", { key: "dlgdim", style: { ...S.sec, display: "flex", alignItems: "center", gap: 6 } }, [
			h("span", { key: "l", style: { ...S.secT, marginBottom: 0, whiteSpace: "nowrap" } }, "图片遮罩"),
			h("input", {
				key: "r", type: "range", min: 0, max: 95, step: 1, value: Math.round(p.dialogBgDim * 100),
				"data-testid": "pp-dlgbg-dimrange", "aria-label": "图片遮罩浓度",
				style: { flex: 1, minWidth: 60, accentColor: "var(--dp-ac, #2f6feb)" },
				onChange: (e) => personalizeStore.set("dialogBgDim", Number(e.target.value) / 100)
			}),
			h("span", {
				key: "v", "data-testid": "pp-dlgbg-dimval",
				style: { ...S.secT, marginBottom: 0, width: 34, textAlign: "right" }
			}, Math.round(p.dialogBgDim * 100) + "%")
		]) : null,
		bgMsg ? h("div", {
			key: "dlgmsg", "data-testid": "pp-dlgbg-msg",
			style: { ...S.secT, marginBottom: 6, color: "var(--dp-t2, #c3c8ce)", whiteSpace: "normal" }
		}, bgMsg) : null,
		h(Section, {
			key: "dn", title: "密度", hint: "行高与间距的整体乘数",
			children: optionRow(P_DENSITY, p.density, "density")
		}),
		h(Section, {
			key: "ft", title: "字号",
			children: optionRow(P_FONT, p.fontScale, "fontScale")
		}),
		h(Section, {
			key: "rd", title: "圆角",
			children: optionRow(P_RADIUS, p.radius, "radius")
		}),
		h(Section, {
			key: "eg", title: "导图连线", hint: "只影响分支导图",
			children: optionRow(P_EDGE, p.edge, "edge")
		}),

		/* 开关组 */
		h("div", { key: "tg", style: S.sec }, [
			h("div", { key: "t", style: S.secT }, "显示与动效"),
			h("div", { key: "b", style: S.row }, [
				h("div", {
					key: "mo", "data-testid": "pp-motion", "data-on": p.motion ? "1" : "0", style: S.toggle(p.motion),
					title: "关掉后所有动画与过渡停止（低端机 / 录屏时有用）",
					onClick: () => set("motion", !p.motion)
				}, [h("span", { key: "i" }, p.motion ? "◉" : "○"), h("span", { key: "l" }, "动效")]),
				h("div", {
					key: "mm", "data-testid": "pp-minimap", "data-on": p.minimap ? "1" : "0", style: S.toggle(p.minimap),
					title: "分支导图右下角的小地图（省屏时可关）",
					onClick: () => set("minimap", !p.minimap)
				}, [h("span", { key: "i" }, p.minimap ? "◉" : "○"), h("span", { key: "l" }, "小地图")]),
				h("div", {
					key: "lg", "data-testid": "pp-legend", "data-on": p.legend ? "1" : "0", style: S.toggle(p.legend),
					title: "分支导图工具条右侧的状态图例",
					onClick: () => set("legend", !p.legend)
				}, [h("span", { key: "i" }, p.legend ? "◉" : "○"), h("span", { key: "l" }, "状态图例")])
			])
		]),

		/* 底部：说明 + 复位 */
		h("div", { key: "ft", style: S.foot }, [
			h("span", {
				key: "n", style: { ...S.secT, marginBottom: 0, flex: 1 },
				"data-testid": "pp-summary"
			}, "四处共用 · " + p.texture + " / " + Math.round(p.density * 100) + "% / r" + p.radius
				+ " · 弹窗 " + p.dialogBg + (p.dialogBgImage ? " + 图" : "")),
			h("button", {
				key: "r", style: S.opt(false), "data-testid": "pp-reset",
				title: "恢复默认：" + P_DEFAULTS.texture + " / r" + P_DEFAULTS.radius + " / " + P_DEFAULTS.accent,
				onClick: () => personalizeStore.reset()
			}, "恢复默认")
		])
	]);
}

export default PersonalizePanel;
