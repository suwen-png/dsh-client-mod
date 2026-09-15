#!/usr/bin/env node
/**
 * test-design-layers.mjs —— 设计图**分层模型**的离线闸门（无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它守什么（一句话）
 * ──────────────────────────────────────────────────────────────────
 * 用户原话：「当前页面的元素层层堆叠，我不知道该从哪些部分、按什么顺序去修改。」
 * 2026-09-14 的处置是给数据模型**加一层**（画面 screen / 层 layer），并写下
 * **六条不变量 N1–N6**（设计稿 V20 §B）。本文件是这六条的唯一验收判据 ——
 * 数据层改了、组件改了，只要不变量破了，这里必须红。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 本闸门的设计纪律（比断言本身更重要，改本文件前先读）
 * ──────────────────────────────────────────────────────────────────
 * ① **每条不变量都必须带「植入 → 红」的负对照**。
 *    本项目已栽过 8 次「闸门自己过期」和 13 处「断言写错」（见 AGENTS.md 台账一/二），
 *    它们的共性是：**一条恒真的断言，看起来和一条正确的断言一模一样**。
 *    ⇒ 本文件里 N1–N6 六节，每节都含 `X-y` 行（植入缺陷，断言**必须**红）
 *      与 `X-z` 行（还原，断言回到绿）。任何一节缺负对照 = 该节等于没测。
 * ② **先证明前提，再断言结果**（纪律 23）。
 *    例：S11「聚焦后可选中率 100%」必须与 S10「全景可选中率 < 100%」**成对出现** ——
 *    否则“100%”可能只是“这张图本来就没有重叠”（空真）。
 * ③ **尺子独立**。DSL 对齐用的显示宽度在本文件**独立重写**，不 import 产品的
 *    `dslWidth()` —— 否则产品算错时，尺子和它一起错，红不起来。
 * ④ 只用**纯函数**（数据层），不碰 DOM / localStorage / react ⇒ 秒级、可反复跑。
 *    唯一的例外是 N6.6–N6.9：它们读 `DesignStudio.js` 的**源码块**做契约断言
 *    （因为「淡影不吃事件」是样式属性，没有函数可以调用），已在断言名里标明。
 *
 * ══════════════════════════════════════════════════════════════════
 * 覆盖范围
 * ──────────────────────────────────────────────────────────────────
 *  N0 分层常量自洽（画面序 / 层序 / z→画面兼容契约 / 类型默认层）
 *  N1 画面全覆盖：显式 screen 与 z 推断逐条一致（老数据兼容的前提）
 *  N2 同画面同层不相交（且跨画面相交**不**被判错）
 *  N3 锁定：store 层拦截几何/次序改动，但**不**拦文案与逻辑
 *  N4 隐藏：不渲染、不参与碰撞，但**保留**在大纲与导出里
 *  N5 绘制序：画面重叠序 → 层序 → z（并证明「裸 z 排序」在换序后会错）
 *  N6 聚焦视图：跨画面遮挡归零（含组件侧源码契约）
 *  S  结构大纲：三层树、排序确定、覆盖率 100%、中心点可选中率 100%
 *  D  AI 可读 DSL：R1–R6 六条规则 + 错误路径 + 全有或全无 + 体积
 *
 * 用法：node scripts/test-design-layers.mjs
 * 退出码：0 全绿 / 1 有失败 / 2 INVALID（用法错误 —— 本脚本不接受任何参数）
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
	SCREENS, SCREEN_KEYS, SCREEN_ORDER, SCREEN_Z_MAX, screenFromZ, screenOf,
	LAYERS, LAYER_KEYS, LAYER_ORDER, layerOf, layerOrderOf,
	KIND_DEFAULT_LAYER, paintOrderKey, sortForPaint, intersectArea, layerCollisions,
	ELEMENT_KIND_KEYS, LOGIC_FIELDS,
	buildStandardFrame, normalizeDoc, hitTest
} from "../src/store/design-schema.js";
import {
	moveElement, nudgeElement, resizeElement, removeElement, reorderElement,
	updateElement, updateLogic, addElement, visibleElements,
	focusView, outlineOf, screenStats, designStats, layerOverlaps,
	setElementFlags, setElementPlacement, reorderInScreen, setScreenHidden,
	sameElements, toDesignDSL, parseDesignDSL, applyDesignDSL
} from "../src/store/design.js";

/* ══════════════════════════════════════════════════════════════════
 * 用法自诊断（纪律 17：用法错 → 打印可复制命令并 exit 2，与 FAIL 区分）
 * ══════════════════════════════════════════════════════════════════ */
const argv = process.argv.slice(2);
if (argv.length) {
	console.log("本闸门不接受参数（它测的是源码，没有可调项）。");
	console.log("收到：" + JSON.stringify(argv));
	console.log("正确用法：node scripts/test-design-layers.mjs");
	process.exit(2);
}

let pass = 0; let fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++;
	else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
function section(s) { console.log("\n" + s); }
const J = (v) => JSON.stringify(v);

/* ══════════════════════════════════════════════════════════════════
 * 测具：标准框架（20 元素 / 3 画面）
 * ══════════════════════════════════════════════════════════════════ */
const baseDoc = normalizeDoc({
	docId: "layers-test", title: "分层闸门用图", revision: 0, thread: [],
	elements: buildStandardFrame("threeTab")
});
const ELS = baseDoc.elements;
const byLabel = (l) => ELS.find((e) => e.label === l);
const IDS = ELS.map((e) => e.id);
const WIN = byLabel("Harness 主窗口");                 // 唯一默认锁定元素（整屏底板）
const SIDEBAR = byLabel("侧栏 · 会话树");
const R1 = byLabel("R1 顶部栏");
const R4 = byLabel("R4 项目导航（三 Tab）");
const R5 = byLabel("R5 总监对话区");
const R6 = byLabel("R6 记忆面板");
const inScreen = (sc) => ELS.filter((e) => screenOf(e) === sc).map((e) => e.id);

console.log("═══════════════════════════════════════════════════════════");
console.log(" 设计图分层模型 · 离线闸门（N1–N6 + 大纲 + AI 可读 DSL）");
console.log("═══════════════════════════════════════════════════════════");
console.log(` 被测对象：标准框架 ${ELS.length} 元素 / ${SCREEN_KEYS.length} 画面 / ${LAYER_KEYS.length} 层`);

/* ══════════════════════════════════════════════════════════════════
 * 【N0】分层常量自洽
 * ──────────────────────────────────────────────────────────────────
 * 这一节守的是「**改配置的人**」：新增一幅画面/一个层，只要漏改排序或漏登记
 * 类型默认层，后面的断言都会以「某处莫名少了一类元素」的形态出现，很难定位。
 * 在这里一次说清，比在 N1/N5 里兜圈子便宜得多。
 * ══════════════════════════════════════════════════════════════════ */
section("【N0】分层常量自洽");

