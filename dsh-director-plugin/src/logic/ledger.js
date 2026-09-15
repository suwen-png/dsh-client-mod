/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：台账 / 文档树取数
 * 引用：T-PLUG-012 · T-PLUG-036
 * 上游：components/DirectorPage.js
 * 下游：store/docs-index-inject.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/ledger.js — 台账 / 文档树取数
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么会有这个模块（用户原话 · 2026-09-14 第 5 批）
 * ══════════════════════════════════════════════════════════════════
 *  「r4 修订, 变成 路线图代办/ 已完成任务/文档树」
 *  「r4和r7对应的功能完善掉, 指向的文档逻辑固定」
 *
 *  改前 R4 三个 Tab 的正文是**写死的说明文字**（`R4_BODY`）：
 *    「文档树：按 00-统筹入口 / 10-架构设计 / … 分组浏览。」—— 不可点、不随项目变化、无法验证。
 *
 *  ⇒ 本模块把三个 Tab 的**数据源固定下来**（设计稿板块 I 的"固定"三条含义）：
 *     ① 单一真相源 —— 每个 Tab 只读一处，不在 JSX 里另写名单；
 *     ② 可验证     —— 每个数字都能指出"来自哪个文件"，闸门能读同一处对账；
 *     ③ 不因宿主改版失效 —— 数据源是**我们自己的** `docs/**` 与 `assets/docs-index.json`。
 *
 *  数据源对照：
 *    R4 · 路线图 · 待办  ←  docs/00-统筹入口/03-待完成任务清单.md   （表格行）
 *    R4 · 已完成任务     ←  docs/00-统筹入口/04-已完成任务清单.md   （表格行）
 *    R4 · 文档树         ←  assets/docs-index.json 的 `tree`（**7 个分组 / 103 篇** ——
 *                            该数字随 `docs/**` 变动，**不许在闸门里写死**；
 *                            界面一律展示由索引带出的 `docCount`，
 *                            旧注释曾写「90 篇」，即 T-PLUG-012 那次索引缺 6 篇的残留）
 *    R7 · 关键文件       ←  见 components/DirectorPage.js 的 KEY_FILES（由 src/** 的 @map 头构建期采集）
 *
 * ── 降级口径（纪律：降级可以，无声不行）────────────────────────────
 *   索引没加载 / 文档不在索引里 / 表格解析出 0 行 ⇒ **必须**返回 `ok:false` + `reason`，
 *   由调用方把原因显示出来。**绝不允许**静默回落到空数组 ——
 *   "空列表"与"真的没有待办"在界面上长得一模一样，是最坏的假绿。
 */

import { loadDocsIndex, getDocsIndexSync } from "../store/docs-index-inject.js";

/** 台账文档在索引里的键（相对 `docs/` 的路径，与 docs-index.json 的 docs map 键同源） */
export const LEDGER_KEYS = Object.freeze({
	roadmap: "00-统筹入口/03-待完成任务清单.md",
	done: "00-统筹入口/04-已完成任务清单.md"
});

/**
 * 条目编号的形状：`T-PLUG-036` / `T-AESTH-002` / `T-P2-001`（首字符必须是大写字母）。
 *
 * 🔴 2026-09-14 修正：**去掉行尾 `$` 锚点，改按前缀匹配**。
 *    原因是真实的台账里有四种"编号后面还带东西"的写法，加 `$` 会被整行**静默丢弃**：
 *      `T-V12-101~104`（区间）· `T-P1-001..006`（省略号）
 *      `T-PLUG-001/002/003/004`（并列）· `T-CONV-P2（重复行）`（附注）
 *    丢行的表现是"这条待办在界面上消失了" —— 与"真的没有这条"长得一模一样，
 *    属于最坏的一类假绿。故判据只要求**开头**是合法编号。
 *    （`scripts/verify-v19.mjs` 的 [1.17] 用真实台账文件对账，防它再退窄。）
 */
const ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+/;

/** 表格分隔行（`:---:` / `---` / `:--`） */
const SEP_RE = /^:?-{2,}:?$/;

