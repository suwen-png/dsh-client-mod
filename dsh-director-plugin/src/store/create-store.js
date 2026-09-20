/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A9 `createDirectorStore` store 工厂
 * 引用：—
 * 上游：client-entry.js, components/DirectorFlow.js, components/DirectorWorkbench.js
 * 下游：store/messages.js, store/persist.js, store/file-adapter.js, store/store-health.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/create-store.js — A9 `createDirectorStore` store 工厂
 *
 * 迁移源：client.js **6327 ~ 6403**（77 行）
 *   - 6327-6395 `createDirectorStore(sessionId)`：组装 state + dispatch + subscribe
 *   - 6396-6403 `directorStoreFactory(sessionId)`：按 `safeDirectorKey` 分桶复用（单例注册表）
 *
 * 另含与 A9 同区块、语义强耦合的两段（不拆走会让 store 失去退出前保存能力）：
 *   - 6408-6437 `beforeunload` 注册：退出前把有消息的 store 落盘
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 设计要点
 * ─────────────────────────────────────────────────────────────────────────
 * 1. **`notify()` 每次都写盘**（宿主 6335-6338 原样）—— 任何状态变更都触发
 *    `saveDirectorStore`，这是宿主「永不丢消息」策略的核心，勿优化为 debounce。
 * 2. **`hydrate()` 的 IDB 合并防竞态**（宿主 6358-6362，V9.4-P1 修复）：
 *    IDB 异步返回期间用户可能已发新消息，故**只前插缺失消息、不整体覆盖**。
 *    该逻辑必须原样保留，否则会复现「刷新后消息回退」缺陷。
 * 3. **`addMessage` 的 id 生成用 `Math.random()`**（宿主 6378 原样）——
 *    属非确定性 RNG 的历史数据形态，勿改为确定性 RNG（会与存量 id 形态不一致）。
 * 4. **`reset()` 的 config 只留 `{autoForward:true}`**（宿主 6391 原样）——
 *    看似与 `DIRECTOR_DEFAULT_CONFIG` 不一致，但属既有行为，勿"顺手修正"。
 * 5. **配置对象必须深克隆**（见 `cloneDirectorDefaultConfig`），否则多个 store 会共享
 *    `config.duties` 同一引用。
 */

import { directorStores } from "./messages.js";
import {
	loadDirectorStore,
	saveDirectorStore,
	loadDirectorStoreFromIdb,
	safeDirectorKey,
	cloneDirectorDefaultConfig,
	directorStorageKey
} from "./persist.js";
import { writePayload } from "./file-adapter.js";
/* 第 41 轮：退出前 dump 改用唯一实现（原为手写 for 循环，全仓第三份重复） */
import { scanBuckets, liveStorageIO, describeBuckets } from "./store-health.js";

/** 记日志（scope 固定 "persist"，与宿主一致） */
function plog(msg, data) {
	if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.log === "function") {
		window.__dshDebug.log("persist", msg, data);
	}
}
function pwarn(msg, data) {
	if (typeof window !== "undefined" && window.__dshDebug && typeof window.__dshDebug.warn === "function") {
		window.__dshDebug.warn("persist", msg, data);
	}
}

/**
 * 创建一个总监 store（宿主 6327-6395 等价迁移）。
 * @param {string} [sessionId]
 * @returns {object} store 实例
 */