const isPerm = (a, b) => a.length === b.length && a.slice().sort().join(",") === b.slice().sort().join(",");
t("N0.1", "SCREEN_ORDER 是 SCREEN_KEYS 的一个**排列**（无遗漏、无重复）", isPerm(SCREEN_ORDER, SCREEN_KEYS), { order: SCREEN_ORDER, keys: SCREEN_KEYS });
t("N0.2", "LAYER_ORDER 是 LAYER_KEYS 的一个**排列**", isPerm(LAYER_ORDER, LAYER_KEYS), { order: LAYER_ORDER, keys: LAYER_KEYS });
t("N0.3", "LAYER_ORDER 恰为 base → content → deco（修改次序）", J(LAYER_ORDER) === J(["base", "content", "deco"]), LAYER_ORDER);

const overlaps = SCREEN_ORDER.map((s) => SCREENS[s].overlap);
t("N0.4", "画面重叠序两两不同（相等会让绘制序退化为数组序）", new Set(overlaps).size === overlaps.length, overlaps);
t("N0.5", "SCREEN_ORDER 按重叠序升序 = 自下而上的修改顺序",
	overlaps.every((v, i) => i === 0 || overlaps[i - 1] < v), overlaps);
t("N0.6", "最底层画面是 director（底图先改）", SCREEN_ORDER[0] === "director", SCREEN_ORDER[0]);

const badLayer = ELEMENT_KIND_KEYS.filter((k) => !LAYERS[KIND_DEFAULT_LAYER[k]]);
t("N0.7", `KIND_DEFAULT_LAYER 覆盖全部 ${ELEMENT_KIND_KEYS.length} 类且层名合法`, badLayer.length === 0, badLayer);
const noDefault = ELEMENT_KIND_KEYS.filter((k) => KIND_DEFAULT_LAYER[k] === undefined);
t("N0.8", "无任何图元缺类型默认层（缺了会让新元素落进 base 层）", noDefault.length === 0, noDefault);

/* z → 画面：**兼容契约**。基线（V16 落死）写的数据没有 screen 字段，
 * 只能由 z 反推 ⇒ 这几个阈值一旦漂移，用户图里的元素会**换到另一幅画面**。 */
const zCases = [[0, "director"], [4, "director"], [5, "chat"], [9, "chat"], [10, "mindmap"], [99, "mindmap"]];
const zBad = zCases.filter(([z, want]) => screenFromZ(z) !== want);
t("N0.9", "screenFromZ 逐段阈值与兼容契约一致（0/4→director · 5/9→chat · 10/99→mindmap）", zBad.length === 0, zBad);
t("N0.10", "screenFromZ 对非数字输入回落 director（永不返回空）",
	screenFromZ(undefined) === "director" && screenFromZ("abc") === "director" && screenFromZ(null) === "director",
	[screenFromZ(undefined), screenFromZ("abc"), screenFromZ(null)]);
t("N0.11", "SCREEN_Z_MAX 的键与 SCREENS 里「有上界的两幅」一致（改一处忘另一处 = 静默漂移）",
	isPerm(Object.keys(SCREEN_Z_MAX), SCREEN_ORDER.filter((s) => s !== "mindmap")), SCREEN_Z_MAX);

/* ══════════════════════════════════════════════════════════════════
 * 【N1】画面全覆盖 —— 显式 screen 必须与 z 推断**逐条一致**
 * ──────────────────────────────────────────────────────────────────
 * 这是整层新增里唯一**有兼容风险**的地方：一旦某个 seed 的 screen 写错，
 * 新图正常、老图（靠 z 反推）却被读成另一幅画面 —— 而这两种数据在界面上
 * 长得一模一样，缺陷只会在「某台机器上」出现。故用断言把它钉成硬约束。
 * ══════════════════════════════════════════════════════════════════ */
section("【N1】画面全覆盖（显式声明 vs z 推断）");

const mismatch = ELS.filter((e) => e.screen !== screenFromZ(e.z))
	.map((e) => ({ id: e.id, label: e.label, screen: e.screen, byZ: screenFromZ(e.z), z: e.z }));
t("N1.1", "🔴 每个元素的显式 screen 与「由 z 反推」的结果**逐条相同**（0 处不一致）", mismatch.length === 0, mismatch);
t("N1.2", "screenOf 对全部元素都返回已知画面", ELS.every((e) => Boolean(SCREENS[screenOf(e)])), ELS.map(screenOf).filter((s) => !SCREENS[s]));

const sum = SCREEN_ORDER.reduce((n, s) => n + screenStats(baseDoc, s).total, 0);
t("N1.3", "各画面元素数之和 = 元素总数（不漏、不重）", sum === ELS.length, { sum, total: ELS.length });
t("N1.4", "画面划分为 13 / 2 / 5（director / chat / mindmap）",
	J(SCREEN_ORDER.map(inScreen).map((a) => a.length)) === J([13, 2, 5]),
	SCREEN_ORDER.map((s) => s + "=" + inScreen(s).length).join(" "));
t("N1.5", "3 幅画面**都非空**（空画面会让大纲出现一行永远点不到的东西）",
	SCREEN_ORDER.every((s) => screenStats(baseDoc, s).total > 0),
	SCREEN_ORDER.map((s) => s + "=" + screenStats(baseDoc, s).total).join(" "));
t("N1.6", "screenOf 只在显式值非法时才回落（合法值原样返回）",
	screenOf({ screen: "chat", z: 0 }) === "chat" && screenOf({ screen: "__x__", z: 0 }) === "director",
	[screenOf({ screen: "chat", z: 0 }), screenOf({ screen: "__x__", z: 0 })]);

/* N1 负对照：把 SCREEN_ORDER 弄少一项（模拟「新加画面忘了排序」），同一把尺子必须红 */
const coverageOk = (order) => isPerm(order, SCREEN_KEYS) && ELS.every((e) => order.includes(e.screen));
t("N1-y", "🔴 负对照：SCREEN_ORDER 缺一项 ⇒ 覆盖判据**必须红**（尺子不是恒真）",
	coverageOk(SCREEN_ORDER.slice(0, -1)) === false, SCREEN_ORDER.slice(0, -1));
t("N1-z", "还原：完整 SCREEN_ORDER ⇒ 覆盖判据回到绿", coverageOk(SCREEN_ORDER) === true);

/* ══════════════════════════════════════════════════════════════════
 * 【N2】同画面同层不相交；跨画面相交**合法**
 * ══════════════════════════════════════════════════════════════════ */
section("【N2】同画面同层不相交（跨画面相交不算错）");

/* 先证前提（纪律 23）：这张图**确实存在**跨画面相交 ——
 * 否则「碰撞 0」可能只是「这张图本来就没有重叠」，断言等于没测。 */
let crossPairs = 0;
for (let i = 0; i < ELS.length; i++) {
	for (let j = i + 1; j < ELS.length; j++) {
		if (screenOf(ELS[i]) !== screenOf(ELS[j]) && intersectArea(ELS[i], ELS[j]) > 0) crossPairs++;
	}
}
t("N2.0", "前提：标准框架**确实存在**跨画面相交（导图态画布盖住总监页若干元素）", crossPairs > 0, { crossPairs });