/** 去掉 Markdown 行内标记（列表/表格里显示时不该看到 `**` 与反引号） */
export function stripMd(s) {
	return String(s == null ? "" : s)
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** 取一行表格的单元格（去掉首尾空串；`\|` 视为转义竖线、不作为分隔符） */
function cellsOf(line) {
	const t = String(line || "").trim();
	if (t.charAt(0) !== "|") return null;
	/* 先把转义竖线换成占位符，切完再换回来 —— 否则 `a \| b` 会被切成两格 */
	const PIPE = "\u0000";
	const body = t.replace(/\\\|/g, PIPE).replace(/^\|/, "").replace(/\|$/, "");
	return body.split("|").map((c) => c.split(PIPE).join("|").trim());
}

/**
 * 解析一个 Markdown 台账文档里的**条目行**。
 * @param {string} md
 * @returns {Array<{id:string, cols:string[]}>} cols = 编号之后的各列（原文，未 strip）
 */
export function parseLedgerRows(md) {
	const out = [];
	const lines = String(md == null ? "" : md).split(/\r?\n/);
	for (const line of lines) {
		const c = cellsOf(line);
		if (!c || c.length < 2) continue;
		const head = stripMd(c[0]);
		if (!head || head === "编号") continue;                       // 表头
		if (c.every((x) => SEP_RE.test(x.trim()))) continue;          // 分隔行
		if (!ID_RE.test(head)) continue;                              // 不是条目行
		out.push({ id: head, cols: c.slice(1) });
	}
	return out;
}

/** 从若干列里挑出"日期"列（完成时间） */
function pickDate(cols) {
	for (const c of cols) {
		const m = stripMd(c).match(/\d{4}-\d{2}-\d{2}/);
		if (m) return m[0];
	}
	return "";
}

/**
 * 由已加载的索引构建三个 Tab 的视图数据。
 * @param {object|null} index `window.__dshDocsIndex` / docs-index.json 的内容
 * @returns {{ok:boolean, reason:string, docCount:number,
 *            roadmap:Array, done:Array, tree:Array}}
 */
export function buildLedgerView(index) {
	const empty = { ok: false, reason: "", docCount: 0, roadmap: [], done: [], tree: [] };
	if (!index || typeof index !== "object") {
		return { ...empty, reason: "文档索引未加载（assets/docs-index.json）" };
	}
	/* 🔴 `docs` 是 **map**（key=相对路径，value={content,dir,name,size}），不是数组。
	 *    宿主与插件副本都曾把 map 当数组用（T-PLUG-030 的同源缺陷）⇒ 这里显式按 map 读，
	 *    并同时容忍数组形态（将来若改了生成器也不会静默取空）。 */
	const docsMap = index.docs;
	let getContent = null;
	if (docsMap && !Array.isArray(docsMap) && typeof docsMap === "object") {
		getContent = (k) => (docsMap[k] && typeof docsMap[k].content === "string" ? docsMap[k].content : null);
	} else if (Array.isArray(docsMap)) {
		getContent = (k) => {
			const hit = docsMap.find((d) => d && (d.path === k || d.key === k));
			return hit && typeof hit.content === "string" ? hit.content : null;
		};
	}

	const readDoc = (key) => {
		if (!getContent) return { md: null, missing: "索引里没有 docs 映射" };
		const md = getContent(key);
		return md === null ? { md: null, missing: "索引中不存在该文档：" + key } : { md, missing: "" };
	};

	const rm = readDoc(LEDGER_KEYS.roadmap);
	const dn = readDoc(LEDGER_KEYS.done);
	const reasons = [];
	if (rm.md === null) reasons.push("待办清单：" + rm.missing);
	if (dn.md === null) reasons.push("已完成清单：" + dn.missing);

	const roadmap = rm.md === null ? [] : parseLedgerRows(rm.md).map((r) => ({
		id: r.id,
		task: stripMd(r.cols[0] || ""),
		prio: stripMd(r.cols[1] || ""),
		ref: stripMd(r.cols[2] || ""),
		status: stripMd(r.cols[3] || (r.cols.length > 3 ? r.cols[r.cols.length - 1] : "")),
		where: "待排期"
	}));
	const done = dn.md === null ? [] : parseLedgerRows(dn.md).map((r) => ({
		id: r.id,
		task: stripMd(r.cols[0] || ""),
		date: pickDate(r.cols),
		ref: stripMd(r.cols[r.cols.length - 1] || "")
	}));

	const tree = [];
	if (index.tree && typeof index.tree === "object") {
		for (const dir of Object.keys(index.tree)) {
			const files = Array.isArray(index.tree[dir]) ? index.tree[dir] : [];
			tree.push({ dir, count: files.length, files });
		}
	}
	if (!tree.length) reasons.push("文档树：索引里没有 tree");

	/* ok 的判据：三个数据源**都**拿到了（缺一个就如实降级，不假装成功） */
	const ok = rm.md !== null && dn.md !== null && tree.length > 0;
	return {
		ok,
		reason: ok ? "" : reasons.join("；"),
		docCount: typeof index.docCount === "number" ? index.docCount : 0,
		roadmap, done, tree
	};
}

/** 同步取（索引已在内存时） */
export function getLedgerViewSync() {
	return buildLedgerView(getDocsIndexSync());
}

/** 异步取（必要时先加载索引） */
export async function loadLedgerView(baseUrl) {
	let idx = getDocsIndexSync();
	if (!idx) {
		try { idx = await loadDocsIndex(baseUrl); } catch (e) { idx = null; }
	}
	return buildLedgerView(idx);
}

/** 读一篇文档的正文（R4 文档树点开的钻孔视图用；读不到就返回 null，不编） */
export function readDocContent(index, path) {
	const docsMap = index && index.docs;
	if (!docsMap || typeof docsMap !== "object") return null;
	if (!Array.isArray(docsMap)) {
		const hit = docsMap[path];
		return hit && typeof hit.content === "string" ? hit.content : null;
	}
	const hit = docsMap.find((d) => d && (d.path === path || d.key === path));
	return hit && typeof hit.content === "string" ? hit.content : null;
}
