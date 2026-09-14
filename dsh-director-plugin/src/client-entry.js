/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：插件浏览器侧入口（批次 1 已落地）
 * 引用：V16 诉求 1（再审核：注册失败也要能看到原因）+ 2026-09-12 诉求 12（boot 注入 no-drag） · 批次 1 · 批次 2 · 批次 3
 * 上游：（无：插件入口层）
 * 下游：util/debug.js, util/log-collector.js, util/no-drag.js, store/layout.js, store/theme.js, config/model.js, store/docs-index-inject.js, dev/layout-probe.js, store/messages.js, store/memory.js, store/branch.js, store/docs.js, store/file-adapter.js, store/create-store.js, store/use-store.js, store/persist.js, logic/process.js, logic/review.js, components/DirectorFlow.js, store/hierarchy.js, logic/summarize.js, mount.js, components/DirectorHierarchy.js, logic/discover.js, logic/sync.js, store/duty-config.js, logic/director-run.js, components/DirectorWorkbench.js, store/plugin-db.js, logic/routing.js, bridge/split.js, bridge/chat-bridge.js, bridge/nav-hook.js, bridge/host-panel-trim.js, components/DirectorDialog.js, store/design.js, components/DesignStudio.js, components/FloatDock.js, components/DirectorPage.js, logic/branch-tree.js, components/MindMap.js, store/personalize.js, components/PersonalizePanel.js, logic/flow.js, logic/branch-focus.js, logic/overview.js, logic/orchestrate.js, components/NodeDetailPanel.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A（tab 环：总监以 order:-1 排最前）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * client-entry.js — 插件浏览器侧入口（批次 1 已落地）
 *
 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   基准：11,998 行 / 1,479,577 B / mtime 2026-09-08 13:14:11
 *   施工图：dsh-director-plugin/docs/01-插件迁移明细清单.md（v2）
 *
 * ── 当前进度（批次 1 · 零依赖，已迁入）──────────────────────
 *   ✅ A11 布局 store        → store/layout.js           （client.js 6439~6483）
 *   ✅ A12 主题 store        → store/theme.js            （client.js 6484~6537）
 *   ✅ A3  专用 Log 收集器    → util/log-collector.js      （client.js 5799~5834）
 *   ✅ D3  统一调试日志工具    → util/debug.js             （client.js 6854~6968）
 *   ✅ C2  配置与本地模型      → config/model.js           （client.js 6615~6705）
 *   ✅ C1  V9-Design 布局探针  → dev/layout-probe.js       （client.js 6545~6614）
 *   ✅ A13+A14 文档索引注入壳  → store/docs-index-inject.js（client.js 6538~6544 + 剥离改造）
 *
 * ── 批次 2 数据层（已迁入）──────────────────────────────────
 *   ✅ A1  消息 store（内存层） → store/messages.js         （client.js 5495~5723）
 *   ✅ A2  记忆 CRUD           → store/memory.js           （client.js 5724~5798）
 *   ✅ A4  分支创建+记忆面板    → store/branch.js           （client.js 5835~5963）
 *   ✅ A5  总监文档 store       → store/docs.js             （client.js 5966~6035）
 *   ✅ V10 Cookie 分块存储      → store/cookie.js           （存储降级兜底层）
 *   ✅ IndexedDB 持久化主层     → store/idb.js              （6 store / v3）
 *
 * ── 批次 3 持久化层（已迁入）──────────────────────────────────
 *   ✅ A6  文件通道适配器      → store/file-adapter.js      （client.js 6036~6214，按 T5 实测重建）
 *   ✅ A7  loadDirectorStore   → store/persist.js           （client.js 6215~6273）
 *   ✅ A8  saveDirectorStore   → store/persist.js           （client.js 6274~6326）
 *   ✅ A9  createDirectorStore → store/create-store.js      （client.js 6327~6403 + 6408~6437）
 *   ✅ A10 useDirectorStore    → store/use-store.js         （client.js 6404~6407，**首个平台模块消费者**）
 *
 * ── 批次 4 逻辑层（已迁入）─────────────────────────────────────
 *   ✅ D1 directorProcess      → logic/process.js            （client.js 6706~6818）
 *   ✅ D2 directorReviewReturn → logic/review.js             （client.js 6820~6855，**保留不调用**）
 *
 * ── 批次 5 组件层（已迁入）─────────────────────────────────────
 *   ✅ E1 DirectorFlow         → components/DirectorFlow.js      （client.js 6972~7085）
 *      🔴 含一处**迁移期修正**：宿主 `filteredMessages` 属跨作用域越界引用（自诞生即坏，
 *         P2 清理删除 DirectorView 后沦为完全未定义）→ 改用 `state.messages`。论证见该文件头。
 *
 * ── 批次 6–8（多层级总监 / 自动同步 / 职责完善）───────────────────
 *   ✅ hierarchy / summarize / discover / sync / duties / director-run
 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
 *
 * ── 批次 9 弹窗式总监架构（T-PLUG-015 · docs/10 §四 + docs/11 §六）──
 *   ✅ 要求 1 数据元独立 → store/plugin-db.js      `dsh-director-plugin-db` v1 / 6 store
 *      🔴 与宿主 `dsh-director-db` v3 **物理隔离**：IDB 版本协商只发生在同名库内，
 *         故新库不参与宿主协商 ⇒ 「物理隔离」与「R5 键冻结」可同时成立。见 docs/10 §3.4
 *   ✅ 要求 5 布局分屏   → bridge/split.js         只注入 `<style>` + data-* 标记，
 *      **零节点移动**、逐值可逆（真机实测：移除后 viewArea x 580→280 / w 854→1154）
 *   ✅ 要求 5 双向联动   → bridge/chat-bridge.js   React 受控输入安全写入（原生 setter +
 *      input 事件）；`sendToChat` 两级降级（sent → filled），每步写后回读校验
 *   ✅ 要求 7/9 层级入口 → bridge/nav-hook.js      捕获阶段 pointerdown + 三级名称匹配
 *   ✅ 要求 8 智能路由   → logic/routing.js        五步路由 + `confirmRoute` 留痕（不静默分发）
 *   ✅ 要求 3 六维审核   → logic/routing.js        `review6` 六维齐备（17号文 §1A.9，不减项）
 *   ✅ 要求 6 弹窗三态   → components/DirectorDialog.js + store/layout.js 新字段
 *
 * ── 待迁入（存量）───────────────────────────────────────────
 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造（B6，需授权）
 *
 * ⚠️ 关键约束
 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）；
 *     构建期由 build/build.mjs 改写为 `require("<spec>")`，构建日志会列出「平台外置」清单
 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
 *     → memory → branch → persist（依赖 debug）→ store 工厂
 */