const col0 = layerCollisions(ELS);
t("N2.1", "N2 碰撞 = 0（默认框架就是「不重叠」的样板）", col0.length === 0, col0);
t("N2.2", "designStats.collisions 与 layerCollisions / layerOverlaps 三处同值（避免「角标说 1、清单说 0」）",
	designStats(baseDoc).collisions === col0.length && layerOverlaps(baseDoc).length === col0.length,
	{ stats: designStats(baseDoc).collisions, direct: col0.length });
t("N2.3", "碰撞明细带画面与层（否则用户只知道「有两个东西叠了」，不知道去哪找）",
	col0.every((c) => Boolean(SCREENS[c.screen]) && Boolean(LAYERS[c.layer]) && c.a && c.b), col0.slice(0, 3));

/* 负对照：把 R5 拖到 R4 上（同为 director/content）。
 * 🔴 判据**不写「恰好 1 对」** —— R5 的新落点还会压到 R6（竖向上 R5 尾部 527 > R6 顶部 510），
 *    而那也是一对**正确**的碰撞。写死 1 会让闸门在几何微调后假红（这正是台账里
 *    「闸门自己会过期」那一类）。改判「必含 (R4,R5) + 所有新碰撞都涉及被移动的 R5」——
 *    后半句才是这个负对照真正的语义：**只动了 R5，就不该冒出与 R5 无关的碰撞**。 */
const collideDoc = moveElement(baseDoc, R5.id, R4.x + 21, R4.y + 23);
const colBad = layerCollisions(collideDoc.elements);
const pairKey = (c) => [c.a, c.b].sort().join();
t("N2-y", "🔴 负对照：R5 压到 R4 上 ⇒ 碰撞清单**必含 (R4,R5)**，且所有新碰撞都涉及被移动的 R5",
	colBad.length > 0
	&& colBad.some((c) => pairKey(c) === [R4.id, R5.id].sort().join())
	&& colBad.every((c) => c.a === R5.id || c.b === R5.id), colBad);
t("N2-z", "还原：R5 归位 ⇒ 碰撞回到 0", layerCollisions(baseDoc.elements).length === 0);
t("N2.4", "隐藏的元素不参与碰撞（它不在画面上）",
	layerCollisions(setElementFlags(collideDoc, R5.id, { hidden: true }).elements).length === 0,
	layerCollisions(setElementFlags(collideDoc, R5.id, { hidden: true }).elements));

/* ══════════════════════════════════════════════════════════════════
 * 【N3】锁定：拦几何/次序，不拦文案与逻辑
 * ──────────────────────────────────────────────────────────────────
 * 🔴 关键在于**同一操作必须对「解锁元素」真的生效**（正对照）。
 *    否则「锁定元素没动」与「移动功能整个坏了」读数完全一样 —— 空真。
 * ══════════════════════════════════════════════════════════════════ */
section("【N3】锁定（store 层拦截 · 带正对照）");

const lockedIds = ELS.filter((e) => e.locked).map((e) => e.id);
t("N3.1", "默认框架里恰好 1 个锁定元素，且是整屏底板 window", lockedIds.length === 1 && lockedIds[0] === WIN.id, lockedIds);
t("N3.2", "锁定标记走 `=== true`（`{locked:1}` / `\"true\"` 都不算锁定）",
	setElementFlags(baseDoc, R1.id, { locked: 1 }).elements.find((e) => e.id === R1.id).locked === false
	&& setElementFlags(baseDoc, R1.id, { locked: "true" }).elements.find((e) => e.id === R1.id).locked === false,
	[setElementFlags(baseDoc, R1.id, { locked: 1 }).elements.find((e) => e.id === R1.id).locked]);

const ops = [
	["moveElement", (d, id) => moveElement(d, id, 123, 45), (d, id) => { const e = d.elements.find((x) => x.id === id); return { x: e.x, y: e.y }; }],
	["nudgeElement", (d, id) => nudgeElement(d, id, 40, 40), (d, id) => { const e = d.elements.find((x) => x.id === id); return { x: e.x, y: e.y }; }],
	["resizeElement", (d, id) => resizeElement(d, id, 400, 300), (d, id) => { const e = d.elements.find((x) => x.id === id); return { w: e.w, h: e.h }; }],
	["reorderElement", (d, id) => reorderElement(d, id, "bottom"), (d, id) => d.elements.find((x) => x.id === id).z]
];
ops.forEach(([name, run, read], i) => {
	const n = i + 1;
	const lockedDoc = setElementFlags(baseDoc, R1.id, { locked: true });
	const onLocked = read(run(lockedDoc, R1.id), R1.id);
	const before = read(baseDoc, R1.id);
	t(`N3.3.${n}a`, `${name} 对**锁定**元素 → 读数不变`, J(onLocked) === J(before), { before, onLocked });
	const after = read(run(baseDoc, R1.id), R1.id);
	t(`N3.3.${n}b`, `正对照：${name} 对**解锁**的同一元素 → 读数真的变了`, J(after) !== J(before), { before, after });
});

t("N3.4", "removeElement 对锁定元素 → 元素还在（元素数不变）",
	removeElement(setElementFlags(baseDoc, R1.id, { locked: true }), R1.id).elements.length === ELS.length);
t("N3.4b", "正对照：removeElement 对解锁元素 → 元素真的少了 1 个",
	removeElement(baseDoc, R1.id).elements.length === ELS.length - 1);
const zBefore = J(ELS.map((e) => e.z));
t("N3.5", "reorderInScreen 对锁定元素 → z 全不变",
	J(reorderInScreen(setElementFlags(baseDoc, WIN.id, { locked: true }), WIN.id, "down").elements.map((e) => e.z)) === zBefore);
t("N3.5b", "正对照：reorderInScreen 对解锁元素 → 至少一个 z 变了",
	J(reorderInScreen(baseDoc, R4.id, "down").elements.map((e) => e.z)) !== zBefore);

t("N3.6", "锁定**不**拦改文案（updateElement 仍生效）",
	updateElement(setElementFlags(baseDoc, R1.id, { locked: true }), R1.id, { label: "改名了" })
		.elements.find((e) => e.id === R1.id).label === "改名了");
t("N3.7", "锁定**不**拦改七元组逻辑（updateLogic 仍生效）",
	updateLogic(setElementFlags(baseDoc, R1.id, { locked: true }), R1.id, { action: "E2E 动作" })
		.elements.find((e) => e.id === R1.id).logic.action === "E2E 动作");
t("N3.8", "锁定**不**拦解锁本身（否则锁死成不可逆）",
	setElementFlags(baseDoc, WIN.id, { locked: false }).elements.find((e) => e.id === WIN.id).locked === false);
t("N3.9", "锁定元素仍出现在大纲里（否则用户找不到它、也解不开）",
	outlineOf(baseDoc).some((g) => g.layers.some((l) => l.items.some((it) => it.id === WIN.id && it.locked === true))));
