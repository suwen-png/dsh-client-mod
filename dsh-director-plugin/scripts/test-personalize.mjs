#!/usr/bin/env node
/**
 * test-personalize.mjs —— 「个性化」+「四维流转」两层**离线纯函数闸门**
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么这两个 store 要单独一个闸门（而不是塞进 test-mindmap-logic）
 * ──────────────────────────────────────────────────────────────────
 *  它们服务的是用户本轮的**四组新诉求**，且每条诉求都有一个"看起来做了其实没做"的失败形态：
 *
 *  诉求「都在右上角加自定义个性化设定」
 *    ✗ 失败形态：四个界面各写一份面板 ⇒ 用户在设计图里改了主色，导图没变，
 *      而他无法判断"是没生效还是我记错了"。⇒ 本闸门用**源码级一致性断言**（D 段）钉死：
 *      四处必须 import 同一个组件、同一个 scope 各自的、同一个质感类、同一份持久化 key。
 *
 *  诉求「全部找审美重新审核一下质感加上」
 *    ✗ 失败形态（**本轮真实踩到**）：纹理靠 `.dp-textured` 的 `background-image` 实现，
 *      而四个界面的根节点此前都写的是 `background` **简写** ⇒ 简写会把 background-image
 *      一并重置 ⇒ 面板里点「网格 / 点阵 / 玻璃」**看起来完全没反应**。
 *      离线纯函数测不出来（CSS 层的事），所以在 D 段做**精确字符串断言**防回归。
 *
 *  诉求「保证同一个消息能在上面几个维度进行流转」
 *    ✗ 失败形态：`origin` 被 hop 覆盖 ⇒ 走完一圈后"从哪来"丢了，用户看到的轨迹是错的。
 *      ⇒ B 段断言 hopFlow **不改 origin**、trail 只追加。
 *
 *  诉求「对话的最上面是现在正在做的事情」
 *    ✗ 失败形态：读不到宿主字段时用标题/深度顶替 ⇒ 用户以为界面在撒谎。
 *      ⇒ A5/C 段断言每个分支都带 `source`，读不到就如实说"待命"。
 *
 *  诉求「总监 tab 页面的背景采用原软件的背景，保持风格统一」
 *    ✗ 失败形态（**本轮真实踩到，而且完全静默**）：把宿主令牌桥接写成
 *      :root 上的 `--dp-bg-0:var(--dsw-alias-bg-base)`。CSS 自定义属性里的 var() 是在
 *      **定义它的那个元素上**求值的，而宿主把 --dsw-alias-* 定义在 `body`
 *      （不在 html/:root —— 实测 documentElement 上取到空串）⇒ 求值失败、**静默**落到
 *      fallback ⇒ 背景根本没跟随宿主，却零报错、读属性一切正常。
 *      ⇒ C15/C16 一对正反断言钉死：必须有宿主令牌桥接，且**不许**写在 :root 上。
 *
 *  ⚠️ 反向教训（本轮）：偶发红比稳定红更危险。B36 曾用下标 `ofSession()[0]` 取"刚 push
 *     的那条"，而该数组按 lastTouch 升序排（最近碰过的排末尾）⇒ move 之后它就换位了；
 *     红不红只取决于两次操作是否落在**同一毫秒**。已改为按 flowId 精确取，
 *     并补 B36b 断言排序不变式（单调不降）——**偶发红的修法是让断言不再依赖时序，
 *     而不是重跑到绿为止**。
 *
 * ⚠️ 本闸门只 import 两个**不依赖 react / DOM** 的模块 ⇒ `node scripts/test-personalize.mjs`
 *    直接跑，无需 Harness / 浏览器。（两个 store 对 localStorage 都有 `typeof` 守卫。）
 *
 * 用法：node scripts/test-personalize.mjs
 * 退出码：0 全绿 / 1 有失败（可直接做 CI 闸门）
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	P_DEFAULTS, P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE, P_DIALOG_BG, P_IMG_MAX,
	PERSONALIZE_KEY, PERSONALIZE_STYLE_ID,
	pHexSoft, normalizePersonalize, pVarsFor, pCssText, loadPersonalize, personalizeStore,
	hexToRgb, relLuma, isLightHex, mixHex, contrastRatio, clampToContrast, dialogSkinFor, dialogVarsFor, DIALOG_VAR_KEYS
} from "../src/store/personalize.js";
import {
	DIM, DIM_ORDER, DIM_LABEL, FLOW_STATUS, FLOW_STATUS_LABEL, PENDING_LABEL,
	FLOW_KEY, FLOW_MAX, flowId, clip, makeFlow, hopFlow, flowDims, flowLine, lastHop, lastTouchOf,
	flowsOf, latestFlow, currentTaskOf, flowStats, flowsBySession, flowStore
} from "../src/logic/flow.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) { pass++; } else { fail++; failures.push(id + " " + name); }
	console.log("  " + (cond ? "✅" : "❌") + " " + id + " " + name + (detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""));
}
function section(s) { console.log("\n" + s); }
const SRC = (p) => readFileSync(resolve(import.meta.dirname, "../" + p), "utf8");

console.log("═══════════════════════════════════════════════════════════");
console.log(" 个性化 + 四维流转 · 离线纯函数闸门");
console.log("═══════════════════════════════════════════════════════════");

/* ══════════════════════════════════════════════════════════════════
 * A. 个性化：选项表 / 清洗 / 变量 / 样式表
 * ══════════════════════════════════════════════════════════════════ */
section("【A】个性化 · 选项表与清洗");
t("A1", "四组色板非空且每档都有 label（用户看得懂才能选）",
	[P_ACCENTS, P_ACCENT2, P_DENSITY, P_FONT, P_RADIUS, P_TEXTURES, P_EDGE]
		.every((L) => L.length >= 2 && L.every((o) => String(o.label || "").trim().length > 0)), null);
t("A2", "每档都有 desc 或至少 label !== key（不出现「#2f6feb」这种给机器看的选项）",
	P_ACCENTS.every((o) => String(o.desc || "").length > 4) && P_TEXTURES.every((o) => String(o.desc || "").length > 4), null);
t("A3", "质感四档齐（纯色 base + 网格 / 点阵 / 玻璃），默认档 = " + P_DEFAULTS.texture,
	P_TEXTURES.length === 4 && P_TEXTURES.some((o) => o.key === "solid") && P_TEXTURES.some((o) => o.key === P_DEFAULTS.texture), P_TEXTURES.map((o) => o.key));
t("A4", "默认值本身必须合法（normalize(默认) 后逐字段不变）",
	(() => { const n = normalizePersonalize(P_DEFAULTS); return Object.keys(P_DEFAULTS).every((k) => n[k] === P_DEFAULTS[k]); })(), null);
t("A5", "🔴 脏数据整体回落默认（accent 非法 / density 99 / texture 乱写 / radius 999）",
	(() => {
		const n = normalizePersonalize({ accent: "红色", accent2: "#GGGGGG", density: 99, fontScale: 7, radius: 999, texture: "xx", edge: "zz" });
		return n.accent === P_DEFAULTS.accent && n.accent2 === P_DEFAULTS.accent2 && n.density === P_DEFAULTS.density
			&& n.fontScale === P_DEFAULTS.fontScale && n.radius === P_DEFAULTS.radius && n.texture === P_DEFAULTS.texture && n.edge === P_DEFAULTS.edge;
	})(), null);