export function createDirectorStore(sessionId) {
	const persisted = loadDirectorStore(sessionId);
	let state = {
		messages: persisted ? persisted.messages : [],
		status: "idle",
		config: persisted ? persisted.config : cloneDirectorDefaultConfig()
	};

	const listeners = new Set();

	/** 状态变更 → 落盘 + 通知订阅者（宿主 6335-6338 原样） */
	function notify() {
		saveDirectorStore(sessionId, state);
		for (const fn of listeners) fn(state);
	}

	return {
		sessionId,
		getState: () => state,
		subscribe: (fn) => {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/**
		 * 重新加载（宿主 6346-6374）。
		 * ① 同步：cookie/localStorage/OPFS 缓存
		 * ② 异步：IndexedDB —— **按消息 key 集合 merge，只前插缺失项**（V9.4-P1 防竞态）
		 */
		hydrate: () => {
			// ① 同步层快速初始值
			const reloaded = loadDirectorStore(sessionId);
			if (reloaded) {
				state = { ...state, messages: reloaded.messages, config: reloaded.config };
				notify();
				plog("hydrate(sync): loaded " + state.messages.length + " messages for sessionId=" + sessionId);
			}
			// ② 异步层（IndexedDB，更可靠）
			const key = directorStorageKey(sessionId);
			loadDirectorStoreFromIdb(sessionId).then((idbData) => {
				if (idbData && idbData.messages) {
					// V9.4-P1: 防竞态 —— 只补充 idb 中存在而当前缺失的历史消息（前插），不覆盖现有消息
					const msgKeyOf = (m) => m && (m.id || m.ts || m.timestamp);
					const existingKeys = new Set(state.messages.map(msgKeyOf).filter(Boolean));
					const missing = idbData.messages.filter((m) => {
						const k = msgKeyOf(m);
						return k && !existingKeys.has(k);
					});
					if (missing.length > 0) {
						state = {
							...state,
							messages: [...missing, ...state.messages],
							config: idbData.config || state.config
						};
						notify();
						plog("hydrate(IndexedDB): merged " + missing.length
							+ " missing messages (total=" + state.messages.length + ") for sessionId=" + sessionId);
					} else {
						plog("hydrate(IndexedDB): no missing messages, skipping. idbMsgs="
							+ idbData.messages.length + " localMsgs=" + state.messages.length);
					}
				} else {
					plog("hydrate(IndexedDB): no data for key=" + key);
				}
			});
		},
		/** 追加一条消息（自动补 id/ts；宿主 6375-6381 原样） */
		addMessage: (msg) => {
			state = {
				...state,
				messages: [...state.messages, {
					id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
					ts: Date.now(),
					...msg
				}]
			};
			notify();
		},
		setStatus: (status) => {
			state = { ...state, status };
			notify();
		},
		setConfig: (patch) => {
			state = { ...state, config: { ...state.config, ...patch } };
			notify();
		},
		/** 重置（宿主 6390-6393 原样：config 仅留 autoForward） */
		reset: () => {
			state = { messages: [], status: "idle", config: { autoForward: true } };
			notify();
		}
	};
}

/**
 * 按 `safeDirectorKey(sessionId)` 分桶取（或建）store —— 进程内单例注册表
 * （宿主 6396-6403 等价迁移）。
 * @param {string} [sessionId]
 * @returns {object} store 实例
 */
export function directorStoreFactory(sessionId) {
	const mapKey = safeDirectorKey(sessionId);
	if (!directorStores.has(mapKey)) {
		plog("directorStoreFactory: create new store for key=" + mapKey + " (sessionId type=" + typeof sessionId + ")");
		directorStores.set(mapKey, createDirectorStore(sessionId));
	}
	return directorStores.get(mapKey);
}

/**
 * 注册 `beforeunload` 兜底保存（宿主 6408-6437 等价迁移）。
 * 幂等（`window.__directorBeforeUnloadRegistered` 守卫生效）。
 *
 * ⚠️ 与宿主的差异：OPFS 是异步 API，`beforeunload` 中无法 await。
 *    故此处对 OPFS 采取 **fire-and-forget**，而 localStorage 仍同步写（与宿主一致）。
 */
export function installBeforeUnloadSave() {
	if (typeof window === "undefined" || window.__directorBeforeUnloadRegistered) return false;
	window.__directorBeforeUnloadRegistered = true;
	window.addEventListener("beforeunload", () => {
		try {
			for (const [key, store] of directorStores.entries()) {
				const state = store.getState();
				if (state.messages.length === 0) continue;
				const lsKey = key.startsWith("dsh.director.store.") ? key : "dsh.director.store." + key;
				const payload = JSON.stringify({ messages: state.messages, config: state.config });

				// ① OPFS：异步不可 await，尽力而为
				let fileDispatched = false;
				try {
					writePayload(payload).then(() => {}).catch(() => {});
					fileDispatched = true;
				} catch (e) { /* 忽略 */ }

				// ② localStorage：同步写入（与宿主一致）
				try { localStorage.setItem(lsKey, payload); } catch (e) { /* 忽略 */ }

				/* ③ 诊断 dump —— **第 41 轮：收敛到唯一实现**（原为手写 for 循环，全仓第三份重复） */
				plog("beforeunload save: key=" + lsKey + " msgs=" + state.messages.length
					+ " fileDispatched=" + fileDispatched + " | localStorage dump: ["
					+ describeBuckets(scanBuckets(liveStorageIO())) + "]");
			}
		} catch (e) {
			pwarn("beforeunload failed: " + e.message);
		}
	});
	return true;
}

/**
 * 查询 `beforeunload` 兜底保存的**最终注册态**（宿主或插件任一注册即为 true）。
 *
 * 为何需要：`installBeforeUnloadSave()` 的返回值语义是「**本次调用是否新注册**」，
 * 而宿主内联代码（client.js:6409）使用了**同一守卫名** `__directorBeforeUnloadRegistered`
 * 且先于插件执行。因此真机上「未新注册」= 幂等守卫按设计生效，**不代表能力缺失**。
 * 该函数提供「能力是否就绪」的判据，供验证脚本区分「假阴性」与「真缺失」。
 *
 * @returns {boolean}
 */
export function isBeforeUnloadRegistered() {
	return typeof window !== "undefined" && Boolean(window.__directorBeforeUnloadRegistered);
}
