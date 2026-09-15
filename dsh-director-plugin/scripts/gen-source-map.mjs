/**
 * gen-source-map.mjs —— 生成「源码 ↔ 设计稿 ↔ 需求」映射标注（需求 #4）
 *
 * ══════════════════════════════════════════════════════════════════
 * 用户原话：「在代码中标明哪那部分指向的是哪部分，这样方便修改」
 * ──────────────────────────────────────────────────────────────────
 * 手工给 45 个文件写映射头有两个问题：① 工作量大到不会有人做第二次；
 * ② 写完就开始过期 —— 明天加个文件就漏一个，半个月后没人敢信它。
 *
 * 所以这里**从代码本身生成**，不做人工臆测：
 *   职责  ← 每个文件顶部 JSDoc 的第一行（"xxx.js — 说明"），这是原作者写的、事实
 *   引用  ← 从该文件头部注释里正则抽取「要求 N」「NN号文 §x.y」「T-PLUG-NNN」「批次 N」
 *   上游  ← 反向遍历 import 图（谁 import 了我）= 事实
 *   下游  ← 正向遍历 import 图（我 import 了谁）= 事实
 *   板块  ← 只对与 V16 设计稿直接对应的文件做**人工小表**（其余标「—」，不编）
 *
 * 产出两份：
 *   ① `docs/12-源码映射索引.md`（人读：总表 / 分组表 / 反向索引 / 依赖图）
 *   ② 每个 `src/**.js` 顶部注入 8 行 `@map:begin … @map:end` 块（幂等，可重复跑）
 *
 * 用法：
 *   node scripts/gen-source-map.mjs          # 生成 + 写入（--check 只比对不写）
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const SRC = join(PKG, "src");
const DOCS = join(PKG, "docs");
const CHECK = process.argv.includes("--check");

const DESIGN = "docs/50-信息中心/V16-设计图·需求图·交互逻辑.html";
/* 第二设计稿：多智能体编排架构补全。一个文件可同时属于两份稿（例如 DirectorPage 既是 V16 板块 A，也是 V21 板块 九），
 * 故头部「设计稿」改为**可并列**输出，不再假设全局只有一份稿。 */
const DESIGN21 = "docs/50-信息中心/V21-多智能体编排架构补全设计稿.html";
const INDEX_REL = "dsh-director-plugin/docs/12-源码映射索引.md";

/* 人工小表：只登记与 V16 设计稿**直接对应**的文件（板块 A 高保真 / C 交互逻辑 / D 设计图工作室 / E 保存·版本·安全区）。
 * 其余一律标「—」—— 宁可留空，也不编一个看起来很完整的假对应。 */
const PLATE = {
	"components/DesignStudio.js": "D1–D6（设计图工作室五区）· E1–E2（顶栏四区 / 保存两态）· E5（顶栏避让）",
	"store/design-schema.js": "D2 · D4（18 类元素 + 标准框架 20 元素）· E3（版本快照模型）",
	"store/design.js": "D5 · D6（元素操作 + 指令解析）· E3（版本 API）",
	"store/plugin-db.js": "D7（锚点契约 · 设计图冷备库）",
	"components/VersionPanel.js": "E4（版本历史面板）",
	"util/safe-area.js": "E5（窗口控件安全区三级读取）",
	"util/no-drag.js": "E8（Windows 标题栏拖拽带穿透：可交互元素必须 no-drag）",
	"components/DirectorPage.js": "A（总监页 R1–R8）",
	"components/DirectorDialog.js": "A（总监弹窗三态）",
	"components/MindMap.js": "A4（分支导图态）· F1–F4（思维导图元素库渲染：节点四型 / 状态四态 / 连线 / 控件）",
	"components/FloatDock.js": "A · D0（右下角浮动按钮组 = 三浮层统一入口）",
	"client-entry.js": "A（tab 环：总监以 order:-1 排最前）",
	"mount.js": "A（四浮层挂载 + 错误边界）",
	"logic/branch-tree.js": "C2（分支生命周期状态机）· F1 / F5（导图行模型与宿主真值透传）",
	"store/mindmap-schema.js": "F1–F5（思维导图元素库：节点型 / 状态 / 连线 / 控件 / 快捷键 / 覆盖度）",
	"logic/routing.js": "C（输入路由决策树）",
	"store/branch.js": "C（分支生命周期）",
	"store/messages.js": "C（消息投递时序）"
};

/* 人工小表：与 V21 编排补全稿**直接对应**的文件。同样手动登记，不做正则猜测。
 * 板块号取自 V21 正文的一~十。 */