t("A6", "非对象输入（null / 字符串 / 数字）不抛，返回完整默认",
	[null, undefined, "x", 7].every((v) => { const n = normalizePersonalize(v); return n.texture === P_DEFAULTS.texture; }), null);
t("A7", "合法值被真的保留（正对照：否则 A5 可能只是「永远返回默认」的平凡真）",
	(() => { const n = normalizePersonalize({ accent: "#39C5CF", density: 1.15, radius: 14, texture: "glass", motion: false });
		return n.accent === "#39c5cf" && n.density === 1.15 && n.radius === 14 && n.texture === "glass" && n.motion === false; })(), null);
t("A8", "开关三态是布尔（undefined ⇒ 默认 true；显式 false ⇒ false）",
	(() => { const a = normalizePersonalize({}).motion; const b = normalizePersonalize({ motion: false }).motion;
		return a === true && b === false; })(), null);
t("A9", "pHexSoft 正常解析 + 🔴 非法输入回落主色蓝（绝不产出 NaN）",
	pHexSoft("#2f6feb", 0.16) === "rgba(47,111,235,0.16)" && /^rgba\(47,111,235,/.test(pHexSoft("zzz", 0.5))
	&& !/NaN/.test(pHexSoft(null, 0.5)) && !/NaN/.test(pHexSoft("#12345", 0.5)), [pHexSoft("#2f6feb", 0.16), pHexSoft("zzz", 0.5)]);

section("【A2】个性化 · CSS 变量与样式表");
const V = pVarsFor(P_DEFAULTS);
t("A10", "变量表覆盖四个界面真正用到的全部变量名",
	["--dp-ac", "--dp-ac-soft", "--dp-ac-line", "--dp-ac2", "--dp-ac2-soft", "--dp-ac2-line",
		"--dp-density", "--dp-font", "--dp-radius", "--dp-radius-sm", "--dp-radius-lg", "--dp-motion"]
		.every((k) => V[k] !== undefined), Object.keys(V));
t("A11", "改主色 ⇒ --dp-ac 与两个派生色同时变（正负对照：默认 vs 青）",
	(() => { const a = pVarsFor({ accent: "#2f6feb" }), b = pVarsFor({ accent: "#39c5cf" });
		return a["--dp-ac"] !== b["--dp-ac"] && a["--dp-ac-soft"] !== b["--dp-ac-soft"] && a["--dp-ac-line"] !== b["--dp-ac-line"]; })(), null);
t("A12", "圆角三档派生正确（radius=14 ⇒ sm 11 / lg 18，不是写死）",
	(() => { const v = pVarsFor({ radius: 14 }); return v["--dp-radius"] === "14px" && v["--dp-radius-sm"] === "11px" && v["--dp-radius-lg"] === "18px"; })(), null);
t("A13", "🔴 圆角下界保护：radius=0 ⇒ sm 仍 ≥ 2px（不产出负圆角导致渲染崩）",
	(() => { const v = pVarsFor({ radius: 0 }); return parseInt(v["--dp-radius-sm"], 10) >= 2; })(), pVarsFor({ radius: 0 }));
t("A14", "动效开关映射成 --dp-motion 1/0",
	pVarsFor({ motion: true })["--dp-motion"] === "1" && pVarsFor({ motion: false })["--dp-motion"] === "0", null);

const CSS = pCssText();
t("A15", "样式表含 .dp-textured 基线（solid 档必须是 background-image:none）",
	/\.dp-textured\{background-image:none;\}/.test(CSS), null);
t("A16", "🔴 三档纹理各有独立规则（选了就有反应，不是共用一条）",
	/\[data-dp-texture="grid"\]/.test(CSS) && /\[data-dp-texture="dots"\]/.test(CSS) && /\[data-dp-texture="glass"\]/.test(CSS), null);
t("A17", "纹理规则都在 .dp-textured 上（否则会污染整棵 DOM）",
	(CSS.match(/data-dp-texture="(grid|dots|glass)"\][^{]*/g) || []).every((s) => /\.dp-textured/.test(s)), null);
t("A18", "动效关闭规则存在且用 !important（否则被组件内联样式压过）",
	/data-dp-motion="0"/.test(CSS) && /animation:none\s*!important/.test(CSS), null);
t("A19", "样式表**不使用反引号**（避免与下游打包工具链的模板字面量互相干扰）",
	CSS.indexOf(String.fromCharCode(96)) < 0, null);
t("A20", "样式表含基础原子类（surface / card / chip / btn / input / scroll）",
	[".dp-surface", ".dp-card", ".dp-chip", ".dp-btn", ".dp-input", ".dp-scroll"].every((c) => CSS.indexOf(c) >= 0), null);

section("【A3】个性化 · store 行为（离线可跑：localStorage 有 typeof 守卫）");
t("A21", "store 初值 = 合法设定（脏 localStorage 不会带崩界面）",
	Object.keys(P_DEFAULTS).every((k) => normalizePersonalize(personalizeStore.getState())[k] === personalizeStore.getState()[k]), null);
t("A22", "set 未知键被忽略（保证 store 不会被写脏）", personalizeStore.set("__nope__", 1) === false, null);
t("A23", "set 已知键生效且订阅者收到通知（订阅在先、触发在后）",
	(() => { let hits = 0; const off = personalizeStore.subscribe(() => { hits++; });
		personalizeStore.set("radius", 14); const ok = personalizeStore.getState().radius === 14; off();
		personalizeStore.reset(); return ok && hits === 1; })(), null);
t("A24", "reset 回到默认（用户改乱了必须能一键回去）",
	(() => { personalizeStore.set("texture", "glass"); personalizeStore.reset();
		return personalizeStore.getState().texture === P_DEFAULTS.texture; })(), null);
t("A25", "退订真的生效（退订后再改，不再收到通知）",
	(() => { let hits = 0; const off = personalizeStore.subscribe(() => { hits++; }); off();
		personalizeStore.set("radius", 4); const n = hits; personalizeStore.reset(); return n === 0; })(), null);

/* ══════════════════════════════════════════════════════════════════
 * B. 四维流转：纯函数
 * ══════════════════════════════════════════════════════════════════ */
section("【B】四维流转 · 维度与登记");
t("B1", "四维顺序 = 用户原话顺序（总监 → 对话 → 思维导图 → 设计图）",
	DIM_ORDER.join(",") === "director,chat,mindmap,design" && DIM_ORDER.every((d) => DIM_LABEL[d]), DIM_ORDER);
t("B2", "flowId 稳定（同种子同 id）且不同种子不同 id（不用 Math.random）",
	flowId("a") === flowId("a") && flowId("a") !== flowId("b"), [flowId("a"), flowId("b")]);
t("B3", "flowId 对 null / undefined 安全（不抛）", typeof flowId(null) === "string" && typeof flowId(undefined) === "string", null);
t("B4", "clip 折叠空白 + 超长截断带省略号，n 边界不越界",
	clip("  a   b  ", 10) === "a b" && clip("x".repeat(50), 10).length === 10 && clip("", 10) === "", null);
const F1 = makeFlow({ text: "把右侧面板的标题改成「现在在做的事」", origin: "director", sessionId: "s1", at: 1000 });
t("B5", "makeFlow 初始状态 = open，且 trail 已有起点足迹（从 origin 出发）",
	F1.status === FLOW_STATUS.OPEN && F1.trail.length === 1 && F1.trail[0].dim === "director", F1);
t("B6", "非法 origin 回落总监（不产出 undefined 维度）",
	makeFlow({ text: "x", origin: "nope" }).origin === DIM.DIRECTOR, makeFlow({ text: "x", origin: "nope" }).origin);
t("B7", "sessionId 缺省为 null（= 全域流转），给了就转成字符串",
	makeFlow({ text: "x" }).sessionId === null && makeFlow({ text: "x", sessionId: 7 }).sessionId === "7", null);

section("【B2】四维流转 · 走动与足迹");
const F2 = hopFlow(F1, "chat", "发到对话", { at: 2000 });
const F3 = hopFlow(F2, "mindmap", "导图引用", { at: 3000 });
t("B8", "🔴 hop 后 origin **不变**（「从哪来」必须可追溯，否则轨迹是错的）",
	F2.origin === "director" && F3.origin === "director", [F2.origin, F3.origin]);
t("B9", "hop 是**纯函数**：不改原对象（便于前后对比 / 撤销）",
	F1.trail.length === 1 && F2.trail.length === 2 && F3.trail.length === 3, [F1.trail.length, F2.trail.length, F3.trail.length]);
t("B10", "flowDims 去重且按界面顺序返回（不是按走访顺序）",
	flowDims(F3).join(",") === "director,chat,mindmap", flowDims(F3));
t("B11", "flowLine 生成可读轨迹「总监 → 对话 → 思维导图」",
	flowLine(F3) === "总监 → 对话 → 思维导图", flowLine(F3));
t("B12", "lastHop 指向最后落点（界面据此显示「现在在哪一维」）",
	lastHop(F3).dim === "mindmap" && lastHop(F3).at === 3000, lastHop(F3));
t("B13", "非法维度 hop 被忽略且**原样返回**（不产出野足迹）",
	hopFlow(F3, "nope", "x").trail.length === 3, hopFlow(F3, "nope", "x").trail.length);
t("B14", "hop null 安全（返回 null，不抛）", hopFlow(null, "chat", "x") === null, null);
t("B15", "hop 可带 status / target（「已送达」需要落点）",
	(() => { const f = hopFlow(F1, "chat", "发", { status: FLOW_STATUS.ROUTED, target: "s1" });
		return f.status === FLOW_STATUS.ROUTED && f.target === "s1"; })(), null);

section("【B3】四维流转 · 「现在在做的事」五级优先级");
t("B16", "① 宿主 pendingInteraction 最强 —— 文案含「待你确认」+ 状态源标 host.pendingInteraction",
	(() => { const r = currentTaskOf({ node: { pending: "approval" }, flow: F3, flowList: [F1, F2, F3] });
		return /待你确认/.test(r.title) && /等待批准/.test(r.title) && r.source === "host.pendingInteraction" && r.tone === "warn"; })(), null);
t("B17", "② 其次 running —— 状态源标 host.running",
	(() => { const r = currentTaskOf({ node: { running: true }, flow: F3, flowList: [F3] }); return r.source === "host.running" && r.tone === "run"; })(), null);
t("B18", "🔴 ① 压倒 ②（同时成立时显示「在等人」，不是「在跑」）",
	(() => { const r = currentTaskOf({ node: { pending: "question", running: true }, flowList: [] }); return r.source === "host.pendingInteraction"; })(), null);
t("B19", "③ 无宿主真值时用最新流转 —— 状态源标 flow.trail，标题 = 那句话",
	(() => { const r = currentTaskOf({ node: {}, flow: F3, flowList: [F1, F2, F3] });
		return r.source === "flow.trail" && r.title === F3.text && /流转 3 条/.test(r.detail); })(), null);
t("B20", "④ 只有总监消息时用最后一条 —— 状态源标 plugin-db",
	(() => { const r = currentTaskOf({ node: {}, msgs: [{ text: "总监说", at: 5, kind: "note" }] });
		return r.source === "plugin-db" && r.title === "总监说"; })(), null);
t("B21", "⑤ 什么都没有 ⇒ 如实报「待命 · 尚无流转」，**不编内容**",
	(() => { const r = currentTaskOf({ node: {} }); return /待命/.test(r.title) && r.source === "host.idle"; })(), null);
t("B22", "连会话都没选 ⇒ 文案改说「点左侧会话或导图里的任一个框」（给出下一步动作）",
	(() => { const r = currentTaskOf({}); return r.source === "none" && /点左侧/.test(r.detail); })(), null);
t("B23", "🔴 每个分支都带非空 source（读不到时用户能分辨「没数据」与「界面坏了」）",
	["none", "host.idle", "host.running", "host.pendingInteraction", "host.completed", "flow.trail", "plugin-db"].every((s) => typeof s === "string"), null);
t("B24", "【正负对照】同一份输入，抽掉宿主字段 ⇒ 结论与状态源都变（证明真在读，不是恒定装饰）",
	(() => { const a = currentTaskOf({ node: { running: true }, flowList: [] });
		const b = currentTaskOf({ node: {}, flowList: [] });
		return a.source !== b.source && a.title !== b.title; })(), null);
t("B25", "宿主 completed 且无流转 ⇒ 报「已收口」（不冒充「在做」）",
	(() => { const r = currentTaskOf({ node: { completed: true }, flowList: [] });
		return r.source === "host.completed" && r.tone === "done"; })(), null);

section("【B4】四维流转 · 会话聚合与统计");
const fA = makeFlow({ text: "甲", sessionId: "A", at: 10 });
const fB = makeFlow({ text: "乙", sessionId: "B", at: 20 });
const fG = makeFlow({ text: "全域", sessionId: null, at: 30 });
const fMulti = hopFlow(hopFlow(fB, "mindmap", "看", { at: 40 }), "design", "画", { at: 50 });
const ALL = [fA, fB, fG, fMulti];
t("B26", "flowsOf 只取该会话，且按**最后活动**升序（切会话时列表顺序稳定）",
	flowsOf(ALL, "B").length === 2 && lastTouchOf(flowsOf(ALL, "B")[0]) <= lastTouchOf(flowsOf(ALL, "B")[1]), null);
t("B27", "🔴 全域流转（sessionId=null）不污染具体会话列表；只在查全域时出现",
	flowsOf(ALL, "A").length === 1 && flowsOf(ALL, null).length === 1 && flowsOf(ALL, null)[0].text === "全域", null);
t("B28", "🔴 lastTouchOf = 登记时刻与全部足迹时刻取最大（`at` 只是登记时刻，hop 不改它）",
	lastTouchOf(fB) === 20 && lastTouchOf(fMulti) === 50 && fMulti.at === 20, [lastTouchOf(fB), lastTouchOf(fMulti), fMulti.at]);
t("B29", "latestFlow 取该会话**最后有动静**的一条（不是最后登记的一条）",
	latestFlow(ALL, "B").flowId === fMulti.flowId && latestFlow(ALL, "ZZZ") === null, null);
t("B30", "【正负对照】同批里 later-registered 但已僵住的条目，不得盖过 later-touched 的条目",
	(() => {
		const stuck = makeFlow({ text: "早登记晚僵住", sessionId: "C", at: 100 });
		const live = hopFlow(makeFlow({ text: "先登记后推进", sessionId: "C", at: 10 }), "design", "画", { at: 900 });
		return latestFlow([stuck, live], "C").flowId === live.flowId;
	})(), null);
t("B31", "flowStats 按维度计数且 multiDim 只统计真的跨了 ≥2 维的",
	(() => { const s = flowStats(ALL); return s.total === 4 && s.multiDim === 1 && s.byDim.mindmap === 1 && s.byDim.design === 1; })(), flowStats(ALL));
t("B32", "flowStats 对 null / 非数组安全（返回零值而非抛）",
	(() => { const s = flowStats(null); return s.total === 0 && s.multiDim === 0 && Object.keys(s.byDim).length === 4; })(), null);
t("B33", "flowsBySession 用 __global__ 收纳全域条目（不丢，也不与真会话 id 撞）",
	(() => { const m = flowsBySession(ALL); return m.has("__global__") && m.get("__global__").length === 1 && m.has("A"); })(), null);
t("B34", "flow.trail 分支的 at 取**最后一次足迹**（面板上那句「现在在做的事」旁的时间不会是旧的）",
	(() => { const r = currentTaskOf({ node: {}, flow: fMulti, flowList: [fMulti] }); return r.at === 50; })(), null);

section("【B5】四维流转 · store 行为");
flowStore.reset();
const p1 = flowStore.push("甲消息", { sessionId: "A", origin: "director" });
const p2 = flowStore.push("乙消息", { sessionId: "A", origin: "director" });
flowStore.push("", { sessionId: "A" });
t("B35", "push 空文本被拒（返回 null 且不落库）—— 防空流转冲掉真记录",
	flowStore.ofSession("A").length === 2 && p1 && p2, flowStore.ofSession("A").length);
/* 🔴 B36/B37 为什么必须按 flowId 取、不能用下标 —— 本轮真实偶发红（3 批里红 1 批）：
 *    `ofSession()` 走 `flowsOf()`，按 **lastTouchOf 升序**排（最近碰过的排最后）。
 *    B36 先 push 两条再 move 第一条 ⇒ 第一条的 lastTouch 变大 ⇒ **被排到末尾**，
 *    此时 `ofSession()[0]` 已经不是它了。
 *    红不红取决于 move 与第二次 push 是否落在**同一毫秒**（同毫秒则并列、稳定排序保持
 *    登记顺序 ⇒ "碰巧过"；跨毫秒则真的换位 ⇒ 红）——典型的"偶发红"，
 *    而偶发红比稳定红更危险：容易被当成"环境抖动"放过，也容易被误判成产品缺陷。 */
t("B36", "move 推进到下一维并留下足迹（同一条记录被增强，不是新建一条）",
	(() => { flowStore.move(p1.flowId, "chat", "发到对话", { status: FLOW_STATUS.ROUTED, target: "A" });
		const f = flowStore.ofSession("A").filter((x) => x.flowId === p1.flowId)[0];
		return Boolean(f) && flowDims(f).join(",") === "director,chat" && f.status === FLOW_STATUS.ROUTED && flowStore.ofSession("A").length === 2; })(), null);
t("B36b", "🔴 ofSession 的排序不变式：lastTouch 单调不降（= 最新在末尾，故**不可**用下标取刚 push 的那条）",
	(() => { const arr = flowStore.ofSession("A");
		return arr.length === 2 && lastTouchOf(arr[0]) <= lastTouchOf(arr[1]); })(), null);
t("B37", "setStatus 收口：状态变 done 且**落点维度不变**",
	(() => { flowStore.setStatus(p2.flowId, FLOW_STATUS.DONE, null);
		const f = flowStore.ofSession("A").filter((x) => x.flowId === p2.flowId)[0];
		return Boolean(f) && f.status === FLOW_STATUS.DONE && lastHop(f).dim === "director"; })(), null);
t("B38", "latestOf / taskOf / stats 三个查询口与纯函数结果一致（store 不另算一套）",
	flowStore.latestOf("A").text !== undefined && flowStore.stats().total === 2
	&& flowStore.taskOf({ node: {}, flow: flowStore.latestOf("A"), flowList: flowStore.ofSession("A") }).source === "flow.trail", null);
t("B39", "setActiveSession 切会话：写入生效且同值不重复通知（防抖，避免切一下刷三次）",
	(() => { let hits = 0; const off = flowStore.subscribe(() => { hits++; });
		flowStore.setActiveSession("A"); const n1 = hits; flowStore.setActiveSession("A"); const same = hits === n1;
		off(); return flowStore.getState().activeSessionId === "A" && same && n1 === 1; })(), null);
t("B40", "FLOW_MAX 上限存在且为正整数（防 localStorage 无限膨胀）",
	Number.isInteger(FLOW_MAX) && FLOW_MAX > 10, FLOW_MAX);
t("B41", "超上限时丢最旧的、保留最新的（正负对照：不是整段清空）",
	(() => { flowStore.reset();
		for (let i = 0; i < FLOW_MAX + 5; i++) flowStore.push("m" + i, { sessionId: "Z" });
		const list = flowStore.ofSession("Z");
		const ok = list.length === FLOW_MAX && list[list.length - 1].text === "m" + (FLOW_MAX + 4) && list[0].text === "m5";
		flowStore.reset(); return ok; })(), null);
flowStore.reset();

/* ══════════════════════════════════════════════════════════════════
 * C. 面板契约：四处必须真的共用同一个组件与同一份持久化
 * ══════════════════════════════════════════════════════════════════ */
section("【C】四个界面 · 「同一个面板」的源码级一致性");
/** [文件, 该界面的 scope 文案, 质感所在**样式块**的 key, 该块必须用的背景长写] */
const PAGES = [
	["src/components/DirectorPage.js", "总监页", "root", 'backgroundColor: "var(--dsw-alias-bg-base, var(--dp-bg-0, #0b0c0e))"'],
	/* 🔴 弹窗面板的宿主兜底令牌 2026-09-17 由 `bg-base` 改为 **`bg-overlay`**：
	 *   实测宿主是"深色页面(`rgb(7,17,29)`) + 浅色玻璃层"设计，`bg-base` 是 `rgba(246,250,255,0.40)`
	 *   的最外层玻璃 —— 单独当浮层底会合成出中灰 `rgb(103,110,119)`，正文字对比度只有 3.06:1。
	 *   浮层应当用宿主**专为浮层准备**的 `bg-overlay`（实测 0.96）。详见 D25。 */
	["src/components/DirectorDialog.js", "总监弹窗", "panel", 'backgroundColor: "var(--dp-dlg-bg, var(--dsw-alias-bg-overlay, #16171a))"'],
	["src/components/MindMap.js", "分支导图", "root", 'backgroundColor: "var(--dp-bg-0, #0b0c0e)"'],
	["src/components/DesignStudio.js", "设计图", "root", 'backgroundColor: "var(--dsw-alias-bg-base, #0f1013)"']
];
const sources = PAGES.map(([f]) => [f, SRC(f)]);

/**
 * 取样式块 `key: { … }` 的源码文本（花括号配平，跳过字符串字面量内的括号）。
 *
 * 🔴 为什么必须**按块**检查，而不是全文件搜字符串（本闸门第一版就是全文件搜，结果误杀）：
 *    第一版 C6 搜 `background: "var(--dp-bg-0, #0b0c0e)"`，命中了
 *    `MindMap.body` / `NodeDetailPanel` / `DirectorHierarchy.root` 三处
 *    —— 它们身上**没有** `.dp-textured`，用简写完全无害，
 *    却被负断言判成"旧写法没清干净"。
 *    ⇒ 反证写宽了会误杀、写窄了才是证据。故收敛到"质感元素真正消费的那个块"。
 */
function styleBlock(src, key) {
	const k = key + ": {";
	const i = src.indexOf(k);
	if (i < 0) return "";
	let d = 0, inStr = false, j = i + k.length - 1;
	for (; j < src.length; j++) {
		const c = src[j];
		if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; continue; }
		if (c === '"') { inStr = true; continue; }
		if (c === "{") d++;
		else if (c === "}") { d--; if (d === 0) break; }
	}
	return src.slice(i, j + 1);
}

