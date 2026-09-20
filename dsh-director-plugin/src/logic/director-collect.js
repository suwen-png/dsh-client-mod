/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：分支产出回收 + 总裁定（第 17 批）
 * 引用：T-PLUG-043
 * 上游：components/DirectorPage.js
 * 下游：logic/branch-tree.js, bridge/session-io.js, store/dispatch-log.js, store/split-index.js, store/session-dossier.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-collect.js — 分支产出回收 + 总裁定（第 17 批）
 *
 * ── 数据来源（**不切页签**，实测见 `bridge/session-io.js` 头注释）────────
 *   状态：`rawSessionSummaries()`（宿主 `sessions.list` 快照，一次全拿）
 *   正文：`conversation.scopedSession().history({})` 的 `events[]`
 *
 * ── 🔴 「回收」为什么是**显式动作**而不是自动跑 ──────────────────────
 *   8 条分支各读一次事件流 = 8 次 RPC。自动跑会在每条消息后触发 8 次，
 *   把一次轻量发送变成 8 倍负载，而且**失败时无人知道是哪一次**。
 *   ⇒ 显式动作 + 一次回收整批（`collectBranches` 一次跑完，逐条记原因）。
 *
 * ── 🔴 「读到"」与「跑完了」是两件事 ─────────────────────────────
 *   · `state`    来自快照（可靠，但只说"跑没跑/跑完没"）
 *   · `say`      来自事件流（说"产出了什么"，但可能读不到）
 *   两者**分别记来源与原因**（`stateSource` / `sayReason`）—— 见 `store/dispatch-log.js` 头注释。
 */

import { rawSessionSummaries, refreshBranchTree, scopedConversationOf, archivedSessionIds } from "./branch-tree.js";
import { findSummary, stateOfSummary, readSessionOutput, probeSessionIo } from "../bridge/session-io.js";
import { readDispatchLog, refreshStates, patchDispatchItem, setDispatchCollect } from "../store/dispatch-log.js";
/* 第 41 轮 `T-PLUG-043`：配额备忘（落点 = 唯一能拿到 `turn/end` 失败原因的地方） */
import { writeQuotaMemo, clearQuotaMemo } from "../store/split-index.js";
import { putDossier } from "../store/session-dossier.js";

/**
 * 取一条产出的**摘要**（纯函数）—— 只做截断与空白归一，**不改写内容**。
 *
 * 🔴 不用宿主自动标题兜底：宿主会自动给会话起标题（`session/title`，
 *    来源 `session-title-first-prompt-llm`），那是**模型给会话起的名字**，
 *    不是分支的产出。拿它当摘要 ⇒ 界面上"看起来有产出"，实际是幻觉级信息。
 *
 * @param {string} text
 * @param {number} [max=160]
 * @returns {string}
 */
