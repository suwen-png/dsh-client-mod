#!/usr/bin/env node
/**
 * test-running-window.mjs —— 执行状态窗口的**几何纯函数 + store 三态**离线测试
 * （无需 Harness / 浏览器）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 *  第 16 批用户原话：「执行状态的窗口需要可以移动最小化,靠边缩进」
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | RW-1 | 默认态 | `mode = "collapsed"`、坐标 `null`（= 用默认位，不写死） |
 *  | RW-2 | 视口内拖动 | `clampedX/Y` **均为 false**（"没动"与"被夹住"必须可分辨） |
 *  | RW-3 | 拖出左/上边界 | 夹到 `L/T`，`clamped=true` |
 *  | RW-4 | 拖出右/下边界 | 夹到 `R-w / B-h` |
 *  | RW-5 | **安全区** inset 生效 | `x >= insetLeft`；🔴 **负对照**：inset=0 时同一输入落点必须不同 |
 *  | RW-6 | 窗口比可用区还宽 | 不产生"左边 > 右边"的反向区间（否则窗口跳到屏幕外） |
 *  | RW-7 | 距左边 10px（< 24） | 吸附 → `dock="left"` 且 `x = L` |
 *  | RW-8 | 距左边 30px（> 24） | 🔴 **不吸附** → `null`（负对照：吸附不能滥触发） |
 *  | RW-9 | 同时贴两边 | 取**最近**的那条；并列时左右优先于上下 |
 *  | RW-10 | 贴右边 | `x = R - w`，且结果仍过一遍夹紧 |
 *  | RW-11 | 三态状态机 | `drag→expanded` · `min→collapsed` · `snap→docked` · `toggle` 在 collapsed/docked⇄expanded 之间 |
 *  | RW-12 | 未知 action | **原样返回**（不猜、不默认成某个态） |
 *  | RW-13 | 未知 mode 入参 | 回落 `collapsed`（兜底，不把未知态透传给 UI） |
 *  | RW-14 | store：坐标相等短路 | 同值写入返回 `false`（高频拖动不做无谓 notify） |
 *  | RW-15 | store：三态写入值域 | `mode=docked` 但 dock 非法 ⇒ dock 清空；非 docked ⇒ dock 恒空 |
 *  | RW-16 | store：老数据读入兜底 | localStorage 里是非法 mode/dock ⇒ 读回后**回落默认**（不静默透传） |
 *  | RW-17 | store：applyRunningWinAction | 离开 docked 时 `dock` 被清（不留矛盾数据） |
 *
 * 用法：node scripts/test-running-window.mjs ｜ 退出码 0 全绿 / 1 有失败
 */
import {
	RUNNING_WIN_MODE, RUNNING_WIN_SNAP_PX, RUNNING_WIN_DOCKS,
	clampWinPos, snapWinEdge, nextWinMode, createDirectorLayoutStore
} from "../src/store/layout.js";

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      " + JSON.stringify(detail) : ""}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("═══════════════════════════════════════════════════════════");
console.log("  执行状态窗口 · 几何纯函数 + store 三态（离线）");
console.log("═══════════════════════════════════════════════════════════");

/* 基准视口：1440×900，右侧 inset = 138（本项目实测的窗口控件安全区，见锚点 §6 表） */
const VIEW = { vw: 1440, vh: 900, insetLeft: 0, insetRight: 138, insetTop: 0, insetBottom: 0 };
const BOX = { w: 300, h: 120 };

/* ── RW-1 默认态 ─────────────────────────────────────────────────────────── */
const s0 = createDirectorLayoutStore();
const w0 = s0.getRunningWin();
t("RW-1a", "默认 mode = collapsed（不再默认展开压住 R2.5 动作行 —— A1 的根治）", w0.mode === RUNNING_WIN_MODE.COLLAPSED, w0);
t("RW-1b", "默认坐标 = null（用默认位，不写死坐标）", w0.x === null && w0.y === null, w0);
t("RW-1c", "默认 dock 为空串", w0.dock === "", w0);

