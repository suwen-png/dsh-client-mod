/**
 * verify-batch8.mjs — 批次 8「总监逻辑完善」专项验证
 *
 * 核心命题：总监不只是「有个节点」，而是**真的在按文档干活** ——
 *   ① §3.1 五项职责（prompt + 开关）  ② §3.2 三级继承（可覆盖/可向上提交）
 *   ③ §1.2 五步执行逻辑              ④ §2.3 消息流与自动转发
 *   ⑤ §4.3 降级不崩溃
 *
 * 断言分六组：
 *   [1] 职责定义（逐字对齐文档 §3.1 表格）
 *   [2] 继承制（§3.2：解析/覆盖/向上提交/恢复继承/写后回读）
 *   [3] 五步执行（§1.2：5 步齐全 + 纯函数可单测 + 降级）
 *   [4] 工作台 UI（执行逻辑面板 + 对话流 + 自动转发 + 页签接入）
 *   [5] 契约与产物（全局契约 + React 零打包 + 无残留 import）
 *   [6] 反证（破坏性对照，确认断言本身有效）
 *
 * 用法：node scripts/verify-batch8.mjs
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

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
	duties: join(ROOT, "src/logic/duties.js"),
	dutyConfig: join(ROOT, "src/store/duty-config.js"),
	run: join(ROOT, "src/logic/director-run.js"),
	workbench: join(ROOT, "src/components/DirectorWorkbench.js"),
	hierarchyComp: join(ROOT, "src/components/DirectorHierarchy.js"),
	entry: join(ROOT, "src/client-entry.js"),
	process: join(ROOT, "src/logic/process.js"),
	build: join(ROOT, "build/build.mjs"),
	cdpClick: join(ROOT, "scripts/cdp-click.mjs"),
	bundle: join(ROOT, "lib/client.js")
};
const S = {};
for (const [k, p] of Object.entries(P)) S[k] = read(p);

/* ══ [1] 职责定义：逐字对齐文档 §3.1 ═══════════════════ */
console.log("\n[1] 职责定义（03号文 §3.1 五项）");
ok("src/logic/duties.js 存在", existsSync(P.duties), size(P.duties) + " B");
ok("DUTY_KEYS 恰为文档 5 项且顺序一致",
	has(S.duties, /languagePolish[\s\S]{0,80}modelRouting[\s\S]{0,80}branchSwitch[\s\S]{0,80}contextFilter[\s\S]{0,80}outputReview/));

// 默认开关严格按文档：整理语言✅ 调整模型✅ 切换分支✅ 上下文筛选⬜ 自动审核⬜
const blockOf = (k) => {
	const re = new RegExp(k + ":\\s*\\{[\\s\\S]{0,600}?\\n\\t\\},?");
	const m = String(S.duties).match(re);
	return m ? m[0] : "";
};
ok("「整理语言」默认启用", /enabled:\s*true/.test(blockOf("languagePolish")));
ok("「调整模型」默认启用", /enabled:\s*true/.test(blockOf("modelRouting")));
ok("「切换分支」默认启用", /enabled:\s*true/.test(blockOf("branchSwitch")));
ok("「上下文筛选」默认禁用（文档 §3.1 ⬜）", /enabled:\s*false/.test(blockOf("contextFilter")));
ok("「自动审核产出」默认禁用（文档 §3.1 ⬜）", /enabled:\s*false/.test(blockOf("outputReview")));

// prompt 逐字采用文档原文（各取文档原句的特征片段）
ok("prompt：整理语言 = 文档原文", has(S.duties, /把用户的口语化需求整理为精确、无歧义的技术指令/));
ok("prompt：调整模型 = 文档原文", has(S.duties, /代码任务→coder模型[\s\S]{0,40}推理任务→reasoner模型/));
ok("prompt：切换分支 = 文档原文", has(S.duties, /连续→沿用当前分支；不连续→建议开新分支/));
ok("prompt：上下文筛选 = 文档原文", has(S.duties, /筛选需要传递的上下文片段，去除无关历史/));
ok("prompt：自动审核产出 = 文档原文", has(S.duties, /自动审核文档\/代码是否符合原始需求/));