import { installDshDebug, dshLog } from "./util/debug.js";
import { installV9Log } from "./util/log-collector.js";
import { installNoDrag } from "./util/no-drag.js";
import { directorLayoutStore } from "./store/layout.js";
import { dshThemeStore } from "./store/theme.js";
import { directorConfig } from "./config/model.js";
import { loadDocsIndex, getDocsIndexSync } from "./store/docs-index-inject.js";
import { installLayoutProbe } from "./dev/layout-probe.js";
// ── 批次 2 数据层 ──
import { directorStores } from "./store/messages.js";
import { installMemoryApi } from "./store/memory.js";
import { installBranchApi } from "./store/branch.js";
import { directorDocsStore } from "./store/docs.js";
// ── 批次 3 持久化层 ──
import {
	installPersistState,
	probeLegacyRequire,
	preloadStoreFile,
	bridgeDebugLogToFile,
	isFileChannelAvailable,
	isOpfsAvailable,
	isFsaAvailable,
	exportViaFsa,
	importViaFsa
} from "./store/file-adapter.js";
import { directorStoreFactory, installBeforeUnloadSave, createDirectorStore, isBeforeUnloadRegistered } from "./store/create-store.js";
import { useDirectorStore } from "./store/use-store.js";
import { safeDirectorKey, loadDirectorStore, saveDirectorStore, DIRECTOR_DEFAULT_CONFIG } from "./store/persist.js";
// ── 批次 4 逻辑层 ──
import { directorProcess } from "./logic/process.js";
import { directorReviewReturn } from "./logic/review.js";
// ── 批次 5 组件层 ──
import { DirectorFlow } from "./components/DirectorFlow.js";
// ── 批次 6 多层级总监结构（对话级 / 文件夹级 / 全局级）──
import { installHierarchyApi, loadTree, ensureGlobal, LEVEL, GLOBAL_NODE_ID } from "./store/hierarchy.js";
import { installSummarizeApi, summarizeTree } from "./logic/summarize.js";
import { mountHierarchy } from "./mount.js";
import { DirectorHierarchy } from "./components/DirectorHierarchy.js";
// ── 批次 7 自动同步：让每一个对话 / 文件夹都拥有总监 ──
import { installDiscoverApi } from "./logic/discover.js";
import { installSyncApi, syncFromSource, auditCoverage } from "./logic/sync.js";
// ── 批次 8 总监逻辑完善：§3.1 五项职责 + §3.2 继承制 + §1.2 五步执行 ──
import { installDutyApi, resolveDuties, submitUp } from "./store/duty-config.js";
import { installDirectorRunApi } from "./logic/director-run.js";
import { DirectorWorkbench } from "./components/DirectorWorkbench.js";
// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
import { installPluginDbApi, pluginDbStats, PLUGIN_DB_NAME } from "./store/plugin-db.js";
import { installRoutingApi, route, confirmRoute, review6, REVIEW_DIMS, DESTINATION } from "./logic/routing.js";
import { installSplitApi, applySplit, clearSplit, getSplitRootRect, isSplitActive } from "./bridge/split.js";
import { installChatBridgeApi, sendToChat, readConversation } from "./bridge/chat-bridge.js";
import { installNavHook, installNavHookApi } from "./bridge/nav-hook.js";
// 宿主残留区块的显示层裁剪（2026-09-14 第 4 批 · 需求 ⑤「只在页面上不显示就行」）
import { installHostPanelTrim, installHostPanelTrimApi, restoreHostPanelTrim, TRIM_TARGETS, trimState } from "./bridge/host-panel-trim.js";
import { DirectorDialog, DIALOG_ID, AGENTS, SKILLS, listAgentRuns } from "./components/DirectorDialog.js";
// ── 批次 10 设计图工作室 + 总监 tab（T-PLUG-018）──
//    设计图：store/design-schema.js（元素原子）+ store/design.js（CRUD）+ components/DesignStudio.js
//    总监 tab：components/DirectorPage.js（R1–R8）+ 下面的 installDirectorView(ctx)
import { installDesignApi, DESIGN_KEY } from "./store/design.js";
import { DesignStudio, STUDIO_ID } from "./components/DesignStudio.js";
import { FloatDock, FLOATDOCK_ID, FLOAT_DOCK_RESERVE } from "./components/FloatDock.js";
import { DirectorPage, DIRECTOR_PAGE_ID } from "./components/DirectorPage.js";
import { installBranchTreeApi } from "./logic/branch-tree.js";
import { MindMap, MINDMAP_ID } from "./components/MindMap.js";
// ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）──
//    个性化：store/personalize.js（CSS 变量 + 注入样式表）→ components/PersonalizePanel.js（右上角）
//    流转：  logic/flow.js（一条消息走过总监 / 对话 / 导图 / 设计图的足迹）
import { installPersonalizeApi, personalizeStore } from "./store/personalize.js";
import { PersonalizePanel, PERSONALIZE_PANEL_ID } from "./components/PersonalizePanel.js";
import { installFlowApi, flowStore, DIM, DIM_LABEL } from "./logic/flow.js";
import { installBranchFocusApi } from "./logic/branch-focus.js";
import { installOverviewApi } from "./logic/overview.js";
import { installOrchestrateApi } from "./logic/orchestrate.js";
import { NodeDetailPanel, NODE_DETAIL_ID } from "./components/NodeDetailPanel.js";

