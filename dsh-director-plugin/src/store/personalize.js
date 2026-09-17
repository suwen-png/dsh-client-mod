/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：个性化设定（右上角「⚙ 个性化」的单一真相源）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, components/MindMap.js, components/PersonalizePanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/personalize.js — 个性化设定（右上角「⚙ 个性化」的单一真相源）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  需求原文（用户）：「目前总监 tap 页面，还有三个插件页面 文字背景，全部找审美重新
 *   审核一下质感加上，同时都在右上角加自定义个性化设定」
 *
 *  ⇒ 落地口径：
 *     ① **一处定义**（本文件）→ 四个界面（总监页 / 总监弹窗 / 设计图工作室 / 分支导图）
 *        全部消费同一批 CSS 变量与同一份样式表，**不各自写色值**；
 *     ② 四处的右上角都放同一个 `PersonalizePanel`（components/PersonalizePanel.js）；
 *     ③ 改动**即时生效**：设定写入 `:root` 的 CSS 变量 + `<html data-dp-*>` 属性，
 *        React 组件用 `style={{ borderRadius: "var(--dp-radius)" }}` 消费 ⇒ 无需重渲染整棵树。
 *
 * ══════════════════════════════════════════════════════════════════
 *  🔴 为什么用「CSS 变量 + 注入样式表」而不是「props 传样式」
 * ══════════════════════════════════════════════════════════════════
 *  质感（网格 / 点阵 / 玻璃）需要 `background-image` + `backdrop-filter` + 伪元素，
 *  这些**用 inline style 写不出来或写不干净**（伪元素 inline 无法表达）。
 *  故：色值/尺寸走 CSS 变量（inline 可消费），纹理走注入样式表里的
 *  `html[data-dp-texture="..."] .dp-textured { ... }` 规则（class 可消费）。
 *  两层配合 ⇒ 换质感只改一个属性，四个界面同时变。
 *
 * ⚠️ 持久化 key `dsh.director.personalize`（本项目独有，与布局 key 分开：
 *    布局是"在哪"，个性化是"长什么样"，混在一起会让"复位布局"顺手改掉配色）。
 *
 * ⚠️ 本文件**不 import react**（纯数据 + DOM 副作用）⇒ 离线单测可直接 import。
 */

export const PERSONALIZE_KEY = "dsh.director.personalize";

/** 样式表节点 id（幂等注入；重跑只改内容不叠加节点） */
export const PERSONALIZE_STYLE_ID = "dsh-personalize-css";

/** 默认设定（= 设计稿的默认观感；改动这里等于改默认观感） */
export const P_DEFAULTS = Object.freeze({
	accent: "#2f6feb",
	accent2: "#8957e5",
	density: 1,
	fontScale: 1,
	radius: 8,
	texture: "grid",
	motion: true,
	edge: "curve",
	minimap: true,
	legend: true,
	/* ── 总监弹窗背景（2026-09-17 新增 · 见下方 P_DIALOG_BG）──
	 * 需求原文（用户）：「左侧点击总监按钮，总监的弹窗，背景是黑色的。调整下，按照人眼最舒服
	 *   温馨的风格调整背景和文字的颜色；同时增加自定义背景颜色的选项，可以上传图片作为背景；
	 *   默认的话可以跟随软件的背景主题」
	 * ⚠️ 默认档**刻意**不取 follow：宿主当前是深色主题，follow 出来的仍是黑底 ——
	 *    那等于「用户抱怨什么就保持什么」。「跟随主题」作为**并列可选项**保留（一键可切）。
	 */
	dialogBg: "warm",
	dialogBgColor: "#f7f2e8",
	dialogBgImage: "",
	dialogBgDim: 0.72
});

/** 背景图上限（字符数，≈1.95 MB 二进制）。超限一律丢弃 —— 见 normalizePersonalize。 */
export const P_IMG_MAX = 2600000;

/** 主色（4 档，全部取宿主暗色系里"能当强调色"的） */
export const P_ACCENTS = Object.freeze([
	{ key: "#2f6feb", label: "原生蓝", desc: "与 Harness 原生主色一致（默认）" },
	{ key: "#8957e5", label: "总监紫", desc: "与总监徽章同色" },
	{ key: "#39c5cf", label: "青", desc: "冷色，适合长时间看" },
	{ key: "#d29922", label: "琥珀", desc: "暖色，醒目" }
]);

/** 强调色（用于"建议/待审"类徽章，与主色成对） */
export const P_ACCENT2 = Object.freeze([
	{ key: "#8957e5", label: "紫" },
	{ key: "#3fb950", label: "绿" },
	{ key: "#e5534b", label: "红" },
	{ key: "#39c5cf", label: "青" }
]);

/** 密度（行高 / 间距的整体乘数） */
export const P_DENSITY = Object.freeze([
	{ key: 0.9, label: "紧凑", desc: "同屏多 20% 信息" },
	{ key: 1, label: "标准", desc: "设计稿基线" },
	{ key: 1.15, label: "宽松", desc: "更好读，更少信息" }
]);

/** 字号（整体缩放） */
export const P_FONT = Object.freeze([
	{ key: 0.94, label: "小" },
	{ key: 1, label: "中" },
	{ key: 1.08, label: "大" }
]);

/** 圆角 */
export const P_RADIUS = Object.freeze([
	{ key: 4, label: "直角", desc: "工程感" },
	{ key: 8, label: "圆角", desc: "设计稿基线" },
	{ key: 14, label: "大圆角", desc: "柔和" }
]);

