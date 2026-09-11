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
 * ── 待迁入（批次 3~6）───────────────────────────────────────
 *   ⬜ A6 文件通道    ⬜ A7~A10 持久化+store
 *   ⬜ D1 directorProcess  ⬜ D2 审核
 *   ⬜ E1 DirectorFlow
 *   ⬜ F3+F4 全局 API  ⬜ F1/F2 + G1/G4 宿主注入点改造
 *   ⛔ E2 DirectorView — 已废弃（2026-09-08 P2 清理，墓志铭 client.js:8897）
 *
 * ⚠️ 关键约束
 *   - 平台模块（react / cordis / web-react 等）**必须 external**，严禁打进产物（ADR-001）
 *   - 加载顺序：debug → log-collector（后者依赖前者）→ layout / theme / config → docs-index
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

export const PLUGIN_VERSION = "0.2.0-batch2";

/** 批次 1 安装器：装配零依赖基础层。返回已安装的能力清单（供宿主与调试读取） */
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
		docsIndex: false // 异步，稍后就绪
	};

	docsIndexPromise.then((d) => { installed.docsIndex = Boolean(d); });

	if (typeof window !== "undefined") {
		window.__dshDirectorBatch1 = installed;
		window.__dshDirectorBatch2 = installed; // 批次 2 别名：便于逐批次排查
	}
	return installed;
}

export { directorLayoutStore, dshThemeStore, directorConfig, directorDocsStore };
