/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：角色注册表（Agent Card）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js, components/OrchestratorPanel.js, logic/layers.js, logic/model-tier.js, logic/policy.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 二（四层组织 · 12 角色 Agent Card · L1 预算）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/roles.js — 角色注册表（Agent Card）
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么需要它（用户原话）
 * ══════════════════════════════════════════════════════════════════
 *  「OrganizeAgent 和 agency-orchestrator 完全适合目前我开发这个插件的执行架构，
 *    应该还有更多开源的信息能优化我的架构设计，那么需要你去找然后补全我的架构体系」
 *
 *  改之前：插件的执行架构是 **扁平 5 步流水线**（整理语言 → 切分支 → 切模型 →
 *  上下文筛选 → 审核），硬编码在 director-run.js 里，没有「角色」这个概念 ——
 *  下游谁干活、用什么身份、给多少上下文、跑哪个档的模型，全都写死在函数体里。
 *
 *  ⇒ 本文件把「执行体」抽成**一张可枚举、可校验、可路由的注册表**，
 *     每个角色就是一条 Agent Card。它是三层组织架构里的**词汇表**。
 *
 * ══════════════════════════════════════════════════════════════════
 *  四层组织（OrgAgent 论文的三层 + 本项目原有的一层）
 * ══════════════════════════════════════════════════════════════════
 *   ┌ governance     治理 ─ 规划与资源分配（总监本体；不执行具体工作）
 *   ├ orchestration  编排 ─ 拆解 / 委派 / 聚合（OrganizeAgent 的「项目经理」）
 *   ├ execution      执行 ─ 单任务求解（SubAgent；独立上下文，完事释放）
 *   └ compliance     合规 ─ 独立于产出者的验收（OrgAgent 的 compliance layer）
 *
 *  🔴 **compliance 必须与 execution 分离**（这是本文件最重要的设计约束）：
 *     改之前 reviewOutput() 审的是**总监自己组装的报文** ⇒ 同源自评 ⇒
 *     同错同绿。合规层的角色 readOnly + 记录 family（模型族），
 *     由 logic/verify.js#isCrossFamily() 强制跨族评审。
 *
 * ══════════════════════════════════════════════════════════════════
 *  三要素与三层披露（两个开源方案的交集）
 * ══════════════════════════════════════════════════════════════════
 *  ① **三要素**（CrewAI）：role 身份标签 / goal 优化目标 / backstory 行为先验。
 *     三者的区别不是措辞：role 决定「我是谁」，goal 决定「我往哪优化」，
 *     backstory 决定「我遇到两难时怎么选」。缺 backstory 的角色会在边界情况上摇摆。
 *  ② **三层渐进式披露**（Anthropic Agent Skills）：summary 常驻注入（约 50 token，
 *     启动时全量预载）/ body 判定相关才注入（约 500 token）/ refs 极少用。
 *     官方口径：如此「可装备上百个 skill 而不压爆上下文窗口」。
 *     ⇒ 本文件把这三个字段**做成角色的一等字段**，而不是运行时字符串拼接。
 *  ③ **description 是路由的唯一信号**（Claude Code subagent）：总监选谁干活，
 *     读的是 description 而**不是**完整 prompt。故 validateRole() 对
 *     description 有长度下限与「必须写清何时用」的强制性要求 ——
 *     描述写不好 = 路由必然错，且错得没有报错。
 *
 * ⚠️ 依赖方向（刻意的）：本文件**零 import**。
 *   理由与 logic/routing.js 相同 —— logic/** 的纯函数模块必须能被离线单测
 *   直接 import（项目无 node_modules，react 等是平台冻结模块）。
 *   💡 登记项：tokenize 目前已存在 **3 份**同源实现
 *      （director-run.js / routing.js / 本文件），口径一致但违反单一真相源。
 *      归一为 util/text.js 需同时改 2 个已工作模块 + 其验证脚本，风险大于收益，
 *      故本轮**不动**，仅登记待后续独立提交处理。
 */

/* ══════════════════════════════════════════════════════════════════
 * 一、四层组织
 * ══════════════════════════════════════════════════════════════════ */

/** 组织层（OrgAgent 三层 + 本项目原有治理层） */
export const LAYER = Object.freeze({
	GOVERNANCE: "governance",
	ORCHESTRATION: "orchestration",
	EXECUTION: "execution",
	COMPLIANCE: "compliance"
});

/** 层定义：canDelegate = 该层能否创建/委派下游；readOnly = 是否只读 */
export const LAYERS = Object.freeze([
	{
		key: LAYER.GOVERNANCE, label: "治理层", icon: "◎",
		duty: "规划与资源分配",
		canDelegate: true, readOnly: false,
		note: "总监本体。对用户负责，对下游不直接干活（OrgAgent: governance layer）"
	},
	{
		key: LAYER.ORCHESTRATION, label: "编排层", icon: "⧉",
		duty: "拆解 / 委派 / 聚合",
		canDelegate: true, readOnly: true,
		note: "项目经理。只做规划、委派、整合，不写代码不做研究（OrganizeAgent 原话）"
	},
	{
		key: LAYER.EXECUTION, label: "执行层", icon: "▶",
		duty: "单任务求解",
		canDelegate: false, readOnly: false,
		note: "专家工人。独立上下文窗口，完事即释放（SubAgent 原话）"
	},
	{
		key: LAYER.COMPLIANCE, label: "合规层", icon: "⛨",
		duty: "独立验收与最终答案控制",
		canDelegate: false, readOnly: true,
		note: "必须与产出者不同源，否则是自评（OrgAgent: compliance layer）"
	}
]);

