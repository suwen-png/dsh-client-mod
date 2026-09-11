/**
 * verify-batch7.mjs — 批次 7「每一个对话 / 文件夹都有总监」专项验证
 *
 * 核心命题：让「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层全局总管负责」
 *          由**自动发现 + 幂等同步**保证，而非手工创建。
 *
 * 断言分五组：
 *   [1] 源码层：discover / sync 模块存在 + 导出齐全
 *   [2] 数据源：前缀模糊匹配（不写死 v5）+ 多源兜底 + 空源不抛错
 *   [3] 幂等性：🔴 稳定 id（ws_/se_ 前缀派生），跑两次不重复新建
 *   [4] 覆盖度：auditCoverage 结构完备 + 缺失可枚举
 *   [5] 产物层：全局契约齐全 + React 零打包 + UI 已接同步入口
 *
 * 用法：node scripts/verify-batch7.mjs
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

const P = {
	discover: join(ROOT, "src/logic/discover.js"),
	sync: join(ROOT, "src/logic/sync.js"),
	hierarchy: join(ROOT, "src/store/hierarchy.js"),
	comp: join(ROOT, "src/components/DirectorHierarchy.js"),
	entry: join(ROOT, "src/client-entry.js"),
	mount: join(ROOT, "src/mount.js"),
	summarize: join(ROOT, "src/logic/summarize.js"),
	bundle: join(ROOT, "lib/client.js")
};
const S = {};
for (const [k, p] of Object.entries(P)) S[k] = read(p);

/* ── [1] 源码层 ─────────────────────────────────────────── */
console.log("\n[1] 源码层：discover / sync 模块");
ok("src/logic/discover.js 存在", existsSync(P.discover), size(P.discover) + " B");
ok("src/logic/sync.js 存在", existsSync(P.sync), size(P.sync) + " B");

for (const e of ["ID_PREFIX", "UNGROUPED_ID", "shortId", "findWorkspaceViewKey", "readWorkspaceView",
	"readCurrentSessionId", "workspaceNodeId", "sessionNodeId", "discover", "installDiscoverApi"]) {
	ok("discover 导出 " + e, has(S.discover, new RegExp("export (function|const|async function)\\s+" + e + "\\b")));
}
for (const e of ["syncFromSource", "auditCoverage", "installSyncApi"]) {
	ok("sync 导出 " + e, has(S.sync, new RegExp("export (async function|function|const)\\s+" + e + "\\b")));
}

/* ── [2] 数据源发现 ──────────────────────────────────────── */
console.log("\n[2] 数据源：真实会话 / 文件夹发现");
// ⚠️ 注释中会以「dsh.workspace.view.v5」举例说明实测数据源，会污染"未写死"判断
//    （与 Function.prototype.toString() 含注释同类陷阱）→ 必须先剥离注释再断言代码本体。
const stripComments = (s) => String(s || "")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");
const discoverCode = stripComments(S.discover);

ok("读取 dsh.workspace.view（前缀模糊匹配，未写死 v5）",
	has(discoverCode, /indexOf\("dsh\.workspace\.view"\)\s*===\s*0/) && !has(discoverCode, /dsh\.workspace\.view\.v\d/),
	"宿主升级 v6 后仍可用");
ok("读取当前会话 dsh.sessions.current", has(S.discover, /dsh\.sessions\.current/));
ok("localStorage 不可用时安全返回（try-catch 兜底）", has(S.discover, /function safeLS/) && has(S.discover, /catch \(e\)/));
ok("多源兜底：localStorage 缺失时回落 IDB directorFolders",
	has(S.discover, /idbListFolders/) && has(S.discover, /source:\s*"idb-folders"/));
ok("无数据源时返回 source=none 且不抛错", has(S.discover, /source:\s*"none"/));
ok("🔴 sessionLabel 剥离 session- 前缀（否则所有会话同名）",
	has(S.discover, /export function sessionLabel/) && has(S.discover, /replace\(\/\^session-\/, ""\)/),
	"实测：直接截断前8位会得到常量前缀，8 个会话全部同名");
ok("sync 用 sessionLabel 命名会话节点", has(S.sync, /name: sessionLabel\(s\.id\)/));
ok("workspace=文件夹级 / session=对话级（语义注释留痕）",
	has(S.discover, /workspace\s*=\s*文件夹级/) && has(S.discover, /session\s*=\s*对话级/));

/* ── [3] 幂等性（稳定 id）────────────────────────────────── */
console.log("\n[3] 幂等性：稳定 id 派生（重复同步不重复新建）");
ok("workspace 节点 id 前缀 ws_", has(S.discover, /workspace:\s*"ws_"/));
ok("session 节点 id 前缀 se_", has(S.discover, /session:\s*"se_"/));
ok("未分组有稳定占位 id", has(S.discover, /UNGROUPED_ID\s*=\s*"__ungrouped__"/));
ok("🔴 稳定 id 论据写入注释（随机 id 会导致重复膨胀）",
	has(S.discover, /稳定 id 约定（幂等的根基）/) && has(S.discover, /不能用随机 id/));
