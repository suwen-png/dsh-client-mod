#!/usr/bin/env node
/**
 * test-director-dispatch.mjs —— 「按维度派发」里的**纯函数**离线测试（无需 Harness）
 *
 * ══════════════════════════════════════════════════════════════════
 * 这份测试要证明什么（先写"测什么 + 期望结果"，再写代码）
 * ──────────────────────────────────────────────────────────────────
 * 第 17 批需求里，用户原话是：
 *   「小说的世界观架构还有文档你读取 "D:\workspace\novels\虚海" 这个文件的信息作为填充」
 * ⇒ 派发简报里要带上**项目根**，让每条分支都知道去读哪。这个提取写在
 *   `logic/director-dispatch.js` 的 `projectOf()`（纯函数）。
 *
 * 🔴 它**刻意不做**"猜目录" —— 找不到绝对路径就返回空（简报里少一段，不是错）。
 *    猜错的代价是 8 条分支同时去读一个不存在的目录（比少一段坏得多）。
 *
 *  | 编号 | 被测行为 | 期望结果 |
 *  |:-----|:---------|:---------|
 *  | DD-1 | 反斜杠绝对路径 | `root` 原样、`name` = 末段 `墟海` |
 *  | DD-2 | 正斜杠 + 小写盘符 + 尾斜杠 | 命中且 `name` **不带**尾斜杠 |
 *  | DD-3 | 引号包裹（真机原话形态） | 引号**被剥掉**（不在 `root` / `name` 里） |
 *  | DD-4 | 尾部中文标点 | `，。；：、）】` **被剥掉** |
 *  | DD-5 | 🔴 **负对照**：无路径 | `{root:null, name:null}` —— **不许猜** |
 *  | DD-6 | 🔴 **负对照**：相对路径 / 只有盘符 | 不匹配（必须是"盘符 + 分隔符 + 至少一层"） |
 *  | DD-7 | 末段过长（>40） | `root` **仍保留**，`name` 置 `null`（宁可少一个名字，不截出半截目录名） |
 *  | DD-8 | 真机原话复现 | 从用户那句原话里提取出 `D:\workspace\novels\虚海` |
 *  | DD-9 | 纯函数性质 | 同输入必同输出；不改入参；`null`/`undefined` 不抛 |
 *
 * 用法：node scripts/test-director-dispatch.mjs ｜ 退出码 0 全绿 / 1 有失败
 */

const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const { projectOf } = await import("../src/logic/director-dispatch.js");

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(`${id} ${name}`); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}` + (detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : ""));
}

console.log("═══════════════════════════════════════════════════════════");
console.log("  test-director-dispatch · 需求里的项目根提取（纯函数）");
console.log("═══════════════════════════════════════════════════════════");

const p1 = projectOf("帮我写一个小说《虚海》，项目根 D:\\workspace\\novels\\虚海，先搭世界观");
t("DD-1", "反斜杠绝对路径：`root` 命中、`name` = 末段 `虚海`",
	p1.root === "D:\\workspace\\novels\\虚海" && p1.name === "虚海", p1);
const p2 = projectOf("读一下 d:/workspace/novels/虚海/ 里面的资料");
t("DD-2", "正斜杠 + 小写盘符 + 尾斜杠：命中且 `name` **不带**尾斜杠",
	p2.root === "d:/workspace/novels/虚海" && p2.name === "虚海", p2);
const p3 = projectOf('你读取"D:\\workspace\\novels\\虚海"这个文件的信息作为填充');
t("DD-3", "引号包裹（真机原话形态）：引号**被剥掉**（`root`/`name` 都不含引号）",
	p3.root === "D:\\workspace\\novels\\虚海" && p3.name === "虚海"
	&& String(p3.root).indexOf('"') < 0, p3);
const p4 = projectOf("项目在 E:\\proj\\墟海，。；：、）】");
t("DD-4", "尾部中文标点被剥掉（`，。；：、）】` 都不进 `name`）",
	p4.name === "墟海" && p4.root === "E:\\proj\\墟海", p4);
t("DD-5", "🔴 **负对照**：无路径 ⇒ `{root:null, name:null}`（**不许猜目录**）",
	projectOf("帮我写一个小说《墟海》，先搭世界观").root === null
	&& projectOf("帮我写一个小说《墟海》，先搭世界观").name === null
	&& projectOf("").root === null && projectOf(null).root === null && projectOf(undefined).root === null);
t("DD-6", "🔴 **负对照**：相对路径 / 只有盘符 ⇒ 不匹配（必须「盘符 + 分隔符 + 至少一层」）",
	projectOf("读 ./novels/虚海").root === null
	&& projectOf("读 novels\\虚海").root === null
	&& projectOf("盘符 D:").root === null
	&& projectOf("D:\\").root === null,
	{ a: projectOf("读 ./novels/虚海"), b: projectOf("D:\\") });
const longName = "目".repeat(60);
const p7 = projectOf("根目录 C:\\a\\" + longName);
t("DD-7", "末段过长（>40）⇒ `root` **仍保留**，`name` 置 `null`",
	p7.root !== null && p7.root.indexOf(longName) >= 0 && p7.name === null, p7);
const speech = "对就是这样 然后小说的世界观架构还有文档你读取\"D:\\workspace\\novels\\虚海\"这个文件的信息作为填充";
t("DD-8", "真机原话复现 ⇒ 提取出 `D:\\workspace\\novels\\虚海`",
	projectOf(speech).root === "D:\\workspace\\novels\\虚海" && projectOf(speech).name === "虚海", projectOf(speech));
const inp = "项目根 D:\\workspace\\novels\\虚海 请读取";
const inpCopy = String(inp);
const a1 = projectOf(inp), a2 = projectOf(inp);
t("DD-9", "纯函数性质：同输入必同输出；不改入参；`null` 不抛",
	JSON.stringify(a1) === JSON.stringify(a2) && inp === inpCopy
	&& (() => { try { projectOf(null); projectOf(123); projectOf({}); return true; } catch (e) { return false; } })(),
	{ a1: a1, a2: a2 });

console.log("\n═══════════════════════════════════════════════════════════");
console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