/* ── RW-2 ~ RW-4 夹紧 ────────────────────────────────────────────────────── */
const inBox = clampWinPos({ x: 600, y: 300 }, BOX, VIEW);
t("RW-2a", "视口内：x/y 原样返回", inBox.x === 600 && inBox.y === 300, inBox);
t("RW-2b", "视口内：clampedX/clampedY 均为 false（可辨别「没动」）", inBox.clampedX === false && inBox.clampedY === false, inBox);

const outLT = clampWinPos({ x: -50, y: -80 }, BOX, VIEW);
t("RW-3a", "拖出左上：夹到 L/T", outLT.x === 0 && outLT.y === 0, outLT);
t("RW-3b", "拖出左上：clamped 标记为 true", outLT.clampedX === true && outLT.clampedY === true, outLT);

const outRB = clampWinPos({ x: 9999, y: 9999 }, BOX, VIEW);
t("RW-4a", "拖出右下：夹到 R-w", outRB.x === 1440 - 138 - 300, outRB);
t("RW-4b", "拖出右下：夹到 B-h", outRB.y === 900 - 120, outRB);
t("RW-4c", "拖出右下：clamped 标记为 true", outRB.clampedX === true && outRB.clampedY === true, outRB);

/* ── RW-5 安全区（含负对照 —— 证明 inset 真的被用，不是写死 0）──────────── */
const withInset = clampWinPos({ x: 9999, y: 10 }, BOX, { vw: 1440, vh: 900, insetRight: 138 });
const noInset = clampWinPos({ x: 9999, y: 10 }, BOX, { vw: 1440, vh: 900, insetRight: 0 });
t("RW-5a", "有 inset：右边界收敛到 vw - insetRight", withInset.x === 1440 - 138 - 300, withInset);
t("RW-5b", "🔴 负对照：inset=0 时同一输入落点**必须不同**（若相同 ⇒ inset 根本没被用）",
	noInset.x !== withInset.x && noInset.x === 1440 - 300, { withInset, noInset });
const leftInset = clampWinPos({ x: -100, y: 0 }, BOX, { vw: 1440, vh: 900, insetLeft: 56 });
t("RW-5c", "左侧 inset 生效：x 不得小于 insetLeft", leftInset.x === 56, leftInset);

/* ── RW-6 反向区间防护 ───────────────────────────────────────────────────── */
const tooWide = clampWinPos({ x: 500, y: 0 }, { w: 5000, h: 100 }, VIEW);
t("RW-6a", "窗口比可用区窄不了：x = L（不出现「左边 > 右边」）", tooWide.x === 0, tooWide);
const crazyInset = clampWinPos({ x: 500, y: 0 }, BOX, { vw: 100, vh: 100, insetLeft: 80, insetRight: 80 });
t("RW-6b", "inset 之和超过视口：收敛成空区间（L==R）而非反向", crazyInset.x === 80, crazyInset);

/* ── RW-7 ~ RW-10 贴边吸附 ───────────────────────────────────────────────── */
const nearLeft = snapWinEdge({ x: 10, y: 300 }, BOX, VIEW);
t("RW-7a", "距左边 10px（< 24）：吸附 dock=left", nearLeft && nearLeft.dock === "left", nearLeft);
t("RW-7b", "吸附后 x 对齐左边界", nearLeft && nearLeft.x === 0, nearLeft);

const farFromEdge = snapWinEdge({ x: 30, y: 300 }, BOX, VIEW);
t("RW-8a", "🔴 负对照：距左边 30px（> 24）**不吸附** ⇒ null", farFromEdge === null, farFromEdge);
t("RW-8b", "阈值常量确为 24（判据与实现同源，不写死字面量）", RUNNING_WIN_SNAP_PX === 24, RUNNING_WIN_SNAP_PX);

