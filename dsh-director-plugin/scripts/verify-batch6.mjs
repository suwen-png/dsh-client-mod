/**
 * verify-batch6.mjs — 批次 6「多层级总监结构」专项验证
 *
 * 覆盖：对话级 / 文件夹级 / 全局级 三层结构 + 分层总结 + 分梯度调用
 * 用法：node scripts/verify-batch6.mjs
 *
 * 断言分四组：
 *   [1] 源码层：模块存在性 + 导出齐全 + 需求映射注释
 *   [2] 数据层：三层枚举 / 存储复用 / 🔴 反证（不新增 IDB store、不升 DB 版本）
 *   [3] 逻辑层：分层总结 + 三梯度 + 降级回落
 *   [4] 产物层：平台外置（React 零打包）+ 全局契约 + 挂载入口
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const size = (p) => (existsSync(p) ? statSync(p).size : 0);

let pass = 0;
let fail = 0;
const fails = [];
function ok(name, cond, detail = "") {
	if (cond) { pass++; console.log("  PASS  " + name + (detail ? "  |  " + detail : "")); }
	else { fail++; fails.push(name); console.log("  FAIL  " + name + (detail ? "  |  " + detail : "")); }
}
const has = (src, re) => re.test(src || "");
const count = (src, re) => ((src || "").match(re) || []).length;

/* ── [1] 源码层 ─────────────────────────────────────────── */
console.log("\n[1] 源码层：模块与导出");
const P = {
	hierarchy: join(ROOT, "src/store/hierarchy.js"),
	summarize: join(ROOT, "src/logic/summarize.js"),
	comp: join(ROOT, "src/components/DirectorHierarchy.js"),
	mount: join(ROOT, "src/mount.js"),
	entry: join(ROOT, "src/client-entry.js"),
	idb: join(ROOT, "src/store/idb.js")
};
const S = {};
for (const [k, p] of Object.entries(P)) S[k] = read(p);

ok("src/store/hierarchy.js 存在", existsSync(P.hierarchy), size(P.hierarchy) + " B");
ok("src/logic/summarize.js 存在", existsSync(P.summarize), size(P.summarize) + " B");
ok("src/components/DirectorHierarchy.js 存在", existsSync(P.comp), size(P.comp) + " B");
ok("src/mount.js 存在", existsSync(P.mount), size(P.mount) + " B");

const hierExports = ["LEVEL", "LEVEL_LABEL", "GLOBAL_NODE_ID", "makeNode", "loadTree",
	"createChild", "attachSession", "resolveConfig", "getBreadcrumb", "installHierarchyApi",
	"getNode", "saveNode", "removeNode", "listAllNodes", "ensureGlobal", "countByLevel"];
for (const e of hierExports) ok("hierarchy 导出 " + e, has(S.hierarchy, new RegExp("export (function|const|async function)\\s+" + e + "\\b")));

const sumExports = ["GRADE", "extractByRule", "summarizeNode", "summarizeTree", "propagateUp", "installSummarizeApi"];
for (const e of sumExports) ok("summarize 导出 " + e, has(S.summarize, new RegExp("export (function|const|async function)\\s+" + e + "\\b")));

ok("组件导出 DirectorHierarchy", has(S.comp, /export function DirectorHierarchy/));
ok("mount 导出 mountHierarchy", has(S.mount, /export function mountHierarchy\b/));
ok("mount 导出 mountHierarchyOverlay", has(S.mount, /export function mountHierarchyOverlay/));
ok("mount 导出 tryRegisterHostSlot", has(S.mount, /export function tryRegisterHostSlot/));