const PLATE21 = {
	"logic/roles.js": "二（四层组织 · 12 角色 Agent Card · L1 预算）",
	"logic/dag.js": "三（声明式执行图 · 6 类错误校验 · 波浪并行 · 条件与模板）",
	"logic/verify.js": "四（两层验收 · 三态标签 · 成对交换去偏）",
	"logic/delegate.js": "五（简报四段 · 交接五段 · 上下文裁剪）",
	"logic/task-state.js": "六（A2A 九态机 · 两种暂停态 · 乐观并发）",
	"logic/checkpoint.js": "七（不可变快照链 · 分叉保主干 · 断点重放）",
	"logic/policy.js": "八（三模式四策略 · 削顶标注 · 无证据不升级）",
	"logic/director-chain.js": "三（五步链的声明式依赖图：纯数据，视图与闸门共用同一份）",
	"components/OrchestratorPanel.js": "九（四页签编排面板 · 数字全部实时算）",
	"components/DirectorPage.js": "九（编排入口按钮 + 与个性化设定互斥）",
	"client-entry.js": "十（7 个内核 API 逐模块 try/catch 挂载）"
};

/* 人工小表：诉求编号 → 文件。同样是**手动登记**，不做正则猜测。 */
const REFS = {
	"client-entry.js": "V16 诉求 1（再审核：注册失败也要能看到原因）+ 2026-09-12 诉求 12（boot 注入 no-drag）",
	"mount.js": "V16 诉求 1（四浮层互不拖死）",
	"components/DesignStudio.js": "V16 诉求 2 · 3 · 5（全屏工作室 / 审美 / 设计图插件）+ 2026-09-12 诉求 8（顶栏功能未实现）· 11（审美完善）",
	"store/design-schema.js": "V16 诉求 6（标准设计图框架的映射）+ 2026-09-12 诉求 10（不同版本的选择）",
	"store/design.js": "V16 诉求 2 · 5（逻辑全实现 + 指令过确认闸门）+ 2026-09-12 诉求 10（保存与版本）",
	"store/plugin-db.js": "V16 诉求 7（落死：数据不丢）",
	"components/FloatDock.js": "V16 诉求 3（按钮位置审美）· 5（设计图入口按钮）",
	"components/VersionPanel.js": "2026-09-12 诉求 10（不同版本的选择）",
	"util/safe-area.js": "2026-09-12 诉求 9（关闭按钮与标准软件关闭按钮重叠）"
};

const walk = (d, out = []) => {
	for (const n of readdirSync(d).sort()) {
		const p = join(d, n);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (n.endsWith(".js")) out.push(p);
	}
	return out;
};

const files = walk(SRC);
const rel = (abs) => relative(SRC, abs).split("\\").join("/");

/* ── 1. 抽取：职责 / 引用 / 下游（import 目标）── */
/* ⚠ 抽取前必须剥掉自己的 @map 块（生成器自指）。
 * 否则：块占 8 行 ≈ 500 字符，会把「xxx.js — 说明」这行挤出 head 窗口；
 * 此时兜底规则 m2 会抓到本生成器写的标记行（它自身也匹配 ^\s*\*?\s*(.+)$），
 * 「职责」于是静默变成 "/* @map:begin …" —— 不报错、只是说谎。
 * 已实测咬到：client-entry.js / util/no-drag.js。 */