const nearRight = snapWinEdge({ x: 1440 - 138 - 300 - 8, y: 300 }, BOX, VIEW);
t("RW-9a", "贴右边：dock=right", nearRight && nearRight.dock === "right", nearRight);
t("RW-9b", "贴右边：x = R - w（仍过夹紧）", nearRight && nearRight.x === 1440 - 138 - 300, nearRight);

const nearBoth = snapWinEdge({ x: 2, y: 899 }, BOX, VIEW);
t("RW-9c", "同时贴近左与下：取**最近**的一条（两边等距时左右优先）",
	nearBoth && (nearBoth.dock === "left" || nearBoth.dock === "bottom"), nearBoth);

const nearTop = snapWinEdge({ x: 600, y: 5 }, BOX, VIEW);
t("RW-10a", "贴上边：dock=top 且 y=T", nearTop && nearTop.dock === "top" && nearTop.y === 0, nearTop);
const NaNPos = snapWinEdge({ x: NaN, y: 0 }, BOX, VIEW);
t("RW-10b", "非法坐标 ⇒ null（不吸附，也不抛）", NaNPos === null, NaNPos);
t("RW-10c", "四边白名单完整", eq([...RUNNING_WIN_DOCKS], ["left", "right", "top", "bottom"]), RUNNING_WIN_DOCKS);

/* ── RW-11 ~ RW-13 状态机 ────────────────────────────────────────────────── */
const M = RUNNING_WIN_MODE;
t("RW-11a", "drag ⇒ expanded（拖动中展开，便于看清拖到哪）", nextWinMode(M.COLLAPSED, "drag") === M.EXPANDED, nextWinMode(M.COLLAPSED, "drag"));
t("RW-11b", "min ⇒ collapsed", nextWinMode(M.EXPANDED, "min") === M.COLLAPSED, nextWinMode(M.EXPANDED, "min"));
t("RW-11c", "snap ⇒ docked", nextWinMode(M.EXPANDED, "snap") === M.DOCKED, nextWinMode(M.EXPANDED, "snap"));
t("RW-11d", "toggle 于 collapsed ⇒ expanded", nextWinMode(M.COLLAPSED, "toggle") === M.EXPANDED, nextWinMode(M.COLLAPSED, "toggle"));
t("RW-11e", "toggle 于 docked ⇒ expanded（贴边缩进态点一下就回来）", nextWinMode(M.DOCKED, "toggle") === M.EXPANDED, nextWinMode(M.DOCKED, "toggle"));
t("RW-11f", "toggle 于 expanded ⇒ collapsed", nextWinMode(M.EXPANDED, "toggle") === M.COLLAPSED, nextWinMode(M.EXPANDED, "toggle"));
t("RW-12a", "🔴 未知 action ⇒ 原样返回（不猜）", nextWinMode(M.EXPANDED, "unknown-xyz") === M.EXPANDED, nextWinMode(M.EXPANDED, "unknown-xyz"));
t("RW-12b", "空 action ⇒ 原样返回", nextWinMode(M.DOCKED, "") === M.DOCKED, nextWinMode(M.DOCKED, ""));
t("RW-13", "未知 mode 入参 ⇒ 回落 collapsed（不把未知态透传给 UI）", nextWinMode("bogus", "toggle") === M.EXPANDED, nextWinMode("bogus", "toggle"));

/* ── RW-14 ~ RW-17 store 三态写入 ────────────────────────────────────────── */
const s1 = createDirectorLayoutStore();
t("RW-14a", "坐标首次写入 ⇒ 返回 true（确实变了）", s1.setRunningWinPos({ x: 100, y: 50 }) === true, s1.getRunningWin());
t("RW-14b", "同值重复写入 ⇒ 返回 false（相等短路，高频拖动不 notify）", s1.setRunningWinPos({ x: 100, y: 50 }) === false, s1.getRunningWin());
t("RW-14c", "非法坐标 ⇒ 返回 false 且不改状态", s1.setRunningWinPos({ x: NaN, y: 0 }) === false && s1.getRunningWin().x === 100, s1.getRunningWin());
t("RW-14d", "传 null ⇒ 回默认位", s1.setRunningWinPos(null) === true && s1.getRunningWin().x === null, s1.getRunningWin());