t("N3.10", "`window` 落 base 层、`sidebar` 落 content 层（整屏底板不与侧栏互判碰撞）",
	layerOf(WIN) === "base" && layerOf(SIDEBAR) === "content", [layerOf(WIN), layerOf(SIDEBAR)]);

/* ══════════════════════════════════════════════════════════════════
 * 【N4】隐藏：不渲染、不参与碰撞，但**保留**在大纲与导出
 * ──────────────────────────────────────────────────────────────────
 * 🔴 「隐藏」最贵的缺陷是**丢数据** —— 一旦导入导出里没了它，
 *    用户「先收起来以后再放出来」的打算就落空了，且不可逆（除非回头翻版本）。
 * ══════════════════════════════════════════════════════════════════ */
section("【N4】隐藏（不渲染 / 保留结构）");

const hid = setElementFlags(baseDoc, R6.id, { hidden: true });
t("N4.1", "隐藏后不出现在 visibleElements（画布不渲染它）",
	!visibleElements(hid).some((e) => e.id === R6.id) && visibleElements(hid).length === ELS.length - 1,
	{ visible: visibleElements(hid).length, total: ELS.length });
t("N4.2", "隐藏后**仍在** outlineOf 里（能在大纲里找到并恢复）",
	outlineOf(hid).some((g) => g.layers.some((l) => l.items.some((it) => it.id === R6.id && it.hidden === true))));
const dslHidden = toDesignDSL(hid);
t("N4.3", "隐藏后**仍在** DSL 导出里，且带 hidden 标记",
	dslHidden.split("\n").some((ln) => ln.includes("id=" + R6.id) && /\|\s*id=\S+\s+hidden\b/.test(ln)),
	dslHidden.split("\n").filter((ln) => ln.includes("id=" + R6.id)));
t("N4.4", "隐藏后 screenStats：hidden 计 1、total 不变（角标不会因为隐藏而少算元素）",
	screenStats(hid, "director").hidden === 1
	&& screenStats(hid, "director").total === screenStats(baseDoc, "director").total,
	[screenStats(hid, "director"), screenStats(baseDoc, "director")]);

const scHidden = setScreenHidden(baseDoc, "director", true);
t("N4-y", "🔴 负对照：整幅隐藏 director ⇒ 该画面 visible 归零",
	screenStats(scHidden, "director").visible === 0, screenStats(scHidden, "director"));
t("N4-y2", "且**其它画面毫发无损**（跨画面污染是这类批量操作最容易出的错）",
	J(screenStats(scHidden, "chat")) === J(screenStats(baseDoc, "chat"))
	&& J(screenStats(scHidden, "mindmap")) === J(screenStats(baseDoc, "mindmap")),
	[screenStats(scHidden, "chat"), screenStats(scHidden, "mindmap")]);
t("N4-z", "还原：整幅显示 ⇒ visible 回到 13",
	screenStats(setScreenHidden(scHidden, "director", false), "director").visible === 13);

t("N4.5", "hidden 变化**不**进版本比对（否则「我按规矩锁了底图」会污染版本列表）",
	sameElements(ELS, setElementFlags(baseDoc, R1.id, { hidden: true }).elements) === true);
t("N4.5b", "locked 变化同样不进版本比对",
	sameElements(ELS, setElementFlags(baseDoc, R1.id, { locked: true }).elements) === true);
t("N4.6", "正对照：**几何**变化进版本比对（否则会变成「改了也不脏」，比误判脏更糟）",
	sameElements(ELS, moveElement(baseDoc, R1.id, R1.x + 5, R1.y).elements) === false);
t("N4.7", "正对照：**归属（screen）**变化进版本比对（结构改动理应进版本）",
	sameElements(ELS, setElementPlacement(baseDoc, R1.id, { screen: "chat" }).elements) === false);
t("N4.8", "正对照：**层**变化也进版本比对",
	sameElements(ELS, setElementPlacement(baseDoc, R1.id, { layer: "deco" }).elements) === false);

/* ══════════════════════════════════════════════════════════════════
 * 【N5】绘制序：画面重叠序 → 层序 → z
 * ──────────────────────────────────────────────────────────────────
 * 🔴 这一节的核心不是「顺序对」，而是**证明「裸 z 排序」会错**。
 *    原来画布就是 `sort(a.z - b.z)`，它之所以一直没出事，是因为三幅画面的 z
 *    区间恰好不重叠（0–3 / 6–8 / 10–11）—— 那是**巧合，不是设计**。
 *    一旦用户在本画面内换次序（z 规范化为 1..n），裸 z 排序就会把导图态画布
 *    埋到总监页方块下面。故 N5-y 专门构造这个局面，断言「裸 z 排序确实错了」。
 * ══════════════════════════════════════════════════════════════════ */
section("【N5】绘制序（画面 → 层 → z）");

const ord = sortForPaint(ELS);
t("N5.1", "绘制序末端是导图态（overlap 最大者最后画 = 压在最上）",
	screenOf(ord[ord.length - 1]) === "mindmap", { last: ord[ord.length - 1].label, screen: screenOf(ord[ord.length - 1]) });
t("N5.2", "三幅画面在绘制序里各自**连续成段**（不交错；交错 = 排序键漏了画面维度）",
	(() => { const seg = ord.map(screenOf); const seen = []; for (const s of seg) if (seen[seen.length - 1] !== s) seen.push(s); return seen.length === 3; })(),
	ord.map(screenOf).join(" "));
t("N5.3", "paintOrderKey = [画面重叠序, 层序, z]（三元组，顺序固定）",
	J(paintOrderKey(R4)) === J([SCREENS.director.overlap, LAYERS.content.order, R4.z]), paintOrderKey(R4));
t("N5.4", "同画面内 base 层先于 content 先于 deco（修改顺序即绘制顺序）",
	(() => {
		const ls = ord.filter((e) => screenOf(e) === "director").map(layerOrderOf);
		return ls.every((v, i) => i === 0 || ls[i - 1] <= v);
	})(),
	ord.filter((e) => screenOf(e) === "director").map((e) => layerOf(e) + ":" + e.z).join(" "));

const reordered = reorderInScreen(baseDoc, R4.id, "up");
const dirZ = reordered.elements.filter((e) => screenOf(e) === "director").map((e) => e.z).sort((a, b) => a - b);
const otherBefore = ELS.filter((e) => screenOf(e) !== "director").map((e) => e.z + ":" + e.screen).join();
const otherAfter = reordered.elements.filter((e) => screenOf(e) !== "director").map((e) => e.z + ":" + e.screen).join();
t("N5.5", "换序后 director 的 z **恰好**规范化为 1..13（连续，消除同 z 碰撞）",
	J(dirZ) === J(Array.from({ length: 13 }, (_, i) => i + 1)), dirZ);
t("N5.6", "🔴 换序**完全没碰**其它画面（chat / mindmap 的 z 逐条不变）", otherBefore === otherAfter,
	{ before: otherBefore, after: otherAfter });
