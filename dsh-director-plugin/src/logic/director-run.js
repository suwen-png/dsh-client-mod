/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监预处理中枢（03号文 §1.2 五步标准执行逻辑）
 * 引用：03 号文 §1.2
 * 上游：client-entry.js, components/DirectorPage.js, components/DirectorWorkbench.js
 * 下游：logic/duties.js, config/model.js, logic/director-chain.js, logic/dag.js, util/debug.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-run.js — 总监预处理中枢（03号文 §1.2 五步标准执行逻辑）
 *
 * ⚠️ 与 `logic/process.js` 的关系（重要）
 *   `process.js` 是**宿主内联的逐字迁移品**（保真优先，不得顺手优化），
 *   其职责键名沿用宿主旧 5 项，与文档 §3.1 定义不一致。
 *   本模块是**插件侧的完整实现**，严格按文档 §1.2 五步 + §3.1 五项职责 + §4.3 降级。
 *   两者并存是刻意的：**保真归保真，完善归完善**。
 *
 * 依据
 *   §1.2 总监本质（:27-40）：会话预处理中枢。❌不执行业务 ❌不调用工具 ❌不跑业务推理；
 *       ✅索引检索 → 按需加载 → 上下文筛选精简 → 模型路由 → 组装报文 → 写入提交列
 *   §1.2 五步（:35-40）：
 *       1 整理语言  2 判断是否需要切新分支  3 判断是否需要切模型
 *       4 切换分支时判断传哪些上下文      5 自动审核大模型产出
 *   §2.3 完整消息流（:90-121）：②预处理 → ③过程展示 → ④自动转发 → ⑤自动审核
 *   §4.3 降级策略（:236-242）：Ollama 挂 / 超时 / 格式异常 → 降级，不崩溃
 *
 * 梯度（与 `logic/summarize.js` 同套口径）
 *   G1 = 本地模型（Ollama qwen2:7b）参与；G0 = 纯规则降级。
 */

import { cloneDefaultDuties, normalizeDuties } from "./duties.js";
import { callLocalModel, polishLanguage, classifyTask } from "../config/model.js";
/* 🔴 19 号文 N9/F9：五步链的**唯一真相源** —— 顺序由图经 `topoSort()` 现算，
 *    本模块不再自建 1..5（收敛前正是"两份真相源"）。两个依赖都是纯模块（零 side-effect）。 */
import { DIRECTOR_CHAIN } from "./director-chain.js";
import { topoSort } from "./dag.js";
import { dshLog } from "../util/debug.js";

/** 任务类型 → 模型建议（文档 §1.2 第 3 步 / §3.1「调整模型」模板语义）
 * 🔴 19 号文 **P7 N7**：导出这两张表 —— 职能矩阵的"开启时按 tier 选择"判据
 *    必须能拿**期望值**比对，而不是只看"模型名是个字符串"。
 *    ⚠️ 只看字符串会在 `research`/`writing` 上**空真**：那两类本来就映射到
 *    `deepseek-chat`，与"开关关掉后的回落值"**完全同形** ⇒ 判据必须落在
 *    `code`（coder）/ `design`（reasoner）这两类**可分辨**的输入上。 */
export const TASK_MODEL = {
	code: "deepseek-coder",
	design: "deepseek-reasoner",
	research: "deepseek-chat",
	writing: "deepseek-chat",
	chat: "deepseek-chat"
};

export const TASK_NAME = { code: "代码开发", design: "系统设计", research: "资料调研", writing: "文本整理", chat: "日常对话" };

/** 并发保护：同一 store 同时只允许一次处理（沿用 process.js V9.4-P1 语义） */
const running = new WeakSet();

/**
 * 执行总监预处理（五步）
 *
 * @param {object} p
 * @param {string} p.sessionId
 * @param {string} p.userText 用户原始输入
 * @param {object} p.store 总监 store（createDirectorStore 产物，需有 addMessage/setStatus/getState）
 * @param {object} [p.duties] 生效职责配置（resolveDuties 结果）；缺省用文档默认
 * @param {object} [p.config] 模型配置（localModel.endpoint/model/enabled）
 * @param {boolean} [p.autoForward=false] 是否自动转发到原对话（§2.3 ④）
 * @param {(instruction:string)=>void} [p.onForward] 转发回调
 * @param {{taskId:string, note:string}|null} [p.taskNote]
 *        当前任务的**补充说明**（V20 需求 3）。🔴 **最多一条**，由调用方从
 *        `directorLayoutStore.getActiveTaskNote(scopeKey)` 取 —— 这里**不查表、不遍历**，
 *        所以上下文增量与"用户总共写了多少条说明"**无关**（O(1)）。
 *        为 `null` / `note` 为空时**什么都不加**，也不编占位文案（纪律 19）。
 * @returns {Promise<{steps: Array<{n:number,name:string,enabled:boolean,grade:string,text:string}>,
 *                    instruction: string, model: string, branch: string, taskType: string,
 *                    reasoning: string, taskNote: object|null,
 *                    forward: {done:boolean, at?:number}}>}
 */