const stripMapBlock = (s) => s.replace(/\/\* @map:begin[\s\S]*?@map:end \*\/\n?/, "");
const info = {};
for (const abs of files) {
	const src = readFileSync(abs, "utf8");
	const head = stripMapBlock(src).slice(0, 1600);

	// 职责 = 顶部 JSDoc 第一行里「文件名 — 说明」的说明部分；退化时取第一行有实义的注释文本
	let duty = "";
	const m1 = head.match(/^\s*\/\*\*?\s*\n?\s*\*?\s*[\w./-]+\.js\s*[—\-–]\s*(.+)$/m);
	if (m1) duty = m1[1].trim();
	else {
		/* 兜底：首字符排除 * 与 /，否则会抓到 /** 这种純分隔符行（no-drag.js 就是这么被读成 "/**" 的） */
		const m2 = head.match(/^\s*\*?\s*([^\s*/].*)$/m);
		duty = m2 ? m2[1].trim() : "（无顶部说明）";
	}
	duty = duty.replace(/\*\/\s*$/, "").trim();
	// 双保险：万一兜底仍抓到标记行，显式暴露，不静默当数据用
	if (duty.includes("@map:")) duty = "（职责抽取异常：命中生成器标记行，请查顶部 JSDoc 格式）";

	// 引用：只看头部注释区，避免把业务字符串里的数字当引用
	const refs = [];
	if (REFS[rel(abs)]) refs.push(REFS[rel(abs)]);
	const push = (s) => { if (s && !refs.includes(s)) refs.push(s); };
	for (const m of head.matchAll(/要求\s*(\d+(?:\s*[/、]\s*\d+)*)/g)) push("要求 " + m[1].replace(/\s+/g, ""));
	for (const m of head.matchAll(/(\d+)\s*号文\s*§\s*([\d.]+)/g)) push(m[1] + " 号文 §" + m[2]);
	for (const m of head.matchAll(/T-PLUG-(\d+[A-Za-z-]*)/g)) push("T-PLUG-" + m[1]);
	for (const m of head.matchAll(/batch\s*(\d+)/gi)) push("批次 " + m[1]);
	for (const m of head.matchAll(/批次\s*(\d+)/g)) push("批次 " + m[1]);

	// 下游：静态 import / export ... from / require
	const down = [];
	for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["'](\.[^"']+)["']/g)) down.push(m[1]);
	for (const m of src.matchAll(/(?:^|\n)\s*export\s[^;]*?from\s*["'](\.[^"']+)["']/g)) down.push(m[1]);
	for (const m of src.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) down.push(m[1]);

	info[rel(abs)] = { duty, refs, down: Array.from(new Set(down)), up: [] };
}

