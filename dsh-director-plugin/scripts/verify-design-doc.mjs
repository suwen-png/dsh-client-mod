#!/usr/bin/env node
// verify-design-doc.mjs — V14.1 设计稿离线校验（零依赖 · 不连 CDP）
// 校验对象：docs/50-信息中心/V14.1-弹窗式总监架构设计稿.html
// 判据来源：dsh-director-plugin/docs/11-设计稿审核与实现方案.md §1.1(10 项) + §二(I1–I12)
// 用法：node scripts/verify-design-doc.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 设计稿位于仓库根 docs/（非插件内 docs/）—— 从脚本位置向上解析，避免 CWD 依赖
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../../docs/50-信息中心");
// 位置参数 = 版本前缀；默认 V14.1。用于反向证伪：node scripts/verify-design-doc.mjs V14 必须大面积失败
const STEM = process.argv[2] || "V14.1";
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

let pass = 0;
const fails = [];
function C(label, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + label + (detail ? " · " + detail : "")); }
	else { fails.push(label + (detail ? " · " + detail : "")); console.log("  ❌ " + label + (detail ? " · " + detail : "")); }
}
function has(src, needle) { return src.indexOf(needle) >= 0; }

console.log("[verify-design-doc] STAMP " + STAMP);

if (!existsSync(DIR)) { console.log("❌ 目录不存在：" + DIR); process.exit(1); }
const file = readdirSync(DIR).find((n) => n.startsWith(STEM + "-"));
if (!file) { console.log("❌ 未找到以 " + STEM + " 开头的前端设计稿"); process.exit(1); }
const p = DIR + "/" + file;
const s = readFileSync(p, "utf8");
const bytes = Buffer.byteLength(s);
console.log("[verify-design-doc] 对象 " + p + " · " + bytes + " B · " + s.split("\n").length + " 行\n");

// ══════ A. 文件卫生 ══════
console.log("【A 文件卫生】");
C("A1 通篇 LF（无 CRLF）", (s.match(/\r\n/g) || []).length === 0);
C("A2 无 BOM", s.charCodeAt(0) !== 0xFEFF);
C("A3 字节数落在合理区间", bytes > 40000 && bytes < 400000, bytes + " B");

// ══════ B. 标签平衡 ══════
console.log("\n【B 标签平衡】");
const CN = {};
for (const m of s.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[ >\/]/g)) {
	const n = m[1].toLowerCase();
	CN[n] = CN[n] || { o: 0, c: 0 };
	if (m[0][1] === "/") CN[n].c++; else CN[n].o++;
}
const VOID = new Set(["meta", "link", "br", "img", "input", "hr", "source"]);
const mis = Object.keys(CN).filter((k) => !VOID.has(k) && CN[k].o !== CN[k].c).map((k) => k + " " + CN[k].o + "/" + CN[k].c);
C("B1 全部非空元素标签开闭平衡", mis.length === 0, mis.length ? mis.join(" | ") : Object.keys(CN).length + " 种标签");
C("B2 <body> 恰一对", (CN.body || {}).o === 1 && (CN.body || {}).c === 1);
C("B3 <style> 恰一对", (CN.style || {}).o === 1 && (CN.style || {}).c === 1);