/**
 * 由图**现算**执行计划（纯函数 · 19 号文 N9/F9 的收敛支点）。
 *
 * 抽成导出函数是为了**可测**：套件要能注入"图上多一步而本版本未实现"或
 * "图顺序与默认不同"的情形，验证
 *   ① 顺序**随图变**（而不是写死的）；
 *   ② 缺失实现时**可分辨地降级**、**不抛穿**（执行链上的模块抛穿会让整条链失效）。
 *
 * @param {Array} chain 步骤声明（如 `DIRECTOR_CHAIN`）
 * @param {string[]} implIds 本版本**已实现**的步骤 id（调用方传 `Object.keys(IMPL)`，
 *        这样"实现了哪些"只有一处真相源，不会出现第三份清单）
 * @returns {Array<{id:string, n:number, implemented:boolean}>}
 *          顺序 = `topoSort()` 拓扑序；图上成环（`null`）⇒ **降级为声明顺序**，不抛。
 */
export function chainPlan(chain, implIds) {
	const list = Array.isArray(chain) ? chain : [];
	const order = topoSort(list) || list.map((s) => String(s ? s.id : ""));
	const have = Array.isArray(implIds) ? implIds.map(String) : [];
	return order.map((id, i) => ({ id: id, n: i + 1, implemented: have.indexOf(String(id)) >= 0 }));
}

