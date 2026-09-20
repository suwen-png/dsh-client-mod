/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监 → 职能分支的**派发**（第 17 批）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：logic/split-dimensions.js, logic/director-reuse.js, logic/branch-tree.js, bridge/session-io.js, store/dispatch-log.js, store/split-index.js, store/session-dossier.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-dispatch.js — 总监 → 职能分支的**派发**（第 17 批）
 *
 * ── 它和第 16 批的「按维度分流」差在哪 ────────────────────────────────
 *   第 16 批：建会话 → `deliverToChat` → 记索引。**没有主体**（谁派的？不知道）。
 *   本批：多三样东西 ——
 *     ① **主体是总监**：派发由总监五步的产物驱动（`opts.director` 带回五步读数），
 *        派发结果也**回写总监消息流**（`appendDirectorMessage`）；
 *     ② **投递通道换成"不碰 DOM"的直投**（`sendToSession`），并**复核**它真的跑起来了；
 *     ③ **台账**（`store/dispatch-log.js`）：派给谁 / 走哪条通道 / 现在什么状态。
 *
 * ── 🔴 投递成功 ≠ 分支跑起来了（纪律 30 的同型错误）───────────────
 *   `__directChatSubmit` 是 **fire-and-forget**（返回 `undefined`，实测）。
 *   ⇒ 本模块在投递后**等一拍再取样**（`hostConfirmMs`）：宿主快照里出现
 *     `turns > 0` 或 `running === true` 才算"真的起来了"；否则如实标 `unconfirmed`。
 *   **不拿"调用没抛错"当成功** —— 那正是第 16 批 `sent:8` 看着像成功的原因。
 *
 * ── 🔴 空需求 / 无维度 ⇒ 一条都不建 ──────────────────────────────
 *   `plan()` 已经保证"空需求不建分支"。本模块**继承**这条：`dims.length === 0`
 *   时直接返回失败 + 原因，**不兜底建默认三条**（建出来的是空壳，比"什么都没发生"更糟）。
 */

import { plan, briefOf, branchTitle, briefTitlePrefix, organize } from "./split-dimensions.js";
import { planReuse, directorRoleOf, reuseSummary } from "./director-reuse.js";
import { createSession, renameSession, rawSessionSummaries, refreshBranchTree, sessionsAvailable, archivedSessionIds } from "./branch-tree.js";
import { sendToSession, findSummary, stateOfSummary } from "../bridge/session-io.js";
import {
	recordDispatch, refreshStates, patchDispatchItem, readDispatchLog, dispatchItemOf
} from "../store/dispatch-log.js";
import { recordSplits, readSplitIndex, forgetSplits, readQuotaMemo } from "../store/split-index.js";
import { putDossier, dossierOf } from "../store/session-dossier.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 从需求原文里提取**项目根路径**与**作品名**（纯函数）。
 *
 * 🔴 为什么不写死 `D:\workspace\novels\墟海`：那是**用户这一次的数据**，
 *    写进产品等于把一次性输入变成硬编码（下次换作品就静默失效）。
 *    实测用户原话形如：「…你读取"D:\workspace\novels\墟海"这个文件的信息作为填充」
 *    ⇒ 从原文里**找绝对路径**即可，找不到就不带（简报里少一段，不是错）。
 *
 * ⚠️ **命名更正（2026-09-18 实测 · 纪律 130）**：`墟海` 是 **2026-09-10 之前的旧名**，
 *    项目现名《**虚海**》，磁盘目录 = `D:\workspace\novels\虚海`（`墟海` 目录**已不存在**）。
 *    ① 上文引用的用户原话录于**旧名时期** ⇒ **保留原字**（改字等于伪造记录）；
 *    ② 但代码/语料里的**路径字面量必须用现名**，否则是死链 —— 语料侧已更正
 *       （`scripts/_corpus-director.mjs` 的 `REAL_PROJECTS.xuhai`，此前令 `CP-1d` 长期误红）。
 *    教训：**拿错别字当检索键去证否真实项目名**，会得到"不存在"的假结论。
 *
 * 识别形态（真机原话覆盖）：
 *   · `"D:\workspace\novels\墟海"`（引号包裹）
 *   · `D:\workspace\novels\墟海`（裸路径）
 *   · `d:/workspace/novels/墟海` / `d:/workspace/novels/墟海/`
 *
 * @param {string} text
 * @returns {{root:string|null, name:string|null}}
 */
