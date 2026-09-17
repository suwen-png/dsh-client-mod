/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A7 + A8 总监 store 的加载与保存
 * 引用：批次 3
 * 上游：client-entry.js, logic/process.js, store/create-store.js
 * 下游：store/messages.js, store/idb.js, store/cookie.js, store/file-adapter.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/persist.js — A7 + A8 总监 store 的加载与保存
 *
 * 迁移源：
 *   A7 `loadDirectorStore` + `safeDirectorKey`  → client.js **6215 ~ 6273**（59 行）
 *   A8 `saveDirectorStore`                      → client.js **6274 ~ 6326**（53 行）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 持久化层次（与宿主一一对应，仅替换死掉的文件通道）
 * ─────────────────────────────────────────────────────────────────────────
 *   加载顺序（同步）：
 *     ① OPFS 预读缓存（`fileAdapter.getCachedPayload()`）← 替代已死的 `directorFs` 同步读
 *     ② Cookie（`dsh_director_<key>`，V10 分块）        ← 宿主 6230 原样
 *     ③ localStorage（`dsh.director.store.<key>`）      ← 宿主 6248 原样
 *
 *   保存顺序（异步，全部双写 + 写后读回校验）：
 *     ① OPFS 写入（`fileAdapter.writePayload`，含 verify）
 *     ② localStorage 写入 + **读回校验**（宿主 6290-6298 的 `lsOk` 纪律原样保留）
 *     ③ IndexedDB（`idbSave`，V9.2 起 await 等待落盘）  ← 宿主 6301 原样
 *     ④ Cookie 同步存储                                 ← 宿主 6303 原样
 *
 * 🔴 关键不变量（V9 修复点，**不可回归**）
 *   `safeDirectorKey` 对空 sessionId 必须返回固定串 `"director-main"`。
 *   历史上曾用 UUID 作 key 导致持久化全面失效（每次刷新 key 都变）。
 *
 * 🔴 兼容约束（R5）
 *   - localStorage 前缀 `dsh.director.store.`（见 `messages.js`）
 *   - Cookie key 前缀 `dsh_director_`，且需兼容旧固定 key `dsh_director_cookie`
 *
 * 相对宿主的两处**行为差异**（刻意为之，非疏漏）
 *   1. OPFS 是异步的 → 加载路径改为「安装期预读一次 + 同步读缓存」，
 *      使 `loadDirectorStore` 保持同步签名（宿主调用方依赖同步返回）。
 *   2. 因此**首次启动**若 OPFS 里已有数据，而预读尚未完成，加载会走 cookie/localStorage。
 *      预读在 `installBatch3()` 中 await（见 client-entry），故正常时序下不会发生。
 */

import { DIRECTOR_STORE_PREFIX } from "./messages.js";
import { idbSave, idbLoad } from "./idb.js";
import { dshCookieSave, dshCookieLoad } from "./cookie.js";
import { getCachedPayload, writePayload, getPersistState, DIRECTOR_DIR_NAME, DIRECTOR_STORE_FILENAME } from "./file-adapter.js";

/**
 * 总监默认配置（宿主中在 6224 / 6242 / 6266 / 6332 **重复出现 4 次**，此处提取为单一真源）。
 * ⚠️ 字段与默认值必须与宿主逐字一致，否则存量用户配置合并结果会漂移。
 */
export const DIRECTOR_DEFAULT_CONFIG = {
	autoForward: true,
	localModel: { enabled: false, endpoint: "http://localhost:11434", model: "qwen2:7b" },
	duties: {
		languagePolish: { enabled: true, name: "语言规范整理" },
		contextMemory: { enabled: true, name: "上下文记忆" },
		executionLogic: { enabled: true, name: "执行逻辑分析" },
		modelRouting: { enabled: false, name: "模型路由" },
		returnReview: { enabled: true, name: "对话返回审核" }
	}
};

/**
 * 深克隆默认配置。
 * ⚠️ **必须克隆**：宿主在 6224/6242/6266/6332 处每次都是**新建对象字面量**，
 *    故各 store 的 `config.duties` / `config.localModel` 互不共享。
 *    提取为模块级常量后若直接引用，会导致多个 store 共享同一子对象
 *    （改 A 的 duties 会串改 B），属真实保真度缺陷。
 */
export function cloneDirectorDefaultConfig() {
	return JSON.parse(JSON.stringify(DIRECTOR_DEFAULT_CONFIG));
}

/** 合并默认配置与已存配置（宿主 4 处的 `{...DEFAULT, ...(parsed.config||{})}` 语义） */
function mergeConfig(saved) {
	return { ...cloneDirectorDefaultConfig(), ...(saved || {}) };
}

/** 记日志到统一调试通道（scope 固定 "persist"，与宿主一致） */
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