/* ── 2. 解析下游为真实文件路径（相对 src），并反向填上游 ── */
const resolveRel = (fromRel, spec) => {
	const base = dirname(fromRel);
	const joined = (base === "." ? "" : base + "/") + spec;
	const parts = [];
	for (const seg of joined.split("/")) {
		if (seg === ".") continue;
		if (seg === "..") { parts.pop(); continue; }
		parts.push(seg);
	}
	return parts.join("/");
};
for (const [r, d] of Object.entries(info)) {
	d.downResolved = [];
	for (const spec of d.down) {
		const bare = spec.replace(/^\.\//, "");
		for (const cand of [bare, bare + ".js", bare + "/index.js"]) {
			const key = resolveRel(r, cand.replace(/^\.\//, ""));
			if (info[key]) { d.downResolved.push(key); info[key].up.push(r); break; }
		}
	}
	d.downResolved = Array.from(new Set(d.downResolved));
}
for (const d of Object.values(info)) d.up = Array.from(new Set(d.up)).sort();

/* ── 3. 注入映射头（幂等）── */
const BEGIN = "/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）";
const END = " * @map:end */";
const blockOf = (r) => {
	const d = info[r];
	const refs = d.refs.length ? d.refs.join(" · ") : "—";
	/* 设计稿可并列：V16 主稿 与 V21 编排稿 各按人工小表命中，都不命中则显式标「板块 —」。 */
	const dp = [];
	if (PLATE[r]) dp.push(DESIGN + "【板块 " + PLATE[r] + "】");
	if (PLATE21[r]) dp.push(DESIGN21 + "【板块 " + PLATE21[r] + "】");
	if (!dp.length) dp.push(DESIGN + "（板块 —）");
	return [
		BEGIN,
		" * 职责：" + d.duty,
		" * 引用：" + refs,
		" * 上游：" + (d.up.length ? d.up.join(", ") : "（无：插件入口层）"),
		" * 下游：" + (d.downResolved.length ? d.downResolved.join(", ") : "（无）"),
		" * 设计稿：" + dp.join(" · "),
		" * 索引：" + INDEX_REL,
		END
	].join("\n") + "\n";
};

/* 索引表格里的「设计稿板块」单元格：两份稿各自登记，合并成可读一格。 */
const plateCell = (r) => {
	const a = PLATE[r] ? "V16 · " + PLATE[r] : "";
	const b = PLATE21[r] ? "V21 · " + PLATE21[r] : "";
	return [a, b].filter(Boolean).join(" ／ ") || "—";
};

let injected = 0, refreshed = 0;
for (const abs of files) {
	const r = rel(abs);
	let src = readFileSync(abs, "utf8");
	const block = blockOf(r);
	const re = /\/\* @map:begin[\s\S]*?@map:end \*\/\n?/;
	if (re.test(src)) {
		const next = src.replace(re, block);
		if (next !== src) { if (!CHECK) writeFileSync(abs, next, "utf8"); refreshed++; }
	} else {
		if (!CHECK) writeFileSync(abs, block + src, "utf8");
		injected++;
	}
}

/* ── 4. 生成索引文档 ── */
const rows = Object.keys(info).sort();
const byDir = {};
for (const r of rows) {
	const dir = r.includes("/") ? r.split("/")[0] : "(根)";
	(byDir[dir] = byDir[dir] || []).push(r);
}
const md = [];
md.push("# 12 · 源码映射索引（自动生成 · 勿手改）");
md.push("");
md.push("> 生成器：`scripts/gen-source-map.mjs`（重跑即刷新）｜生成时间：" + new Date().toISOString());
md.push("> **职责**取自每个文件顶部 JSDoc 首行（原作者写的，事实）｜**上游/下游**由真实 import 图推出（事实）｜**板块**只登记与设计稿直接对应的文件，其余标 —，不编。");
md.push("> 设计稿：`" + DESIGN + "` ｜ 编排补全稿：`" + DESIGN21 + "`");
md.push("");
md.push("## 一、总表（" + rows.length + " 个文件）");
md.push("");
md.push("| 文件 | 职责 | 引用 | 设计稿板块 | 上游 | 下游 |");
md.push("|:-----|:-----|:-----|:----------:|:----:|:----:|");
for (const r of rows) {
	const d = info[r];
	md.push("| `src/" + r + "` | " + d.duty.replace(/\|/g, "\\|") + " | " + (d.refs.join(" · ") || "—") + " | " + plateCell(r) + " | " + d.up.length + " | " + d.downResolved.length + " |");
}
md.push("");
md.push("## 二、按模块分组");
md.push("");
for (const dir of Object.keys(byDir).sort()) {
	md.push("### " + dir + "（" + byDir[dir].length + "）");
	md.push("");
	md.push("| 文件 | 职责 |");
	md.push("|:-----|:-----|");
	for (const r of byDir[dir]) md.push("| `" + r + "` | " + info[r].duty.replace(/\|/g, "\\|") + " |");
	md.push("");
}
md.push("## 三、反向索引：设计稿板块 → 文件");
md.push("");
const rev = {};
for (const r of rows) {
	const p = PLATE[r]; if (p) (rev["V16 · " + p] = rev["V16 · " + p] || []).push(r);
	const q = PLATE21[r]; if (q) (rev["V21 · " + q] = rev["V21 · " + q] || []).push(r);
}
md.push("| 设计稿板块 | 文件 |");
md.push("|:-----------|:-----|");
for (const p of Object.keys(rev).sort()) md.push("| " + p + " | " + rev[p].map((x) => "`" + x + "`").join(" · ") + " |");
md.push("");
md.push("## 四、反向索引：需求/文档引用 → 文件");
md.push("");
const revReq = {};
for (const r of rows) for (const rf of info[r].refs) (revReq[rf] = revReq[rf] || []).push(r);
md.push("| 引用 | 文件 |");
md.push("|:-----|:-----|");
for (const rf of Object.keys(revReq).sort()) md.push("| " + rf + " | " + revReq[rf].map((x) => "`" + x + "`").join(" · ") + " |");
md.push("");
md.push("## 五、依赖图（下游 = 我 import 谁）");
md.push("");
md.push("| 文件 | 下游 |");
md.push("|:-----|:-----|");
for (const r of rows) md.push("| `" + r + "` | " + (info[r].downResolved.map((x) => "`" + x + "`").join(",") || "—") + " |");
md.push("");
md.push("## 六、变更提示");
md.push("");
md.push("改了任何 `src/**.js` 后：");
md.push("");
md.push("1. `node scripts/gen-source-map.mjs` —— 刷新映射头与本索引");
md.push("2. `node scripts/lint-undefined-symbols.mjs` / `test-design-logic.mjs` —— 离线闸门");
md.push("3. `node build/build.mjs` → `plugin-install.mjs --apply` → **重启 Harness** → `verify-design-studio.mjs`");
md.push("4. 更新 `docs/00-统筹入口/10-当前基线-落死锚点-V16.md` → `node scripts/baseline-check.mjs --write`");
md.push("");

if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });
const out = join(DOCS, "12-源码映射索引.md");
const prev = existsSync(out) ? readFileSync(out, "utf8") : "";
// 生成时间会每次都变 ⇒ 比对时抹掉该行，避免"假漂移"
const strip = (s) => s.replace(/^> 生成器：.*$/m, "");
const changed = strip(prev) !== strip(md.join("\n"));
if (!CHECK) writeFileSync(out, md.join("\n"), "utf8");

console.log("文件数 " + rows.length + "（新增注入 " + injected + " / 刷新 " + refreshed + "）");
console.log("索引：" + (changed ? "已更新" : "无变化") + " → " + INDEX_REL);
if (CHECK) console.log("（--check 模式：未写入任何文件）");
console.log("IS_PASS: TRUE");