export function projectOf(text) {
	const s = String(text == null ? "" : text);
	/* 盘符 + 反斜杠或正斜杠 + 至少一层（路径里允许中文、空格、下划线、点、连字符）
	 *
	 * 🔴 第 18 批修正：**终止条件必须含中文标点**（由 `scripts/test-director-dispatch.mjs`
	 *    的 `DD-1` 抓出）。原字符类只排除空白与英式引号/通配符 ⇒
	 *    「项目根 D:\workspace\novels\虚海，先搭世界观」会把「，先搭世界观」**一起吞进 `root`**；
	 *    真机原话里恰好是 `"…墟海"`（带引号 · 旧名时期）才没踩到 —— 属**运气**不是正确性。
	 *    中文**字**仍允许（目录名可能就是中文，如 `虚海`），只排除中文**标点**。 */
	const STOP = "\\s\"'“”‘’<>|?*，。；：、（）()【】《》！？!";
	const m = s.match(new RegExp("[A-Za-z]:[\\\\/][^" + STOP + "]*[^" + STOP + "\\\\/]"));
	if (!m) return { root: null, name: null };
	const root = m[0].replace(/[，。；：、）)】\]]+$/, "");
	const parts = root.split(/[\\/]+/).filter(Boolean);
	const name = parts.length ? parts[parts.length - 1] : null;
	return { root, name: name && name.length <= 40 ? name : null };
}

/**
 * 派发：总监识别职能 → 建分支会话 → 投简报 → 记账。
 *
 * @param {string} text 需求原文（**不是** key 数组 —— 意图识别在 `plan()` 内部）
 * @param {object} [opts]
 * @param {object} [opts.director] 总监五步读数（`runDirector` 的返回）；用于记录"主体是总监"
 * @param {object} [opts.project] 覆盖自动提取的项目根 `{root, name}`
 * @param {number} [opts.max] 上限（防一次建太多）
 * @param {boolean} [opts.continuous] 上一条与本条是否**话题连续**
 *        （`runDirector().branch` 的判定结果）；传 `false` 时归属判定会**排除 `currentDim`**
 *        —— 这正是 N9/F10 的落点：判了「建议开新分支」就得**真的换维度去**，
 *        否则"要开新分支"只写进一段文字，需求还是派回同一个维度。
 * @param {string} [opts.currentDim] 当前所在分支的维度 key（配合 `continuous=false` 使用）
 * @param {number} [opts.hostConfirmMs=2500] 投递后等宿主确认的时间（**复核"真的起来了"**）
 * @param {(msg:string)=>void} [opts.log] 进度回调（每建成一条报一次，便于界面"看得见在动"）
 * @param {(info:object)=>Promise<void>} [opts.onBranch] 每建成一条后的**外部挂载钩子**
 *        （总监页用它把分支挂到插件自己的层级树上 —— 逻辑层不反向依赖组件，故做成回调）
 * @returns {Promise<{ok:boolean, kind:string, name:string, dims:Array, made:number, failed:number,
 *                    confirmed:number, unconfirmed:number, items:Array, reason:string}>}
 */