const mmFirst = ord.find((e) => screenOf(e) === "mindmap");
t("N5.7", "换序在端点时原样不动（导图态首元素 up ⇒ z 数组逐条不变）",
	J(reorderInScreen(baseDoc, mmFirst.id, "up").elements.map((e) => e.z)) === zBefore,
	reorderInScreen(baseDoc, mmFirst.id, "up").elements.map((e) => e.z));

/* 🔴 N5 负对照：这一步把「裸 z 排序」钉成已知的错误实现 */
const reorderedPaint = sortForPaint(reordered.elements);
const naivePaint = reordered.elements.slice().sort((a, b) => (a.z || 0) - (b.z || 0));
t("N5-y", "🔴 负对照：换序后按**裸 z** 排序 ⇒ 末端**不是**导图态（说明裸 z 确实会错）",
	screenOf(naivePaint[naivePaint.length - 1]) !== "mindmap",
	{ screen: screenOf(naivePaint[naivePaint.length - 1]), label: naivePaint[naivePaint.length - 1].label });
t("N5-y2", "同一局面下按 paintOrderKey 排序 ⇒ 末端**仍是**导图态（两种实现读数不同 = 尺子有分辨力）",
	screenOf(reorderedPaint[reorderedPaint.length - 1]) === "mindmap",
	screenOf(reorderedPaint[reorderedPaint.length - 1]));
t("N5-z", "还原：原始 doc 的绘制序末端同为导图态", screenOf(sortForPaint(ELS)[ELS.length - 1]) === "mindmap");

/* ══════════════════════════════════════════════════════════════════
 * 【N6】聚焦视图：跨画面遮挡归零
 * ══════════════════════════════════════════════════════════════════ */
section("【N6】聚焦视图（跨画面遮挡 = 0）");

const allView = focusView(baseDoc, "all");
t("N6.1", "未聚焦（all）⇒ screen=null / ghost 为空 ⇒ **不声明** N6（全景本就允许遮挡）",
	allView.screen === null && allView.ghost.length === 0 && allView.interactive.length === ELS.length,
	{ screen: allView.screen, ghost: allView.ghost.length, inter: allView.interactive.length });
t("N6.2", "非法画面名 ⇒ screen=null（回落成「未聚焦」，而不是静默当作「零遮挡」）",
	focusView(baseDoc, "__nope__").screen === null);

let n6ok = true; const n6detail = [];
for (const sc of SCREEN_ORDER) {
	const v = focusView(baseDoc, sc);
	const interOk = v.interactive.every((e) => screenOf(e) === sc);
	const ghostOk = v.ghost.every((e) => screenOf(e) !== sc);
	const coverOk = v.interactive.length + v.ghost.length === ELS.length;
	const noLeak = v.interactive.every((e) => !v.ghost.some((g) => g.id === e.id));
	if (!(interOk && ghostOk && coverOk && noLeak)) n6ok = false;
	n6detail.push(`${sc}: 可交互 ${v.interactive.length} / 淡影 ${v.ghost.length}`);
}
t("N6.3", "🔴 逐画面聚焦：可交互集合**恰好**是该画面元素、淡影恰好是其余（并集=全覆盖、交集=空）", n6ok, n6detail);
t("N6.4", "聚焦 director ⇒ 13 / 淡影 7；聚焦 mindmap ⇒ 5 / 淡影 15",
	(() => {
		const a = focusView(baseDoc, "director"); const b = focusView(baseDoc, "mindmap");
		return a.interactive.length === 13 && a.ghost.length === 7 && b.interactive.length === 5 && b.ghost.length === 15;
	})(),
	["director", "mindmap"].map((s) => { const v = focusView(baseDoc, s); return s + "=" + v.interactive.length + "/" + v.ghost.length; }).join(" "));
t("N6.5", "被隐藏的元素即使属于焦点画面也不进可交互集合（两套过滤不能互相抵消）",
	focusView(setElementFlags(baseDoc, R1.id, { hidden: true }), "director").interactive.every((e) => e.id !== R1.id));

/* 组件侧源码契约：淡影必须「不挡事件 + 不被算作元素」。
 * 🔴 必须**按块取文本**（纪律 28），不全文件搜 —— 全文件搜会把注释里出现的字样也算进来。
 *    这也是本文件唯一读源码的地方；它守的是一条没有函数可调用的样式属性。 */
const HERE = dirname(fileURLToPath(import.meta.url));
const studioSrc = readFileSync(join(HERE, "..", "src", "components", "DesignStudio.js"), "utf8");
const iStyle = studioSrc.indexOf("elGhost: {");
const styleBlock = iStyle < 0 ? "" : studioSrc.slice(iStyle, studioSrc.indexOf("}", iStyle) + 1);
t("N6.6", "源码契约 · 淡影样式块含 `pointerEvents: \"none\"`（否则淡影会吃掉下一幅画面的鼠标事件）",
	iStyle >= 0 && /pointerEvents:\s*"none"/.test(styleBlock), styleBlock.slice(0, 160));
const iGhost = studioSrc.indexOf("...view.ghost");
const iInter = studioSrc.indexOf("...view.interactive");
const ghostBlock = (iGhost < 0 || iInter <= iGhost) ? "" : studioSrc.slice(iGhost, iInter);
t("N6.7", "源码契约 · 淡影渲染块带 `ds-ghost` 锚点、且**不带** `ds-el` 锚点（否则元素计数与命中集合会被污染）",
	ghostBlock.includes('"ds-ghost"') && !ghostBlock.includes('"ds-el"'), ghostBlock.slice(0, 220));
t("N6.8", "源码契约 · 淡影渲染在可交互元素**之前**（DOM 序即压盖序 ⇒ 聚焦的那幅画面在最上）",
	iGhost >= 0 && iInter > iGhost);
t("N6.9", "源码契约 · 组件从数据层取聚焦视图（`focusView(doc, focusScreen)`，不是自己 filter —— 单一真相源）",
	studioSrc.includes("focusView(doc, focusScreen)")
	&& /import\s*\{[\s\S]{0,600}?\bfocusView\b[\s\S]{0,600}?\}\s*from\s*"\.\.\/store\/design\.js"/.test(studioSrc));

/* ══════════════════════════════════════════════════════════════════
 * 【S】结构大纲（用户诉求「该从哪改、按什么顺序改」的落点）
 * ══════════════════════════════════════════════════════════════════ */
section("【S】结构大纲（三层树 · 覆盖率 · 可选中率）");

const ol = outlineOf(baseDoc);
t("S1", "大纲恰有 3 幅画面，顺序 = SCREEN_ORDER（自下而上 = 修改顺序）",
	J(ol.map((g) => g.screen)) === J(SCREEN_ORDER), ol.map((g) => g.screen));
t("S2", "每幅画面内的层按 LAYER_ORDER 有序（base → content → deco）",
	ol.every((g) => {
		const ls = g.layers.map((l) => l.layer);
		return ls.every((v, i) => i === 0 || LAYER_ORDER.indexOf(ls[i - 1]) < LAYER_ORDER.indexOf(v));
	}),
	ol.map((g) => g.screen + ":" + g.layers.map((l) => l.layer).join(">")));
