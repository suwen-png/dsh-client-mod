/**
 * verify-batch1.mjs — 批次 1 迁移验证（A14 剥离 + 插件模块完整性）
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

console.log("\n=== 批次 1 验证 ===\n");

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
	["src/store/docs-index-inject.js", "A13+A14 注入壳"],
	["src/client-entry.js", "插件入口"],
	["src/index.js", "骨架导航表"],
];
for (const [rel, desc] of EXPECTED) {
	const p = join(PLUGIN, rel);
	check(`${desc} (${rel})`, existsSync(p), existsSync(p) ? statSync(p).size + " B" : "缺失");
}

// ── 6. 全局契约（window 挂载）在插件源码中存在 ──
console.log("\n[6] 全局契约");
const CONTRACTS = ["__dshDebug", "__dshV9Log", "__directorLayoutStore", "__dshTheme", "__directorConfig", "__dshCheckOllama", "__dshDocsIndex"];
for (const key of CONTRACTS) {
	const hit = [...EXPECTED.map((e) => e[0]), "src/bridge/spike-fs-probe.js"]
		.map((rel) => join(PLUGIN, rel))
		.filter(existsSync)
		.some((p) => readFileSync(p, "utf8").includes("window." + key));
	check(`契约 window.${key}`, hit, hit ? "已在插件侧写入" : "未找到");
}

// ── 汇总（程序化求和）──
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log("\n=== 汇总 ===");
console.log(`  总计 ${results.length} 项  |  通过 ${passed}  |  失败 ${failed}`);
console.log(failed === 0 ? "  IS_PASS = true\n" : "  IS_PASS = false\n");
process.exit(failed === 0 ? 0 : 1);