export async function runDirector({
	sessionId, userText, store, duties, config,
	autoForward = false, onForward, taskNote = null
}) {
	const d = normalizeDuties(duties || cloneDefaultDuties());
	const cfg = config || { localModel: { enabled: false } };
	const steps = [];
	/* 🔴 19 号文 **N9 / F9**：五步链收敛为**单一真相源** —— 执行顺序由图经
	 *    `chainPlan()`（内部 `dag.js#topoSort()`）**现算**，见下方实现表之后的循环。
	 *    ⚠️ 收敛前这里是自建的 `push(1..5)`：既**无 id**、顺序又**硬编码**；
	 *      而面板与闸门按 `DIRECTOR_CHAIN` 展示 ⇒ **两份真相源**（F9 缺口）。 */
	/* 各步的中间结果（实现表读写它；**顺序**由图算，不在实现表里） */
	const ctx = {
		polished: String(userText == null ? "" : userText),
		branch: "沿用当前分支",
		model: "deepseek-chat",
		context: "",
		review: ""
	};

	if (store && running.has(store)) {
		throw new Error("总监正在处理上一条指令，请稍候");
	}
	if (store) running.add(store);

	try {
		/* 🔴 先取**上屏前**的状态快照：`history` 的语义是「本条之前的上下文」，
		 *    若在 addMessage 之后取，当前这条会被重复算进 history。
		 */
		const state = store ? store.getState() : { messages: [] };
		const history = (state.messages || []).slice(-10)
			.map((m) => `${m.role}: ${m.content}`).join("\n");
		const taskType = classifyTask(userText);

		/* ── V20 需求 3：当前任务的补充说明（**单条**注入）──────────────────
		 *  用户原话：「在执行的时候读取尽量不影响上下文？不确定具体执行逻辑，
		 *             怎么添加可以不影响上下文，如果可行的话」
		 *  ⇒ 只注入**一条**、且由调用方定位好（`taskNote.taskId`）；
		 *    这里不做表扫描 ⇒ 增量与"说明总条数"无关。
		 *  ⚠️ 三处模型调用都拼上：职责开关是**用户可关的**，只拼在第一步
		 *     ⇒ 一旦用户关掉「语言润色」，补充说明就**静默失效**
		 *     （表现是"写了没用"，最难查的一类）。三处拼同一条，总量仍是常数。
		 *  ⚠️ 缺省/空串 ⇒ **一个字都不加**，不写"（无补充说明）"这类占位 ——
		 *     占位会挤占模型注意力，且让"有没有写"在回显里无法分辨。 */
		const noteText = (taskNote && typeof taskNote.note === "string") ? taskNote.note.trim() : "";
		const noteBlock = noteText
			? ("\n\n## 当前任务的补充说明（" + String(taskNote.taskId || "") + "）\n" + noteText)
			: "";

		/* ── §2.3 消息流 ①：用户消息**立即上屏** ──
		 * 必须在执行 5 步之前写入。原因：步骤 1/2/3 会调用本地模型（单次超时
		 * `LOCAL_MODEL_TIMEOUT_MS = 60s`，串行最多 3 次）——若把用户消息放在末尾，
		 * 模型不可用时用户会**盯着空面板等最长数分钟**，误以为「发送没反应」。
		 * 实测（2026-09-12）确实如此：点击发送后 1.8s 内消息区零变化。
		 */
		if (store) {
			store.addMessage({ role: "user", content: userText });
			store.setStatus("running");
		}

		/* ══════════════════════════════════════════════════════════════════
		 * 五步链的**实现表**（key = `DIRECTOR_CHAIN` 的 id）
		 *   🔴 **顺序不在这里** —— 一旦写在这里，就又是一份硬编码顺序（N9 的病因）。
		 *   每张实现返回 `{name, enabled, grade, text}`，并把中间结果写进 `ctx` 供后续步骤读。
		 * ══════════════════════════════════════════════════════════════════ */
		const IMPL = {
			/* ── ① 整理语言（§1.2 ①） ── */
			polish: async () => {
				let polished = ctx.polished;
				let g = "G0";
				if (d.languagePolish.enabled) {
					polished = polishLanguage(userText);
					if (cfg.localModel?.enabled) {
						const out = await callLocalModel(
							d.languagePolish.prompt + "\n\n## 用户输入\n" + userText + noteBlock
							+ "\n\n请只输出整理后的指令本身，不要解释。",
							cfg
						);
						if (out && out.trim()) { polished = out.trim().split("\n")[0]; g = "G1"; }
					}
				}
				ctx.polished = polished;
				return { name: "整理语言", enabled: d.languagePolish.enabled, grade: g, text: polished };
			},

			/* ── ② 判断是否需要切新分支（§1.2 ②） ── */
			branch: async () => {
				let branch = "沿用当前分支";
				let g = "G0";
				if (d.branchSwitch.enabled) {
					const prev = (state.messages || []).filter((m) => m.role === "user").slice(-1)[0];
					branch = prev ? judgeBranch(prev.content, userText) : "新会话首条 → 沿用当前分支";
					// 分支判断属语义连续性判定，规则不足以覆盖时交本地模型
					if (cfg.localModel?.enabled) {
						const out = await callLocalModel(
							d.branchSwitch.prompt + "\n\n## 上一条用户消息\n" + (prev ? prev.content : "(无)")
							+ "\n\n## 当前用户消息\n" + userText + noteBlock
							+ "\n\n只回答：连续 或 不连续，并给一句理由。",
							cfg
						);
						if (out) {
							g = "G1";
							branch = /不连续/.test(out) ? "建议开新分支（" + out.trim().slice(0, 40) + "）" : "沿用当前分支";
						}
					}
				}
				ctx.branch = branch;
				return { name: "切换分支", enabled: d.branchSwitch.enabled, grade: g, text: branch };
			},

			/* ── ③ 判断是否需要切模型（§1.2 ③） ── */
			model: async () => {
				let model = "deepseek-chat";
				let g = "G0";
				if (d.modelRouting.enabled) {
					model = TASK_MODEL[taskType] || "deepseek-chat";
					if (cfg.localModel?.enabled) {
						const out = await callLocalModel(
							d.modelRouting.prompt + "\n\n## 用户输入\n" + userText + noteBlock
							+ "\n\n## 规则初判\n任务类型=" + (TASK_NAME[taskType] || taskType) + "，建议=" + model,
							cfg
						);
						if (out) {
							g = "G1";
							const m = out.match(/(deepseek-[a-z]+)/);
							if (m) model = m[1];
						}
					}
				}
				ctx.model = model;
				return { name: "调整模型", enabled: d.modelRouting.enabled, grade: g,
					text: "任务类型=" + (TASK_NAME[taskType] || taskType) + " → " + model };
			},

			/* ── ④ 上下文筛选（§1.2 ④） ── */
			context: async () => {
				let context = "";
				let g = "G0";
				if (d.contextFilter.enabled) {
					const needSwitch = /新分支/.test(ctx.branch) || ctx.model !== "deepseek-chat";
					if (needSwitch) {
						context = pickContext(state.messages || [], userText, 5);
						g = "G0";
					} else {
						context = "无需切换 → 传递完整上下文";
					}
				} else {
					context = "职责未启用 → 不筛选";
				}
				ctx.context = context;
				return { name: "上下文筛选", enabled: d.contextFilter.enabled, grade: g, text: context };
			},

			/* ── ⑤ 自动审核产出（§1.2 ⑤ / §2.3 ⑤） ──
			 * 注意：本步审核的是「总监组装出的待提交报文」是否符合原始需求（§3.1 模板语义：
			 * "大模型返回结果后，自动审核文档/代码是否符合原始需求"）。
			 * 真实的大模型产出在转发之后才产生，故此处先产出**审核结论占位 + 规则自检**，
			 * 由 `reviewOutput()` 在拿到产出后调用；本步负责登记开关与规则自检结果。 */
			review: async () => {
				let review = "职责未启用 → 跳过审核";
				const g = "G0";
				if (d.outputReview.enabled) {
					const r0 = reviewOutput(userText, ctx.polished, d);
					review = r0.passed ? "自检通过" : "发现 " + r0.issues.length + " 项问题：" + r0.issues.join("；");
				}
				ctx.review = review;
				return { name: "自动审核产出", enabled: d.outputReview.enabled, grade: g, text: review };
			}
		};

		/* 🔴 **执行 = 按图算出的顺序遍历实现表**。`chainPlan` 的同时给出
		 *    「本版本实现了哪些」—— 图上新增步骤而这里未实现时
		 *    **可分辨地降级**（记一条 `enabled:false` + 明文原因），**不静默少跑** —— 纪律 19。 */
		for (const st of chainPlan(DIRECTOR_CHAIN, Object.keys(IMPL))) {
			const impl = IMPL[st.id];
			if (!impl) {
				steps.push({ id: st.id, n: st.n, name: st.id, enabled: false, grade: "G0",
					text: "本版本未实现该步骤（声明图已含它）⇒ 降级为跳过（**不静默**）" });
				continue;
			}
			const r = await impl();
			steps.push({ id: st.id, n: st.n, name: r.name, enabled: r.enabled, grade: r.grade, text: r.text });
		}

		/* 回填：后续报文组装沿用既有局部名（**新增 `id` 字段、不改既有字段** —— 冻结契约只增） */
		const polished = ctx.polished;
		const branch = ctx.branch;
		const model = ctx.model;
		const context = ctx.context;
		const review = ctx.review;

		/* ── 组装报文 + 写入总监对话流（§2.3 ③） ── */
		const reasoning = steps
			.filter((s) => s.enabled)
			.map((s) => `${s.n}. ${s.name}（${s.grade}）：${s.text}`)
			.join("\n");
		const payload = {
			instruction: polished,
			model, branch, taskType, reasoning,
			steps,
			/* 注入留痕：`null` = 本条没有可注入的补充说明（**不是**"没有这个功能"）。
			 * 落进 payload 是为了让"到底注没注"在数据上可查，而不是只能看日志。 */
			taskNote: noteText ? { taskId: taskNote.taskId || "", chars: noteText.length } : null
		};

		if (store) {
			// 用户消息已在上屏前置入（见函数开头），此处只补总监回复
			store.addMessage({
				role: "assistant",
				content: "【总监分析】\n" + (reasoning || "（全部职责已关闭，原文直转）"),
				parsed: payload
			});
			store.setStatus("done");
		}

		/* ── 自动转发（§2.3 ④） ── */
		const forward = { done: false };
		if (autoForward && typeof onForward === "function") {
			// 300ms 延迟沿用宿主原实现（等 UI 落定），勿改
			await new Promise((r) => setTimeout(r, 300));
			onForward(polished);
			forward.done = true;
			forward.at = Date.now();
		}

		dshLog("director", "runDirector done: session=" + sessionId + " taskType=" + taskType
			/* 🔴 N9 收敛后 grade 串**由实际执行的步骤派生**（顺序/条数随图走）。
			 *    收敛前这里是手写的 `[g1..g5]` —— 图上一加步，日志就开始"少报一步"却没人发现。 */
			+ " grade=" + steps.map((s) => s.grade).join("/") + " forward=" + forward.done);

		return { steps, instruction: polished, model, branch, taskType, reasoning, forward, payload,
			noteInjected: payload.taskNote ? payload.taskNote : null };
	} catch (e) {
		/* 🔴 失败不得静默：用户消息已经上屏，若不补一条回复，面板会永远停在
		 * 「发出去了但没有任何反应」的状态（比直接报错更难排查）。
		 */
		if (store) {
			store.addMessage({
				role: "assistant",
				content: "【总监异常】" + (e && e.message ? e.message : String(e))
			});
			store.setStatus("error");
		}
		throw e;
	} finally {
		if (store) running.delete(store);
	}
}

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installDirectorRunApi() {
	if (typeof window === "undefined") return null;
	window.__dshDirectorRun = {
		run: runDirector,
		judgeBranch,
		pickContext,
		reviewOutput
	};
	return window.__dshDirectorRun;
}

