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
import { dshLog } from "../util/debug.js";

/** 任务类型 → 模型建议（文档 §1.2 第 3 步 / §3.1「调整模型」模板语义） */
const TASK_MODEL = {
	code: "deepseek-coder",
	design: "deepseek-reasoner",
	research: "deepseek-chat",
	writing: "deepseek-chat",
	chat: "deepseek-chat"
};

const TASK_NAME = { code: "代码开发", design: "系统设计", research: "资料调研", writing: "文本整理", chat: "日常对话" };

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
 * @returns {Promise<{steps: Array<{n:number,name:string,enabled:boolean,grade:string,text:string}>,
 *                    instruction: string, model: string, branch: string, taskType: string,
 *                    reasoning: string, forward: {done:boolean, at?:number}}>}
 */
export async function runDirector({
	sessionId, userText, store, duties, config,
	autoForward = false, onForward
}) {
	const d = normalizeDuties(duties || cloneDefaultDuties());
	const cfg = config || { localModel: { enabled: false } };
	const steps = [];
	const push = (n, name, enabled, grade, text) => steps.push({ n, name, enabled, grade, text });

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

		/* ── 步骤 1：整理语言（§1.2 ①） ── */
		let polished = userText;
		let g1 = "G0";
		if (d.languagePolish.enabled) {
			polished = polishLanguage(userText);
			if (cfg.localModel?.enabled) {
				const out = await callLocalModel(
					d.languagePolish.prompt + "\n\n## 用户输入\n" + userText
					+ "\n\n请只输出整理后的指令本身，不要解释。",
					cfg
				);
				if (out && out.trim()) { polished = out.trim().split("\n")[0]; g1 = "G1"; }
			}
		}
		push(1, "整理语言", d.languagePolish.enabled, g1, polished);

		/* ── 步骤 2：判断是否需要切新分支（§1.2 ②） ── */
		let branch = "沿用当前分支";
		let g2 = "G0";
		if (d.branchSwitch.enabled) {
			const prev = (state.messages || []).filter((m) => m.role === "user").slice(-1)[0];
			branch = prev ? judgeBranch(prev.content, userText) : "新会话首条 → 沿用当前分支";
			// 分支判断属语义连续性判定，规则不足以覆盖时交本地模型
			if (cfg.localModel?.enabled) {
				const out = await callLocalModel(
					d.branchSwitch.prompt + "\n\n## 上一条用户消息\n" + (prev ? prev.content : "(无)")
					+ "\n\n## 当前用户消息\n" + userText
					+ "\n\n只回答：连续 或 不连续，并给一句理由。",
					cfg
				);
				if (out) {
					g2 = "G1";
					branch = /不连续/.test(out) ? "建议开新分支（" + out.trim().slice(0, 40) + "）" : "沿用当前分支";
				}
			}
		}
		push(2, "切换分支", d.branchSwitch.enabled, g2, branch);

		/* ── 步骤 3：判断是否需要切模型（§1.2 ③） ── */
		let model = "deepseek-chat";
		let g3 = "G0";
		if (d.modelRouting.enabled) {
			model = TASK_MODEL[taskType] || "deepseek-chat";
			if (cfg.localModel?.enabled) {
				const out = await callLocalModel(
					d.modelRouting.prompt + "\n\n## 用户输入\n" + userText
					+ "\n\n## 规则初判\n任务类型=" + (TASK_NAME[taskType] || taskType) + "，建议=" + model,
					cfg
				);
				if (out) {
					g3 = "G1";
					const m = out.match(/(deepseek-[a-z]+)/);
					if (m) model = m[1];
				}
			}
		}
		push(3, "调整模型", d.modelRouting.enabled, g3, "任务类型=" + (TASK_NAME[taskType] || taskType) + " → " + model);

		/* ── 步骤 4：上下文筛选（§1.2 ④） ── */
		let context = "";
		let g4 = "G0";
		if (d.contextFilter.enabled) {
			const needSwitch = /新分支/.test(branch) || model !== "deepseek-chat";
			if (needSwitch) {
				context = pickContext(state.messages || [], userText, 5);
				g4 = "G0";
			} else {
				context = "无需切换 → 传递完整上下文";
			}
		} else {
			context = "职责未启用 → 不筛选";
		}
		push(4, "上下文筛选", d.contextFilter.enabled, g4, context);

		/* ── 步骤 5：自动审核产出（§1.2 ⑤ / §2.3 ⑤） ── */
		// 注意：本步审核的是「总监组装出的待提交报文」是否符合原始需求（§3.1 模板语义：
		// "大模型返回结果后，自动审核文档/代码是否符合原始需求"）。
		// 真实的大模型产出在转发之后才产生，故此处先产出**审核结论占位 + 规则自检**，
		// 由 `reviewOutput()` 在拿到产出后调用；本步负责登记开关与规则自检结果。
		let review = "职责未启用 → 跳过审核";
		let g5 = "G0";
		if (d.outputReview.enabled) {
			const r0 = reviewOutput(userText, polished, d);
			review = r0.passed ? "自检通过" : "发现 " + r0.issues.length + " 项问题：" + r0.issues.join("；");
			g5 = "G0";
		}
		push(5, "自动审核产出", d.outputReview.enabled, g5, review);

		/* ── 组装报文 + 写入总监对话流（§2.3 ③） ── */
		const reasoning = steps
			.filter((s) => s.enabled)
			.map((s) => `${s.n}. ${s.name}（${s.grade}）：${s.text}`)
			.join("\n");
		const payload = {
			instruction: polished,
			model, branch, taskType, reasoning,
			steps
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
			+ " grade=" + [g1, g2, g3, g4, g5].join("/") + " forward=" + forward.done);

		return { steps, instruction: polished, model, branch, taskType, reasoning, forward, payload };
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