t("S3", "空层不出现在树里（大纲不该有一行永远为空的层）", ol.every((g) => g.layers.every((l) => l.items.length > 0)));
t("S4", "每幅画面带 hint（「先改什么」的说明 —— 用户诉求的直接落点）",
	ol.every((g) => typeof g.hint === "string" && g.hint.length > 0), ol.map((g) => g.hint));

const olIds = ol.flatMap((g) => g.layers.flatMap((l) => l.items.map((it) => it.id)));
t("S5", "🔴 大纲覆盖率 = 100%（不漏一个元素、不重一个 id）",
	olIds.length === ELS.length && new Set(olIds).size === ELS.length && IDS.every((id) => olIds.includes(id)),
	{ outlined: olIds.length, total: ELS.length, uniq: new Set(olIds).size });
/* 🔴 判据必须**独立算出期望次序**，而不是读大纲项里的 z ——
 *    outlineOf 交出的项目**不含 z**（它是个摘要，不是元素本体；见 S8/S9）。
 *    初版就是栽在这里：拿 `it.z` 比较，而它是 `undefined`，
 *    于是「z 相同、比 y」的分支被静默走到，红得毫无道理（尺子量错了东西）。
 *    正确做法：用**源元素**按 (z → y → id) 算一份期望 id 序列，与大纲交给界面的**顺序**对账。 */
const expectOrder = (sc, lk) => ELS
	.filter((e) => screenOf(e) === sc && layerOf(e) === lk)
	.slice().sort((a, b) => (a.z - b.z) || (a.y - b.y) || String(a.id).localeCompare(String(b.id)))
	.map((e) => e.id);
t("S6", "每层内元素按 z → y → id 排序（与由源元素独立算出的期望次序逐条一致）",
	ol.every((g) => g.layers.every((l) => J(l.items.map((it) => it.id)) === J(expectOrder(g.screen, l.layer)))),
	ol.flatMap((g) => g.layers.filter((l) => J(l.items.map((it) => it.id)) !== J(expectOrder(g.screen, l.layer)))
		.map((l) => ({ screen: g.screen, layer: l.layer, got: l.items.map((it) => it.id), want: expectOrder(g.screen, l.layer) }))));
t("S7", "大纲两次调用逐字节一致（确定性 —— 否则用户会以为「我没动它它自己变了」）",
	J(outlineOf(baseDoc)) === J(outlineOf(baseDoc)));
t("S8", "大纲交出的是快照而非本体（改大纲不会误改真数据）", (() => {
	const before = J(baseDoc.elements);
	ol[0].layers[0].items[0].label = "被改坏了";
	ol[0].layers[0].items[0].x = 99999;
	return J(baseDoc.elements) === before;
})());
t("S9", "大纲每项带足定位与状态字段（id/kind/label/几何/hidden/locked）",
	ol.flatMap((g) => g.layers.flatMap((l) => l.items))
		.every((it) => typeof it.id === "string" && typeof it.kind === "string"
			&& Number.isFinite(it.x) && Number.isFinite(it.y) && Number.isFinite(it.w) && Number.isFinite(it.h)
			&& typeof it.hidden === "boolean" && typeof it.locked === "boolean"));

/* 🔴 中心点可选中率 —— 用户那句「不知道该从哪些部分改」的**可量化形式**。
 *
 * ⚠️ 只统计**非 base 层**元素，两个理由：
 *    ① base 层是「整屏底板」（window / 导图态 canvas），按设计就该被内容盖住 ——
 *       「点它的中心把它选中」不是一个有意义的诉求（也没人会这么干）。
 *    ② 底板的可选中性由 S5「大纲覆盖 100%」保证：它在左栏永远有一行可点。
 *    不排除底板的话，这条断言会因为一个**按设计成立**的重叠而永久红 —— 那是假红。
 *
 * 判据对：全景 < 100%（这就是用户遇到的「层层堆叠」）→ 逐画面聚焦 == 100%（修复本身）。
 * 只报后者就是「没有前提的断言」（纪律 23）。 */
function hitRate(list) {
	const els = list.filter((e) => layerOf(e) !== "base");
	const miss = els.filter((e) => {
		const h = hitTest(list, e.x + e.w / 2, e.y + e.h / 2);
		return !h || h.id !== e.id;
	});
	return { ok: els.length - miss.length, total: els.length, miss: miss.map((e) => e.label) };
}
const fullRate = hitRate(visibleElements(baseDoc));
const focusRate = SCREEN_ORDER.map((sc) => hitRate(focusView(baseDoc, sc).interactive));
t("S10", "前提：**全景**下确实有元素中心点选不中（这就是用户遇到的「层层堆叠」）",
	fullRate.ok < fullRate.total, fullRate);
t("S11", "🔴 逐画面聚焦后：每个画面的非底板元素中心点**可选中率 = 100%**",
	focusRate.every((r) => r.ok === r.total), focusRate);
t("S11b", "S10/S11 的差值就是修复本身（全景漏选 > 0，聚焦后漏选 = 0）",
	focusRate.reduce((n, r) => n + (r.total - r.ok), 0) === 0 && (fullRate.total - fullRate.ok) > 0,
	{ 全景漏选: fullRate.total - fullRate.ok, 聚焦后漏选: focusRate.reduce((n, r) => n + (r.total - r.ok), 0) });

/* ══════════════════════════════════════════════════════════════════
 * 【D】AI 可读结构语言（DSL v1 · 六条规则）
 * ══════════════════════════════════════════════════════════════════ */
section("【D】AI 可读 DSL（R1–R6 + 错误路径）");

const DSL = toDesignDSL(baseDoc);
const DSLF = toDesignDSL(baseDoc, { logic: true });
const lines = DSL.split("\n");
const nonEmpty = lines.filter((l) => l.trim());
const body = nonEmpty.filter((l) => !l.startsWith("图 "));
const isElemLine = (l) => l.trim() && !l.startsWith("画面 ") && !l.startsWith("图 ");

/* 独立重写的显示宽度尺子（**故意**不 import 产品的 dslWidth） */
function gateWidth(s) {
	let w = 0;
	for (const ch of String(s)) {
		const c = ch.codePointAt(0);
		w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3)
			|| (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60))) ? 2 : 1;
	}
	return w;
}
const geoColStart = (l) => {
	const m = /^(.*?)-?\d+,-?\d+/.exec(l);
	return m ? gateWidth(m[1]) : -1;
};

t("D1", "R2 首行是唯一入口「图 <id> 「标题」」",
	/^图 \S+ 「.*」$/.test(lines[0]) && nonEmpty.filter((l) => l.startsWith("图 ")).length === 1, lines[0]);
t("D2", "R1 结构模式正文无任何嵌套括号（{} [] —— 无方言、可逐行解析）",
	!/[{}[\]]/.test(DSL), lines.filter((l) => /[{}[\]]/.test(l)).slice(0, 2));
