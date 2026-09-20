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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const store = new Map();
globalThis.localStorage = {
	getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
	setItem(k, v) { store.set(String(k), String(v)); },
	removeItem(k) { store.delete(String(k)); }
};

const { projectOf } = await import("../src/logic/director-dispatch.js");
/* 🔴 第 41 轮 `T-PLUG-043`：配额预检（派发前零成本判据）的唯一真相源 */
const {
	isQuotaFailure, writeQuotaMemo, readQuotaMemo, clearQuotaMemo, QUOTA_MEMO_TTL_MS
} = await import("../src/store/split-index.js");
/* 校准注入（纪律 32）：`RD_NEG=2` ⇒ 把配额判据换成**恒真**坏版 ⇒ `DD-14` 必须变红。
 * ⚠️ 与 `RD_NEG=1`（改名调用点）分开编号 —— 一个环境变量同时注入两处，
 *    红的时候分不清是哪一处被注入（纪律 128：报告必须可归因）。 */
const NEG_QUOTA = String(process.env.RD_NEG || "").trim() === "2";
const quotaFn = NEG_QUOTA ? (() => true) : isQuotaFailure;

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

/* ══════════════════════════════════════════════════════════════════
 * `T-PLUG-042` · 宿主 `rename` 接线（第 41 轮落地）
 * ══════════════════════════════════════════════════════════════════
 *  为什么要在**离线**守它（纪律 135：落点在 ≠ 闸门守）：
 *    这条接线**只在真机派发时**才跑（要宿主 `ctx.sessions`）⇒ 离线跑不到执行路径；
 *    但"接没接进去 / 接在哪一支"是**源码事实**，离线完全能守。
 *    不守就会退化成"代码写了、没人知道还在不在"（纪律 79：写好了 ≠ 接进去了）。
 *  🔴 两条要点：
 *    ① **只在新建分支**调 —— 复用的会话可能被用户改过标题，动了就是耗损用户数据（纪律 82）；
 *    ② 必须走 `renameSession()`（内部用 `sessionsService()`，与全仓读会话服务**同一处**）。
 *
 *  校准（纪律 32）：`RD_NEG=1` ⇒ 把调用**复制到复用分支**（模拟"复用也改名"坏版本）
 *    ⇒ `DD-12`（唯一调用点）**必须**变红。 */
const SRC_TREE = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/logic/branch-tree.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
const SRC_DISP = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/logic/director-dispatch.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
/* 第 41 轮 `T-PLUG-043` 的两处接线源（落 / 清备忘在 collect，保存留字段在 split-index） */
const SRC_COLLECT = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/logic/director-collect.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
const SRC_SPLIT = (() => {
	try { return readFileSync(fileURLToPath(new URL("../src/store/split-index.js", import.meta.url)), "utf8"); }
	catch (e) { return ""; }
})();
const RD_NEG = String(process.env.RD_NEG || "") === "1";
const dispCheck = RD_NEG
	? SRC_DISP.replace('sessionId = String(dec.sessionId);', 'sessionId = String(dec.sessionId);\n\t\t\tawait renameSession(sessionId, label);')
	: SRC_DISP;
if (RD_NEG) console.log("  [校准] RD_NEG=1 ⇒ 复用分支也调 renameSession（坏版本）");

t("DD-10", "`branch-tree.js` **导出** `renameSession`，且它走**宿主** `svc.rename({sessionId,title})`（不是插件侧改显示）",
	SRC_TREE.indexOf("export async function renameSession(") >= 0 && SRC_TREE.indexOf("svc.rename({ sessionId:") >= 0,
	{ hasExport: SRC_TREE.indexOf("export async function renameSession(") >= 0, hasHostCall: SRC_TREE.indexOf("svc.rename({ sessionId:") >= 0 });

const iCreate = SRC_DISP.indexOf("await createSession({})");
const iRename = SRC_DISP.indexOf("await renameSession(sessionId, label)");
t("DD-11", "`director-dispatch.js` 真的**接线**了：`await renameSession(sessionId, label)` 存在，且在 `await createSession({})` **之后**（即新建路径里）",
	iCreate >= 0 && iRename > iCreate, { iCreate: iCreate, iRename: iRename });

