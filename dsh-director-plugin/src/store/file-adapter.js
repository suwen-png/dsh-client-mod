/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A6 持久化探测 + 文件通道适配器
 * 引用：批次 1
 * 上游：client-entry.js, store/create-store.js, store/persist.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/file-adapter.js — A6 持久化探测 + 文件通道适配器
 *
 * 迁移源：client.js **6036 ~ 6214**（179 行）
 *   - 6042        `window.__directorPersistState` 初始化
 *   - 6044-6112   早期 `__dshDebug` 初始化 → ⛔ **不迁移**（已由批次 1 `util/debug.js` 完整取代）
 *   - 6113-6200   Electron 文件存储探测三法（window.require / global.require / electron.remote.require）
 *   - 6176-6178   `directorStoreFile` 路径确定（`%APPDATA%/dsh-director/director-store.json`）
 *   - 6201-6214   `safeDirectorKey` → 已迁入 `store/persist.js`（A7）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 T5 实测结论（2026-09-11 真机 CDP，见《插件迁移明细清单》§8.5）
 * ─────────────────────────────────────────────────────────────────────────
 *   `window.require` / `global.require` / `electron.remote.require` /
 *   `process.versions.electron` —— **全部 `undefined`**。
 *
 *   ⇒ 宿主 A6 的三法探测链是**死代码**（生产环境恒不可达），其后的
 *     `directorFs.writeFileSync(...)` 分支从未真正执行。
 *   ⇒ 故本模块**不端口死代码**，改建为现代三通道：
 *
 *     ① File System Access API（`showSaveFilePicker` / `showOpenFilePicker`）
 *        —— 真文件读写，**需用户手势**，用于「导出/导入」类显式操作
 *     ② OPFS（`navigator.storage.getDirectory()`）
 *        —— 免手势的**异步**持久层，最接近原「文件落盘」语义
 *     ③ IndexedDB / localStorage
 *        —— 既有主层与兜底层（见 `idb.js` / `persist.js`）
 *
 *   legacy 三法仅保留 `typeof` 探测（`probeLegacyRequire`）作回归对照与留痕。
 *
 * ⚠️ 同步性约束（关键设计）
 *   宿主的 `loadDirectorStore` 是**同步**函数，而 OPFS 全异步。
 *   故本模块提供 `preloadStoreFile()`（异步，安装期调用一次）+ `getCachedPayload()`
 *   （同步读缓存），使 `loadDirectorStore` 保持同步签名，语义与宿主一致。
 */

/** OPFS 内目录名（沿用宿主的 `dsh-director` 命名） */
export const DIRECTOR_DIR_NAME = "dsh-director";
/** store 文件名（沿用宿主的 `director-store.json`） */
export const DIRECTOR_STORE_FILENAME = "director-store.json";
/** 日志文件名（沿用宿主的 `debug.log`） */
export const DIRECTOR_LOG_FILENAME = "debug.log";

/** 宿主 legacy 路径所用的目录名（`%APPDATA%/dsh-director`）—— 仅作展示对照 */
export const LEGACY_APPDATA_DIR = "dsh-director";

/** 内存缓存：OPFS 预读结果（供同步 `loadDirectorStore` 使用） */
let __cachedPayload = null;
/** 缓存是否已尝试过预读（区分「未预读」与「预读后为空」） */
let __preloadAttempted = false;
/** OPFS 根句柄缓存 */
let __opfsRootPromise = null;

/* ── 持久化统计状态（宿主 6042 原样保留字段与语义）────────────────── */

/**
 * 初始化 `window.__directorPersistState`（宿主 6042 原样迁移）。
 * 额外新增 `fileChannel` 字段用于暴露本模块的通道判定（向后兼容：只增不改）。
 */
export function installPersistState() {
	if (typeof window === "undefined") return null;
	if (window.__directorPersistState) return window.__directorPersistState;
	window.__directorPersistState = {
		saveCount: 0,
		loadCount: 0,
		lastSaveTime: null,
		lastLoadTime: null,
		lastError: null,
		savedMessages: 0,
		localStorageAvailable: typeof localStorage !== "undefined",
		idbAvailable: typeof indexedDB !== "undefined",
		// ── 本模块新增（只增不改）──
		opfsAvailable: null, // 异步探测，见 preloadStoreFile
		fileChannel: null // "opfs" | "none"
	};
	return window.__directorPersistState;
}

/** 取持久化统计状态（可能为 null） */
export function getPersistState() {
	return typeof window !== "undefined" ? window.__directorPersistState || null : null;
}

/* ── legacy 三法探测（留痕，不参与实际读写）──────────────────────── */

/**
 * 探测宿主 original 三法是否可达。
 * **不用于读写** —— 仅用于回归对照：若未来 Harness 开启 Node 集成，可据此重新评估。
 * @returns {{name:string, ok:boolean, detail:string}[]}
 */