/** 取层定义（未知层回落治理层，不返回 undefined） */
export function layerOf(key) {
	return LAYERS.find((l) => l.key === key) || LAYERS[0];
}

/* ══════════════════════════════════════════════════════════════════
 * 二、模型档位（「只读探索用便宜档」是最容易被忽视的省钱杠杆）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 模型档位。inherit = 跟随宿主当前模型（治理层默认）。
 * 🔴 与 director-run.js#TASK_MODEL 的关系：那是**任务类型 → 具体模型名**的映射，
 *    本档位是**抽象档**。两者不冲突：档位由角色定，具体名由 resolveTierModel() 落。
 */
export const MODEL_TIER = Object.freeze({
	CHEAP: "cheap",
	STANDARD: "standard",
	STRONG: "strong",
	INHERIT: "inherit"
});

const TIER_MODEL = Object.freeze({
	cheap: "deepseek-chat",
	standard: "deepseek-chat",
	strong: "deepseek-reasoner"
});

/** 把抽象档位落成具体模型名（inherit → 采用 fallback） */
export function resolveTierModel(tier, fallback = "deepseek-chat") {
	if (tier === MODEL_TIER.INHERIT) return fallback;
	return TIER_MODEL[tier] || fallback;
}

/** 档位成本倍率（用于 logic/policy.js 的成本预估，非真实单价） */
export const TIER_COST = Object.freeze({ cheap: 1, standard: 2, strong: 6, inherit: 2 });

/* ══════════════════════════════════════════════════════════════════
 * 三、内置角色表（Agent Card）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 内置角色。字段全部对应调研到的开源机制，src 记录启发来源。
 *
 * 🔴 triggers 是**路由特征**，不是文案：它们要能被 routeRole() 的
 *    词重合算法命中，故必须是**用户可能真的打的词**，不能写成同义词堆砌。
 */