t("D3", "R1 每行一条语句：非空行 = 1 入口 + 3 画面 + 20 元素（无续行、无折行）",
	nonEmpty.length === 1 + SCREEN_KEYS.length + ELS.length,
	{ 非空行: nonEmpty.length, 期望: 1 + SCREEN_KEYS.length + ELS.length });
t("D4", "R4 缩进 = 归属：画面行零缩进、元素行**恰好**两空格",
	nonEmpty.filter((l) => l.startsWith("画面 ")).length === SCREEN_KEYS.length
	&& body.every((l) => !l.startsWith("画面 ") || /^\S/.test(l))
	&& body.filter(isElemLine).every((l) => /^ {2}\S/.test(l)),
	body.filter((l) => isElemLine(l) && !/^ {2}\S/.test(l)).slice(0, 2));
t("D5", "R3 元素行固定 5 列：层 · 类型 · 「标签」 · x,y · wxh  | 标记",
	body.filter(isElemLine).every((l) => /^ {2}\S+\s+\S+\s+「.*?」\s+-?\d+,-?\d+\s+\d+x\d+\s+\|\s*\S/.test(l)),
	body.filter((l) => isElemLine(l) && !/^ {2}\S+\s+\S+\s+「.*?」\s+-?\d+,-?\d+\s+\d+x\d+\s+\|\s*\S/.test(l)).slice(0, 2));
/* R3 列对齐 —— 判据分两半，因为「**超宽标签不截断**」是产品的**有意**选择
 * （`dslPad`：截断会静默改内容）。代价是那一行的几何列会往右错开一点。
 * ⇒ ① 标准框架（基准数据）导出后几何列起始显示宽度**全部一致**（它是样板，该整齐）；
 *    ② 人造的超宽标签**只允许更宽**且**逐字未截断** —— 这一条是 ① 的反例：
 *       证明"整齐"不是靠截断换来的（否则 ① 会以"内容被悄悄改短"为代价通过）。
 *
 * 🔴 两处尺子陷阱（初版都踩了，记下来免得再踩）：
 *    ① 不要用 `/「(.*?)」/` 取标签 —— 标签里**本身带引号**（`右侧「对话」弹窗`），
 *       非贪婪匹配会在第一个 `」` 处截断，量到的是半个标签。改用「按 id 找行 + includes 全标签」。
 *    ② 不要写死列宽常量（19 / 24 / 43）：有人调列宽时闸门会假红。
 *       一律由数据推导（对超宽行只要求"比所有对齐行更宽"）。 */
const lineOfId = (text, id) => text.split("\n").find((l) => l.includes("id=" + id)) || "";
const widths = body.filter(isElemLine).map(geoColStart);
const modeW = [...new Set(widths)].sort((a, b) =>
	widths.filter((w) => w === b).length - widths.filter((w) => w === a).length)[0];
const intact = (text, e) => lineOfId(text, e.id).includes("「" + e.label + "」");
t("D6", `R3 列对齐：标准框架 ${ELS.length} 行的几何列起始显示宽度**全部一致**（= ${modeW}）`,
	new Set(widths).size === 1 && widths[0] > 0,
	{ 取值: [...new Set(widths)], 各值行数: [...new Set(widths)].map((w) => w + "×" + widths.filter((x) => x === w).length) });
t("D6a", "R3 列对齐 · 标签逐字未截断（干净数据里不该有超宽标签）",
	ELS.every((e) => intact(DSL, e)), ELS.filter((e) => !intact(DSL, e)).map((e) => e.label));
/* 反例：塞一个超长标签进去 —— 列会错开，但**内容一个字都不能少** */
const LONG_LABEL = "很长很长的标签·这是一句用来把标签列撑爆的说明文字·改列宽请三思";
const wideDoc = updateElement(baseDoc, R1.id, { label: LONG_LABEL });
const wideText = toDesignDSL(wideDoc);
const wideW = geoColStart(lineOfId(wideText, R1.id));
t("D6b", "🔴 反例：超宽标签 ⇒ 该行**只允许更宽**（`宽 > 基准`），且标签**逐字未截断**",
	wideW > modeW && lineOfId(wideText, R1.id).includes("「" + LONG_LABEL + "」"),
	{ 基准: modeW, 该行: wideW, 标签完好: lineOfId(wideText, R1.id).includes("「" + LONG_LABEL + "」") });
t("D6c", "且超宽标签**可原样回读**（宁愿错开一列，也不静默改内容 —— 往返闭环）",
	applyDesignDSL(wideDoc, wideText).doc.elements.find((e) => e.id === R1.id).label === LONG_LABEL);
t("D6d", "还原：标准框架重新导出后列宽回到基准（反例没有污染产品状态）",
	geoColStart(lineOfId(toDesignDSL(baseDoc), R1.id)) === modeW);
t("D7", "R5 可选标记挂**行尾**（`|` 之后：id / hidden / locked / note）",
	body.filter(isElemLine).every((l) => /\s\|\s*id=\S+/.test(l)),
	body.find((l) => isElemLine(l) && !/\s\|\s*id=\S+/.test(l)));

const back = applyDesignDSL(baseDoc, DSL).doc;
const backF = applyDesignDSL(baseDoc, DSLF).doc;
t("D8", "R6 双模式幂等：导出 → 导入 → 再导出，**逐字节一致**",
	toDesignDSL(back) === DSL && toDesignDSL(backF, { logic: true }) === DSLF,
	{ 结构: toDesignDSL(back) === DSL, 全量: toDesignDSL(backF, { logic: true }) === DSLF });
t("D9", "🔴 负对照：把同画面两行**对调** ⇒ 再导出**必须不同**（证明幂等不是恒真）",
	(() => {
		const ls = DSL.split("\n");
		const i0 = ls.findIndex((l) => l.includes("id=" + R4.id));
		const i1 = ls.findIndex((l) => l.includes("id=" + R1.id));
		if (i0 < 0 || i1 < 0 || i0 === i1) return false;   // 构造失败 ⇒ 明确红，不静默跳过
		const sw = ls.slice(); const tmp = sw[i0]; sw[i0] = sw[i1]; sw[i1] = tmp;
		return toDesignDSL(applyDesignDSL(baseDoc, sw.join("\n")).doc) !== DSL;
	})(), "对调两行后重新导出仍与原文相同 ⇒ 幂等断言无分辨力");

/* 逐字段保真（🔴 z 除外：DSL 里 z 由**行序**决定，导出端按「层序→z」重排，
 * 故 z 的**数值**会变、**次序**不变 —— 这是格式约定，不是缺陷。次序见 D11。） */