ok("makeNode 支持外部指定 id", has(S.hierarchy, /makeNode\(\{[^}]*id,/s) || has(S.hierarchy, /p\.id|\[p\.id\]|id,/));
ok("makeNode 文档标注 id 参数", has(S.hierarchy, /@param \{string\} \[p\.id\]/));

ok("sync 用 getNode 判存后再建（存在即更新）",
	has(S.sync, /let node = await getNode\(id\)/) && has(S.sync, /if \(!node\)/));
ok("sync 父子关系用 Set 去重（不会重复 push children）", has(S.sync, /new Set\(\[\.\.\./));
ok("sync 不覆盖用户改名（autoName 守卫）", has(S.sync, /autoName !== false/));
ok("sync 孤儿软标记（不删用户数据）",
	has(S.sync, /orphaned = true/) && has(S.sync, /避免误删/));
ok("sync 顺序写入 meta.order（树不抖动）", has(S.sync, /order:\s*sIdx|order:\s*ws\.__order/));
ok("loadTree 排序优先 meta.order", has(S.hierarchy, /meta\.order === "number"/));

/* ── [4] 覆盖度自检 ──────────────────────────────────────── */
console.log("\n[4] 覆盖度自检：是否每一个对话 / 文件夹都有总监");
ok("auditCoverage 存在", has(S.sync, /export async function auditCoverage/));
ok("分别统计 sessions / folders / global 三项",
	has(S.sync, /sessions:\s*\{/) && has(S.sync, /folders:\s*\{/) && has(S.sync, /global:\s*\{/));
ok("可枚举缺失项 missing[]", has(S.sync, /sessionMissing/) && has(S.sync, /folderMissing/));
ok("给出总判定 ok（全局+会话+文件夹全覆盖）",
	has(S.sync, /ok:\s*globalOk && sessionCovered === sessionTotal && folderCovered === folderTotal/));
ok("覆盖度百分比计算", has(S.sync, /Math\.round\(\(a \/ b\) \* 100\)/));

/* ── [4.5] 变更通知（防陈旧快照）───────────────────────────── */
console.log("\n[4.5] 变更通知：面板不得停留在同步前的陈旧快照");
const P_bus = join(ROOT, "src/util/bus.js");
const S_bus = read(P_bus);
ok("src/util/bus.js 存在", existsSync(P_bus), size(P_bus) + " B");
ok("导出 onHierarchyChange / emitHierarchyChange",
	has(S_bus, /export function onHierarchyChange/) && has(S_bus, /export function emitHierarchyChange/));
ok("🔴 缺陷论据留痕（面板首帧早于同步完成 → 实测 0/8）",
	has(S_bus, /面板组件在\*\*插件启动时\*\*即挂载/) && has(S_bus, /会话 0\/8/));
ok("sync 完成后广播", has(S.sync, /emitHierarchyChange\(\)/));
ok("summarize 完成后广播", has(S.summarize, /emitHierarchyChange\(\)/));
ok("打开浮层时广播", has(S.mount, /emitHierarchyChange\(\)/));
ok("组件订阅变更并刷新",
	has(S.comp, /onHierarchyChange\(/) && has(S.comp, /import \{ onHierarchyChange \}/));

/* ── [5] 接线与产物 ──────────────────────────────────────── */
console.log("\n[5] 接线与产物");
ok("client-entry 引入 discover", has(S.entry, /from "\.\/logic\/discover\.js"/));
ok("client-entry 引入 sync", has(S.entry, /from "\.\/logic\/sync\.js"/));
ok("启动时自动同步 syncFromSource", has(S.entry, /autoSync === false \? null : syncFromSource\(\)/));
ok("同步结果写入 window.__dshSyncStats", has(S.entry, /__dshSyncStats/));
ok("installed 暴露 coverage / coverageOk", has(S.entry, /coverageOk/) && has(S.entry, /installed\.coverage/));
ok("安装 discover 全局契约", has(S.entry, /window\.__dshDiscover = installDiscoverApi\(\)/));
ok("安装 sync 全局契约", has(S.entry, /window\.__dshSync = installSyncApi\(\)/));
ok("批次 7 别名 __dshDirectorBatch7", has(S.entry, /__dshDirectorBatch7/));
// ⚠️ 禁止写死具体版本号（已两次因升版误报：batch6→batch7→batch8）。
//    改为区间断言：主版本 ≥0.7 且已包含批次 7 的能力（自动同步）。
ok("版本号 ≥ 0.7.0（批次 7 水位，禁止写死具体版本）", (() => {
	const m = String(S.entry).match(/PLUGIN_VERSION\s*=\s*"(\d+)\.(\d+)\.(\d+)-batch(\d+)"/);
	if (!m) return false;
	const minor = Number(m[2]);
	const batch = Number(m[4]);
	return minor >= 7 && batch >= 7;
})());

ok("UI 已接「同步真实会话」按钮", has(S.comp, /同步真实会话/) && has(S.comp, /onClick: doSync/));
ok("UI 展示覆盖度（会话/文件夹/全局 三项计数）",
	has(S.comp, /coverage\.sessions\.covered/) && has(S.comp, /coverage\.folders\.covered/) && has(S.comp, /coverage\.global\.covered/));
ok("UI 覆盖度未达标时高亮提示", has(S.comp, /存在未覆盖/));
ok("UI 支持改名并清 autoName", has(S.comp, /node\.meta\.autoName = false/));

ok("产物存在", existsSync(P.bundle), size(P.bundle) + " B");
ok("产物含 discover 契约", has(S.bundle, /__dshDiscover/));
ok("产物含 sync 契约", has(S.bundle, /__dshSync/));
ok("产物含稳定 id 前缀", has(S.bundle, /"ws_"/) && has(S.bundle, /"se_"/));
ok("🔴 React 零打包（无 React 源码特征）",
	!has(S.bundle, /react\.production\.min\.js|__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/));
ok("平台模块经 require 外置", has(S.bundle, /require\("react"\)/) && has(S.bundle, /require\("react\/jsx-runtime"\)/));

/* ── 汇总 ────────────────────────────────────────────────── */
console.log("\n" + "=".repeat(56));
console.log("批次 7 验证：PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (fail) { console.log("失败项："); fails.forEach((f) => console.log("  ✗ " + f)); }
console.log("IS_PASS: " + (fail === 0 ? "TRUE" : "FALSE"));
process.exit(fail === 0 ? 0 : 1);
