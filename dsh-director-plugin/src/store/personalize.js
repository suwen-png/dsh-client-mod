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
	legend: true
});

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

/** 十六进制 → rgba（解析失败回落主色蓝，绝不产出 NaN） */
export function pHexSoft(hex, alpha) {
	try {
		const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
		if (!m) return "rgba(47,111,235," + alpha + ")";
		const n = parseInt(m[1], 16);
		return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
	} catch (e) { return "rgba(47,111,235," + alpha + ")"; }
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
		legend: r.legend === undefined ? P_DEFAULTS.legend : Boolean(r.legend)
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
	applyPersonalize(state);
	return {
		getState: () => state,
		subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
		/** 改一项（未知键忽略，保证 store 不会被写脏） */
		set: (key, value) => {
			if (!(key in P_DEFAULTS)) return false;
			state = normalizePersonalize({ ...state, [key]: value });
			savePersonalize(state);
			applyPersonalize(state);
			emit();
			return true;
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
		PERSONALIZE_KEY, PERSONALIZE_STYLE_ID, P_DEFAULTS,
		P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE,
		normalizePersonalize, pVarsFor, pCssText, applyPersonalize,
		loadPersonalize, savePersonalize, store: personalizeStore
	};
	if (typeof window !== "undefined") window.__dshPersonalize = api;
	return api;
}
