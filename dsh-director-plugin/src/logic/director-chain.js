/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：总监五步链的声明式依赖图（纯数据，零依赖）
 * 引用：03 号文 §1.2
 * 上游：components/OrchestratorPanel.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V21-多智能体编排架构补全设计稿.html【板块 三（五步链的声明式依赖图：纯数据，视图与闸门共用同一份）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-chain.js — 总监五步链的声明式依赖图（纯数据，零依赖）
 *
 * ══════════════════════════════════════════════════════════════════
 *  为什么单独一个模块（而不是写在组件里）
 * ══════════════════════════════════════════════════════════════════
 *  这份图是「编排」这件事的**核心数据**，不是某一块界面的私产。
 *  它原先定义在 `components/OrchestratorPanel.js` 内部，后果是：
 *    ① 任何想读它的代码都得先能解析组件 —— 而组件 import react，
 *       本仓库按 ADR-001 **不装 node_modules**（react 由平台 factory 提供）
 *       ⇒ 离线闸门 `import` 它直接 ERR_MODULE_NOT_FOUND；
 *    ② 真机闸门于是只能把节点数/波次**硬编码**，产品一改就假红。
 *  提到 `logic/` 后：数据归数据、视图归视图，`dag.js` 的现算能力两边都能用。
 *
 * ── 图的内容（来源：03 号文 §1.2 的五步）─────────────────────────
 *   落地为声明式步骤图后，三件事变成可计算的：
 *     ① 依赖关系（谁必须等谁）
 *     ② 波次由 `planWaves()` 现算 —— 没有任何写死的顺序数组
 *     ③ 「切换分支」与「调整模型」互不依赖 ⇒ 同一波，可并行
 *
 *   🔴 如实标注现状：`director-run.js` 目前仍是**串行**执行这两步。
 *      图上"可并行"是结构事实，运行时"还串行"也是事实 —— 两个都写出来，
 *      由面板在 `dp-orch-parallel-note` 明示，不假装已经并行。
 *
 *  用法：
 *    import { DIRECTOR_CHAIN } from "./director-chain.js";
 *    const g = normalizeGraph(DIRECTOR_CHAIN);      // 来自 dag.js
 *    const waves = planWaves(g, { concurrency: 2 }); // 波次现算
 */

/** 五步链的声明式步骤（字段语义见 dag.js 的 normalizeStep） */
export const DIRECTOR_CHAIN = [
	{ id: "polish", role: "polisher", output: "polished", task: "整理语言：口语 → 精确指令" },
	{ id: "branch", role: "branch-judge", output: "branch", depends_on: ["polish"], task: "判定话题连续性 / 是否需要新分支" },
	{ id: "model", role: "model-router", output: "model", depends_on: ["polish"], task: "按任务类型选模型档" },
	{ id: "context", role: "context-picker", output: "ctx", depends_on: ["branch", "model"], task: "筛选需要传递的上下文片段" },
	{ id: "review", role: "output-reviewer", output: "verdict", depends_on: ["context"], task: "审核产出是否符合原始需求" }
];

/** 一条人工闸门的示范（用于展示「闸门长什么样」，不冒充已有数据 —— 故恒为 null） */
export const GATE_SAMPLE = null;