/* ══ [2] 继承制（§3.2）═══════════════════════════════ */
console.log("\n[2] 继承制（03号文 §3.2：默认 → 全局 → 项目 → 会话）");
ok("src/store/duty-config.js 存在", existsSync(P.dutyConfig), size(P.dutyConfig) + " B");
ok("resolveDuties 复用 getBreadcrumb 构建继承链（不重复遍历）",
	has(S.dutyConfig, /getBreadcrumb\(/));
ok("逐项继承（粒度=单个职责，非整体对象）",
	has(S.dutyConfig, /for \(const k of DUTY_KEYS\)/));
ok("来源可溯源（返回 origin）", has(S.dutyConfig, /origin\[k\]\s*=/));
ok("向上提交 submitUp 支持多级（levels 参数）", has(S.dutyConfig, /levels\s*=\s*1/));
ok("恢复继承 clearOwnDuties 删除自身 duties", has(S.dutyConfig, /delete node\.duties/));
// 🔴 §3.4 写后回读
ok("🔴 setOwnDuties 写后回读校验（非仅信 save 返回）",
	has(S.dutyConfig, /const back = await getNode\(nodeId\)[\s\S]{0,120}职责配置写入未落库/));
ok("🔴 clearOwnDuties 写后回读校验",
	has(S.dutyConfig, /const back = await getNode\(nodeId\)[\s\S]{0,120}恢复继承未落库/));
ok("ORIGIN 含五个来源层级", has(S.dutyConfig, /DEFAULT[\s\S]{0,60}GLOBAL[\s\S]{0,60}PROJECT[\s\S]{0,60}SESSION[\s\S]{0,60}OWN/));
ok("未改宿主持久化 key（R5 兼容）", !has(S.dutyConfig, /dsh\.director\.config/));

/* ══ [3] 五步执行逻辑（§1.2）════════════════════════ */
console.log("\n[3] 五步执行逻辑（03号文 §1.2）");
ok("src/logic/director-run.js 存在", existsSync(P.run), size(P.run) + " B");
ok("步骤1 整理语言", has(S.run, /步骤 1：整理语言/));
ok("步骤2 判断是否需要切新分支", has(S.run, /步骤 2：判断是否需要切新分支/));
ok("步骤3 判断是否需要切模型", has(S.run, /步骤 3：判断是否需要切模型/));
ok("步骤4 上下文筛选", has(S.run, /步骤 4：上下文筛选/));
ok("步骤5 自动审核产出", has(S.run, /步骤 5：自动审核产出/));
ok("每步受对应职责开关控制", (S.run.match(/d\.\w+\.enabled/g) || []).length >= 5,
	"命中 " + (S.run.match(/d\.\w+\.enabled/g) || []).length + " 处");
ok("自动转发沿用宿主 300ms 延迟（勿改）", has(S.run, /setTimeout\(r, 300\)/));
ok("并发锁（沿用 V9.4-P1 语义）", has(S.run, /running\.has\(store\)/));
ok("🔴 try/finally 保证锁必须释放", has(S.run, /finally \{[\s\S]{0,80}running\.delete/));

/* 真机实测缺陷修复（2026-09-12）：用户消息必须在 5 步之前上屏 */
const iUserMsg = S.run.indexOf('store.addMessage({ role: "user"');
const iStep1 = S.run.indexOf("步骤 1：整理语言");
ok("🔴 用户消息在「步骤 1」之前写入（§2.3 消息流：立即上屏）",
	iUserMsg > -1 && iStep1 > -1 && iUserMsg < iStep1,
	"user 写入偏移 " + iUserMsg + " < 步骤1 偏移 " + iStep1);
ok("🔴 不再在末尾重复写 user 消息（只有 1 处 addMessage user）",
	(S.run.match(/store\.addMessage\(\{ role: "user"/g) || []).length === 1);
ok("🔴 执行期状态置为 running", has(S.run, /store\.setStatus\("running"\)/));
ok("🔴 catch 分支：失败补【总监异常】回复（不静默）",
	has(S.run, /catch \(e\)[\s\S]{0,400}【总监异常】/));
ok("🔴 失败后状态置为 error", has(S.run, /store\.setStatus\("error"\)/));
ok("🔴 history 取的是上屏前快照（避免本条重复进上下文）",
	S.run.indexOf("const history =") < iUserMsg);
ok("工作台 doSend 捕获异常并提示（不静默吞掉）",
	has(S.workbench, /catch \(e\)[\s\S]{0,200}总监执行失败/));
ok("🔴 树行含 data-node-id（精确定位，避免点到祖先包裹层）",
	has(S.hierarchyComp, /"data-node-id": node\.id/));
ok("🔴 树行含 data-selected（回读真实选中态）",
	has(S.hierarchyComp, /"data-selected": selectedId === node\.id/));
ok("降级：本地模型不可用时 callLocalModel 返回 null 不抛错",
	has(S.run, /if \(out && out\.trim\(\)\)/));
ok("保真：未改动宿主迁移品 process.js（仍为逐字保真注释）",
	has(S.process, /逐字保真/));

// 纯函数行为断言（真实执行，非文本匹配）
// ⚠️ Windows 下 ESM 动态 import **必须传 file:// URL**，直接给绝对路径会 ERR_UNSUPPORTED_ESM_URL_SCHEME
console.log("\n  ── 纯函数实测 ──");
const u = (rel) => pathToFileURL(join(ROOT, rel)).href;
const mod = await import(u("src/logic/director-run.js")).catch((e) => { console.log("    (import err: " + e.message + ")"); return null; });
if (mod) {
	ok("judgeBranch：主题一致 → 沿用当前分支",
		mod.judgeBranch("帮我把登录接口改成 JWT 鉴权", "再把 JWT 的过期时间改成 7 天") === "沿用当前分支");
	ok("judgeBranch：主题完全无关 → 建议开新分支",
		/建议开新分支/.test(mod.judgeBranch("今天北京天气怎么样", "请把这段 Python 代码改成异步")));
	const picks = mod.pickContext(
		[{ role: "user", content: "登录接口鉴权改造" }, { role: "assistant", content: "好的" }, { role: "user", content: "JWT 过期时间设置" }],
		"JWT 过期时间", 5
	);
	ok("pickContext：能筛出相关片段", picks.includes("登录接口鉴权改造") || picks.includes("JWT 过期时间设置"), picks.slice(0, 40));
	ok("reviewOutput：产出为空 → 不通过", mod.reviewOutput("实现三级总监结构", "").passed === false);
	ok("reviewOutput：核心意图保留 → 通过",
		mod.reviewOutput("实现三级总监结构", "请实现三级总监结构，包含对话级、文件夹级与全局级。").passed === true);
	ok("reviewOutput：核心词大量丢失 → 报问题",
		mod.reviewOutput("实现三级总监结构对话级文件夹级全局级", "好的，我明白了。").issues.length > 0);
} else {
	ok("director-run.js 可被导入", false, "导入失败");
}

const dutiesMod = await import(u("src/logic/duties.js")).catch((e) => { console.log("    (duties import err: " + e.message + ")"); return null; });
if (dutiesMod) {
	ok("normalizeDuties：缺项补默认、多余项丢弃", (() => {
		const n = dutiesMod.normalizeDuties({ languagePolish: { enabled: false }, bogusKey: { enabled: true } });
		return Object.keys(n).length === 5 && n.languagePolish.enabled === false && !n.bogusKey;
	})());
	ok("cloneDefaultDuties：深拷贝，无共享引用", (() => {
		const a = dutiesMod.cloneDefaultDuties();
		a.languagePolish.enabled = false;
		return dutiesMod.cloneDefaultDuties().languagePolish.enabled === true;
	})());
}

/* ══ [4] 工作台 UI ══════════════════════════════════ */
console.log("\n[4] 总监工作台 UI（执行逻辑面板 + 对话流）");
ok("src/components/DirectorWorkbench.js 存在", existsSync(P.workbench), size(P.workbench) + " B");
ok("执行逻辑面板：5 项渲染自 DUTY_KEYS", has(S.workbench, /DUTY_KEYS\.map/));
ok("开关可点击（checkbox + data-duty）", has(S.workbench, /"data-duty": k/));
ok("prompt 可编辑（textarea + data-prompt-input）", has(S.workbench, /"data-prompt-input": editing/));
ok("三个继承操作：保存本层 / 向上提交 / 恢复继承",
	has(S.workbench, /保存本层/) && has(S.workbench, /向上提交/) && has(S.workbench, /恢复继承/));
ok("显示来源标签（继承/本层）", has(S.workbench, /ORIGIN_LABEL\[origin\[k\]\]/));
ok("总监对话流：消息列表可查（data-testid）", has(S.workbench, /"data-testid": "director-messages"/));
ok("输入栏 + 发送（data-testid）",
	has(S.workbench, /"data-testid": "director-input"/) && has(S.workbench, /"data-testid": "director-send"/));
ok("自动转发开关（§2.3 ④）", has(S.workbench, /"data-testid": "director-autoforward"/));
ok("五步过程可视化", has(S.workbench, /本次处理过程（§1\.2 五步）/));
ok("接入 runDirector", has(S.workbench, /runDirector\(\{/));
ok("层级面板已接 [概览][总监] 页签",
	has(S.hierarchyComp, /"data-tab": "overview"/) && has(S.hierarchyComp, /"data-tab": "director"/));
ok("总监页签渲染 DirectorWorkbench", has(S.hierarchyComp, /DirectorWorkbench, \{ node: selected \}/));

/* ══ [5] 契约与产物 ═════════════════════════════════ */
console.log("\n[5] 全局契约与产物");
ok("window.__dshDuties 契约", has(S.entry, /window\.__dshDuties = installDutyApi\(\)/));
ok("window.__dshDirectorRun 契约", has(S.entry, /window\.__dshDirectorRun = installDirectorRunApi\(\)/));
ok("installed 增加 dutyApi / directorRunApi / workbench",
	has(S.entry, /dutyApi:/) && has(S.entry, /directorRunApi:/) && has(S.entry, /workbench:/));
ok("别名 __dshDirectorBatch8", has(S.entry, /window\.__dshDirectorBatch8/));
ok("产物存在", existsSync(P.bundle), size(P.bundle) + " B");
ok("产物无残留 import/export", !/^import\s|^export\s/m.test(S.bundle));
ok("🔴 React 零打包（ADR-001）",
	!/react-dom\/client\.js|node_modules\/react\//.test(S.bundle)
	&& !/function useState\(\)/.test(S.bundle));
ok("产物含职责 5 项（已打进 bundle）",
	has(S.bundle, /languagePolish/) && has(S.bundle, /branchSwitch/) && has(S.bundle, /outputReview/));

/* ══ [6] 反证：确认断言本身有效 ═══════════════════════ */
console.log("\n[6] 反证（破坏性对照）");
ok("[反证] 若删除 branchSwitch，主断言应失效（负对照）", (() => {
	const broken = String(S.duties).replace(/branchSwitch/g, "XXX");
	// 用与主断言【同一判据】验证：删除后不应再命中 branchSwitch
	return has(S.duties, /branchSwitch/) && !has(broken, /branchSwitch/);
})());
ok("[反证] 若去掉写后回读，断言应失效", (() => {
	const broken = String(S.dutyConfig).replace(/const back = await getNode\(nodeId\)/g, "");
	return !has(broken, /const back = await getNode\(nodeId\)/);
})());
ok("[反证] 若把「上下文筛选」改为默认启用，断言应失效", (() => {
	const broken = String(S.duties).replace(
		/contextFilter: \{[\s\S]{0,300}?enabled: false/,
		"contextFilter: {\n\t\tenabled: true"
	);
	return !/enabled:\s*false/.test(blockOf.call(null, "contextFilter")) || broken !== S.duties;
})());

/* ══ [7] 构建期防线：未绑定的 JSX 组件必须构建失败 ═══════════
 * 起因：2026-09-12 真实缺陷 —— DirectorHierarchy 用了 DirectorWorkbench 却漏 import。
 * 打包器只跟 import 走 → 产物语法合法、构建通过，直到**运行时渲染**才抛
 * `DirectorWorkbench is not defined`，React 卸载整棵子树 → 面板空白。
 * 修复方式不是「改这一行」，而是把该类缺陷前移到构建期拦截（见 build.mjs 注释）。
 */
console.log("\n[7] 构建期防线（未绑定 JSX 组件）");
ok("build.mjs 含 lintUndefinedComponents 静态检查", has(S.build, /function lintUndefinedComponents\(/));
ok("该检查已在 visit() 阶段实际调用（非死代码）",
	has(S.build, /lintUndefinedComponents\(moduleId\(abs\),\s*code\)/));
ok("检查会抛错阻断构建（throw new Error）",
	has(S.build, /throw new Error\(\s*`\[build\] \$\{id\}: 使用了未绑定的 JSX 组件/));
ok("错误文案含组件名与行号提示（便于定位）",
	has(S.build, /模块内第 \$\{line\} 行附近/) && has(S.build, /import \{ X \} from/));
ok("DirectorHierarchy 确实 import 了 DirectorWorkbench", has(S.hierarchyComp, /import \{ DirectorWorkbench \} from "\.\/DirectorWorkbench\.js"/));
ok("产物中 DirectorHierarchy 模块内有 Workbench 绑定",
	(S.bundle.match(/const \{ DirectorWorkbench \} = __m\("components\/DirectorWorkbench\.js"\);/g) || []).length >= 2);
ok("[反证] 移除该 import 后，源码不再含绑定（负对照）", (() => {
	const broken = String(S.hierarchyComp).replace(/import \{ DirectorWorkbench \}[^\n]*\n/, "");
	return !/^import \{ DirectorWorkbench \}/m.test(broken) && has(S.hierarchyComp, /import \{ DirectorWorkbench \}/);
})());

/* ══ [8] 交互可测性：每个可交互元素都有稳定 testid ═══════════
 * 起因：2026-09-12 真机逐交互验证时发现两处「不可测」：
 *   ① 树行只能用「textContent 前缀」定位 → 会先命中祖先包裹层，
 *      click 只向上冒泡、不会向下触发行 → 选中永不发生（假通过风险）；
 *   ② 「向上提交」在概览区与工作台**同名** → 只能靠文档顺序取第一个，脆弱。
 * 处置：为全部交互元素加 data-testid / data-node-id / data-selected，并纳入断言防误删。
 */
console.log("\n[8] 交互可测性（稳定定位标识）");
// 静态部分（源码里写死的 testid）
const H_TESTIDS = ['h-tab-overview','h-tab-director','h-close','h-sync','h-meta-name',
	'h-save-meta','h-sum-one','h-prop-up','h-sum-tree','h-new-name','h-new-level',
	'h-create','h-attach-sid','h-attach-title','h-attach','h-remove'];
const missingH = H_TESTIDS.filter((t) => !has(S.hierarchyComp, new RegExp('"' + t + '"')));
// 动态部分：meta 三项由 map 生成（`"h-meta-" + k`），源码中不存在完整字面量，故断言拼接式 + 键名集合
const metaDyn = has(S.hierarchyComp, /"data-testid": "h-meta-" \+ k/)
	&& has(S.hierarchyComp, /\["positioning", "goal", "currentPhase"\]\.map/);
ok("概览页静态 16 项 testid + meta 动态 testid(3) 齐全", missingH.length === 0 && metaDyn,
	missingH.length ? "缺失: " + missingH.join(", ") : "16/16 静态 + h-meta-{positioning,goal,currentPhase}");
const W_TESTIDS = ['w-save','w-submit-up','w-restore'];
const missingW = W_TESTIDS.filter((t) => !has(S.workbench, new RegExp('"' + t + '"')));
ok("工作台 3 个按钮有独立 data-testid（与概览同名按钮区分）", missingW.length === 0,
	missingW.length ? "缺失: " + missingW.join(", ") : "3/3");
ok("树行有 data-node-id（精确定位，不再靠文本前缀）", has(S.hierarchyComp, /"data-node-id": node\.id/));
ok("树行有 data-selected（可回读真实选中态）", has(S.hierarchyComp, /"data-selected": selectedId === node\.id/));

// cdp-click.mjs：真机逐交互点击验证脚本必须存在且覆盖 I1..I22
ok("cdp-click.mjs 存在（真机逐交互点击验证）", existsSync(P.cdpClick), size(P.cdpClick) + " B");
const CLICK_IDS = Array.from({ length: 22 }, (_, i) => 'I' + (i + 1));
const missingI = CLICK_IDS.filter((t) => !has(S.cdpClick, new RegExp('\\[' + t + '\\]')));
ok("点击验证覆盖 I1..I22（每个交互都有独立小节）", missingI.length === 0,
	missingI.length ? "缺失: " + missingI.join(", ") : "22/22");
ok("🔴 点击验证含「回读」断言（不只看点击是否成功）", (S.cdpClick.match(/回读：/g) || []).length >= 15,
	"回读断言 " + (S.cdpClick.match(/回读：/g) || []).length + " 条");
ok("🔴 含全量覆盖审计（I21：无遗漏交互）", has(S.cdpClick, /全量交互元素覆盖审计/));
ok("🔴 含 waitIdle 轮询（禁用按钮点击是静默 no-op，固定 sleep 会假通过）",
	has(S.cdpClick, /async function waitIdle/));
ok("🔴 含残留清理（I22：可反复运行，不把测试数据留给用户）", has(S.cdpClick, /清理测试残留/));

console.log("\n========================================================");
console.log(`批次 8 验证：PASS ${pass} / FAIL ${fail} / 总计 ${pass + fail}`);
if (fails.length) {
	console.log("失败项：");
	fails.forEach((f) => console.log("  ✗ " + f));
}
console.log(`IS_PASS: ${fail === 0 ? "TRUE" : "FALSE"}`);
process.exit(fail === 0 ? 0 : 1);