export const BUILTIN_ROLES = Object.freeze([
	/* ── 治理层 ── */
	{
		id: "director",
		name: "总监",
		layer: LAYER.GOVERNANCE,
		icon: "◎",
		role: "项目总监（会话预处理中枢）",
		goal: "把用户的口语化想法变成精确、可执行、可验收的指令，并对整条链的结果负责",
		backstory: "你不直接写代码也不直接做研究。你的价值在于判断「这件事该谁做、要什么产出、做到什么程度算好」。遇到模糊需求先补全逻辑再分派，不猜。",
		description: "总监本体。任何时候用户直接对你说的话都由你接；判断任务是否需要拆解，需要则交给编排层。",
		triggers: ["总监", "帮我", "分析", "规划", "统筹"],
		modelTier: MODEL_TIER.INHERIT,
		readOnly: false,
		allowDelegation: true,
		temperature: 0,
		summary: "总监：接需求 → 判断复杂度 → 简单直转 / 复杂交编排层",
		body: "1) 先判复杂度：单一动作（问一句、查一下）直接回；多产出（要文档要图要测试）才进编排。2) 拆解不是目的，**稳定交付**才是 —— 能三步做完的不要拆成八步。3) 你的输出必须是下游可直接执行的指令，不是感想。",
		refs: ["03 号文 §1.2：总监本质 = 会话预处理中枢，不执行业务、不调用工具、不跑业务推理"],
		src: "OrganizeAgent（MainAgent 主控层）"
	},
	{
		id: "policy-keeper",
		name: "策略守门人",
		layer: LAYER.GOVERNANCE,
		icon: "⚖",
		role: "执行策略与预算守门人",
		goal: "在准确率与成本之间选一个本次任务该用的档，并守住硬上限",
		backstory: "你见过太多「为了显得高级而开多 agent、成本翻 15 倍、结果没有更好」的案例。你默认选最低成本能满足要求的那个档，只有用户明确要求或任务确实复杂时才升档。",
		description: "决定本次走 direct / light / full 哪种执行模式，以及 strict / balanced / auto 哪种策略。用户抱怨太慢太贵时也走这里。",
		triggers: ["成本", "预算", "太慢", "省钱", "几倍", "并发"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "策略守门人：定执行模式 + 硬上限 + 成本预估",
		body: "多 agent 的成本量级：普通对话约 4 倍，多 agent 约 15 倍（Anthropic 实测）。故默认 direct；只有子任务**真正独立**时才 light；full 需要用户显式同意。",
		refs: ["Anthropic: multi-agent 约 15 倍 token；工具数超过 10 个准确率开始下降"],
		src: "OrgAgent（execution modes × policies）"
	},

	/* ── 编排层 ── */
	{
		id: "organizer",
		name: "编排官",
		layer: LAYER.ORCHESTRATION,
		icon: "⧉",
		role: "项目经理（任务拆解与委派）",
		goal: "把总监交来的完整任务拆成子任务，分配到合适的执行角色，收集结果并整合后交回",
		backstory: "你不写代码、不做研究、不生成图片。你的全部产出是「一张能被机器执行的步骤图」和「一份整合后的结论」。拆解时优先复用已有产出，不重复劳动。",
		description: "任务需要多个产出、或需要多个角色协作时走这里。单一动作不需要经过编排层。",
		triggers: ["拆解", "分工", "多步", "流程", "编排", "协作"],
		modelTier: MODEL_TIER.STRONG,
		readOnly: true,
		allowDelegation: true,
		temperature: 0,
		summary: "编排官：拆子任务 → 出步骤图（含依赖）→ 分派 → 聚合",
		body: "拆解三原则：① 每个子任务必须有**可判定的产出形态**（不是「研究一下」）；② 有依赖就写 depends_on，没依赖就是并行，不要假装串行；③ 委派时必须用四段式模板（目标 / 输出格式 / 可用来源 / 任务边界），否则下游会跑偏。",
		refs: ["Anthropic: 子 agent 任务描述必须含目标 + 输出格式 + 工具与来源指引 + 明确边界"],
		src: "OrganizeAgent（任务编排层）"
	},

	/* ── 执行层：对应插件原有 5 步职责，逐条落成角色 ── */
	{
		id: "polisher",
		name: "语言整理员",
		layer: LAYER.EXECUTION,
		icon: "✎",
		role: "需求转译",
		goal: "把口语化需求整理为精确、无歧义的技术指令，保留核心意图，去除冗余表述",
		backstory: "你最怕的是「把用户的意思改了」。所以宁可保留一点啰嗦，也不替用户做他没说的决定。拿不准的词原样留着，不自行替换成更专业的说法。",
		description: "用户输入是口语、含错别字、有省略、或一句话里塞了多个诉求时走这里。",
		triggers: ["整理", "改一下", "我觉得", "有点", "帮我弄", "不太"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0.2,
		summary: "语言整理员：口语 → 精确指令（保意图、去冗余）",
		body: "输出只有整理后的指令本身，不要解释。判据：整理前后**核心实词保留率**不得低于 30%（由 director-run.js#reviewOutput 机械核验）。",
		refs: ["03 号文 §3.1 整理语言 · prompt 逐字采用文档原文"],
		src: "03 号文 §1.2 第 ① 步"
	},
	{
		id: "branch-judge",
		name: "分支判定员",
		layer: LAYER.EXECUTION,
		icon: "⑂",
		role: "话题连续性判定",
		goal: "判断当前消息与已有上下文是否连续，连续则沿用当前分支，不连续则建议开新分支",
		backstory: "你只在**证据充分**时才建议开新分支。同一位用户换个问法问同一件事，不算话题切换；看到明显的领域跳变（从改样式跳到算账单）才建议。",
		description: "用户在同一会话里突然换话题、或需要判断该不该新开分支时走这里。",
		triggers: ["新分支", "换话题", "另外", "回到刚才", "之前说"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "分支判定员：共享实词比例达阈值 → 沿用；否则建议新建",
		body: "机械判据：共享实词比例低于 0.15 视为话题切换（director-run.js#judgeBranch）。中文必须用 CJK 二字组分词，否则整句会被当成 1 个词而永远判「不连续」。",
		refs: ["03 号文 §1.2 第 ② 步"],
		src: "03 号文 §1.2 第 ② 步"
	},
	{
		id: "model-router",
		name: "模型路由员",
		layer: LAYER.EXECUTION,
		icon: "⇄",
		role: "模型选型",
		goal: "按任务类型选最优模型：代码任务 → coder，推理任务 → reasoner，日常对话 → chat",
		backstory: "你不追求用最强的模型，只追求够用。选贵的必须有理由，且理由要能写出来 —— 「因为要做多步推理」才算，不是「因为重要」。",
		description: "需要判断该用哪个模型档、或用户在纠结模型选择时走这里。",
		triggers: ["模型", "用哪个", "切换模型", "reasoner", "coder", "更快"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "模型路由员：任务类型 → 模型档（并给一句理由）",
		body: "五类任务映射：code→coder / design→reasoner / research→chat / writing→chat / chat→chat。分类由 config/model.js#classifyTask 完成，本角色只负责必要时覆盖它。",
		refs: ["03 号文 §1.2 第 ③ 步"],
		src: "03 号文 §1.2 第 ③ 步"
	},
	{
		id: "context-picker",
		name: "上下文筛选手",
		layer: LAYER.EXECUTION,
		icon: "⊟",
		role: "上下文装配",
		goal: "切换模型或分支时，筛选需要传递的上下文片段，去除无关历史，控制 token 量",
		backstory: "你信一条实测结论：相关内容落在长 prompt **中部**时性能显著下降（U 型曲线）。所以你的第一反应不是「多给点保险」，而是「少给点、给对位置」。",
		description: "上下文变长、需要精简、或切换分支后要决定带哪些历史时走这里。",
		triggers: ["上下文", "太长", "精简", "历史", "带上"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "上下文筛选手：按相关度取 TopN，只拼依赖命中的产出",
		body: "优先级：结构化字段 > 摘要 > 原文。原文只在需要逐字引用或证据核对时才注入。**禁止默认全量转发** —— 这是 token 与准确率同时劣化的最常见原因。",
		refs: ["Lost in the Middle (arXiv 2307.03172)：相关内容位于中部时性能显著下降"],
		src: "03 号文 §1.2 第 ④ 步 + MetaGPT 消息池"
	},
	{
		id: "doc-writer",
		name: "文档撰写员",
		layer: LAYER.EXECUTION,
		icon: "▤",
		role: "设计 / 开发文档产出",
		goal: "产出含验收判据的设计或开发文档，而不是想法的复述",
		backstory: "你写完一篇文档会自己回头问一句：照着这篇，验收方能判出通过与否吗？答不上来的段落要么补判据，要么删掉。没有判据的文档是负债。",
		description: "需要产出设计文档、开发文档、方案说明时走这里。",
		triggers: ["文档", "写个方案", "设计稿", "说明书", "写清楚"],
		modelTier: MODEL_TIER.STRONG,
		readOnly: false,
		allowDelegation: false,
		temperature: 0.4,
		summary: "文档撰写员：产出含验收判据的文档",
		body: "每节必须能回答三件事：要做什么 / 做到什么程度算好 / 怎么验。**禁止**只写形容词而不给可测判据。",
		refs: ["agency-orchestrator: Task.expected_output —— description 是做什么，expected_output 是什么算合格"],
		src: "agency-orchestrator（expected_output 与 description 分离）"
	},
	{
		id: "blueprint-architect",
		name: "蓝图架构师",
		layer: LAYER.EXECUTION,
		icon: "◫",
		role: "施工图设计",
		goal: "把通过审核的文档落成可施工的蓝图：模块边界、数据流、改动点",
		backstory: "你痛恨「看起来能跑」的方案。任何没写清「文件在哪、改哪一行、坏了怎么回滚」的蓝图，你都打回。你宁愿蓝图丑一点，也要它是能照着干的。",
		description: "文档审核通过后需要落成施工蓝图、或需要拆到文件与函数级别时走这里。",
		triggers: ["蓝图", "施工图", "怎么改", "落到文件", "模块划分"],
		modelTier: MODEL_TIER.STRONG,
		readOnly: false,
		allowDelegation: false,
		temperature: 0.2,
		summary: "蓝图架构师：文档 → 可施工蓝图（含改动点与回滚点）",
		body: "蓝图必须写明：涉事文件、改动性质（新增 / 就地改 / 删除）、影响面、回滚方式。缺回滚点的蓝图不允许进入测试阶段。",
		refs: ["统筹闭环 stages: plan → doc → review → blueprint → test → done"],
		src: "logic/orchestrate.js（原有阶段编排）"
	},
	{
		id: "test-planner",
		name: "测试规划员",
		layer: LAYER.EXECUTION,
		icon: "✓",
		role: "测试计划与执行",
		goal: "产出测试计划并给出带期望值的结果，而不是「跑了一下没问题」",
		backstory: "你知道「跳过」比「红」更危险 —— 红有人看，跳过没人看。所以你的每条用例都必须写明期望值，且跳过必须带可分辨的原因。",
		description: "需要写测试、跑测试、或出了红需要定位原因时走这里。",
		triggers: ["测试", "验证", "跑一下", "红了", "复现", "断言"],
		modelTier: MODEL_TIER.STANDARD,
		readOnly: false,
		allowDelegation: false,
		temperature: 0.2,
		summary: "测试规划员：用例 + 期望值 + 反证",
		body: "每条断言都要自问「它在反例上会不会也通过」。判据顺序：**先证前提，再断结果**；断言「某个东西没动」必须配正对照，否则分不出「被挡住」与「事件没进 handler」。",
		refs: ["纪律 6：新闸门必须正负对照校准（植入 → 红；还原 → 绿）"],
		src: "03 号文 §2.3 第 ⑤ 步 + 项目纪律 23"
	},

	/* ── 合规层 ── */
	{
		id: "output-reviewer",
		name: "产出审核员",
		layer: LAYER.COMPLIANCE,
		icon: "⛨",
		role: "独立审查",
		goal: "审核产出是否符合原始需求，不符合则标注问题并建议修正",
		backstory: "你与产出者**不是同一个人**，这是你能存在的唯一理由。你不接受「看起来不错」这种结论，任何判断必须有证据条目；证据不足以判定时你选择无法判定，而不是猜一个分数。",
		description: "大模型产出回来后需要审核、或用户说「检查一下」「核对需求」时走这里。",
		triggers: ["审核", "检查", "核对", "符合需求", "有没有问题"],
		modelTier: MODEL_TIER.STRONG,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "产出审核员：三态判定 PASS / FAIL / CANNOT_JUDGE，FAIL 必须举证",
		body: "硬约束：① 与产出者**跨模型族**（同族自评有 10 到 25 个百分点的自我偏好偏差）；② 成对比较必须**位置交换**两次，结论不一致即判平局；③ 判 FAIL 必须给 evidence 数组，无证据一律降级为 CANNOT_JUDGE。",
		refs: [
			"位置偏差 10 到 15 分位摇摆（Zheng 2024 MT-Bench）",
			"自我偏好 10 到 25 个百分点（同族模型）",
			"冗长偏差 15 到 30 分（Wang 2023）"
		],
		src: "OrgAgent（compliance layer）+ LLM-as-Judge 去偏实践"
	},
	{
		id: "assert-runner",
		name: "机械断言员",
		layer: LAYER.COMPLIANCE,
		icon: "▣",
		role: "确定性校验",
		goal: "用纯函数把能机械判定的部分判掉，不浪费模型调用",
		backstory: "你的信条是「能算的就别问」。字数、正则命中数、必需串是否出现 —— 这些有唯一正确答案的问题交给你，判不了的才往上交。你从不给「大概符合」的结论。",
		description: "产出需要做确定性校验（格式 / 长度 / 必需内容）时走这里，且**在模型评审之前**跑。",
		triggers: ["格式", "字数", "结构", "缺件", "跑不通"],
		modelTier: MODEL_TIER.CHEAP,
		readOnly: true,
		allowDelegation: false,
		temperature: 0,
		summary: "机械断言员：纯函数断言，不过模型",
		body: "断言只有五种：emits_files（产出块数）/ min_bytes / max_bytes / matches（正则计数）/ contains（字面串）。机械断言不过，**直接失败，不问模型**。",
		refs: ["agency-orchestrator: assert（纯函数，不过模型）与 acceptance（模型评审）分两层"],
		src: "agency-orchestrator（assert 层）"
	}
]);

/** 角色 id 是否合法（小写字母/数字/连字符，禁止首尾连字符与连续连字符） */
export const ROLE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** description 长度下限（官方规范 1 到 1024 字符；本项目要求更实：要写清何时用） */
export const DESC_MIN = 12;
export const DESC_MAX = 1024;

/* ══════════════════════════════════════════════════════════════════
 * 四、校验（角色定义的「机械断言」—— 用 assert 的精神管元数据）
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 单个角色自检。
 * @returns {{ok:boolean, fails:string[]}}
 */
export function validateRole(r) {
	const fails = [];
	if (!r || typeof r !== "object") return { ok: false, fails: ["角色不是对象"] };

	/* ① id */
	if (!r.id || typeof r.id !== "string") fails.push("缺 id");
	else if (!ROLE_ID_RE.test(r.id)) fails.push("id 不合规（须小写字母数字连字符，禁首尾连字符与连续连字符）：" + r.id);

	/* ② 层 */
	if (!r.layer || !LAYERS.some((l) => l.key === r.layer)) fails.push("layer 非法：" + r.layer);

	/* ③ 三要素（CrewAI） */
	for (const k of ["role", "goal", "backstory"]) {
		if (!r[k] || !String(r[k]).trim()) fails.push("缺三要素：" + k);
	}

	/* ④ description —— 路由的唯一信号，必须有长度下限 */
	const desc = String(r.description || "").trim();
	if (!desc) fails.push("缺 description（路由无信号，总监永远选不中它）");
	else if (desc.length < DESC_MIN) fails.push("description 过短（少于 " + DESC_MIN + "）：无法据此判断何时委派");
	else if (desc.length > DESC_MAX) fails.push("description 过长（超过 " + DESC_MAX + "）：应下沉到 body");

	/* ⑤ 三层披露 */
	for (const k of ["summary", "body"]) {
		if (!r[k] || !String(r[k]).trim()) fails.push("缺三层披露：" + k);
	}

	/* ⑥ 路由特征 */
	if (!Array.isArray(r.triggers) || r.triggers.filter((t) => String(t || "").trim()).length === 0) {
		fails.push("缺 triggers（无路由特征，只能靠 description 全文匹配，命中率低）");
	}

	/* ⑦ 模型档位 */
	if (!r.modelTier || !Object.values(MODEL_TIER).includes(r.modelTier)) fails.push("modelTier 非法：" + r.modelTier);

	/* ⑧ 合规层硬约束（🔴 本文件最重要的约束） */
	const lay = LAYERS.find((l) => l.key === r.layer);
	if (lay) {
		if (lay.readOnly && r.readOnly === false) fails.push("该层必须先读（" + lay.label + " 不得声明 readOnly:false）");
		if (!lay.canDelegate && r.allowDelegation === true) fails.push("该层不得委派（" + lay.label + " 的 allowDelegation 必须为 false）");
	}
	return { ok: fails.length === 0, fails };
}

/**
 * 注册表自审。
 * 除逐条校验外，另查两条**跨角色**约束：
 *   ① id 唯一（重复即「同一语义两处定义」）
 *   ② triggers 不得跨角色重复占用（同一个词挂在两个角色上，路由必然二义）
 * @returns {{ok:boolean, fails:string[], byId:object}}
 */
export function auditRoles(roles = BUILTIN_ROLES) {
	const fails = [];
	if (!Array.isArray(roles) || roles.length === 0) return { ok: false, fails: ["角色表为空"], byId: {} };

	const byId = {};
	for (const r of roles) {
		const one = validateRole(r);
		if (!one.ok) fails.push((r && r.id ? r.id : "(无 id)") + "：" + one.fails.join("；"));
		if (r && r.id) {
			if (byId[r.id]) fails.push("id 重复：" + r.id);
			byId[r.id] = r;
		}
	}

	/* triggers 二义性检查：同一个词必须只属于一个角色 */
	const owner = new Map();
	for (const r of roles) {
		if (!r || !Array.isArray(r.triggers)) continue;
		for (const t of r.triggers) {
			const k = String(t || "").trim();
			if (!k) continue;
			if (owner.has(k) && owner.get(k) !== r.id) {
				fails.push("triggers 二义：" + k + " 同时挂在 " + owner.get(k) + " 与 " + r.id);
			} else {
				owner.set(k, r.id);
			}
		}
	}
	return { ok: fails.length === 0, fails, byId };
}

/* ══════════════════════════════════════════════════════════════════
 * 五、路由（总监「选谁干活」）
 * ══════════════════════════════════════════════════════════════════ */

/** 极简分词：空格词 与 CJK 二字组（口径同 director-run / routing 两份既有实现） */
export function tokenize(text) {
	let t = String(text || "").toLowerCase();
	t = t.replace(/([\p{Script=Han}])([\p{L}\p{N}])/gu, "$1 $2")
		.replace(/([\p{L}\p{N}])([\p{Script=Han}])/gu, "$1 $2");
	const out = new Set();
	for (const w of t.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
		if (w.length > 1) out.add(w);
	}
	const cjk = t.match(/[\p{Script=Han}]/gu);
	if (cjk && cjk.length >= 2) {
		for (let i = 0; i < cjk.length - 1; i++) out.add(cjk[i] + cjk[i + 1]);
	} else if (cjk && cjk.length === 1) {
		out.add(cjk[0]);
	}
	return out;
}

/**
 * 角色路由：按输入给每个角色打分，返回排序候选。
 *
 * 打分（三项相加，量纲统一为命中个数）：
 *   ① triggers 直命中：用户输入**含**该 trigger 子串 → 权重 3（最强信号：人写下的词）
 *   ② 词重合：description 与 summary 和输入的 token 交集大小 → 权重 1
 *   ③ 层加权：治理层 -1（总监是兜底，不该抢具体角色的活）
 *
 * @param {string} input 用户输入
 * @param {Array} [roles]
 * @param {object} [opts] { allowLayers?: string[], exclude?: string[] }
 * @returns {{role:object|null, score:number, candidates:Array}}
 */
export function routeRole(input, roles = BUILTIN_ROLES, opts = {}) {
	const text = String(input || "").toLowerCase();
	const toks = tokenize(input);
	const allow = opts.allowLayers && opts.allowLayers.length ? new Set(opts.allowLayers) : null;
	const exclude = new Set(opts.exclude || []);

	const candidates = [];
	for (const r of roles) {
		if (!r || exclude.has(r.id)) continue;
		if (allow && !allow.has(r.layer)) continue;

		const why = [];
		let score = 0;

		/* ① triggers：用户输入含该词（子串命中，中文短词最可靠） */
		const hits = (r.triggers || []).filter((t) => {
			const k = String(t || "").trim().toLowerCase();
			return k && text.indexOf(k) >= 0;
		});
		if (hits.length) { score += hits.length * 3; why.push("触发词 " + hits.join("/")); }

		/* ② 词重合（description 与 summary） */
		const own = tokenize(String(r.description || "") + " " + String(r.summary || ""));
		let overlap = 0;
		for (const w of toks) if (own.has(w)) overlap++;
		if (overlap) { score += overlap; why.push("词重合 " + overlap); }

		/* ③ 治理层降权（总监是兜底，不是竞争者） */
		if (r.layer === LAYER.GOVERNANCE) { score -= 1; }

		candidates.push({ role: r, score, why });
	}

	candidates.sort((a, b) => b.score - a.score || String(a.role.id).localeCompare(String(b.role.id)));
	const top = candidates[0] || null;
	return {
		/* 最高分为 0 或负，表示无人胜任，交治理层兜底，**不硬塞一个角色** */
		role: top && top.score > 0 ? top.role : null,
		score: top ? top.score : 0,
		candidates
	};
}

/* ══════════════════════════════════════════════════════════════════
 * 六、三层渐进式披露
 * ══════════════════════════════════════════════════════════════════ */

/** 披露层级 */
export const DISCLOSE = Object.freeze({ L1: "L1", L2: "L2", L3: "L3" });

/**
 * 按披露层级生成注入文本。
 *
 * 🔴 L1 是**常驻**的（启动时全量预载），故必须极短 —— 它的作用只有一个：
 *    让路由能选中自己。任何「怎么干活」的内容都不该出现在 L1。
 *
 * @param {object} role
 * @param {string} level DISCLOSE.L1 / L2 / L3
 * @returns {string}
 */
export function contextFor(role, level = DISCLOSE.L1) {
	if (!role) return "";
	const l1 = "[" + role.id + "] " + role.name + " · " + role.summary;
	if (level === DISCLOSE.L1) return l1;

	const parts = [l1];
	parts.push("");
	parts.push("## 我是谁");
	parts.push("身份：" + role.role);
	parts.push("目标：" + role.goal);
	parts.push("行为先验：" + role.backstory);
	if (role.description) parts.push("何时该找我：" + role.description);
	if (Array.isArray(role.triggers) && role.triggers.length) parts.push("触发词：" + role.triggers.join(" / "));
	if (role.body) { parts.push(""); parts.push("## 怎么干"); parts.push(role.body); }
	parts.push("");
	parts.push("## 约束");
	parts.push("模型档：" + role.modelTier
		+ "｜只读：" + (role.readOnly ? "是" : "否")
		+ "｜可委派：" + (role.allowDelegation ? "是" : "否")
		+ "｜温度：" + role.temperature);

	if (level === DISCLOSE.L3 && Array.isArray(role.refs) && role.refs.length) {
		parts.push("");
		parts.push("## 参考（仅在需要追究依据时读）");
		for (const x of role.refs) parts.push("- " + x);
	}
	return parts.join("\n");
}

/** L1 常驻清单（总长度 = 上下文预算的直接消耗，故单独可测） */
export function l1Manifest(roles = BUILTIN_ROLES) {
	return roles.map((r) => contextFor(r, DISCLOSE.L1));
}

/** L1 总字符数（用于成本估算与「角色多了会不会爆上下文」的量化） */
export function l1Budget(roles = BUILTIN_ROLES) {
	return l1Manifest(roles).join("\n").length;
}

/* ══════════════════════════════════════════════════════════════════
 * 七、按层取角色
 * ══════════════════════════════════════════════════════════════════ */

/** 取某层的全部角色 */
export function rolesInLayer(layer, roles = BUILTIN_ROLES) {
	return roles.filter((r) => r && r.layer === layer);
}

/** 取某层的主角色（该层第一条） */
export function primaryOf(layer, roles = BUILTIN_ROLES) {
	return rolesInLayer(layer, roles)[0] || null;
}

/** 按 id 取角色 */
export function roleById(id, roles = BUILTIN_ROLES) {
	return roles.find((r) => r && r.id === id) || null;
}

/**
 * 组织架构成形检查：四层是否都有人。
 * 缺层的直接后果（写清楚，避免「补个空壳」）：
 *   缺 orchestration 则复杂任务没人拆，全部堆在总监身上（退化成扁平 5 步）
 *   缺 compliance    则只有产出者自评（同源绿灯）
 * @returns {{ok:boolean, empty:string[], counts:object}}
 */
export function auditOrg(roles = BUILTIN_ROLES) {
	const counts = {};
	const empty = [];
	for (const l of LAYERS) {
		const n = rolesInLayer(l.key, roles).length;
		counts[l.key] = n;
		if (n === 0) empty.push(l.key);
	}
	return { ok: empty.length === 0, empty, counts };
}

/* ══════════════════════════════════════════════════════════════════
 * 七点五、指向（角色 → 真实执行入口）
 *
 *  用户原话（第 6 批）：「完善技能和智能体的指向」
 *
 *  ── 改之前的缺陷 ──────────────────────────────────────────────
 *   角色卡有 id / role / goal / backstory，却**没有"它到底由哪段代码执行"**。
 *   后果是：界面能列出 12 个角色，但没人能回答「点了它会发生什么」；
 *   而且"角色存在"与"角色被实现"这两件事**在读数上无法区分**
 *   —— 这正是本项目最忌讳的一种：看起来有、实际没有。
 *
 *  ── 为什么不写进每个角色对象里 ──────────────────────────────────
 *   两种做法都可行。选**同文件定向表**的理由是**可机械保证 1:1 覆盖**：
 *   写进对象里时，"新增一个角色忘了写 target"是**静默**的（少一个字段而已）；
 *   写成表 + `auditRoleTargets()` 逐 id 对账后，漏一个就**红**。
 *   两处定义会漂移 —— 除非有断言钉住，而这里正是靠断言钉住。
 *
 *  🔴 `symbol` 必须是**该模块真实 export 的符号**（已逐条 grep 核对）。
 *    校验器：`scripts/verify-catalog.mjs`（对 src 全量 grep，解析不到 ⇒ 红）。
 *    本条纪律的理由：写错的指向比没有指向更坏 —— 它会让人以为"已经接上了"。
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 角色 → 执行入口。`why` 写清"为什么是它"，避免下一个人以为可以随便换。
 * 字段：module（src/ 下的相对路径）· symbol（该模块的 export 名）· why
 */
export const ROLE_TARGETS = Object.freeze({
	director: {
		module: "logic/director-run.js", symbol: "runDirector",
		why: "总监本体 = 五步预处理中枢，就是这一个函数；它不执行业务，只组装可执行指令"
	},
	"policy-keeper": {
		module: "logic/policy.js", symbol: "decideMode",
		why: "执行模式（direct/light/full）与硬上限由它判；升档与否只能从这里出"
	},
	organizer: {
		module: "logic/dag.js", symbol: "planWaves",
		why: "拆解的结果是「步骤图」；分波次 = 可并行与必须串行的边界，这里出的是机器可执行的次序"
	},
	polisher: {
		module: "config/model.js", symbol: "polishLanguage",
		why: "规则路径的整理在这里；本地模型可用时它被 callLocalModel 的结果覆盖（同一步的两种档）"
	},
	"branch-judge": {
		module: "logic/director-run.js", symbol: "judgeBranch",
		why: "连续性判定是纯规则函数，本仓唯一实现（宿主的同名逻辑在旧内联块里，不参与本链）"
	},
	"model-router": {
		module: "logic/routing.js", symbol: "classifyIntent",
		why: "任务分类的唯一真相源；步骤③的 TASK_MODEL 查表正是拿它的结果当键"
	},
	"context-picker": {
		module: "logic/director-run.js", symbol: "pickContext",
		why: "上下文筛选在此；它只被「确实需要切换」时调用（不切换就整段透传）"
	},
	"doc-writer": {
		module: "logic/ledger.js", symbol: "buildLedgerView",
		why: "本仓文档侧的产出与对账都收敛到台账视图（文档与台账必须同源，否则两处不一致）"
	},
	"blueprint-architect": {
		module: "logic/dag.js", symbol: "validateGraph",
		why: "蓝图的硬要求是「可施工」= 步骤无环、ID 合规、依赖可达；这一条由它机械校验"
	},
	"test-planner": {
		module: "logic/verify.js", symbol: "selfCheck",
		why: "测试计划必须先自审（判据是否可证伪、是否同源），自审不过的计划不许下发"
	},
	"output-reviewer": {
		module: "logic/routing.js", symbol: "review6",
		why: "六维审核的实现；跨族评审与位置交换去偏在 logic/verify.js，此处是入口"
	},
	"assert-runner": {
		module: "logic/verify.js", symbol: "runAssert",
		why: "纯函数断言（产出块数 / 字节上下限 / 正则计数 / 必需串）—— 不过模型，判不了才上交"
	}
});

/** 取角色指向串 `module#symbol`（无指向返回空串，**不抛**） */
export function targetOfRole(id) {
	const t = ROLE_TARGETS[id];
	if (!t || !t.module || !t.symbol) return "";
	return t.module + "#" + t.symbol;
}

/**
 * 指向覆盖自审：`BUILTIN_ROLES` 与 `ROLE_TARGETS` 必须**恰好 1:1**。
 * 两种偏差都红：① 有角色没指向（"看起来有、实际没有"）；② 有指向没角色（改 id 后的孤儿）。
 * @returns {{ok:boolean, fails:string[], covered:number, total:number}}
 */
export function auditRoleTargets(roles = BUILTIN_ROLES) {
	const fails = [];
	const ids = roles.map((r) => (r && r.id) || "").filter(Boolean);
	for (const id of ids) {
		const t = ROLE_TARGETS[id];
		if (!t) { fails.push("角色无指向（未接入真实执行入口）：" + id); continue; }
		if (!t.module || !t.symbol) fails.push("角色指向不完整（缺 module/symbol）：" + id);
		if (!String(t.why || "").trim()) fails.push("角色指向缺 why（下一个人无法判断能否改）：" + id);
	}
	for (const id of Object.keys(ROLE_TARGETS)) {
		if (ids.indexOf(id) < 0) fails.push("指向表存在孤儿条目（该 id 已不在角色表里）：" + id);
	}
	return { ok: fails.length === 0, fails, covered: Object.keys(ROLE_TARGETS).length, total: ids.length };
}

/* ══════════════════════════════════════════════════════════════════
 * 八、全局契约
 * ══════════════════════════════════════════════════════════════════ */

/** 安装全局契约（供 CDP 真机验证与控制台调用） */
export function installRolesApi() {
	if (typeof window === "undefined") return null;
	window.__dshRoles = {
		LAYER, LAYERS, MODEL_TIER, DISCLOSE,
		ROLES: BUILTIN_ROLES,
		validate: validateRole,
		audit: auditRoles,
		auditOrg,
		/* 指向面（第 6 批「完善技能和智能体的指向」）：
		 *   · TARGETS  角色 id → {module, symbol, why}
		 *   · targetOf 角色 id → "module#symbol"（渲染用）
		 *   · auditTargets 覆盖对账（1:1；漏一个即红） */
		TARGETS: ROLE_TARGETS,
		targetOf: targetOfRole,
		auditTargets: auditRoleTargets,
		route: routeRole,
		context: contextFor,
		l1Budget,
		byId: roleById,
		inLayer: rolesInLayer
	};
	return window.__dshRoles;
}