export function digestOf(text, max) {
	const n = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.round(Number(max)) : 160;
	const s = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
	return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

/**
 * 回收全部派发分支的产出。
 *
 * @param {object} [opts]
 * @param {number} [opts.maxChars=160] 每条摘要截断长度
 * @param {boolean} [opts.deep=false] 是否附诊断（逐条 `probeSessionIo`，**慢**，仅排障用）
 * @returns {Promise<{ok:boolean, at:number, total:number, read:number, unread:number,
 *                    counts:object, items:Array, reason:string}>}
 */
export async function collectBranches(opts = {}) {
	const o = opts || {};
	const dlog = readDispatchLog();
	const items = dlog.items || [];
	if (!items.length) {
		const s = setDispatchCollect({ ok: false, total: 0, read: 0, unread: 0, counts: {}, reason: "台账为空：还没有派发过（先点「按职能派发」）" });
		return { ok: false, at: s.at, total: 0, read: 0, unread: 0, counts: {}, items: [], reason: "台账为空：还没有派发过" };
	}

	/* ① 先刷状态（一条 RPC 全拿到，**这一路不该失败**）—— 让界面立刻有反馈 */
	refreshStates((id) => findSummary(rawSessionSummaries(), id), stateOfSummary);
	/* 刷新后 items 对象被就地更新，直接引用即可（同源，纪律 22） */
	const live = readDispatchLog().items;

	/* ② 逐条读正文 */
	let read = 0;
	for (let i = 0; i < live.length; i++) {
		const it = live[i];
		if (!it.sessionId) {
			patchDispatchItem(it.sessionId, { sayReason: "没有会话 id（这条分支没建成）" });
			continue;
		}
		const r = await readSessionOutput(it.sessionId);
		if (!r.ok) {
			const why = String(r.reason || "读取失败");
			patchDispatchItem(it.sessionId, { say: "", sayReason: why });
			/* 🔴 第 21 批 D3：读失败也要在**会话自己的档案**里留一条**可读原因**。
			 *    否则档案里 `summary` 是 `null` ⇒「没有总结」与「读不到」不可分（纪律 58）。 */
			try {
				putDossier(it.sessionId, {
					summary: { text: "", at: Date.now(), source: "none", ok: false, reason: why },
					at: Date.now()
				});
			} catch (e) { /* 档案写失败不改回收结论 */ }
			continue;
		}
		/* 🔴 只取**助手**正文作为产出；用户侧那条是本插件投出去的简报，不是产出 */
		const assistant = r.items.filter((x) => x.role === "assistant");
		const last = assistant.length ? assistant[assistant.length - 1] : null;
		if (o.deep) {
			try { patchDispatchItem(it.sessionId, { io: await probeSessionIo(it.sessionId) }); } catch (e) { /* 诊断失败不改变结论 */ }
		}
		if (!last || !String(last.text || "").trim()) {
			/* 🔴 第 19 批：读不到助手正文时，**先把宿主自己给的失败原因落地**。
			 *    实测（2026-09-16）：宿主 `turn/end` 的 `reason.error` 里带着
			 *      `{ message:"Insufficient Balance", code:"QUOTA", status:402 }`
			 *    —— 简报投到了、运行也**真的启动了**，只是模型侧拒绝。
			 *    旧代码只写「只有用户侧条目，没有助手回复（跑了但没产出，或还在跑）」：
			 *    用户看到这句**无从处置**（配额问题会被当成插件坏了）。
			 *    ⇒ 三类原因必须**可分辨**：无条目 / 宿主报错 / 只有用户侧条目（纪律 18、58）。 */
			const fail = r.endFailure || null;
			/* 🔴 第 41 轮 `T-PLUG-043`：**观测到配额类失败就落一份备忘**。
			 *    为什么必须落在这里：这是全仓**唯一**能拿到宿主 `turn/end` 失败原因的地方
			 *    （`session-io.js#readSessionOutput` 的 `endFailure`）。
			 *    落盘后，「派发前配额预检」才有源可读 —— 否则用户下次点派发，
			 *    8 条简报会**白投一遍**（模型侧仍然拒绝，界面再出 8 个失败框）。 */
			try { writeQuotaMemo(fail); } catch (e) { /* 备忘写失败不改回收结论 */ }
			const failText = fail && fail.message
				? "宿主本轮运行失败：" + fail.message
					+ (fail.code ? "（" + fail.code + (fail.status ? " " + fail.status : "") + "）" : "")
				: null;
			const noOutReason = r.count === 0
				? "事件流里还没有对话条目（简报可能还没被处理）"
				: (failText || "只有用户侧条目，没有助手回复（跑了但没产出，或还在跑）");
			patchDispatchItem(it.sessionId, {
				say: "", title: r.title || it.title || null,
				sayReason: noOutReason,
				/* 结构化留痕（新增字段，不改已有契约）：供闸门/面板判「环境阻塞」而非「产品失败」 */
				runFailure: fail,
				collectedAt: Date.now()
			});
			/* 🔴 第 21 批 D3：**读不到就要说为什么**。
			 *    旧版只在"读到产出"时写 `summary` ⇒ 档案里 `summary` 恒为 `null`，
			 *    用户原话「存在自己的会话总结文档」在这一档**完全不可见**。
			 *    `source:"none"` + `ok:false` + `reason` 让"没有总结"变成一个**显式事实**
			 *    而非缺席（纪律 18：跳过/缺席比红更危险）。 */
			try {
				putDossier(it.sessionId, {
					summary: { text: "", at: Date.now(), source: "none", ok: false, reason: noOutReason },
					at: Date.now()
				});
			} catch (e) { /* 档案写失败不改回收结论 */ }
			continue;
		}
		patchDispatchItem(it.sessionId, {
			say: digestOf(last.text, o.maxChars),
			title: r.title || it.title || null,
			sayReason: "", collectedAt: Date.now(),
			assistantCount: assistant.length,
			/* 真读到产出了 ⇒ 上一次的失败留痕必须**清掉**（否则「已产出」与「上轮失败」并存的读数会误导） */
			runFailure: null
		});
		/* 🔴 第 41 轮 `T-PLUG-043`：**真读到产出 ⇒ 配额备忘也必须清掉**。
		 *    它是"上一次失败"的缓存，留着会把**已经恢复**的额度继续当成不足
		 *    （界面会一直说"先充值"，而实际上已经好了）。 */
		try { clearQuotaMemo(); } catch (e) { /* 清失败不改回收结论 */ }
		/* 🔴 第 19 批 R3：把该会话**自己的总结**写进**它自己的档案**
		 *    —— 用户原话「（每个会话）存在自己的会话总结文档」。
		 *
		 *    `source:"collect"` = 正文来自**事件流**（真产出）。
		 *    🔴 绝不拿宿主自动标题（`session/title`）当总结 —— 那是**模型给会话起的名字**，
		 *    当产出用属幻觉级信息（同 `digestOf` 头注释的理由）。
		 *    写失败**不改变回收结论**（回收的真相源是台账，档案是它的分会话投影）。 */
		try {
			putDossier(it.sessionId, {
				summary: { text: digestOf(last.text, 200), at: Date.now(), source: "collect", ok: true },
				at: Date.now()
			});
		} catch (e) { /* 档案写失败不改回收结论 */ }
		read++;
	}

	/* ③ 用**刚读到的产出**重算状态（`partial` 才能与 `done` 分开，见 stateOfSummary 的 ③④） */
	refreshStates((id) => findSummary(rawSessionSummaries(), id), stateOfSummary);

	/* ③′ 把最新状态同步进各会话**自己的档案**。
	 * 🔴 patch 语义 ⇒ **不传 `summary` 就不动它** —— 本轮读不到的会话，
	 *    上一次读到的总结**保留**（产出不会因为本次读取失败而消失）。
	 *    逐条 try：一条写失败不许打断其余（同 `applyDossiers` 的逐条容错）。 */
	const liveNow = readDispatchLog().items;
	for (let i = 0; i < liveNow.length; i++) {
		const it = liveNow[i];
		if (!it || !it.sessionId) continue;
		try {
			putDossier(it.sessionId, {
				state: String(it.state || "unknown"),
				turns: typeof it.turns === "number" ? it.turns : null,
				at: Date.now()
			});
		} catch (e) { /* 单条档案写失败不打断整批 */ }
	}

	const counts = countStates(readDispatchLog().items);
	setDispatchCollect({
		ok: true, total: live.length, read, unread: live.length - read, counts,
		reason: "", verdict: verdictOf(counts)
	});
	const out = readDispatchLog().collect;
	try { await refreshBranchTree(); } catch (e) { /* 血缘刷新失败不影响产出读数 */ }
	return {
		ok: true, at: out.at, total: out.total, read: out.read, unread: out.unread,
		counts, items: readDispatchLog().items.slice(), reason: ""
	};
}

/**
 * 状态计数（纯函数）。
 * @param {Array} items
 * @returns {{done:number,running:number,blank:number,partial:number,unknown:number,failed:number,total:number,say:number}}
 */
export function countStates(items) {
	const c = { done: 0, running: 0, blank: 0, partial: 0, unknown: 0, failed: 0, total: 0, say: 0,
		/* 🔴 第 19 批新增：宿主**自报**的运行失败条数 + 一条样例原因。
		 *    为什么必须单独数：这类"没产出"**不是插件没投出去**，而是模型侧拒绝
		 *    （实测 `Insufficient Balance / QUOTA / 402`）。把它混进"尚无产出"里
		 *    ⇒ 用户会去查插件，而真正该做的是充值/换模型（纪律 58：没跑成与失败可分）。 */
		hostFailed: 0, hostFailWhy: "" };
	(Array.isArray(items) ? items : []).forEach((it) => {
		c.total++;
		const k = String(it.state || "unknown");
		if (c[k] === undefined) c.unknown++;
		else c[k]++;
		if (it.sentOk === false) c.failed++;
		if (it.say && String(it.say).trim()) c.say++;
		if (it.runFailure && it.runFailure.message) {
			c.hostFailed++;
			if (!c.hostFailWhy) {
				c.hostFailWhy = String(it.runFailure.message) + (it.runFailure.code ? "（" + it.runFailure.code + "）" : "");
			}
		}
	});
	return c;
}

/** 一句话总裁定（纯函数，用于界面与消息流）。
 *
 * 🔴 **口径必须与 `data-say` / `read` 一致**：「已产出」只认 **`c.say`（有正文的条数）**。
 *    第 18 轮真机踩到：这里原本用 `c.done`（宿主状态为已完成）⇒ 同一个读数元素里出现
 *    「📥 回收 8/8」与「已产出 1/8 条」**互相矛盾**（8 条其实都产出了，只是 7 条状态还是 running）。
 *    `done` 是**宿主视角**的"这一轮跑完了"，`say` 才是**我们要的**"拿到产出了" —— 两者不是一个量。 */
export function verdictOf(counts) {
	const c = counts || {};
	if (!c.total) return "无分支（还没派发）";
	if (c.failed) return c.failed + "/" + c.total + " 条分支简报未送达 —— 先看这一条，其余读数都不作数";
	if (!c.say) {
		/* 🔴 第 19 批：把「宿主报错」与「还没跑完」分开说 —— 前者用户**可处置**（配额/模型/网络），
		 *    后者只能等。旧文案只有后者，真机上把 `Insufficient Balance` 说成了"可能都在跑"。 */
		if (c.hostFailed) {
			return "全部 " + c.total + " 条尚无产出 —— 宿主侧报错 " + c.hostFailed + " 条（"
				+ (c.hostFailWhy || "原因见台账") + "）：简报**已送达**，是模型侧没出结果";
		}
		return "全部 " + c.total + " 条尚无产出可回收（可能都在跑，或简报未生效）";
	}
	if (c.say === c.total) return c.total + " 条**全部有产出**" + (c.running ? "（其中 " + c.running + " 条仍在跑）" : "");
	if (c.running) return "已产出 " + c.say + "/" + c.total + " 条；另有 " + c.running + " 条仍在运行";
	return "已产出 " + c.say + "/" + c.total + " 条（" + (c.partial || 0) + " 条跑过但未拿到回复"
		+ (c.hostFailed ? "；其中 " + c.hostFailed + " 条宿主报错（" + c.hostFailWhy + "）" : "") + "）";
}

/**
 * 总监的 **next action**（纯函数）。
 *
 * 🔴 这里**不做自动重试 / 不自动再派发** —— 只给"下一步建议"。
 *    理由：第 16 批的教训是"自动动作出错时界面上看不出发生过什么"。
 *    next action 由**人**点，点了之后仍是走同一套有读数的路径。
 *
 * @param {object} counts `countStates()` 结果
 * @param {Array} items 台账条目
 * @returns {{key:string, label:string, why:string}}
 */
export function nextActionOf(counts, items) {
	const c = counts || {};
	const list = Array.isArray(items) ? items : [];
	if (!c.total) return { key: "dispatch", label: "先派发", why: "台账为空" };
	if (c.failed) return { key: "inspect-failed", label: "查未送达的分支", why: c.failed + " 条简报未送达" };
	const partial = list.filter((x) => x.state === "partial");
	if (partial.length) return { key: "inspect-partial", label: "查" + partial.length + "条空转分支", why: "跑了但没拿到助手回复" };
	if (c.running) return { key: "wait", label: "等运行中的分支", why: c.running + " 条仍在跑" };
	if (c.say > 0) return { key: "review", label: "审核并汇总成稿", why: c.say + " 条有产出可汇总" };
	return { key: "recollect", label: "稍后重回收", why: "尚无产出可读" };
}

/**
 * **项目整体判断**（纯函数）—— 第 23 批新增（用户原话「对于**整个项目把控**都是要有的」）。
 *
 * 🔴 与 `verdictOf()` 的分工：
 *   `verdictOf` 说的是**这一批回收动作**的结果（"已产出 3/8 条"）；
 *   `projectVerdict` 说的是**项目现在处在哪**（"本轮未推进，因为环境" / "可进入汇总成稿"）。
 *   旧版只有前者，且被逐条罗列淹没了 ⇒ 用户读完一屏不知道"我这个项目到底动了没有"。
 *
 * @param {object} counts `countStates()` 结果
 * @returns {string}
 */
export function projectVerdict(counts) {
	const c = counts || {};
	if (!c.total) return "尚无分支（还没派发过）";
	if (c.failed) return "❗" + c.failed + "/" + c.total + " 条分支简报**未送达** —— 先处理送达，其余读数都不作数";
	if (!c.say) {
		if (c.hostFailed) {
			return "本轮**未推进**：" + c.total + " 条分支**全部**因**宿主侧**原因未产出（" + (c.hostFailWhy || "见台账")
				+ "）—— 简报**已送达**，是模型侧没出结果；**需先处置环境（配额/模型/网络）再重试**，改代码无用";
		}
		return "本轮**未推进**：" + c.total + " 条分支尚无产出（可能都在跑，或简报未生效）";
	}
	if (c.say === c.total) {
		return "推进 " + c.say + "/" + c.total + " 条" + (c.running ? "（其中 " + c.running + " 条仍在跑）" : "")
			+ " —— **全部维度有产出**，可进入审核与汇总成稿";
	}
	return "推进 " + c.say + "/" + c.total + " 条" + (c.running ? "；" + c.running + " 条仍在跑" : "")
		+ " —— 尚有 " + (c.total - c.say) + " 条待产出";
}

/**
 * 生成**回写给总监**的汇总文本（纯函数）。
 *
 * 🔴 第 23 批重构（用户原话「**总监对语言的整理，对于文字的描述**」）——
 *    旧版是**逐条罗列**：8 条全部无产出时，同一个原因重复印 8 遍（真机实测 822 B，
 *    8 行 × 「产出未读到 —— 宿主本轮运行失败：Insufficient Balance（QUOTA 402）」）。
 *    用户读完 822 个字，得到的信息量 = 「配额不足」4 个字。
 *
 *    新版三段式：
 *      ① **整体判断**（项目动了没有 / 卡在哪 / 该做什么）
 *      ② **有产出的逐条列**（产出是本轮真正要看的，不能合并）
 *      ③ **无产出的按原因归并**（同因合并成一条，但**必须列全维度名** ——
 *         不能因为"归纳"而让用户看不见是哪几条）
 *
 * 🔴 归并的纪律：**合并的是"原因"，不是"条目"**。任何一条分支的名字都必须出现在输出里，
 *    否则"8 条里成了 3 条"会被读成"只派了 3 条"（与 `verdictOf` 头注释同一条教训）。
 *
 * @param {Array} items 台账条目
 * @param {object} counts
 * @returns {string}
 */
export function digestMessage(items, counts) {
	const list = Array.isArray(items) ? items : [];
	const c = counts || countStates(list);
	if (!list.length) return "【总监汇总】尚无分支 —— 先点「按职能派发」建立分支。";
	const produced = list.filter((it) => it.say && String(it.say).trim());
	const silent = list.filter((it) => !(it.say && String(it.say).trim()));
	const out = ["【总监汇总】总评：" + projectVerdict(c)];

	if (produced.length) {
		out.push("─ 已产出 " + produced.length + " 条");
		produced.forEach((it) => {
			out.push("  · " + it.label + "（" + it.state + "｜" + it.stateSource + "）：" + it.say);
		});
	}
	if (silent.length) {
		out.push("─ 未产出 " + silent.length + " 条（同因归并，**维度名一条不少**）");
		const groups = [];
		const idx = Object.create(null);
		silent.forEach((it) => {
			const k = String(it.sayReason || "原因未知");
			if (idx[k] === undefined) { idx[k] = groups.length; groups.push({ why: k, labels: [] }); }
			groups[idx[k]].labels.push(it.label);
		});
		groups.forEach((g) => {
			out.push("  · " + g.labels.length + " 条同一原因：" + g.why);
			out.push("    维度：" + g.labels.join(" / "));
		});
	}
	const nx = nextActionOf(c, list);
	out.push("下一步建议：" + nx.label + "（" + nx.why + "）");
	return out.join("\n");
}

/** 诊断：本模块依赖的两条通道各自是否可用（供探针与降级显示） */
export async function collectChannels() {
	const raws = rawSessionSummaries();
	/* 🔴 第 21 批：口径必须与**树 / 派发**一致（规则 I：同根不得两套口径）。
	 *    旧版 `count = raws.length` 报的是**快照原始数**（含已归档幽灵）——
	 *    实测那一刻树只有 1 行、这里却报 126 ⇒ 同一个"有几条会话"有**两个数**。
	 *    `archivedKnown=false` 表示归档集读不到（此时**不过滤**，与树/派发同处置）。 */
	let arch = null;
	try { arch = await archivedSessionIds(); } catch (e) { arch = null; }
	const aset = Array.isArray(arch) ? new Set(arch) : null;
	const live = aset ? raws.filter((s) => !aset.has(String(s && s.id))) : raws;
	return {
		stateChannel: {
			ok: live.length > 0,
			count: live.length,                              // 存活（= 树上会画出来的条数）
			raw: raws.length,                                // 快照原始（含已归档）
			archived: aset ? raws.length - live.length : null,
			archivedKnown: Array.isArray(arch),
			via: "sessions.list.getSnapshot() − archivedSessionIds()"
		},
		outputChannel: { via: "conversation.scopedSession().history({})", scopeAvailable: Boolean(scopedConversationOf(live.length ? String(live[0].id) : "")) }
	};
}