export function probeLegacyRequire() {
	const g = typeof globalThis !== "undefined" ? globalThis : {};
	const one = (name, getter) => {
		try {
			const v = getter();
			return v == null
				? { name, ok: false, detail: "值为 " + v }
				: { name, ok: true, detail: "类型 " + typeof v };
		} catch (e) {
			return { name, ok: false, detail: "抛错: " + (e && e.message ? e.message : String(e)) };
		}
	};
	return [
		one("window.require", () => (typeof window !== "undefined" ? window.require : undefined)),
		one("global.require", () => g.global && g.global.require),
		one("electron.remote.require", () => g.electron && g.electron.remote && g.electron.remote.require),
		one("process.versions.electron", () => g.process && g.process.versions && g.process.versions.electron)
	];
}

/* ── 现代通道判定 ─────────────────────────────────────────────── */

/** OPFS 是否可用（同步判定，只查 API 是否存在） */
export function isOpfsAvailable() {
	// ⚠️ 必须用 Boolean() 收口：Node 21+ 内置 `navigator` 全局但无 `navigator.storage`，
	//    `a && b && c` 的短路会返回中间值 `undefined` 而非布尔 false，
	//    导致契约字段 opfs 出现 undefined（已由 verify-install 在离线链路实测捕获）。
	return Boolean(
		typeof navigator !== "undefined"
		&& navigator.storage
		&& typeof navigator.storage.getDirectory === "function"
	);
}

/** File System Access API 是否可用（同步判定） */
export function isFsaAvailable() {
	return Boolean(
		typeof window !== "undefined"
		&& typeof window.showSaveFilePicker === "function"
		&& typeof window.showOpenFilePicker === "function"
	);
}

/** 是否存在任意可用的持久化文件通道 */
export function isFileChannelAvailable() {
	return Boolean(isOpfsAvailable() || isFsaAvailable());
}

/* ── OPFS 读写 ─────────────────────────────────────────────────── */

/** 取 OPFS 根目录句柄（首次调用后缓存 Promise） */
export function getOpfsRoot() {
	if (!isOpfsAvailable()) return Promise.resolve(null);
	if (__opfsRootPromise) return __opfsRootPromise;
	__opfsRootPromise = navigator.storage.getDirectory().catch(() => null);
	return __opfsRootPromise;
}

/** 取 `dsh-director` 子目录句柄（不存在则创建） */
async function getDirectorDir(create) {
	const root = await getOpfsRoot();
	if (!root) return null;
	try {
		return await root.getDirectoryHandle(DIRECTOR_DIR_NAME, { create: Boolean(create) });
	} catch {
		return null;
	}
}

/**
 * 预读 store 文件到内存缓存（**安装期调用一次**）。
 * 使后续 `getCachedPayload()` 可同步取值，从而 `loadDirectorStore` 保持同步签名。
 * @returns {Promise<boolean>} 是否读到非空内容
 */
export async function preloadStoreFile() {
	__preloadAttempted = true;
	const state = getPersistState();
	if (!isOpfsAvailable()) {
		if (state) { state.opfsAvailable = false; state.fileChannel = "none"; }
		return false;
	}
	if (state) state.opfsAvailable = true;
	try {
		const dir = await getDirectorDir(false);
		if (!dir) { if (state) state.fileChannel = "none"; return false; }
		const fh = await dir.getFileHandle(DIRECTOR_STORE_FILENAME, { create: false });
		const file = await fh.getFile();
		const text = await file.text();
		if (text && text.length > 0) {
			__cachedPayload = text;
			if (state) state.fileChannel = "opfs";
			return true;
		}
	} catch {
		/* 文件不存在或不可读 → 静默，走降级链 */
	}
	if (state) state.fileChannel = "none";
	return false;
}

/**
 * 同步取预读缓存。
 * @returns {string|null} JSON 文本；未预读或为空时返回 null
 */
export function getCachedPayload() {
	return __preloadAttempted ? __cachedPayload : null;
}

/** 清空内存缓存（登出/重置用） */
export function clearCachedPayload() {
	__cachedPayload = null;
	__preloadAttempted = false;
}

/**
 * 写入 store 到 OPFS，并**读回校验**（沿用宿主 6283-6286 的 save-verify 纪律）。
 * @param {string} payload JSON 文本
 * @returns {Promise<boolean>} 写后读回是否一致
 */
export async function writePayload(payload) {
	if (!isOpfsAvailable()) return false;
	try {
		const dir = await getDirectorDir(true);
		if (!dir) return false;
		const fh = await dir.getFileHandle(DIRECTOR_STORE_FILENAME, { create: true });
		const w = await fh.createWritable();
		await w.write(payload);
		await w.close();
		// 写后读回校验
		const back = await (await fh.getFile()).text();
		const ok = back === payload;
		if (ok) {
			__cachedPayload = payload;
			__preloadAttempted = true;
			const state = getPersistState();
			if (state) state.fileChannel = "opfs";
		}
		return ok;
	} catch {
		return false;
	}
}