/** 质感 —— 这是用户点名要的「质感」。每档写明"看起来是什么样"，不写空话。 */
export const P_TEXTURES = Object.freeze([
	{ key: "solid", label: "纯色", desc: "无纹理 · 最省电 · 文字对比度最高" },
	{ key: "grid", label: "网格", desc: "22px 细网格 · 工程图纸感（默认）" },
	{ key: "dots", label: "点阵", desc: "16px 点阵 · 更轻，不抢视线" },
	{ key: "glass", label: "玻璃", desc: "半透明 + 背景模糊 · 层叠感（低端机会掉帧）" }
]);

/** 连线样式（导图） */
export const P_EDGE = Object.freeze([
	{ key: "curve", label: "曲线", desc: "三次贝塞尔，思维导图惯例" },
	{ key: "elbow", label: "折线", desc: "直角折线，更工程化" }
]);

/**
 * 总监弹窗底色方案（四档）。
 *
 * 🔴 这一档存在的理由：弹窗是**浮层**，按 V16 的设计口径浮层统一走 `:root` 的深色底，
 *    于是「点左侧总监按钮 → 一片黑」。用户原话就是「背景是黑色的」。
 *    浮层不能直接抄总监页那套宿主令牌桥接（宿主深色 ⇒ 还是黑），所以给它**自己的一档底色**。
 *
 * 四档的差别是"什么时候人眼最舒服"，不是"哪个好看"：
 *   · follow —— 严格跟随 Harness 主题令牌：宿主换明/暗，弹窗**实时**跟着变（无自定义时最省心）
 *   · warm   —— 暖白米色：亮环境 / 白天长时间读文字最舒服（默认）
 *   · dim    —— 暖夜暖褐：暗环境护眼。**刻意不是纯黑** —— #000 上的白字有光晕感，久看发涩
 *   · custom —— 自选底色；文字深浅由底色**亮度**自动决定（见 relLuma / dialogSkinFor）
 */
export const P_DIALOG_BG = Object.freeze([
	{ key: "follow", label: "跟随主题", desc: "严格跟随 Harness 主题令牌：宿主浅色则浅、宿主深色则深" },
	{ key: "warm", label: "暖白", desc: "米白暖调 · 亮环境与白天最舒适（默认）" },
	{ key: "dim", label: "暖夜", desc: "暖褐深色 · 夜间护眼，不刺眼也不是纯黑" },
	{ key: "custom", label: "自定义", desc: "自选底色；文字按底色亮度自动配深浅" }
]);

/** 十六进制 → rgba（解析失败回落主色蓝，绝不产出 NaN） */
export function pHexSoft(hex, alpha) {
	try {
		const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
		if (!m) return "rgba(47,111,235," + alpha + ")";
		const n = parseInt(m[1], 16);
		return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
	} catch (e) { return "rgba(47,111,235," + alpha + ")"; }
}