// ══════ C. §1.1 审美修订 10 项 ══════
console.log("\n【C §1.1 审美修订 10 项】");
const sizes = [];
for (const m of s.matchAll(/font-size:\s*([\d.]+)px/g)) sizes.push(+m[1]);
for (const m of s.matchAll(/font:[^;"'`]*/g)) for (const x of m[0].matchAll(/([\d.]+)px/g)) sizes.push(+x[1]);
const under = [...new Set(sizes.filter((v) => v < 10.5))].sort((a, b) => a - b);
C("C1 最小字号 ≥ 10.5px（修订 #4）", under.length === 0, under.length ? "违规字号 " + JSON.stringify(under) : "最小 " + Math.min(...sizes) + "px");
C("C2 遮罩类存在（修订 #1）", has(s, ".scrim"));
C("C3 弹窗双层投影 + 1px 亮边（修订 #1）", has(s, "0 0 0 1px rgba(255,255,255,.06),0 18px 48px rgba(0,0,0,.62)"));
C("C4 单一主色：--director 标注为「主色」（修订 #2）", has(s, "主色 · 总监域") && has(s, "功能性用色"));
C("C5 11 卡统一中性细线、旧三色类已移除（修订 #2）", has(s, ".req{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--border2)") && !has(s, ".req.d{") && !has(s, ".req.a{") && !has(s, ".req.t{"));
C("C6 --faint 提亮至 #8b9199（修订 #3）", has(s, "--faint:#8b9199"));
C("C7 侧栏标签提亮至 #7c828a（修订 #3）", has(s, "color:#7c828a"));
C("C8 .g3 改自适应 auto-fill/minmax(248px)（修订 #5）", has(s, "repeat(auto-fill,minmax(248px,1fr))"));
C("C9 .winbody 改 min-height（修订 #5）", has(s, "min-height:430px") && !has(s, ".winbody{display:flex;height:430px}"));
C("C10 四态齐备 hover/active/focus-visible/disabled（修订 #6）", has(s, ":hover") && has(s, ":active") && has(s, ":focus-visible") && has(s, ":disabled"),
	"hover " + (s.match(/:hover/g) || []).length + " / active " + (s.match(/:active/g) || []).length + " / fv " + (s.match(/:focus-visible/g) || []).length + " / dis " + (s.match(/:disabled/g) || []).length);
C("C11 role + aria-label + tabindex（修订 #7）", has(s, 'role="combobox"') && (s.match(/aria-label=/g) || []).length >= 30 && has(s, "tabindex="));
C("C12 弹窗 min-width:640px + 表格横向滚动（修订 #8）", has(s, "min-width:640px") && has(s, ".tscroll{overflow-x:auto"));
C("C13 统一过渡 140ms（修订 #9）", has(s, "--t:140ms") && has(s, "var(--t) ease"));
C("C14 prefers-reduced-motion 降级（修订 #9 补充）", has(s, "prefers-reduced-motion"));

// ══════ D. §二 交互缺口 I1–I12 ══════
console.log("\n【D §二 交互缺口 I1–I12】");
const I = [
	["I1", "定为非模态分屏覆盖层", has(s, "非模态分屏覆盖层") && has(s, "不锁滚动")],
	["I2", "布局分屏（方案 C）", has(s, "布局分屏") && has(s, "padding-left:300px")],
	["I3", "底部单输入框 + 目标徽章", has(s, "目标：总监") && has(s, "mfoot")],
	["I4", "路由确认卡 + 三去向", has(s, "路由确认卡") && has(s, "转派给该对话的总监") && has(s, "直接调用对应对话") && has(s, "新建对话")],
	["I5", "mhead 层级选择器（combobox + listbox）", has(s, 'role="combobox"') && has(s, 'role="listbox"') && has(s, "aria-expanded")],
	["I6", "三按钮语义定死 + Alt+1/2/3", has(s, "Alt+1") && has(s, "Alt+2") && has(s, "Alt+3") && has(s, "整窗最小化") && has(s, "折叠左栏") && has(s, "折叠右栏")],
	["I7", "焦点判定只认面板 pointerdown + data-input-scope", has(s, "data-input-scope") && has(s, "只认面板容器")],
	["I8", "拖拽 clamp(180, 55%) + 双击中缝复位", has(s, "clamp(180, 55%") && has(s, "双击中缝复位")],
	["I9", "R3 两段：可用 + 调用情况", has(s, "可用（点击＝手选直调）") && has(s, "调用中 ／ 最近")],
	["I10", "输入框固定 mfoot + 目标徽章绑定去向", has(s, "输入框固定") && has(s, "目标徽章")],
	["I11", "空/加载/错误三态", has(s, "emptystate") && has(s, "skel") && has(s, "errstate")],
	["I12", "V12 八视图映射表", has(s, "V12 八视图 ↔ 本弹窗落位")],
];
for (const [id, label, ok] of I) C("D " + id + " " + label, ok);

// ══════ E. 修订摘要与真机证据（可追溯性） ══════
console.log("\n【E 可追溯性】");
C("E1 含「本版修订摘要」章节", has(s, "本版修订摘要（V14.0 → V14.1）"));
C("E2 修订摘要覆盖 §1.1 十项", (s.match(/<tr><td>\d+<\/td><td>/g) || []).length >= 10);
C("E3 修订摘要覆盖 §二 十二项（I1–I12）", ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10", "I11", "I12"].every((x) => has(s, "<b>" + x + "</b>")));
C("E4 载入真机实测值（分屏位移）", has(s, "x 280 → 580") && has(s, "w 1154 → 854"));
C("E5 载入真机实测值（折叠态可达性）", has(s, "railCtl [true,true,true,true]"));
C("E6 载入真机实测值（拖拽上限）", has(s, "793 = 55%×1442"));
C("E7 载入测试结论（100/100 等）", has(s, "100 / 100") && has(s, "269 / 269") && has(s, "60 / 60"));
C("E8 声明真相源与审核依据", has(s, "docs/10-总监与对话架构总纲.md") && has(s, "docs/11-设计稿审核与实现方案.md"));
C("E9 声明本稿边界（未改实现 + 冲突以实现为准）", has(s, "V14.1 只改<b>描述与样式</b>") && has(s, "以<b>已通过真机 100/100 的实现</b>为准"));
C("E10 三项待裁已就地裁定", has(s, "三项待裁") && has(s, "Q1") && has(s, "Q2") && has(s, "Q3"));

// ══════ F. 反向断言（防止"旧稿误当新稿"） ══════
console.log("\n【F 反向断言】");
C("F1 不残留旧 `font-size:9px`", !has(s, "font-size:9px"));
C("F2 不残留旧 `font:600 9px/1`", !has(s, "font:600 9px/1"));
C("F3 不残留旧 `--faint:#6a7078`", !has(s, "--faint:#6a7078"));
C("F4 不残留旧 `color:#4e545c`", !has(s, "color:#4e545c"));
C("F5 不残留旧 `height:430px`（无 min-）", !has(s, ".winbody{display:flex;height:430px}"));
C("F6 不残留旧「点击遮罩关闭」（分屏下无「外部」）", !has(s, "点击遮罩"));
C("F7 不残留整 content 区覆盖式弹窗（inset:10px 12px 12px 12px）", !has(s, "inset:10px 12px 12px 12px"));

// ══════ 汇总 ══════
const total = pass + fails.length;
console.log("\n" + "─".repeat(64));
console.log("PASS " + pass + " / FAIL " + fails.length + " / 总计 " + total);
if (fails.length) { console.log("失败明细："); for (const f of fails) console.log("  · " + f); }
console.log("IS_PASS: " + (fails.length === 0 ? "TRUE" : "FALSE"));
process.exit(fails.length === 0 ? 0 : 1);