/** 删除 store 文件（重置用） */
export async function deleteStoreFile() {
	clearCachedPayload();
	if (!isOpfsAvailable()) return false;
	try {
		const dir = await getDirectorDir(false);
		if (!dir) return false;
		await dir.removeEntry(DIRECTOR_STORE_FILENAME);
		return true;
	} catch {
		return false;
	}
}

/**
 * 追加一行到 OPFS `debug.log`（宿主 6056-6065 / 6072-6081 的文件日志语义）。
 * ⚠️ 与宿主不同：这里是**异步**的；调用方不该 await（日志失败不影响主流程）。
 * @param {string} line 已格式化的整行（含换行）
 */
export function appendLogLine(line) {
	if (!isOpfsAvailable()) return Promise.resolve(false);
	return (async () => {
		try {
			const dir = await getDirectorDir(true);
			if (!dir) return false;
			const fh = await dir.getFileHandle(DIRECTOR_LOG_FILENAME, { create: true });
			const existing = await (await fh.getFile()).text();
			const w = await fh.createWritable();
			await w.write(existing + line);
			await w.close();
			return true;
		} catch {
			return false;
		}
	})();
}

/** 读取 OPFS `debug.log` 全文（诊断导用） */
export async function readLogFile() {
	if (!isOpfsAvailable()) return null;
	try {
		const dir = await getDirectorDir(false);
		if (!dir) return null;
		const fh = await dir.getFileHandle(DIRECTOR_LOG_FILENAME, { create: false });
		return await (await fh.getFile()).text();
	} catch {
		return null;
	}
}

/* ── File System Access API（需用户手势的显式导入/导出）──────────── */

/**
 * 用 FSA 保存任意文本（弹系统保存框，需用户手势）。
 * @param {string} suggestedName 建议文件名
 * @param {string} text 内容
 * @returns {Promise<boolean>}
 */
export async function exportViaFsa(suggestedName, text) {
	if (!isFsaAvailable()) return false;
	try {
		const handle = await window.showSaveFilePicker({ suggestedName });
		const w = await handle.createWritable();
		await w.write(text);
		await w.close();
		return true;
	} catch {
		return false; // 用户取消或权限拒绝
	}
}

/**
 * 用 FSA 读取文本（弹系统打开框，需用户手势）。
 * @returns {Promise<string|null>}
 */
export async function importViaFsa() {
	if (!isFsaAvailable()) return null;
	try {
		const [handle] = await window.showOpenFilePicker({
			types: [{ description: "Director Store", accept: { "application/json": [".json"] } }]
		});
		return await (await handle.getFile()).text();
	} catch {
		return null;
	}
}

/* ── 调试日志 → OPFS 文件桥接 ─────────────────────────────────── */

/**
 * 把统一调试日志（`window.__dshDebug`）桥接到 OPFS `debug.log`，
 * 复现宿主 6056-6065 / 6072-6081 的「日志实时落文件」行为。
 *
 * 宿主当时是 `directorFs.appendFileSync(logFile, line)`（O(1) 追加）；
 * OPFS **无追加 API**，只能「读全文 → 拼接 → 覆盖写」，故为 O(n) 每行。
 * 日志本身有 2000 条上限（见 `util/debug.js` 的 `DSH_DEBUG_MAX_LOGS`），
 * 实测可行；若后续发现成为热点，改为内存缓冲 + 定时/批量 flush。
 *
 * 幂等：重复调用只包装一次（`__fileLogBridged` 守卫）。
 * @returns {boolean} 是否已完成桥接（或此前已桥接）
 */
export function bridgeDebugLogToFile() {
	if (typeof window === "undefined" || !window.__dshDebug) return false;
	const dbg = window.__dshDebug;
	if (dbg.__fileLogBridged) return true;

	const format = (scope, message, data, level) =>
		"[" + new Date().toISOString() + "] [" + level + "] [" + scope + "] " + message
		+ (data !== undefined && data !== null ? " " + JSON.stringify(data) : "") + "\n";

	for (const [name, level] of [["log", "INFO"], ["warn", "WARN"]]) {
		const orig = dbg[name];
		if (typeof orig !== "function") continue;
		dbg[name] = function (scope, message, data) {
			const ret = orig.apply(this, arguments);
			try {
				// 不 await：日志落盘失败不得影响主流程
				appendLogLine(format(scope, message, data, level));
			} catch {
				/* 忽略 */
			}
			return ret;
		};
	}
	dbg.__fileLogBridged = true;
	return true;
}