const rdCallN = (dispCheck.match(/renameSession\s*\(/g) || []).length;
t("DD-12", "🔴 **唯一调用点**：`renameSession(` 在派发链里只出现 **1** 次（两处就说明复用分支也被改名 ⇒ 会覆盖用户标题，纪律 82）",
	rdCallN === 1, { callN: rdCallN, RD_NEG: RD_NEG });

t("DD-13", "降级**可见**（纪律 19）：结果已落进派发读数（`renameOk` / `renameWhy`）",
	SRC_DISP.indexOf("renameOk:") >= 0 && SRC_DISP.indexOf("renameWhy:") >= 0,
	{ renameOk: SRC_DISP.indexOf("renameOk:") >= 0, renameWhy: SRC_DISP.indexOf("renameWhy:") >= 0 });

t("CAL-DD-12", "校准（纪律 32）：`RD_NEG=1` 时 `DD-12` **必须**变红（证明它不是恒真）",
	RD_NEG ? rdCallN === 2 : rdCallN === 1, { callN: rdCallN, RD_NEG: RD_NEG });

/* ══════════════════ 第 41 轮 · `T-PLUG-043` 派发前配额预检 ══════════════════
 * 判据（`03` 台账原话）：「派发前做**零成本**判据（读上一次 `turn/end` 的 failure），
 *   命中 QUOTA 类失败就**不派发**，直接在总监页说明"配额不足，先充值或换模型"」。
 * 🔴 为什么必须离线：真机上"配额不足"要靠**真把额度打光**才能复现 —— 不可能拿它当测试前提。
 *    而这条判据的坏形态（**恒真**）在真机上表现为"什么都派不出去"，
 *    看起来像"环境坏了"，极难归因（所以 `DD-14` 带**负对照**：非配额错误不许被拦）。
 */
if (NEG_QUOTA) console.log("  [校准] RD_NEG=2 ⇒ 配额判据换成**恒真**坏版 ⇒ DD-14 必须变红");

t("DD-14", "配额判据 `isQuotaFailure` 三路命中（`code:QUOTA` / `status:402` / `Insufficient Balance`），"
	+ "且**负对照**：普通失败（超时 / 空 / null）**不许**被判成配额",
	quotaFn({ code: "QUOTA", status: 402, message: "Insufficient Balance" }) === true
	&& quotaFn({ code: "QUOTA" }) === true
	&& quotaFn({ status: 402 }) === true
	&& quotaFn({ message: "Insufficient Balance" }) === true
	&& quotaFn({ code: "TIMEOUT", message: "request timed out" }) === false
	&& quotaFn({}) === false && quotaFn(null) === false && quotaFn(undefined) === false,
	{ NEG_QUOTA: NEG_QUOTA });

t("CAL-DD-14", "校准（纪律 32）：把判据换成恒真 ⇒ `DD-14` **必须**变红（证明它真的在判，不是走过场）",
	NEG_QUOTA ? (quotaFn({ code: "TIMEOUT" }) === true) : (quotaFn({ code: "TIMEOUT" }) === false),
	{ NEG_QUOTA: NEG_QUOTA });

/* 备忘往返（落 / 读 / 清）—— 真机上由 `director-collect.js` 落、`director-dispatch.js` 读 */
clearQuotaMemo();
const memoW = writeQuotaMemo({ code: "QUOTA", status: 402, message: "Insufficient Balance" }, 1000000);
const memoR = readQuotaMemo(1000000);
t("DD-15", "备忘**往返**：配额失败写得进、读得出，`code`/`status`/`message` 原样（不许二次加工）",
	memoW && memoR && memoR.code === "QUOTA" && memoR.status === 402
	&& memoR.message === "Insufficient Balance" && memoR.at === 1000000,
	{ memoR: memoR });

t("DD-16", "🔴 非配额失败**不落备忘**（否则一次超时就会把派发永久拦成「配额问题」）",
	(() => { clearQuotaMemo(); writeQuotaMemo({ code: "TIMEOUT", message: "x" }, 1); return readQuotaMemo(2) === null; })(),
	{ after: readQuotaMemo(2) });

t("DD-17", "🔴 **TTL**：过期 ⇒ 不再拦（且顺手清掉）—— 备忘不许把用户锁死（充值后必须能自己恢复）",
	(() => {
		clearQuotaMemo();
		writeQuotaMemo({ code: "QUOTA" }, 1000);
		const fresh = readQuotaMemo(1000 + QUOTA_MEMO_TTL_MS - 1);
		const stale = readQuotaMemo(1000 + QUOTA_MEMO_TTL_MS + 1);
		return fresh !== null && stale === null;
	})(),
	{ TTL: QUOTA_MEMO_TTL_MS });

t("DD-18", "🔴 成功必须**清备忘**：`director-collect.js` 既有 `writeQuotaMemo(fail)` 也有 `clearQuotaMemo()`"
	+ "（只落不清 ⇒ 额度恢复了还一直报「配额不足」）",
	SRC_COLLECT.indexOf("writeQuotaMemo(fail)") >= 0 && SRC_COLLECT.indexOf("clearQuotaMemo()") >= 0,
	{ write: SRC_COLLECT.indexOf("writeQuotaMemo(fail)") >= 0, clear: SRC_COLLECT.indexOf("clearQuotaMemo()") >= 0 });

t("DD-19", "🔴 派发链**真接线**：`dispatchBranches` 里 `readQuotaMemo()` 早退，并显式给出 `kind:\"quota\"` + `quotaBlock`",
	SRC_DISP.indexOf("readQuotaMemo()") >= 0 && SRC_DISP.indexOf('kind: "quota"') >= 0
	&& SRC_DISP.indexOf("quotaBlock: true") >= 0,
	{ read: SRC_DISP.indexOf("readQuotaMemo()") >= 0, kind: SRC_DISP.indexOf('kind: "quota"') >= 0 });

t("DD-20", "🔴 `writeSplitIndex()` **保留** `quota` 字段（同一记录两个写者 ⇒ 不保留就会被分流登记静默抹掉，纪律 126）",
	SRC_SPLIT.indexOf("if (rec && rec.quota) out.quota = rec.quota;") >= 0,
	{ keep: SRC_SPLIT.indexOf("if (rec && rec.quota) out.quota = rec.quota;") >= 0 });


console.log(`  PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fail) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
console.log(`  IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