export const PLUGIN_VERSION = "0.15.0-batch15";

/** 批次 1 安装器：装配零依赖基础层 + 数据层 + 持久化层。返回已安装的能力清单 */
export function installBatch1(options = {}) {
	// 1. 日志基础设施（顺序敏感：debug 先于 log-collector）
	installDshDebug();
	installV9Log();

	// 1.5 桌面壳：把可交互元素从 OS「标题栏拖拽带」里救出来。
	//     必须早于任何 UI 挂载 —— 设计图工作室铺满整个窗口，顶栏整条落在 Windows
	//     的 caption area（本机 CSS 0~44）内；鼠标落在那里会被系统当成「拖动窗口」，
	//     消息根本进不了渲染进程（连 mousemove 都没有）。表现为顶栏所有按钮点不动。
	//     🔴 该故障对静态检查 / 离线单测 / CDP 合成事件全部不可见，详见 util/no-drag.js 头部。
	installNoDrag();

	// 1.6 宿主残留区块的**显示层裁剪**（2026-09-14 第 4 批 · 需求 ⑤）
	//     用户原话：「去掉，那目前只在页面上不显示就行，如果有后端逻辑就保留，没有不用管」。
	//     目标 = 对话页左栏那两行宿主残留（「总监对话」标题行 / 「智能体 · 点击创建分支」按钮行）。
	//     🔴 为什么改显示层而不改宿主源码：`workspace/**` 被 `.gitignore` 排除 ⇒ 改它 git 无法回滚。
	//     取证：那 5 颗按钮的 onClick 指向 `handleAgentClick`，该函数在当前构建里**已无定义**
	//           （DirectorView 随 MOD-B 退坡时删除）⇒ 无后端逻辑可保留，隐掉不损失任何能力。
	//     细节（护栏 / 可逆 / 代价控制）见 bridge/host-panel-trim.js 头注。
	//     ⚠️ 返回值不在这里接：真状态在 `trimState`（见下方 installed.hostPanelTrim），
	//        因为"调用过"与"真的贴上去了"是两件事。
	installHostPanelTrim();

	// 2. 状态层（构造时即自挂 window，见各模块）
	//    directorLayoutStore → window.__directorLayoutStore
	//    dshThemeStore       → window.__dshTheme
	//    directorConfig      → window.__directorConfig

	// 3. 文档索引（异步，失败静默降级为"索引未注入"，与剥离前行为一致）
	const docsIndexPromise = loadDocsIndex(options.docsIndexBaseUrl);

	// 4. 布局探针（dev-only，默认开启；生产可传 { layoutProbe: false } 关闭）
	let probeInstalled = false;
	if (options.layoutProbe !== false) {
		probeInstalled = Boolean(installLayoutProbe(getDocsIndexSync));
	}

	// 5. 批次 2 数据层：全局契约安装（顺序敏感）
	//    ⚠️ memory 必须先于 branch —— branch 的 switchMemoryTab 依赖 idb 记忆读取，
	//       但更关键的是 __dshMemory 契约需先就位（宿主 F4 在 client.js:11787 直接调用）
	const memoryApi = installMemoryApi();
	const branchApi = installBranchApi();

	// 6. 批次 3 持久化层（顺序敏感）
	//    ⚠️ installPersistState 必须先于任何 plog（persist.js 会读它做统计）
	//    ⚠️ bridgeDebugLogToFile 必须在 installDshDebug 之后（依赖 window.__dshDebug）
	const persistState = installPersistState();
	const legacyProbe = probeLegacyRequire();
	const fileLogBridged = bridgeDebugLogToFile();
	const beforeUnload = installBeforeUnloadSave();
	// OPFS 预读：异步。loadDirectorStore 是同步函数，故靠「预读一次 + 同步读缓存」保持签名。
	const preloadPromise = preloadStoreFile();

	// 7. 批次 4 逻辑层（D1 核心处理 + D2 返回审核）
	//    ⚠️ D2 属「**保留不调用**」能力（三重证据见 logic/review.js 文件头）——
	//       此处**只挂全局契约、不自动调用**，确保不引入行为变更；
	//       未来启用时由接线层（批次 6 或后续）显式调用。
	//    ⚠️ D1 的宿主调用点（client.js:11763 `window.__directorSubmit`）属**批次 6** 接线范围，
	//       本批次不改宿主，仅提供插件侧实现 + 契约（双份共存期）。
	if (typeof window !== "undefined") {
		window.__dshDirectorProcess = directorProcess;
		window.__dshDirectorReviewReturn = directorReviewReturn;
		// ── 批次 5 组件层 ──
		//    ⚠️ 宿主调用点（client.js:7358 小窗内渲染）属**批次 6** 接线范围，
		//       本批次仅提供组件实现 + 契约（双份共存期）。
		//    ⚠️ 本组件含一处**迁移期修正**（`filteredMessages` 越界引用 → `state.messages`），
		//       论证见 components/DirectorFlow.js 文件头 🔴 段落。**勿回退**。
		window.__dshDirectorFlow = DirectorFlow;

		// ── 批次 6 多层级总监结构 ──
		//    需求：03号文 §1.3 三层总监体系（全局总管 / 项目总监（文件夹级）/ 会话总监）
		//          + 17号文 §2.1 三层记忆结构 MemoryNode + §1A.13 分层汇总 + §2.3 继承
		//    全局契约（供宿主/调试/验证脚本调用，不可改名）：
		//      window.__dshHierarchy  层级 CRUD（installHierarchyApi）
		//      window.__dshSummarize  分层总结 + 分梯度调用（installSummarizeApi）
		//      window.__dshHierarchyTree / __dshHierarchyStats  树快照与统计
		window.__dshHierarchy = installHierarchyApi();
		window.__dshSummarize = installSummarizeApi();
		// ── 批次 7 自动同步 ──
		//    window.__dshDiscover  真实会话/文件夹数据源发现（localStorage 为主，IDB 兜底）
		//    window.__dshSync      自动同步 + 覆盖度自检
		window.__dshDiscover = installDiscoverApi();
		window.__dshSync = installSyncApi();
		// ── 批次 8 总监逻辑完善 ──
		//    window.__dshDuties       §3.1 五项职责 + §3.2 三级继承（默认→全局→项目→会话）
		//    window.__dshDirectorRun  §1.2 五步标准执行逻辑（整理/分支/模型/上下文/审核）
		window.__dshDuties = installDutyApi();
		window.__dshDirectorRun = installDirectorRunApi();

		// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
		//    要求 1 数据元独立  window.__dshPluginDb   → dsh-director-plugin-db@v1（6 store）
		//    要求 8 智能路由    window.__dshRouter     → route / confirmRoute（五步，不静默分发）
		//    要求 3 六维审核    window.__dshReview6    → REVIEW_DIMS + review6 + reviewAndSave
		//    要求 5 布局分屏    window.__dshSplitApi   → applySplit / clearSplit（幂等可逆）
		//    要求 5 双向联动    window.__dshChatBridge → sendToChat / readConversation
		//    要求 7/9 层级入口  window.__dshNavApi     → installNavHook（点侧栏 → 打开该层级总监）
		window.__dshPluginDb = installPluginDbApi();
		window.__dshRouter = installRoutingApi();
		window.__dshSplitApi = installSplitApi();
		window.__dshChatBridge = installChatBridgeApi();
		window.__dshNavApi = installNavHookApi();
		window.__dshReview6 = { REVIEW_DIMS, review6 };
		window.__dshDirectorDialog = DirectorDialog;
		// ── 批次 10 设计图工作室（T-PLUG-018）──
		//    要求：总监页单独加设计图插件，按钮点击铺满全屏，可拖拽增删元素，
		//          底部临时对话只处理设计图，点元素在左侧显示交互逻辑。
		window.__dshDesignApi = installDesignApi();
		window.__dshDesignStudio = DesignStudio;
		window.__dshMindMap = MindMap;
		window.__dshFloatDock = FloatDock;
		window.__dshDirectorPage = DirectorPage;
		// ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）──
		//    需求原文：「全部找审美重新审核一下质感加上，同时都在右上角加自定义个性化设定」
		//              「保证同一个消息能在上面几个维度进行流转」
		//    ⚠️ 个性化**必须早于界面挂载**（浮动按钮组等在此之后才 mount）——
		//       它注入的是 CSS 变量与样式表，晚注入会有一帧"未套肤"的闪动。
		window.__dshPersonalize = installPersonalizeApi();
		window.__dshFlow = installFlowApi();
		// ── 批次 15 分支链路聚焦 / 总览 / 统筹打分（2026-09-12 第七轮）──
		//    需求原文：「我点击对话那么只默认显示这个分支的链路」「思维导图最上面加一个弹窗，
		//              分为左右列」「打分起码三轮多方位评估」「打分标准也需要进行审核」
		window.__dshBranchFocus = installBranchFocusApi();
		window.__dshOverview = installOverviewApi();
		window.__dshOrchestrate = installOrchestrateApi();
	} else {
		// 无 DOM 环境（离线测试）：仍要建立 store，保证 import 侧行为一致
		installPersonalizeApi();
		installFlowApi();
		installBranchFocusApi();
		installOverviewApi();
		installOrchestrateApi();
	}

	// 8. 批次 6：多层级总监结构（对话级 / 文件夹级 / 全局级）
	//    ⚠️ ensureGlobal 必须先于 loadTree —— 保证全局根节点存在（tree 构建依赖它）
	//    ⚠️ 挂载默认开启（传 { mountHierarchy: false } 可关）；DOM 未就绪时延迟到 DOMContentLoaded
	//    ⚠️ 挂载走「宿主 slot 优先 + 浮层兜底」双通道，兜底零宿主依赖 → 必定可见
	//    ⚠️ 批次 7：ensureGlobal → **自动同步**（把真实会话/文件夹落成总监节点）→ loadTree
	//       自动同步是「每一个对话 / 文件夹都有总监」的实现根基：节点 id 由数据源主键派生
	//       （ws_/se_ 前缀），故重复启动只会更新、不会重复新建（幂等）。
	//       传 { autoSync: false } 可关闭（仅调试用，默认必须开）。
	let syncStats = null;
	const hierarchyReady = ensureGlobal()
		.then(() => (options.autoSync === false ? null : syncFromSource()))
		.then((s) => {
			syncStats = s;
			if (typeof window !== "undefined") window.__dshSyncStats = s;
			return loadTree();
		})
		.then((t) => {
			if (typeof window !== "undefined") window.__dshHierarchyTree = t;
			return t;
		}).catch(() => null); // 层级树异步失败不影响其他能力

	let hierarchyMount = null;
	if (options.mountHierarchy !== false) {
		const doMount = () => {
			try {
				hierarchyMount = mountHierarchy({ open: options.openHierarchy === true });
				if (typeof window !== "undefined" && window.__dshHierarchyMount) {
					window.__dshHierarchyMount.mounted = true;
				}
			} catch (e) { /* 挂载失败静默，不阻断插件 */ }
		};
		if (typeof document !== "undefined" && document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", doMount);
		} else {
			doMount();
		}
	}

	const installed = {
		debug: typeof window !== "undefined" ? Boolean(window.__dshDebug) : false,
		v9Log: typeof window !== "undefined" ? Boolean(window.__dshV9Log) : false,
		layoutStore: Boolean(directorLayoutStore),
		themeStore: Boolean(dshThemeStore),
		config: Boolean(directorConfig),
		layoutProbe: probeInstalled,
		// ── 批次 2 ──
		messageStore: Boolean(directorStores),
		memoryApi: memoryApi,
		branchApi: branchApi,
		docsStore: Boolean(directorDocsStore),
		docsIndex: false, // 异步，稍后就绪
		// ── 批次 3 ──
		persistState: Boolean(persistState),
		storeFactory: typeof directorStoreFactory === "function",
		hook: typeof useDirectorStore === "function",
		beforeUnload: beforeUnload,
		// 语义说明：beforeUnload = 「本次调用是否**新注册**」；
		// beforeUnloadRegistered = 「能力是否**最终就绪**（宿主或插件任一注册）」。
		// 真机上宿主内联代码（client.js:6409）先占同名守卫 → beforeUnload=false 属幂等守卫
		// 按设计生效（假阴性），能力本身健全。验证脚本须用 beforeUnloadRegistered 判定。
		beforeUnloadRegistered: isBeforeUnloadRegistered(),
		fileLogBridged: fileLogBridged,
		fileChannel: isFileChannelAvailable(),
		opfs: isOpfsAvailable(),
		fsa: isFsaAvailable(),
		legacyRequire: legacyProbe.filter((p) => p.ok).map((p) => p.name), // 实测为空数组（T5）
		opfsPreloaded: false, // 异步，稍后就绪
		// ── 批次 4 逻辑层 ──
		directorProcess: typeof directorProcess === "function",
		directorReview: typeof directorReviewReturn === "function",
		directorReviewWired: false, // 有意不接线（宿主决策：保留不调用）
		directorProcessWired: false, // 宿主调用点属批次 6 接线范围
		// ── 批次 5 组件层 ──
		directorFlow: typeof DirectorFlow === "function",
		directorFlowWired: false, // 宿主调用点属批次 6 接线范围
		// 🔴 迁移期修正标记：filteredMessages 越界引用已修为 state.messages
		directorFlowFixedFilteredMessages: true,
		// ── 批次 6 多层级总监结构 ──
		hierarchyApi: typeof window !== "undefined" ? Boolean(window.__dshHierarchy) : false,
		summarizeApi: typeof window !== "undefined" ? Boolean(window.__dshSummarize) : false,
		// 语义：hierarchyMounted = 「弹窗主通道是否已挂载」（`#dsh-director-dialog-host` 是否就位，
		//        零宿主依赖 ⇒ 必定可用）；
		//       hierarchySlotRegistered = 「是否额外注册进宿主 conversation.view」——
		//        需 `ctx.slots`，真机 `window.__DSH_SLOTS__` 不存在 ⇒ 恒 false（docs/10 §四 4.1）。
		hierarchyMounted: Boolean(hierarchyMount && hierarchyMount.host),
		hierarchySlotRegistered: false,
		hierarchyTreeReady: false, // 异步，稍后就绪
		// ── 批次 7 自动同步 ──
		discoverApi: typeof window !== "undefined" ? Boolean(window.__dshDiscover) : false,
		syncApi: typeof window !== "undefined" ? Boolean(window.__dshSync) : false,
		// 覆盖度：回答「是否每一个对话 / 文件夹都有总监」
		coverage: null, // 异步，稍后就绪（{sessions,folders,global,rate,ok}）
		coverageOk: false,
		// ── 批次 8 总监逻辑完善 ──
		dutyApi: typeof window !== "undefined" ? Boolean(window.__dshDuties) : false,
		directorRunApi: typeof window !== "undefined" ? Boolean(window.__dshDirectorRun) : false,
		workbench: typeof DirectorWorkbench === "function",
		// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
		//    要求 1：独立数据元（物理隔离库，与宿主 `dsh-director-db` v3 不同名）
		pluginDb: typeof window !== "undefined" ? Boolean(window.__dshPluginDb) : false,
		pluginDbName: PLUGIN_DB_NAME,
		//    要求 8 + 3：智能路由（五步，STEP4 必须确认）与六维审核
		routerApi: typeof window !== "undefined" ? Boolean(window.__dshRouter) : false,
		review6Api: typeof window !== "undefined" ? Boolean(window.__dshReview6) : false,
		reviewDimCount: REVIEW_DIMS.length, // 必须 = 6（17号文 §1A.9，不得减项）
		//    要求 5：布局分屏通道 + 与原生对话的双向联动通道
		splitApi: typeof window !== "undefined" ? Boolean(window.__dshSplitApi) : false,
		chatBridgeApi: typeof window !== "undefined" ? Boolean(window.__dshChatBridge) : false,
		//    要求 7/9：点侧栏文件夹/项目 → 打开该层级总监
		navApi: typeof window !== "undefined" ? Boolean(window.__dshNavApi) : false,
		//    要求 6/10/11：弹窗本体 + 可调用智能体/技能清单
		dialogComponent: typeof DirectorDialog === "function",
		dialogId: DIALOG_ID,
		agents: AGENTS.map((a) => a.key),
		skills: SKILLS.map((s) => s.key),
		// 分屏当前是否生效（弹窗打开且未最小化时为 true）
		splitActive: isSplitActive(),
		// 独立库落盘统计（异步，稍后就绪）
		pluginDbStats: null,
		// ── 批次 11 个性化设定 + 四维流转 ──
		personalizeApi: typeof window !== "undefined" ? Boolean(window.__dshPersonalize) : false,
		personalize: personalizeStore.getState(),
		flowApi: typeof window !== "undefined" ? Boolean(window.__dshFlow) : false,
		flowDimensions: ["director", "chat", "mindmap", "design"],
		nodeDetailPanel: typeof NodeDetailPanel === "function",
		personalizePanelId: PERSONALIZE_PANEL_ID,
		nodeDetailId: NODE_DETAIL_ID
	};

	hierarchyReady.then((t) => {
		installed.hierarchyTreeReady = Boolean(t);
		installed.coverage = syncStats && syncStats.coverage ? syncStats.coverage : null;
		installed.coverageOk = Boolean(installed.coverage && installed.coverage.ok);
	});

	docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });
	preloadPromise.then((ok) => { installed.opfsPreloaded = Boolean(ok); });
	// 独立库统计（异步；仅用于真机取证与弹窗 R6「数据元独立」展示，失败静默）
	pluginDbStats().then((s) => { installed.pluginDbStats = s; }).catch(() => { });

	/* 批次 12 · 总监页风格与宿主统一（需求：「总监 tap 页面的背景采用原软件的背景」）
	 * 纯记录用途：把这套令牌映射写成可读契约，便于真机/离线断言"产物真的带了它"。
	 * 真正的判据是运行期的 computed 值（见 verify-flow.mjs F 段），不是这张表。 */
	installed.uiTheme = {
		scope: '[data-testid="dp-root"]',
		source: "host --dsw-alias-*",
		surface: "--dsw-alias-bg-base",
		card: "--dsw-alias-bg-layer-1",
		card2: "--dsw-alias-bg-layer-2",
		text: "--dsw-alias-label-primary",
		textDim: "--dsw-alias-label-tertiary",
		border: "--dsw-alias-border-l2"
	};

	/* 批次 13 · 浮动按钮组的两条几何/配色契约（背景改浅后连带暴露的两处缺陷）
	 * ① 容器透明化点击、药丸自己吃点击 —— 否则容器的**透明空隙**会吃掉页面自己按钮的事件
	 *    （真机实测「交给总监整理」被压住且点不动）；
	 * ② 药丸字色取宿主主文字令牌 —— 原先写死的浅色在浅底上对比度只剩 1.35–2.21:1。
	 * `reserve` 从 FloatDock 的真实常量取（**不写第二份真相**）。 */
	installed.floatDock = {
		containerPointerEvents: "none",
		pillPointerEvents: "auto",
		pillColorToken: "--dsw-alias-label-primary",
		reserve: FLOAT_DOCK_RESERVE,
		reserveConsumers: ["dp-r6", "dp-r8"]
	};

	/* ── 批次 15（T-PLUG-024/026/027/028）：真流转 / 分支聚焦 / 总览 / 统筹打分 ──
	 * 「我在总监发的消息，是否经过处理然后发给对话执行」这个**最核心基础要求**
	 * 的可断言面：投递通道的降级级别 + 处理链落库 + 聚焦与打分的纯函数契约。 */
	installed.deliver = {
		/* 投递分级（顺序即优先级）：
		 *   host-send       → 宿主直投对话域（避开 InputBar 的「总监劫持」，防二次处理）
		 *   direct          → composer 在场，点原生发送
		 *   open-then-send  → 先切会话，等 composer 出现再点发送
		 *   仍不行          → 如实报因（不许静默） */
		channels: ["host-send", "direct", "open-then-send"],
		attr: "data-deliver-mode",
		modes: ["idle", "sent", "filled", "failed"],
		anchor: { send: "dp-send", router: "mm-ov-send", nodeSend: "nd-send" }
	};
	installed.branchFocus = {
		attr: "data-focus-id",
		bar: "mm-focusbar",
		toggles: ["mm-focus-up", "mm-focus-exit"],
		includeParentsMeans: "祖先链 ∪ 链上每一环的同级（用户语义：上一层全景）"
	};
	installed.overview = {
		root: "mm-ov",
		columns: ["mm-ov-col-done", "mm-ov-col-todo"],
		attr: ["data-count-done", "data-count-todo", "data-sel-session"]
	};
	installed.orchestrate = {
		stages: ["plan", "doc", "review", "blueprint", "test", "done"],
		rubricDims: ["purpose", "aesthetic", "interaction", "resilience", "consistency", "verifiability"],
		rounds: ["spec", "independent", "counter"],
		rubricSelfAudit: true
	};
	/* 2026-09-14 第 4 批：宿主残留区块的**显示层裁剪**（用户：「只在页面上不显示就行」）。
	 * `installed` = 是否真的贴上去了（不是"调用过"）—— 断言读它，别读调用与否。
	 * `degraded` / `reason` 必须一起报出来：**降级可以，无声不行**（纪律 19）。
	 * （离线桩 `verify-bundle` 里没有 DOM ⇒ 这里会如实显示"无 MutationObserver"。） */
	installed.hostPanelTrim = {
		installed: trimState.applied.length > 0,
		degraded: trimState.degraded,
		reason: trimState.reason,
		applied: trimState.applied.slice(),
		targets: TRIM_TARGETS.map((t) => t.key),
		mark: "data-dsh-trimmed",
		reversible: true,
		guard: "作用域护栏：必须落在宿主总监面板 [style*=\"min-width: 180px\"] 内"
	};

	if (typeof window !== "undefined") {
		window.__dshDirectorBatch1 = installed;
		window.__dshDirectorBatch2 = installed; // 批次 2 别名
		window.__dshDirectorBatch3 = installed; // 批次 3 别名
		window.__dshDirectorBatch4 = installed; // 批次 4 别名
		window.__dshDirectorBatch5 = installed; // 批次 5 别名
		window.__dshDirectorBatch6 = installed; // 批次 6 别名
		window.__dshDirectorBatch7 = installed; // 批次 7 别名
		window.__dshDirectorBatch8 = installed; // 批次 8 别名
		window.__dshDirectorBatch9 = installed; // 批次 9 别名（弹窗式总监架构）
		window.__dshDirectorBatch10 = installed; // 批次 10 别名（设计图工作室 + 总监 tab）
		window.__dshDirectorBatch11 = installed; // 批次 11 别名（个性化设定 + 四维流转）
		window.__dshDirectorBatch12 = installed; // 批次 12 别名（总监页背景改走宿主令牌）
		window.__dshDirectorBatch13 = installed; // 批次 13 别名（浮动入口点击穿透 + 药丸配色随主题）
		window.__dshDirectorBatch15 = installed; // 批次 15 别名（真流转 + 分支聚焦 + 总览 + 统筹）
	}
	return installed;
}