/** 十六进制 → [r,g,b]；解析失败返回 null（调用方自行回落，绝不产出 NaN） */
export function hexToRgb(hex) {
	try {
		const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
		if (!m) return null;
		const n = parseInt(m[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
	} catch (e) { return null; }
}

/**
 * 相对亮度（WCAG 2.1 定义，0 = 全黑 / 1 = 全白）。
 *
 * 🔴 判断"这个底色上该写深字还是浅字"**只能**用它。
 *    不能用 `(r+g+b)/3` 这类算术均值：人眼对绿最敏感、对蓝最不敏感
 *    （系数 0.7152 / 0.0722），算术均值会把深蓝 #1d2739（均值 39）和
 *    深绿 #27391d（均值 39）判成同一亮度，而后者看起来亮得多。
 */
export function relLuma(hex) {
	const c = hexToRgb(hex);
	if (!c) return 0;
	const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
	return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** 两色对比度（WCAG 2.1，1–21）。把"文字够不够清楚"从主观判断变成**可断言的数**。 */
export function contrastRatio(a, b) {
	const la = relLuma(a), lb = relLuma(b);
	const hi = Math.max(la, lb), lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/** 该底色算"浅底"吗（阈值 0.42）。只用于**表面/强调色**分档；正文文字方向走对比度择优。 */
export function isLightHex(hex) { return relLuma(hex) > 0.42; }

/**
 * 把 `col` 朝 `pole` 推，直到它与 `base` 的对比度**刚好达到** `target`（二分 16 次）。
 *
 * 为什么需要它（真机实测暴露的算法缺陷，2026-09-17）：
 *   自定义底色的文字色原先用**固定比例**混色（`t2 = mixHex(base, ink, 0.72)`）。
 *   固定比例在**中间色**上必然翻车 —— 实测底色 `#7a7262`（luma 0.17）时
 *   t2 落到 `rgb(218,216,211)`，对比度只有 **3.34:1**，正文不达标（需 4.5）。
 *   根因不是"选错了边"（`ink` 方向已按对比度择优），而是**混合强度是个常数、
 *   而目标是个不等式**。⇒ 改成解这个方程：按目标对比度反解混合比例。
 *
 * 边界：连 `pole` 本身都达不到 `target`（极浅/极深两侧夹逼的色域极值）时
 *   返回 `pole` —— **尽力而为，且绝不产出 NaN / 无限循环**。
 */
export function clampToContrast(col, base, pole, target) {
	if (contrastRatio(col, base) >= target) return col;
	if (contrastRatio(pole, base) < target) return pole;
	let lo = 0, hi = 1;
	for (let i = 0; i < 16; i++) {
		const mid = (lo + hi) / 2;
		if (contrastRatio(mixHex(col, pole, mid), base) >= target) hi = mid; else lo = mid;
	}
	return mixHex(col, pole, hi);
}

/**
 * 挑一个"能真正解决问题"的极端色（黑白二选一）作为钳制方向。
 *
 * 🔴 这里踩过一次（2026-09-17 自测抓出）：第一版按"**离原色更远**"选极点，
 *   结果在浅紫底 `#c8a2c8` 上给白色强调色选了 `#ffffff` ——
 *   白离原色（深蓝）确实更远，**但白对浅紫底的对比度只有 2.22**，
 *   钳制完全失效（`clampToContrast` 发现极点也达不到目标 ⇒ 原样返回极点）。
 *   ⇒ 正确口径：极点必须**对底色**有效（`contrastRatio(pole, base) >= target`）；
 *     两个都有效时再按"离原色远"选，以尽量少改色相。
 */
function poleAwayFrom(col, base, target) {
	const away = contrastRatio(col, "#000000") >= contrastRatio(col, "#ffffff") ? "#000000" : "#ffffff";
	const other = away === "#000000" ? "#ffffff" : "#000000";
	if (contrastRatio(away, base) >= target) return away;
	if (contrastRatio(other, base) >= target) return other;
	return contrastRatio(away, base) >= contrastRatio(other, base) ? away : other;
}

/** 两色线性插值（t=0 取 a，t=1 取 b）。任一解析失败原样返回 a，**不产出 NaN**。 */
export function mixHex(a, b, t) {
	const A = hexToRgb(a), B = hexToRgb(b);
	if (!A || !B) return String(a || b || "#000000");
	const k = Math.max(0, Math.min(1, Number(t) || 0));
	const h = (v) => Math.round(v).toString(16).padStart(2, "0");
	return "#" + h(A[0] + (B[0] - A[0]) * k) + h(A[1] + (B[1] - A[1]) * k) + h(A[2] + (B[2] - A[2]) * k);
}

/**
 * 内置两套底色的完整皮肤（follow 档没有色值，故不在此表 —— 它一个变量都不产出）。
 * 两个原则写死在数值里：
 *   ① 正文字色**不用纯黑 / 纯白**：暖白底配 `#3a3228`（暖黑）而不是 `#000`，暖夜底配
 *      `#f3eadd`（暖白）而不是 `#fff` —— 纯黑/纯白对比过刚，长文阅读发涩。
 *   ② 强调色按底色亮度换一套：浅底上用深紫/深蓝（浅紫在米白上几乎看不见），
 *      深底上用浅紫/浅蓝。状态色（成功/警告/危险）同理。
 */
const DLG_PRESETS = Object.freeze({
	warm: {
		bg: "#f7f2e8", bg1: "#fffdf8", bg2: "#efe7d8", line: "#ded2bd", lineSoft: "rgba(120,100,70,0.20)",
		t1: "#3a3228", t2: "#5d5246", t3: "#8b7f6f",
		ac: "#1f5fd0", ac2: "#6b3fc4", ok: "#1a7f37", warn: "#8a6100", bad: "#b42318"
	},
	dim: {
		bg: "#262120", bg1: "#2f2825", bg2: "#3a312c", line: "#4d4139", lineSoft: "rgba(255,236,215,0.14)",
		t1: "#f3eadd", t2: "#cfc1b1", t3: "#9e8f7d",
		ac: "#9ec1ff", ac2: "#c4a4ff", ok: "#78d18a", warn: "#e5c06a", bad: "#ff9b93"
	}
});

/** 自定义底色的强调/状态色（按亮度二选一，与内置两套同源） */
const DLG_ACCENTS = Object.freeze({
	light: { ac: "#1f5fd0", ac2: "#6b3fc4", ok: "#1a7f37", warn: "#8a6100", bad: "#b42318" },
	dark: { ac: "#9ec1ff", ac2: "#c4a4ff", ok: "#78d18a", warn: "#e5c06a", bad: "#ff9b93" }
});

/**
 * 设定 → 总监弹窗皮肤（**纯函数**）。
 *
 * 返回值约定：
 *   · `mode === "follow"` ⇒ 除遮罩外**一个色值都不产出**（`bg` 为 undefined）。
 *     这不是偷懒：follow 必须靠组件内联 fallback 直接读宿主令牌，才能"宿主换主题 ⇒ 弹窗
 *     **实时**跟着换"。若在这里固化成色值写进 `:root`，既拿不到 body 上的 `--dsw-alias-*`
 *     （var() 在定义处求值，见下方 pCssText 的长注释），又会在宿主换主题后停在旧值上。
 *   · 其它档 ⇒ 给全套色值；`image` 非空时把「卡片/标题栏」换成同色半透明（不透明 = 照片被盖死）。
 *
 * @param {object} p 个性化设定
 * @returns {{mode:string,image:string,dim:number,light:boolean,scrim:string,bg?:string,bg1?:string,bg2?:string,line?:string,lineSoft?:string,t1?:string,t2?:string,t3?:string,ac?:string,ac2?:string,ok?:string,warn?:string,bad?:string}}
 */
export function dialogSkinFor(p) {
	const s = normalizePersonalize(p);
	const img = s.dialogBgImage;
	const dim = s.dialogBgDim;
	if (s.dialogBg === "follow") {
		/* 跟随主题：不产出色值。只有"跟随 + 图片"这一种组合需要遮罩 —— 照片亮度与宿主令牌无关，
		 * 故用中性黑遮罩；文字仍走宿主令牌（深色宿主上是浅字，天然压得住）。 */
		return { mode: "follow", image: img, dim: dim, light: false, scrim: img ? "rgba(0,0,0," + dim + ")" : "" };
	}
	const preset = s.dialogBg === "custom" ? null : DLG_PRESETS[s.dialogBg];
	const base = preset ? preset.bg : s.dialogBgColor;
	const light = isLightHex(base);
	/* 两个方向**必须分开**（这是自定义底色最容易搞反的一处）：
	 *   · 表面（bg1/bg2）永远往白推 —— 浅底上卡片比画布更白、深底上卡片比画布更亮，
	 *     两边都是"抬起来"的效果；
	 *   · 文字/描边往**文字色**一侧推 —— 浅底往黑（深字 + 深描边），深底往白。
	 * 若共用一个方向，浅底会得到"比画布更黑的卡片"（压下去），层次整个反了。 */
	const surfToward = "#ffffff";
	/* 文字方向**不用"浅底/深底"二分，而是直接按对比度择优** ——
	 * 二分在中间灰（例 #7a7262，luma 0.17）上会选错边：按 luma 判"深底 ⇒ 白字"，
	 * 实测白字对比度 4.2 反而**低于**黑字。择优只多两次计算，却在整个色域上都不会选反。
	 * （t1 的混合强度两侧不同：深底上白字要更实才压得住，浅底上黑字 0.80 已经足够。） */
	const inkDark = mixHex(base, "#000000", 0.88);
	const inkLight = mixHex(base, "#ffffff", 0.93);
	const useDarkInk = contrastRatio(base, inkDark) >= contrastRatio(base, inkLight);
	const ink = useDarkInk ? "#000000" : "#ffffff";
	const inkPole = useDarkInk ? "#000000" : "#ffffff";
	/** 强调/状态色钳制：朝"对底色真正有效"的极端色推到 3:1（非文本 UI 的 WCAG 门槛） */
	const fixAcc = (c) => clampToContrast(c, base, poleAwayFrom(c, base, 3.0), 3.0);
	const acc = light ? DLG_ACCENTS.light : DLG_ACCENTS.dark;
	const skin = preset || {
		bg: base,
		bg1: mixHex(base, surfToward, light ? 0.62 : 0.09),
		bg2: mixHex(base, surfToward, light ? 0.34 : 0.17),
		line: mixHex(base, ink, light ? 0.28 : 0.22),
		lineSoft: pHexSoft(useDarkInk ? "#000000" : "#ffffff", 0.10),
		/* 🔴 文字/强调色一律**按目标对比度反解混合比例**，不拍固定常数 ——
		 *   固定比例在中间色上必翻车（实测 `#7a7262` 的正文只有 3.34:1，不达 AA 4.5）。
		 *   目标：正文 t1/t2 = 4.5:1；弱化文字 t3 = 3:1；强调/状态色 = 3:1。 */
		t1: clampToContrast(useDarkInk ? inkDark : inkLight, base, inkPole, 4.5),
		t2: clampToContrast(mixHex(base, ink, useDarkInk ? 0.62 : 0.72), base, inkPole, 4.5),
		t3: clampToContrast(mixHex(base, ink, useDarkInk ? 0.44 : 0.52), base, inkPole, 3.0),
		ac: fixAcc(acc.ac),
		ac2: fixAcc(acc.ac2),
		ok: fixAcc(acc.ok),
		warn: fixAcc(acc.warn),
		bad: fixAcc(acc.bad)
	};
	return {
		mode: s.dialogBg, image: img, dim: dim, light: light,
		scrim: img ? pHexSoft(base, dim) : "",
		bg: skin.bg,
		/* 有照片时卡片必须半透明，否则整张照片只在缝隙里露几条纹 = 白买了这张图。
		 * 透明度取 0.88 / 0.74：既能看见照片，又保证文字对比度（配 dialogBgDim 遮罩）。 */
		bg1: img ? pHexSoft(base, 0.88) : skin.bg1,
		bg2: img ? pHexSoft(base, 0.74) : skin.bg2,
		line: skin.line, lineSoft: skin.lineSoft,
		t1: skin.t1, t2: skin.t2, t3: skin.t3,
		ac: skin.ac, ac2: skin.ac2, ok: skin.ok, warn: skin.warn, bad: skin.bad
	};
}

/** 弹窗皮肤的变量名全表（**清场用**：切回 follow 时必须逐条 remove，否则残留上一档的色值） */
export const DIALOG_VAR_KEYS = Object.freeze([
	"--dp-dlg-bg", "--dp-dlg-bg1", "--dp-dlg-bg2", "--dp-dlg-line", "--dp-dlg-line-soft",
	"--dp-dlg-t1", "--dp-dlg-t2", "--dp-dlg-t3",
	"--dp-dlg-ac", "--dp-dlg-ac2", "--dp-dlg-ok", "--dp-dlg-warn", "--dp-dlg-bad",
	"--dp-dlg-scrim", "--dp-dlg-dim", "--dp-dlg-img"
]);

/**
 * 设定 → 弹窗皮肤 CSS 变量表（**纯函数**）。
 * follow 档返回 `{}`（一个变量都不产出）—— 组件的 `var(--dp-dlg-*, <宿主令牌>)` 于是整条
 * 落到宿主令牌上，宿主换明暗主题时**无需重新 apply** 就跟着变。
 * @param {object} p
 * @returns {Record<string,string>}
 */
export function dialogVarsFor(p) {
	const s = normalizePersonalize(p);
	const k = dialogSkinFor(s);
	const img = s.dialogBgImage;
	if (k.bg === undefined) {
		return img ? { "--dp-dlg-scrim": k.scrim, "--dp-dlg-dim": String(s.dialogBgDim) } : {};
	}
	const out = {
		"--dp-dlg-bg": k.bg, "--dp-dlg-bg1": k.bg1, "--dp-dlg-bg2": k.bg2,
		"--dp-dlg-line": k.line, "--dp-dlg-line-soft": k.lineSoft,
		"--dp-dlg-t1": k.t1, "--dp-dlg-t2": k.t2, "--dp-dlg-t3": k.t3,
		"--dp-dlg-ac": k.ac, "--dp-dlg-ac2": k.ac2, "--dp-dlg-ok": k.ok,
		"--dp-dlg-warn": k.warn, "--dp-dlg-bad": k.bad,
		"--dp-dlg-dim": String(s.dialogBgDim)
	};
	if (img) {
		out["--dp-dlg-scrim"] = k.scrim;
		out["--dp-dlg-img"] = 'url("' + img + '")';
	}
	return out;
}
/**
 * 把用户选的图片文件读成"能直接写进 localStorage 的 dataURL"。
 *
 * 🔴 必须先压缩再存：手机直出 3–8 MB，base64 再涨 33% ⇒ 直接塞 localStorage 会**爆配额**，
 *    而爆配额在 savePersonalize 里是被 catch 掉的静默失败 —— 用户以为换成功了，
 *    下次打开还是旧图。规格：最长边 ≤ 1920px；JPEG 质量 0.82；仍超上限降到 0.6 再压一次。
 * 任何一步失败（非图片 / 解码失败 / 无 DOM）一律 resolve("")，不抛。
 * @param {File|Blob} file
 * @returns {Promise<string>} dataURL，或 ""（失败）
 */
export function readImageAsDataUrl(file) {
	return new Promise((resolve) => {
		try {
			if (typeof document === "undefined" || typeof FileReader === "undefined" || !file) { resolve(""); return; }
			const fr = new FileReader();
			fr.onerror = () => resolve("");
			fr.onload = () => {
				const raw = String(fr.result || "");
				if (!/^data:image\//.test(raw)) { resolve(""); return; }
				/* 小图（且已是 base64）直接用原图，避免多一次有损重编码 */
				if (raw.length <= P_IMG_MAX && raw.indexOf(";base64,") > 0 && raw.length <= 700000) { resolve(raw); return; }
				const img = new Image();
				img.onerror = () => resolve("");
				img.onload = () => {
					try {
						const maxEdge = 1920;
						const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
						const w = Math.max(1, Math.round((img.width || 1) * scale));
						const h = Math.max(1, Math.round((img.height || 1) * scale));
						const cv = document.createElement("canvas");
						cv.width = w; cv.height = h;
						const cx = cv.getContext("2d");
						if (!cx) { resolve(""); return; }
						cx.drawImage(img, 0, 0, w, h);
						let out = cv.toDataURL("image/jpeg", 0.82);
						if (out.length > P_IMG_MAX) out = cv.toDataURL("image/jpeg", 0.6);
						resolve(out.length > P_IMG_MAX ? "" : out);
					} catch (e) { resolve(""); }
				};
				img.src = raw;
			};
			fr.readAsDataURL(file);
		} catch (e) { resolve(""); }
	});
}

/** 数值夹紧（防脏数据把界面搞崩） */
function clampNum(v, lo, hi, dflt) {
	const n = Number(v);
	if (!Number.isFinite(n)) return dflt;
	return Math.max(lo, Math.min(hi, n));
}

/**
 * 清洗设定：任何外来对象 → 合法设定（**逐字段校验**，不整体信任）。
 * localStorage 里的旧数据 / 手改过的值都必须过大门口。
 * @param {object} raw
 * @returns {object} 完整设定
 */
export function normalizePersonalize(raw) {
	const r = raw && typeof raw === "object" ? raw : {};
	const pick = (list, v, dflt) => {
		const keys = list.map((o) => o.key);
		return keys.indexOf(v) >= 0 ? v : dflt;
	};
	const hexOk = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ""));
	/* 背景图只接受 **内联 dataURL**，且必须真的是图片类型、长度在上限内。
	 * 🔴 为什么不接受 http(s) 链接或本地路径：这个值会被写进 `--dp-dlg-img: url(...)`。
	 *    收外链 ⇒ 每次开弹窗都发一次外部请求（离线环境挂住、也泄露"我开了这个界面"）；
	 *    收 file:// / 相对路径 ⇒ 在不同 origin 下静默 404，用户只看到"我设的图没了"。
	 *    超长直接丢弃而不是截断：截断出来的 base64 不是合法图片，只会得到一个坏图标。 */
	const imgOk = (v) => {
		const s = String(v || "");
		return s.length <= P_IMG_MAX && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);
	};
	return {
		accent: hexOk(r.accent) ? String(r.accent).toLowerCase() : P_DEFAULTS.accent,
		accent2: hexOk(r.accent2) ? String(r.accent2).toLowerCase() : P_DEFAULTS.accent2,
		density: pick(P_DENSITY, r.density, P_DEFAULTS.density),
		fontScale: pick(P_FONT, r.fontScale, P_DEFAULTS.fontScale),
		radius: pick(P_RADIUS, r.radius, P_DEFAULTS.radius),
		texture: pick(P_TEXTURES, r.texture, P_DEFAULTS.texture),
		edge: pick(P_EDGE, r.edge, P_DEFAULTS.edge),
		motion: r.motion === undefined ? P_DEFAULTS.motion : Boolean(r.motion),
		minimap: r.minimap === undefined ? P_DEFAULTS.minimap : Boolean(r.minimap),
		legend: r.legend === undefined ? P_DEFAULTS.legend : Boolean(r.legend),
		dialogBg: pick(P_DIALOG_BG, r.dialogBg, P_DEFAULTS.dialogBg),
		dialogBgColor: hexOk(r.dialogBgColor) ? String(r.dialogBgColor).toLowerCase() : P_DEFAULTS.dialogBgColor,
		dialogBgImage: imgOk(r.dialogBgImage) ? String(r.dialogBgImage) : P_DEFAULTS.dialogBgImage,
		dialogBgDim: clampNum(r.dialogBgDim, 0, 0.95, P_DEFAULTS.dialogBgDim)
	};
}

/**
 * 设定 → CSS 变量表（**纯函数**，可离线断言）。
 * 变量名一律 `--dp-*`（dp = director personalize）。
 * @param {object} p
 * @returns {Record<string,string>}
 */
export function pVarsFor(p) {
	const s = normalizePersonalize(p);
	const r = clampNum(s.radius, 0, 24, P_DEFAULTS.radius);
	return {
		"--dp-ac": s.accent,
		"--dp-ac-soft": pHexSoft(s.accent, 0.16),
		"--dp-ac-line": pHexSoft(s.accent, 0.45),
		"--dp-ac2": s.accent2,
		"--dp-ac2-soft": pHexSoft(s.accent2, 0.16),
		"--dp-ac2-line": pHexSoft(s.accent2, 0.45),
		"--dp-density": String(s.density),
		"--dp-font": String(s.fontScale),
		"--dp-radius": r + "px",
		"--dp-radius-sm": Math.max(2, r - 3) + "px",
		"--dp-radius-lg": (r + 4) + "px",
		"--dp-motion": s.motion ? "1" : "0"
	};
}

/**
 * 注入样式表文本（**纯函数**，可离线断言"质感档位都真有规则"）。
 * 四类规则：
 *   ① `.dp-*` 原子类（表面 / 卡片 / 按钮 / 徽章 / 分隔线）
 *   ② `[data-testid="dp-root"]` 总监页令牌桥接 —— 底色/文字/边框全部改用宿主
 *      `--dsw-alias-*` 令牌，使总监页与原生页签**同源同值**（宿主换主题/换背景图自动跟随）
 *   ③ `html[data-dp-texture=...]` 纹理覆盖（纹理色走 `--dp-tex*`，随主题深浅切换）
 *   ④ 动效开关（`html[data-dp-motion="0"]` 时停掉全部动画与过渡）
 * ⚠️ 文本里**不使用反引号**（避免与下游打包工具链的模板字面量互相干扰）。
 */
export function pCssText() {
	const L = [];
	L.push("/* dsh-personalize-css —— 由 store/personalize.js 注入，勿手改 */");
	L.push(":root{--dp-bg-0:#0b0c0e;--dp-bg-1:#141519;--dp-bg-2:#1c1e23;--dp-line:#31343a;--dp-line-soft:rgba(255,255,255,.08);--dp-t1:#e8eaed;--dp-t2:#c3c8ce;--dp-t3:#8b9199;--dp-shadow:0 10px 30px rgba(0,0,0,.45);--dp-shadow-sm:0 4px 14px rgba(0,0,0,.32);--dp-tex:rgba(255,255,255,.035);--dp-tex-strong:rgba(255,255,255,.07);}");
	// ① 表面层次：三个层级必须是"看起来递进"的，不是同一个色加边框
	L.push(".dp-surface{background:var(--dp-bg-1);border:1px solid var(--dp-line);border-radius:var(--dp-radius);}");
	L.push(".dp-surface-2{background:var(--dp-bg-2);border:1px solid var(--dp-line);border-radius:var(--dp-radius);box-shadow:var(--dp-shadow-sm);}");
	L.push(".dp-sunken{background:var(--dp-bg-0);border:1px solid var(--dp-line-soft);border-radius:var(--dp-radius);}");
	L.push(".dp-card{background:var(--dp-bg-2);border:1px solid var(--dp-line);border-radius:var(--dp-radius);padding:calc(7px * var(--dp-density)) calc(9px * var(--dp-density));}");
	L.push(".dp-chip{font-size:calc(10.5px * var(--dp-font));padding:2px calc(7px * var(--dp-density));border-radius:var(--dp-radius-sm);background:var(--dp-ac-soft);border:1px solid var(--dp-ac-line);color:var(--dp-ac);white-space:nowrap;}");
	L.push(".dp-chip-2{background:var(--dp-ac2-soft);border-color:var(--dp-ac2-line);color:var(--dp-ac2);}");
	L.push(".dp-btn{height:calc(24px * var(--dp-density));padding:0 calc(9px * var(--dp-density));border-radius:var(--dp-radius-sm);cursor:pointer;font-size:calc(11.5px * var(--dp-font));white-space:nowrap;border:1px solid var(--dp-line);background:var(--dp-bg-2);color:var(--dp-t2);font-family:inherit;display:inline-flex;align-items:center;gap:4px;}");
	L.push(".dp-btn:hover{border-color:var(--dp-ac-line);color:var(--dp-t1);background:var(--dp-ac-soft);}");
	L.push(".dp-btn:active{transform:translateY(1px);}");
	L.push(".dp-btn-pri{background:var(--dp-ac);border-color:var(--dp-ac);color:#fff;}");
	L.push(".dp-btn-pri:hover{filter:brightness(1.1);color:#fff;}");
	L.push(".dp-btn[disabled],.dp-btn[aria-disabled=true]{opacity:.45;cursor:not-allowed;}");
	L.push(".dp-sep{height:1px;background:var(--dp-line);border:0;margin:calc(4px * var(--dp-density)) 0;}");
	L.push(".dp-title{font-size:calc(11px * var(--dp-font));font-weight:650;color:var(--dp-t2);}");
	L.push(".dp-muted{font-size:calc(10.5px * var(--dp-font));color:var(--dp-t3);}");
	L.push(".dp-input{box-sizing:border-box;border-radius:var(--dp-radius-sm);border:1px solid var(--dp-line);background:var(--dp-bg-0);color:var(--dp-t1);font-family:inherit;font-size:calc(11.5px * var(--dp-font));padding:0 calc(9px * var(--dp-density));}");
	L.push(".dp-input:focus{outline:none;border-color:var(--dp-ac);box-shadow:0 0 0 2px var(--dp-ac-soft);}");
	L.push(".dp-scroll::-webkit-scrollbar{width:8px;height:8px;}");
	L.push(".dp-scroll::-webkit-scrollbar-thumb{background:var(--dp-line);border-radius:4px;}");
	L.push(".dp-scroll::-webkit-scrollbar-thumb:hover{background:var(--dp-ac-line);}");
	L.push(".dp-pulse{animation:dp-pulse 1.6s ease-in-out infinite;}");
	L.push("@keyframes dp-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--dp-ac-soft);}50%{opacity:.65;box-shadow:0 0 0 4px var(--dp-ac-soft);}}");
	L.push(".dp-rise{animation:dp-rise .18s ease-out;}");
	L.push("@keyframes dp-rise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}");
	// V17 P1：三浮层统一入场过渡（140ms 淡入 + 轻微放大；只做入场，出场随互斥切换直接卸载，避免延迟卸载状态机）
	L.push(".dp-overlay-in{animation:dp-overlay-in .14s ease-out;}");
	L.push("@keyframes dp-overlay-in{from{opacity:0;transform:scale(.985);}to{opacity:1;transform:scale(1);}}");
	// ⑤ 四界面域标识（V17 P0：用户始终知道自己在哪个域）
	L.push(".dp-domain{display:inline-flex;align-items:center;gap:4px;font-size:calc(10.5px * var(--dp-font));font-weight:600;padding:2px 7px;border-radius:var(--dp-radius-sm);letter-spacing:.3px;white-space:nowrap;line-height:1.4;}");
	L.push(".dp-domain.dir{background:rgba(47,111,235,.14);border:1px solid rgba(47,111,235,.35);color:#8ab4f8;}");
	L.push(".dp-domain.design{background:rgba(57,197,207,.12);border:1px solid rgba(57,197,207,.32);color:#7fe3e8;}");
	L.push(".dp-domain.map{background:rgba(137,87,229,.14);border:1px solid rgba(137,87,229,.35);color:#c9a8ff;}");
	//
	// ② 总监页跟随宿主主题（背景 / 文字 / 边框 / 阴影）
	//
	//  🔴 坑（静默失效）：CSS 自定义属性里的 var() 是在**定义它的那个元素上**求值的，
	//     不是在使用处。宿主把 `--dsw-alias-*` 定义在 `body` 上（**不在** html/:root，
	//     实测 documentElement 上取到空串），所以下面必须挂在**能继承到宿主令牌**的
	//     元素上 —— dp-root 就在 body 内。
	//     若图省事写成 `:root{--dp-bg-0:var(--dsw-alias-bg-base)}`，会在 html 上求值失败
	//     并**静默**落到 fallback：背景不跟随宿主，却没有任何报错、属性读起来也正常。
	//  作用域刻意只限 dp-root：思维导图 / 设计图工作室 / 总监弹窗是浮层，仍走 :root 的
	//     深色底（宿主背景图不参与浮层，避免"浮层被背景图割裂"）。
	L.push('[data-testid="dp-root"]{'
		+ "--dp-bg-0:var(--dsw-alias-bg-base, #0b0c0e);"
		+ "--dp-bg-1:var(--dsw-alias-bg-layer-1, #141519);"
		+ "--dp-bg-2:var(--dsw-alias-bg-layer-2, #1c1e23);"
		+ "--dp-line:var(--dsw-alias-border-l2, #31343a);"
		+ "--dp-line-soft:var(--dsw-alias-border-l1, rgba(255,255,255,.08));"
		+ "--dp-t1:var(--dsw-alias-label-primary, #e8eaed);"
		+ "--dp-t2:var(--dsw-alias-label-secondary, #c3c8ce);"
		+ "--dp-t3:var(--dsw-alias-label-tertiary, #8b9199);"
		+ "--dp-shadow:var(--dsw-shadow-lv2, 0 10px 30px rgba(0,0,0,.45));"
		+ "--dp-shadow-sm:var(--dsw-shadow-lv1, 0 4px 14px rgba(0,0,0,.32));"
		// 纹理色：浅色底上用蓝灰（白色纹理在白玻璃上等于不可见）
		+ "--dp-tex:rgba(29,39,57,.055);"
		+ "--dp-tex-strong:rgba(29,39,57,.10);"
		+ "}");
	// ③ 纹理（.dp-textured 只提供背景，不覆盖已有 background-color 的层次）
	L.push(".dp-textured{background-image:none;}");
	L.push('html[data-dp-texture="grid"] .dp-textured{background-image:linear-gradient(var(--dp-tex) 1px,transparent 1px),linear-gradient(90deg,var(--dp-tex) 1px,transparent 1px);background-size:22px 22px;}');
	L.push('html[data-dp-texture="dots"] .dp-textured{background-image:radial-gradient(var(--dp-tex-strong) 1px,transparent 1px);background-size:16px 16px;}');
	L.push('html[data-dp-texture="glass"] .dp-textured{background-image:linear-gradient(135deg,var(--dp-tex-strong),transparent 40%);backdrop-filter:blur(10px);}');
	//
	// ③b 总监弹窗的**图片背景**（只有这一条需要样式表：inline style 写不出"照片 + 遮罩"两层）
	//
	//  选择器**刻意**只列弹窗自己的四个壳（面板 / 左右竖条），不用 `.dp-*` 通配：
	//  写宽了会把总监页、导图、工作室一起铺上照片（它们各有各的宿主桥接与纹理）。
	//  两个技术点：
	//   ① 遮罩走 `--dp-dlg-scrim`（= 当前底色 + 用户调的浓度）⇒ 文字对比度由浓度**直接**决定，
	//      换底色时遮罩自动跟着换，不需要另算一套。
	//   ② `background-attachment:fixed` 让两块面板共用"一张以视口为坐标系的照片" ——
	//      否则左右两块各铺各的，中间一条接缝像两张图拼的。
	L.push('html[data-dp-dlgimg="1"] [data-testid="d-panel"],'
		+ 'html[data-dp-dlgimg="1"] [data-testid="d-left-rail"],'
		+ 'html[data-dp-dlgimg="1"] [data-testid="d-right-rail"]{'
		+ "background-image:linear-gradient(var(--dp-dlg-scrim, rgba(0,0,0,.72)),var(--dp-dlg-scrim, rgba(0,0,0,.72))),var(--dp-dlg-img, none);"
		+ "background-size:cover,cover;background-position:center,center;background-repeat:no-repeat,no-repeat;background-attachment:fixed,fixed;}");
	// ④ 动效开关
	L.push('html[data-dp-motion="0"] .dp-anim,html[data-dp-motion="0"] .dp-pulse,html[data-dp-motion="0"] .dp-rise{animation:none !important;transition:none !important;}');
	return L.join("\n");
}

/** 把设定写到 DOM（`:root` 变量 + `html[data-dp-*]` + 样式表）。SSR / 测试环境下静默跳过。 */
export function applyPersonalize(p) {
	if (typeof document === "undefined") return false;
	const s = normalizePersonalize(p);
	try {
		const root = document.documentElement;
		// 样式表（幂等：同一 id 只替换内容）
		let style = document.getElementById(PERSONALIZE_STYLE_ID);
		if (!style) {
			style = document.createElement("style");
			style.id = PERSONALIZE_STYLE_ID;
			(document.head || root).appendChild(style);
		}
		const css = pCssText();
		if (style.textContent !== css) style.textContent = css;
		// 变量
		const vars = pVarsFor(s);
		for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
		// 总监弹窗皮肤：**先清场、再写本轮**
		//  🔴 清场不是洁癖：`follow` 档刻意**一个变量都不产出**，靠的就是"属性不存在 ⇒ 组件
		//     内联 fallback 落到宿主令牌 ⇒ 宿主换明暗主题时弹窗实时跟着变"。
		//     少了这一步，用户从「暖白」切回「跟随主题」会**残留上一档的米色**，
		//     而界面上"跟随主题"明明是选中的 —— 典型的静默失效。
		for (const k of DIALOG_VAR_KEYS) root.style.removeProperty(k);
		const dvars = dialogVarsFor(s);
		for (const k of Object.keys(dvars)) root.style.setProperty(k, dvars[k]);
		root.setAttribute("data-dp-dlgbg", s.dialogBg);
		root.setAttribute("data-dp-dlgimg", s.dialogBgImage ? "1" : "0");
		// 纹理 / 动效 / 连线（给 CSS 选择器用；同时给 e2e 提供稳定的读点）
		root.setAttribute("data-dp-texture", s.texture);
		root.setAttribute("data-dp-motion", s.motion ? "1" : "0");
		root.setAttribute("data-dp-edge", s.edge);
		root.setAttribute("data-dp-font", String(s.fontScale));
		root.setAttribute("data-dp-density", String(s.density));
		// 让"未接入 CSS 类"的老节点也能吃到字号缩放
		root.style.fontSize = (12.5 * s.fontScale) + "px";
		return true;
	} catch (e) { return false; }
}

/** 读持久化（解析失败回落默认；不抛） */
export function loadPersonalize() {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PERSONALIZE_KEY) : null;
		if (raw) return normalizePersonalize(JSON.parse(raw));
	} catch (e) { /* 隐私模式 / 脏数据 */ }
	return { ...P_DEFAULTS };
}