/* ── A7：key 派生 ─────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 由 sessionId 派生稳定的存储 key 后缀（宿主 6201-6214 **逐字等价迁移**）。
 *   - 空/未传 → `"director-main"`（**V9 修复点，不可改**）
 *   - UUID     → `director-<前8位>`
 *   - 其他     → `director-<djb2-ish 32 位哈希的 base36 前8位>`
 * @param {string} [sessionId]
 * @returns {string}
 */
export function safeDirectorKey(sessionId) {
	if (!sessionId) return "director-main";
	const sid = String(sessionId);
	if (UUID_RE.test(sid)) return "director-" + sid.substring(0, 8);
	let hash = 0;
	for (let i = 0; i < sid.length; i++) {
		hash = ((hash << 5) - hash) + sid.charCodeAt(i);
		hash |= 0; // 保持 32 位有符号整数语义（与宿主一致）
	}
	return "director-" + Math.abs(hash).toString(36).substring(0, 8);
}

/** localStorage / IDB 所用的完整 key */
export function directorStorageKey(sessionId) {
	return DIRECTOR_STORE_PREFIX + safeDirectorKey(sessionId);
}

/** Cookie 所用的完整 key（V10；前缀 `dsh_director_` 不可改） */
export function directorCookieKey(sessionId) {
	return "dsh_director_" + safeDirectorKey(sessionId);
}

/* ── A7：加载 ─────────────────────────────────────────────────── */

/**
 * 同步加载总监 store（宿主 6215-6272 等价迁移，仅把死掉的文件读换成 OPFS 缓存读）。
 * @param {string} [sessionId]
 * @returns {{messages:Array, config:object}|null} 无数据时返回 null
 */
export function loadDirectorStore(sessionId) {
	const st = getPersistState();
	try {
		// ① OPFS 预读缓存（替代宿主 6218 的 directorFs.existsSync + readFileSync）
		const cached = getCachedPayload();
		if (cached) {
			try {
				const parsed = JSON.parse(cached);
				/* 🔴 第 22 批 D5：OPFS 是**单文件**（`director-store.json`），**不含桶名**。
				 *    不校验归属的话，任意作用域都会读到"最后一次保存"的那份 store
				 *    ⇒ 多会话互相覆盖 / **串桶**（A1 的消息出现在 A2、A2 保存后 A1 读回 A2 的内容）。
				 *    ⇒ 写入时在 payload 里记 `sid`；读时**不符即视为未命中**，
				 *      继续走 cookie / localStorage（那两层是按 `safeDirectorKey` 分键的，天然分桶）。
				 *    ⚠️ 旧格式（无 `sid`）**一律视为未命中** —— 宁可降级到按桶的层，
				 *      也不许把"不知道属于谁"的数据塞给当前会话。 */
				const want = safeDirectorKey(sessionId);
				if (parsed.sid !== want) {
					plog("V9.3 load from file(OPFS) SKIP：缓存属于 "
						+ String(parsed.sid || "(旧格式无 sid)") + "，本次请求 " + want
						+ " ⇒ 不串桶，继续走 cookie/localStorage");
				} else {
					plog("V9.3 load from file(OPFS): msgs=" + (parsed.messages?.length || 0)
						+ " bytes=" + cached.length + " file=OPFS:" + DIRECTOR_DIR_NAME + "/" + DIRECTOR_STORE_FILENAME);
					if (st) {
						st.loadCount++;
						st.lastLoadTime = Date.now();
						st.savedMessages = parsed.messages?.length || 0;
					}
					return { messages: parsed.messages || [], config: mergeConfig(parsed.config) };
				}
			} catch (e) {
				pwarn("V9.3 load from file(OPFS) failed: " + e.message + ", fallback to cookie/localStorage");
			}
		}

		// ② Cookie（V10：最可靠，同步持久化）
		let cookieData = dshCookieLoad(directorCookieKey(sessionId));
		// 兼容旧固定 key（宿主 6232-6238 原样）
		if ((!cookieData || !cookieData.messages) && typeof window !== "undefined") {
			const oldData = dshCookieLoad("dsh_director_cookie");
			if (oldData && oldData.messages) {
				cookieData = oldData;
				plog("V10 load from old cookie key (compatibility)");
			}
		}
		if (cookieData && cookieData.messages) {
			plog("V10 load from cookie: msgs=" + cookieData.messages.length);
			if (st) {
				st.loadCount++;
				st.lastLoadTime = Date.now();
				st.savedMessages = cookieData.messages.length;
			}
			return { messages: cookieData.messages || [], config: mergeConfig(cookieData.config) };
		}

		// ③ localStorage
		if (typeof localStorage === "undefined") {
			if (st) st.lastError = "load: localStorage unavailable";
			return null;
		}
		const key = directorStorageKey(sessionId);
		const raw = localStorage.getItem(key);
		if (!raw) {
			// V9.2：枚举所有 dsh.director* key 做诊断（宿主 6252-6258 原样）
			let allKeys = "";
			try {
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.indexOf("dsh.director") === 0) {
						allKeys += k + "(" + (localStorage.getItem(k) || "").length + "bytes) ";
					}
				}
			} catch (e) {
				allKeys = "enumerate failed: " + e.message;
			}
			plog("load: no data for key=" + key + " | all director keys: [" + (allKeys || "none") + "]");
			if (st) {
				st.loadCount++;
				st.lastLoadTime = Date.now();
			}
			return null;
		}
		const parsed = JSON.parse(raw);
		plog("load: key=" + key + " msgs=" + (parsed.messages?.length || 0) + " bytes=" + raw.length);
		if (st) {
			st.loadCount++;
			st.lastLoadTime = Date.now();
			st.savedMessages = parsed.messages?.length || 0;
		}
		return { messages: parsed.messages || [], config: mergeConfig(parsed.config) };
	} catch (e) {
		pwarn("load failed: " + e.message);
		if (st) st.lastError = "load: " + e.message;
		return null;
	}
}