/* ══════════════════════════════════════════════════════════════════
 * 批次 10 · 总监 tab 注册（宿主原生三页签的第一项）
 * ══════════════════════════════════════════════════════════════════
 *  🔴 这是本插件与宿主**唯一**的正式对接点，契约逐条取证自宿主源码：
 *
 *   ① 数据源：`conversation.view` 是 **list slot**（宿主 client.js:11724 声明
 *      `kind:"list", scope:"session"`），tab 环直接由它的 entries 生成：
 *        `viewTabs()` → `for (const entry of slots.entries("conversation.view"))`
 *                     → `{ id: entry.options.id, label: resolveSlotLabel(entry.options.label) }`
 *        （宿主 client.js:11621-11631）
 *   ② 渲染：`renderSlot("conversation.view", {inspect,onInspectDone}, { only: active.id })`
 *        （宿主 client.js:9175）⇒ 组件收到 inspect 与 onInspectDone 两个 props
 *   ③ 显示条件：`tabs.length > 1`（宿主 client.js:9120）—— 目前 chat + trajectory = 2，
 *      本注册后为 3，tab 环必定显示
 *   ④ 顺序：宿主 chat 用 `order: 0`、trajectory 用 `order: 10`
 *      ⇒ 本插件用 **`order: -1`** 排在**最前**（设计稿：总监 | 对话 | 轨迹）
 *   ⑤ 通道写法照同族先例 `dsh-client-ui-trajectory/lib/client.js:7316,7340`：
 *        `inject: ["slots"]` + `ctx.slots.inject(slot, () => ctx.slots.register({...}, Cmp))`
 *   ⑥ 注册必须包在 `ctx.slots.inject(...)` 回调里 —— slot 未声明前注册会抛
 *      `slot "…" is not declared`（slots 包 register 的第 2 行检查）
 *
 *  由 `build/build.mjs` 的 apply 模板透传 ctx 后调用（apply 里 `void ctx` 曾是断链根因）。
 * ══════════════════════════════════════════════════════════════════ */