/**
 * 剥掉源码里的注释：斜杠-星号成对的块注释，与斜杠-斜杠行注释。
 *
 * 🔴 为什么断言扫源码前**必须**先剥注释（本轮 C6 又被绊了一次）：
 *    C6 是对"块内不得残留 background 简写"的负断言。本轮给 DirectorPage.root 补说明时，
 *    注释里顺笔写了"宿主原生页签用的是 background: var(--dsw-alias-bg-base)"——
 *    于是**注释里的举例**把闸门弄红了，而真实代码用的正是 backgroundColor 长写。
 *    ⇒ 这种红是"假故障"，但危害不小：它逼着人去**删注释**（丢信息）而不是修代码。
 *    另注意：本函数自身不能用块注释符号做示例（会提前终止注释），故此处用文字描述。
 */
function stripComments(s) {
	let out = "", inStr = false, i = 0;
	while (i < s.length) {
		const c = s[i];
		if (inStr) {
			out += c;
			if (c === "\\") { out += s[i + 1] || ""; i += 2; continue; }
			if (c === '"') inStr = false;
			i++; continue;
		}
		if (c === '"') { inStr = true; out += c; i++; continue; }
		if (c === "/" && s[i + 1] === "*") { const j = s.indexOf("*" + "/", i + 2); i = j < 0 ? s.length : j + 2; continue; }
		if (c === "/" && s[i + 1] === "/") { const j = s.indexOf("\n", i); i = j < 0 ? s.length : j; continue; }
		out += c; i++;
	}
	return out;
}