/* ── A8：保存 ─────────────────────────────────────────────────── */

/**
 * 保存总监 store（宿主 6274-6326 等价迁移；**异步**，宿主原本即 async）。
 * 四条写入路径全部执行，任一成功即视为成功（返回 `fileOk || lsOk || idbOk`，与宿主一致）。
 * @param {string} [sessionId]
 * @param {{messages:Array, config:object}} state
 * @returns {Promise<boolean>}
 */
export async function saveDirectorStore(sessionId, state) {
	const st = getPersistState();
	try {
		const key = directorStorageKey(sessionId);
		/* 🔴 第 22 批 D5：`sid` 是 OPFS 单文件的**归属标记**（见 `loadDirectorStore` 里的校验）。
		 *    localStorage 那一层按 key 分桶，多这个字段不影响读（读侧只看 messages/config）。 */
		const payload = JSON.stringify({ sid: safeDirectorKey(sessionId), messages: state.messages, config: state.config });

		// ① OPFS（含写后读回校验，替代宿主 6280-6288）
		let fileOk = false;
		try {
			fileOk = await writePayload(payload);
			plog("V9.3 save to file(OPFS): " + (fileOk ? "OK" : "FAIL")
				+ " msgs=" + state.messages.length + " bytes=" + payload.length);
		} catch (e) {
			pwarn("V9.3 save to file(OPFS) failed: " + e.message);
		}

		// ② localStorage + 读回校验（宿主 6290-6298 的 lsOk 纪律原样保留）
		let lsOk = false;
		if (typeof localStorage !== "undefined") {
			try {
				localStorage.setItem(key, payload);
				const verify = localStorage.getItem(key);
				lsOk = (verify === payload);
				plog("save-verify: localStorage " + (lsOk ? "OK" : "FAIL")
					+ " key=" + key + " verifyLen=" + (verify ? verify.length : 0));
			} catch (e) {
				pwarn("localStorage save failed: " + e.message);
			}
		}

		// ③ IndexedDB（V9.2 起 await 确保真正落盘）
		const idbOk = await idbSave(key, { messages: state.messages, config: state.config, savedAt: Date.now() });

		// ④ Cookie 同步存储（V10）
		const cookieOk = dshCookieSave(directorCookieKey(sessionId), {
			messages: state.messages,
			config: state.config,
			savedAt: Date.now()
		});
		plog("V10 save to cookie: " + (cookieOk ? "OK" : "FAIL") + " msgs=" + state.messages.length);

		// V9.2：保存后 dump localStorage（宿主 6306-6314 诊断逻辑原样）
		let lsDump = "";
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				if (k && k.indexOf("dsh.director") === 0) {
					lsDump += k + "(" + (localStorage.getItem(k) || "").length + "b) ";
				}
			}
		} catch (e) {
			lsDump = "dump failed: " + e.message;
		}
		plog("save: key=" + key + " msgs=" + state.messages.length + " bytes=" + payload.length
			+ " fileOk=" + fileOk + " lsOk=" + lsOk + " idbOk=" + idbOk
			+ " | localStorage dump: [" + (lsDump || "empty") + "]");

		if (st) {
			st.saveCount++;
			st.lastSaveTime = Date.now();
			st.savedMessages = state.messages.length;
		}
		return fileOk || lsOk || idbOk;
	} catch (e) {
		pwarn("save failed: " + e.message);
		if (st) st.lastError = "save: " + e.message;
		return false;
	}
}

/** 供 A9 hydrate 使用的 IDB 读取（宿主 6356 的 `idbLoad(key)`） */
export async function loadDirectorStoreFromIdb(sessionId) {
	try {
		return await idbLoad(directorStorageKey(sessionId));
	} catch {
		return null;
	}
}
