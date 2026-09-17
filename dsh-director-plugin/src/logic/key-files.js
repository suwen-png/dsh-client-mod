/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：关键文件表（R7「关键文件」Tab 的唯一数据源，**生成式**，勿手改）
 * 引用：—
 * 上游：components/DirectorPage.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V19-界面调整设计稿.html（板块 H / I）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/key-files.js — 关键文件表（**生成式**）
 *
 * 🔴 本文件由脚本生成，**不要手改** —— 手改会被下一次生成覆盖，而且它是
 *    "数字与事实同源"这条纪律的载体：名单/字节/行数全部来自 src/** 的 @map 头。
 *
 * 重新生成：
 *   node dsh-director-plugin/scripts/gen-key-files.mjs
 * 只对账（不写盘，闸门用）：
 *   node dsh-director-plugin/scripts/gen-key-files.mjs --check
 *
 * 字段：
 *   f     相对插件根的源码路径
 *   bytes 文件真实字节数（UTF-8）
 *   lines 行数（按 \n 切）
 *   duty  该模块的职责（抄自它自己的 @map 头）
 *   up    上游（谁引用它）
 *   down  下游（它引用谁）
 */

/** 关键文件表（字节降序） */
export const KEY_FILES = Object.freeze([
	// prettier-ignore
	{ f: "src/components/DirectorPage.js", bytes: 193206, lines: 2834, duty: "总监页（宿主原生 tab 环里的第一个视图）", up: "client-entry.js", down: "store/layout.js, store/hierarchy.js, util/bus.js, store/plugin-db.js, logic/routing.js, logic/branch-tree.js, logic/split-dimensions.js, logic/attribution.js, logic/dim-branch.js, store/split-index.js, logic/lineage.js, logic/director-dispatch.js, logic/director-collect.js, store/dispatch-log.js, util/debug.js, logic/director-run.js, config/model.js, store/duty-config.js, logic/orchestrate.js, logic/flow.js, bridge/chat-bridge.js, store/personalize.js, components/FloatDock.js, components/PersonalizePanel.js, components/OrchestratorPanel.js, util/safe-area.js, logic/ledger.js, store/docs-index-inject.js, logic/key-files.js, components/DirectorDialog.js, store/agent-runs.js, logic/catalog.js, logic/roles.js, components/ModelSeat.js, bridge/host-composer-slot.js" },
	{ f: "src/components/DesignStudio.js", bytes: 94481, lines: 1407, duty: "设计图工作室（铺满全屏 · 可拖拽编辑 · 左侧交互逻辑 · 底部专用对话）", up: "client-entry.js, mount.js", down: "store/design-schema.js, store/design.js, util/debug.js, logic/flow.js, util/safe-area.js, components/VersionPanel.js, components/PersonalizePanel.js" },
	{ f: "src/components/MindMap.js", bytes: 73831, lines: 1206, duty: "分支导图覆盖层（血缘树 · 缩滚展开 · 待总监路由）", up: "client-entry.js, mount.js", down: "logic/branch-tree.js, logic/branch-focus.js, components/OverviewDialog.js, logic/routing.js, logic/mindmap-render.js, util/debug.js, util/safe-area.js, bridge/chat-bridge.js, store/mindmap-schema.js, logic/flow.js, store/layout.js, store/personalize.js, components/NodeDetailPanel.js, components/PersonalizePanel.js" },
	{ f: "src/components/DirectorDialog.js", bytes: 68061, lines: 980, duty: "总监弹窗（要求 5 / 6 / 7 / 8 / 9 / 10 / 11 的落位）", up: "client-entry.js, components/DirectorPage.js, mount.js", down: "store/layout.js, store/hierarchy.js, util/bus.js, bridge/split.js, bridge/chat-bridge.js, logic/branch-tree.js, logic/routing.js, logic/split-dimensions.js, logic/dim-branch.js, store/split-index.js, logic/lineage.js, store/plugin-db.js, components/DirectorWorkbench.js, components/DirectorHierarchy.js, util/debug.js, logic/flow.js, components/PersonalizePanel.js, util/safe-area.js, store/agent-runs.js, logic/catalog.js" },
	{ f: "src/store/design.js", bytes: 63926, lines: 1231, duty: "设计图数据层（文档 CRUD + 元素操作 + 专用临时对话）", up: "client-entry.js, components/DesignStudio.js, mount.js", down: "store/design-schema.js, store/plugin-db.js" },
	{ f: "src/client-entry.js", bytes: 57486, lines: 870, duty: "插件浏览器侧入口（批次 1 已落地）", up: "（无：插件入口层）", down: "util/debug.js, util/log-collector.js, util/no-drag.js, store/layout.js, store/theme.js, config/model.js, store/docs-index-inject.js, dev/layout-probe.js, store/messages.js, store/memory.js, store/branch.js, store/docs.js, store/file-adapter.js, store/create-store.js, store/use-store.js, store/persist.js, logic/process.js, logic/review.js, components/DirectorFlow.js, store/hierarchy.js, logic/summarize.js, mount.js, components/DirectorHierarchy.js, logic/discover.js, logic/sync.js, store/duty-config.js, logic/director-run.js, logic/director-dispatch.js, store/session-dossier.js, components/DirectorWorkbench.js, store/plugin-db.js, logic/routing.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, bridge/host-panel-trim.js, bridge/host-director-column.js, bridge/host-composer-slot.js, components/DirectorDialog.js, store/agent-runs.js, logic/catalog.js, store/design.js, components/DesignStudio.js, components/FloatDock.js, components/DirectorPage.js, components/ModelSeat.js, logic/branch-tree.js, components/MindMap.js, store/personalize.js, components/PersonalizePanel.js, logic/flow.js, logic/branch-focus.js, logic/lineage.js, logic/dim-branch.js, logic/overview.js, logic/orchestrate.js, components/NodeDetailPanel.js, logic/roles.js, logic/dag.js, logic/verify.js, logic/delegate.js, logic/task-state.js, logic/checkpoint.js, logic/policy.js, components/OrchestratorPanel.js" },
	{ f: "src/bridge/host-director-column.js", bytes: 54930, lines: 1110, duty: "对话页**宿主左栏（总监列）**的几何接管 + 记忆面板时序", up: "client-entry.js", down: "store/layout.js, util/dom-style.js, bridge/host-panel-trim.js" },
	{ f: "src/logic/branch-tree.js", bytes: 51821, lines: 967, duty: "分支血缘树（导图态的数据源）", up: "bridge/session-io.js, client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, components/OverviewDialog.js, logic/director-collect.js, logic/director-dispatch.js, logic/mindmap-render.js", down: "logic/discover.js, store/mindmap-schema.js, store/split-index.js, store/dispatch-log.js, store/session-dossier.js" },
	{ f: "src/store/layout.js", bytes: 42671, lines: 742, duty: "A11 布局 store（弹窗三态扩展版）", up: "bridge/host-director-column.js, bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/FloatDock.js, components/MindMap.js, mount.js", down: "（无）" },
	{ f: "src/logic/roles.js", bytes: 42326, lines: 790, duty: "角色注册表（Agent Card）", up: "client-entry.js, components/DirectorPage.js, components/OrchestratorPanel.js, logic/policy.js", down: "（无）" },
	{ f: "src/store/design-schema.js", bytes: 42225, lines: 770, duty: "「标准设计图框架」的数据映射（设计图插件的原子层）", up: "components/DesignStudio.js, store/design.js", down: "（无）" },
	{ f: "src/logic/split-dimensions.js", bytes: 39674, lines: 576, duty: "按维度拆线（**纯函数**：无 DOM、无 store、无副作用）", up: "components/DirectorDialog.js, components/DirectorPage.js, logic/attribution.js, logic/director-dispatch.js", down: "logic/attribution.js" },
	{ f: "src/store/personalize.js", bytes: 39417, lines: 702, duty: "个性化设定（右上角「⚙ 个性化」的单一真相源）", up: "client-entry.js, components/DirectorPage.js, components/MindMap.js, components/PersonalizePanel.js", down: "（无）" },
	{ f: "src/bridge/chat-bridge.js", bytes: 33553, lines: 675, duty: "「双向联动」通道（要求 5：右栏与对话 tab 互相传送消息）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js, components/NodeDetailPanel.js, components/OverviewDialog.js, mount.js", down: "bridge/split.js, util/debug.js" },
	{ f: "src/bridge/host-panel-trim.js", bytes: 33183, lines: 618, duty: "显示层裁剪宿主残留区块", up: "bridge/host-director-column.js, client-entry.js", down: "（无）" },
	{ f: "src/components/OrchestratorPanel.js", bytes: 29870, lines: 523, duty: "多智能体编排面板", up: "client-entry.js, components/DirectorPage.js", down: "logic/roles.js, logic/dag.js, logic/policy.js, logic/delegate.js, logic/verify.js, logic/orchestrate.js, logic/director-chain.js" },
	{ f: "src/store/mindmap-schema.js", bytes: 28381, lines: 435, duty: "思维导图元素库（导图态的「原子词汇表」，纯数据）", up: "components/MindMap.js, components/NodeDetailPanel.js, logic/branch-tree.js, logic/mindmap-render.js", down: "（无）" },
	{ f: "src/logic/routing.js", bytes: 27973, lines: 498, duty: "智能路由（要求 8）＋ 六维审核（要求 3）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js", down: "store/plugin-db.js" },
	{ f: "src/store/plugin-db.js", bytes: 25406, lines: 497, duty: "插件**自有**数据元层（独立数据库）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, components/NodeDetailPanel.js, components/OverviewDialog.js, logic/routing.js, store/design.js, store/hierarchy.js", down: "（无）" },
	{ f: "src/logic/director-reuse.js", bytes: 24946, lines: 413, duty: "「先考虑目前存在的会话」（第 19 批 · **纯函数**）", up: "logic/director-dispatch.js", down: "（无）" },
	{ f: "src/logic/director-dispatch.js", bytes: 24879, lines: 385, duty: "总监 → 职能分支的**派发**（第 17 批）", up: "client-entry.js, components/DirectorPage.js", down: "logic/split-dimensions.js, logic/director-reuse.js, logic/branch-tree.js, bridge/session-io.js, store/dispatch-log.js, store/split-index.js, store/session-dossier.js" },
	{ f: "src/logic/attribution.js", bytes: 22786, lines: 371, duty: "归属判定（19 号文 §3.3 / N1 · **纯函数**）", up: "components/DirectorPage.js, logic/split-dimensions.js", down: "logic/split-dimensions.js" },
	{ f: "src/logic/director-run.js", bytes: 21909, lines: 454, duty: "总监预处理中枢（03号文 §1.2 五步标准执行逻辑）", up: "client-entry.js, components/DirectorPage.js, components/DirectorWorkbench.js", down: "logic/duties.js, config/model.js, logic/director-chain.js, logic/dag.js, util/debug.js" },
	{ f: "src/components/DirectorHierarchy.js", bytes: 21623, lines: 381, duty: "多层级总监面板（方案 C：层级树 + 主内容区）", up: "client-entry.js, components/DirectorDialog.js", down: "store/hierarchy.js, logic/summarize.js, logic/sync.js, util/bus.js, components/DirectorWorkbench.js, util/debug.js" },
	{ f: "src/logic/dag.js", bytes: 21502, lines: 492, duty: "声明式步骤图", up: "client-entry.js, components/OrchestratorPanel.js, logic/director-run.js", down: "（无）" },
	{ f: "src/logic/policy.js", bytes: 20333, lines: 407, duty: "执行模式与策略", up: "client-entry.js, components/OrchestratorPanel.js", down: "logic/roles.js" },
	{ f: "src/components/FloatDock.js", bytes: 20274, lines: 312, duty: "右下角浮动按钮组（全屏能力的统一入口）", up: "client-entry.js, components/DirectorPage.js, mount.js", down: "store/layout.js, logic/flow.js, util/debug.js" },
	{ f: "src/logic/verify.js", bytes: 20226, lines: 433, duty: "双层验收与评审去偏", up: "client-entry.js, components/OrchestratorPanel.js", down: "（无）" },
	{ f: "src/logic/director-collect.js", bytes: 20152, lines: 377, duty: "分支产出回收 + 总裁定（第 17 批）", up: "components/DirectorPage.js", down: "logic/branch-tree.js, bridge/session-io.js, store/dispatch-log.js, store/session-dossier.js" },
	{ f: "src/logic/flow.js", bytes: 20038, lines: 434, duty: "四维消息流转（总监 / 对话 / 思维导图 / 设计图 的**同一条消息**）", up: "client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/FloatDock.js, components/MindMap.js, components/NodeDetailPanel.js", down: "（无）" },
	{ f: "src/store/hierarchy.js", bytes: 19776, lines: 485, duty: "多层级总监结构（对话级 / 文件夹级 / 全局级）", up: "bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js, components/DirectorPage.js, components/DirectorWorkbench.js, logic/dim-branch.js, logic/summarize.js, logic/sync.js, store/duty-config.js", down: "store/idb.js, store/plugin-db.js" },
	{ f: "src/components/NodeDetailPanel.js", bytes: 19144, lines: 331, duty: "导图右侧「该框的对话」面板", up: "client-entry.js, components/MindMap.js", down: "logic/flow.js, logic/branch-tree.js, bridge/chat-bridge.js, store/plugin-db.js, store/mindmap-schema.js" },
	{ f: "src/store/agent-runs.js", bytes: 17554, lines: 413, duty: "总监执行状态（智能体 / 技能调用）唯一真相源", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js", down: "logic/catalog.js" },
	{ f: "src/components/ModelSeat.js", bytes: 16861, lines: 336, duty: "标准模型选择席位（第 6 批需求 8）", up: "client-entry.js, components/DirectorPage.js", down: "config/model.js" },
	{ f: "src/logic/lineage.js", bytes: 16773, lines: 372, duty: "上下游消息一致性与信封协议（19 号文 §3.2 信封 + §3.4 规则 R1–R4 · **纯函数**）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js", down: "（无）" },
	{ f: "src/store/file-adapter.js", bytes: 16333, lines: 407, duty: "A6 持久化探测 + 文件通道适配器", up: "client-entry.js, store/create-store.js, store/persist.js", down: "（无）" },
	{ f: "src/components/PersonalizePanel.js", bytes: 16083, lines: 296, duty: "右上角「⚙ 个性化」面板（四个界面共用一个组件）", up: "client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js", down: "store/personalize.js" },
	{ f: "src/store/session-dossier.js", bytes: 15657, lines: 326, duty: "会话档案（第 19 批）", up: "client-entry.js, logic/branch-tree.js, logic/director-collect.js, logic/director-dispatch.js", down: "（无）" },
	{ f: "src/bridge/session-io.js", bytes: 15567, lines: 315, duty: "逐会话读写通道（第 17 批）", up: "logic/director-collect.js, logic/director-dispatch.js", down: "logic/branch-tree.js" },
	{ f: "src/bridge/host-composer-slot.js", bytes: 15417, lines: 331, duty: "把插件控件注入**宿主底部统计行之前**", up: "client-entry.js, components/DirectorPage.js", down: "util/dom-style.js" },
	{ f: "src/logic/checkpoint.js", bytes: 15008, lines: 315, duty: "不可变快照链", up: "client-entry.js", down: "（无）" },
	{ f: "src/mount.js", bytes: 14690, lines: 262, duty: "总监弹窗的挂载层（T-PLUG-015 起：弹窗形态为主通道）", up: "client-entry.js", down: "components/DirectorDialog.js, components/DesignStudio.js, components/MindMap.js, components/FloatDock.js, store/layout.js, store/design.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, util/debug.js, util/bus.js" },
	{ f: "src/logic/task-state.js", bytes: 14416, lines: 330, duty: "任务状态机", up: "client-entry.js", down: "（无）" },
	{ f: "src/bridge/split.js", bytes: 14292, lines: 309, duty: "「左栏分屏」通道（要求 5：左侧总监 / 右侧对话数据）", up: "bridge/chat-bridge.js, bridge/nav-hook.js, client-entry.js, components/DirectorDialog.js, mount.js", down: "util/debug.js" },
	{ f: "src/store/persist.js", bytes: 14181, lines: 321, duty: "A7 + A8 总监 store 的加载与保存", up: "client-entry.js, logic/process.js, store/create-store.js", down: "store/messages.js, store/idb.js, store/cookie.js, store/file-adapter.js" },
	{ f: "src/components/DirectorWorkbench.js", bytes: 13819, lines: 259, duty: "总监工作台（方案 E · 文档 06 §五）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorHierarchy.js", down: "logic/duties.js, store/duty-config.js, logic/director-run.js, store/create-store.js, store/use-store.js, store/hierarchy.js, config/model.js, util/debug.js" },
	{ f: "src/logic/delegate.js", bytes: 13778, lines: 306, duty: "委派模板与上下文装配", up: "client-entry.js, components/OrchestratorPanel.js", down: "（无）" },
	{ f: "src/logic/orchestrate.js", bytes: 13606, lines: 285, duty: "总监统筹闭环（纯函数）", up: "client-entry.js, components/DirectorPage.js, components/OrchestratorPanel.js", down: "（无）" },
	{ f: "src/logic/catalog.js", bytes: 12992, lines: 237, duty: "技能与智能体的**指向表**（单一真相源）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js, store/agent-runs.js", down: "（无）" },
	{ f: "src/store/branch.js", bytes: 12531, lines: 270, duty: "A4 分支创建与记忆面板交互", up: "client-entry.js", down: "store/idb.js, store/memory.js" },
	{ f: "src/components/OverviewDialog.js", bytes: 11475, lines: 216, duty: "总览弹窗（R10）", up: "components/MindMap.js", down: "logic/overview.js, logic/discover.js, bridge/chat-bridge.js, logic/branch-tree.js, store/plugin-db.js" },
	{ f: "src/logic/summarize.js", bytes: 10582, lines: 227, duty: "分层总结 + 分梯度调用", up: "client-entry.js, components/DirectorHierarchy.js", down: "config/model.js, store/hierarchy.js, util/debug.js, util/bus.js" },
	{ f: "src/store/dispatch-log.js", bytes: 10340, lines: 220, duty: "本次「总监派发」台账（第 17 批）", up: "components/DirectorPage.js, logic/branch-tree.js, logic/director-collect.js, logic/director-dispatch.js", down: "（无）" },
	{ f: "src/components/DirectorFlow.js", bytes: 9873, lines: 181, duty: "E1 小窗总监对话流组件", up: "client-entry.js", down: "store/create-store.js, store/use-store.js, util/debug.js" },
	{ f: "src/logic/ledger.js", bytes: 9720, lines: 210, duty: "台账 / 文档树取数", up: "components/DirectorPage.js", down: "store/docs-index-inject.js" },
	{ f: "src/store/idb.js", bytes: 9626, lines: 218, duty: "IndexedDB 持久化层（主要机制）", up: "logic/discover.js, logic/sync.js, store/branch.js, store/docs.js, store/hierarchy.js, store/memory.js, store/persist.js", down: "（无）" },
	{ f: "src/store/cookie.js", bytes: 9550, lines: 218, duty: "V10 Cookie 同步存储（分块）", up: "store/persist.js", down: "（无）" },
	{ f: "src/store/split-index.js", bytes: 9540, lines: 196, duty: "分流标签索引", up: "components/DirectorDialog.js, components/DirectorPage.js, logic/branch-tree.js, logic/director-dispatch.js", down: "（无）" },
	{ f: "src/store/create-store.js", bytes: 9531, lines: 232, duty: "A9 `createDirectorStore` store 工厂", up: "client-entry.js, components/DirectorFlow.js, components/DirectorWorkbench.js", down: "store/messages.js, store/persist.js, store/file-adapter.js" },
	{ f: "src/logic/process.js", bytes: 9494, lines: 172, duty: "D1 总监对话核心处理函数", up: "client-entry.js", down: "config/model.js, store/persist.js, store/memory.js" },
	{ f: "src/logic/sync.js", bytes: 9226, lines: 226, duty: "自动同步：让**每一个**对话 / 文件夹都拥有总监", up: "client-entry.js, components/DirectorHierarchy.js", down: "store/hierarchy.js, logic/discover.js, store/idb.js, util/debug.js, util/bus.js" },
	{ f: "src/components/VersionPanel.js", bytes: 8678, lines: 147, duty: "版本历史面板（\"不同版本的选择\"）", up: "components/DesignStudio.js", down: "（无）" },
	{ f: "src/logic/branch-focus.js", bytes: 8274, lines: 188, duty: "分支链路聚焦（纯函数）", up: "client-entry.js, components/MindMap.js", down: "（无）" },
	{ f: "src/util/debug.js", bytes: 8173, lines: 158, duty: "D3 DSH 统一调试日志工具（**A3+D3 合并后的权威实现**）", up: "bridge/chat-bridge.js, bridge/nav-hook.js, bridge/split.js, client-entry.js, components/DesignStudio.js, components/DirectorDialog.js, components/DirectorFlow.js, components/DirectorHierarchy.js, components/DirectorPage.js, components/DirectorWorkbench.js, components/FloatDock.js, components/MindMap.js, logic/director-run.js, logic/summarize.js, logic/sync.js, mount.js, store/duty-config.js", down: "（无）" },
	{ f: "src/store/docs.js", bytes: 7949, lines: 205, duty: "A5 总监文档 store（V8）", up: "client-entry.js", down: "store/idb.js" },
	{ f: "src/util/safe-area.js", bytes: 7491, lines: 133, duty: "窗口控件安全区（Windows 原生标题栏按钮的避让计算）", up: "components/DesignStudio.js, components/DirectorDialog.js, components/DirectorPage.js, components/MindMap.js", down: "（无）" },
	{ f: "src/logic/mindmap-render.js", bytes: 7470, lines: 135, duty: "导图渲染派生（**纯函数，不依赖 React**）", up: "components/MindMap.js", down: "logic/branch-tree.js, store/mindmap-schema.js" },
	{ f: "src/logic/discover.js", bytes: 6946, lines: 192, duty: "真实会话 / 文件夹（workspace）数据源发现层", up: "client-entry.js, components/OverviewDialog.js, logic/branch-tree.js, logic/sync.js", down: "store/idb.js" },
	{ f: "src/logic/duties.js", bytes: 6943, lines: 125, duty: "总监职责配置定义（03号文 §3.1「执行逻辑项」）", up: "components/DirectorWorkbench.js, logic/director-run.js, store/duty-config.js", down: "（无）" },
	{ f: "src/logic/dim-branch.js", bytes: 6930, lines: 112, duty: "「维度 ↔ 分支节点」绑定的**唯一翻译点**（19 号文 N2 · **纯函数**）", up: "client-entry.js, components/DirectorDialog.js, components/DirectorPage.js", down: "store/hierarchy.js" },
	{ f: "src/config/model.js", bytes: 5879, lines: 127, duty: "C2 配置与本地模型", up: "client-entry.js, components/DirectorPage.js, components/DirectorWorkbench.js, components/ModelSeat.js, logic/director-run.js, logic/process.js, logic/review.js, logic/summarize.js", down: "（无）" },
	{ f: "src/bridge/nav-hook.js", bytes: 5825, lines: 134, duty: "「点击文件夹 / 项目 → 展示该层级总监」（要求 7 / 9）", up: "client-entry.js, mount.js", down: "bridge/split.js, store/hierarchy.js, store/layout.js, util/debug.js" },
	{ f: "src/store/memory.js", bytes: 5811, lines: 120, duty: "A2 V9 记忆体系 CRUD", up: "client-entry.js, logic/process.js, store/branch.js", down: "store/idb.js" },
	{ f: "src/store/duty-config.js", bytes: 5768, lines: 144, duty: "职责三级继承（03号文 §3.2「继承制」）", up: "client-entry.js, components/DirectorPage.js, components/DirectorWorkbench.js", down: "store/hierarchy.js, logic/duties.js, util/debug.js" },
	{ f: "src/dev/layout-probe.js", bytes: 5652, lines: 115, duty: "C1 V9-Design 布局探针", up: "client-entry.js", down: "（无）" },
	{ f: "src/logic/review.js", bytes: 5496, lines: 82, duty: "D2 对话返回审核（**保留能力，当前无调用点**）", up: "client-entry.js", down: "config/model.js" },
	{ f: "src/index.js", bytes: 5110, lines: 58, duty: "src/ 骨架的目录索引（导航用）", up: "（无：插件入口层）", down: "（无）" },
	{ f: "src/logic/overview.js", bytes: 5011, lines: 123, duty: "总览弹窗的数据整形（纯函数）", up: "client-entry.js, components/OverviewDialog.js", down: "（无）" },
	{ f: "src/store/docs-index-inject.js", bytes: 4956, lines: 112, duty: "A13 + A14 DSH_DOCS_INDEX 注入壳（**剥离改造版**）", up: "client-entry.js, components/DirectorPage.js, logic/ledger.js", down: "（无）" },
	{ f: "src/bridge/spike-fs-probe.js", bytes: 3853, lines: 87, duty: "R3 风险验证（T5）", up: "（无：插件入口层）", down: "（无）" },
	{ f: "src/util/no-drag.js", bytes: 3784, lines: 78, duty: "桌面壳「窗口拖拽带」穿透 —— 把可交互元素从 OS caption area 里救出来", up: "client-entry.js", down: "（无）" },
	{ f: "src/util/dom-style.js", bytes: 3601, lines: 78, duty: "内联样式的单位归一（**唯一真相源**）", up: "bridge/host-composer-slot.js, bridge/host-director-column.js", down: "（无）" },
	{ f: "src/logic/director-chain.js", bytes: 3577, lines: 50, duty: "总监五步链的声明式依赖图（纯数据，零依赖）", up: "components/OrchestratorPanel.js, logic/director-run.js", down: "（无）" },
	{ f: "src/store/theme.js", bytes: 3417, lines: 77, duty: "A12 V9-Design D-01 主题变量体系", up: "client-entry.js", down: "（无）" },
	{ f: "src/store/use-store.js", bytes: 3315, lines: 64, duty: "A10 `useDirectorStore` React hook 绑定", up: "client-entry.js, components/DirectorFlow.js, components/DirectorWorkbench.js", down: "（无）" },
	{ f: "src/util/log-collector.js", bytes: 2961, lines: 68, duty: "A3 专用 Log 收集器", up: "client-entry.js", down: "（无）" },
	{ f: "src/store/messages.js", bytes: 2439, lines: 54, duty: "A1 总监消息 store（内存层）", up: "client-entry.js, store/create-store.js, store/persist.js", down: "（无）" },
	{ f: "src/util/bus.js", bytes: 2054, lines: 49, duty: "层级数据变更事件总线（极简，零依赖）", up: "components/DirectorDialog.js, components/DirectorHierarchy.js, components/DirectorPage.js, logic/summarize.js, logic/sync.js, mount.js", down: "（无）" },
]);

/** 合计（闸门据此对账，避免各自为政） */
export const KEY_FILES_TOTAL = Object.freeze({ modules: 88, bytes: 1845887, lines: 33727 });

export default KEY_FILES;