/** 总监视图 id（写入 slot entry 的 `id`，宿主 `resolveActiveView` 按它匹配，不可改名） */
const DIRECTOR_VIEW_ID = "director";
/** 排在最前（宿主 chat=0 / trajectory=10） */
const DIRECTOR_VIEW_ORDER = -1;

/**
 * 把「总监」注册进宿主原生 tab 环。
 * 失败**不抛**：返回结构化结果，由调用方决定是否降级到浮层通道（`mount.js`）。
 * @param {object} ctx cordis 上下文（由 apply 注入）
 * @returns {{registered:boolean, id:string, order:number, reason:string|null}}
 */
function installDirectorView(ctx) {
	const out = { registered: false, id: DIRECTOR_VIEW_ID, order: DIRECTOR_VIEW_ORDER, reason: null };
	/* 🔴 纪律（2026-09-12 真机教训 · 单点故障复盘）：
	 *   「诊断句柄必须在任何**可能自身抛错**的语句之前落盘」。
	 *   上一版把 `window.__dshDirectorView = out` 放在函数末尾，而 catch 块里的 `dshLog`
	 *   因未 import 抛 ReferenceError（且 catch 块内的抛错**不在 try 保护范围内**），
	 *   异常直接逃出本函数 ⇒ 末行永不执行 ⇒ 真机上 `__dshDirectorView` 恒为 undefined，
	 *   连"注册失败原因"都拿不到。故此处三处修正：
	 *     ① 前置落盘（每一条退出路径都先写 window.__dshDirectorView）；
	 *     ② 日志一律包在 `safeLog()` 里，**日志失败绝不影响主流程**；
	 *     ③ 返回前再同步一次，保证调用方拿到的 out 与全局一致。 */
	const safeLog = (msg) => { try { dshLog("hierarchy", msg); } catch (_) { /* 日志是最外层可观测性，绝不反噬主流程 */ } };
	const publish = () => { if (typeof window !== "undefined") window.__dshDirectorView = out; };

	publish(); // ① 前置落盘：此刻 out 还是 {registered:false, reason:null}
	try {
		if (!ctx || !ctx.slots) {
			out.reason = "ctx.slots 不可用（宿主版本差异）—— 已由浮层通道保底";
			publish();
			safeLog("总监 tab 注册跳过: " + out.reason);
			return out;
		}
		// slot 声明就绪后再注册；inject 回调由 slots 服务在声明后触发
		ctx.slots.inject("conversation.view", () => ctx.slots.register({
			name: "conversation.view",
			id: DIRECTOR_VIEW_ID,
			order: DIRECTOR_VIEW_ORDER,
			label: () => "总监",
			// 与 trajectory 同构：把 sessionId 交给组件，便于组件按会话取数
			inject: (sessionId) => ({ sessionId })
		}, DirectorPage));
		out.registered = true;
		publish();
		safeLog("已注册总监 tab（id=director, order=-1）到宿主 conversation.view");
	} catch (e) {
		out.reason = String((e && e.message) || e);
		publish(); // ② 先落盘，后日志 —— 顺序不可颠倒
		safeLog("总监 tab 注册失败，已降级浮层通道: " + out.reason);
	}
	publish(); // ③ 兜底同步
	return out;
}