/** 写持久化（失败静默：个性化丢失不影响功能） */
export function savePersonalize(p) {
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem(PERSONALIZE_KEY, JSON.stringify(normalizePersonalize(p)));
		return true;
	} catch (e) { return false; }
}

/** 单例 store（订阅者 = 需要按设定显隐的组件，如小地图 / 图例） */
export const personalizeStore = (function () {
	let state = loadPersonalize();
	const listeners = new Set();
	function emit() { for (const fn of listeners) { try { fn(state); } catch (e) { /* 单个订阅者异常不影响其他 */ } } }
	/** localStorage 是否可用（隐私模式 / SSR 下不可用；此时"存不上"不算失败） */
	function hasLS() { try { return typeof localStorage !== "undefined" && localStorage !== null; } catch (e) { return false; } }
	applyPersonalize(state);
	return {
		getState: () => state,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		/** 改一项（未知键忽略，保证 store 不会被写脏）。
		 *  @returns {boolean} false = 未知键**或**未能持久化（典型：背景图太大撑爆配额）。
		 *    调用方据此把"看起来换了、重启后没了"变成一句可读的提示。 */
		set: (key, value) => {
			if (!(key in P_DEFAULTS)) return false;
			state = normalizePersonalize({ ...state, [key]: value });
			const saved = savePersonalize(state);
			applyPersonalize(state);
			emit();
			return saved || !hasLS();
		},
		patch: (obj) => {
			state = normalizePersonalize({ ...state, ...(obj || {}) });
			savePersonalize(state);
			applyPersonalize(state);
			emit();
			return true;
		},
		reset: () => {
			state = { ...P_DEFAULTS };
			savePersonalize(state);
			applyPersonalize(state);
			emit();
			return true;
		}
	};
})();

/** 全局契约（调试 / e2e 用） */
export function installPersonalizeApi() {
	const api = {
		PERSONALIZE_KEY, PERSONALIZE_STYLE_ID, P_DEFAULTS, P_IMG_MAX,
		P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE, P_DIALOG_BG,
		normalizePersonalize, pVarsFor, pCssText, applyPersonalize,
		hexToRgb, relLuma, isLightHex, mixHex, clampToContrast, dialogSkinFor, dialogVarsFor, DIALOG_VAR_KEYS, readImageAsDataUrl,
		loadPersonalize, savePersonalize, store: personalizeStore
	};
	if (typeof window !== "undefined") window.__dshPersonalize = api;
	return api;
}