const s2 = createDirectorLayoutStore();
s2.setRunningWinMode(M.DOCKED, "left");
const win2 = s2.getRunningWin();
t("RW-15a", "mode=docked + 合法 dock ⇒ 落定", win2.mode === M.DOCKED && win2.dock === "left", win2);
s2.setRunningWinMode(M.DOCKED, "diagonal");
t("RW-15b", "mode=docked 但 dock 非法 ⇒ dock 清空（不接受第五种边）", s2.getRunningWin().dock === "", s2.getRunningWin());
s2.setRunningWinMode(M.EXPANDED, "left");
t("RW-15c", "非 docked 态 ⇒ dock 恒为空", s2.getRunningWin().dock === "" && s2.getRunningWin().mode === M.EXPANDED, s2.getRunningWin());
s2.setRunningWinMode("bogus-mode", "left");
t("RW-15d", "非法 mode ⇒ 回落 collapsed", s2.getRunningWin().mode === M.COLLAPSED, s2.getRunningWin());

/* RW-16：**老数据读入兜底** —— 注入 localStorage 桩，模拟用户盘上残留的非法值 */
const realLS = globalThis.localStorage;
globalThis.localStorage = {
	getItem: () => JSON.stringify({ runningWin: { x: 12, y: 34, mode: "wat", dock: "diagonal" } }),
	setItem: () => {}
};
const s3 = createDirectorLayoutStore();
const w3 = s3.getRunningWin();
t("RW-16a", "🔴 老数据 mode 非法 ⇒ 读回后回落 collapsed（不静默透传）", w3.mode === M.COLLAPSED, w3);
t("RW-16b", "🔴 老数据 dock 非法 ⇒ 读回后清空", w3.dock === "", w3);
t("RW-16c", "合法坐标仍被保留（兜底只收敛非法值域，不误伤数据）", w3.x === 12 && w3.y === 34, w3);
/* 负对照：合法老数据必须**原样**读回（证明上面三条不是"一律重置"） */
globalThis.localStorage = {
	getItem: () => JSON.stringify({ runningWin: { x: 12, y: 34, mode: M.DOCKED, dock: "right" } }),
	setItem: () => {}
};
const s4 = createDirectorLayoutStore();
const w4 = s4.getRunningWin();
t("RW-16d", "🔴 负对照：合法老数据原样读回（不是一律重置）", w4.mode === M.DOCKED && w4.dock === "right" && w4.x === 12, w4);
if (realLS === undefined) delete globalThis.localStorage; else globalThis.localStorage = realLS;

const s5 = createDirectorLayoutStore();
s5.setRunningWinMode(M.DOCKED, "bottom");
s5.applyRunningWinAction("toggle");
t("RW-17a", "离开 docked ⇒ dock 被清（不留矛盾数据）", s5.getRunningWin().mode === M.EXPANDED && s5.getRunningWin().dock === "", s5.getRunningWin());
s5.applyRunningWinAction("min");
t("RW-17b", "applyRunningWinAction(min) ⇒ collapsed", s5.getRunningWin().mode === M.COLLAPSED, s5.getRunningWin());
s5.applyRunningWinAction("drag");
t("RW-17c", "applyRunningWinAction(drag) ⇒ expanded", s5.getRunningWin().mode === M.EXPANDED, s5.getRunningWin());
t("RW-17d", "resetRunningWin ⇒ 回到默认（坐标 null + collapsed）",
	(s5.resetRunningWin(), s5.getRunningWin().mode === M.COLLAPSED && s5.getRunningWin().x === null), s5.getRunningWin());

console.log("");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
