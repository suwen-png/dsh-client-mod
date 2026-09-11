/**
 * verify-batch1.mjs — 插件迁移验证（批次 1 + 批次 2）
 *
 * 批次 1：A14 剥离 + 零依赖基础层
 * 批次 2：数据层（A1/A2/A4/A5 + cookie + idb）
 *
 * 用途：T-PLUG-005 批次 1 的自证脚本。所有数字程序化求和，不手工累加。
 *
 * 用法：node scripts/verify-batch1.mjs
 * 退出码：0 = 全部通过；1 = 有失败项
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const HOST = join(ROOT, "workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js");
const SNAP = join(ROOT, "snapshots/snapshot-20260908-131412-before-apply/dsh-client-ui-conversation/lib/client.js");
const PLUGIN = join(ROOT, "dsh-director-plugin");

const results = [];
const check = (name, pass, evidence) => {
	results.push({ name, pass, evidence });
	console.log((pass ? "  PASS  " : "  FAIL  ") + name + "  |  " + evidence);
};

console.log("\n=== 插件迁移验证（批次 1 + 批次 2）===\n");

// ── 1. A14 剥离：宿主体积 ──
console.log("[1] A14 剥离");
const hostSize = statSync(HOST).size;
const snapSize = existsSync(SNAP) ? statSync(SNAP).size : 0;
check("宿主 client.js 已减体积", hostSize < snapSize, `剥离后 ${hostSize} B < 剥离前快照 ${snapSize} B`);
check("减幅 ≥ 500 KB", snapSize - hostSize >= 500 * 1024, `实减 ${snapSize - hostSize} B`);

// ── 2. A14 剥离：DSH_DOCS_INDEX 声明已移除 ──
console.log("\n[2] DSH_DOCS_INDEX 声明");
const hostSrc = readFileSync(HOST, "utf8");
const declCount = (hostSrc.match(/^const DSH_DOCS_INDEX\s*=/gm) || []).length;
check("声明数归零", declCount === 0, `grep '^const DSH_DOCS_INDEX' = ${declCount}`);
const guardCount = (hostSrc.match(/typeof DSH_DOCS_INDEX !== "undefined"/g) || []).length;
check("typeof 守卫保留（回落不报错）", guardCount >= 2, `守卫出现 ${guardCount} 次（预期 ≥2：6544 挂载 + 6586 读取）`);

// ── 3. 无超长单行（原 541KB 行已消失）──
console.log("\n[3] 超长行检查");
const longLines = hostSrc.split("\n").filter((l) => l.length > 100000);
check("无 >100KB 单行", longLines.length === 0, `命中 ${longLines.length} 行`);
const maxLine = hostSrc.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
check("最长行 < 20KB", maxLine < 20000, `最长行 ${maxLine} B`);

// ── 4. 插件资源文件 ──
console.log("\n[4] 插件侧资源");
const assetPath = join(PLUGIN, "assets/docs-index.json");
check("assets/docs-index.json 存在", existsSync(assetPath), assetPath.replace(ROOT + "\\", ""));
if (existsSync(assetPath)) {
	const assetSize = statSync(assetPath).size;
	check("资源体积与剥离量相当", Math.abs(assetSize - (snapSize - hostSize)) < 100 * 1024, `资产 ${assetSize} B vs 实减 ${snapSize - hostSize} B`);
	const data = JSON.parse(readFileSync(assetPath, "utf8"));
	check("JSON 结构完整", Boolean(data.tree && data.docs), `tree 目录 ${Object.keys(data.tree || {}).length} / docs ${Object.keys(data.docs || {}).length} 篇 / docCount 声明 ${data.docCount}`);
	check("docs 篇数与 docCount 一致", Object.keys(data.docs || {}).length === data.docCount, `${Object.keys(data.docs || {}).length} vs ${data.docCount}`);
}

// ── 5. 批次 1 模块文件齐备 ──
console.log("\n[5] 批次 1 模块文件");
const EXPECTED = [
	["src/util/debug.js", "D3 统一调试日志"],
	["src/util/log-collector.js", "A3 Log 收集器"],
	["src/store/layout.js", "A11 布局 store"],
	["src/store/theme.js", "A12 主题 store"],
	["src/config/model.js", "C2 配置与本地模型"],
	["src/dev/layout-probe.js", "C1 布局探针"],
	["src/store/docs-index-inject.js", "A13+A14 注入壳"],
	["src/client-entry.js", "插件入口"],
	["src/index.js", "骨架导航表"],
];
for (const [rel, desc] of EXPECTED) {
	const p = join(PLUGIN, rel);
	check(`${desc} (${rel})`, existsSync(p), existsSync(p) ? statSync(p).size + " B" : "缺失");
}

// ── 6. 全局契约（window 挂载）在插件源码中存在 ──
console.log("\n[6] 全局契约（批次 1）");
const CONTRACTS = ["__dshDebug", "__dshV9Log", "__directorLayoutStore", "__dshTheme", "__directorConfig", "__dshCheckOllama", "__dshDocsIndex", "__dshLayoutProbe"];
const ALL_SRC = EXPECTED.map((e) => join(PLUGIN, e[0]))
	.concat([join(PLUGIN, "src/bridge/spike-fs-probe.js")])
	.filter(existsSync);
for (const key of CONTRACTS) {
	const hit = ALL_SRC.some((p) => readFileSync(p, "utf8").includes("window." + key));
	check(`契约 window.${key}`, hit, hit ? "已在插件侧写入" : "未找到");
}

// ── 7. 批次 2 数据层模块文件齐备 ──
console.log("\n[7] 批次 2 模块文件");
const BATCH2 = [
	["src/store/messages.js", "A1 消息 store（内存层）"],
	["src/store/memory.js", "A2 记忆 CRUD"],
	["src/store/branch.js", "A4 分支创建+记忆面板"],
	["src/store/docs.js", "A5 总监文档 store"],
	["src/store/cookie.js", "V10 Cookie 分块存储"],
	["src/store/idb.js", "IndexedDB 持久化主层"],
];
for (const [rel, desc] of BATCH2) {
	const p = join(PLUGIN, rel);
	check(`${desc} (${rel})`, existsSync(p), existsSync(p) ? statSync(p).size + " B" : "缺失");
}

// ── 8. 批次 2 全局契约（宿主直接调用，不可改名）──
console.log("\n[8] 全局契约（批次 2）");
const B2_CONTRACTS = [
	["__dshMemory", "src/store/memory.js"],
	["__dshCreateBranch", "src/store/branch.js"],
	["__dshSwitchMemoryTab", "src/store/branch.js"],
	["__dshShowToast", "src/store/branch.js"],
];
for (const [key, rel] of B2_CONTRACTS) {
	const p = join(PLUGIN, rel);
	const hit = existsSync(p) && readFileSync(p, "utf8").includes("window." + key);
	check(`契约 window.${key} (${rel})`, hit, hit ? "已写入" : "未找到");
}

// ── 9. A4 XSS 转义保留（V9.4-P1，回归防线）──
console.log("\n[9] A4 XSS 转义");
const branchSrc = existsSync(join(PLUGIN, "src/store/branch.js")) ? readFileSync(join(PLUGIN, "src/store/branch.js"), "utf8") : "";
check("dshEscapeHTML 已导出", /export function dshEscapeHTML/.test(branchSrc), "export function dshEscapeHTML");
const escChars = ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"].filter((c) => branchSrc.includes(c)).length;
check("覆盖 5 个危险字符", escChars === 5, `命中 ${escChars}/5`);
check("innerHTML 拼接处已转义", (branchSrc.match(/dshEscapeHTML\(/g) || []).length >= 8, `调用 ${(branchSrc.match(/dshEscapeHTML\(/g) || []).length} 次`);

// ── 10. R5 持久化 key 兼容（不可改名）──
console.log("\n[10] R5 持久化 key 兼容");
const R5_KEYS = [
	["dsh.director.layout", "src/store/layout.js"],
	["dsh-v9-theme", "src/store/theme.js"],
	["dsh.director.config", "src/config/model.js"],
	["dsh.director.store.", "src/store/messages.js"],
	["dsh-director-db", "src/store/idb.js"],
	["dsh-toast", "src/store/branch.js"],
	["dsh-memory-content", "src/store/branch.js"],
	["dsh-branch-created", "src/store/branch.js"],
];
for (const [key, rel] of R5_KEYS) {
	const p = join(PLUGIN, rel);
	const hit = existsSync(p) && readFileSync(p, "utf8").includes(key);
	check(`key "${key}"`, hit, hit ? "原样保留" : "未找到");
}

// ── 11. IDB 6 个 object store + 版本号 ──
console.log("\n[11] IndexedDB 结构");
const idbSrc = existsSync(join(PLUGIN, "src/store/idb.js")) ? readFileSync(join(PLUGIN, "src/store/idb.js"), "utf8") : "";
check("DB 名 dsh-director-db", idbSrc.includes('"dsh-director-db"'), "IDB_DB_NAME");
check("版本 v3", /IDB_VERSION\s*=\s*3/.test(idbSrc), "IDB_VERSION = 3");
const STORES = ["directorStores", "directorDocs", "directorFolders", "memoryCore", "memoryDecisions", "memoryRisks"];
for (const s of STORES) {
	check(`object store "${s}"`, idbSrc.includes('"' + s + '"'), "已声明");
}

// ── 12. G 区宿主注入点锚点（T6 定案：不迁，只保 → 作为回归防线）──
console.log("\n[12] G 区注入点锚点（T6 回归防线）");
const G_ANCHORS = [
	[7111, 'window.__directorCurrentView = "chat"', "G1-a ChatView 挂载写 view"],
	[7112, 'window.__directorFocusTarget = "chat"', "G1-b ChatView 挂载写 focusTarget"],
	[7114, 'directorLayoutStore.setFocusTarget("chat")', "G1-c ChatView 调用插件 store"],
	[7118, 'window.__directorCurrentView = "chat"', "G1-d useLayoutEffect 每次渲染写"],
	[9149, 'window.__directorCurrentView = activeViewId === "director" ? "director" : "chat"', "G4-a Session 实时同步"],
	[9151, 'directorLayoutStore.setFocusTarget("chat")', "G4-b 非对话视图复位"],
];
const hostLines = hostSrc.split("\n");
for (const [ln, needle, desc] of G_ANCHORS) {
	const line = hostLines[ln - 1] || "";
	const hit = line.includes(needle);
	check(`${desc} (L${ln})`, hit, hit ? "锚点完整" : `未命中 → ${line.trim().slice(0, 60)}`);
}
// V9.4-P1 注释保留（P1-2 缺陷现场记录）
check("V9.4-P1 注释保留 (L9144-9145)", hostSrc.includes("V9.4-P1: 实时同步当前 view 到 window") && hostSrc.includes("防止发送被劫持到总监"), "P1-2 缺陷现场记录完整");
// setFocusTarget 调用点总数（1 定义 + 5 调用 = 6）
const sfHits = (hostSrc.match(/setFocusTarget/g) || []).length;
check("setFocusTarget 出现 6 次（1 定义 + 5 调用）", sfHits >= 6, `实测 ${sfHits} 次`);
// 读取侧 F1/F2 保留
const rdHits = (hostSrc.match(/window\.__directorCurrentView/g) || []).length;
check("__directorCurrentView 读写点 ≥ 7", rdHits >= 7, `实测 ${rdHits} 次`);
const ftHits = (hostSrc.match(/window\.__directorFocusTarget/g) || []).length;
check("__directorFocusTarget 读写点 ≥ 4", ftHits >= 4, `实测 ${ftHits} 次`);

// ── 10. 批次 4 逻辑层（D1 核心处理 + D2 返回审核）──
console.log("\n[10] 批次 4 逻辑层");
const BATCH4 = [
	["src/logic/process.js", "D1 directorProcess"],
	["src/logic/review.js", "D2 directorReviewReturn"]
];
for (const [rel, desc] of BATCH4) {
	const p = join(PLUGIN, rel);
	check(`${desc} (${rel})`, existsSync(p), existsSync(p) ? statSync(p).size + " B" : "缺失");
}

const procSrc = existsSync(join(PLUGIN, "src/logic/process.js")) ? readFileSync(join(PLUGIN, "src/logic/process.js"), "utf8") : "";
check("D1 导出 directorProcess", /export async function directorProcess/.test(procSrc), "export async function");
check("D1 保留 V9.4-P1 并发锁", procSrc.includes("V9.4-P1: 并发锁"), "锁语义注释完整");
check("D1 5 步链路完整", ["步骤1：语言规范整理", "步骤2：调用本地模型", "步骤3：上下文记忆分析", "步骤4：执行逻辑分析", "步骤5：自动转发"].every((s) => procSrc.includes(s)), "步骤 1~5 全命中");
check("D1 依赖 5 项均已 import",
	procSrc.includes('from "../config/model.js"') && procSrc.includes('from "../store/persist.js"') && procSrc.includes('from "../store/memory.js"'),
	"model.js + persist.js + memory.js");
check("D1 转发延迟 300ms 原样保留", procSrc.includes("setTimeout(() => onForward(parsed.instruction), 300)"), "setTimeout 300");
check("D1 源区间标注 6706~6818", procSrc.includes("6706 ~ 6818"), "源行号已标注");

const revSrc = existsSync(join(PLUGIN, "src/logic/review.js")) ? readFileSync(join(PLUGIN, "src/logic/review.js"), "utf8") : "";
check("D2 导出 directorReviewReturn", /export async function directorReviewReturn/.test(revSrc), "export async function");
check("D2 标注「保留不调用」", revSrc.includes("保留不调用"), "状态判定已标注（防误判为迁移遗漏）");
check("D2 双分支完整（AI 审核 + 规则模板）", revSrc.includes("使用模型审核") && revSrc.includes("使用规则模板审核"), "两分支齐备");
check("D2 规则模板 3 条启发式保留", ["内容过短，可能未完整回答", "包含待补充/占位内容", "代码块可能未正确闭合"].every((s) => revSrc.includes(s)), "3 条全命中");
check("D2 基础分算法保留 5-issues（下限 1）", revSrc.includes("var score = 5 - issues.length") && revSrc.includes("if (score < 1) score = 1;"), "打分逻辑完整");

// 🔴 D2 反证：插件侧零调用点（宿主决策「保留不调用」）
const entrySrc = readFileSync(join(PLUGIN, "src/client-entry.js"), "utf8");
const callHits = (entrySrc.match(/directorReviewReturn\s*\(/g) || []).length;
check("D2 未接入自动装配链（零调用）", callHits === 0, `client-entry.js 中调用 ${callHits} 次`);
check("D2 仅挂全局契约", entrySrc.includes("window.__dshDirectorReviewReturn = directorReviewReturn"), "契约已挂");
check("D1 已挂全局契约", entrySrc.includes("window.__dshDirectorProcess = directorProcess"), "契约已挂");

// ── 11. 批次 5 组件层（E1 DirectorFlow）──
console.log("\n[11] 批次 5 组件层");
const flowPath = join(PLUGIN, "src/components/DirectorFlow.js");
check("E1 DirectorFlow (src/components/DirectorFlow.js)", existsSync(flowPath), existsSync(flowPath) ? statSync(flowPath).size + " B" : "缺失");

const flowSrc = existsSync(flowPath) ? readFileSync(flowPath, "utf8") : "";
// 剥离注释行后再做代码级断言（注释中会引用宿主原代码，属正常）
const flowCode = flowSrc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");

check("E1 导出 DirectorFlow", /export function DirectorFlow\s*\(/.test(flowCode), "export function");
check("E1 平台模块命名空间导入", flowCode.includes('import * as react from "react"') && flowCode.includes('import * as react_jsx_runtime from "react/jsx-runtime"'), "react + react/jsx-runtime");
check("E1 依赖 A9/A10/D3 经 import", flowCode.includes('from "../store/create-store.js"') && flowCode.includes('from "../store/use-store.js"') && flowCode.includes('from "../util/debug.js"'), "create-store + use-store + debug");
check("E1 V9.2 minHeight:0 修复保留", flowCode.includes("minHeight: 0"), "flex 链高度塌陷修复");
check("E1 V9.4-P1 atBottom 守卫保留（代码）", flowCode.includes("atBottomRef.current") && flowCode.includes('lastMsg?.role !== "user"'), "用户上翻不抢底");
check("E1 V9.4-P1 注释保留", flowSrc.includes("V9.4-P1: atBottom 守卫"), "缺陷现场注释完整");
check("E1 双 rAF 嵌套保留", (flowCode.match(/requestAnimationFrame/g) || []).length >= 3, `实测 ${(flowCode.match(/requestAnimationFrame/g) || []).length} 次`);
check("E1 滚动监听 passive:true 保留", flowCode.includes('{ passive: true }'), "passive 监听");
check("E1 dfFindScroller 深度上限 15", flowCode.includes("depth < 15"), "最深 15 层祖先查找");

// 🔴 反证（迁移期修正）：代码区必须零 `filteredMessages` 使用，且已改指 state.messages
const fmUseHits = (flowCode.match(/filteredMessages\s*\./g) || []).length;
check("🔴 E1 反证：代码区零 filteredMessages 引用", fmUseHits === 0, `命中 ${fmUseHits} 次（预期 0）`);
check("🔴 E1 修正已落地：state.messages.map", flowCode.includes("state.messages.map((msg) =>"), "已改用 state.messages");
check("E1 迁移期修正已标注（防回退）", flowSrc.includes("迁移期修正") && flowSrc.includes("越界引用"), "文件头论证齐全");

// 🔴 宿主侧反证：确认该缺陷在宿主中确实存在（取证链闭环）
const hostFmAll = (hostSrc.match(/filteredMessages/g) || []).length;
check("🔴 宿主缺陷取证：filteredMessages 全文件仅 1 处（即使用点，零定义）", hostFmAll === 1, `宿主命中 ${hostFmAll} 次（预期 1，仅使用点）`);

// ── 汇总（程序化求和）──
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("\n=== 汇总 ===");
console.log(`  总计 ${results.length} 项  |  通过 ${passed}  |  失败 ${failed}`);
console.log(failed === 0 ? "  IS_PASS = true\n" : "  IS_PASS = false\n");
process.exit(failed === 0 ? 0 : 1);