/* ── 纯函数（无副作用，可直接单测）── */

/**
 * 分词：空格词 ∪ CJK 二字组（bigram）
 *
 * 🔴 为何必须加 CJK bigram：中文**没有空格**，`split(/\s+/)` 会把整句
 *    「实现三级总监结构对话级文件夹级全局级」当成 **1 个词** ——
 *    实测导致 `reviewOutput` 的「核心关键词丢失」检查因 `srcW.length < 3` 被整段跳过，
 *    产出「好的，我明白了。」也被判为**通过**（假阴性，漏报）。
 *    二字组是无空格语言上最小可用的语义单元（单字噪声过大）。
 */
export function tokenize(text) {
	let t = String(text || "").toLowerCase();
	// 🔴 必须在 CJK 与拉丁/数字之间插空格，否则「改成jwt鉴权」整体成 1 个词，
	//    其中的 `jwt` 无法作为独立 token 参与重合度计算（实测致同主题被判为话题切换）。
	t = t.replace(/([\p{Script=Han}])([\p{L}\p{N}])/gu, "$1 $2")
		.replace(/([\p{L}\p{N}])([\p{Script=Han}])/gu, "$1 $2");
	const out = new Set();
	// 空格/标点分词（覆盖英文、数字、代码标识符）
	for (const w of t.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
		if (w.length > 1) out.add(w);
	}
	// CJK 二字组
	const cjk = t.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu);
	if (cjk && cjk.length >= 2) {
		for (let i = 0; i < cjk.length - 1; i++) out.add(cjk[i] + cjk[i + 1]);
	} else if (cjk && cjk.length === 1) {
		out.add(cjk[0]);
	}
	return out;
}