export async function dispatchBranches(text, opts = {}) {
	const o = opts || {};
	const src = String(text == null ? "" : text).trim();
	const project = o.project || projectOf(src);
	/* 🔴 第 23 批：**总监对语言的整理**（用户原话「回复包括总监对语言的整理，对于文字的描述」）。
	 *    派发前先把原文整理成**要点**（逐行去噪 → 空白归一 → 去重复行 → 提取书名），
	 *    整理结果随简报投递（`briefOf` 第 5 参），**原文仍保真附在简报末尾**。
	 *    🔴 整理**不改写语义** —— 见 `organize()` 头注释。
	 * ⚠️ 本行曾在一次**同文件并行编辑**中静默丢失（两次 Edit 都报成功，后写者按旧内容覆盖），
	 *    真机表现为 `data-error: "org is not defined"`（噪声路径不经过这里 ⇒ 只有真实派发才暴露）。 */
	const org = organize(src);
	/* 🔴 19 号文 **N9 / F10**：把「话题连续性」判定结果**接进归属判定**。
	 *    收敛前 `plan()` 只收到 `max` ⇒ 步骤 2 判出的 `branch` **全仓零消费者**
	 *    （只被拼进 `reasoning` 文本）⇒ 总监"判了"连续性却"不用"它决定去向。
	 *    这里显式透传：`continuous === false` + `currentDim` ⇒ 归属候选**排除当前维度**。
	 *    ⚠️ 只在调用方**真的给了** `continuous` 时才传：`undefined` 会覆盖归属判定里的默认语义。 */
	const planOpts = {};
	if (o.max) planOpts.max = o.max;
	if (o.continuous !== undefined && o.continuous !== null) planOpts.continuous = o.continuous === true;
	if (o.currentDim) planOpts.currentDim = String(o.currentDim);
	const p = plan(src, planOpts);
	if (!p.dims.length) {
		return { ok: false, kind: p.kind || "none", name: p.name || "", dims: [], made: 0, failed: 0,
			confirmed: 0, unconfirmed: 0, items: [],
			organized: { lines: org.lines.length, noise: org.noiseLines.length, dup: org.droppedDup, intent: org.intent },
			reason: String(p.reason || "没有可用维度") };
	}

	/* ══════════════════════════════════════════════════════════════════
	 * 🔴 第 41 轮 `T-PLUG-043`：**派发前配额预检**（零成本）
	 *   实测（第十九轮）：模型侧 `QUOTA` 时，插件仍会把 8 条简报**全投出去**，
	 *   8 次运行全失败 ⇒ 用户看到 8 个失败框，还得自己猜是配额问题。
	 *   预检源 = `store/split-index.js` 的**配额备忘**（上次观测到的 `turn/end` 失败，
	 *   由 `director-collect.js` 落盘、任何一次成功即清、30 分钟 TTL）。
	 *   🔴 **零成本**：只读一条 localStorage 记录，**不调模型、不建会话、不投简报**。
	 *   🔴 拦下时**必须把原因原样带出来**（`code`/`message`/`status`）——
	 *      只说"配额不足"会让用户不知道是哪个额度、该找谁（纪律 18）。
	 *   ⚠️ 这不是"产品坏了"：`kind:"quota"` 与 `kind:"none"` 必须**可分**（纪律 140 同族）。
	 * ══════════════════════════════════════════════════════════════════ */
	const quota = (() => { try { return readQuotaMemo(); } catch (e) { return null; } })();
	if (quota) {
		const why = "模型侧配额不足 ⇒ **未派发**（零成本预检拦下）"
			+ (quota.message ? "：宿主上次运行失败 —— " + quota.message : "")
			+ (quota.code ? "（" + quota.code + (quota.status ? " " + quota.status : "") + "）" : "")
			+ " ｜ 处置：充值或换模型后再派发（备忘 " + Math.max(0, Math.round((Date.now() - quota.at) / 60000)) + " 分钟前）";
		return {
			ok: false, kind: "quota", quotaBlock: true, quota: quota,
			name: p.name || "", dims: p.dims, made: 0, failed: 0,
			confirmed: 0, unconfirmed: 0, items: [], reused: 0, created: 0,
			organized: { lines: org.lines.length, noise: org.noiseLines.length, dup: org.droppedDup, intent: org.intent },
			reason: why
		};
	}

	/* ══════════════════════════════════════════════════════════════════
	 * 🔴 第 19 批：派发前**先考虑目前存在的会话**（用户原话逐字）
	 *    「我需要的是总监确认完需求之后先考虑目前存在的会话,然后没有才是新建会话」
	 *
	 *   第 18 批之前这里是**无条件** `createSession({})`（在维度循环体内）⇒
	 *   每派一次必建 8 条，真机循环 ~10 次 + 闸门验收每次 8 条 ⇒ 导图上累积 123 个框。
	 *
	 *   复用判据全部由**纯函数** `planReuse()` 给出（可离线单测，见
	 *   `scripts/test-director-reuse.mjs`）；本函数只做三件纯函数做不到的事：
	 *     ① 读活数据（宿主现存会话 + 分流索引）
	 *     ② 落盘（会话档案 + 分流索引）
	 *     ③ 报数（复用几条 / 新建几条 —— 必须**可分**，否则用户还是看不见它在重复建）
	 * ══════════════════════════════════════════════════════════════════ */
	const raws = rawSessionSummaries();
	const aliveAll = raws.map((s) => (s && s.id ? String(s.id) : "")).filter(Boolean);
	/* 🔴 第 19 批补漏：存活集必须**排除已归档**会话。
	 *    宿主快照的 `ids` 里**仍留着归档会话**（实测：磁盘清 0、侧栏 0 行时 `ids` 还是 116 条）
	 *    ⇒ 直接拿它当「目前存在的会话」，「先复用」会落到用户**看不见**的幽灵会话上。
	 *    `archivedSessionIds()` 返回 `null`（读不到归档集）⇒ **不过滤**：
	 *    把"读不到"当成"全被归档"会一次建出双倍会话（与纪律 19 同型的静默放大）。 */
	let archivedSet = null;
	let archivedExcluded = 0;
	try {
		const arch = await archivedSessionIds();
		if (Array.isArray(arch)) {
			archivedSet = new Set(arch);
			for (let i = 0; i < aliveAll.length; i++) { if (archivedSet.has(aliveAll[i])) archivedExcluded++; }
		}
	} catch (e) { archivedSet = null; archivedExcluded = 0; }
	const aliveIds = archivedSet ? aliveAll.filter((id) => !archivedSet.has(id)) : aliveAll;
	/* 🔴 `aliveKnown` 区分「真的没有会话」与「读不到宿主服务」——
	 *    两者都表现为 `[]`，但处置相反（后者必须报降级，见 `sessionsAvailable` 头注释）。 */
	const aliveKnown = sessionsAvailable();
	/* 🔴 19 号文 **U10 / P9**：把宿主会话**现有标题**送进复用判定。
	 *   为什么必须送：分流索引存在 `localStorage`，而 **origin 含端口**、
	 *   宿主每次启动端口都变 ⇒ **冷启动后索引必然为空** ⇒ 首次派发必然重建全部 N 条
	 *   （真机实测 `run01 +8` / `run04 +3`）。宿主自己的会话列表是**跨启动保留**的
	 *   ⇒ 退一步按标题弱匹配（判据见 `director-reuse.js#planReuse`）。
	 *
	 *   🔴🔴 **第 25 批实测更正 —— 上一版这里是错的**（纪律 27：看起来相等 ≠ 同源）：
	 *     上一版 `wantTitles` 取 `branchTitle()`，注释断言"与真正写进宿主的那个名字同源"。
	 *     实测**不同源**：`branchTitle()` 产出 `「A1 世界观」《灵能修仙》`（角括号），
	 *     而宿主标题来自**首条消息的首行** = `briefOf()` 的 head = `【A1 世界观】《灵能修仙》 —— …`
	 *     （**方头括号**）⇒ 全等匹配恒 0 命中，冷启动仍 `reused:0 / created:8`。
	 *     ⇒ 现在取 `briefTitlePrefix()`（**head 的唯一真相源**），并且匹配是**前缀**不是全等。
	 *   ⚠️ 读数 `prevSummaryLen` / `titleHit` / `titleMissed` / `titlePoolN` 一并回传 ——
	 *      "建了 N 条"必须能回答"为什么"，否则只能靠猜（纪律 18/60）。 */
	const hostTitles = raws.map((s) => ({
		sessionId: s && s.id ? String(s.id) : "",
		title: String((s && (s.title || s.name)) || ""),
		at: Number((s && (s.updatedAt || s.at)) || 0)
	})).filter((x) => x.sessionId);
	const wantTitles = {};
	for (let i = 0; i < p.dims.length; i++) {
		const dd = p.dims[i];
		if (dd && dd.key) wantTitles[String(dd.key)] = briefTitlePrefix(dd, p.name);
	}
	const reusePlan = planReuse(p.dims, {
		index: readSplitIndex(), aliveIds: aliveIds, name: p.name, aliveKnown: aliveKnown,
		hostTitles: hostTitles, wantTitles: wantTitles
	});

	const made = [];
	const failed = [];
	for (let i = 0; i < p.dims.length; i++) {
		const dim = p.dims[i];
		const dec = reusePlan.decisions[i] || { action: "create", sessionId: null, why: "no-decision" };
		const label = branchTitle(dim, p.name);
		const role = directorRoleOf(dim);
		let sessionId = null;
		let reused = false;
		let attachFail = false;
		let attachWhy = "";
		/* T-PLUG-042：宿主侧改名结果（`null` = **未尝试**，只对新建会话尝试） */
		let renameOk = null;
		let renameWhy = "";
		if (dec.action === "reuse" && dec.sessionId) {
			/* **复用已有会话 ⇒ 一条新会话都不建** —— 这正是本批要治的病 */
			sessionId = String(dec.sessionId);
			reused = true;
		} else {
			const cs = await createSession({});
			if (!cs.ok || !cs.sessionId) {
				failed.push({ dim: dim.key, label, why: "建会话失败：" + String((cs && cs.reason) || "未知") });
				continue;
			}
			sessionId = String(cs.sessionId);
			attachFail = cs.attached === false;
			attachWhy = String(cs.reason || "");
			/* 🔴 `T-PLUG-042`（第 41 轮）：把维度标签**写回宿主标题**。
			 *    宿主 `sessions.rename` 确实存在（第十九轮实测更正，见 `split-index.js` 头部事实①②），
			 *    而插件侧 `applySplitLabels` 只改**血缘树显示** ⇒ 宿主自己的会话列表 / 搜索里
			 *    仍是默认标题 —— 那正是"一百多个会话分不清"的一半原因。
			 *    ⚠️ **只对刚建出来的空会话**调：复用的会话可能被用户改过标题，不许动（纪律 82）。
			 *    失败**不改**"分支已建出"这一事实，但必须**降级可见**（纪律 19）。 */
			const rn = await renameSession(sessionId, label);
			renameOk = rn.ok === true;
			renameWhy = rn.ok ? "" : String(rn.why || "");
		}
		/* 🔴 19 号文 §3.5 **P3**（对话持续性）：简报必须在 **sessionId 定下来之后**才构造 ——
		 *    「上一轮结论」只有**复用同一会话**时才存在；新建会话本就没有历史。
		 *    旧顺序把 `briefOf()` 放在决定 sessionId 之前 ⇒ 即便复用，也**永远带不上**上一轮结论
		 *    （分支每轮都当第一轮做，用户看到的"持续性"就一直是零）。
		 *    ⚠️ 逐字取用档案里的 `summary.text`，这里**不做任何格式化**（P3 判据：逐字同源）。 */
		const prevDos = dossierOf(sessionId);
		const prevSummary = (prevDos && prevDos.summary && prevDos.summary.ok) ? String(prevDos.summary.text || "") : "";
		const brief = briefOf(dim, src, p.name, project, org, null, prevSummary);
		/* 投简报：复用与新建走**同一条通道**（先复用再自研 —— 不新开投递路径，
		 * 否则复用那条会走上一条没人验证过的路）。 */
		const sent = await sendToSession(sessionId, brief);
		/* 会话档案：**每个会话自己的总监**（第 19 批 R2）。
		 * 合并式写入 ⇒ 与回收链写 `summary` 互不覆盖。写失败**不改变"已派发"这一事实**。 */
		try {
			putDossier(sessionId, {
				dim: dim.key,
				director: { role: role, name: String(p.name || ""), at: Date.now() },
				at: Date.now()
			});
		} catch (e) { /* 档案写失败不改派发结论 */ }
		const info = {
			dim: dim.key, label, sessionId: sessionId, brief, reused: reused, reuseWhy: String(dec.why || ""),
			/* 🔴 P3 读数（纪律 19：降级可以，无声不行）——
			 *   `0` 与"有值"必须**可分**：没有历史（新建会话）与"读了但读不到"在界面上
			 *   长得一样，闸门/用户都无法判断持续性到底有没有生效 ⇒ 必须报数。 */
			prevSummaryLen: prevSummary.length,
			directorRole: role,
			sentOk: sent.ok === true, sentVia: String(sent.via || ""), sentReason: String(sent.reason || ""),
			attachFail: attachFail, attachWhy: attachWhy, name: p.name,
			renameOk: renameOk, renameWhy: renameWhy
		};
		made.push(info);
		/* 外部挂载钩子（总监页 → 插件层级树）。钩子抛错**不许**打断派发，
		 * 但要把原因带进条目（"建出来了但没挂上"与"完全成功"必须可分）。 */
		if (typeof o.onBranch === "function") {
			try { await o.onBranch(info); } catch (e) { info.nodeErr = String((e && e.message) || e); }
		}
		if (typeof o.log === "function") { try { o.log("已派发 " + (i + 1) + "/" + p.dims.length + "：" + label); } catch (e) { /* 日志回调不许打断派发 */ } }
	}

	recordDispatch({ text: src, name: p.name, kind: p.kind, items: made });
	refreshStates((id) => findSummary(rawSessionSummaries(), id), stateOfSummary);
	/* 持久化沿用**现有 key**（`dsh.director.split`）——不新开 localStorage 契约。
	 *
	 * 🔴 **登记规则（第 25 批实测更正）**：登记「新建的」**∪「索引里没有的复用」**。
	 *    上一版只登记"新建的"，理由写的是「复用的那条**早就在索引里**」——
	 *    这条前提在**冷启动**下**不成立**：索引存在 `localStorage`（origin 含端口、每次启动都变），
	 *    而这批复用是**靠宿主标题**认回来的（见上方 U10 注释）⇒ 索引里**一条都没有**。
	 *    真机实测（第二十五轮）：`派发 8 · 复用 8` 而 `dsh.director.split` **整键不存在**
	 *    ⇒ 两个真实后果：① 导图那 8 个节点拿不到 `titleOrigin="plugin:split"`（插件侧标签覆盖失效）；
	 *      ② 下一次派发又只能走标题兜底 —— **索引这条快路永远用不上**。
	 *    ⚠️ 仍然**排除"索引命中"的那些**：它们已在索引里，重复登记只会刷新 `at`，
	 *      把它一直顶在最前、掩盖真正的新条目（上一版点名的风险依旧成立）。
	 *    ⇒ 判据用 `reusePlan` 自己的分类（`why`），不在这里另写一套推断（纪律 92）。 */
	const fromIndex = new Set();
	for (let i = 0; i < reusePlan.decisions.length; i++) {
		const dd = reusePlan.decisions[i];
		if (dd && dd.action === "reuse" && dd.why === "index-hit" && dd.sessionId) fromIndex.add(String(dd.sessionId));
	}
	let recorded = 0;
	try {
		recorded = recordSplits(made.filter((m) => m.sessionId && !fromIndex.has(String(m.sessionId))).map((m) => ({
			sessionId: m.sessionId, dim: m.dim, label: m.label, name: m.name
		})));
	} catch (e) { /* 索引写入失败不改变"分支已建出"这一事实；读数里另记 */ }

	/* ── 顺手清掉**索引孤儿**：索引里有、宿主里已无的会话 ────────────────
	 * 这是"清理无效条目"的产品化落点（用户需求 R4 的一部分）。
	 * 🔴 两道门（**缺一不可**）：
	 *    ① `aliveKnown` —— 读不到宿主列表时**一条都不许清**
	 *       （"读不到"≠"不存在"；一次读取失败就清空索引会把病情放大）
	 *    ② **必须报数** —— 不许无声删除（纪律 19 同型） */
	let orphanForgotten = 0;
	try {
		if (aliveKnown && reusePlan.orphans.length) orphanForgotten = forgetSplits(reusePlan.orphans).removed;
	} catch (e) { /* 清理失败不改变派发结论 */ }

	/* ── 复核："投递出去了" ≠ "分支真的跑起来了" ─────────────────────
	 * 判据（**跑程内**，纪律 42）：等待窗口内取样，宿主快照出现
	 *   `running === true` 或 `turns > 0` 即算 confirmed。
	 * 超时未确认 ⇒ 标 `unconfirmed`（**如实**，不写成功）。 */
	const waitMs = Number(o.hostConfirmMs) >= 0 ? Number(o.hostConfirmMs) : 2500;
	let confirmed = 0;
	if (made.length && waitMs > 0) {
		const deadline = Date.now() + waitMs;
		const pending = made.slice();
		while (pending.length && Date.now() < deadline) {
			for (let i = pending.length - 1; i >= 0; i--) {
				const raw = findSummary(rawSessionSummaries(), pending[i].sessionId);
				const s = raw ? stateOfSummary(raw, null) : null;
				const alive = raw && (raw.running === true || (s && s.turns !== null && s.turns > 0));
				if (alive) {
					patchDispatchItem(pending[i].sessionId, { confirmed: true, confirmedVia: raw.running === true ? "running" : "turns>0" });
					pending.splice(i, 1);
				}
			}
			if (pending.length) await sleep(300);
		}
		pending.forEach((it) => patchDispatchItem(it.sessionId, { confirmed: false }));
		confirmed = made.length - pending.length;
	}
	const unconfirmed = made.filter((m) => { const it = dispatchItemOf(m.sessionId); return it && it.confirmed !== true; }).length;

	try { await refreshBranchTree(); } catch (e) { /* 血缘刷新失败不影响派发本身的结果 */ }

	const reusedN = made.filter((m) => m.reused).length;
	const createdN = made.length - reusedN;
	return {
		ok: made.length > 0,
		kind: p.kind, name: p.name, dims: p.dims.map((d) => d.key),
		/* 🔴 19 号文 **N8**（人可感知层）：把**归属判定的原样输出**带上来。
		 *    总监页的常驻读数由 `attributionSummary(attribution)` 渲染 ——
		 *    **同源**，不是"另算一遍"（另算必漂移，纪律 78）。
		 *    `null` 表示走了 `o.only` 显式指定路径（没做归属判定）⇒
		 *    读数如实说"显式指定"，**不伪造一个置信度**。 */
		attribution: p.attribution || null,
		made: made.length, failed: failed.length,
		confirmed, unconfirmed, recorded,
		/* 🔴 第 19 批：复用与新建**必须可分** —— 上一条真机循环里正是
		 *    "只报 made=8" 让用户看不出它在重复建会话。 */
		reused: reusedN, created: createdN, orphanForgotten,
		/* 🔴 归档过滤必须**报数**（纪律 19：降级可以，无声不行）——
		 *    `archivedKnown=false` 表示"读不到归档集、本轮未过滤"，
		 *    读数的人要能一眼分清「没有归档」与「没读到归档」。 */
		archivedExcluded: archivedExcluded,
		archivedKnown: !!archivedSet,
		aliveAll: aliveAll.length,
		reusePlan: {
			reuse: reusePlan.reuse, create: reusePlan.create,
			degraded: reusePlan.degraded, aliveKnown: reusePlan.aliveKnown,
			orphans: reusePlan.orphans.length, surplus: reusePlan.surplus.length,
			/* U10/P9 读数：靠宿主标题救回来的 / 标题也没匹配上的 */
			titleHit: !!reusePlan.titleHit, titleMissed: (reusePlan.titleMissed || []).slice(),
			titlePoolN: Number(reusePlan.titlePoolN) || 0,
			/* 🔴 补登记条数（**不是布尔**）：标题命中的那几条**不在索引里** ⇒ 已补进索引。
			 *    上游据此对账 `索引新增 == created + titleHits`（纪律 78：数出 0 ≠ 没有）。 */
			titleHits: Number(reusePlan.titleHits) || 0,
			/* 🔴 第 36 轮：项目级兜底复用条数。**必须在这里显式透传** ——
			 *    本对象是对 `planReuse()` 返回值的**重新整形**（不是原样转发），
			 *    漏一个字段 ⇒ 界面与闸门恒读到 0，而产品侧其实完全正常
			 *    （纪律 79：「写好了」≠「接进去了」；本轮 NS-4c2 就是这么红的）。 */
			projectHits: Number(reusePlan.projectHits) || 0,
			recorded: recorded
		},
		summary: reuseSummary({
			reuse: reusedN, create: createdN, aliveKnown: aliveKnown,
			orphans: reusePlan.orphans, surplus: reusePlan.surplus
		}),
		attachFail: made.filter((m) => m.attachFail).length,
		nodeFail: made.filter((m) => m.nodeErr).length,
		/* 🔴 第 23 批：「整理」也要**可读数** —— 否则"整理生效了没有"在界面上无从判断（纪律 19 同型） */
		organized: { lines: org.lines.length, noise: org.noiseLines.length, dup: org.droppedDup, intent: org.intent },
		items: readDispatchLog().items.slice(), failedItems: failed,
		project: project,
		director: o.director ? { taskType: o.director.taskType, branch: o.director.branch, model: o.director.model } : null,
		reason: made.length ? "" : (failed.length ? "全部建会话失败：" + failed[0].why : "没有可用维度")
	};
}

/**
 * 把派发台账挂到 `window.__dshDispatchLog`（**诊断出口**，与 `window.__dshBranchTree`
 * / `window.__dshChatBridge` 同性质）。
 *
 * 🔴 为什么需要它：闸门要断言「台账里 8 条、每条都有 sessionId」——
 *    没有出口就只能靠 DOM 读数间接推断，而 DOM 读数**恰好是第 16 批漏掉的那个视角**
 *    （`made=8` 曾与「真的建了 8 条」不是一回事）。
 *    暴露的是**同一个活对象**（不是拷贝）⇒ 读完即最新，不存在两份真相。
 *
 * @returns {object} 台账对象
 */
export function installDispatchApi() {
	if (typeof window !== "undefined") window.__dshDispatchLog = readDispatchLog();
	return readDispatchLog();
}
