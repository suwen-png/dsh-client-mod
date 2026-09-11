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
 * ── 待迁入（批次 6）─────────────────────────────────────────
 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造  ⬜ F5 插件侧 tab 注册
 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
 *
 * ⚠️ 关键约束
 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）；
 *     构建期由 build/build.mjs 改写为 `require("<spec>")`，构建日志会列出「平台外置」清单
 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
 *     → memory → branch → persist（依赖 debug）→ store 工厂
 */

import { installDshDebug } from "./util/debug.js";
import { installV9Log } from "./util/log-collector.js";
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

export const PLUGIN_VERSION = "0.8.0-batch8";

/** 批次 1 安装器：装配零依赖基础层 + 数据层 + 持久化层。返回已安装的能力清单 */
export function installBatch1(options = {}) {
	// 1. 日志基础设施（顺序敏感：debug 先于 log-collector）
	installDshDebug();
	installV9Log();

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
		// 语义：hierarchyMounted = 「浮层入口是否已挂载」（默认通道，必定可用）
		//       hierarchySlotRegistered = 「是否额外注册进宿主 conversation.view」
		hierarchyMounted: Boolean(hierarchyMount && hierarchyMount.overlay),
		hierarchySlotRegistered: Boolean(hierarchyMount && hierarchyMount.slotRegistered),
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
		workbench: typeof DirectorWorkbench === "function"
	};

	hierarchyReady.then((t) => {
		installed.hierarchyTreeReady = Boolean(t);
		installed.coverage = syncStats && syncStats.coverage ? syncStats.coverage : null;
		installed.coverageOk = Boolean(installed.coverage && installed.coverage.ok);
	});

	docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });
	preloadPromise.then((ok) => { installed.opfsPreloaded = Boolean(ok); });

	if (typeof window !== "undefined") {
		window.__dshDirectorBatch1 = installed;
		window.__dshDirectorBatch2 = installed; // 批次 2 别名
		window.__dshDirectorBatch3 = installed; // 批次 3 别名
		window.__dshDirectorBatch4 = installed; // 批次 4 别名
		window.__dshDirectorBatch5 = installed; // 批次 5 别名
		window.__dshDirectorBatch6 = installed; // 批次 6 别名
		window.__dshDirectorBatch7 = installed; // 批次 7 别名
		window.__dshDirectorBatch8 = installed; // 批次 8 别名
	}
	return installed;
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
	installDutyApi, resolveDuties, submitUp, DirectorWorkbench
};