/**
 * 分支连续性判定（规则版，G0）
 * 依据：共享实词比例 —— 低于阈值视为话题切换。
 */
export function judgeBranch(prevText, curText, threshold = 0.15) {
	const a = tokenize(prevText);
	const b = tokenize(curText);
	if (!a.size || !b.size) return "沿用当前分支";
	let hit = 0;
	for (const w of b) if (a.has(w)) hit++;
	const ratio = hit / b.size;
	return ratio >= threshold ? "沿用当前分支" : "建议开新分支（与上文无实质关联）";
}

/**
 * 上下文片段筛选（G0）：按与当前输入的词重合度打分取 TopN
 * @param {Array<{role:string,content:string}>} messages
 * @param {string} query
 * @param {number} limit
 */
export function pickContext(messages, query, limit = 5) {
	const kw = new Set(String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 1));
	const scored = (messages || [])
		.filter((m) => m && typeof m.content === "string")
		.map((m, i) => {
			const words = m.content.toLowerCase().split(/\s+/);
			const hit = words.filter((w) => kw.has(w)).length;
			return { i, role: m.role, score: hit, text: m.content.slice(0, 60) };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score || b.i - a.i)
		.slice(0, limit);
	if (!scored.length) return "无相关历史片段 → 不携带上下文";
	return scored.map((x) => `#${x.i}(${x.role}) ${x.text}`).join("\n");
}

/**
 * 自动审核产出（§1.2 ⑤ / §3.1「自动审核产出」）
 * 规则版 G0：零模型、零网络，永不抛错（§4.3 降级底线）。
 *
 * @param {string} original 用户原始需求
 * @param {string} output 待审核产出（此处为总监组装的指令；拿到大模型产出后同理调用）
 * @param {object} [duties]
 * @returns {{passed: boolean, issues: string[], grade: string}}
 */
export function reviewOutput(original, output, duties) {
	const issues = [];
	const o = String(output || "").trim();
	const src = String(original || "").trim();
	if (!o) issues.push("产出为空");
	if (src.length > 8 && o.length < src.length * 0.3) issues.push("产出过短，疑似丢失核心意图");
	// 核心实词保留度检查（tokenize 含 CJK 二字组，避免中文整句被当 1 词而跳过）
	const srcW = [...tokenize(src)];
	if (srcW.length >= 3) {
		const outW = tokenize(o);
		const lost = srcW.filter((w) => !outW.has(w)).length;
		if (lost / srcW.length > 0.7) issues.push("核心关键词丢失过多（" + lost + "/" + srcW.length + "）");
	}
	if (duties?.outputReview?.enabled === false) issues.length = 0; // 未启用 → 恒通过
	return { passed: issues.length === 0, issues, grade: "G0" };
}