export {
	directorLayoutStore,
	dshThemeStore,
	directorConfig,
	directorDocsStore,
	// ── 批次 3 ──
	directorStoreFactory,
	createDirectorStore,
	useDirectorStore,
	safeDirectorKey,
	loadDirectorStore,
	saveDirectorStore,
	DIRECTOR_DEFAULT_CONFIG,
	exportViaFsa,
	importViaFsa,
	// ── 批次 4 ──
	directorProcess,
	directorReviewReturn,
	// ── 批次 5 ──
	DirectorFlow,
	// ── 批次 6 多层级总监结构 ──
	installHierarchyApi, installSummarizeApi, mountHierarchy, summarizeTree, loadTree, ensureGlobal,
	LEVEL, GLOBAL_NODE_ID,
	DirectorHierarchy,
	// ── 批次 7 自动同步 ──
	installDiscoverApi, installSyncApi, syncFromSource, auditCoverage,
	// ── 批次 8 总监逻辑完善 ──
	installDutyApi, resolveDuties, submitUp, DirectorWorkbench,
	// ── 批次 9 弹窗式总监架构（T-PLUG-015）──
	installPluginDbApi, pluginDbStats, PLUGIN_DB_NAME,      // 要求 1 独立数据元
	installRoutingApi, route, confirmRoute, review6, REVIEW_DIMS, DESTINATION, // 要求 8 + 3
	installSplitApi, applySplit, clearSplit, getSplitRootRect, isSplitActive,  // 要求 5 分屏
	installChatBridgeApi, sendToChat, readConversation,     // 要求 5 双向联动
	installNavHook, installNavHookApi,                      // 要求 7/9 层级入口
	DirectorDialog, DIALOG_ID, AGENTS, SKILLS, listAgentRuns, // 要求 6/10/11 弹窗本体
	// ── 批次 10 设计图工作室 + 分支导图 + 总监 tab（T-PLUG-018）──
	installDesignApi, DESIGN_KEY,                       // 设计图数据层
	DesignStudio, STUDIO_ID,                            // 设计图全屏工作室
	installBranchTreeApi, MindMap, MINDMAP_ID,          // 分支血缘导图
	FloatDock, FLOATDOCK_ID,                            // 浮动按钮组（设计图 / 导图 / 总监）
	DirectorPage, DIRECTOR_PAGE_ID,                     // 总监页（R1–R8）
	// ── 批次 11 个性化设定 + 四维流转（2026-09-12 第三轮）──
	installPersonalizeApi, personalizeStore, PersonalizePanel, PERSONALIZE_PANEL_ID,
	installFlowApi, flowStore, DIM, DIM_LABEL,
	NodeDetailPanel, NODE_DETAIL_ID,
	installDirectorView, DIRECTOR_VIEW_ID, DIRECTOR_VIEW_ORDER, // 宿主 tab 注册
	// ── 批次 12 · 第 4 批界面调整（2026-09-14）──
	installHostPanelTrim, installHostPanelTrimApi, restoreHostPanelTrim, TRIM_TARGETS // 宿主残留区块显示层裁剪
};