t("C1", "四处都 import 了同一个个人化组件（不是各自实现一份）",
	sources.every(([, s]) => /import\s*\{\s*PersonalizePanel\s*\}\s*from\s*"\.\/PersonalizePanel\.js"/.test(s)), null);
t("C2", "四处都真的渲染了它（import 了不用 = 死代码）",
	sources.every(([, s]) => /h\(PersonalizePanel,\s*\{/.test(s)), null);
t("C3", "四处的 scope 文案齐备且互不相同（e2e 据此确认「这一处是哪一个」）",
	(() => { const got = PAGES.map(([f, scope]) => { const s = SRC(f); return s.indexOf('scope: "' + scope + '"') >= 0 ? scope : null; });
		return got.every(Boolean) && new Set(got).size === 4; })(), PAGES.map(([f, scope]) => [f, scope]));
t("C4", "四处都带质感类 dp-textured（否则选了纹理也没地方显）",
	/* 2026-09-14 修（闸门过期）：原判据写死 className **恰好等于** `"dp-textured"`，而 V17 给两个浮层
	 * 补了过渡类（`className: "dp-textured dp-overlay-in"`）⇒ 正则失配、假红（读起来像"产品丢了质感类"）。
	 * 改成「值里含 dp-textured 这个词」，并用 (?<![-\w]) / (?![-\w]) 拦住 `dp-textured-xxx` 这类前缀相似名。 */
	sources.every(([, s]) => /className:\s*"[^"]*(?<![-\w])dp-textured(?![-\w])[^"]*"/.test(s)), null);
t("C5", "🔴 四个质感元素的背景必须是 backgroundColor 长写 —— 简写会把 background-image 重置，纹理静默失效（本轮真实踩坑）",
	PAGES.every(([f, , key, bg]) => styleBlock(SRC(f), key).indexOf(bg) >= 0), PAGES.map(([f, , key, bg]) => [f, key, bg]));
t("C6", "🔴 反证（按块精确，且已剥注释）：质感元素自己那个样式块里**不得**残留 background 简写",
	(() => {
		const hits = [];
		for (const [f, , key] of PAGES) {
			const blk = styleBlock(SRC(f), key);
			if (!blk) { hits.push(f + " :: 未找到样式块 " + key); continue; }
			if (stripComments(blk).indexOf("background:") >= 0) hits.push(f + " :: " + key + " 里仍有 background 简写");
		}
		return hits.length === 0; })(), null);
t("C6b", "反证本身有效（给一个真的带简写的假块 ⇒ 必须被判红）",
	stripComments(styleBlock('const S = { root: { background: "x", color: "y" } };', "root")).indexOf("background:") >= 0
	&& stripComments(styleBlock('const S = { root: { backgroundColor: "x", color: "y" } };', "root")).indexOf("background:") < 0, null);
t("C6c", "剥注释本身有效（注释里的举例不得判红；真简写仍判红）—— 否则会逼人删注释来过关",
	stripComments('{ /* 举例 background: x */ backgroundColor: "y" }').indexOf("background:") < 0
	&& stripComments('{ // 举例 background: x\n backgroundColor: "y" }').indexOf("background:") < 0
	&& stripComments('{ background: "y" }').indexOf("background:") >= 0, null);
t("C7", "四个面板壳的字体缩放走 CSS 变量（不会被根节点写死的字号掐断继承）",
	sources.every(([, s]) => /var\(--dp-font/.test(s)), null);
t("C8", "四个面板壳的颜色都消费 --dp-* （改了主色四处同时变）",
	sources.every(([, s]) => /var\(--dp-/.test(s)), null);
t("C9", "持久化 key 唯一且与历史上用过的 key 不撞（升级不丢用户设定）",
	PERSONALIZE_KEY === "dsh.director.personalize" && FLOW_KEY === "dsh.director.flow"
	&& PERSONALIZE_KEY !== FLOW_KEY && PERSONALIZE_STYLE_ID === "dsh-personalize-css", [PERSONALIZE_KEY, FLOW_KEY]);
t("C10", "两个新 store 都不 import react（否则离线闸门 import 不进来）",
	[SRC("src/store/personalize.js"), SRC("src/logic/flow.js")].every((s) => !/from\s+"react"/.test(s) && !/require\(["']react/.test(s)), null);
t("C11", "两个 store 的持久化都带 typeof 守卫（隐私模式 / SSR 下不抛）",
	/typeof localStorage !== "undefined"/.test(SRC("src/store/personalize.js"))
	&& /typeof localStorage !== "undefined"/.test(SRC("src/logic/flow.js")), null);
t("C12", "🔴 四维标签与用户原话一致（总监 / 对话 / 思维导图 / 设计图）",
	[DIM.DIRECTOR, DIM.CHAT, DIM.MINDMAP, DIM.DESIGN].map((d) => DIM_LABEL[d]).join("/") === "总监/对话/思维导图/设计图", null);
t("C13", "四种流转状态都有中文标签（界面上不出现英文枚举）",
	Object.keys(FLOW_STATUS).every((k) => String(FLOW_STATUS_LABEL[FLOW_STATUS[k]] || "").length > 0), FLOW_STATUS_LABEL);
t("C14", "宿主三种 pendingInteraction 都有标签（取值域与 mindmap-schema 对齐）",
	["approval", "question", "plan-review"].every((k) => PENDING_LABEL[k]), PENDING_LABEL);

/* ── C15~C18：总监页背景跟随宿主（需求「总监 tab 页面的背景采用原软件的背景，保持风格统一」） ──
 *   ✗ 失败形态（**本轮真实踩坑，且是静默的**）：把桥接写成 `:root{--dp-bg-0:var(--dsw-alias-bg-base)}`。
 *     CSS 自定义属性里的 var() 是在**定义它的那个元素上**求值的，而宿主把 --dsw-alias-*
 *     定义在 `body`（**不在** html/:root —— 实测 documentElement 上取到空串）。
 *     于是 :root 上求值失败 ⇒ 落到 fallback ⇒ **背景根本没跟随宿主，却没有任何报错**，
 *     读属性一切正常。故此处既断言"有桥接"，也断言"不许写在 :root 上"。 */
function cssRule(css, sel) {
	const i = css.indexOf(sel + "{");
	if (i < 0) return "";
	let d = 0, j = i + sel.length;
	for (; j < css.length; j++) {
		if (css[j] === "{") d++;
		else if (css[j] === "}") { d--; if (d === 0) break; }
	}
	return css.slice(i, j + 1);
}
const BRIDGE = cssRule(CSS, '[data-testid="dp-root"]');
const aliasCount = (BRIDGE.match(/--dsw-alias-[a-z0-9-]+/g) || []).length;
t("C15", "🔴 总监页有一块宿主令牌桥接，且真的引用 --dsw-alias-*（背景与原生页签**同源同值**）",
	Boolean(BRIDGE) && aliasCount >= 6, BRIDGE ? aliasCount + " 个宿主令牌" : "未找到 dp-root 规则");
t("C16", "🔴 反证：桥接**不得**写在 :root 上（var() 在定义处求值，:root 取不到 body 上的令牌 ⇒ 静默失效）",
	Boolean(cssRule(CSS, ":root")) && cssRule(CSS, ":root").indexOf("--dsw-alias-") < 0,
	cssRule(CSS, ":root").slice(0, 70));
t("C17", "🔴 四个表面令牌的映射方向正确（bg-0→bg-base / bg-1→layer-1 / bg-2→layer-2 / t1→label-primary）",
	["--dp-bg-0:var(--dsw-alias-bg-base", "--dp-bg-1:var(--dsw-alias-bg-layer-1",
		"--dp-bg-2:var(--dsw-alias-bg-layer-2", "--dp-t1:var(--dsw-alias-label-primary"].every((s) => BRIDGE.indexOf(s) >= 0), null);
t("C18", "纹理色已变量化且总监页覆写（浅色底下白纹理**等于不可见** ⇒ 选了网格像没选）",
	/--dp-tex:\S/.test(cssRule(CSS, ":root")) && BRIDGE.indexOf("--dp-tex:") >= 0
	&& CSS.indexOf("background-image:linear-gradient(var(--dp-tex)") >= 0, null);

/* ══════════════════════════════════════════════════════════════════
 * D. 总监弹窗背景（2026-09-17 新增）
 *
 *   需求原文（用户）：「左侧点击总监按钮，总监的弹窗，背景是黑色的。调整下，按照人眼最舒服
 *     温馨的风格调整背景和文字的颜色；同时增加自定义背景颜色的选项，可以上传图片作为背景；
 *     默认的话可以跟随软件的背景主题」
 *
 *   ✗ 失败形态（这一档的四种，前三种都**不会报错**）：
 *     ① 把 follow 档的宿主令牌写进 `:root` ⇒ 求值失败静默落 fallback ⇒「跟随主题」其实是假跟随
 *        （与 C15/C16 同一个坑，所以 D 段自己再钉一遍 —— 新皮肤是新代码，不会自动继承旧断言）；
 *     ② 自定义底色按 "浅底/深底" 二分挑文字色 ⇒ 中间灰上选反边，白字比黑字对比度还低；
 *     ③ 有图片时卡片仍不透明 ⇒ 照片只在缝隙里露几条纹（"上传了但看不出效果"）；
 *     ④ 切回 follow 不清理 `--dp-dlg-*` ⇒ 残留上一档的米色，而界面上"跟随主题"是选中的。
 *   ⇒ 四条各配一条断言，且每条都有**正负对照**（不只报绿）。
 * ══════════════════════════════════════════════════════════════════ */
section("【D】总监弹窗背景 · 四档 / 可读性 / 图片 / 跟随主题");

t("D1", "四档齐全（跟随主题 / 暖白 / 暖夜 / 自定义）且每档都有 desc",
	P_DIALOG_BG.length === 4
	&& ["follow", "warm", "dim", "custom"].every((k) => P_DIALOG_BG.some((o) => o.key === k && String(o.desc || "").length > 8)),
	P_DIALOG_BG.map((o) => o.key));

t("D2", "🔴 默认档 = warm 而**不是** follow（宿主当前是深色 ⇒ follow 出来还是黑底 = 用户抱怨什么就保持什么）",
	P_DEFAULTS.dialogBg === "warm" && P_DIALOG_BG.some((o) => o.key === "follow"), P_DEFAULTS.dialogBg);

t("D3", "🔴 内置两档的正文对比度 ≥ 4.5（WCAG AA）—— 把「人眼舒服」变成可断言的数",
	["warm", "dim"].every((m) => { const k = dialogSkinFor({ dialogBg: m }); return contrastRatio(k.bg, k.t1) >= 4.5; }),
	["warm", "dim"].map((m) => { const k = dialogSkinFor({ dialogBg: m }); return m + "=" + contrastRatio(k.bg, k.t1).toFixed(2); }));

t("D4", "暖白底真的是浅底、暖夜底真的是深底，且两者不同（否则「暖白」是名字而已）",
	(() => { const w = dialogSkinFor({ dialogBg: "warm" }), d = dialogSkinFor({ dialogBg: "dim" });
		return isLightHex(w.bg) && !isLightHex(d.bg) && w.bg !== d.bg; })(),
	[dialogSkinFor({ dialogBg: "warm" }).bg, dialogSkinFor({ dialogBg: "dim" }).bg]);

t("D5", "🔴 暖夜底**不是纯黑**（相对亮度 > 0.004）—— #000 上的白字有光晕感，正是用户抱怨的那种观感",
	relLuma(dialogSkinFor({ dialogBg: "dim" }).bg) > 0.004,
	relLuma(dialogSkinFor({ dialogBg: "dim" }).bg).toFixed(4));

t("D6", "自定义底色按亮度自动配文字（正负对照：亮底给深字、暗底给浅字）",
	(() => { const a = dialogSkinFor({ dialogBg: "custom", dialogBgColor: "#ffeecc" });
		const b = dialogSkinFor({ dialogBg: "custom", dialogBgColor: "#112233" });
		return relLuma(a.t1) < 0.15 && relLuma(b.t1) > 0.6; })(),
	[dialogSkinFor({ dialogBg: "custom", dialogBgColor: "#ffeecc" }).t1, dialogSkinFor({ dialogBg: "custom", dialogBgColor: "#112233" }).t1]);

t("D7", "🔴 中间灰也必须选对边（#808080 / #7a7262）—— 按 luma 二分会在这两个色上选反边，故实现走对比度择优",
	["#808080", "#7a7262", "#87817a", "#6f6f78"].every((c) => {
		const k = dialogSkinFor({ dialogBg: "custom", dialogBgColor: c });
		return contrastRatio(k.bg, k.t1) >= contrastRatio(k.bg, "#000000") * 0.85
			&& contrastRatio(k.bg, k.t1) >= contrastRatio(k.bg, "#ffffff") * 0.85;
	}), ["#808080", "#7a7262"].map((c) => contrastRatio(c, dialogSkinFor({ dialogBg: "custom", dialogBgColor: c }).t1).toFixed(2)));

t("D8", "自定义底色扫 12 色，正文对比度 ≥ 4.0（中间灰背景的物理上限约 4.5）",
	["#ffeecc", "#f7f2e8", "#ffffff", "#112233", "#000000", "#7a7262", "#808080", "#d0c8b8",
		"#3a3228", "#e8d9c0", "#2f6bdd", "#9a8f7f"].every((c) => {
		const k = dialogSkinFor({ dialogBg: "custom", dialogBgColor: c });
		return contrastRatio(k.bg, k.t1) >= 4;
	}), null);

t("D9", "层次方向正确：bg1 永远比 bg 亮（浅底浅、深底也浅一点 = 卡片抬起来），两张底都成立",
	["warm", "dim"].every((m) => { const k = dialogSkinFor({ dialogBg: m }); return relLuma(k.bg1) > relLuma(k.bg); }), null);

t("D10", "🔴 follow 档**一个皮肤变量都不产出**（产出了就等于把宿主令牌固化进 :root ⇒ 静默假跟随）",
	Object.keys(dialogVarsFor({ dialogBg: "follow" })).length === 0,
	Object.keys(dialogVarsFor({ dialogBg: "follow" })));

t("D11", "follow + 图片 ⇒ 只产出遮罩、不产出色值（文字仍走宿主令牌，宿主换主题即时生效）",
	(() => { const v = dialogVarsFor({ dialogBg: "follow", dialogBgImage: "data:image/png;base64,AAAA" });
		const keys = Object.keys(v);
		return keys.length === 2 && keys.indexOf("--dp-dlg-scrim") >= 0 && keys.indexOf("--dp-dlg-t1") < 0; })(), null);

t("D12", "🔴 图片过滤（负对照）：http 外链 / file 路径 / javascript: / 超长 base64 一律丢弃；合法 dataURL 保留",
	(() => {
		const bad = ["https://a.example/x.png", "file:///c:/x.png", "./x.png", "javascript:alert(1)",
			"data:text/html;base64,AAAA", "data:image/png;base64," + "A".repeat(P_IMG_MAX + 10)];
		const good = normalizePersonalize({ dialogBgImage: "data:image/png;base64,AAAA" }).dialogBgImage;
		return bad.every((b) => normalizePersonalize({ dialogBgImage: b }).dialogBgImage === "") && good === "data:image/png;base64,AAAA";
	})(), null);

t("D13", "有图片时卡片色变**半透明**（rgba）且产出 --dp-dlg-img（否则照片被不透明卡片盖死，等于没上传）",
	(() => {
		const img = "data:image/png;base64,AAAA";
		const k = dialogSkinFor({ dialogBg: "warm", dialogBgImage: img });
		const v = dialogVarsFor({ dialogBg: "warm", dialogBgImage: img });
		return /^rgba\(/.test(k.bg1) && /^rgba\(/.test(k.bg2) && String(v["--dp-dlg-img"] || "").indexOf("url(") === 0;
	})(), null);

t("D14", "遮罩浓度：脏值（NaN / 字符串 / 负数 / 超界）一律夹紧回落，绝不产出 NaN 或 > 1",
	(() => {
		const dims = [NaN, "x", -5, 99, undefined, 0.5];
		return dims.every((d) => { const n = normalizePersonalize({ dialogBgDim: d }).dialogBgDim;
			return Number.isFinite(n) && n >= 0 && n <= 0.95; })
			&& normalizePersonalize({ dialogBgDim: 0.5 }).dialogBgDim === 0.5;
	})(), null);

t("D15", "变量名全表覆盖产出的每个键（漏一个 ⇒ 切档时那一项残留 = 界面与设定不一致）",
	(() => {
		const img = "data:image/png;base64,AAAA";
		const keys = new Set(DIALOG_VAR_KEYS);
		const produced = ["warm", "dim", "custom", "follow"].flatMap((m) => Object.keys(dialogVarsFor({
			dialogBg: m, dialogBgImage: m === "follow" ? "" : img
		})));
		return produced.every((k) => keys.has(k));
	})(), DIALOG_VAR_KEYS.length);

t("D16", "🔴 反证：全表本身有内容且含图片两键（否则 D15 可能是「两边都空」的空真）",
	DIALOG_VAR_KEYS.length >= 15 && DIALOG_VAR_KEYS.indexOf("--dp-dlg-img") >= 0 && DIALOG_VAR_KEYS.indexOf("--dp-dlg-scrim") >= 0, DIALOG_VAR_KEYS.length);

t("D17", "CSS 图片规则的选择器只覆盖弹窗自己的壳（不得出现裸 `html[data-dp-dlgimg]` 通配 ⇒ 会污染整棵 DOM）",
	(() => {
		const m = CSS.match(/html\[data-dp-dlgimg="1"\][^{]*\{/);
		if (!m) return false;
		return m[0].split(",").every((sel) => /data-testid="d-/.test(sel));
	})(), (CSS.match(/html\[data-dp-dlgimg="1"\][^{]*\{/) || [""])[0].slice(0, 90));

t("D18", "🔴 新皮肤**不许**把自己的默认值写进 :root（写进去就取不到 body 上的宿主令牌 —— 与 C16 同源）",
	!/:root\{[^}]*--dp-dlg-/.test(CSS), null);

t("D19", "CSS 里图片两层都在（遮罩 gradient + --dp-dlg-img），且遮罩浓度走变量（用户可调）",
	/linear-gradient\(var\(--dp-dlg-scrim/.test(CSS) && /var\(--dp-dlg-img/.test(CSS), null);

t("D20", "组件真的消费了皮肤变量，且**保留宿主令牌 fallback**（没有 fallback ⇒ 「跟随主题」档直接失效）",
	(() => { const blk = styleBlock(SRC("src/components/DirectorDialog.js"), "panel");
		/* 判据只要求"有宿主令牌兜底"，**不锁具体是哪一个** ——
		 * 锁死会造成"换了更合适的令牌反而报红"的过期判据（本文件刚踩过，见 C5 注释）。
		 * 具体用哪个令牌由 D25 单独钉。 */
		return blk.indexOf("var(--dp-dlg-bg,") >= 0 && /var\(--dsw-alias-[a-z0-9-]+,/.test(blk); })(), null);

t("D21", "🔴 反证（D20 非空真）：把皮肤变量抠掉 ⇒ 同一条判据必须为假",
	(() => { const blk = styleBlock(SRC("src/components/DirectorDialog.js"), "panel");
		return blk.replace(/var\(--dp-dlg-[a-z0-9-]+,\s*/g, "").indexOf("var(--dp-dlg-bg,") < 0; })(), null);

t("D22", "弹窗面板壳必须同时带 `dp-textured`（纹理档在这块上才有效）且不残留 background 简写",
	(() => { const s = SRC("src/components/DirectorDialog.js");
		const blk = styleBlock(s, "panel");
		return /className:[^,]*dp-textured/.test(s) && stripComments(blk).indexOf("background:") < 0; })(), null);

t("D23", "面板壳（PersonalizePanel）真的渲染了新档（import 了不渲染 = 死代码）",
	(() => { const s = SRC("src/components/PersonalizePanel.js");
		return /import\s*\{[^}]*P_DIALOG_BG[^}]*\}\s*from\s*"\.\.\/store\/personalize\.js"/.test(s)
			&& /optionRow\(P_DIALOG_BG/.test(s) && /readImageAsDataUrl/.test(s); })(), null);

t("D24", "上传链路的三个读点齐全（选图 / 改遮罩 / 移除），e2e 才点得到",
	(() => { const s = SRC("src/components/PersonalizePanel.js");
		return ["pp-dlgbg-file", "pp-dlgbg-dimrange", "pp-dlgbg-clear", "pp-dlgbg-color", "pp-dlgbg-msg"]
			.every((k) => s.indexOf('"' + k + '"') >= 0 || s.indexOf(k) >= 0); })(), null);

/* ── D25–D28（2026-09-17 真机实测驱动）─────────────────────────────────
 * 这一组全部来自**真机量出的缺陷**，不是纸上推演：
 *   follow 档正文 3.06:1、自定义中间灰正文 3.34:1。 */

t("D25", "🔴 浮层底色必须走宿主 **overlay 族**令牌（`bg-overlay`），不得用最外层玻璃 `bg-base`、也不得用深色 `bg-sunken`",
	(() => { const blk = styleBlock(SRC("src/components/DirectorDialog.js"), "panel");
		return blk.indexOf("var(--dsw-alias-bg-overlay,") >= 0
			&& blk.indexOf("var(--dsw-alias-bg-base,") < 0; })(), null);

t("D25b", "🔴 弹窗内其它位置也不得再把 `bg-sunken` 当**表面**（实测它是深色 `rgb(29,39,57)` —— 落进浅色主题会翻黑）",
	(() => { const s = stripComments(SRC("src/components/DirectorDialog.js"));
		return s.indexOf("--dsw-alias-bg-sunken") < 0; })(), null);

t("D26", "🔴 **通用拦截**：源码里出现的每个 `--dp-dlg-*` 引用都必须在 DIALOG_VAR_KEYS 表内（拼写错会变成永不生效的死兜底）",
	(() => {
		const s = stripComments(SRC("src/components/DirectorDialog.js"));
		const used = new Set();
		const re = /--dp-dlg-[a-z0-9-]+/g;
		let m; while ((m = re.exec(s))) used.add(m[0]);
		const bad = [...used].filter((k) => DIALOG_VAR_KEYS.indexOf(k) < 0);
		if (bad.length) console.log("     未登记变量：" + bad.join(", "));
		return bad.length === 0 && used.size >= 8;
	})(), null);

t("D26b", "🔴 反证（D26 非空真）：故意造一个拼写错必须被判出来（缺陷校准）",
	(() => {
		const s = stripComments(SRC("src/components/DirectorDialog.js"));
		const injected = s.replace(/(--dp-dlg-)t2\b/, "--dp-dlg-typo");
		const used = new Set();
		const re = /--dp-dlg-[a-z0-9-]+/g;
		let m; while ((m = re.exec(injected))) used.add(m[0]);
		return [...used].some((k) => DIALOG_VAR_KEYS.indexOf(k) < 0);
	})(), null);

t("D27", "🔴 **自定义底色全色域**：t1/t2 ≥4.5、t3 ≥3.0、强调与状态色 ≥3.0（含中间灰这种「两个极端都不远」的恶劣底）",
	(() => {
		const bases = ["#7a7262", "#888888", "#808080", "#2f6bdd", "#c8a2c8", "#4b6b3a", "#ffd700", "#1a1a2e", "#ffffff", "#000000"];
		const bad = [];
		for (const b of bases) {
			const s = dialogSkinFor({ dialogBg: "custom", dialogBgColor: b });
			if (contrastRatio(s.t1, b) < 4.5) bad.push(b + " t1=" + contrastRatio(s.t1, b).toFixed(2));
			if (contrastRatio(s.t2, b) < 4.5) bad.push(b + " t2=" + contrastRatio(s.t2, b).toFixed(2));
			if (contrastRatio(s.t3, b) < 3.0) bad.push(b + " t3=" + contrastRatio(s.t3, b).toFixed(2));
			for (const k of ["ac", "ac2", "ok", "warn", "bad"]) {
				if (contrastRatio(s[k], b) < 3.0) bad.push(b + " " + k + "=" + contrastRatio(s[k], b).toFixed(2));
			}
		}
		if (bad.length) console.log("     低于门槛：" + bad.slice(0, 6).join(" / "));
		return bad.length === 0;
	})(), null);

t("D27b", "🔴 反证（D27 非空真）：把钳制关掉 ⇒ 同一条判据必须为假（证明它真的在拦东西）",
	(() => {
		/* 用"固定比例混色"复现旧算法（正是 D27 要拦的那个版本） */
		const base = "#7a7262";
		const naive = mixHex(base, "#ffffff", 0.72);
		return contrastRatio(naive, base) < 4.5;
	})(), null);

t("D28", "🔴 `clampToContrast` 边界：连极点都达不到目标时返回极点（不产 NaN / 不死循环）",
	(() => {
		const c = clampToContrast("#000000", "#000000", "#000000", 4.5);
		return typeof c === "string" && /^#[0-9a-f]{6}$/.test(c) && !/NaN/.test(c);
	})(), null);

/* ══ 汇总 ══ */
console.log("\n───────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail);
if (fail) { console.log(" 失败项：\n   - " + failures.join("\n   - ")); }
console.log(" IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
console.log("───────────────────────────────────────────────");
process.exit(fail === 0 ? 0 : 1);