const backMap = new Map(back.elements.map((e) => [e.id, e]));
const FIELDS = ["kind", "label", "x", "y", "w", "h", "screen", "layer", "hidden", "locked", "note"];
const diffs = [];
for (const e of ELS) {
	const b = backMap.get(e.id);
	if (!b) { diffs.push({ id: e.id, why: "丢了" }); continue; }
	for (const f of FIELDS) {
		if (J(e[f] === undefined ? null : e[f]) !== J(b[f] === undefined ? null : b[f])) diffs.push({ id: e.id, f, from: e[f], to: b[f] });
	}
}
t("D10", `逐字段保真（${FIELDS.length} 字段 × ${ELS.length} 元素，按 **id** 对账而非按下标）`, diffs.length === 0, diffs.slice(0, 4));
t("D11", "次序保真：每个画面内「层序 → z」的相对次序不变（z 数值可变，次序不可变）",
	SCREEN_ORDER.every((sc) => {
		const key = (arr) => arr.filter((e) => screenOf(e) === sc)
			.slice().sort((a, b) => (layerOrderOf(a) - layerOrderOf(b)) || (a.z - b.z)).map((e) => e.id).join(" ");
		return key(ELS) === key(back.elements);
	}));
t("D12", "解析端 z 按**行序**编号（行序即次序，不单占一列 ⇒ 少一类笔误）",
	back.elements.every((e, i) => e.z === i + 1), back.elements.slice(0, 4).map((e) => e.z));

const lgDiffs = [];
for (const e of ELS) {
	const b = backMap.get(e.id);
	for (const f of LOGIC_FIELDS) {
		if (J(e.logic[f.key] === undefined ? "" : e.logic[f.key]) !== J(b.logic[f.key] === undefined ? "" : b.logic[f.key])) {
			lgDiffs.push({ id: e.id, f: f.key });
		}
	}
}
t("D13", `全量模式逐元素七元组保真（=${LOGIC_FIELDS.length} × ${ELS.length} 个字段）`, lgDiffs.length === 0, lgDiffs.slice(0, 4));

/* 空字段必须写成 ∅ 并原样还原 —— 否则「我清空过」会被类型默认值填回来 */
const clearedText = (() => {
	const ls = DSLF.split("\n");
	const i = ls.findIndex((l) => l === "逻辑 " + R1.id + ":");
	if (i < 0) return "";
	const j = ls.findIndex((l, k) => k > i && /^ {2}行为 /.test(l));
	if (j < 0) return "";
	const sw = ls.slice(); sw[j] = "  行为 " + "∅";
	return sw.join("\n");
})();
const cleared = applyDesignDSL(baseDoc, clearedText).doc;
t("D14", "🔴 清空过的逻辑字段回读后**仍为空**（不被类型默认值填回来）",
	clearedText.length > 0 && cleared.elements.find((e) => e.id === R1.id).logic.action === "",
	{ 构造: clearedText.length > 0, action: cleared.elements.find((e) => e.id === R1.id).logic.action });

const errCases = [
	["D15", "缺入口行（R2）", "画面 director 「总监页」 重叠序 1\n  content panel 「X」 10,10 100x40 | id=el-1-pan", /入口行|R2/],
	["D16", "未知画面名（拒收而非回落）", "图 d 「t」\n画面 __nope__ 「x」 重叠序 1", /未知画面/],
	["D17", "未知层", "图 d 「t」\n画面 director 「总监页」 重叠序 1\n  __layer__ panel 「X」 10,10 100x40 | id=a", /未知层/],
	["D18", "未知图元", "图 d 「t」\n画面 director 「总监页」 重叠序 1\n  content __kind__ 「X」 10,10 100x40 | id=a", /未知图元/],
	["D19", "元素行在任何画面行之前（无归属）", "图 d 「t」\n  content panel 「X」 10,10 100x40 | id=a", /画面/],
	["D20", "逻辑块指向不存在的元素", "图 d 「t」\n画面 director 「总监页」 重叠序 1\n  content panel 「X」 10,10 100x40 | id=a\n逻辑 el-9-zzz:\n  行为 x", /不存在/],
	["D20b", "元素行多出一列（列数不固定 = R3 被破）", "图 d 「t」\n画面 director 「总监页」 重叠序 1\n  content panel 「X」 10,10 100x40 999 | id=a", /5 列|元素行/]
];
for (const [id, name, text, re] of errCases) {
	const r = parseDesignDSL(text);
	t(id, `错误路径：${name} ⇒ 拒收`, r.ok === false && r.elements === null
		&& r.errors.length > 0 && r.errors.every((e) => typeof e.line === "number" && e.line >= 1)
		&& r.errors.some((e) => re.test(e.why)), r.errors);
}

const brokenText = lines.slice(0, 4).concat(["  content __bad__ 「X」 1,1 2x2 | id=zz"]).join("\n");
const applied = applyDesignDSL(baseDoc, brokenText);
t("D21", "🔴 全有或全无：任一行坏 ⇒ 返回的 doc 是**原 doc**（引用相等，一个字都没改）",
	applied.ok === false && applied.doc === baseDoc && applied.errors.length > 0, applied.errors);

const withNew = addElement(back, "button", { x: 5, y: 5 });
const idsAll = withNew.elements.map((e) => e.id);
t("D22", "回灌后 id 水位已同步：新建元素不撞既有 id（撞号会让「指哪改哪」指到别的元素）",
	new Set(idsAll).size === idsAll.length, idsAll.filter((v, i) => idsAll.indexOf(v) !== i));

const jsonBytes = Buffer.byteLength(JSON.stringify(back.elements), "utf8");
const dslBytes = Buffer.byteLength(DSL, "utf8");
const dslfBytes = Buffer.byteLength(DSLF, "utf8");
t("D23", "结构 DSL 体积 < 同内容 JSON 的 30%（AI 每次读都要付 token，省下来的是真金白银）",
	dslBytes < jsonBytes * 0.3, { json: jsonBytes, dsl: dslBytes, 省: Math.round((1 - dslBytes / jsonBytes) * 100) + "%" });
t("D24", "DSL 以 LF 结尾且不含 CR（写盘行尾纪律）", DSL.endsWith("\n") && !DSL.includes("\r"));

/* ══════════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n═══════════════════════════════════════════════════════════");
if (fail === 0) {
	console.log(` IS_PASS: TRUE  全绿 ${pass} / ${pass}`);
	console.log(` 附注 · 画面划分：${SCREEN_ORDER.map((s) => SCREENS[s].label + " " + inScreen(s).length).join(" / ")}`);
	console.log(` 附注 · 中心点可选（非底板）：全景 ${fullRate.ok}/${fullRate.total} → 逐画面聚焦 `
		+ focusRate.map((r) => r.ok + "/" + r.total).join(" + "));
	console.log(` 附注 · 体积：JSON ${jsonBytes} B → 结构 DSL ${dslBytes} B（省 ${Math.round((1 - dslBytes / jsonBytes) * 100)}%）`
		+ ` ｜ 全量 DSL ${dslfBytes} B（省 ${Math.round((1 - dslfBytes / jsonBytes) * 100)}%）`);
} else {
	console.log(` IS_PASS: FALSE  通过 ${pass} / 失败 ${fail}`);
	console.log(" 失败项：");
	for (const f of failures) console.log("   · " + f);
}
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