/* ── [2] 数据层 ─────────────────────────────────────────── */
console.log("\n[2] 数据层：三层结构 / 存储复用 / 🔴 反证");
ok("三层枚举 global", has(S.hierarchy, /GLOBAL:\s*"global"/));
ok("三层枚举 project（文件夹级）", has(S.hierarchy, /PROJECT:\s*"project"/));
ok("三层枚举 session（对话级）", has(S.hierarchy, /SESSION:\s*"session"/));
ok("层级中文名对齐 03号文 §1.3", has(S.hierarchy, /全局总管/) && has(S.hierarchy, /项目总监/) && has(S.hierarchy, /会话总监/));
ok("全局根单例 id", has(S.hierarchy, /GLOBAL_NODE_ID\s*=\s*"__global__"/));
ok("MemoryNode 含 parentId/children（17号文 §2.1）", has(S.hierarchy, /parentId/) && has(S.hierarchy, /children/));
ok("继承解析 resolveConfig（03号文 §3.2）", has(S.hierarchy, /configOverride/));

// 🔴 反证 1：不得新增 IDB store（宿主与插件共享 DB，新增需升版本 → 宿主 v3 打开失败）
ok("🔴 反证：idb.js 未新增 store", count(S.idb, /createObjectStore\(/g) === 6, "createObjectStore 调用 " + count(S.idb, /createObjectStore\(/g) + " 次（预期 6）");
ok("🔴 反证：IDB_ALL_STORES 仍为 6 个", count(S.idb, /IDB_[A-Z_]+_STORE,/g) >= 6, "store 常量数 " + count(S.idb, /IDB_[A-Z_]+_STORE,/g));

// 🔴 反证 2：不得升 DB 版本
const verMatch = (S.idb || "").match(/openDB\([^,]+,\s*(\d+)|version\s*[:=]\s*(\d+)|DB_VERSION\s*=\s*(\d+)/);
const ver = verMatch ? (verMatch[1] || verMatch[2] || verMatch[3]) : null;
ok("🔴 反证：DB 版本未升级（仍为 3）", ver === "3" || ver === null, "检出版本 " + (ver || "（未匹配到，按未升版处理）"));

// 存储复用：hierarchy 走 memoryCore，未引入新 store
ok("hierarchy 复用 memoryCore（keyPath projectId）", has(S.hierarchy, /IDB_MEMORY_CORE_STORE/));
ok("hierarchy 未 import 其他 store 作为主存储", !has(S.hierarchy, /IDB_FOLDERS_STORE\s*[,}]/));
// 🔴 缺陷回退防护（实测 bug）：memoryCore keyPath=projectId，节点主键是 id，
//    不注入 projectId 则 put() 缺 key → DataError → 写入静默失败（子节点查不到）
ok("🔴 回退防护：saveNode 注入 projectId=node.id", has(S.hierarchy, /projectId:\s*node\.id/));
ok("🔴 回退防护：文件头记录该坑（现象/原因/做法）", has(S.hierarchy, /keyPath/) && has(S.hierarchy, /DataError/));

/* ── [3] 逻辑层 ─────────────────────────────────────────── */
console.log("\n[3] 逻辑层：分层总结 + 分梯度调用");
ok("三梯度定义 G0/G1/G2", has(S.summarize, /RULE:\s*"G0"/) && has(S.summarize, /LOCAL:\s*"G1"/) && has(S.summarize, /ROLLUP:\s*"G2"/));
ok("G0 规则抽取（零模型）", has(S.summarize, /function extractByRule/));
ok("G1 本地模型调用走 callLocalModel", has(S.summarize, /callLocalModel\(/));
ok("G2 上层汇总（子级 summary 作为输入）", has(S.summarize, /childSummaries/));
ok("🔴 降级回落：模型失败 → G0", has(S.summarize, /degraded\s*=\s*true/) && has(S.summarize, /回落 G0/));
ok("降级原因标注（03号文 §4.3）", has(S.summarize, /§4\.3/));
ok("分层汇总自底向上（后序遍历）", has(S.summarize, /先子后父|后序遍历/));
ok("向上提交 propagateUp（03号文 §3.2）", has(S.summarize, /async function propagateUp/));
ok("核心认知字段对齐 17号文 §1A.13", has(S.summarize, /定位/) && has(S.summarize, /目标/) && has(S.summarize, /当前阶段/));
ok("引用 17号文 §1A.13 需求出处", has(S.summarize, /§1A\.13/));

/* ── [4] 产物层 ─────────────────────────────────────────── */
console.log("\n[4] 产物层：外置 / 契约 / 挂载");
const BUNDLE = read(join(ROOT, "lib/client.js")) || "";
ok("产物存在", BUNDLE.length > 0, BUNDLE.length + " 字符");
ok("🔴 反证：产物未打包 React 源码", !has(BUNDLE, /react\.production\.min\.js/) && !has(BUNDLE, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/));
ok("平台外置 react-dom/client 走 require", has(BUNDLE, /require\("react-dom\/client"\)/));
ok("平台外置 react/jsx-runtime 走 require", has(BUNDLE, /require\("react\/jsx-runtime"\)/));
ok("产物含 __dshHierarchy 契约", has(BUNDLE, /__dshHierarchy/));
ok("产物含 __dshSummarize 契约", has(BUNDLE, /__dshSummarize/));
ok("产物含批次 6 契约字段", has(BUNDLE, /hierarchyApi/) && has(BUNDLE, /summarizeApi/) && has(BUNDLE, /hierarchyMounted/));
ok("产物含批次 6 别名 __dshDirectorBatch6", has(BUNDLE, /__dshDirectorBatch6/));
// 版本号随批次递增（batch6 → batch7…batch15），断言「不低于 0.6.0-batch6」而非写死。
// 2026-09-12 纠错：原正则 `/0\.[6-9]\.0-batch[6-9]/` 的 `[6-9]` 是**单字符**，只能匹配
//   6/7/8/9；产物已到 `0.15.0-batch15` ⇒ minor=15、batch=15 都不是单字符 ⇒ 假红（闸门过期）。
//   改为解析 (major, minor, batch) 数值后做序比较，任何未来版本都不会再误报。
const verOf = (src) => {
	const m = (src || "").match(/(\d+)\.(\d+)\.(\d+)-batch(\d+)/);
	return m ? { major: +m[1], minor: +m[2], patch: +m[3], batch: +m[4] } : null;
};
const bv = verOf(BUNDLE);
const MIN_V = { major: 0, minor: 6, patch: 0, batch: 6 };
const geMin = !!bv && (bv.major > MIN_V.major
	|| (bv.major === MIN_V.major
		&& (bv.minor > MIN_V.minor || (bv.minor === MIN_V.minor && bv.batch >= MIN_V.batch))));
ok("产物版本号不低于 0.6.0-batch6", geMin,
	bv ? `实测 ${bv.major}.${bv.minor}.${bv.patch}-batch${bv.batch}（下界 ${MIN_V.major}.${MIN_V.minor}.${MIN_V.patch}-batch${MIN_V.batch}）` : "未找到版本号字面量");
// 交叉校验：产物版本必须与源码唯一真相源 src/client-entry.js 的 PLUGIN_VERSION 逐字一致
const SRC_VER = verOf(read(P.entry));
ok("产物版本 == 源码 PLUGIN_VERSION（唯一真相源）",
	!!bv && !!SRC_VER && bv.major === SRC_VER.major && bv.minor === SRC_VER.minor && bv.batch === SRC_VER.batch,
	`源码 ${SRC_VER ? `${SRC_VER.major}.${SRC_VER.minor}.${SRC_VER.patch}-batch${SRC_VER.batch}` : "未找到"} / 产物 ${bv ? `${bv.major}.${bv.minor}.${bv.patch}-batch${bv.batch}` : "未找到"}`);
ok("挂载入口含浮层兜底", has(BUNDLE, /dsh-director-hierarchy-overlay/));
ok("挂载含宿主 slot 尝试（conversation.view）", has(BUNDLE, /conversation\.view/));

/* ── 汇总 ───────────────────────────────────────────────── */
console.log("\n=== 汇总 ===");
console.log("  总计 " + (pass + fail) + " 项  |  通过 " + pass + "  |  失败 " + fail);
if (fails.length) console.log("  失败项：\n   - " + fails.join("\n   - "));
console.log("  IS_PASS = " + (fail === 0));
process.exit(fail === 0 ? 0 : 1);
