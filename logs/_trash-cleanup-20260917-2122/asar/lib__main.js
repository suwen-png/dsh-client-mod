import { createRequire } from "node:module";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, join, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, Menu, Tray, WebContentsView, app, dialog, ipcMain, nativeImage, session, shell } from "electron";
import electronUpdater from "electron-updater";
import { PROFILE_TEMPLATES, healProfilesModuleFallback, initProfile, loadProfile, readProfileBundleState, readProfileManifest, reconcileProfileBundles, resolveBundleDir, setProfileBundleEnabled, writeProfileManifest } from "@deepseek-ai/dsh-app-boot";
import { ARTIFACT_VERIFICATION_REASON_ORDER, COMPATIBILITY_REASON_ORDER, CatalogContractError, PLUGIN_MUTATION_PHASES, decodeArtifactVerificationResult, decodeCatalogDetailQuery, decodeCatalogListQuery, decodeCatalogMedia, decodeCatalogSnapshot, decodeCatalogSummary, decodeCatalogVersionPreflight, decodeCompatibilityDecision, decodeCompatibilityFingerprint, decodeCompatibilityRequest, decodeInstalledPluginListResult, decodePluginDiagnosticExportRequest, decodePluginDiagnosticExportResult, decodePluginInstallRequest, decodePluginManagementRequest, decodePluginOperationSnapshot, decodePluginOperationStartResult, decodePluginOwnedDataOffer, decodePluginOwnedDataRemovalRequest, decodePluginOwnedDataRemovalResult, decodePluginOwnedDataRetentionRequest, decodePluginOwnedDataRetentionResult, decodePluginRecoveryDiagnostic, decodePluginRecoveryRetryRequest, decodePluginRecoverySnapshot, decodePluginRuntimeEvidence, decodePluginTransactionJournalRecord, decodePresetInstallPreviewRequest, decodePresetInstallPreviewResult, decodePresetInstallRequest, decodePresetInstallResult, decodePresetRuntimeRequest, decodePresetSquareDetailQuery, decodePresetSquareDetailResult, decodePresetSquareItem, decodePresetSquareListQuery, decodePresetSquareListResponse, decodePresetSquareListResult } from "@deepseek-ai/dsh-plugin-center-contracts";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Parser } from "tar";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import * as yaml from "js-yaml";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { zipSync } from "fflate";
//#region lib/types/appearance-storage.js
/** Validated, owner-only persistence for the Desktop background. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;
/** Appearance shown before a learner selects a custom image. */
const DEFAULT_APPEARANCE = Object.freeze({
	builtinTheme: "whale-maid",
	imageDataUrl: null,
	focusY: 50,
	glassStrength: 72,
	palette: Object.freeze([
		"#587ac2",
		"#253555",
		"#d9e5f7",
		"#8ba5d6"
	])
});
function finiteRange(value, minimum, maximum, label) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${label} must be a finite number from ${String(minimum)} to ${String(maximum)}`);
	return value;
}
function imageDataUrl(value) {
	if (value === null) return null;
	if (typeof value !== "string" || !value.startsWith("data:image/webp;base64,")) throw new Error("desktop background must be a WebP data URL");
	const encoded = value.slice(23);
	if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) throw new Error("desktop background contains invalid base64 data");
	if (Buffer.byteLength(encoded, "base64") > MAX_IMAGE_BYTES) throw new Error(`desktop background exceeds ${String(MAX_IMAGE_BYTES)} bytes`);
	return value;
}
function builtinTheme(value, image) {
	if (value === void 0) return image === null ? "whale-maid" : null;
	if (value === null) {
		if (image === null) throw new Error("custom desktop appearance must contain a WebP image");
		return null;
	}
	if (value !== "official" && value !== "whale-maid" && value !== "cloud-cat" && value !== "jiutian-deep-space" && value !== "jiutian-quantum-glass" && value !== "jiutian-dawn-horizon") throw new Error("desktop bundled theme is not supported");
	if (image !== null) throw new Error("bundled desktop appearance must not contain a custom image");
	return value;
}
function palette(value) {
	if (!isPalette(value)) throw new Error("desktop background palette must contain four six-digit hex colors");
	return Object.freeze([
		value[0],
		value[1],
		value[2],
		value[3]
	]);
}
function isPalette(value) {
	return Array.isArray(value) && value.length === 4 && value.every((color) => typeof color === "string" && HEX_COLOR.test(color));
}
/** Validate data crossing the renderer-to-main or durable-file boundary. */
function parseAppearance(value) {
	if (typeof value !== "object" || value === null) throw new Error("desktop appearance must be an object");
	const input = value;
	const image = imageDataUrl(input.imageDataUrl);
	return Object.freeze({
		builtinTheme: builtinTheme(input.builtinTheme, image),
		imageDataUrl: image,
		focusY: finiteRange(input.focusY, 0, 100, "focusY"),
		glassStrength: finiteRange(input.glassStrength, 35, 92, "glassStrength"),
		palette: palette(input.palette)
	});
}
/** One appearance document under Electron's private userData directory. */
var AppearanceStorage = class {
	file;
	/** @param userDataDirectory - Electron app.getPath('userData'). */
	constructor(userDataDirectory) {
		this.file = join(userDataDirectory, "appearance.json");
	}
	/** Read and validate the saved document, or return the bundled default. */
	async read() {
		let source;
		try {
			source = await readFile(this.file, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return DEFAULT_APPEARANCE;
			throw error;
		}
		return parseAppearance(JSON.parse(source));
	}
	/** Atomically replace the saved document with owner-only permissions. */
	async save(value) {
		const parsed = parseAppearance(value);
		await mkdir(dirname(this.file), {
			recursive: true,
			mode: 448
		});
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		const handle = await open(temporary, "wx", 384);
		try {
			await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
			await handle.sync();
			await handle.close();
			await rename(temporary, this.file);
		} catch (error) {
			await handle.close().catch(() => {});
			await rm(temporary, { force: true });
			throw error;
		}
		return parsed;
	}
	/** Remove the custom document and return the bundled default. */
	async reset() {
		await rm(this.file, { force: true });
		return DEFAULT_APPEARANCE;
	}
};
//#endregion
//#region lib/types/built-in-applications.js
/** Startup reconciliation for applications owned by the Desktop release. */
/** Keep release-owned applications enabled and remove stale profile-installed copies. */
function reconcileBuiltInApplications(profileDirectory, packageNames) {
	const manifest = readProfileManifest("desktop", profileDirectory);
	const profile = manifest.dsh?.profile;
	const bundles = [...profile?.bundles ?? []];
	const disabledBundles = [...profile?.disabledBundles ?? []];
	const dependencies = { ...manifest.dependencies };
	let changed = false;
	for (const packageName of packageNames) {
		if (!bundles.includes(packageName)) {
			bundles.push(packageName);
			changed = true;
		}
		const disabledIndex = disabledBundles.indexOf(packageName);
		if (disabledIndex !== -1) {
			disabledBundles.splice(disabledIndex, 1);
			changed = true;
		}
		if (dependencies[packageName] !== void 0) {
			Reflect.deleteProperty(dependencies, packageName);
			changed = true;
		}
		rmSync(join(profileDirectory, "node_modules", ...packageName.split("/")), {
			force: true,
			recursive: true
		});
	}
	if (!changed) return;
	writeProfileManifest(profileDirectory, {
		...manifest,
		dependencies,
		dsh: {
			...manifest.dsh,
			profile: {
				...profile,
				bundles,
				disabledBundles
			}
		}
	});
}
//#endregion
//#region lib/types/desktop-bridge-contract.js
/** Fixed Electron bridge shared by the Desktop main process and preload. */
/** Closed channel set; the preload never accepts a caller-provided channel. */
const DESKTOP_CHANNELS = {
	workspacePickDirectory: "dsh-desktop:workspace:pick-directory",
	appearanceGet: "dsh-desktop:appearance:get",
	appearanceSave: "dsh-desktop:appearance:save",
	appearanceReset: "dsh-desktop:appearance:reset",
	updatesGet: "dsh-desktop:updates:get",
	updatesCheck: "dsh-desktop:updates:check",
	updatesDownload: "dsh-desktop:updates:download",
	updatesInstall: "dsh-desktop:updates:install",
	updatesState: "dsh-desktop:updates:state",
	catalogList: "dsh-desktop:catalog:list",
	catalogRefresh: "dsh-desktop:catalog:refresh",
	catalogDetail: "dsh-desktop:catalog:detail",
	catalogCheckCompatibility: "dsh-desktop:catalog:check-compatibility",
	presetSquareList: "dsh-desktop:preset-square:list",
	presetSquareDetail: "dsh-desktop:preset-square:detail",
	presetSquarePreviewInstall: "dsh-desktop:preset-square:preview-install",
	presetSquareInstall: "dsh-desktop:preset-square:install",
	presetSquareRuntimeCheck: "dsh-desktop:preset-square:runtime-check",
	presetSquareRuntimeInstall: "dsh-desktop:preset-square:runtime-install",
	installedPluginsList: "dsh-desktop:installed-plugins:list",
	pluginOperationStart: "dsh-desktop:plugin-operation:start",
	pluginOperationGet: "dsh-desktop:plugin-operation:get",
	pluginOperationState: "dsh-desktop:plugin-operation:state",
	pluginOwnedDataGetOffer: "dsh-desktop:plugin-owned-data:get-offer",
	pluginOwnedDataRemove: "dsh-desktop:plugin-owned-data:remove",
	pluginOwnedDataRetain: "dsh-desktop:plugin-owned-data:retain",
	pluginRecoveryGet: "dsh-desktop:plugin-recovery:get",
	pluginRecoveryRetry: "dsh-desktop:plugin-recovery:retry",
	pluginRecoveryExport: "dsh-desktop:plugin-recovery:export",
	pluginRecoveryState: "dsh-desktop:plugin-recovery:state"
};
//#endregion
//#region lib/types/host-supervisor.js
/** Supervise the loopback Web Host used by the first desktop application. */
const READINESS_PREFIX = "dsh web: ";
const DEFAULT_READINESS_TIMEOUT_MS = 9e4;
const DEFAULT_SHUTDOWN_TIMEOUT_MS$1 = 5e3;
/** Assert and normalize one readiness line. */
function parseReadinessLine(line) {
	if (!line.startsWith(READINESS_PREFIX)) return void 0;
	const token = line.slice(9).split(/\s/u, 1)[0];
	if (token === void 0) throw new Error(`desktop Host readiness line has no URL: ${line}`);
	let url;
	try {
		url = new URL(token);
	} catch {
		throw new Error(`desktop Host readiness URL is invalid: ${token}`);
	}
	const port = Number(url.port);
	if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" && url.hostname !== "localhost" || url.pathname !== "/" || url.search !== "" || url.hash !== "" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`desktop Host readiness URL must be loopback HTTP with an explicit port: ${token}`);
	return url.origin;
}
/**
* Create a line parser whose result is stable after readiness.
* @returns A fresh incremental parser.
*/
function createReadinessParser() {
	let pending = "";
	let readyUrl;
	const accept = (line) => {
		const parsed = parseReadinessLine(line.replace(/\r$/u, ""));
		if (parsed === void 0) return void 0;
		if (readyUrl !== void 0 && parsed !== readyUrl) throw new Error(`desktop Host emitted conflicting readiness URLs: ${readyUrl} and ${parsed}`);
		readyUrl = parsed;
		return readyUrl;
	};
	return {
		push(chunk) {
			pending += chunk;
			for (;;) {
				const newline = pending.indexOf("\n");
				if (newline === -1) return readyUrl;
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				const parsed = accept(line);
				if (parsed !== void 0) return parsed;
			}
		},
		finalize() {
			if (pending !== "") accept(pending);
			if (readyUrl === void 0) throw new Error("desktop Host exited before emitting its readiness URL");
			return readyUrl;
		}
	};
}
function deferred() {
	let resolve;
	let reject;
	return {
		promise: new Promise((accept, decline) => {
			resolve = accept;
			reject = decline;
		}),
		resolve,
		reject
	};
}
/**
* Create a single-owner, multi-generation Host supervisor.
* @param options - Child-process operations and bounded lifecycle timings.
* @returns A supervisor that coalesces starts and shutdowns while serializing restarts.
*/
function createHostSupervisor(options) {
	const readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
	const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS$1;
	let active;
	let nextGenerationId = 0;
	let permanentlyClosed = false;
	let restartQueue = Promise.resolve();
	let shutdownPromise;
	const cleanupStartup = (state) => {
		if (state.readinessTimer !== void 0) clearTimeout(state.readinessTimer);
		delete state.readinessTimer;
		for (const dispose of state.startupCleanups.splice(0)) dispose();
	};
	const appendOutput = (state, chunk) => {
		state.output = `${state.output}${chunk}`.slice(-32768);
		options.log?.(chunk);
	};
	const failReadiness = (state, error) => {
		if (state.readinessSettled) return;
		state.readinessSettled = true;
		cleanupStartup(state);
		const diagnostic = state.output === "" ? "" : `\nHost output:\n${state.output}`;
		state.readiness.reject(/* @__PURE__ */ new Error(`${error instanceof Error ? error.message : String(error)}${diagnostic}`));
	};
	const settleExit = (state, code, signal) => {
		if (state.exitedSettled) return;
		state.exitedSettled = true;
		state.exited.resolve(void 0);
		if (!state.readinessSettled) failReadiness(state, /* @__PURE__ */ new Error(`desktop Host exited before readiness (code ${String(code)}, signal ${String(signal)})`));
		if (active !== state) return;
		active = void 0;
		if (state.origin !== void 0 && state.stopOwner === void 0) options.onUnexpectedExit?.({
			id: state.id,
			origin: state.origin,
			code,
			signal
		});
	};
	const createGeneration = () => {
		const child = options.spawnHost();
		const state = {
			id: ++nextGenerationId,
			child,
			readiness: deferred(),
			exited: deferred(),
			parser: createReadinessParser(),
			startupCleanups: [],
			output: "",
			readinessSettled: false,
			exitedSettled: false
		};
		active = state;
		const acceptChunk = (chunk) => {
			appendOutput(state, chunk);
			try {
				const origin = state.parser.push(chunk);
				if (origin === void 0 || state.readinessSettled) return;
				state.readinessSettled = true;
				state.origin = origin;
				cleanupStartup(state);
				state.readiness.resolve(origin);
			} catch (error) {
				failReadiness(state, error);
				child.kill("SIGTERM");
			}
		};
		state.readinessTimer = setTimeout(() => {
			failReadiness(state, /* @__PURE__ */ new Error(`desktop Host readiness timed out after ${String(readinessTimeoutMs)}ms`));
			child.kill("SIGTERM");
		}, readinessTimeoutMs);
		state.startupCleanups.push(child.stdout.onData(acceptChunk));
		state.startupCleanups.push(child.stderr.onData((chunk) => {
			appendOutput(state, chunk);
		}));
		child.onError((error) => {
			failReadiness(state, /* @__PURE__ */ new Error(`desktop Host failed to spawn: ${error.message}`));
			settleExit(state, null, null);
		});
		child.onExit((code, signal) => {
			settleExit(state, code, signal);
		});
		return state;
	};
	const stopGeneration = (state, owner) => {
		if (state.stopPromise !== void 0) return state.stopPromise;
		state.stopOwner = owner;
		state.stopPromise = (async () => {
			if (state.exitedSettled) return;
			state.child.kill("SIGTERM");
			let timer;
			const outcome = await Promise.race([state.exited.promise.then(() => "closed"), new Promise((resolve) => {
				timer = setTimeout(() => {
					resolve("timeout");
				}, shutdownTimeoutMs);
			})]);
			if (timer !== void 0) clearTimeout(timer);
			if (outcome === "timeout") {
				state.child.kill("SIGKILL");
				await state.exited.promise;
			}
		})();
		return state.stopPromise;
	};
	const start = () => {
		if (permanentlyClosed) return Promise.reject(/* @__PURE__ */ new Error("desktop Host cannot start after shutdown"));
		if (active !== void 0) return active.readiness.promise;
		try {
			return createGeneration().readiness.promise;
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
	};
	const assertRestartOpen = () => {
		if (permanentlyClosed) throw new Error("desktop Host cannot restart after shutdown");
	};
	const restart = (reason, beforeStart) => {
		if (permanentlyClosed) return Promise.reject(/* @__PURE__ */ new Error("desktop Host cannot restart after shutdown"));
		const operation = restartQueue.then(async () => {
			assertRestartOpen();
			const previous = active;
			if (previous !== void 0) await stopGeneration(previous, {
				kind: "restart",
				reason
			});
			assertRestartOpen();
			await beforeStart?.();
			assertRestartOpen();
			const next = createGeneration();
			const origin = await next.readiness.promise;
			return {
				id: next.id,
				origin
			};
		});
		restartQueue = operation.then(() => void 0, () => void 0);
		return operation;
	};
	const shutdown = () => {
		if (shutdownPromise !== void 0) return shutdownPromise;
		permanentlyClosed = true;
		const generationAtShutdown = active;
		const initialStop = generationAtShutdown === void 0 ? Promise.resolve() : stopGeneration(generationAtShutdown, { kind: "shutdown" });
		shutdownPromise = (async () => {
			await initialStop;
			await restartQueue;
			const finalGeneration = active;
			if (finalGeneration !== void 0 && finalGeneration !== generationAtShutdown) await stopGeneration(finalGeneration, { kind: "shutdown" });
		})();
		return shutdownPromise;
	};
	return {
		get current() {
			if (active?.origin === void 0) return void 0;
			return {
				id: active.id,
				origin: active.origin
			};
		},
		start,
		restart,
		shutdown
	};
}
function streamAdapter(stream) {
	return { onData(listener) {
		const accept = (chunk) => {
			listener(chunk.toString());
		};
		stream.on("data", accept);
		return () => {
			stream.off("data", accept);
		};
	} };
}
/**
* Spawn the production Web Host on an OS-assigned loopback port.
* @param options - Node runtime, built CLI and process environment.
* @returns The child handle consumed by {@link createHostSupervisor}.
*/
function spawnDshWeb(options) {
	const env = options.electronRunAsNode ? {
		...options.env,
		ELECTRON_RUN_AS_NODE: "1"
	} : options.env;
	return nodeChildAdapter(spawn(options.nodeExecutable, [
		"--expose-internals",
		options.cliEntry,
		"web",
		"--host",
		"127.0.0.1",
		"--port",
		"0"
	], {
		cwd: options.cwd,
		env,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		],
		windowsHide: true
	}));
}
/** Adapt Node's event overloads to the supervisor's explicit ownership API. */
function nodeChildAdapter(child) {
	return {
		...child.pid === void 0 ? {} : { pid: child.pid },
		stdout: streamAdapter(child.stdout),
		stderr: streamAdapter(child.stderr),
		onExit(listener) {
			child.on("exit", listener);
			return () => {
				child.off("exit", listener);
			};
		},
		onError(listener) {
			child.on("error", listener);
			return () => {
				child.off("error", listener);
			};
		},
		kill(signal) {
			child.kill(signal);
		}
	};
}
//#endregion
//#region lib/types/plugin-center/bridge-policy.js
/** Pure ownership check for renderer-to-Desktop IPC requests. */
/** Reject stale Host generations, unrelated WebContents, and malformed frame URLs. */
function assertDesktopRequestOwner(identity, owner) {
	if (owner.origin === void 0 || identity.senderId !== owner.webContentsId || identity.senderFrameUrl === void 0) throw new Error("Desktop bridge request is not owned by the current renderer");
	let origin;
	try {
		origin = new URL(identity.senderFrameUrl).origin;
	} catch {
		throw new Error("Desktop bridge request has an invalid renderer URL");
	}
	if (origin !== owner.origin) throw new Error("Desktop bridge request origin is not current");
}
//#endregion
//#region lib/types/plugin-center/catalog-cache.js
/** Owner-only atomic persistence for the last fully decoded catalog snapshot. */
/** One verified cache document under Electron's private userData directory. */
var CatalogCache = class {
	file;
	/**
	* @param userDataDirectory - Electron app.getPath('userData').
	* @param authorityIdentity - Optional closed-runtime identity that scopes reusable authority.
	*/
	constructor(userDataDirectory, authorityIdentity) {
		const suffix = authorityIdentity === void 0 ? "" : `-${createHash("sha256").update(JSON.stringify([...new Set(authorityIdentity)].sort())).digest("hex").slice(0, 24)}`;
		this.file = join(userDataDirectory, "plugin-center", `catalog-v1${suffix}.json`);
	}
	/** Read a complete verified snapshot; corrupt or absent cache has no authority. */
	async read() {
		let source;
		try {
			source = await readFile(this.file, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return void 0;
			throw error;
		}
		try {
			return decodeCatalogSnapshot(JSON.parse(source));
		} catch (error) {
			if (error instanceof SyntaxError || error instanceof CatalogContractError) return void 0;
			throw error;
		}
	}
	/** Publish one already decoded snapshot through same-directory atomic rename. */
	async save(snapshot) {
		const decoded = decodeCatalogSnapshot(snapshot);
		await mkdir(dirname(this.file), {
			recursive: true,
			mode: 448
		});
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		const handle = await open(temporary, "wx", 384);
		try {
			await handle.writeFile(`${JSON.stringify(decoded)}\n`, "utf8");
			await handle.sync();
			await handle.close();
			await rename(temporary, this.file);
		} catch (error) {
			await handle.close().catch(() => {});
			await rm(temporary, { force: true });
			throw error;
		}
	}
};
//#endregion
//#region lib/types/plugin-center/environment.js
/** Resolve immutable release and selected-Profile facts for plugin preflight. */
/**
* Map runtime OS and architecture facts to the marketplace's supported tuple.
* @param os - Node runtime platform name.
* @param architecture - Node runtime architecture name.
* @returns The supported marketplace platform tuple.
*/
function resolveSupportedPluginPlatform(os, architecture) {
	if (os === "darwin" && architecture === "arm64") return "darwin-arm64";
	if (os === "win32" && architecture === "x64") return "win32-x64";
	throw new Error(`plugin mutation is unsupported on ${os}-${architecture}`);
}
/**
* Build and validate one immutable compatibility fingerprint from Desktop-owned facts.
* @param input - Current release, Profile, protection, catalog, and operation facts.
* @returns A closed fingerprint suitable for one exact compatibility decision.
*/
function resolveCompatibilityFingerprint(input) {
	return decodeCompatibilityFingerprint({
		desktopVersion: input.desktopVersion,
		dshVersion: input.dshVersion,
		nodeVersion: input.nodeVersion,
		platform: resolveSupportedPluginPlatform(input.os, input.architecture),
		catalogEtag: input.catalogEtag,
		catalogFreshness: input.catalogFreshness,
		profileRevision: input.profileRevision,
		installedPlugins: input.installedPlugins,
		protectedPackageNames: input.systemComponents.packageNames,
		protectedEntryIds: input.systemComponents.entryIds,
		activeOperation: input.activeOperation
	});
}
//#endregion
//#region lib/types/plugin-center/artifact-verifier.js
/** Inspect one catalog-bound package archive without extracting or executing plugin code. */
const MAX_PACKED_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES$1 = 256 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1e4;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_BUNDLE_PATCH_BYTES = 4 * 1024 * 1024;
const PACKAGE_NAME$6 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXACT_VERSION$4 = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const INSTALL_LIFECYCLE_SCRIPTS = new Set([
	"preinstall",
	"install",
	"postinstall"
]);
function archivePath(raw) {
	if (raw.startsWith("/") || raw.startsWith("\\") || /^[A-Za-z]:[\\/]/u.test(raw)) return {
		path: raw,
		issue: "archive-absolute-path"
	};
	if (raw.includes("\\")) return {
		path: raw,
		issue: "archive-path-traversal"
	};
	const segments = raw.split("/");
	if (segments.some((segment) => segment === "..")) return {
		path: raw,
		issue: "archive-path-traversal"
	};
	while (segments[0] === ".") segments.shift();
	return { path: segments.join("/") };
}
function archiveMember$1(path) {
	return `package/${path.startsWith("./") ? path.slice(2) : path}`;
}
function stringArray(value) {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return void 0;
	return value;
}
function sameSet(left, right) {
	const sortedRight = [...right].sort();
	return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}
function patchValues$1(patch, key) {
	const values = /* @__PURE__ */ new Set();
	const expression = key === "id" ? /^\s*-\s+id:\s+(.+?)\s*$/u : /^\s+name:\s+(.+?)\s*$/u;
	for (const line of patch.split(/\r?\n/u)) {
		const matched = line.match(expression)?.[1]?.trim();
		if (matched === void 0) continue;
		const unquoted = matched.startsWith("'") && matched.endsWith("'") || matched.startsWith("\"") && matched.endsWith("\"") ? matched.slice(1, -1) : matched;
		values.add(unquoted);
	}
	return values;
}
function parseArchive(bytes, bundlePatchPath, add) {
	const paths = /* @__PURE__ */ new Set();
	const manifestPath = "package/package.json";
	const expectedPatchPath = archiveMember$1(bundlePatchPath);
	let packageManifest;
	let bundlePatch;
	let entryCount = 0;
	let unpackedBytes = 0;
	let boundsExceeded = false;
	const observation = () => ({
		paths,
		...packageManifest === void 0 ? {} : { packageManifest },
		...bundlePatch === void 0 ? {} : { bundlePatch },
		entryCount,
		unpackedBytes
	});
	return new Promise((resolve, reject) => {
		const parser = new Parser({
			strict: true,
			maxMetaEntrySize: MAX_MANIFEST_BYTES,
			maxDecompressionRatio: 200
		});
		parser.on("entry", (entry) => {
			entryCount += 1;
			unpackedBytes += entry.size;
			const raw = entry.header.path ?? entry.path;
			const decoded = archivePath(raw);
			if (decoded.issue !== void 0) add(decoded.issue, raw);
			const path = decoded.path;
			if (paths.has(path)) add("archive-duplicate-entry", path);
			paths.add(path);
			if (entry.type === "Link" || entry.type === "SymbolicLink") add("archive-unsafe-link", `${path} -> ${entry.linkpath ?? ""}`);
			else if (![
				"File",
				"OldFile",
				"Directory",
				"ContiguousFile"
			].includes(entry.type)) add("archive-format-invalid", `${path} (${entry.type})`);
			if (entryCount > MAX_ENTRY_COUNT) add("archive-file-count-exceeded", String(entryCount));
			if (unpackedBytes > MAX_UNPACKED_BYTES$1) add("archive-unpacked-size-exceeded", String(unpackedBytes));
			if (entryCount > MAX_ENTRY_COUNT || unpackedBytes > MAX_UNPACKED_BYTES$1) {
				boundsExceeded = true;
				entry.resume();
				parser.abort(/* @__PURE__ */ new Error("plugin archive exceeded hard verification bounds"));
				return;
			}
			const limit = path === manifestPath ? MAX_MANIFEST_BYTES : path === expectedPatchPath ? MAX_BUNDLE_PATCH_BYTES : 0;
			if (limit === 0 || entry.type === "Directory") {
				entry.resume();
				return;
			}
			const chunks = [];
			let length = 0;
			entry.on("data", (chunk) => {
				length += chunk.length;
				if (length <= limit) chunks.push(Buffer.from(chunk));
			});
			entry.on("end", () => {
				if (length > limit) {
					add("archive-unpacked-size-exceeded", path);
					return;
				}
				const content = Buffer.concat(chunks);
				if (path === manifestPath) packageManifest = content;
				else bundlePatch = content;
			});
			entry.resume();
		});
		parser.once("error", (error) => {
			if (boundsExceeded) resolve(observation());
			else reject(error instanceof Error ? error : new Error(String(error)));
		});
		parser.once("end", () => {
			resolve(observation());
		});
		parser.end(bytes);
	});
}
/**
* Verify compressed bytes, archive containment, manifest identity, and runtime evidence.
* @param input - Trusted catalog metadata, current platform, and controlled-cache bytes.
* @returns An ordered bounded result containing no archive bytes or local paths.
*/
async function verifyPluginArtifact(input) {
	const bytes = Buffer.from(input.bytes);
	const reasons = [];
	const observedReasons = /* @__PURE__ */ new Set();
	const add = (code, subject) => {
		const boundedSubject = subject.replace(/[\u0000-\u001f\u007f]/gu, "?").slice(0, 256);
		const key = `${code}\u0000${boundedSubject}`;
		if (observedReasons.has(key)) return;
		observedReasons.add(key);
		reasons.push({
			code,
			subject: boundedSubject
		});
	};
	const evidence = input.candidate.artifacts.find((artifact) => artifact.platform === input.platform);
	if (evidence === void 0) {
		add("expected-evidence-missing", input.platform);
		return decodeArtifactVerificationResult({
			verified: false,
			reasons,
			observedPackageName: null,
			observedVersion: null,
			observedBundlePatch: null,
			entryCount: 0,
			unpackedBytes: 0
		});
	}
	if (bytes.length > MAX_PACKED_BYTES) {
		add("packed-size-exceeded", `${String(bytes.length)} > ${String(MAX_PACKED_BYTES)}`);
		if (bytes.length !== evidence.packedBytes) add("packed-size-mismatch", `${String(bytes.length)} != ${String(evidence.packedBytes)}`);
		return decodeArtifactVerificationResult({
			verified: false,
			reasons,
			observedPackageName: null,
			observedVersion: null,
			observedBundlePatch: null,
			entryCount: 0,
			unpackedBytes: 0
		});
	}
	if (bytes.length > evidence.packedBytes) add("packed-size-exceeded", `${String(bytes.length)} > ${String(evidence.packedBytes)}`);
	if (bytes.length !== evidence.packedBytes) add("packed-size-mismatch", `${String(bytes.length)} != ${String(evidence.packedBytes)}`);
	if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) add("sha256-mismatch", input.candidate.packageName);
	if (`sha512-${createHash("sha512").update(bytes).digest("base64")}` !== evidence.integrity) add("integrity-mismatch", input.candidate.packageName);
	let observation;
	try {
		observation = await parseArchive(bytes, input.candidate.bundlePatch, add);
	} catch {
		add("archive-format-invalid", input.candidate.packageName);
		observation = {
			paths: /* @__PURE__ */ new Set(),
			entryCount: 0,
			unpackedBytes: 0
		};
	}
	if (observation.entryCount > evidence.fileCount) add("archive-file-count-exceeded", `${String(observation.entryCount)} > ${String(evidence.fileCount)}`);
	if (observation.unpackedBytes > evidence.unpackedBytes) add("archive-unpacked-size-exceeded", `${String(observation.unpackedBytes)} > ${String(evidence.unpackedBytes)}`);
	let manifest;
	if (observation.packageManifest === void 0) add("package-manifest-missing", "package/package.json");
	else try {
		const parsed = JSON.parse(observation.packageManifest.toString("utf8"));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new TypeError("manifest object required");
		manifest = parsed;
	} catch {
		add("package-manifest-invalid", "package/package.json");
	}
	const manifestPackageName = typeof manifest?.name === "string" ? manifest.name : null;
	const manifestVersion = typeof manifest?.version === "string" ? manifest.version : null;
	const manifestBundlePatch = typeof manifest?.dsh?.bundle?.patch === "string" ? manifest.dsh.bundle.patch : null;
	const observedPackageName = manifestPackageName !== null && PACKAGE_NAME$6.test(manifestPackageName) ? manifestPackageName : null;
	const observedVersion = manifestVersion !== null && EXACT_VERSION$4.test(manifestVersion) ? manifestVersion : null;
	const observedBundlePatch = manifestBundlePatch === input.candidate.bundlePatch ? manifestBundlePatch : null;
	if (manifest !== void 0) {
		if (manifestPackageName !== input.candidate.packageName) add("package-name-mismatch", manifestPackageName ?? "<missing>");
		if (manifestVersion !== input.candidate.version) add("package-version-mismatch", manifestVersion ?? "<missing>");
		if (manifestBundlePatch !== input.candidate.bundlePatch) add("bundle-patch-mismatch", manifestBundlePatch ?? "<missing>");
		if (typeof manifest.scripts === "object" && manifest.scripts !== null && !Array.isArray(manifest.scripts)) {
			for (const script of Object.keys(manifest.scripts)) if (INSTALL_LIFECYCLE_SCRIPTS.has(script)) add("lifecycle-script-denied", script);
		} else if (manifest.scripts !== void 0) add("package-manifest-invalid", "scripts");
		const declared = manifest.dsh?.pluginCenter;
		const declaredEntries = declared?.expectedEntries === void 0 ? void 0 : stringArray(declared.expectedEntries);
		const declaredClientModules = declared?.expectedClientModules === void 0 ? void 0 : stringArray(declared.expectedClientModules);
		const declaredSkillIds = declared?.expectedSkillIds === void 0 ? void 0 : stringArray(declared.expectedSkillIds);
		if (declared?.expectedEntries !== void 0 && (declaredEntries === void 0 || !sameSet(declaredEntries, input.candidate.expectedEntries))) add("expected-evidence-missing", "expectedEntries");
		if (declared?.expectedClientModules !== void 0 && (declaredClientModules === void 0 || !sameSet(declaredClientModules, input.candidate.expectedClientModules))) add("expected-evidence-missing", "expectedClientModules");
		if (declared?.expectedSkillIds !== void 0 && (declaredSkillIds === void 0 || !sameSet(declaredSkillIds, input.candidate.expectedSkillIds))) add("expected-evidence-missing", "expectedSkillIds");
	}
	const patchPath = archiveMember$1(input.candidate.bundlePatch);
	if (!observation.paths.has(patchPath) || observation.bundlePatch === void 0) add("bundle-patch-missing", patchPath);
	else {
		const patch = observation.bundlePatch.toString("utf8");
		const ids = patchValues$1(patch, "id");
		const names = patchValues$1(patch, "name");
		for (const entryId of input.candidate.expectedEntries) if (!ids.has(entryId)) add("expected-evidence-missing", entryId);
		for (const moduleName of input.candidate.expectedClientModules) if (!names.has(moduleName)) add("expected-evidence-missing", moduleName);
	}
	const order = new Map(ARTIFACT_VERIFICATION_REASON_ORDER.map((code, index) => [code, index]));
	reasons.sort((left, right) => {
		const byCode = (order.get(left.code) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.code) ?? Number.MAX_SAFE_INTEGER);
		return byCode === 0 ? left.subject.localeCompare(right.subject) : byCode;
	});
	return decodeArtifactVerificationResult({
		verified: reasons.length === 0,
		reasons,
		observedPackageName,
		observedVersion,
		observedBundlePatch,
		entryCount: observation.entryCount,
		unpackedBytes: observation.unpackedBytes
	});
}
//#endregion
//#region lib/types/plugin-center/npm-ecosystem-catalog.js
/** Live npm-backed discovery for published DeepSeek Harness Bundles. */
const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
const NPM_SEARCH_URL = `${NPM_REGISTRY_ORIGIN}/-/v1/search`;
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_RAW_ORIGIN = "https://raw.githubusercontent.com";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES$1 = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 1e4;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS$1 = 15e3;
const SEARCH_CACHE_MS = 6e4;
const DISCOVERY_CACHE_FRESH_MS = 1440 * 60 * 1e3;
const MAX_DISCOVERY_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_CACHE_REFERENCES = 1e3;
const SEARCH_PAGE_SIZE = 250;
const TEXT_SEARCH_SIZE = 50;
const MAX_GITHUB_TREE_ENTRIES = 2e3;
const MAX_GITHUB_MANIFESTS = 40;
const MAX_SEARCH_INDEX_ENTRIES = 1e4;
const MAX_REFERENCE_HYDRATIONS_PER_QUERY = 96;
const COLD_START_ENTRY_LIMIT = 6;
const COLD_START_BATCH_SIZE = 12;
const PACKAGE_NAME$5 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXACT_VERSION$3 = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const STABLE_ID$3 = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const BRAND_COLOR = /^#[0-9A-Fa-f]{6}$/u;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const FALLBACK_BRAND_COLORS = [
	"#2563EB",
	"#7C3AED",
	"#DB2777",
	"#DC2626",
	"#EA580C",
	"#0F766E",
	"#0369A1",
	"#4F46E5"
];
function record$5(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function optionalRecord$2(value, label) {
	return value === void 0 || value === null ? void 0 : record$5(value, label);
}
function trimmedString(value, maximum) {
	return typeof value === "string" && value !== "" && value.trim() === value && value.length <= maximum ? value : void 0;
}
function packageName(value) {
	const decoded = trimmedString(value, 214);
	if (decoded === void 0 || !PACKAGE_NAME$5.test(decoded)) throw new Error("npm package name is invalid");
	return decoded;
}
function exactVersion(value) {
	const decoded = trimmedString(value, 64);
	if (decoded === void 0 || !EXACT_VERSION$3.test(decoded)) throw new Error("npm package version is invalid");
	return decoded;
}
function canonicalInstant$1(value) {
	const decoded = trimmedString(value, 80);
	if (decoded === void 0 || !Number.isFinite(Date.parse(decoded))) throw new Error("npm publication date is invalid");
	return new Date(decoded).toISOString();
}
function stringList(value, maximum, itemMaximum) {
	if (!Array.isArray(value)) return [];
	const result = [];
	for (const item of value) {
		const decoded = trimmedString(item, itemMaximum);
		if (decoded === void 0 || result.includes(decoded)) continue;
		result.push(decoded);
		if (result.length === maximum) break;
	}
	return result;
}
function portableBundlePatch(value) {
	const decoded = trimmedString(value, 256);
	if (decoded === void 0 || decoded.startsWith("/") || decoded.startsWith("\\") || /^[A-Za-z]:/u.test(decoded) || decoded.includes("\\")) throw new Error("dsh.bundle.patch must be a portable relative path");
	const normalized = decoded.startsWith("./") ? decoded.slice(2) : decoded;
	if (normalized === "" || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error("dsh.bundle.patch must be a portable relative path");
	return decoded;
}
function npmPluginId(name) {
	return `npm.${name.replace(/^@/u, "").replace("/", ".").replace(/[^a-z0-9._-]+/gu, "-").replace(/^[._-]+|[._-]+$/gu, "").slice(0, 90) || "package"}.${createHash("sha256").update(name).digest("hex").slice(0, 12)}`;
}
function authorName(metadata, fallback) {
	const author = metadata["author"];
	if (typeof author === "string") return trimmedString(author, 120) ?? fallback;
	const namedAuthor = trimmedString(optionalRecord$2(author, "npm author")?.["name"], 120);
	if (namedAuthor !== void 0) return namedAuthor;
	const maintainers = metadata["maintainers"];
	if (Array.isArray(maintainers) && maintainers.length > 0) return trimmedString(optionalRecord$2(maintainers[0], "npm maintainer")?.["name"], 120) ?? fallback;
	return fallback;
}
function repositoryLocation(metadata) {
	const repository = metadata["repository"];
	if (typeof repository === "string") return trimmedString(repository, 2048);
	if (typeof repository !== "object" || repository === null || Array.isArray(repository)) return void 0;
	return trimmedString(repository["url"], 2048);
}
function githubOwner(metadata) {
	const location = repositoryLocation(metadata);
	if (location === void 0) return void 0;
	const shorthand = location.match(/^github:([^/]+)\/[^/]+$/u)?.[1];
	if (shorthand !== void 0) return GITHUB_OWNER.test(shorthand) ? shorthand : void 0;
	const scp = location.match(/^git@github\.com:([^/]+)\/[^/]+$/u)?.[1];
	if (scp !== void 0) return GITHUB_OWNER.test(scp) ? scp : void 0;
	let parsed;
	try {
		parsed = new URL(location.replace(/^git\+/u, ""));
	} catch {
		return;
	}
	if (parsed.hostname.toLocaleLowerCase() !== "github.com") return void 0;
	const owner = parsed.pathname.split("/").filter(Boolean)[0];
	return owner !== void 0 && GITHUB_OWNER.test(owner) ? owner : void 0;
}
function publisherAvatar(metadata, publisher) {
	const owner = githubOwner(metadata);
	return owner === void 0 ? null : decodeCatalogMedia({
		url: `https://avatars.githubusercontent.com/${owner}?s=128`,
		alt: `${publisher} publisher avatar`,
		width: 128,
		height: 128
	});
}
function catalogIcon(pluginCenter, metadata, publisher) {
	const declared = pluginCenter?.["icon"];
	if (declared !== void 0 && declared !== null) try {
		return decodeCatalogMedia(declared);
	} catch {}
	return publisherAvatar(metadata, publisher);
}
function catalogBrandColor(pluginCenter, packageName) {
	const declared = pluginCenter?.["brandColor"];
	if (typeof declared === "string" && BRAND_COLOR.test(declared)) return declared;
	return FALLBACK_BRAND_COLORS[(createHash("sha256").update(packageName).digest()[0] ?? 0) % FALLBACK_BRAND_COLORS.length] ?? FALLBACK_BRAND_COLORS[0];
}
function catalogKind(keywords, dsh) {
	return stringList(optionalRecord$2(dsh["pluginCenter"], "npm dsh.pluginCenter")?.["expectedSkillIds"], 64, 128).length > 0 || keywords.includes("dsh-skill-pack") ? "skill-pack" : "plugin";
}
function capabilities(keywords, hasClient) {
	const result = ["host"];
	if (hasClient) result.push("client");
	if (keywords.some((keyword) => [
		"skill",
		"skills",
		"agent-skill",
		"dsh-skill-pack"
	].includes(keyword))) result.push("skill");
	return result;
}
function summaryFor(reference, values) {
	const packageCapabilities = capabilities(values.keywords, reference.hasClient);
	return {
		pluginId: reference.pluginId,
		version: reference.version,
		catalogKind: catalogKind(values.keywords, { pluginCenter: void 0 }),
		scope: "public",
		displayName: reference.packageName,
		summary: values.description,
		publisher: values.publisher,
		verified: false,
		keywords: values.keywords,
		capabilities: packageCapabilities,
		icon: values.icon,
		brandColor: values.brandColor,
		compatibility: {
			status: "unknown",
			reason: values.compatibilityReason,
			platforms: ["darwin-arm64", "win32-x64"]
		},
		updatedAt: values.updatedAt,
		installed: false
	};
}
function exactKeys(source, label, expected) {
	const actual = Object.keys(source).sort();
	const keys = [...expected].sort();
	if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new Error(`${label} has unexpected fields`);
}
function cachedString(value, label, maximum, allowEmpty = false) {
	if (typeof value !== "string" || value.length > maximum || value.trim() !== value || !allowEmpty && value.length === 0) throw new Error(`${label} is invalid`);
	return value;
}
function cachedStringList(value, label, maximum, itemMaximum) {
	if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} is invalid`);
	const items = value.map((item, index) => cachedString(item, `${label}[${String(index)}]`, itemMaximum));
	if (new Set(items).size !== items.length) throw new Error(`${label} contains duplicates`);
	return items;
}
function decodeDiscoverySeed(value, index) {
	const label = `npm discovery seed ${String(index)}`;
	const source = record$5(value, label);
	exactKeys(source, label, [
		"name",
		"version",
		"updatedAt",
		"publisher",
		"description",
		"keywords"
	]);
	return {
		name: packageName(source["name"]),
		version: exactVersion(source["version"]),
		updatedAt: canonicalInstant$1(source["updatedAt"]),
		publisher: cachedString(source["publisher"], `${label}.publisher`, 120),
		description: cachedString(source["description"], `${label}.description`, 280, true),
		keywords: cachedStringList(source["keywords"], `${label}.keywords`, 64, 80)
	};
}
function decodeDiscoveryReference(value, index) {
	const label = `npm discovery reference ${String(index)}`;
	const source = record$5(value, label);
	exactKeys(source, label, [
		"pluginId",
		"packageName",
		"version",
		"bundlePatch",
		"hasClient",
		"nodeRange",
		"nodeRangeDeclared",
		"tarballUrl",
		"integrity",
		"summary"
	]);
	const decodedPackageName = packageName(source["packageName"]);
	const decodedVersion = exactVersion(source["version"]);
	const pluginId = cachedString(source["pluginId"], `${label}.pluginId`, 128);
	const tarballUrl = cachedString(source["tarballUrl"], `${label}.tarballUrl`, 2048);
	const parsedTarball = new URL(tarballUrl);
	const integrity = cachedString(source["integrity"], `${label}.integrity`, 96);
	const summary = decodeCatalogSummary(source["summary"]);
	if (pluginId !== npmPluginId(decodedPackageName) || !STABLE_ID$3.test(pluginId) || parsedTarball.protocol !== "https:" || parsedTarball.origin !== NPM_REGISTRY_ORIGIN || !SHA512_INTEGRITY.test(integrity) || typeof source["hasClient"] !== "boolean" || typeof source["nodeRangeDeclared"] !== "boolean" || summary.pluginId !== pluginId || summary.version !== decodedVersion || summary.displayName !== decodedPackageName || summary.scope !== "public" || summary.verified || summary.installed || summary.compatibility.status !== "unknown") throw new Error(`${label} identity is invalid`);
	return {
		pluginId,
		packageName: decodedPackageName,
		version: decodedVersion,
		bundlePatch: portableBundlePatch(source["bundlePatch"]),
		hasClient: source["hasClient"],
		nodeRange: cachedString(source["nodeRange"], `${label}.nodeRange`, 160),
		nodeRangeDeclared: source["nodeRangeDeclared"],
		tarballUrl,
		integrity,
		summary
	};
}
function decodeDiscoveryDocument(value) {
	const source = record$5(value, "npm discovery cache");
	exactKeys(source, "npm discovery cache", [
		"schemaVersion",
		"generatedAt",
		"seeds",
		"references"
	]);
	if (source["schemaVersion"] !== 2) throw new Error("npm discovery cache schema is unsupported");
	if (!Array.isArray(source["seeds"]) || source["seeds"].length > MAX_SEARCH_INDEX_ENTRIES || !Array.isArray(source["references"]) || source["references"].length > MAX_DISCOVERY_CACHE_REFERENCES) throw new Error("npm discovery cache exceeds bounds");
	const seeds = source["seeds"].map(decodeDiscoverySeed);
	const references = source["references"].map(decodeDiscoveryReference);
	const seedIdentities = new Set(seeds.map((seed) => `${seed.name}@${seed.version}`));
	if (seedIdentities.size !== seeds.length || new Set(references.map((reference) => `${reference.packageName}@${reference.version}`)).size !== references.length || references.some((reference) => !seedIdentities.has(`${reference.packageName}@${reference.version}`))) throw new Error("npm discovery cache identities are inconsistent");
	return {
		schemaVersion: 2,
		generatedAt: canonicalInstant$1(source["generatedAt"]),
		seeds,
		references
	};
}
var NpmDiscoveryCache = class {
	file;
	constructor(userDataDirectory) {
		this.file = join(userDataDirectory, "plugin-center", "npm-discovery-v2.json");
	}
	async read() {
		let source;
		try {
			source = await readFile(this.file, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return void 0;
			throw error;
		}
		if (Buffer.byteLength(source, "utf8") > MAX_DISCOVERY_CACHE_BYTES) return void 0;
		try {
			return decodeDiscoveryDocument(JSON.parse(source));
		} catch {
			return;
		}
	}
	async save(document) {
		const decoded = decodeDiscoveryDocument(document);
		const serialized = `${JSON.stringify(decoded)}\n`;
		if (Buffer.byteLength(serialized, "utf8") > MAX_DISCOVERY_CACHE_BYTES) throw new Error("npm discovery cache exceeds 8 MiB");
		await mkdir(dirname(this.file), {
			recursive: true,
			mode: 448
		});
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		const handle = await open(temporary, "wx", 384);
		try {
			await handle.writeFile(serialized, "utf8");
			await handle.sync();
			await handle.close();
			await rename(temporary, this.file);
		} catch (error) {
			await handle.close().catch(() => {});
			await rm(temporary, { force: true });
			throw error;
		}
	}
};
function searchMatches(entry, query) {
	if (query === "") return true;
	const needle = query.toLocaleLowerCase();
	return [
		entry.displayName,
		entry.summary,
		entry.publisher,
		...entry.keywords
	].some((value) => value.toLocaleLowerCase().includes(needle));
}
async function fetchJson(fetcher, url, label) {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, REQUEST_TIMEOUT_MS$1);
	try {
		let response;
		try {
			response = await fetcher(url, {
				headers: { accept: "application/json" },
				redirect: "error",
				signal: controller.signal
			});
		} catch (error) {
			throw new CatalogNetworkError(`${label} request failed`, error);
		}
		if (response.status === 404) throw new CatalogResourceMissingError(`${label} returned HTTP 404`);
		if (!response.ok) throw new CatalogNetworkError(`${label} returned HTTP ${String(response.status)}`);
		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new CatalogNetworkError(`${label} exceeds 2 MiB`);
		let text;
		try {
			text = await response.text();
		} catch (error) {
			throw new CatalogNetworkError(`${label} response failed`, error);
		}
		if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new CatalogNetworkError(`${label} exceeds 2 MiB`);
		try {
			return JSON.parse(text);
		} catch (error) {
			throw new CatalogNetworkError(`${label} returned invalid JSON`, error);
		}
	} finally {
		clearTimeout(timeout);
	}
}
async function fetchArtifact(fetcher, rawUrl) {
	const url = new URL(rawUrl);
	if (url.origin !== NPM_REGISTRY_ORIGIN || url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") throw new Error("npm artifact URL is outside the fixed registry origin");
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort();
	}, REQUEST_TIMEOUT_MS$1);
	try {
		const response = await fetcher(url, {
			headers: { accept: "application/octet-stream" },
			redirect: "error",
			signal: controller.signal
		});
		if (!response.ok || response.body === null) throw new Error(`npm artifact returned HTTP ${String(response.status)}`);
		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > MAX_ARTIFACT_BYTES$1) throw new Error("npm artifact exceeds 64 MiB");
		const chunks = [];
		let length = 0;
		const reader = response.body.getReader();
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				length += next.value.byteLength;
				if (length > MAX_ARTIFACT_BYTES$1) {
					await reader.cancel("artifact size limit exceeded");
					throw new Error("npm artifact exceeds 64 MiB");
				}
				chunks.push(next.value);
			}
		} finally {
			reader.releaseLock();
		}
		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	} finally {
		clearTimeout(timeout);
	}
}
function archiveMember(path) {
	return `package/${path.startsWith("./") ? path.slice(2) : path}`;
}
function inspectArchive(bytes, bundlePatch) {
	const manifestPath = "package/package.json";
	const patchPath = archiveMember(bundlePatch);
	let manifestBytes;
	let patchBytes;
	let entryCount = 0;
	let unpackedBytes = 0;
	return new Promise((resolve, reject) => {
		const parser = new Parser({
			strict: true,
			maxMetaEntrySize: 1024 * 1024,
			maxDecompressionRatio: 200
		});
		parser.on("entry", (entry) => {
			entryCount += 1;
			unpackedBytes += entry.size;
			if (entryCount > MAX_ARCHIVE_ENTRIES || unpackedBytes > MAX_UNPACKED_BYTES) {
				entry.resume();
				parser.abort(/* @__PURE__ */ new Error("npm artifact exceeds archive inspection bounds"));
				return;
			}
			const rawPath = entry.header.path ?? entry.path;
			const normalized = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
			const limit = normalized === manifestPath ? 1024 * 1024 : normalized === patchPath ? MAX_CAPTURE_BYTES : 0;
			if (limit === 0 || entry.type === "Directory") {
				entry.resume();
				return;
			}
			const chunks = [];
			let length = 0;
			entry.on("data", (chunk) => {
				length += chunk.length;
				if (length <= limit) chunks.push(Buffer.from(chunk));
			});
			entry.on("end", () => {
				if (length > limit) {
					parser.abort(/* @__PURE__ */ new Error("npm artifact metadata exceeds inspection bounds"));
					return;
				}
				if (normalized === manifestPath) manifestBytes = Buffer.concat(chunks);
				else patchBytes = Buffer.concat(chunks);
			});
			entry.resume();
		});
		parser.once("error", (error) => {
			reject(error instanceof Error ? error : new Error(String(error)));
		});
		parser.once("end", () => {
			if (manifestBytes === void 0 || patchBytes === void 0) {
				reject(/* @__PURE__ */ new Error("npm artifact is missing its package manifest or Bundle patch"));
				return;
			}
			try {
				resolve({
					manifest: record$5(JSON.parse(manifestBytes.toString("utf8")), "npm artifact package.json"),
					patch: patchBytes.toString("utf8"),
					entryCount,
					unpackedBytes
				});
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		parser.end(Buffer.from(bytes));
	});
}
function bundlePatchEntries(patch) {
	const entryIds = /* @__PURE__ */ new Set();
	const moduleNames = /* @__PURE__ */ new Set();
	let decoded;
	try {
		decoded = yaml.load(patch, { schema: entryListSchema });
	} catch (error) {
		throw new Error(`failed to parse npm Bundle patch: ${String(error)}`);
	}
	if (!Array.isArray(decoded)) throw new Error("npm Bundle patch must be a top-level patch list");
	const patches = decoded.map((value, index) => record$5(value, `npm Bundle patch ${String(index + 1)}`));
	const visit = (value, label) => {
		const entry = record$5(value, label);
		const id = trimmedString(entry["id"], 128);
		const name = trimmedString(entry["name"], 214);
		if (id !== void 0) entryIds.add(id);
		if (name !== void 0) moduleNames.add(name);
		if (entry["group"] === true && entry["config"] !== void 0) {
			if (!Array.isArray(entry["config"])) throw new Error(`${label}.config must be an entry list for a group`);
			entry["config"].forEach((child, index) => {
				visit(child, `${label}.config[${String(index)}]`);
			});
		}
	};
	patches.forEach((patchEntry, patchIndex) => {
		if (patchEntry.insert === void 0) return;
		if (!Array.isArray(patchEntry.insert)) throw new Error(`npm Bundle patch ${String(patchIndex + 1)} insert must be an entry list`);
		patchEntry.insert.forEach((entry, entryIndex) => {
			visit(entry, `npm Bundle patch ${String(patchIndex + 1)} insert[${String(entryIndex)}]`);
		});
	});
	return {
		entryIds: [...entryIds],
		moduleNames: [...moduleNames]
	};
}
function verifyBundleModuleDependencies(manifest, packageNameValue, moduleNames, hostProvidedModules) {
	const dependencies = {
		...optionalRecord$2(manifest["dependencies"], "npm artifact dependencies") ?? {},
		...optionalRecord$2(manifest["optionalDependencies"], "npm artifact optionalDependencies") ?? {}
	};
	const referenced = /* @__PURE__ */ new Map();
	for (const moduleName of moduleNames) {
		if (moduleName === packageNameValue) continue;
		if (!PACKAGE_NAME$5.test(moduleName)) throw new Error(`npm Bundle references invalid module ${moduleName}`);
		const declared = dependencies[moduleName];
		if (typeof declared !== "string") {
			if (hostProvidedModules.has(moduleName)) continue;
			throw new Error(`npm Bundle references undeclared dependency ${moduleName}`);
		}
		if (!EXACT_VERSION$3.test(declared)) throw new Error(`npm Bundle dependency ${moduleName} must use an exact version`);
		referenced.set(moduleName, declared);
	}
	return referenced;
}
function searchPage(value, requireDshKeyword) {
	const source = record$5(value, "npm search response");
	const objects = source["objects"];
	if (!Array.isArray(objects) || objects.length > SEARCH_PAGE_SIZE) throw new Error("npm search response has invalid objects");
	const rawTotal = source["total"];
	let total;
	if (rawTotal !== void 0) {
		if (typeof rawTotal !== "number" || !Number.isSafeInteger(rawTotal) || rawTotal < objects.length || requireDshKeyword && rawTotal > MAX_SEARCH_INDEX_ENTRIES) throw new Error("npm search response has invalid total");
		total = rawTotal;
	}
	const seeds = objects.flatMap((item, index) => {
		try {
			const packageValue = record$5(record$5(item, `npm search object ${String(index)}`)["package"], "npm search package");
			const keywords = stringList(packageValue["keywords"], 64, 80);
			if (requireDshKeyword && !keywords.includes("dsh-plugin")) return [];
			const publisherValue = optionalRecord$2(packageValue["publisher"], "npm search publisher");
			return [{
				name: packageName(packageValue["name"]),
				version: exactVersion(packageValue["version"]),
				updatedAt: canonicalInstant$1(packageValue["date"]),
				publisher: trimmedString(publisherValue?.["username"], 120) ?? "npm publisher",
				description: trimmedString(packageValue["description"], 280) ?? "",
				keywords
			}];
		} catch {
			return [];
		}
	});
	return {
		total,
		objectCount: objects.length,
		seeds
	};
}
function seedMatchRank(seed, query) {
	if (query === "") return 0;
	const needle = query.toLocaleLowerCase();
	const name = seed.name.toLocaleLowerCase();
	if (name === needle) return 0;
	const unscopedName = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
	if (unscopedName === needle) return 0;
	if (name.startsWith(needle) || unscopedName.startsWith(needle)) return 1;
	if (name.includes(needle)) return 2;
	const keywords = seed.keywords.map((keyword) => keyword.toLocaleLowerCase());
	if (keywords.includes(needle)) return 3;
	if (seed.publisher.toLocaleLowerCase().includes(needle)) return 4;
	if (seed.description.toLocaleLowerCase().includes(needle)) return 5;
	if (keywords.some((keyword) => keyword.includes(needle))) return 6;
}
function mergeSeeds(...groups) {
	const unique = /* @__PURE__ */ new Map();
	for (const group of groups) for (const seed of group) unique.set(`${seed.name}@${seed.version}`, seed);
	return [...unique.values()].slice(-1e4);
}
var CatalogDiscoveryError = class extends Error {
	notice;
	constructor(notice, message) {
		super(message);
		this.notice = notice;
		this.name = "CatalogDiscoveryError";
	}
};
var CatalogNetworkError = class extends Error {
	constructor(message, cause) {
		super(message, cause === void 0 ? void 0 : { cause });
		this.name = "CatalogNetworkError";
	}
};
var CatalogResourceMissingError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "CatalogResourceMissingError";
	}
};
function githubRepository(query) {
	let parsed;
	try {
		parsed = new URL(query);
	} catch {
		return;
	}
	if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") return void 0;
	const segments = parsed.pathname.split("/").filter(Boolean);
	if (segments.length !== 2) return void 0;
	const [owner, rawRepo] = segments;
	if (owner === void 0 || rawRepo === void 0) return void 0;
	const repo = rawRepo.replace(/\.git$/u, "");
	return GITHUB_OWNER.test(owner) && GITHUB_REPO.test(repo) ? {
		owner,
		repo
	} : void 0;
}
function exactPackageSpecifier(query) {
	if (query === "") return void 0;
	if (PACKAGE_NAME$5.test(query)) return query.startsWith("@") ? {
		name: query,
		version: void 0
	} : void 0;
	const separator = query.lastIndexOf("@");
	if (separator <= 0) return void 0;
	const name = query.slice(0, separator);
	const version = query.slice(separator + 1);
	return PACKAGE_NAME$5.test(name) && EXACT_VERSION$3.test(version) ? {
		name,
		version
	} : void 0;
}
function matchingSeeds(seeds, query, kind) {
	const matches = [];
	for (const [index, seed] of seeds.entries()) {
		const rank = seedMatchRank(seed, query);
		if (rank !== void 0) matches.push({
			seed,
			rank,
			index
		});
	}
	matches.sort((left, right) => left.rank - right.rank || left.index - right.index);
	if (query !== "" || kind === "plugin") return matches.map((match) => match.seed);
	const skillKeywords = new Set([
		"skill",
		"skills",
		"agent-skill",
		"dsh-skill-pack"
	]);
	const preferred = [];
	const remaining = [];
	for (const match of matches) (match.seed.keywords.some((keyword) => skillKeywords.has(keyword)) ? preferred : remaining).push(match.seed);
	return [...preferred, ...remaining];
}
async function mapConcurrent(values, concurrency, project) {
	const output = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
		for (;;) {
			const index = cursor;
			cursor += 1;
			if (index >= values.length) return;
			output[index] = await project(values[index]);
		}
	});
	await Promise.all(workers);
	return output;
}
function sectioned(entries, query) {
	if (query !== "") return {
		featured: entries,
		popular: [],
		recent: []
	};
	return {
		featured: entries.slice(0, 6),
		popular: entries.slice(6, 18),
		recent: entries.slice(18)
	};
}
function snapshotEntries(snapshot) {
	return snapshot.preflights.flatMap((preflight) => {
		const detail = snapshot.details.find((value) => value.summary.pluginId === preflight.pluginId && value.summary.version === preflight.version);
		return detail === void 0 ? [] : [{
			detail,
			preflight
		}];
	});
}
function createSnapshot(entries, generatedAt) {
	const retained = [...new Map(entries.map((entry) => [`${entry.preflight.pluginId}@${entry.preflight.version}`, entry])).values()].sort((left, right) => right.detail.summary.updatedAt.localeCompare(left.detail.summary.updatedAt)).slice(0, 100);
	const identity = retained.map((entry) => ({
		pluginId: entry.preflight.pluginId,
		version: entry.preflight.version,
		packageName: entry.preflight.packageName,
		integrity: entry.preflight.artifacts[0]?.integrity ?? ""
	}));
	const etag = `npm-ecosystem-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32)}`;
	const preflights = retained.map((entry) => ({
		...entry.preflight,
		catalogEtag: etag
	}));
	const summaries = retained.map((entry) => entry.detail.summary);
	const ids = [...new Set(summaries.map((summary) => summary.pluginId))];
	return decodeCatalogSnapshot({
		schemaVersion: 1,
		etag,
		generatedAt,
		maxAgeSeconds: 86400,
		sections: {
			featured: ids.slice(0, 6),
			popular: ids.slice(6, 66),
			recent: ids.slice(66)
		},
		entries: summaries,
		details: retained.map((entry) => entry.detail),
		preflights
	});
}
/** Discover published Bundles from bounded npm/GitHub signals and retain exact validated authority. */
var NpmEcosystemCatalogRepository = class {
	cache;
	fetcher;
	now;
	hostProvidedModules;
	authorityState;
	authorityLoading;
	packageReferences = /* @__PURE__ */ new Map();
	referenceLoads = /* @__PURE__ */ new Map();
	searchIndexCache;
	searchIndexLoading;
	discoveryDocument;
	discoveryLoading;
	discoveryWrites = Promise.resolve();
	searchCache = /* @__PURE__ */ new Map();
	searches = /* @__PURE__ */ new Map();
	networkSearches = /* @__PURE__ */ new Map();
	hydrations = /* @__PURE__ */ new Map();
	publicationGate = Promise.resolve();
	discoveryCache;
	constructor(cache, fetcher = fetch, now = Date.now, discoveryDirectory, hostProvidedModules = /* @__PURE__ */ new Set()) {
		this.cache = cache;
		this.fetcher = fetcher;
		this.now = now;
		this.hostProvidedModules = hostProvidedModules;
		this.discoveryCache = discoveryDirectory === void 0 ? void 0 : new NpmDiscoveryCache(discoveryDirectory);
	}
	currentAuthority() {
		this.authorityLoading ??= this.cache.read().catch(() => void 0).then((cached) => {
			const validEntries = cached === void 0 ? [] : snapshotEntries(cached).filter((entry) => entry.preflight.pluginId.startsWith("npm.") && entry.preflight.artifacts.length > 0 && entry.preflight.artifacts.every((artifact) => new URL(artifact.url).origin === NPM_REGISTRY_ORIGIN));
			const state = {
				snapshot: createSnapshot(validEntries, new Date(this.now()).toISOString()),
				source: validEntries.length === 0 ? "bundled" : "cache",
				freshness: validEntries.length === 0 ? "stale" : "cached"
			};
			this.authorityState = state;
			return state;
		});
		return this.authorityState === void 0 ? this.authorityLoading : Promise.resolve(this.authorityState);
	}
	currentDiscovery() {
		if (this.discoveryDocument !== void 0) return Promise.resolve(this.discoveryDocument);
		if (this.discoveryLoading !== void 0) return this.discoveryLoading;
		const loading = (this.discoveryCache?.read() ?? Promise.resolve(void 0)).catch(() => void 0).then((cached) => {
			const document = cached ?? null;
			if (document !== null) for (const reference of document.references) this.packageReferences.set(`${reference.pluginId}@${reference.version}`, reference);
			this.discoveryDocument = document;
			return document;
		}).finally(() => {
			this.discoveryLoading = void 0;
		});
		this.discoveryLoading = loading;
		return loading;
	}
	async persistDiscovery(seeds, generatedAt) {
		const previous = await this.currentDiscovery();
		const retainedSeeds = mergeSeeds(previous?.seeds ?? [], seeds);
		const seedIdentities = new Set(retainedSeeds.map((seed) => `${seed.name}@${seed.version}`));
		const references = [...this.packageReferences.values()].filter((reference) => seedIdentities.has(`${reference.packageName}@${reference.version}`)).slice(-1e3);
		const document = decodeDiscoveryDocument({
			schemaVersion: 2,
			generatedAt: previous !== null && previous.generatedAt > generatedAt ? previous.generatedAt : generatedAt,
			seeds: retainedSeeds,
			references
		});
		this.discoveryDocument = document;
		if (this.discoveryCache === void 0) return;
		this.discoveryWrites = this.discoveryWrites.then(() => this.discoveryCache?.save(document), () => this.discoveryCache?.save(document)).then(() => void 0, () => void 0);
		await this.discoveryWrites;
	}
	async cachedDiscoveryResult(query, document) {
		const references = matchingSeeds(document.seeds, query.query.trim(), query.catalogKind).flatMap((seed) => {
			const reference = this.packageReferences.get(`${npmPluginId(seed.name)}@${seed.version}`);
			return reference === void 0 || reference.summary.catalogKind !== query.catalogKind ? [] : [reference];
		}).slice(0, query.limit);
		if (references.length === 0) return null;
		const authority = await this.currentAuthority();
		const verified = new Map(authority.snapshot.entries.map((entry) => [`${entry.pluginId}@${entry.version}`, entry]));
		const entries = references.map((reference) => verified.get(`${reference.pluginId}@${reference.version}`) ?? reference.summary);
		return {
			etag: `npm-discovery-${createHash("sha256").update(JSON.stringify(entries.map((entry) => [entry.pluginId, entry.version]))).digest("hex").slice(0, 24)}`,
			generatedAt: document.generatedAt,
			freshness: this.now() - Date.parse(document.generatedAt) <= DISCOVERY_CACHE_FRESH_MS ? "cached" : "stale",
			source: "cache",
			sections: sectioned(entries, query.query.trim())
		};
	}
	async decodeReference(seed) {
		const url = new URL(`${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(seed.name)}/${encodeURIComponent(seed.version)}`);
		const metadata = record$5(await fetchJson(this.fetcher, url, `${seed.name}@${seed.version}`), "npm version metadata");
		const decodedName = packageName(metadata["name"]);
		const decodedVersion = exactVersion(metadata["version"]);
		if (decodedName !== seed.name || decodedVersion !== seed.version) throw new Error("npm exact metadata identity changed");
		const keywords = stringList(metadata["keywords"], 24, 48);
		const dsh = record$5(metadata["dsh"], "npm dsh manifest");
		const bundle = record$5(dsh["bundle"], "npm dsh.bundle manifest");
		const pluginCenter = optionalRecord$2(dsh["pluginCenter"], "npm dsh.pluginCenter manifest");
		const bundlePatch = portableBundlePatch(bundle["patch"]);
		const client = optionalRecord$2(dsh["client"], "npm dsh.client manifest");
		const dist = record$5(metadata["dist"], "npm dist metadata");
		const tarballUrl = trimmedString(dist["tarball"], 2048);
		const integrity = trimmedString(dist["integrity"], 96);
		if (tarballUrl === void 0 || integrity === void 0 || !SHA512_INTEGRITY.test(integrity)) throw new Error("npm exact version lacks immutable distribution evidence");
		const parsedTarball = new URL(tarballUrl);
		if (parsedTarball.origin !== NPM_REGISTRY_ORIGIN || parsedTarball.protocol !== "https:") throw new Error("npm tarball is outside the fixed registry origin");
		const description = trimmedString(metadata["description"], 280) ?? `DeepSeek Harness Bundle ${decodedName}`;
		const publisher = authorName(metadata, seed.publisher);
		const declaredNodeRange = trimmedString(optionalRecord$2(metadata["engines"], "npm engines")?.["node"], 160);
		const nodeRange = declaredNodeRange ?? ">=22.19 <25";
		const base = {
			pluginId: npmPluginId(decodedName),
			packageName: decodedName,
			version: decodedVersion,
			bundlePatch,
			hasClient: client !== void 0,
			nodeRange,
			nodeRangeDeclared: declaredNodeRange !== void 0,
			tarballUrl,
			integrity
		};
		return {
			...base,
			summary: {
				...summaryFor(base, {
					description,
					keywords,
					publisher,
					updatedAt: seed.updatedAt,
					icon: catalogIcon(pluginCenter, metadata, publisher),
					brandColor: catalogBrandColor(pluginCenter, decodedName),
					compatibilityReason: declaredNodeRange === void 0 ? "发布者未声明 Node.js 兼容范围；安装前会校验 Studio 运行时与制品，安装后仍须运行验证。" : "安装前会按发布者声明的 Node.js 范围完成兼容性与产物校验。"
				}),
				catalogKind: catalogKind(keywords, dsh)
			}
		};
	}
	loadReference(seed) {
		const pluginId = npmPluginId(seed.name);
		const existing = this.packageReferences.get(`${pluginId}@${seed.version}`);
		if (existing !== void 0) return Promise.resolve(existing);
		const key = `${seed.name}@${seed.version}`;
		const running = this.referenceLoads.get(key);
		if (running !== void 0) return running;
		const loading = this.decodeReference(seed).then((reference) => {
			this.packageReferences.set(`${reference.pluginId}@${reference.version}`, reference);
			return reference;
		}).catch((error) => {
			if (error instanceof CatalogNetworkError) throw error;
			return null;
		}).finally(() => {
			this.referenceLoads.delete(key);
		});
		this.referenceLoads.set(key, loading);
		return loading;
	}
	async fetchKeywordSearchPage(from) {
		const url = new URL(NPM_SEARCH_URL);
		url.searchParams.set("text", "keywords:dsh-plugin");
		url.searchParams.set("size", String(SEARCH_PAGE_SIZE));
		url.searchParams.set("from", String(from));
		return searchPage(await fetchJson(this.fetcher, url, "npm dsh-plugin search"), true);
	}
	async fetchTextSearchPage(query) {
		const url = new URL(NPM_SEARCH_URL);
		url.searchParams.set("text", query);
		url.searchParams.set("size", String(TEXT_SEARCH_SIZE));
		url.searchParams.set("from", "0");
		return searchPage(await fetchJson(this.fetcher, url, "npm bounded text search"), false);
	}
	async fetchExactSeed(specifier) {
		const url = new URL(`${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(specifier.name)}`);
		const packument = record$5(await fetchJson(this.fetcher, url, `${specifier.name} packument`), "npm packument");
		const name = packageName(packument["name"]);
		if (name !== specifier.name) throw new Error("npm latest metadata identity changed");
		const versions = record$5(packument["versions"], "npm packument versions");
		const distTags = record$5(packument["dist-tags"], "npm packument dist-tags");
		const version = exactVersion(specifier.version ?? distTags["latest"]);
		const metadata = record$5(versions[version], "npm packument exact version");
		if (packageName(metadata["name"]) !== name || exactVersion(metadata["version"]) !== version) throw new Error("npm packument exact version identity changed");
		const times = record$5(packument["time"], "npm packument publication times");
		const publisher = authorName(metadata, authorName(packument, "npm publisher"));
		return {
			name,
			version,
			updatedAt: canonicalInstant$1(times[version]),
			publisher,
			description: trimmedString(metadata["description"], 280) ?? "",
			keywords: stringList(metadata["keywords"], 64, 80)
		};
	}
	async fetchGitHubPackageNames(repository) {
		const repositoryUrl = new URL(`${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`);
		const defaultBranch = trimmedString(record$5(await fetchJson(this.fetcher, repositoryUrl, "GitHub repository metadata"), "GitHub repository metadata")["default_branch"], 200);
		if (defaultBranch === void 0) throw new Error("GitHub repository has no valid default branch");
		const treeUrl = new URL(`${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/git/trees/${encodeURIComponent(defaultBranch)}`);
		treeUrl.searchParams.set("recursive", "1");
		const treeMetadata = record$5(await fetchJson(this.fetcher, treeUrl, "GitHub repository tree"), "GitHub tree");
		if (treeMetadata["truncated"] === true) throw new Error("GitHub repository tree is truncated");
		const tree = treeMetadata["tree"];
		if (!Array.isArray(tree) || tree.length > MAX_GITHUB_TREE_ENTRIES) throw new Error("GitHub repository tree exceeds discovery bounds");
		const names = await mapConcurrent(tree.flatMap((item, index) => {
			try {
				const entry = record$5(item, `GitHub tree entry ${String(index)}`);
				const path = trimmedString(entry["path"], 512);
				if (entry["type"] !== "blob" || path === void 0 || !/(?:^|\/)package\.json$/u.test(path)) return [];
				if (path.split("/").length > 5) return [];
				return [path];
			} catch {
				return [];
			}
		}).slice(0, MAX_GITHUB_MANIFESTS), 4, async (path) => {
			const encodedPath = path.split("/").map(encodeURIComponent).join("/");
			const rawUrl = new URL(`${GITHUB_RAW_ORIGIN}/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/${encodeURIComponent(defaultBranch)}/${encodedPath}`);
			try {
				const manifest = record$5(await fetchJson(this.fetcher, rawUrl, `GitHub manifest ${path}`), "GitHub package manifest");
				if (manifest["private"] === true) return null;
				const name = packageName(manifest["name"]);
				portableBundlePatch(record$5(record$5(manifest["dsh"], "GitHub package dsh manifest")["bundle"], "GitHub package dsh.bundle manifest")["patch"]);
				return name;
			} catch (error) {
				if (error instanceof CatalogNetworkError) throw error;
				return null;
			}
		});
		return [...new Set(names.filter((name) => name !== null))];
	}
	async fetchGitHubSeeds(repository) {
		const names = await this.fetchGitHubPackageNames(repository);
		if (names.length === 0) throw new CatalogDiscoveryError("github-no-dsh-bundle", "GitHub repository does not contain a bounded public DSH Bundle manifest");
		const published = (await mapConcurrent(names, 4, async (name) => {
			try {
				return await this.fetchExactSeed({
					name,
					version: void 0
				});
			} catch (error) {
				if (error instanceof CatalogNetworkError) throw error;
				return null;
			}
		})).filter((seed) => seed !== null);
		if (published.length === 0) throw new CatalogDiscoveryError("github-source-only", "GitHub DSH Bundle source has no published npm version eligible for one-click installation");
		return {
			seeds: published,
			sourceOnlyCount: names.length - published.length
		};
	}
	async fetchSearchIndex() {
		const first = await this.fetchKeywordSearchPage(0);
		const pages = [first];
		if (first.objectCount === SEARCH_PAGE_SIZE) if (first.total === void 0) for (let from = SEARCH_PAGE_SIZE; from < MAX_SEARCH_INDEX_ENTRIES; from += SEARCH_PAGE_SIZE) {
			const page = await this.fetchKeywordSearchPage(from);
			pages.push(page);
			if (page.objectCount < SEARCH_PAGE_SIZE) break;
		}
		else {
			const offsets = Array.from({ length: Math.ceil(first.total / SEARCH_PAGE_SIZE) - 1 }, (_, index) => (index + 1) * SEARCH_PAGE_SIZE);
			pages.push(...await mapConcurrent(offsets, 4, (from) => this.fetchKeywordSearchPage(from)));
		}
		const unique = /* @__PURE__ */ new Map();
		for (const page of pages) for (const seed of page.seeds) unique.set(`${seed.name}@${seed.version}`, seed);
		return [...unique.values()];
	}
	searchIndex(force = false) {
		if (!force && this.searchIndexCache !== void 0 && this.searchIndexCache.expiresAt > this.now()) return Promise.resolve(this.searchIndexCache.seeds);
		if (this.searchIndexLoading !== void 0) return this.searchIndexLoading;
		const loading = this.fetchSearchIndex().then((seeds) => {
			this.searchIndexCache = {
				expiresAt: this.now() + SEARCH_CACHE_MS,
				seeds
			};
			return seeds;
		}).finally(() => {
			this.searchIndexLoading = void 0;
		});
		this.searchIndexLoading = loading;
		return loading;
	}
	async referencesFor(seeds, kind, limit, batchSize) {
		const references = [];
		let unavailableCount = 0;
		const boundedSeeds = seeds.slice(0, MAX_REFERENCE_HYDRATIONS_PER_QUERY);
		for (let from = 0; from < boundedSeeds.length && references.length < limit; from += batchSize) {
			const batch = await mapConcurrent(boundedSeeds.slice(from, from + batchSize), 8, async (seed) => {
				try {
					return await this.loadReference(seed);
				} catch (error) {
					if (error instanceof CatalogNetworkError) return error;
					throw error;
				}
			});
			for (const value of batch) if (value instanceof CatalogNetworkError) unavailableCount += 1;
			else if (value !== null && value.summary.catalogKind === kind) references.push(value);
		}
		if (references.length === 0 && unavailableCount > 0) throw new CatalogNetworkError("npm exact-version metadata is temporarily unavailable");
		return references.slice(0, limit);
	}
	async resultForSeeds(query, seeds, limit, batchSize, generatedAt, matchQuery = query.query.trim()) {
		const searchQuery = query.query.trim();
		const matched = matchingSeeds(seeds, matchQuery, query.catalogKind);
		const references = await this.referencesFor(matched, query.catalogKind, limit, batchSize);
		const authority = await this.currentAuthority();
		const verified = new Map(authority.snapshot.entries.map((entry) => [`${entry.pluginId}@${entry.version}`, entry]));
		const entries = references.map((reference) => verified.get(`${reference.pluginId}@${reference.version}`) ?? reference.summary).slice(0, limit);
		return {
			etag: `npm-search-${createHash("sha256").update(JSON.stringify(entries.map((entry) => [entry.pluginId, entry.version]))).digest("hex").slice(0, 24)}`,
			generatedAt,
			freshness: "fresh",
			source: "network",
			sections: sectioned(entries, searchQuery)
		};
	}
	async searchNetwork(query, forceIndex = false) {
		const searchQuery = query.query.trim();
		const repository = githubRepository(searchQuery);
		const exact = exactPackageSpecifier(searchQuery);
		let seeds;
		let matchQuery = searchQuery;
		let notice;
		if (repository !== void 0) {
			const github = await this.fetchGitHubSeeds(repository);
			seeds = github.seeds;
			matchQuery = "";
			notice = github.sourceOnlyCount === 0 ? "github-mapped" : "github-partial";
		} else if (exact !== void 0) {
			seeds = [await this.fetchExactSeed(exact)];
			matchQuery = exact.name;
		} else if (searchQuery !== "") {
			const document = await this.currentDiscovery();
			const [textPage, keywordSeeds] = await Promise.all([this.fetchTextSearchPage(searchQuery), document === null ? this.searchIndex(forceIndex) : Promise.resolve(document.seeds)]);
			seeds = mergeSeeds(document?.seeds ?? [], keywordSeeds, textPage.seeds);
		} else seeds = await this.searchIndex(forceIndex);
		const generatedAt = new Date(this.now()).toISOString();
		const result = await this.resultForSeeds(query, seeds, query.limit, Math.min(SEARCH_PAGE_SIZE, Math.max(query.limit * 2, 24)), generatedAt, matchQuery);
		await this.persistDiscovery(seeds, generatedAt).catch(() => {});
		return notice === void 0 ? result : {
			...result,
			notice
		};
	}
	async coldStartNetwork(query) {
		const first = await this.fetchKeywordSearchPage(0);
		const generatedAt = new Date(this.now()).toISOString();
		const result = await this.resultForSeeds(query, first.seeds, Math.min(query.limit, COLD_START_ENTRY_LIMIT), COLD_START_BATCH_SIZE, generatedAt);
		await this.persistDiscovery(first.seeds, generatedAt).catch(() => {});
		return result;
	}
	async searchKnownIndex(query, document) {
		const cold = query.query.trim() === "" && query.catalogKind === "plugin";
		const generatedAt = new Date(this.now()).toISOString();
		const result = await this.resultForSeeds(query, document.seeds, cold ? Math.min(query.limit, COLD_START_ENTRY_LIMIT) : query.limit, cold ? COLD_START_BATCH_SIZE : Math.min(SEARCH_PAGE_SIZE, Math.max(query.limit * 2, 24)), generatedAt);
		await this.persistDiscovery(document.seeds, generatedAt).catch(() => {});
		return result;
	}
	async fallback(query) {
		const state = await this.currentAuthority();
		const entries = state.snapshot.entries.filter((entry) => entry.catalogKind === query.catalogKind && entry.scope === query.scope && searchMatches(entry, query.query.trim())).slice(0, query.limit);
		return {
			etag: state.snapshot.etag,
			generatedAt: state.snapshot.generatedAt,
			freshness: "stale",
			source: state.source,
			sections: sectioned(entries, query.query.trim())
		};
	}
	async recoverList(query) {
		const document = await this.currentDiscovery();
		if (document !== null) {
			const cached = await this.cachedDiscoveryResult(query, document);
			if (cached !== null) return cached;
		}
		return await this.fallback(query);
	}
	networkSearch(query, forceIndex) {
		const key = JSON.stringify(query);
		const running = this.networkSearches.get(key);
		if (running !== void 0) return running;
		const search = this.searchNetwork(query, forceIndex).catch(async (error) => {
			return {
				...await this.recoverList(query),
				notice: error instanceof CatalogDiscoveryError ? error.notice : "network-unavailable"
			};
		}).then((result) => {
			this.searchCache.set(key, {
				expiresAt: this.now() + SEARCH_CACHE_MS,
				result
			});
			return result;
		}).finally(() => {
			this.networkSearches.delete(key);
		});
		this.networkSearches.set(key, search);
		return search;
	}
	async listUncached(query) {
		if (query.query.trim() !== "") return await this.networkSearch(query, false);
		const document = await this.currentDiscovery();
		if (document !== null) {
			const cached = await this.cachedDiscoveryResult(query, document);
			if (cached !== null) return cached;
			return await this.searchKnownIndex(query, document).catch(() => this.recoverList(query));
		}
		if (query.query.trim() === "" && query.catalogKind === "plugin") return await this.coldStartNetwork(query).catch(() => this.recoverList(query));
		return await this.networkSearch(query, false);
	}
	async list(query) {
		if (query.scope === "local") return await this.fallback(query);
		const key = JSON.stringify(query);
		const cached = this.searchCache.get(key);
		if (cached !== void 0 && cached.expiresAt > this.now()) return cached.result;
		const running = this.searches.get(key);
		if (running !== void 0) return await running;
		const search = this.listUncached(query).then((result) => {
			this.searchCache.set(key, {
				expiresAt: this.now() + SEARCH_CACHE_MS,
				result
			});
			return result;
		}).finally(() => {
			this.searches.delete(key);
		});
		this.searches.set(key, search);
		return await search;
	}
	async refresh(query) {
		if (query.scope === "local") return await this.fallback(query);
		return await this.networkSearch(query, query.query.trim() === "");
	}
	async hydrate(reference) {
		const key = `${reference.pluginId}@${reference.version}`;
		const retained = snapshotEntries((await this.currentAuthority()).snapshot).find((entry) => entry.preflight.pluginId === reference.pluginId && entry.preflight.version === reference.version);
		if (retained !== void 0) return retained;
		const running = this.hydrations.get(key);
		if (running !== void 0) return await running;
		const hydration = this.decodeReference({
			name: reference.packageName,
			version: reference.version,
			updatedAt: reference.summary.updatedAt,
			publisher: reference.summary.publisher,
			description: reference.summary.summary,
			keywords: reference.summary.keywords
		}).then((currentReference) => {
			this.packageReferences.set(key, currentReference);
			return this.createAuthority(currentReference);
		}).finally(() => {
			this.hydrations.delete(key);
		});
		this.hydrations.set(key, hydration);
		return await hydration;
	}
	async createAuthority(reference) {
		const bytes = await fetchArtifact(this.fetcher, reference.tarballUrl);
		const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
		if (integrity !== reference.integrity) throw new Error("npm tarball does not match its registry integrity");
		const inspection = await inspectArchive(bytes, reference.bundlePatch);
		if (inspection.manifest["name"] !== reference.packageName || inspection.manifest["version"] !== reference.version) throw new Error("npm tarball package identity differs from exact metadata");
		const dsh = record$5(inspection.manifest["dsh"], "npm artifact dsh manifest");
		if (record$5(dsh["bundle"], "npm artifact dsh.bundle manifest")["patch"] !== reference.bundlePatch) throw new Error("npm tarball Bundle declaration changed");
		const patchEntries = bundlePatchEntries(inspection.patch);
		const entryIds = patchEntries.entryIds;
		if (entryIds.length === 0 || entryIds.some((entryId) => !STABLE_ID$3.test(entryId))) throw new Error("npm Bundle has no stable Loader entry evidence");
		const moduleNames = patchEntries.moduleNames;
		const moduleDependencies = verifyBundleModuleDependencies(inspection.manifest, reference.packageName, moduleNames, this.hostProvidedModules);
		if (optionalRecord$2(dsh["client"], "npm artifact dsh.client manifest") !== void 0 !== reference.hasClient) throw new Error("npm tarball client declaration changed");
		const dependencyClientModules = await mapConcurrent([...moduleDependencies], 8, async ([name, version]) => {
			const url = new URL(`${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
			const metadata = record$5(await fetchJson(this.fetcher, url, `${name}@${version}`), "npm dependency metadata");
			if (packageName(metadata["name"]) !== name || exactVersion(metadata["version"]) !== version) throw new Error(`npm dependency metadata identity changed for ${name}`);
			return optionalRecord$2(optionalRecord$2(metadata["dsh"], "npm dependency dsh manifest")?.["client"], "npm dependency dsh.client manifest") === void 0 ? null : name;
		});
		const expectedClientModules = [...reference.hasClient ? [reference.packageName] : [], ...dependencyClientModules.filter((name) => name !== null)];
		if (expectedClientModules.some((moduleName) => !moduleNames.includes(moduleName))) throw new Error("npm Bundle does not mount its declared client module");
		const expectedSkillIds = stringList(optionalRecord$2(dsh["pluginCenter"], "npm artifact dsh.pluginCenter manifest")?.["expectedSkillIds"], 64, 128);
		if (expectedSkillIds.some((skillId) => !STABLE_ID$3.test(skillId))) throw new Error("npm Bundle declares an invalid Skill identity");
		const verifiedSummary = {
			...reference.summary,
			verified: true,
			compatibility: {
				...reference.summary.compatibility,
				reason: reference.nodeRangeDeclared ? "确定版本的 npm 完整性、包身份、Bundle 激活声明与发布者 Node.js 范围已校验；安装前仍会核对本机环境。" : "确定版本的 npm 完整性、包身份与 Bundle 激活声明已校验；发布者未声明 Node.js 范围，安装后仍须运行验证。"
			}
		};
		const riskSummary = "这是社区发布的 DSH Bundle，产物身份已经校验，但代码未经过 DeepSeek 官方安全审计，运行时拥有应用进程权限。";
		const candidate = decodeCatalogVersionPreflight({
			pluginId: reference.pluginId,
			version: reference.version,
			packageName: reference.packageName,
			catalogEtag: "npm-pending",
			reviewed: true,
			eligible: true,
			withdrawn: false,
			desktopRange: ">=0.1.0-rc.1 <0.2.0",
			dshRange: ">=0.1.0-rc.1 <0.2.0",
			nodeRange: reference.nodeRange,
			artifacts: ["darwin-arm64", "win32-x64"].map((platform) => ({
				platform,
				url: reference.tarballUrl,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				integrity,
				packedBytes: bytes.byteLength,
				unpackedBytes: inspection.unpackedBytes,
				fileCount: inspection.entryCount
			})),
			bundlePatch: reference.bundlePatch,
			capabilities: verifiedSummary.capabilities,
			riskLevel: "high",
			riskSummary,
			executionAuthority: "broad-application-authority",
			conflicts: {
				pluginIds: [],
				packageNames: [],
				entryIds: []
			},
			expectedEntries: entryIds,
			expectedClientModules,
			expectedSkillIds,
			supportedActions: [
				"install",
				"update",
				"enable",
				"disable",
				"uninstall"
			],
			restartRequired: true
		});
		if (!(await verifyPluginArtifact({
			bytes,
			candidate,
			platform: "darwin-arm64"
		})).verified) throw new Error("npm Bundle failed non-executing artifact verification");
		const detail = {
			summary: verifiedSummary,
			description: reference.summary.summary,
			screenshots: [],
			permissions: ["安装后向当前 DeepSeek Harness Profile 注册 Bundle 条目。", "插件代码会随 Harness Host 运行，并可获得应用进程权限。"],
			riskLevel: "high",
			riskSummary,
			changelog: `npm 确定版本 ${reference.version}。`,
			publishedAt: reference.summary.updatedAt,
			expectedEntries: entryIds,
			expectedClientModules,
			expectedSkillIds,
			eligible: true,
			withdrawn: false
		};
		let release;
		const previous = this.publicationGate;
		this.publicationGate = new Promise((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			const nextSnapshot = createSnapshot([...snapshotEntries((await this.currentAuthority()).snapshot), {
				detail,
				preflight: candidate
			}], new Date(this.now()).toISOString());
			await this.cache.save(nextSnapshot);
			const next = {
				snapshot: nextSnapshot,
				source: "network",
				freshness: "fresh"
			};
			this.authorityState = next;
			const retainedPreflight = nextSnapshot.preflights.find((value) => value.pluginId === reference.pluginId && value.version === reference.version);
			if (retainedPreflight === void 0) throw new Error("validated npm Bundle was not retained in catalog authority");
			return {
				detail,
				preflight: retainedPreflight
			};
		} finally {
			release();
		}
	}
	async detail(query) {
		const current = await this.currentAuthority();
		const cached = current.snapshot.details.find((item) => item.summary.pluginId === query.pluginId && item.summary.version === query.version);
		if (cached !== void 0) return {
			etag: current.snapshot.etag,
			generatedAt: current.snapshot.generatedAt,
			freshness: current.freshness,
			source: current.source,
			detail: cached
		};
		const reference = this.packageReferences.get(`${query.pluginId}@${query.version}`);
		if (reference === void 0) return {
			etag: current.snapshot.etag,
			generatedAt: current.snapshot.generatedAt,
			freshness: current.freshness,
			source: current.source,
			detail: null
		};
		const entry = await this.hydrate(reference);
		const state = await this.currentAuthority();
		return {
			etag: state.snapshot.etag,
			generatedAt: state.snapshot.generatedAt,
			freshness: state.freshness,
			source: state.source,
			detail: entry.detail
		};
	}
	async resolvePreflight(request) {
		let state = await this.currentAuthority();
		let candidate = state.snapshot.preflights.find((item) => item.pluginId === request.pluginId && item.version === request.version) ?? null;
		if (candidate === null) {
			const reference = this.packageReferences.get(`${request.pluginId}@${request.version}`);
			if (reference !== void 0) try {
				await this.hydrate(reference);
				state = await this.currentAuthority();
				candidate = state.snapshot.preflights.find((item) => item.pluginId === request.pluginId && item.version === request.version) ?? null;
			} catch {
				candidate = null;
			}
		}
		return {
			candidate,
			candidates: state.snapshot.preflights,
			etag: state.snapshot.etag,
			freshness: state.freshness
		};
	}
	async installedAuthority() {
		const state = await this.currentAuthority();
		return {
			etag: state.snapshot.etag,
			freshness: state.freshness,
			entries: state.snapshot.entries,
			details: state.snapshot.details,
			preflights: state.snapshot.preflights
		};
	}
};
//#endregion
//#region lib/types/plugin-center/artifact-downloader.js
/** Bounded trusted-catalog artifact download into an operation-owned private cache. */
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS$1 = 3e4;
/** Trusted-catalog download owner; URLs and size bounds never come from the renderer. */
var PluginArtifactDownloader = class {
	operationsDirectory;
	fetcher;
	timeoutMs;
	constructor(operationsDirectory, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS$1) {
		this.operationsDirectory = operationsDirectory;
		this.fetcher = fetcher;
		this.timeoutMs = timeoutMs;
	}
	async download(candidate, platform, operationId) {
		const evidence = candidate.artifacts.find((value) => value.platform === platform);
		if (evidence === void 0) throw new Error(`validated artifact is missing for ${platform}`);
		const maximum = Math.min(evidence.packedBytes, MAX_ARTIFACT_BYTES);
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, this.timeoutMs);
		try {
			const response = await this.fetcher(evidence.url, {
				method: "GET",
				redirect: "error",
				signal: controller.signal,
				headers: { accept: "application/octet-stream" }
			});
			if (!response.ok) throw new Error(`plugin artifact returned HTTP ${String(response.status)}`);
			const declared = Number(response.headers.get("content-length"));
			if (Number.isFinite(declared) && declared > maximum) throw new Error("plugin artifact exceeds its validated packed size");
			if (response.body === null) throw new Error("plugin artifact response has no body");
			const chunks = [];
			let length = 0;
			const reader = response.body.getReader();
			try {
				for (;;) {
					const next = await reader.read();
					if (next.done) break;
					length += next.value.byteLength;
					if (length > maximum) {
						await reader.cancel("validated packed size exceeded");
						throw new Error("plugin artifact exceeds its validated packed size");
					}
					chunks.push(next.value);
				}
			} finally {
				reader.releaseLock();
			}
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			const directory = join(this.operationsDirectory, operationId);
			const path = join(directory, "artifact.tgz");
			await mkdir(directory, {
				recursive: true,
				mode: 448
			});
			const handle = await open(path, "wx", 384);
			try {
				await handle.writeFile(bytes);
			} finally {
				await handle.close();
			}
			return {
				bytes,
				path,
				evidence
			};
		} finally {
			clearTimeout(timeout);
		}
	}
};
//#endregion
//#region lib/types/plugin-center/compatibility.js
/** Deterministic exact-action compatibility evaluation with no local mutation. */
const semver$1 = createRequire(import.meta.url)("semver");
const SEMVER_OPTIONS = { includePrerelease: true };
function currentPlugin(installed, pluginId) {
	return installed.find((plugin) => plugin.pluginId === pluginId);
}
function actionSupported(action, candidate, installed) {
	if (!candidate.supportedActions.includes(action)) return false;
	if (action === "install") return installed === void 0;
	if (installed === void 0) return false;
	if (installed.packageName !== candidate.packageName) return false;
	if (action === "update") return semver$1.valid(installed.version) !== null && semver$1.gt(candidate.version, installed.version, SEMVER_OPTIONS);
	if (installed.version !== candidate.version) return false;
	if (action === "enable") return !installed.enabled;
	if (action === "disable") return installed.enabled;
	return true;
}
/**
* Evaluate one decoded catalog version against one immutable local fingerprint.
* @param input - Catalog-owned metadata, Desktop-owned facts, and one closed action.
* @returns An ordered allow or deny result scoped to every supplied input.
*/
function evaluateCompatibility(input) {
	const { candidate, fingerprint, action } = input;
	const reasons = [];
	const observed = /* @__PURE__ */ new Set();
	const add = (code, subject, actual = null, expected = null) => {
		const key = `${code}\u0000${subject}\u0000${actual ?? ""}\u0000${expected ?? ""}`;
		if (observed.has(key)) return;
		observed.add(key);
		reasons.push({
			code,
			subject,
			actual,
			expected
		});
	};
	if (candidate.catalogEtag !== fingerprint.catalogEtag) add("catalog-metadata-invalid", "catalogEtag", candidate.catalogEtag, fingerprint.catalogEtag);
	if (fingerprint.catalogFreshness === "stale") add("version-ineligible", "catalogFreshness", "stale", "fresh-or-cached");
	if (!candidate.reviewed) add("catalog-unverified", candidate.pluginId, "false", "true");
	if (candidate.withdrawn) add("version-withdrawn", candidate.version, "true", "false");
	if (!candidate.eligible) add("version-ineligible", candidate.version, "false", "true");
	if (fingerprint.protectedPackageNames.includes(candidate.packageName)) add("protected-package", candidate.packageName);
	for (const entryId of candidate.expectedEntries) if (fingerprint.protectedEntryIds.includes(entryId)) add("protected-entry", entryId);
	for (const [subject, actual, range, code] of [
		[
			"desktopVersion",
			fingerprint.desktopVersion,
			candidate.desktopRange,
			"desktop-version-unsupported"
		],
		[
			"dshVersion",
			fingerprint.dshVersion,
			candidate.dshRange,
			"dsh-version-unsupported"
		],
		[
			"nodeVersion",
			fingerprint.nodeVersion,
			candidate.nodeRange,
			"node-version-unsupported"
		]
	]) if (semver$1.validRange(range, SEMVER_OPTIONS) === null) add("catalog-metadata-invalid", subject, range, "valid semantic-version range");
	else if (!semver$1.satisfies(actual, range, SEMVER_OPTIONS)) add(code, subject, actual, range);
	if (candidate.artifacts.find((value) => value.platform === fingerprint.platform) === void 0) add("artifact-missing", fingerprint.platform);
	if (candidate.expectedEntries.length === 0 && candidate.expectedClientModules.length === 0 && candidate.expectedSkillIds.length === 0) add("artifact-evidence-incomplete", candidate.pluginId);
	const installed = currentPlugin(fingerprint.installedPlugins, candidate.pluginId);
	if (action === "install" && installed !== void 0) add("plugin-identity-conflict", candidate.pluginId, installed.version, candidate.version);
	if (action !== "install" && installed !== void 0 && installed.packageName !== candidate.packageName) add("package-identity-conflict", candidate.packageName, installed.packageName, candidate.packageName);
	for (const plugin of fingerprint.installedPlugins) {
		if (plugin.pluginId !== candidate.pluginId && plugin.packageName === candidate.packageName) add("package-identity-conflict", candidate.packageName, plugin.pluginId, candidate.pluginId);
		if (plugin.pluginId === candidate.pluginId) continue;
		for (const entryId of candidate.expectedEntries) if (plugin.enabled && plugin.entryIds.includes(entryId)) add("entry-identity-conflict", entryId, plugin.pluginId, candidate.pluginId);
	}
	const installedPluginIds = new Set(fingerprint.installedPlugins.map((plugin) => plugin.pluginId));
	const installedPackageNames = new Set(fingerprint.installedPlugins.map((plugin) => plugin.packageName));
	const activeEntryIds = new Set(fingerprint.installedPlugins.flatMap((plugin) => plugin.enabled ? plugin.entryIds : []));
	for (const pluginId of candidate.conflicts.pluginIds) if (installedPluginIds.has(pluginId)) add("declared-conflict", pluginId);
	for (const packageName of candidate.conflicts.packageNames) if (installedPackageNames.has(packageName)) add("declared-conflict", packageName);
	for (const entryId of candidate.conflicts.entryIds) if (activeEntryIds.has(entryId)) add("declared-conflict", entryId);
	if (fingerprint.activeOperation) add("operation-busy", action);
	if (!actionSupported(action, candidate, installed)) add("action-not-supported", action, installed === void 0 ? "not-installed" : installed.enabled ? "enabled" : "disabled");
	const order = new Map(COMPATIBILITY_REASON_ORDER.map((code, index) => [code, index]));
	reasons.sort((left, right) => {
		const byCode = (order.get(left.code) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.code) ?? Number.MAX_SAFE_INTEGER);
		if (byCode !== 0) return byCode;
		return left.subject.localeCompare(right.subject);
	});
	return decodeCompatibilityDecision({
		pluginId: candidate.pluginId,
		version: candidate.version,
		action,
		allowed: reasons.length === 0,
		fingerprint,
		reasons,
		restartRequired: candidate.restartRequired,
		capabilities: candidate.capabilities,
		riskLevel: candidate.riskLevel,
		riskSummary: candidate.riskSummary,
		executionAuthority: candidate.executionAuthority
	});
}
/**
* Return only reasons that make an exact installed Bundle unsafe to activate at startup.
* @param input - Reviewed exact version and the fresh Desktop/Profile facts.
* @returns Stable incompatibility reasons, excluding action availability and catalog-cache age.
*/
function evaluateInstalledActivationCompatibility(input) {
	const installed = currentPlugin(input.fingerprint.installedPlugins, input.candidate.pluginId);
	if (installed === void 0) return [{
		code: "action-not-supported",
		subject: input.candidate.pluginId,
		actual: "not-installed",
		expected: "installed exact catalog version"
	}];
	return evaluateCompatibility({
		...input,
		action: installed.enabled ? "disable" : "enable"
	}).reasons.filter((reason) => reason.code !== "action-not-supported" && reason.code !== "operation-busy" && !(reason.code === "version-ineligible" && reason.subject === "catalogFreshness"));
}
//#endregion
//#region lib/types/plugin-center/app-update-compatibility.js
/** Pre-Host application-update compatibility reconciliation for reviewed external Bundles. */
/**
* Atomically deactivate incompatible reviewed external Bundles while retaining packages and prior disabled intent.
* @param input - Profile path, fresh release fingerprint, and verified catalog candidates.
* @returns Exact deactivations and their reproducible compatibility reasons.
*/
async function reconcileApplicationUpdateCompatibility(input) {
	let manifest = readProfileManifest("desktop", input.profileDirectory);
	const deactivated = [];
	for (const installed of input.fingerprint.installedPlugins) {
		if (!installed.enabled || installed.pluginId === null) continue;
		const candidate = input.candidates.find((value) => value.pluginId === installed.pluginId && value.packageName === installed.packageName && value.version === installed.version);
		if (candidate === void 0) continue;
		const reasons = evaluateInstalledActivationCompatibility({
			candidate,
			fingerprint: input.fingerprint
		});
		if (reasons.length === 0) continue;
		manifest = setProfileBundleEnabled(manifest, installed.packageName, false);
		deactivated.push({
			pluginId: installed.pluginId,
			packageName: installed.packageName,
			version: installed.version,
			reasons
		});
	}
	if (deactivated.length > 0) await writeFileAtomic(join(input.profileDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 384,
		dirMode: 448
	});
	return { deactivated };
}
//#endregion
//#region lib/types/plugin-center/operation-journal.js
/** Crash-durable version-2 transaction journal for Desktop Plugin Center mutations. */
const MAX_JOURNAL_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVED_JOURNALS = 20;
/** Stable renderer identity used when a journal cannot be decoded without guessing its header. */
const UNREADABLE_PLUGIN_JOURNAL_OPERATION_ID = "unreadable-journal";
/** Stable startup-facing classification for an unreadable durable record. */
var PluginOperationJournalError = class extends Error {
	reasonCode;
	name = "PluginOperationJournalError";
	constructor(reasonCode, message, options) {
		super(message, options);
		this.reasonCode = reasonCode;
	}
};
async function optionalLstat$1(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function requireDirectory$1(path) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal directory is not trusted");
}
async function syncDirectory$1(path) {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
async function durableAtomicWrite$1(path, content) {
	const parent = dirname(path);
	await requireDirectory$1(parent);
	const current = await optionalLstat$1(path);
	if (current !== null && (!current.isFile() || current.isSymbolicLink())) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal path is not a regular file");
	const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
	const handle = await open(temporary, "wx", 384);
	try {
		await handle.writeFile(content);
		await handle.sync();
	} catch (error) {
		await handle.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
	await handle.close();
	try {
		await rename(temporary, path);
		await syncDirectory$1(parent);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}
function same(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}
function prefix(previous, next) {
	return previous.length <= next.length && previous.every((entry, index) => same(entry, next[index]));
}
function assertInitialRecord(record) {
	const initial = record.phaseHistory[0];
	if (initial?.sequence !== 0 || initial.phase !== "preflight" || initial.boundary !== "observation" || initial.at !== record.header.startedAt || initial.operationFailureCode !== null || initial.recoveryReasonCode !== null || record.phaseHistory.length !== 1 || record.operation.phase !== "preflight" || record.priorFingerprint !== null || record.priorSnapshot !== null || record.commitMarker !== null || record.terminalResult !== null || record.recoveryAttempt !== 0 || record.recoveryReasonCode !== null) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal must begin with one empty preflight observation");
}
function assertMonotonic(previous, next) {
	if (!same(previous.header, next.header)) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal header is immutable");
	if (!prefix(previous.phaseHistory, next.phaseHistory)) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal phase history is append-only");
	if (previous.priorFingerprint !== null && !same(previous.priorFingerprint, next.priorFingerprint)) throw new PluginOperationJournalError("journal-invalid", "plugin operation prior fingerprint is immutable");
	if (previous.priorSnapshot !== null && !same(previous.priorSnapshot, next.priorSnapshot)) throw new PluginOperationJournalError("journal-invalid", "plugin operation prior snapshot is immutable");
	if (previous.commitMarker !== null && !same(previous.commitMarker, next.commitMarker)) throw new PluginOperationJournalError("journal-invalid", "plugin operation commit marker is immutable");
	if (previous.terminalResult !== null && !same(previous, next)) {
		if (!(previous.terminalResult === "recovery-failed" && next.terminalResult === null && next.recoveryReasonCode === null && next.operation.phase === "recovery-stopping-host" && next.recoveryAttempt === previous.recoveryAttempt + 1 && next.phaseHistory.length === previous.phaseHistory.length + 1)) throw new PluginOperationJournalError("journal-invalid", "plugin operation terminal record cannot reopen");
	}
	if (next.recoveryAttempt < previous.recoveryAttempt || next.recoveryAttempt > previous.recoveryAttempt + 1) throw new PluginOperationJournalError("journal-invalid", "plugin operation recovery attempt must advance one at a time");
}
function decodeStoredJournal(value) {
	if (typeof value === "object" && value !== null && !Array.isArray(value) && value["schemaVersion"] !== 2) throw new PluginOperationJournalError("unsupported-journal-version", "plugin operation journal version is not supported");
	try {
		return decodePluginTransactionJournalRecord(value);
	} catch (error) {
		if (error instanceof PluginOperationJournalError) throw error;
		throw new PluginOperationJournalError("journal-invalid", "plugin operation journal failed validation", { cause: error });
	}
}
async function pruneTerminalHistory(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const terminals = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
		const filename = join(directory, entry.name);
		try {
			const metadata = await lstat(filename);
			if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JOURNAL_BYTES) continue;
			const record = decodeStoredJournal(JSON.parse(await readFile(filename, "utf8")));
			if (`${record.header.operationId}.json` !== entry.name || record.terminalResult !== "committed" && record.terminalResult !== "rolled-back") continue;
			terminals.push({
				filename,
				record
			});
		} catch {}
	}
	terminals.sort((left, right) => {
		const byTime = Date.parse(right.record.operation.updatedAt) - Date.parse(left.record.operation.updatedAt);
		return byTime === 0 ? right.record.header.operationId.localeCompare(left.record.header.operationId) : byTime;
	});
	for (const terminal of terminals.slice(MAX_ARCHIVED_JOURNALS)) await unlink(terminal.filename);
	if (terminals.length > MAX_ARCHIVED_JOURNALS) await syncDirectory$1(directory);
}
/** Atomically publishes append-only operation state and refuses history rewrites. */
var PluginOperationJournal = class {
	directory;
	filename;
	constructor(directory) {
		this.directory = directory;
		this.filename = join(directory, "operation.json");
	}
	/** Read one complete verified record; absence means no operation has ever started. */
	async read() {
		const metadata = await optionalLstat$1(this.filename);
		if (metadata === null) return null;
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JOURNAL_BYTES) throw new PluginOperationJournalError("journal-invalid", "plugin operation journal is not a bounded regular file");
		let value;
		try {
			value = JSON.parse(await readFile(this.filename, "utf8"));
		} catch (error) {
			throw new PluginOperationJournalError("journal-invalid", "plugin operation journal is not valid JSON", { cause: error });
		}
		return decodeStoredJournal(value);
	}
	/** Durably publish the initial record or an append-only successor. */
	async write(value) {
		const record = decodeStoredJournal(value);
		await mkdir(this.directory, {
			recursive: true,
			mode: 448
		});
		await requireDirectory$1(this.directory);
		const previous = await this.read();
		if (previous === null) assertInitialRecord(record);
		else if (previous.header.operationId !== record.header.operationId) {
			if (previous.terminalResult !== "committed" && previous.terminalResult !== "rolled-back") throw new PluginOperationJournalError("journal-invalid", "an unsafe terminal record cannot be replaced");
			assertInitialRecord(record);
			const historyDirectory = join(this.directory, "history");
			await mkdir(historyDirectory, {
				recursive: true,
				mode: 448
			});
			await requireDirectory$1(historyDirectory);
			await durableAtomicWrite$1(join(historyDirectory, `${previous.header.operationId}.json`), `${JSON.stringify(previous, null, 2)}\n`);
			await pruneTerminalHistory(historyDirectory);
		} else assertMonotonic(previous, record);
		await durableAtomicWrite$1(this.filename, `${JSON.stringify(record, null, 2)}\n`);
	}
};
//#endregion
//#region lib/types/plugin-center/diagnostic-export.js
/** User-initiated, field-whitelisted Plugin Center recovery diagnostic export. */
/** Creates and saves bounded recovery evidence without Profile paths, content, env, or tokens. */
var PluginRecoveryDiagnosticExporter = class {
	journal;
	now;
	constructor(journal, now = () => /* @__PURE__ */ new Date()) {
		this.journal = journal;
		this.now = now;
	}
	/** Assemble the only diagnostic shape permitted to leave Desktop. */
	async create(operationId) {
		let record;
		try {
			record = await this.journal.read();
		} catch (error) {
			if (!(error instanceof PluginOperationJournalError) || operationId !== "unreadable-journal") throw error;
			return decodePluginRecoveryDiagnostic({
				schemaVersion: 1,
				journalStatus: "unreadable",
				operationId,
				profileName: null,
				action: null,
				pluginId: null,
				version: null,
				phaseHistory: [],
				terminalResult: "recovery-failed",
				recoveryAttempt: 1,
				recoveryReasonCode: error.reasonCode,
				exportedAt: this.now().toISOString()
			});
		}
		if (record === null || record.header.operationId !== operationId) throw new Error("plugin recovery diagnostic operation is unavailable");
		return decodePluginRecoveryDiagnostic({
			schemaVersion: 1,
			journalStatus: "readable",
			operationId: record.header.operationId,
			profileName: record.header.profileIdentity.profileName,
			action: record.header.action,
			pluginId: record.header.pluginId,
			version: record.header.version,
			phaseHistory: record.phaseHistory,
			terminalResult: record.terminalResult,
			recoveryAttempt: record.recoveryAttempt,
			recoveryReasonCode: record.recoveryReasonCode,
			exportedAt: this.now().toISOString()
		});
	}
	/** Ask Desktop for a destination, then return only basename/hash/size metadata. */
	async export(operationId, selectPath) {
		const diagnostic = await this.create(operationId);
		const path = await selectPath(`dsh-plugin-recovery-${operationId}.json`);
		if (path === null) return decodePluginDiagnosticExportResult({
			operationId,
			status: "cancelled",
			filename: null,
			sha256: null,
			bytes: null
		});
		const content = `${JSON.stringify(diagnostic, null, 2)}\n`;
		const bytes = Buffer.byteLength(content);
		await writeFileAtomic(path, content, {
			mode: 384,
			dirMode: 448
		});
		return decodePluginDiagnosticExportResult({
			operationId,
			status: "saved",
			filename: basename(path),
			sha256: createHash("sha256").update(content).digest("hex"),
			bytes
		});
	}
};
//#endregion
//#region lib/types/plugin-center/operation-controller.js
/** Single-operation controller backed by the version-2 recovery journal. */
/** Error carrying only a stable renderer-facing failure category. */
var PluginOperationFailure = class extends Error {
	code;
	name = "PluginOperationFailure";
	constructor(code, message, options) {
		super(message, options);
		this.code = code;
	}
};
function phaseIndex(phase) {
	return PLUGIN_MUTATION_PHASES.indexOf(phase);
}
function defaultBoundary(phase) {
	return phase === "stopping-host" || phase === "installing" || phase === "starting-host" || phase === "reloading" ? "before-side-effect" : "observation";
}
function fingerprintSha256(fingerprint) {
	return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}
/** Owns idempotency, Profile serialization, durable state, commit, and recovery handoff. */
var PluginOperationController = class {
	journal;
	run;
	readProfileIdentity;
	recover;
	now;
	createOperationId;
	injectFault;
	record = null;
	execution = null;
	startGate = Promise.resolve();
	listeners = /* @__PURE__ */ new Set();
	constructor(journal, run, readProfileIdentity, recover, now = () => /* @__PURE__ */ new Date(), createOperationId = randomUUID, injectFault = () => {}) {
		this.journal = journal;
		this.run = run;
		this.readProfileIdentity = readProfileIdentity;
		this.recover = recover;
		this.now = now;
		this.createOperationId = createOperationId;
		this.injectFault = injectFault;
	}
	/** Hydrate the last durable value before registering renderer handlers. */
	async initialize() {
		this.record = await this.journal.read();
	}
	getOperation() {
		return this.record?.operation ?? null;
	}
	get active() {
		return this.record !== null && this.record.terminalResult === null;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Start, join, or reject one exact install under a serialized ownership gate. */
	async start(value) {
		const install = decodePluginInstallRequest(value);
		return await this.startRequest({
			...install,
			action: "install"
		});
	}
	/** Start, join, or reject one installed-item action through the same owner. */
	async manage(value) {
		return await this.startRequest(decodePluginManagementRequest(value));
	}
	async startRequest(request) {
		let release;
		const previous = this.startGate;
		this.startGate = new Promise((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			const current = this.record;
			if (current?.operation.idempotencyKey === request.idempotencyKey) return decodePluginOperationStartResult({
				kind: "joined",
				operation: current.operation
			});
			if (current !== null && current.terminalResult === null) return decodePluginOperationStartResult({
				kind: "busy",
				activeOperationId: current.operation.operationId
			});
			const timestamp = this.now().toISOString();
			const profileIdentity = await this.readProfileIdentity();
			const operation = decodePluginOperationSnapshot({
				schemaVersion: 1,
				operationId: this.createOperationId(),
				idempotencyKey: request.idempotencyKey,
				profileName: "web",
				action: request.action,
				pluginId: request.pluginId,
				version: request.version,
				phase: "preflight",
				startedAt: timestamp,
				updatedAt: timestamp,
				hostGeneration: null,
				failureCode: null
			});
			const record = {
				schemaVersion: 2,
				header: {
					operationId: operation.operationId,
					idempotencyKey: operation.idempotencyKey,
					profileIdentity,
					action: operation.action,
					pluginId: operation.pluginId,
					version: operation.version,
					startedAt: operation.startedAt
				},
				operation,
				priorFingerprint: null,
				priorSnapshot: null,
				phaseHistory: [{
					sequence: 0,
					phase: "preflight",
					boundary: "observation",
					at: timestamp,
					operationFailureCode: null,
					recoveryReasonCode: null
				}],
				commitMarker: null,
				terminalResult: null,
				recoveryAttempt: 0,
				recoveryReasonCode: null
			};
			await this.journal.write(record);
			this.record = record;
			this.publish(operation);
			this.execution = this.execute(request);
			return decodePluginOperationStartResult({
				kind: "started",
				operation
			});
		} finally {
			release();
		}
	}
	/** Test and shutdown join point for the currently running mutation/recovery. */
	async whenSettled() {
		await this.execution;
	}
	async execute(request) {
		try {
			const operationId = this.requireActive().operation.operationId;
			const evidence = await this.run(request, {
				operationId,
				transition: (phase, hostGeneration, boundary) => this.transition(phase, hostGeneration, boundary),
				recordFoundation: (fingerprint, foundation) => this.recordFoundation(fingerprint, foundation),
				completeSideEffect: (phase, hostGeneration) => this.completeSideEffect(phase, hostGeneration)
			});
			await this.commit(evidence);
		} catch (error) {
			const code = error instanceof PluginOperationFailure ? error.code : "internal";
			try {
				await this.recover(code);
				this.record = await this.journal.read();
				if (this.record !== null) this.publish(this.record.operation);
			} catch (recoveryError) {
				console.error("plugin operation recovery could not be completed:", recoveryError);
				this.record = await this.journal.read().catch(() => this.record);
			}
		}
	}
	async transition(phase, hostGeneration, boundary = defaultBoundary(phase)) {
		const current = this.requireActive();
		const currentPhase = current.operation.phase;
		if (!PLUGIN_MUTATION_PHASES.includes(currentPhase) || phaseIndex(phase) <= phaseIndex(currentPhase)) throw new Error(`plugin operation phase cannot move from ${currentPhase} to ${phase}`);
		const timestamp = this.now().toISOString();
		const next = decodePluginOperationSnapshot({
			...current.operation,
			phase,
			updatedAt: timestamp,
			hostGeneration: hostGeneration === void 0 ? current.operation.hostGeneration : hostGeneration,
			failureCode: null
		});
		await this.commitRecord({
			...current,
			operation: next,
			phaseHistory: [...current.phaseHistory, {
				sequence: current.phaseHistory.length,
				phase,
				boundary,
				at: timestamp,
				operationFailureCode: null,
				recoveryReasonCode: null
			}]
		});
		await this.injectFault({
			operationId: current.header.operationId,
			action: current.header.action,
			phase,
			boundary
		});
		return next;
	}
	async completeSideEffect(phase, hostGeneration) {
		const current = this.requireActive();
		const latest = current.phaseHistory.at(-1);
		if (current.operation.phase !== phase || latest?.phase !== phase || latest.boundary !== "before-side-effect") throw new Error(`plugin operation cannot complete an unowned ${phase} side effect`);
		const timestamp = this.now().toISOString();
		const next = decodePluginOperationSnapshot({
			...current.operation,
			updatedAt: timestamp,
			hostGeneration: hostGeneration === void 0 ? current.operation.hostGeneration : hostGeneration
		});
		await this.commitRecord({
			...current,
			operation: next,
			phaseHistory: [...current.phaseHistory, {
				sequence: current.phaseHistory.length,
				phase,
				boundary: "after-side-effect",
				at: timestamp,
				operationFailureCode: null,
				recoveryReasonCode: null
			}]
		}, false);
		await this.injectFault({
			operationId: current.header.operationId,
			action: current.header.action,
			phase,
			boundary: "after-side-effect"
		});
	}
	async commit(evidence) {
		const current = this.requireActive();
		if (current.priorSnapshot === null || current.priorFingerprint === null) throw new Error("plugin operation cannot commit without prior recovery evidence");
		const timestamp = this.now().toISOString();
		const runtimeEvidence = decodePluginRuntimeEvidence(evidence.runtimeEvidence);
		const next = decodePluginOperationSnapshot({
			...current.operation,
			phase: "committed",
			updatedAt: timestamp,
			hostGeneration: evidence.hostGeneration,
			failureCode: null
		});
		await this.commitRecord({
			...current,
			operation: next,
			phaseHistory: [...current.phaseHistory, {
				sequence: current.phaseHistory.length,
				phase: "committed",
				boundary: "observation",
				at: timestamp,
				operationFailureCode: null,
				recoveryReasonCode: null
			}],
			commitMarker: {
				committedAt: timestamp,
				fingerprintSha256: fingerprintSha256(evidence.fingerprint),
				runtimeEvidence
			},
			terminalResult: "committed"
		});
	}
	async recordFoundation(priorFingerprint, foundation) {
		const current = this.requireActive();
		if (current.priorFingerprint !== null || current.priorSnapshot !== null) throw new Error("plugin operation foundation is already durable");
		if (foundation.profileIdentity.rootSha256 !== current.header.profileIdentity.rootSha256) throw new Error("plugin operation snapshot belongs to a different Profile root");
		const priorSnapshot = {
			snapshotId: foundation.snapshotId,
			snapshotSha256: foundation.snapshotSha256,
			runtimeEvidence: decodePluginRuntimeEvidence(foundation.runtimeEvidence)
		};
		await this.commitRecord({
			...current,
			priorFingerprint,
			priorSnapshot
		}, false);
	}
	requireActive() {
		if (this.record === null || this.record.terminalResult !== null) throw new Error("plugin operation is not active");
		return this.record;
	}
	async commitRecord(record, notify = true) {
		await this.journal.write(record);
		this.record = record;
		if (notify) this.publish(record.operation);
	}
	publish(operation) {
		for (const listener of this.listeners) try {
			listener(operation);
		} catch (error) {
			console.error("plugin operation listener failed:", error);
		}
	}
};
//#endregion
//#region lib/types/plugin-center/package-manager.js
/** Fixed package-manager runtime and process policy for trusted Desktop Profile changes. */
/** Fixed dependency registry; renderer values never select it. */
const PACKAGE_MANAGER_REGISTRY = "https://registry.npmjs.org/";
const DEFAULT_TIMEOUT_MS = 12e4;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5e3;
const MAX_OUTPUT_CHARS = 32768;
/** Failed or timed-out fixed package-manager invocation. */
var PackageManagerInvocationError = class extends Error {
	name = "PackageManagerInvocationError";
};
function selectedEnvironment(source, options) {
	const environment = {
		PATH: options.platform === "win32" ? win32.dirname(options.executable) : dirname(options.executable),
		HOME: options.homeDirectory,
		USERPROFILE: options.homeDirectory,
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		CI: "true",
		NO_COLOR: "1"
	};
	const allow = options.platform === "win32" ? [
		"SystemRoot",
		"WINDIR",
		"COMSPEC",
		"PATHEXT",
		"TEMP",
		"TMP"
	] : ["TMPDIR"];
	for (const name of allow) if (source[name] !== void 0) environment[name] = source[name];
	if (options.electronRunAsNode) environment.ELECTRON_RUN_AS_NODE = "1";
	return environment;
}
/** Build the exact invocation consumed by the native process adapter. */
function createPackageManagerInvocation(options, target) {
	return {
		executable: options.executable,
		args: [
			options.packageManagerEntry,
			"add",
			"--save-exact",
			"--ignore-scripts",
			"--config.shared-workspace-lockfile=false",
			"--config.manage-package-manager-versions=false",
			"--reporter=append-only",
			"--store-dir",
			options.storeDirectory,
			"--registry",
			PACKAGE_MANAGER_REGISTRY,
			"--",
			target.artifactPath
		],
		cwd: options.profileDirectory,
		env: selectedEnvironment(options.inheritedEnvironment ?? process.env, options),
		shell: false,
		windowsHide: true,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxOutputChars: MAX_OUTPUT_CHARS
	};
}
/** Build the exact dependency removal invocation for one catalog-owned package. */
function createPackageRemoveInvocation(options, target) {
	return {
		executable: options.executable,
		args: [
			options.packageManagerEntry,
			"remove",
			"--config.ignore-scripts=true",
			"--config.shared-workspace-lockfile=false",
			"--config.manage-package-manager-versions=false",
			"--reporter=append-only",
			"--store-dir",
			options.storeDirectory,
			`--config.registry=${PACKAGE_MANAGER_REGISTRY}`,
			"--",
			target.packageName
		],
		cwd: options.profileDirectory,
		env: selectedEnvironment(options.inheritedEnvironment ?? process.env, options),
		shell: false,
		windowsHide: true,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxOutputChars: MAX_OUTPUT_CHARS
	};
}
/** Build the fixed old-Profile package restoration invocation used only by F005. */
function createPackageRestoreInvocation(options, frozenLockfile) {
	return {
		executable: options.executable,
		args: [
			options.packageManagerEntry,
			"install",
			frozenLockfile ? "--frozen-lockfile" : "--no-frozen-lockfile",
			"--ignore-scripts",
			"--config.shared-workspace-lockfile=false",
			"--config.manage-package-manager-versions=false",
			"--reporter=append-only",
			"--store-dir",
			options.storeDirectory,
			"--registry",
			PACKAGE_MANAGER_REGISTRY
		],
		cwd: options.profileDirectory,
		env: selectedEnvironment(options.inheritedEnvironment ?? process.env, options),
		shell: false,
		windowsHide: true,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		maxOutputChars: MAX_OUTPUT_CHARS
	};
}
/** Native no-shell process adapter with bounded output and joined termination. */
const nativePackageManagerProcess = { run(invocation) {
	return new Promise((resolve, reject) => {
		const child = spawn(invocation.executable, [...invocation.args], {
			cwd: invocation.cwd,
			env: { ...invocation.env },
			shell: invocation.shell,
			windowsHide: invocation.windowsHide,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stdout = "";
		let stderr = "";
		let failure;
		let terminationTimer;
		const append = (current, chunk) => {
			const next = `${current}${chunk}`;
			if (next.length > invocation.maxOutputChars && failure === void 0) {
				failure = new PackageManagerInvocationError("package-manager output exceeded the diagnostic limit");
				child.kill("SIGTERM");
				terminationTimer = setTimeout(() => {
					child.kill("SIGKILL");
				}, DEFAULT_SHUTDOWN_TIMEOUT_MS);
			}
			return next.slice(-invocation.maxOutputChars);
		};
		child.stdout.on("data", (chunk) => {
			stdout = append(stdout, chunk.toString());
		});
		child.stderr.on("data", (chunk) => {
			stderr = append(stderr, chunk.toString());
		});
		child.once("error", (error) => {
			failure ??= error;
		});
		const timeout = setTimeout(() => {
			failure ??= new PackageManagerInvocationError(`package-manager timed out after ${String(invocation.timeoutMs)}ms`);
			child.kill("SIGTERM");
			terminationTimer = setTimeout(() => {
				child.kill("SIGKILL");
			}, DEFAULT_SHUTDOWN_TIMEOUT_MS);
		}, invocation.timeoutMs);
		child.once("close", (code, signal) => {
			clearTimeout(timeout);
			if (terminationTimer !== void 0) clearTimeout(terminationTimer);
			if (failure !== void 0) {
				reject(failure);
				return;
			}
			resolve({
				code,
				signal,
				stdout,
				stderr
			});
		});
	});
} };
/** Run one trusted archive install through the staged exact package manager. */
async function installTrustedPackage(options, target) {
	const invocation = createPackageManagerInvocation(options, target);
	const result = await (options.processAdapter ?? nativePackageManagerProcess).run(invocation);
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `signal ${String(result.signal)}`;
		throw new PackageManagerInvocationError(`package-manager failed for ${target.packageName}@${target.version}: ${detail}`);
	}
}
/** Remove one catalog-owned dependency through the staged exact package manager. */
async function removeTrustedPackage(options, target) {
	const invocation = createPackageRemoveInvocation(options, target);
	const result = await (options.processAdapter ?? nativePackageManagerProcess).run(invocation);
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || `signal ${String(result.signal)}`;
		throw new PackageManagerInvocationError(`package-manager removal failed for ${target.packageName}: ${detail}`);
	}
}
/** Re-materialize the restored manifest and lockfile through the bundled exact pnpm. */
async function restoreTrustedProfilePackages(options, frozenLockfile) {
	const invocation = createPackageRestoreInvocation(options, frozenLockfile);
	const result = await (options.processAdapter ?? nativePackageManagerProcess).run(invocation);
	if (result.code !== 0) throw new PackageManagerInvocationError(`package-manager Profile restore failed: ${result.stderr.trim() || result.stdout.trim() || `signal ${String(result.signal)}`}`);
}
//#endregion
//#region lib/types/plugin-center/profile-snapshot-store.js
/** Hash-bound private snapshot and safe restore of Plugin Center Profile authority files. */
const AUTHORITY_FILES = [
	"package.json",
	"pnpm-lock.yaml",
	"cordis.patch.yml",
	"node_modules/.modules.yaml"
];
const SNAPSHOT_FILENAME = "profile-snapshot.json";
const MAX_AUTHORITY_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 48 * 1024 * 1024;
const MAX_RETAINED_SNAPSHOTS = 8;
const STABLE_ID$2 = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const PACKAGE_NAME$4 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
/** Stable recovery-facing classification for an unusable private snapshot. */
var ProfileSnapshotError = class extends Error {
	name = "ProfileSnapshotError";
	reasonCode;
	constructor(reasonCode, message, options) {
		super(message, options);
		this.reasonCode = reasonCode;
	}
};
function classifySnapshotReadError(error) {
	if (error instanceof ProfileSnapshotError) return error;
	if (error.code === "ENOENT") return new ProfileSnapshotError("snapshot-missing", "profile snapshot artifact is missing", { cause: error });
	const message = error instanceof Error ? error.message : String(error);
	return new ProfileSnapshotError(/hash/iu.test(message) ? "snapshot-hash-mismatch" : /path|whitelist|regular file|real directory|symbolic/iu.test(message) ? "snapshot-path-invalid" : "snapshot-invalid", "profile snapshot artifact failed validation", { cause: error });
}
function digest(value) {
	return createHash("sha256").update(value).digest("hex");
}
function stableId(value, label) {
	if (typeof value !== "string" || !STABLE_ID$2.test(value)) throw new Error(`profile snapshot ${label} must be a stable id`);
	return value;
}
function sha256(value, label) {
	if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`profile snapshot ${label} must be a lowercase SHA-256 digest`);
	return value;
}
function canonicalInstant(value) {
	if (typeof value !== "string" || new Date(value).toISOString() !== value) throw new Error("profile snapshot createdAt must be a canonical UTC instant");
	return value;
}
function record$4(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`profile snapshot ${label} must be an object`);
	return value;
}
function exact(source, keys, label) {
	const actual = Object.keys(source).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`profile snapshot ${label} has unknown or missing fields`);
}
function decodeProfileIdentity(value) {
	const source = record$4(value, "profileIdentity");
	exact(source, ["profileName", "rootSha256"], "profileIdentity");
	if (source["profileName"] !== "web") throw new Error("profile snapshot profileName must equal web");
	return {
		profileName: "web",
		rootSha256: sha256(source["rootSha256"], "rootSha256")
	};
}
function decodeBase64(value, path) {
	if (value === null) return null;
	if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error(`profile snapshot ${path} content must be canonical base64 or null`);
	const content = Buffer.from(value, "base64");
	if (content.length > MAX_AUTHORITY_FILE_BYTES || content.toString("base64") !== value) throw new Error(`profile snapshot ${path} content exceeds its limit or is not canonical base64`);
	return content;
}
function decodeSnapshotFile(value, expectedPath) {
	const source = record$4(value, expectedPath);
	exact(source, [
		"path",
		"contentBase64",
		"sha256"
	], expectedPath);
	if (source["path"] !== expectedPath) throw new Error(`profile snapshot file path must equal whitelisted path ${expectedPath}`);
	const content = decodeBase64(source["contentBase64"], expectedPath);
	const contentSha256 = source["sha256"] === null ? null : sha256(source["sha256"], `${expectedPath} sha256`);
	if (content === null !== (contentSha256 === null)) throw new Error(`profile snapshot ${expectedPath} content and hash must be present together`);
	if (content !== null && digest(content) !== contentSha256) throw new Error(`profile snapshot ${expectedPath} content hash does not match`);
	return {
		path: expectedPath,
		contentBase64: content?.toString("base64") ?? null,
		sha256: contentSha256
	};
}
function snapshotDigest(content) {
	return digest(JSON.stringify(content));
}
/** Decode every snapshot field and recheck its semantic hash. */
function decodeProfileMutationSnapshot(value) {
	const source = record$4(value, "document");
	exact(source, [
		"schemaVersion",
		"snapshotId",
		"operationId",
		"createdAt",
		"profileIdentity",
		"packageName",
		"targetPackageExisted",
		"files",
		"snapshotSha256"
	], "document");
	if (source["schemaVersion"] !== 2) throw new Error("profile snapshot schemaVersion must equal 2");
	const snapshotId = stableId(source["snapshotId"], "snapshotId");
	const operationId = stableId(source["operationId"], "operationId");
	if (snapshotId !== operationId) throw new Error("profile snapshot must be owned by its operation id");
	if (typeof source["packageName"] !== "string" || !PACKAGE_NAME$4.test(source["packageName"])) throw new Error("profile snapshot packageName must be a lowercase npm package name");
	if (typeof source["targetPackageExisted"] !== "boolean") throw new Error("profile snapshot targetPackageExisted must be a boolean");
	const filesValue = source["files"];
	if (!Array.isArray(filesValue) || filesValue.length !== AUTHORITY_FILES.length) throw new Error("profile snapshot files must contain the complete authority whitelist");
	const content = {
		schemaVersion: 2,
		snapshotId,
		operationId,
		createdAt: canonicalInstant(source["createdAt"]),
		profileIdentity: decodeProfileIdentity(source["profileIdentity"]),
		packageName: source["packageName"],
		targetPackageExisted: source["targetPackageExisted"],
		files: AUTHORITY_FILES.map((path, index) => decodeSnapshotFile(filesValue[index], path))
	};
	const snapshotSha256 = sha256(source["snapshotSha256"], "snapshotSha256");
	if (snapshotDigest(content) !== snapshotSha256) throw new Error("profile snapshot document hash does not match");
	return {
		...content,
		snapshotSha256
	};
}
async function requireDirectory(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`profile snapshot ${label} must be a real directory`);
}
async function optionalLstat(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function authorityTarget(profileDirectory, relativePath) {
	await requireDirectory(profileDirectory, "Profile root");
	const segments = relativePath.split("/");
	let parent = profileDirectory;
	for (const segment of segments.slice(0, -1)) {
		parent = join(parent, segment);
		const metadata = await optionalLstat(parent);
		if (metadata === null) break;
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`profile snapshot authority parent is not a real directory: ${relativePath}`);
	}
	const target = join(profileDirectory, ...segments);
	const metadata = await optionalLstat(target);
	if (metadata !== null && (!metadata.isFile() || metadata.isSymbolicLink())) throw new Error(`profile snapshot authority path is not a regular file: ${relativePath}`);
	return target;
}
async function optionalAuthorityFile(profileDirectory, relativePath) {
	const target = await authorityTarget(profileDirectory, relativePath);
	const metadata = await optionalLstat(target);
	if (metadata === null) return null;
	if (metadata.size > MAX_AUTHORITY_FILE_BYTES) throw new Error(`profile snapshot authority file exceeds its limit: ${relativePath}`);
	return await readFile(target);
}
async function syncDirectory(path) {
	if (process.platform === "win32") return;
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
async function durableAtomicWrite(path, content, mode) {
	const parent = dirname(path);
	await requireDirectory(parent, "write parent");
	const current = await optionalLstat(path);
	if (current !== null && (!current.isFile() || current.isSymbolicLink())) throw new Error(`profile snapshot refuses to replace a non-regular path: ${basename(path)}`);
	const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
	const handle = await open(temporary, "wx", mode);
	try {
		await handle.writeFile(content);
		await handle.sync();
	} catch (error) {
		await handle.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
	await handle.close();
	try {
		await rename(temporary, path);
		await syncDirectory(parent);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}
async function durableRemove(path) {
	const metadata = await optionalLstat(path);
	if (metadata === null) return;
	if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`profile snapshot refuses to remove a non-regular path: ${basename(path)}`);
	await unlink(path);
	await syncDirectory(dirname(path));
}
function sameIdentity(left, right) {
	return left.rootSha256 === right.rootSha256;
}
/** Captures, validates, and restores the exact mutation-owned Profile closure. */
var ProfileSnapshotStore = class {
	profileDirectory;
	snapshotDirectory;
	now;
	constructor(profileDirectory, snapshotDirectory, now = () => /* @__PURE__ */ new Date()) {
		this.profileDirectory = profileDirectory;
		this.snapshotDirectory = snapshotDirectory;
		this.now = now;
	}
	/** Return the canonical hash-bound identity of the selected web Profile. */
	async identity() {
		await requireDirectory(this.profileDirectory, "Profile root");
		return {
			profileName: "web",
			rootSha256: digest(await realpath(this.profileDirectory))
		};
	}
	/** Capture a complete immutable snapshot before the first mutation phase. */
	async capture(operationIdValue, packageName) {
		const operationId = stableId(operationIdValue, "operationId");
		if (!PACKAGE_NAME$4.test(packageName)) throw new Error("profile snapshot packageName must be a lowercase npm package name");
		const profileIdentity = await this.identity();
		const packageSegments = packageName.split("/");
		const packageParentMetadata = await optionalLstat(join(this.profileDirectory, "node_modules", ...packageSegments.slice(0, -1)));
		if (packageParentMetadata !== null && (!packageParentMetadata.isDirectory() || packageParentMetadata.isSymbolicLink())) throw new Error("profile snapshot package parent must be a real directory");
		const targetPackageExisted = await optionalLstat(join(this.profileDirectory, "node_modules", ...packageSegments)) !== null;
		const files = [];
		for (const relativePath of AUTHORITY_FILES) {
			const content = await optionalAuthorityFile(this.profileDirectory, relativePath);
			files.push({
				path: relativePath,
				contentBase64: content?.toString("base64") ?? null,
				sha256: content === null ? null : digest(content)
			});
		}
		const content = {
			schemaVersion: 2,
			snapshotId: operationId,
			operationId,
			createdAt: this.now().toISOString(),
			profileIdentity,
			packageName,
			targetPackageExisted,
			files
		};
		const snapshot = decodeProfileMutationSnapshot({
			...content,
			snapshotSha256: snapshotDigest(content)
		});
		await mkdir(this.snapshotDirectory, {
			recursive: true,
			mode: 448
		});
		await requireDirectory(this.snapshotDirectory, "storage root");
		const operationDirectory = join(this.snapshotDirectory, operationId);
		await mkdir(operationDirectory, { mode: 448 });
		await requireDirectory(operationDirectory, "operation directory");
		await durableAtomicWrite(join(operationDirectory, SNAPSHOT_FILENAME), `${JSON.stringify(snapshot, null, 2)}\n`, 384);
		await this.pruneClosedSnapshots(operationId);
		return snapshot;
	}
	/** Read and fully validate one bounded snapshot artifact. */
	async read(snapshotIdValue) {
		try {
			const snapshotId = stableId(snapshotIdValue, "snapshotId");
			await requireDirectory(this.snapshotDirectory, "storage root");
			const operationDirectory = join(this.snapshotDirectory, snapshotId);
			await requireDirectory(operationDirectory, "operation directory");
			const filename = join(operationDirectory, SNAPSHOT_FILENAME);
			const metadata = await lstat(filename);
			if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SNAPSHOT_BYTES) throw new Error("profile snapshot artifact must be a bounded regular file");
			return decodeProfileMutationSnapshot(JSON.parse(await readFile(filename, "utf8")));
		} catch (error) {
			throw classifySnapshotReadError(error);
		}
	}
	/** Idempotently restore the whitelist after matching every journal-owned identity. */
	async restore(expectation) {
		const snapshot = await this.read(expectation.snapshotId);
		const currentIdentity = await this.identity();
		if (snapshot.operationId !== expectation.operationId) throw new ProfileSnapshotError("snapshot-invalid", "profile snapshot operation identity does not match");
		if (snapshot.snapshotSha256 !== expectation.snapshotSha256) throw new ProfileSnapshotError("snapshot-hash-mismatch", "profile snapshot hash does not match the journal");
		if (!sameIdentity(snapshot.profileIdentity, expectation.profileIdentity) || !sameIdentity(snapshot.profileIdentity, currentIdentity)) throw new ProfileSnapshotError("snapshot-root-mismatch", "profile snapshot identity does not match the journal or current Profile root");
		try {
			for (const file of snapshot.files) await authorityTarget(this.profileDirectory, file.path);
		} catch (error) {
			throw new ProfileSnapshotError("snapshot-path-invalid", "profile snapshot restore path is unsafe", { cause: error });
		}
		for (const file of snapshot.files) {
			const target = join(this.profileDirectory, ...file.path.split("/"));
			if (file.contentBase64 === null) {
				await durableRemove(target);
				continue;
			}
			const parent = dirname(target);
			if (await optionalLstat(parent) === null) await mkdir(parent, {
				recursive: false,
				mode: 448
			});
			await durableAtomicWrite(target, Buffer.from(file.contentBase64, "base64"), 384);
		}
		for (const file of snapshot.files) {
			const restored = await optionalAuthorityFile(this.profileDirectory, file.path);
			if (restored === null !== (file.sha256 === null) || restored !== null && digest(restored) !== file.sha256) throw new Error(`profile snapshot restore verification failed: ${file.path}`);
		}
		return snapshot;
	}
	/** Verify whether the old exact package link/directory presence was re-materialized. */
	async verifyTargetPackagePresence(snapshot) {
		const packageSegments = snapshot.packageName.split("/");
		const parentMetadata = await optionalLstat(join(this.profileDirectory, "node_modules", ...packageSegments.slice(0, -1)));
		if (parentMetadata !== null && (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink())) throw new Error("profile snapshot restored package parent is not a real directory");
		if (await optionalLstat(join(this.profileDirectory, "node_modules", ...packageSegments)) !== null !== snapshot.targetPackageExisted) throw new Error("profile snapshot restored package presence differs from the prior state");
	}
	/** Keep the current snapshot plus a bounded set of older, fully valid snapshot artifacts. */
	async pruneClosedSnapshots(currentSnapshotId) {
		const entries = await readdir(this.snapshotDirectory, { withFileTypes: true });
		const retainedCandidates = [];
		for (const entry of entries) {
			if (entry.name === currentSnapshotId || !entry.isDirectory() || !STABLE_ID$2.test(entry.name)) continue;
			try {
				retainedCandidates.push(await this.read(entry.name));
			} catch {}
		}
		retainedCandidates.sort((left, right) => {
			const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
			return byTime === 0 ? right.snapshotId.localeCompare(left.snapshotId) : byTime;
		});
		for (const snapshot of retainedCandidates.slice(MAX_RETAINED_SNAPSHOTS - 1)) await this.removeClosedSnapshot(snapshot.snapshotId);
	}
	async removeClosedSnapshot(snapshotId) {
		const operationDirectory = join(this.snapshotDirectory, snapshotId);
		const directoryMetadata = await lstat(operationDirectory);
		if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) return;
		const entries = await readdir(operationDirectory);
		if (entries.length !== 1 || entries[0] !== SNAPSHOT_FILENAME) return;
		const filename = join(operationDirectory, SNAPSHOT_FILENAME);
		const fileMetadata = await lstat(filename);
		if (!fileMetadata.isFile() || fileMetadata.isSymbolicLink()) return;
		await unlink(filename);
		await rmdir(operationDirectory);
		await syncDirectory(this.snapshotDirectory);
	}
};
//#endregion
//#region lib/types/plugin-center/profile-lock.js
/** Cross-process ownership lock for one Desktop Profile mutation. */
/** Raised when another process already owns the selected Profile. */
var ProfileMutationBusyError = class extends Error {
	name = "ProfileMutationBusyError";
};
/** Lock owner; only recovery may reclaim a dead owner for the exact durable operation. */
var ProfileMutationLock = class {
	path;
	recoveryPath;
	constructor(profileDirectory) {
		this.path = join(profileDirectory, ".plugin-center-mutation.lock");
		this.recoveryPath = join(profileDirectory, ".plugin-center-mutation.recovery.lock");
	}
	async acquire(operationId) {
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: 448
		});
		let handle;
		try {
			handle = await open(this.path, "wx", 384);
		} catch (error) {
			if (error.code === "EEXIST") throw new ProfileMutationBusyError("the web Profile already has an active mutation owner");
			throw error;
		}
		const nonce = randomBytes(16).toString("hex");
		const content = lockContent(operationId, nonce);
		try {
			await handle.writeFile(content, "utf8");
		} catch (error) {
			await handle.close().catch(() => void 0);
			await rm(this.path, { force: true }).catch(() => void 0);
			throw error;
		}
		return acquiredLock(this.path, nonce, handle);
	}
	/** Reclaim a dead same-operation owner without ever accepting a different operation's lock. */
	async acquireRecovery(operationId) {
		await mkdir(dirname(this.path), {
			recursive: true,
			mode: 448
		});
		let observed;
		try {
			observed = await readFile(this.path, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return await this.acquire(operationId);
			throw error;
		}
		const metadata = await lstat(this.path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ProfileMutationBusyError("the web Profile recovery lock is not a regular owned file");
		const owner = decodeLock(observed);
		if (owner.operationId !== operationId || processIsAlive(owner.pid)) throw new ProfileMutationBusyError("the web Profile already has a live or different mutation owner");
		const gate = await acquireRecoveryGate(this.recoveryPath, operationId);
		const gateNonce = randomBytes(16).toString("hex");
		try {
			await gate.writeFile(lockContent(operationId, gateNonce), "utf8");
			const current = decodeLock(await readFile(this.path, "utf8"));
			if (current.nonce !== owner.nonce || current.operationId !== operationId || processIsAlive(current.pid)) throw new ProfileMutationBusyError("the web Profile mutation owner changed during recovery claim");
			const nonce = randomBytes(16).toString("hex");
			await writeFileAtomic(this.path, lockContent(operationId, nonce), {
				mode: 384,
				dirMode: 448
			});
			const primary = acquiredLock(this.path, nonce);
			const recoveryGate = acquiredLock(this.recoveryPath, gateNonce, gate);
			try {
				await recoveryGate.release();
			} catch (error) {
				await primary.release().catch(() => void 0);
				throw error;
			}
			return primary;
		} catch (error) {
			await gate.close().catch(() => {});
			await removeOwned(this.recoveryPath, gateNonce).catch(() => {});
			throw error;
		}
	}
};
async function acquireRecoveryGate(path, operationId) {
	for (let attempt = 0; attempt < 2; attempt += 1) try {
		return await open(path, "wx", 384);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		if (attempt > 0) throw new ProfileMutationBusyError("the web Profile already has a recovery owner");
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ProfileMutationBusyError("the web Profile recovery owner is not a regular file");
		const owner = decodeLock(await readFile(path, "utf8"));
		if (owner.operationId !== operationId || processIsAlive(owner.pid)) throw new ProfileMutationBusyError("the web Profile already has a live or different recovery owner");
		await removeOwned(path, owner.nonce);
	}
	throw new ProfileMutationBusyError("the web Profile recovery owner could not be acquired");
}
function lockContent(operationId, nonce) {
	return `${JSON.stringify({
		schemaVersion: 1,
		operationId,
		pid: process.pid,
		nonce
	})}\n`;
}
function decodeLock(value) {
	let source;
	try {
		source = JSON.parse(value);
	} catch {
		throw new ProfileMutationBusyError("the web Profile mutation lock is invalid");
	}
	if (typeof source !== "object" || source === null || Array.isArray(source)) throw new ProfileMutationBusyError("the web Profile mutation lock is invalid");
	const record = source;
	if (Object.keys(record).sort().join(",") !== "nonce,operationId,pid,schemaVersion" || record["schemaVersion"] !== 1 || typeof record["operationId"] !== "string" || typeof record["nonce"] !== "string" || !Number.isInteger(record["pid"]) || record["pid"] <= 0) throw new ProfileMutationBusyError("the web Profile mutation lock is invalid");
	return {
		schemaVersion: 1,
		operationId: record["operationId"],
		pid: record["pid"],
		nonce: record["nonce"]
	};
}
function processIsAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}
async function removeOwned(path, nonce) {
	let observed;
	try {
		observed = await readFile(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	try {
		if (decodeLock(observed).nonce === nonce) await rm(path);
	} catch (error) {
		if (!(error instanceof ProfileMutationBusyError)) throw error;
	}
}
function acquiredLock(path, nonce, handle) {
	let released = false;
	let handleClosed = handle === void 0;
	let execution = null;
	return {
		path,
		release: async () => {
			if (released) return;
			if (execution !== null) {
				await execution;
				return;
			}
			execution = (async () => {
				if (!handleClosed) {
					await handle?.close();
					handleClosed = true;
				}
				await removeOwned(path, nonce);
				released = true;
			})();
			try {
				await execution;
			} finally {
				execution = null;
			}
		}
	};
}
//#endregion
//#region lib/types/plugin-center/recovery-controller.js
/** Idempotent recovery owner for one uncommitted Plugin Center transaction. */
/** A committed marker or verified rollback is the only state that permits normal startup. */
function blocksNormalPluginStartup(record) {
	return record !== null && record.terminalResult !== "committed" && record.terminalResult !== "rolled-back";
}
/** Only an unclosed record is automatically replayed; recovery-failed waits for explicit retry. */
function needsAutomaticPluginRecovery(record) {
	return record !== null && record.terminalResult === null;
}
var RecoveryStepError = class extends Error {
	name = "RecoveryStepError";
	reasonCode;
	constructor(reasonCode, options) {
		super(`plugin recovery step failed: ${reasonCode}`, options);
		this.reasonCode = reasonCode;
	}
};
function failureCode(record, supplied) {
	return record.operation.failureCode ?? supplied ?? "internal";
}
function recoveryPhase(phase) {
	return phase.startsWith("recovery-") && phase !== "recovery-failed" ? phase : null;
}
function projectRecovery(record) {
	const code = record.operation.failureCode;
	if (code === null) return null;
	const phase = recoveryPhase(record.operation.phase);
	if (phase !== null) return decodePluginRecoverySnapshot({
		schemaVersion: 1,
		operationId: record.header.operationId,
		phase: "recovering",
		recoveryPhase: phase,
		operationFailureCode: code,
		recoveryReasonCode: null,
		attempt: record.recoveryAttempt,
		updatedAt: record.operation.updatedAt,
		canRetry: false,
		canExportDiagnostics: true
	});
	if (record.terminalResult !== "rolled-back" && record.terminalResult !== "recovery-failed") return null;
	return decodePluginRecoverySnapshot({
		schemaVersion: 1,
		operationId: record.header.operationId,
		phase: record.terminalResult,
		recoveryPhase: null,
		operationFailureCode: code,
		recoveryReasonCode: record.recoveryReasonCode,
		attempt: record.recoveryAttempt,
		updatedAt: record.operation.updatedAt,
		canRetry: record.terminalResult === "recovery-failed",
		canExportDiagnostics: true
	});
}
/** Restores prior Profile/package/runtime evidence before releasing startup ownership. */
var PluginRecoveryController = class {
	options;
	execution = null;
	listeners = /* @__PURE__ */ new Set();
	now;
	constructor(options) {
		this.options = options;
		this.now = options.now ?? (() => /* @__PURE__ */ new Date());
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	async getSnapshot() {
		try {
			const record = await this.options.journal.read();
			return record === null ? null : projectRecovery(record);
		} catch (error) {
			if (error instanceof PluginOperationJournalError) return this.projectJournalFailure(error);
			throw error;
		}
	}
	/** Replay one open record; a durable recovery-failed result is not retried silently. */
	async recoverOpen(failure) {
		return await this.run(false, void 0, failure);
	}
	/** Explicitly retry the same operation identity after a recovery failure. */
	async retry(operationId) {
		if (operationId === "unreadable-journal") return await this.run(false);
		return await this.run(true, operationId);
	}
	async run(retry, expectedOperationId, suppliedFailure) {
		if (this.execution !== null) return await this.execution;
		const execution = this.execute(retry, expectedOperationId, suppliedFailure).catch((error) => {
			if (error instanceof PluginOperationJournalError) return this.publishJournalFailure(error);
			throw error;
		});
		this.execution = execution;
		try {
			return await execution;
		} finally {
			if (this.execution === execution) this.execution = null;
		}
	}
	async execute(retry, expectedOperationId, suppliedFailure) {
		let record = await this.options.journal.read();
		if (record === null) return null;
		if (expectedOperationId !== void 0 && record.header.operationId !== expectedOperationId) throw new Error("plugin recovery retry does not own the requested operation");
		if (record.terminalResult === "committed" || record.terminalResult === "rolled-back") return projectRecovery(record);
		if (record.terminalResult === "recovery-failed" && !retry) return projectRecovery(record);
		if (retry && record.terminalResult !== "recovery-failed") return projectRecovery(record);
		const operationFailureCode = failureCode(record, suppliedFailure);
		const attempt = retry ? record.recoveryAttempt + 1 : Math.max(record.recoveryAttempt, 1);
		if (record.priorSnapshot === null) {
			record = await this.append(record, "rolled-back", "observation", operationFailureCode, attempt);
			return this.publish(record);
		}
		const priorSnapshot = record.priorSnapshot;
		let activeRecord = record;
		let recoveryLock;
		try {
			try {
				recoveryLock = await this.options.profileLock.acquireRecovery(activeRecord.header.operationId);
			} catch (error) {
				if (error instanceof ProfileMutationBusyError) throw new RecoveryStepError("profile-lock-busy", { cause: error });
				throw error;
			}
			activeRecord = await this.append(activeRecord, "recovery-stopping-host", "before-side-effect", operationFailureCode, attempt);
			const restartProgress = {
				entered: false,
				completed: false
			};
			let generation;
			try {
				generation = await this.options.host.restart(`recover plugin operation ${activeRecord.header.operationId}`, async () => {
					restartProgress.entered = true;
					activeRecord = await this.append(activeRecord, "recovery-restoring-profile", "before-side-effect", operationFailureCode, attempt);
					try {
						const restoredSnapshot = await this.options.snapshotStore.restore({
							snapshotId: priorSnapshot.snapshotId,
							snapshotSha256: priorSnapshot.snapshotSha256,
							operationId: activeRecord.header.operationId,
							profileIdentity: activeRecord.header.profileIdentity
						});
						activeRecord = await this.append(activeRecord, "recovery-restoring-profile", "after-side-effect", operationFailureCode, attempt);
						activeRecord = await this.append(activeRecord, "recovery-restoring-packages", "before-side-effect", operationFailureCode, attempt);
						const frozen = restoredSnapshot.files.some((file) => file.path === "pnpm-lock.yaml" && file.sha256 !== null);
						await restoreTrustedProfilePackages(this.options.packageManager, frozen);
						await this.options.snapshotStore.verifyTargetPackagePresence(restoredSnapshot);
					} catch (error) {
						if (error instanceof ProfileSnapshotError) throw new RecoveryStepError(error.reasonCode, { cause: error });
						if (activeRecord.operation.phase === "recovery-restoring-profile") throw new RecoveryStepError("profile-restore-failed", { cause: error });
						throw new RecoveryStepError("package-restore-failed", { cause: error });
					}
					activeRecord = await this.append(activeRecord, "recovery-restoring-packages", "after-side-effect", operationFailureCode, attempt);
					activeRecord = await this.append(activeRecord, "recovery-starting-host", "before-side-effect", operationFailureCode, attempt);
					restartProgress.completed = true;
				});
			} catch (error) {
				if (error instanceof RecoveryStepError) throw error;
				throw new RecoveryStepError(restartProgress.entered && restartProgress.completed ? "host-start-failed" : "host-stop-failed", { cause: error });
			}
			activeRecord = await this.append(activeRecord, "recovery-verifying-runtime", "observation", operationFailureCode, attempt, generation.id);
			try {
				await this.options.runtimeVerifier.verifyHealth(generation.origin);
				await this.options.runtimeVerifier.verifyEvidence(generation.origin, priorSnapshot.runtimeEvidence);
			} catch (error) {
				throw new RecoveryStepError("runtime-verification-failed", { cause: error });
			}
			try {
				await this.options.reloadHost?.(generation.origin);
			} catch (error) {
				throw new RecoveryStepError("host-start-failed", { cause: error });
			}
			await recoveryLock.release();
			recoveryLock = void 0;
			activeRecord = await this.append(activeRecord, "rolled-back", "observation", operationFailureCode, attempt, generation.id);
		} catch (error) {
			let reason = error instanceof RecoveryStepError ? error.reasonCode : "journal-invalid";
			if (recoveryLock !== void 0) try {
				await recoveryLock.release();
				recoveryLock = void 0;
			} catch {
				reason = "profile-lock-busy";
			}
			activeRecord = await this.append(activeRecord, "recovery-failed", "observation", operationFailureCode, attempt, activeRecord.operation.hostGeneration, reason);
		}
		return this.publish(activeRecord);
	}
	async append(record, phase, boundary, operationFailureCode, recoveryAttempt, hostGeneration = record.operation.hostGeneration, recoveryReasonCode = null) {
		const at = this.now().toISOString();
		const terminalResult = phase === "rolled-back" ? "rolled-back" : phase === "recovery-failed" ? "recovery-failed" : null;
		const next = {
			...record,
			operation: {
				...record.operation,
				phase,
				updatedAt: at,
				hostGeneration,
				failureCode: operationFailureCode
			},
			phaseHistory: [...record.phaseHistory, {
				sequence: record.phaseHistory.length,
				phase,
				boundary,
				at,
				operationFailureCode,
				recoveryReasonCode
			}],
			commitMarker: null,
			terminalResult,
			recoveryAttempt,
			recoveryReasonCode
		};
		await this.options.journal.write(next);
		const snapshot = projectRecovery(next);
		if (snapshot !== null) this.publishSnapshot(snapshot);
		return next;
	}
	publish(record) {
		const snapshot = projectRecovery(record);
		if (snapshot !== null) this.publishSnapshot(snapshot);
		return snapshot;
	}
	publishSnapshot(snapshot) {
		for (const listener of this.listeners) try {
			listener(snapshot);
		} catch (error) {
			console.error("plugin recovery listener failed:", error);
		}
	}
	projectJournalFailure(error) {
		return decodePluginRecoverySnapshot({
			schemaVersion: 1,
			operationId: UNREADABLE_PLUGIN_JOURNAL_OPERATION_ID,
			phase: "recovery-failed",
			recoveryPhase: null,
			operationFailureCode: "internal",
			recoveryReasonCode: error.reasonCode,
			attempt: 1,
			updatedAt: this.now().toISOString(),
			canRetry: true,
			canExportDiagnostics: true
		});
	}
	publishJournalFailure(error) {
		const snapshot = this.projectJournalFailure(error);
		this.publishSnapshot(snapshot);
		return snapshot;
	}
};
//#endregion
//#region lib/types/plugin-center/preflight-service.js
/** Desktop-owned compatibility lookup that resolves renderer intent back to trusted catalog and Profile facts. */
/** Resolve one exact renderer action without accepting or changing package authority. */
var PluginCompatibilityService = class {
	catalog;
	readFingerprint;
	/**
	* @param catalog - Trusted exact-version metadata owner.
	* @param readFingerprint - Fresh local fact reader invoked for every request.
	*/
	constructor(catalog, readFingerprint) {
		this.catalog = catalog;
		this.readFingerprint = readFingerprint;
	}
	/**
	* Recompute one exact-action decision from current trusted inputs.
	* @param value - Untrusted renderer value containing only plugin id, exact version, and closed action.
	* @returns A deterministic allow or deny decision; no decision changes local state.
	*/
	async check(value) {
		return (await this.resolve(value)).decision;
	}
	/** Resolve the exact catalog candidate and local fingerprint without projecting away authority. */
	async resolve(value) {
		const request = decodeCompatibilityRequest(value);
		const selection = await this.catalog.resolvePreflight(request);
		const fingerprint = await this.readFingerprint(selection);
		if (selection.candidate !== null) return {
			request,
			candidate: selection.candidate,
			selection,
			fingerprint,
			decision: evaluateCompatibility({
				candidate: selection.candidate,
				fingerprint,
				action: request.action
			})
		};
		return {
			request,
			candidate: null,
			selection,
			fingerprint,
			decision: decodeCompatibilityDecision({
				pluginId: request.pluginId,
				version: request.version,
				action: request.action,
				allowed: false,
				fingerprint,
				reasons: [{
					code: "catalog-metadata-invalid",
					subject: `${request.pluginId}@${request.version}`,
					actual: "missing",
					expected: "validated exact catalog version"
				}],
				restartRequired: false,
				capabilities: [],
				riskLevel: "high",
				riskSummary: "Reviewed risk metadata is unavailable for this exact version.",
				executionAuthority: "broad-application-authority"
			})
		};
	}
};
//#endregion
//#region lib/types/plugin-center/profile-compatibility.js
/** Read the selected Profile facts needed by the compatibility evaluator without changing local state. */
const PACKAGE_NAME$3 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXACT_VERSION$2 = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const ENTRY_ID$1 = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
function record$3(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must hold an object`);
	return value;
}
function optionalRecord$1(value, label) {
	return value === void 0 ? void 0 : record$3(value, label);
}
function packageNames(value, label) {
	const source = record$3(value ?? {}, label);
	const names = Object.keys(source);
	if (names.some((name) => !PACKAGE_NAME$3.test(name))) throw new Error(`${label} contains an invalid package name`);
	return names;
}
function bundles(value, label) {
	if (value === void 0) return [];
	if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !PACKAGE_NAME$3.test(name))) throw new Error(`${label} must contain package names`);
	if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
	return value;
}
function packageManifestPath(profileDirectory, packageName) {
	return join(profileDirectory, "node_modules", ...packageName.startsWith("@") ? packageName.split("/") : [packageName], "package.json");
}
function bundleEntryIds(patch, label) {
	const ids = /* @__PURE__ */ new Set();
	for (const [index, line] of patch.split(/\r?\n/u).entries()) {
		const matched = line.match(/^\s*-\s+id:\s+(.+?)\s*$/u)?.[1];
		if (matched === void 0) continue;
		const value = matched.startsWith("'") && matched.endsWith("'") || matched.startsWith("\"") && matched.endsWith("\"") ? matched.slice(1, -1) : matched;
		if (!ENTRY_ID$1.test(value)) throw new Error(`${label}:${String(index + 1)} has an invalid Loader row id`);
		ids.add(value);
	}
	return [...ids].sort();
}
function addFile(hash, label, path, required) {
	if (!existsSync(path)) {
		if (required) throw new Error(`selected Profile is missing ${path}`);
		hash.update(`${label}\0<absent>\0`);
		return;
	}
	const bytes = readFileSync(path);
	hash.update(`${label}\0`);
	hash.update(bytes);
	hash.update("\0");
	return bytes;
}
function installedIdentity(profileDirectory, packageName, enabled, candidates, hash) {
	const manifestPath = packageManifestPath(profileDirectory, packageName);
	const bytes = addFile(hash, `package:${packageName}`, manifestPath, true);
	const manifest = record$3(JSON.parse(bytes.toString("utf8")), manifestPath);
	const version = manifest["version"];
	if (manifest["name"] !== packageName || typeof version !== "string" || !EXACT_VERSION$2.test(version)) throw new Error(`${manifestPath} does not declare its exact installed identity`);
	const patch = optionalRecord$1(optionalRecord$1(manifest["dsh"], `${manifestPath} dsh`)?.["bundle"], `${manifestPath} dsh.bundle`)?.["patch"];
	if (patch === void 0) return void 0;
	if (typeof patch !== "string" || patch === "") throw new Error(`${manifestPath} has an invalid dsh.bundle.patch`);
	const root = dirname(manifestPath);
	const patchPath = resolve(root, patch);
	const fromRoot = relative(root, patchPath);
	if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) throw new Error(`${manifestPath} declares a Bundle patch outside its package`);
	const patchBytes = addFile(hash, `patch:${packageName}`, patchPath, true);
	const matches = candidates.filter((candidate) => candidate.packageName === packageName && candidate.version === version);
	if (matches.length > 1) throw new Error(`${packageName}@${version} matches multiple catalog plugins`);
	return {
		pluginId: matches[0]?.pluginId ?? null,
		version,
		packageName,
		enabled,
		entryIds: bundleEntryIds(patchBytes.toString("utf8"), patchPath)
	};
}
/**
* Rebuild one compatibility fingerprint from the current Profile files and installed Bundle manifests.
* @param input - Release, catalog, selected-Profile, and operation facts owned by Desktop.
* @returns A validated fingerprint whose revision changes with every consumed local authority file.
*/
function readProfileCompatibilityFingerprint(input) {
	const profileDirectory = join(input.homeDirectory, "profiles", input.profileName);
	const hash = createHash("sha256");
	const manifestPath = join(profileDirectory, "package.json");
	const manifestBytes = addFile(hash, "profile-manifest", manifestPath, true);
	addFile(hash, "profile-patch", join(profileDirectory, "cordis.patch.yml"), false);
	addFile(hash, "profile-lock", join(profileDirectory, "pnpm-lock.yaml"), false);
	const manifest = record$3(JSON.parse(manifestBytes.toString("utf8")), manifestPath);
	const profile = optionalRecord$1(optionalRecord$1(manifest["dsh"], `${manifestPath} dsh`)?.["profile"], `${manifestPath} dsh.profile`);
	const dependencyNames = packageNames(manifest["dependencies"], `${manifestPath} dependencies`);
	const bundleNames = bundles(profile?.["bundles"], `${manifestPath} dsh.profile.bundles`);
	const disabledBundleNames = bundles(profile?.["disabledBundles"], `${manifestPath} dsh.profile.disabledBundles`);
	const disabled = new Set(disabledBundleNames);
	const overlap = bundleNames.find((packageName) => disabled.has(packageName));
	if (overlap !== void 0) throw new Error(`${manifestPath} lists ${overlap} as both active and disabled`);
	const protectedNames = new Set(input.systemComponents.packageNames);
	const externalNames = [...new Set([
		...dependencyNames,
		...bundleNames,
		...disabledBundleNames
	])].filter((packageName) => !protectedNames.has(packageName)).sort();
	const enabled = new Set(bundleNames);
	const installedPlugins = externalNames.flatMap((packageName) => {
		const identity = installedIdentity(profileDirectory, packageName, enabled.has(packageName), input.candidates, hash);
		return identity === void 0 ? [] : [identity];
	});
	const profileRevision = hash.digest().readUInt32BE(0) & 2147483647;
	return resolveCompatibilityFingerprint({
		desktopVersion: input.desktopVersion,
		dshVersion: input.dshVersion,
		nodeVersion: input.nodeVersion,
		os: input.os,
		architecture: input.architecture,
		catalogEtag: input.catalogEtag,
		catalogFreshness: input.catalogFreshness,
		profileRevision,
		installedPlugins,
		systemComponents: input.systemComponents,
		activeOperation: input.activeOperation
	});
}
//#endregion
//#region lib/types/plugin-center/installed-projection.js
/** Authority-derived installed Plugin Center projection; no duplicate persistence. */
const semver = createRequire(import.meta.url)("semver");
const TERMINAL_PHASES = new Set([
	"committed",
	"failed",
	"rolled-back",
	"recovery-failed"
]);
const EXACT_VERSION$1 = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const PACKAGE_NAME$2 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const STABLE_ID$1 = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
function record$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function strings(value, accept) {
	return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...new Set(value.filter((item) => accept(item)))] : [];
}
function ownedData(value) {
	if (!Array.isArray(value)) return [];
	const result = [];
	const paths = /* @__PURE__ */ new Set();
	for (const item of value) {
		const source = record$2(item);
		const path = source?.["path"];
		const label = source?.["label"];
		if (typeof path !== "string" || path.length > 256 || typeof label !== "string" || label.length > 120 || label.trim() !== label || label === "" || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/u.test(path) || path.includes("\\") || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..") || paths.has(path)) continue;
		paths.add(path);
		result.push({
			path,
			label
		});
	}
	return result;
}
function patchEntryIds(patch) {
	const values = /* @__PURE__ */ new Set();
	for (const line of patch.split(/\r?\n/u)) {
		const matched = line.match(/^\s*-\s+id:\s+(.+?)\s*$/u)?.[1];
		if (matched === void 0) continue;
		const value = matched.startsWith("'") && matched.endsWith("'") || matched.startsWith("\"") && matched.endsWith("\"") ? matched.slice(1, -1) : matched;
		if (/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value)) values.add(value);
	}
	return [...values].sort();
}
function observePackage(profileDirectory, installAnchor, packageName) {
	try {
		const directory = resolveBundleDir("desktop", packageName, installAnchor, profileDirectory);
		const manifestPath = join(directory, "package.json");
		const manifest = record$2(JSON.parse(readFileSync(manifestPath, "utf8")));
		const version = manifest?.["name"] === packageName && typeof manifest["version"] === "string" && EXACT_VERSION$1.test(manifest["version"]) && semver.valid(manifest["version"]) !== null ? manifest["version"] : null;
		const dsh = record$2(manifest?.["dsh"]);
		const patch = record$2(dsh?.["bundle"])?.["patch"];
		if (typeof patch !== "string" || patch === "") return {
			version,
			entryIds: [],
			expectedClientModules: [],
			expectedSkillIds: [],
			ownedData: [],
			bundle: false,
			failed: false
		};
		const patchPath = resolve(directory, patch);
		const fromRoot = relative(directory, patchPath);
		if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\") || !existsSync(patchPath)) throw new Error("Bundle patch is outside or missing");
		const pluginCenter = record$2(dsh?.["pluginCenter"]);
		return {
			version,
			entryIds: patchEntryIds(readFileSync(patchPath, "utf8")),
			expectedClientModules: strings(pluginCenter?.["expectedClientModules"], (item) => PACKAGE_NAME$2.test(item)),
			expectedSkillIds: strings(pluginCenter?.["expectedSkillIds"], (item) => STABLE_ID$1.test(item)),
			ownedData: ownedData(pluginCenter?.["ownedData"]),
			bundle: true,
			failed: version === null
		};
	} catch {
		return {
			version: null,
			entryIds: [],
			expectedClientModules: [],
			expectedSkillIds: [],
			ownedData: [],
			bundle: false,
			failed: true
		};
	}
}
/**
* Read declarations only when the installed package still has the reviewed exact identity.
* @param input - Profile/package identity that must exist before uninstall.
* @returns Exact-version declarations safe to bind to the uninstall operation.
*/
function readInstalledOwnedDataAuthority(input) {
	const observation = observePackage(input.profileDirectory, input.installAnchor, input.packageName);
	if (observation.version !== input.version || !observation.bundle || observation.failed) throw new Error("installed package cannot supply exact owned-data authority");
	return {
		version: observation.version,
		declarations: observation.ownedData
	};
}
function exactCatalog(packageName, version, catalog) {
	if (version === null) return null;
	const candidate = catalog.preflights.find((item) => item.packageName === packageName && item.version === version && item.reviewed);
	if (candidate === void 0) return null;
	const summary = catalog.entries.find((item) => item.pluginId === candidate.pluginId && item.version === candidate.version && item.scope === "public" && item.verified);
	const detail = catalog.details.find((item) => item.summary.pluginId === candidate.pluginId && item.summary.version === candidate.version);
	return summary === void 0 || detail === void 0 ? null : {
		candidate,
		summary,
		detail
	};
}
function availableUpdate(current, catalog, fingerprint) {
	const target = catalog.preflights.filter((item) => item.pluginId === current.pluginId && item.packageName === current.packageName && item.reviewed && item.eligible && !item.withdrawn && semver.gt(item.version, current.version)).filter((item) => evaluateCompatibility({
		candidate: item,
		fingerprint,
		action: "update"
	}).allowed).sort((left, right) => semver.rcompare(left.version, right.version))[0];
	if (target === void 0) return null;
	const detail = catalog.details.find((item) => item.summary.pluginId === target.pluginId && item.summary.version === target.version);
	return detail === void 0 ? null : {
		version: target.version,
		changelog: detail.changelog,
		riskLevel: target.riskLevel,
		riskSummary: target.riskSummary
	};
}
function pluginRuntime(evidence, expectedEntries, expectedClientModules, expectedSkillIds) {
	if (evidence === null) return {
		entries: [],
		clientModules: [],
		skillIds: []
	};
	return {
		entries: evidence.entries.filter((entry) => expectedEntries.some((expected) => entry.entryId === expected || entry.entryId === `include:${expected}`)),
		clientModules: evidence.clientModules.filter((module) => expectedClientModules.includes(module)),
		skillIds: evidence.skillIds.filter((skillId) => expectedSkillIds.includes(skillId))
	};
}
function runtimeStatus(enabled, failed, requireActiveEntries, evidence, runtime, expectedEntries, expectedClientModules, expectedSkillIds) {
	if (failed) return "failed";
	if (evidence === null) return "unknown";
	const anyObserved = runtime.entries.length + runtime.clientModules.length + runtime.skillIds.length > 0;
	if (!enabled) return anyObserved ? "failed" : "inactive";
	if (expectedEntries.length + expectedClientModules.length + expectedSkillIds.length === 0) return "unknown";
	const entriesActive = expectedEntries.every((expected) => runtime.entries.some((entry) => {
		if (entry.entryId !== expected && entry.entryId !== `include:${expected}`) return false;
		if (requireActiveEntries) return entry.enabled && entry.fiberPhase === "active";
		return entry.enabled ? entry.fiberPhase === "active" : entry.fiberPhase === null;
	}));
	const clientsActive = expectedClientModules.every((module) => runtime.clientModules.includes(module));
	const skillsActive = expectedSkillIds.every((skillId) => runtime.skillIds.includes(skillId));
	return entriesActive && clientsActive && skillsActive ? "running" : "failed";
}
function supportedActions(enabled, candidate, update) {
	const supported = new Set(candidate.supportedActions);
	return [
		...update !== null && supported.has("update") ? ["update"] : [],
		...enabled && supported.has("disable") ? ["disable"] : [],
		...!enabled && supported.has("enable") ? ["enable"] : [],
		...supported.has("uninstall") ? ["uninstall"] : []
	];
}
/** Join current Profile, package, catalog, journal, and runtime facts without writing state. */
function deriveInstalledPluginProjection(input) {
	const manifest = readProfileManifest("desktop", input.profileDirectory);
	const bundleState = readProfileBundleState(manifest);
	const dependencies = Object.keys(manifest.dependencies ?? {});
	const names = [...new Set([
		...bundleState.bundles,
		...bundleState.disabledBundles,
		...dependencies
	])];
	const protectedNames = new Set(input.systemComponents.packageNames);
	const pending = input.operation !== null && !TERMINAL_PHASES.has(input.operation.phase) ? input.operation : null;
	const items = [];
	for (const packageName of names) {
		const observation = observePackage(input.profileDirectory, input.installAnchor, packageName);
		const activeIndex = bundleState.bundles.indexOf(packageName);
		const disabledIndex = bundleState.disabledBundles.indexOf(packageName);
		if (!(activeIndex !== -1 || disabledIndex !== -1) && !observation.bundle) continue;
		const system = protectedNames.has(packageName);
		const catalog = system ? null : exactCatalog(packageName, observation.version, input.catalog);
		const expectedEntries = catalog?.candidate.expectedEntries ?? observation.entryIds;
		const expectedClientModules = catalog?.candidate.expectedClientModules ?? observation.expectedClientModules;
		const expectedSkillIds = catalog?.candidate.expectedSkillIds ?? observation.expectedSkillIds;
		const runtime = pluginRuntime(input.runtimeEvidence, expectedEntries, expectedClientModules, expectedSkillIds);
		const enabled = activeIndex !== -1;
		const activationReasons = catalog === null ? [] : evaluateInstalledActivationCompatibility({
			candidate: catalog.candidate,
			fingerprint: input.fingerprint
		});
		const update = catalog === null ? null : availableUpdate(catalog.candidate, input.catalog, input.fingerprint);
		items.push({
			pluginId: catalog?.candidate.pluginId ?? null,
			packageName,
			version: observation.version,
			displayName: catalog?.summary.displayName ?? packageName,
			icon: catalog?.summary.icon ?? null,
			brandColor: catalog?.summary.brandColor ?? null,
			catalogKind: catalog?.summary.catalogKind ?? null,
			source: system ? "system" : catalog === null ? "local" : "catalog",
			protected: system,
			enabled,
			bundleOrder: enabled ? activeIndex : null,
			disabledOrder: disabledIndex === -1 ? null : disabledIndex,
			runtimeStatus: runtimeStatus(enabled, observation.failed || !enabled && disabledIndex === -1, catalog !== null, input.runtimeEvidence, runtime, expectedEntries, expectedClientModules, expectedSkillIds),
			runtime,
			expectedEntries,
			expectedClientModules,
			expectedSkillIds,
			compatibility: activationReasons.length > 0 ? "incompatible" : catalog?.summary.compatibility.status ?? "unknown",
			compatibilityReason: activationReasons.length > 0 ? activationReasons.map((reason) => `${reason.code}: ${reason.subject}`).join("; ") : catalog?.summary.compatibility.reason ?? (system ? "系统组件由当前桌面发行版保护。" : "未匹配已验证目录中的确定版本。"),
			update,
			pendingAction: pending !== null && catalog !== null && pending.pluginId === catalog.candidate.pluginId ? pending.action : null,
			supportedActions: catalog === null ? [] : supportedActions(enabled, catalog.candidate, update).filter((action) => action !== "enable" || activationReasons.length === 0),
			configurationEntryIds: expectedEntries,
			ownedData: catalog === null ? [] : observation.ownedData
		});
	}
	return decodeInstalledPluginListResult({
		profileName: "web",
		profileRevision: input.fingerprint.profileRevision,
		catalogFreshness: input.catalog.freshness,
		items
	});
}
//#endregion
//#region lib/types/plugin-center/owned-data.js
/** Post-uninstall deletion of explicitly declared plugin-owned relative paths. */
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const PACKAGE_NAME$1 = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
function safeId(value, label) {
	if (!STABLE_ID.test(value)) throw new Error(`${label} must be a stable lowercase id`);
	return value;
}
function relativePath(value) {
	if (value === "" || value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/u.test(value) || value.includes("\\") || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new Error("owned-data declaration must be a portable relative path");
	return value;
}
function validateRecord(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("owned-data authority must be an object");
	const source = value;
	const keys = Object.keys(source).sort();
	const expected = [
		"declarations",
		"operationId",
		"packageName",
		"pluginId",
		"schemaVersion",
		"version"
	];
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error("owned-data authority has unknown or missing fields");
	if (source["schemaVersion"] !== 1 || typeof source["operationId"] !== "string" || typeof source["pluginId"] !== "string" || typeof source["packageName"] !== "string" || typeof source["version"] !== "string" || !Array.isArray(source["declarations"])) throw new Error("owned-data authority has invalid field types");
	if (!PACKAGE_NAME$1.test(source["packageName"])) throw new Error("owned-data authority package name is invalid");
	if (!EXACT_VERSION.test(source["version"])) throw new Error("owned-data authority version is invalid");
	const declarations = source["declarations"].map((value, index) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`owned-data declaration ${String(index)} must be an object`);
		const declaration = value;
		if (Object.keys(declaration).sort().join(",") !== "label,path" || typeof declaration["path"] !== "string" || typeof declaration["label"] !== "string" || declaration["label"] === "" || declaration["label"].length > 120 || declaration["label"].trim() !== declaration["label"]) throw new Error(`owned-data declaration ${String(index)} is invalid`);
		return {
			path: relativePath(declaration["path"]),
			label: declaration["label"]
		};
	});
	if (new Set(declarations.map((item) => item.path)).size !== declarations.length) throw new Error("owned-data authority contains duplicate paths");
	return {
		schemaVersion: 1,
		operationId: safeId(source["operationId"], "operation id"),
		pluginId: safeId(source["pluginId"], "plugin id"),
		packageName: source["packageName"],
		version: source["version"],
		declarations
	};
}
async function optionalMetadata(path) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function requireRealDirectory(path, label) {
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`${label} must be a real directory`);
}
/** Durable operation-owned declarations captured while the exact package still exists. */
var PluginOwnedDataAuthorityStore = class {
	directory;
	constructor(directory) {
		this.directory = directory;
	}
	/**
	* Persist declarations under the uninstall operation identity without overwriting drift.
	* @param input - Exact installed package declarations captured before mutation.
	* @returns After the authority record is durable.
	*/
	async capture(input) {
		const record = validateRecord({
			schemaVersion: 1,
			...input
		});
		await mkdir(this.directory, {
			recursive: true,
			mode: 448
		});
		await requireRealDirectory(this.directory, "owned-data authority directory");
		const path = join(this.directory, `${record.operationId}.json`);
		const content = `${JSON.stringify(record, null, 2)}\n`;
		try {
			const handle = await open(path, "wx", 384);
			try {
				await handle.writeFile(content);
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
			if (await readFile(path, "utf8") !== content) throw new Error("owned-data authority operation id already belongs to different declarations");
		}
	}
	/**
	* Read one previously validated authority record.
	* @param operationId - Uninstall operation that owns the declaration record.
	* @returns Exact declarations bound to that operation.
	*/
	async read(operationId) {
		safeId(operationId, "operation id");
		await requireRealDirectory(this.directory, "owned-data authority directory");
		const path = join(this.directory, `${operationId}.json`);
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("owned-data authority must be a regular file");
		return validateRecord(JSON.parse(await readFile(path, "utf8")));
	}
	/** Read a current authority when it still exists after an uninstall reload. */
	async optionalRead(operationId) {
		try {
			return await this.read(operationId);
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
	}
	/** Consume one validated offer after the user makes a final retain/remove decision. */
	async consume(operationId) {
		const record = await this.read(operationId);
		await rm(join(this.directory, `${record.operationId}.json`), { force: false });
	}
};
async function rejectSymlinks(path) {
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink()) throw new Error("owned-data deletion refuses symbolic links");
	if (!metadata.isDirectory()) return;
	for (const entry of await readdir(path)) await rejectSymlinks(join(path, entry));
}
function overlapping(paths) {
	const ordered = [...paths].sort();
	return ordered.some((path, index) => ordered.slice(index + 1).some((next) => next.startsWith(`${path}/`)));
}
/** Enforces committed-uninstall ownership and containment before any destructive write. */
var PluginOwnedDataRemover = class {
	storageRoot;
	journal;
	authority;
	constructor(storageRoot, journal, authority) {
		this.storageRoot = storageRoot;
		this.journal = journal;
		this.authority = authority;
	}
	async committedAuthority(operationId, pluginId) {
		const operation = await this.journal.read();
		if (operation === null || operation.operation.operationId !== operationId || operation.operation.action !== "uninstall" || operation.operation.pluginId !== pluginId || operation.terminalResult !== "committed" || operation.commitMarker === null) throw new Error("owned-data decision requires the matching committed uninstall");
		const authority = await this.authority.read(operationId);
		if (authority.pluginId !== pluginId || authority.version !== operation.operation.version) throw new Error("owned-data authority does not match the committed uninstall");
		return authority;
	}
	/** Restore the current committed uninstall offer after the Host changes renderer origin. */
	async currentOffer() {
		const operation = await this.journal.read();
		if (operation === null || operation.operation.action !== "uninstall" || operation.terminalResult !== "committed" || operation.commitMarker === null) return null;
		const authority = await this.authority.optionalRead(operation.operation.operationId);
		if (authority === null || authority.pluginId !== operation.operation.pluginId || authority.version !== operation.operation.version || authority.declarations.length === 0) return null;
		return decodePluginOwnedDataOffer({
			operationId: authority.operationId,
			pluginId: authority.pluginId,
			packageName: authority.packageName,
			version: authority.version,
			declarations: authority.declarations
		});
	}
	/** Persist the default retain decision by consuming only the operation authority metadata. */
	async retain(value) {
		const request = decodePluginOwnedDataRetentionRequest(value);
		await this.committedAuthority(request.operationId, request.pluginId);
		await this.authority.consume(request.operationId);
		return decodePluginOwnedDataRetentionResult({
			operationId: request.operationId,
			pluginId: request.pluginId,
			retained: true
		});
	}
	/**
	* Delete only separately confirmed paths declared by the matching committed uninstall.
	* @param value - Renderer request decoded at the destructive Desktop process boundary.
	* @returns Bounded relative paths actually removed.
	*/
	async remove(value) {
		const request = decodePluginOwnedDataRemovalRequest(value);
		if (request.paths.length === 0) throw new Error("owned-data deletion requires at least one selected path");
		const authority = await this.committedAuthority(request.operationId, request.pluginId);
		const allowed = new Set(authority.declarations.map((item) => item.path));
		if (request.paths.some((path) => !allowed.has(path)) || overlapping(request.paths)) throw new Error("owned-data deletion contains undeclared or overlapping paths");
		await mkdir(this.storageRoot, {
			recursive: true,
			mode: 448
		});
		await requireRealDirectory(this.storageRoot, "plugin storage root");
		const pluginRoot = join(await realpath(this.storageRoot), request.pluginId);
		const pluginMetadata = await optionalMetadata(pluginRoot);
		if (pluginMetadata === null) return decodePluginOwnedDataRemovalResult({
			operationId: request.operationId,
			pluginId: request.pluginId,
			removedPaths: []
		});
		if (!pluginMetadata.isDirectory() || pluginMetadata.isSymbolicLink()) throw new Error("plugin-owned storage root must be a real directory");
		const removedPaths = [];
		for (const declared of request.paths) {
			const target = resolve(pluginRoot, ...declared.split("/"));
			const fromPlugin = relative(pluginRoot, target);
			if (fromPlugin === ".." || fromPlugin.startsWith("../") || fromPlugin.startsWith("..\\")) throw new Error("owned-data path escaped the plugin storage root");
			let parent = dirname(target);
			while (parent !== pluginRoot) {
				const metadata = await optionalMetadata(parent);
				if (metadata === null) break;
				if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("owned-data path has an unsafe parent");
				parent = dirname(parent);
			}
			const metadata = await optionalMetadata(target);
			if (metadata === null) continue;
			await rejectSymlinks(target);
			await rm(target, {
				recursive: metadata.isDirectory(),
				force: false
			});
			removedPaths.push(declared);
		}
		return decodePluginOwnedDataRemovalResult({
			operationId: request.operationId,
			pluginId: request.pluginId,
			removedPaths
		});
	}
};
//#endregion
//#region lib/types/plugin-center/runtime-verifier.js
/** Post-restart Host health and joined Loader/client/Skill activation verification. */
const GENERATED_LOADER_ENTRY_ID = /^[0-9a-f]{8}$/u;
/** Loader children created for live preset instances; their owner entry remains restart-stable. */
const RESTART_SCOPED_LOADER_ENTRY_PREFIXES = ["include:agent-presets:"];
function record$1(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value;
}
function sortEntries(entries) {
	return [...entries].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
function isRestartStableEntry(entry) {
	return !RESTART_SCOPED_LOADER_ENTRY_PREFIXES.some((prefix) => entry.entryId.startsWith(prefix));
}
function restartStableEntries(entries) {
	return entries.filter(isRestartStableEntry);
}
function normalizeEvidence(value, allowLegacyGeneratedIds = false) {
	const inventory = record$1(value, "runtime inventory");
	const entries = inventory["entries"];
	if (!Array.isArray(entries)) throw new Error("runtime inventory entries must be an array");
	const sources = entries.map((entry, index) => record$1(entry, `runtime inventory entry ${String(index)}`));
	const decoded = decodePluginRuntimeEvidence({
		entries: sources.map((source) => ({
			entryId: source["entryId"],
			enabled: source["enabled"],
			fiberPhase: source["fiberPhase"]
		})),
		clientModules: inventory["clientModules"],
		skillIds: inventory["skillIds"]
	});
	const legacyGeneratedEntries = [];
	return {
		evidence: decodePluginRuntimeEvidence({
			entries: [...decoded.entries.flatMap((entry, index) => {
				if (!GENERATED_LOADER_ENTRY_ID.test(entry.entryId)) return [entry];
				const moduleName = sources[index]?.["moduleName"];
				if (typeof moduleName === "string" && moduleName.length > 0) return [{
					...entry,
					entryId: `module:${moduleName}`
				}];
				if (!allowLegacyGeneratedIds) throw new Error(`runtime inventory entry ${String(index)} lacks stable module identity`);
				legacyGeneratedEntries.push(entry);
				return [];
			})].sort((left, right) => left.entryId.localeCompare(right.entryId)),
			clientModules: [...decoded.clientModules].sort(),
			skillIds: [...decoded.skillIds].sort()
		}),
		legacyGeneratedEntries: sortEntries(legacyGeneratedEntries)
	};
}
function sameEvidence(observed, expected) {
	const normalized = normalizeEvidence(expected, true);
	const observedStable = {
		...observed,
		entries: restartStableEntries(observed.entries)
	};
	const expectedStable = {
		...normalized.evidence,
		entries: restartStableEntries(normalized.evidence.entries)
	};
	if (normalized.legacyGeneratedEntries.length === 0) return JSON.stringify(observedStable) === JSON.stringify(expectedStable);
	const observedGeneratedEntries = observedStable.entries.filter((entry) => entry.entryId.startsWith("module:")).map(({ enabled, fiberPhase }) => ({
		entryId: "",
		enabled,
		fiberPhase
	}));
	const expectedGeneratedEntries = normalized.legacyGeneratedEntries.map(({ enabled, fiberPhase }) => ({
		entryId: "",
		enabled,
		fiberPhase
	}));
	return JSON.stringify({
		...observedStable,
		entries: observedStable.entries.filter((entry) => !entry.entryId.startsWith("module:"))
	}) === JSON.stringify(expectedStable) && JSON.stringify(sortEntries(observedGeneratedEntries)) === JSON.stringify(sortEntries(expectedGeneratedEntries));
}
function candidateEntry(candidates, entryId) {
	return candidates.some((candidate) => candidate.expectedEntries.some((expected) => entryId === expected || entryId === `include:${expected}`));
}
function requireUnrelatedContinuity(prior, observed, candidates, allowUndeclaredSkillRemoval = false) {
	for (const entry of prior.entries) {
		if (!isRestartStableEntry(entry)) continue;
		if (candidateEntry(candidates, entry.entryId)) continue;
		if (!observed.entries.some((current) => current.entryId === entry.entryId && current.enabled === entry.enabled && current.fiberPhase === entry.fiberPhase)) throw new Error(`unrelated Loader entry changed during plugin mutation: ${entry.entryId}`);
	}
	for (const moduleName of prior.clientModules) if (!candidates.some((candidate) => candidate.expectedClientModules.includes(moduleName)) && !observed.clientModules.includes(moduleName)) throw new Error(`unrelated client module disappeared during plugin mutation: ${moduleName}`);
	for (const skillId of prior.skillIds) if (!candidates.some((candidate) => candidate.expectedSkillIds.includes(skillId)) && !observed.skillIds.includes(skillId)) {
		if (allowUndeclaredSkillRemoval) continue;
		throw new Error(`unrelated Skill disappeared during plugin mutation: ${skillId}`);
	}
}
/** Reads the current Host through its ordinary loopback HTTP surface. */
var PluginRuntimeVerifier = class {
	fetcher;
	createRpcId;
	timeoutMs;
	constructor(fetcher = fetch, createRpcId = randomUUID, timeoutMs = 1e4) {
		this.fetcher = fetcher;
		this.createRpcId = createRpcId;
		this.timeoutMs = timeoutMs;
	}
	async verifyHealth(origin) {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, this.timeoutMs);
		try {
			const response = await this.fetcher(`${origin}/`, {
				method: "GET",
				redirect: "error",
				signal: controller.signal
			});
			if (!response.ok || new URL(response.url || origin).origin !== origin) throw new Error("replacement Host did not answer from its owned loopback origin");
		} finally {
			clearTimeout(timeout);
		}
	}
	/** Read a canonical exact Loader/client/Skill inventory from one owned Host. */
	async readEvidence(origin) {
		const rpcId = this.createRpcId();
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, this.timeoutMs);
		try {
			const response = await this.fetcher(`${origin}/api/pluginInventory/list`, {
				method: "POST",
				redirect: "error",
				signal: controller.signal,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId,
					method: "pluginInventory/list",
					payload: { args: {} }
				})
			});
			if (!response.ok) throw new Error(`runtime inventory returned HTTP ${String(response.status)}`);
			const envelope = record$1(await response.json(), "runtime inventory response");
			if (envelope["type"] !== "server-response" || envelope["rpcId"] !== rpcId) throw new Error("runtime inventory response does not own the request id");
			const result = record$1(envelope["result"], "runtime inventory result");
			if (result["ok"] !== true) throw new Error("runtime inventory request failed");
			return normalizeEvidence(result["value"]).evidence;
		} finally {
			clearTimeout(timeout);
		}
	}
	/** Require the exact prior inventory after a recovery restart. */
	async verifyEvidence(origin, expected) {
		const observed = await this.readEvidence(origin);
		if (!sameEvidence(observed, expected)) throw new Error("recovered Host runtime inventory differs from the prior verified inventory");
		return observed;
	}
	/** Require every catalog-declared activation identity and return the full target inventory. */
	async verifyActivation(origin, candidate) {
		const inventory = await this.readEvidence(origin);
		for (const expected of candidate.expectedEntries) if (!inventory.entries.some((entry) => (entry.entryId === expected || entry.entryId === `include:${expected}`) && entry.enabled && entry.fiberPhase === "active")) throw new Error(`expected Loader entry is not active: ${expected}`);
		for (const expected of candidate.expectedClientModules) if (!inventory.clientModules.includes(expected)) throw new Error(`expected client module is not active: ${expected}`);
		for (const expected of candidate.expectedSkillIds) if (!inventory.skillIds.includes(expected)) throw new Error(`expected Skill is not active: ${expected}`);
		return inventory;
	}
	/** Require target activation while retaining every unrelated prior runtime identity. */
	async verifyActivationTransition(origin, candidate, prior, replacedCandidate) {
		const inventory = await this.verifyActivation(origin, candidate);
		const continuityCandidates = replacedCandidate === void 0 ? [candidate] : [candidate, replacedCandidate];
		requireUnrelatedContinuity(normalizeEvidence(prior, true).evidence, inventory, continuityCandidates);
		return inventory;
	}
	/**
	* Require every declared target identity absent while unrelated Loader and client runtime stays stable.
	* @param origin - Replacement Host origin.
	* @param candidate - Exact target version whose declared runtime identities must disappear.
	* @param prior - Runtime inventory captured before Host stop.
	* @param replacedCandidate - Prior exact version during an update.
	* @param allowUndeclaredSkillRemoval - Accept missing Skill ids after target Loader removal
	* when an ecosystem package did not declare the Skills it registered.
	* @returns The verified replacement Host inventory.
	*/
	async verifyDeactivation(origin, candidate, prior, replacedCandidate, allowUndeclaredSkillRemoval = false) {
		const inventory = await this.readEvidence(origin);
		const removedCandidates = replacedCandidate === void 0 ? [candidate] : [candidate, replacedCandidate];
		for (const expected of new Set(removedCandidates.flatMap((value) => value.expectedEntries))) if (inventory.entries.some((entry) => entry.entryId === expected || entry.entryId === `include:${expected}`)) throw new Error(`removed Loader entry is still present: ${expected}`);
		for (const expected of new Set(removedCandidates.flatMap((value) => value.expectedClientModules))) if (inventory.clientModules.includes(expected)) throw new Error(`removed client module is still present: ${expected}`);
		for (const expected of new Set(removedCandidates.flatMap((value) => value.expectedSkillIds))) if (inventory.skillIds.includes(expected)) throw new Error(`removed Skill is still present: ${expected}`);
		requireUnrelatedContinuity(normalizeEvidence(prior, true).evidence, inventory, replacedCandidate === void 0 ? [candidate] : [candidate, replacedCandidate], allowUndeclaredSkillRemoval);
		return inventory;
	}
};
//#endregion
//#region lib/types/plugin-center/startup-recovery.js
/** Startup gate that gives an open Plugin Center journal ownership before ordinary Host boot. */
/** Recover an interrupted operation first, then start the normal Host only after a safe terminal state. */
async function preparePluginCenterStartup(input) {
	let before;
	try {
		before = await input.journal.read();
	} catch (error) {
		if (!(error instanceof PluginOperationJournalError)) throw error;
		return {
			mode: "recovery-failed",
			recovery: await input.recovery.getSnapshot()
		};
	}
	if (needsAutomaticPluginRecovery(before)) await input.recovery.recoverOpen("internal");
	let after;
	try {
		after = await input.journal.read();
	} catch (error) {
		if (!(error instanceof PluginOperationJournalError)) throw error;
		return {
			mode: "recovery-failed",
			recovery: await input.recovery.getSnapshot()
		};
	}
	const recovery = await input.recovery.getSnapshot();
	if (blocksNormalPluginStartup(after)) return {
		mode: "recovery-failed",
		recovery
	};
	await input.startNormalHost();
	return {
		mode: "normal",
		recovery
	};
}
//#endregion
//#region lib/types/plugin-center/system-components.js
/** Derive release-owned package and Loader-row identities from shipped Bundles. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const MODULE_SPECIFIER = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/[a-zA-Z0-9._/-]+)?$/u;
const ENTRY_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
function scalar(source, label) {
	const value = source.trim();
	if (value.startsWith("'") && value.endsWith("'") || value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
	if (value === "" || /[\s#]/u.test(value)) throw new Error(`${label} must be one plain YAML scalar`);
	return value;
}
function packageFromSpecifier(specifier, label) {
	if (!MODULE_SPECIFIER.test(specifier)) throw new Error(`${label} has an invalid Loader module specifier`);
	if (!specifier.startsWith("@")) {
		const [packageName] = specifier.split("/");
		if (packageName === void 0) throw new Error(`${label} has no package name`);
		return packageName;
	}
	return specifier.split("/").slice(0, 2).join("/");
}
function collectPatchIdentities(patch, label, entryIds, packageNames) {
	let observedEntry = false;
	for (const [index, line] of patch.split(/\r?\n/u).entries()) {
		const entry = line.match(/^\s*-\s+id:\s+(.+?)\s*$/u);
		if (entry?.[1] !== void 0) {
			const value = scalar(entry[1], `${label}:${String(index + 1)} id`);
			if (!ENTRY_ID.test(value)) throw new Error(`${label}:${String(index + 1)} has an invalid Loader row id`);
			entryIds.add(value);
			observedEntry = true;
			continue;
		}
		const packageRow = line.match(/^\s+name:\s+(.+?)\s*$/u);
		if (packageRow?.[1] === void 0) continue;
		const rowLabel = `${label}:${String(index + 1)} name`;
		packageNames.add(packageFromSpecifier(scalar(packageRow[1], rowLabel), rowLabel));
	}
	if (!observedEntry) throw new Error(`${label} contains no protected Loader rows`);
}
/**
* Read shipped Bundle manifests and patches without evaluating YAML expressions.
* @param manifestPaths - Exact package manifests composing the Desktop Web profile.
* @returns Sorted release-owned package and Loader-row identities.
*/
function deriveProtectedSystemComponents(manifestPaths) {
	if (manifestPaths.length === 0) throw new Error("shipped composition must contain at least one Bundle");
	const packageNames = /* @__PURE__ */ new Set();
	const entryIds = /* @__PURE__ */ new Set();
	for (const manifestPath of manifestPaths) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (typeof manifest.name !== "string" || !PACKAGE_NAME.test(manifest.name)) throw new Error(`${manifestPath} has no valid package name`);
		const declaredPatch = manifest.dsh?.bundle?.patch;
		if (typeof declaredPatch !== "string" || declaredPatch === "") throw new Error(`${manifestPath} declares no dsh.bundle.patch`);
		const root = dirname(manifestPath);
		const patchPath = resolve(root, declaredPatch);
		const fromRoot = relative(root, patchPath);
		if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) throw new Error(`${manifestPath} declares a Bundle patch outside its package`);
		packageNames.add(manifest.name);
		collectPatchIdentities(readFileSync(patchPath, "utf8"), patchPath, entryIds, packageNames);
	}
	return {
		packageNames: [...packageNames].sort(),
		entryIds: [...entryIds].sort()
	};
}
//#endregion
//#region lib/types/plugin-center/profile-installation.js
/** Exact installed-Bundle reconciliation and validation for the selected Profile. */
function packagePath(profileDirectory, packageName) {
	return join(profileDirectory, "node_modules", ...packageName.split("/"));
}
function record(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must hold an object`);
	return value;
}
function optionalRecord(value, label) {
	return value === void 0 ? void 0 : record(value, label);
}
function sameStrings(value, expected) {
	return Array.isArray(value) && value.every((item) => typeof item === "string") && value.length === expected.length && [...value].sort().every((item, index) => item === [...expected].sort()[index]);
}
function patchValues(patch, key) {
	const values = /* @__PURE__ */ new Set();
	const expression = key === "id" ? /^\s*-\s+id:\s+(.+?)\s*$/u : /^\s+name:\s+(.+?)\s*$/u;
	for (const line of patch.split(/\r?\n/u)) {
		const matched = line.match(expression)?.[1]?.trim();
		if (matched === void 0) continue;
		const unquoted = matched.startsWith("'") && matched.endsWith("'") || matched.startsWith("\"") && matched.endsWith("\"") ? matched.slice(1, -1) : matched;
		values.add(unquoted);
	}
	return values;
}
function exportsBundle(profileDirectory, installAnchor, packageName) {
	try {
		return readProfileManifest("desktop", resolveBundleDir("desktop", packageName, installAnchor, profileDirectory)).dsh?.bundle?.patch !== void 0;
	} catch {
		return false;
	}
}
/** Reconcile the shared Bundle list and reject any installed identity drift. */
async function reconcileAndValidateInstalledBundle(input) {
	const after = readProfileManifest("desktop", input.profileDirectory);
	if (!(input.candidate.packageName in (after.dependencies ?? {}))) throw new Error("package manager did not retain the validated package as a Profile dependency");
	const reconciliation = reconcileProfileBundles(input.before, after, (packageName) => exportsBundle(input.profileDirectory, input.installAnchor, packageName));
	if (reconciliation.changed) await writeFileAtomic(join(input.profileDirectory, "package.json"), `${JSON.stringify(reconciliation.manifest, null, 2)}\n`, {
		mode: 384,
		dirMode: 448
	});
	const expectedEnabled = input.expectedEnabled ?? true;
	const bundleState = readProfileBundleState(readProfileManifest("desktop", input.profileDirectory));
	if (bundleState.bundles.includes(input.candidate.packageName) !== expectedEnabled || bundleState.disabledBundles.includes(input.candidate.packageName) === expectedEnabled) throw new Error(`validated package did not preserve its expected ${expectedEnabled ? "active" : "disabled"} Bundle state`);
	const packageDirectory = packagePath(input.profileDirectory, input.candidate.packageName);
	const manifestPath = join(packageDirectory, "package.json");
	const manifest = record(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
	if (manifest["name"] !== input.candidate.packageName || manifest["version"] !== input.candidate.version) throw new Error("installed package identity differs from the validated exact version");
	const dsh = record(manifest["dsh"], `${manifestPath} dsh`);
	if (record(dsh["bundle"], `${manifestPath} dsh.bundle`)["patch"] !== input.candidate.bundlePatch) throw new Error("installed package activation declaration differs from the validated catalog record");
	const patchPath = resolve(packageDirectory, input.candidate.bundlePatch);
	const fromRoot = relative(packageDirectory, patchPath);
	if (fromRoot === ".." || fromRoot.startsWith("../") || fromRoot.startsWith("..\\")) throw new Error("installed package Bundle patch resolves outside its package");
	const patch = await readFile(patchPath, "utf8");
	const ids = patchValues(patch, "id");
	const names = patchValues(patch, "name");
	const pluginCenter = optionalRecord(dsh["pluginCenter"], `${manifestPath} dsh.pluginCenter`);
	const declaredClientEvidence = pluginCenter?.["expectedClientModules"] !== void 0 && sameStrings(pluginCenter["expectedClientModules"], input.candidate.expectedClientModules);
	if (input.candidate.expectedEntries.some((entryId) => !ids.has(entryId)) || !declaredClientEvidence && input.candidate.expectedClientModules.some((moduleName) => !names.has(moduleName))) throw new Error("installed package Bundle patch differs from the catalog activation evidence");
	if (input.candidate.expectedClientModules.includes(input.candidate.packageName) && optionalRecord(dsh["client"], `${manifestPath} dsh.client`) === void 0) throw new Error("installed package no longer declares its cataloged client module");
	if (pluginCenter?.["expectedEntries"] !== void 0 && !sameStrings(pluginCenter["expectedEntries"], input.candidate.expectedEntries) || pluginCenter?.["expectedClientModules"] !== void 0 && !sameStrings(pluginCenter["expectedClientModules"], input.candidate.expectedClientModules) || pluginCenter?.["expectedSkillIds"] !== void 0 && !sameStrings(pluginCenter["expectedSkillIds"], input.candidate.expectedSkillIds)) throw new Error("installed package plugin-center declaration differs from the catalog activation evidence");
	if (expectedEnabled) {
		const home = dirname(dirname(input.profileDirectory));
		if (!loadProfile("desktop", "web", input.installAnchor, home).layers.some((layer) => layer.packageName === input.candidate.packageName)) throw new Error("reconciled Profile cannot resolve the validated Bundle layer");
	} else if (!exportsBundle(input.profileDirectory, input.installAnchor, input.candidate.packageName)) throw new Error("disabled validated package no longer resolves as a Bundle");
}
/** Reconcile a removed dependency and require both active and disabled metadata to disappear. */
async function reconcileAndValidateUninstalledBundle(input) {
	const after = readProfileManifest("desktop", input.profileDirectory);
	if (input.packageName in (after.dependencies ?? {})) throw new Error("package manager retained the removed package as a Profile dependency");
	const reconciliation = reconcileProfileBundles(input.before, after, (packageName) => exportsBundle(input.profileDirectory, input.installAnchor, packageName));
	if (reconciliation.changed) await writeFileAtomic(join(input.profileDirectory, "package.json"), `${JSON.stringify(reconciliation.manifest, null, 2)}\n`, {
		mode: 384,
		dirMode: 448
	});
	const bundleState = readProfileBundleState(reconciliation.manifest);
	if (bundleState.bundles.includes(input.packageName) || bundleState.disabledBundles.includes(input.packageName)) throw new Error("removed package remains in active or disabled Bundle metadata");
}
//#endregion
//#region lib/types/plugin-center/trusted-install-executor.js
/** Successful trusted-install transaction from exact preflight through runtime evidence. */
function failure$1(code, message, cause) {
	return new PluginOperationFailure(code, message, { cause });
}
async function transitionOrThrow(controls, phase, generation) {
	await controls.transition(phase, generation);
}
/** Build the controller runner that commits only after all joined evidence passes. */
function createTrustedInstallRunner(options) {
	return async (request, controls) => {
		if (request.action !== "install") throw new PluginOperationFailure("preflight-denied", "trusted install runner accepts install actions only");
		const resolved = await options.compatibility.resolve({
			pluginId: request.pluginId,
			version: request.version,
			action: "install"
		});
		const candidate = resolved.candidate;
		if (candidate === null || !resolved.decision.allowed) throw new PluginOperationFailure("preflight-denied", "trusted installation preflight denied the exact target");
		await transitionOrThrow(controls, "downloading");
		let artifact;
		try {
			artifact = await options.downloader.download(candidate, options.platform, controls.operationId);
		} catch (error) {
			throw failure$1("download-failed", "validated plugin artifact could not be downloaded", error);
		}
		await transitionOrThrow(controls, "verifying-artifact");
		if (!(await verifyPluginArtifact({
			bytes: artifact.bytes,
			candidate,
			platform: options.platform
		})).verified) throw new PluginOperationFailure("artifact-invalid", "validated plugin artifact failed verification");
		let lock;
		try {
			lock = await options.profileLock.acquire(controls.operationId);
		} catch (error) {
			throw failure$1("profile-busy", "selected Profile already has a mutation owner", error);
		}
		try {
			await transitionOrThrow(controls, "snapshotting");
			let before;
			let snapshot;
			try {
				const currentGeneration = options.host.current;
				if (currentGeneration === void 0) throw new Error("current Host is unavailable before snapshotting");
				const priorRuntimeEvidence = await options.runtimeVerifier.readEvidence(currentGeneration.origin);
				before = readProfileManifest("desktop", options.profileDirectory);
				snapshot = await options.snapshotStore.capture(controls.operationId, candidate.packageName);
				await controls.recordFoundation(resolved.fingerprint, {
					snapshotId: snapshot.snapshotId,
					snapshotSha256: snapshot.snapshotSha256,
					profileIdentity: snapshot.profileIdentity,
					runtimeEvidence: priorRuntimeEvidence
				});
			} catch (error) {
				throw failure$1("snapshot-failed", "selected Profile could not be snapshotted before mutation", error);
			}
			const oldGeneration = options.host.current?.id ?? null;
			let targetFingerprint;
			await transitionOrThrow(controls, "stopping-host", oldGeneration);
			let generation;
			try {
				generation = await options.host.restart(`install ${candidate.pluginId}@${candidate.version}`, async () => {
					await controls.completeSideEffect("stopping-host", oldGeneration);
					await transitionOrThrow(controls, "installing", oldGeneration);
					try {
						await installTrustedPackage(options.packageManager, {
							packageName: candidate.packageName,
							version: candidate.version,
							artifactPath: artifact.path
						});
					} catch (error) {
						throw failure$1("package-mutation-failed", "fixed package mutation failed", error);
					}
					await controls.completeSideEffect("installing", oldGeneration);
					await transitionOrThrow(controls, "validating-profile", oldGeneration);
					try {
						await reconcileAndValidateInstalledBundle({
							before,
							profileDirectory: options.profileDirectory,
							installAnchor: options.installAnchor,
							candidate
						});
						targetFingerprint = await options.postFingerprint(resolved.selection);
						const installed = targetFingerprint.installedPlugins.find((plugin) => plugin.pluginId === candidate.pluginId);
						if (installed?.version !== candidate.version || !installed.enabled || installed.packageName !== candidate.packageName) throw new Error("installed Profile projection does not expose the exact active Bundle");
					} catch (error) {
						if (error instanceof PluginOperationFailure) throw error;
						throw failure$1("profile-invalid", "mutated Profile failed exact-version validation", error);
					}
					await transitionOrThrow(controls, "starting-host", oldGeneration);
				});
			} catch (error) {
				if (error instanceof PluginOperationFailure) throw error;
				throw failure$1("host-restart-failed", "replacement Host generation could not start", error);
			}
			await controls.completeSideEffect("starting-host", generation.id);
			await transitionOrThrow(controls, "reloading", generation.id);
			try {
				await options.reloadHost(generation.origin);
			} catch (error) {
				throw failure$1("host-restart-failed", "Desktop window could not reconnect to the replacement Host", error);
			}
			await controls.completeSideEffect("reloading", generation.id);
			await transitionOrThrow(controls, "health-checking", generation.id);
			try {
				await options.runtimeVerifier.verifyHealth(generation.origin);
			} catch (error) {
				throw failure$1("host-restart-failed", "replacement Host failed loopback health verification", error);
			}
			await transitionOrThrow(controls, "verifying-runtime", generation.id);
			let runtimeEvidence;
			try {
				runtimeEvidence = await options.runtimeVerifier.verifyActivation(generation.origin, candidate);
			} catch (error) {
				throw failure$1("runtime-evidence-missing", "declared runtime activation evidence is incomplete", error);
			}
			if (targetFingerprint === void 0) throw new PluginOperationFailure("internal", "target fingerprint was not retained through Host restart");
			return {
				hostGeneration: generation.id,
				fingerprint: targetFingerprint,
				runtimeEvidence
			};
		} finally {
			await lock.release();
		}
	};
}
//#endregion
//#region lib/types/plugin-center/trusted-management-executor.js
/** Trusted installed-plugin mutations using the same journal, snapshot, and recovery owner as install. */
function failure(code, message, cause) {
	return new PluginOperationFailure(code, message, { cause });
}
async function transition(controls, phase, generation) {
	await controls.transition(phase, generation);
}
function requireManagedRequest(request) {
	if (request.action === "install") throw new PluginOperationFailure("preflight-denied", "management runner does not accept install actions");
}
/** Build a runner that commits only after Profile intent and joined runtime evidence agree. */
function createTrustedManagementRunner(options) {
	return async (request, controls) => {
		requireManagedRequest(request);
		const resolved = await options.compatibility.resolve({
			pluginId: request.pluginId,
			version: request.version,
			action: request.action
		});
		const candidate = resolved.candidate;
		const installedBefore = resolved.fingerprint.installedPlugins.find((plugin) => plugin.pluginId === request.pluginId);
		if (candidate === null || installedBefore === void 0 || !resolved.decision.allowed) throw new PluginOperationFailure("preflight-denied", "installed plugin action failed exact compatibility checks");
		let replacedCandidate;
		if (request.action === "update") {
			const prior = await options.compatibility.resolve({
				pluginId: request.pluginId,
				version: installedBefore.version,
				action: installedBefore.enabled ? "disable" : "enable"
			});
			if (prior.candidate === null || prior.candidate.packageName !== candidate.packageName) throw new PluginOperationFailure("preflight-denied", "installed exact version has no matching catalog authority");
			replacedCandidate = prior.candidate;
		}
		await transition(controls, "downloading");
		let artifact;
		if (request.action === "update") try {
			artifact = await options.downloader.download(candidate, options.platform, controls.operationId);
		} catch (error) {
			throw failure("download-failed", "validated update artifact could not be downloaded", error);
		}
		await transition(controls, "verifying-artifact");
		if (request.action === "update") {
			if (artifact === void 0) throw new PluginOperationFailure("internal", "update artifact was not retained");
			if (!(await (options.verifyArtifact ?? verifyPluginArtifact)({
				bytes: artifact.bytes,
				candidate,
				platform: options.platform
			})).verified) throw new PluginOperationFailure("artifact-invalid", "validated update artifact failed verification");
		}
		let lock;
		try {
			lock = await options.profileLock.acquire(controls.operationId);
		} catch (error) {
			throw failure("profile-busy", "selected Profile already has a mutation owner", error);
		}
		try {
			await transition(controls, "snapshotting");
			const currentGeneration = options.host.current;
			if (currentGeneration === void 0) throw new PluginOperationFailure("snapshot-failed", "current Host is unavailable before snapshotting");
			let priorRuntime;
			let before;
			try {
				priorRuntime = await options.runtimeVerifier.readEvidence(currentGeneration.origin);
				before = readProfileManifest("desktop", options.profileDirectory);
				const snapshot = await options.snapshotStore.capture(controls.operationId, candidate.packageName);
				if (request.action === "uninstall") {
					const authority = readInstalledOwnedDataAuthority({
						profileDirectory: options.profileDirectory,
						installAnchor: options.installAnchor,
						packageName: candidate.packageName,
						version: installedBefore.version
					});
					await options.ownedDataAuthorityStore.capture({
						operationId: controls.operationId,
						pluginId: candidate.pluginId,
						packageName: candidate.packageName,
						version: authority.version,
						declarations: authority.declarations
					});
				}
				await controls.recordFoundation(resolved.fingerprint, {
					snapshotId: snapshot.snapshotId,
					snapshotSha256: snapshot.snapshotSha256,
					profileIdentity: snapshot.profileIdentity,
					runtimeEvidence: priorRuntime
				});
			} catch (error) {
				if (error instanceof PluginOperationFailure) throw error;
				throw failure("snapshot-failed", "selected Profile could not be snapshotted before mutation", error);
			}
			const oldGeneration = currentGeneration.id;
			let targetFingerprint;
			await transition(controls, "stopping-host", oldGeneration);
			let generation;
			try {
				generation = await options.host.restart(`${request.action} ${candidate.pluginId}@${candidate.version}`, async () => {
					await controls.completeSideEffect("stopping-host", oldGeneration);
					await transition(controls, "installing", oldGeneration);
					try {
						if (request.action === "enable" || request.action === "disable") {
							const next = setProfileBundleEnabled(before, candidate.packageName, request.action === "enable");
							await writeFileAtomic(join(options.profileDirectory, "package.json"), `${JSON.stringify(next, null, 2)}\n`, {
								mode: 384,
								dirMode: 448
							});
						} else if (request.action === "update") {
							if (artifact === void 0) throw new Error("verified update artifact is unavailable");
							await installTrustedPackage(options.packageManager, {
								packageName: candidate.packageName,
								version: candidate.version,
								artifactPath: artifact.path
							});
						} else await removeTrustedPackage(options.packageManager, { packageName: candidate.packageName });
					} catch (error) {
						throw failure("package-mutation-failed", "fixed installed-plugin mutation failed", error);
					}
					await controls.completeSideEffect("installing", oldGeneration);
					await transition(controls, "validating-profile", oldGeneration);
					try {
						if (request.action === "update") await reconcileAndValidateInstalledBundle({
							before,
							profileDirectory: options.profileDirectory,
							installAnchor: options.installAnchor,
							candidate,
							expectedEnabled: installedBefore.enabled
						});
						else if (request.action === "uninstall") await reconcileAndValidateUninstalledBundle({
							before,
							profileDirectory: options.profileDirectory,
							installAnchor: options.installAnchor,
							packageName: candidate.packageName
						});
						targetFingerprint = await options.postFingerprint(resolved.selection);
						const observed = targetFingerprint.installedPlugins.find((plugin) => plugin.pluginId === candidate.pluginId);
						if (request.action === "uninstall") {
							if (observed !== void 0) throw new Error("removed plugin remains in the Profile projection");
						} else {
							const expectedVersion = request.action === "update" ? candidate.version : installedBefore.version;
							const expectedEnabled = request.action === "enable" ? true : request.action === "disable" ? false : installedBefore.enabled;
							if (observed?.packageName !== candidate.packageName || observed.version !== expectedVersion || observed.enabled !== expectedEnabled) throw new Error("Profile projection does not expose the exact requested installed state");
						}
					} catch (error) {
						if (error instanceof PluginOperationFailure) throw error;
						throw failure("profile-invalid", "mutated Profile failed installed-state validation", error);
					}
					await transition(controls, "starting-host", oldGeneration);
				});
			} catch (error) {
				if (error instanceof PluginOperationFailure) throw error;
				throw failure("host-restart-failed", "replacement Host generation could not start", error);
			}
			await controls.completeSideEffect("starting-host", generation.id);
			await transition(controls, "reloading", generation.id);
			try {
				await options.reloadHost(generation.origin);
			} catch (error) {
				throw failure("host-restart-failed", "Desktop window could not reconnect to the replacement Host", error);
			}
			await controls.completeSideEffect("reloading", generation.id);
			await transition(controls, "health-checking", generation.id);
			try {
				await options.runtimeVerifier.verifyHealth(generation.origin);
			} catch (error) {
				throw failure("host-restart-failed", "replacement Host failed loopback health verification", error);
			}
			await transition(controls, "verifying-runtime", generation.id);
			let runtimeEvidence;
			try {
				runtimeEvidence = request.action === "enable" || request.action === "update" && installedBefore.enabled ? await options.runtimeVerifier.verifyActivationTransition(generation.origin, candidate, priorRuntime, replacedCandidate) : await options.runtimeVerifier.verifyDeactivation(generation.origin, candidate, priorRuntime, replacedCandidate, request.action === "uninstall" || request.action === "disable");
			} catch (error) {
				throw failure("runtime-evidence-missing", "installed plugin runtime transition evidence is incomplete", error);
			}
			if (targetFingerprint === void 0) throw new PluginOperationFailure("internal", "target fingerprint was not retained through Host restart");
			return {
				hostGeneration: generation.id,
				fingerprint: targetFingerprint,
				runtimeEvidence
			};
		} finally {
			await lock.release();
		}
	};
}
//#endregion
//#region lib/types/renderer-navigation.js
/** Pure URL composition for Desktop renderer navigation across Host generations. */
const PRIMARY_PAGE_PARAMETER = "dsh-primary-page";
/** Stable first-level page id for the Desktop Plugin Center. */
const PLUGIN_CENTER_PAGE_ID = "plugin-center";
/** Renderer URL parameter retaining the Plugin Center subview across a controlled Host replacement. */
const PLUGIN_CENTER_VIEW_PARAMETER = "dsh-plugin-center-view";
/** URL value selecting the expanded installed-plugin manager. */
const PLUGIN_CENTER_INSTALLED_VIEW = "installed";
/**
* Compose the next Host URL while retaining only explicitly supported local viewing state.
* @param options - Replacement origin, platform, requested page, and current renderer URL.
* @returns A trusted renderer URL for the replacement Host generation.
*/
function desktopRendererUrl(options) {
	const url = new URL(options.origin);
	url.searchParams.set("dsh-desktop-platform", options.platform);
	if (options.primaryPage !== void 0) url.searchParams.set(PRIMARY_PAGE_PARAMETER, options.primaryPage);
	if (options.primaryPage !== "plugin-center") return url.href;
	try {
		if (new URL(options.previousUrl).searchParams.get("dsh-plugin-center-view") === "installed") url.searchParams.set(PLUGIN_CENTER_VIEW_PARAMETER, PLUGIN_CENTER_INSTALLED_VIEW);
	} catch {}
	return url.href;
}
//#endregion
//#region lib/types/update-controller.js
/** Electron-updater lifecycle normalized for the renderer settings page. */
/** State owner for one packaged application update lifecycle. */
var DesktopUpdateController = class {
	state;
	listeners = /* @__PURE__ */ new Set();
	updater;
	packaged;
	/**
	* @param updater - electron-updater singleton or a test driver.
	* @param currentVersion - running app version.
	* @param packaged - false for source development runs, where real update installation is unavailable.
	*/
	constructor(updater, currentVersion, packaged) {
		this.updater = updater;
		this.packaged = packaged;
		this.state = packaged ? {
			phase: "idle",
			currentVersion
		} : {
			phase: "development",
			currentVersion,
			message: "当前为开发版；正式安装包生成后即可从发布源检查更新。"
		};
		updater.autoDownload = false;
		updater.autoInstallOnAppQuit = true;
		updater.on("checking-for-update", () => {
			this.publish({
				phase: "checking",
				currentVersion
			});
		});
		updater.on("update-available", (info) => {
			this.publish({
				phase: "available",
				currentVersion,
				availableVersion: info.version
			});
		});
		updater.on("update-not-available", () => {
			this.publish({
				phase: "up-to-date",
				currentVersion
			});
		});
		updater.on("download-progress", (info) => {
			this.publish({
				phase: "downloading",
				currentVersion,
				...this.state.availableVersion === void 0 ? {} : { availableVersion: this.state.availableVersion },
				progress: Math.max(0, Math.min(100, info.percent))
			});
		});
		updater.on("update-downloaded", (info) => {
			this.publish({
				phase: "ready",
				currentVersion,
				availableVersion: info.version,
				progress: 100
			});
		});
		updater.on("error", (error) => {
			this.fail(error, this.state.phase === "downloading" ? "download" : "check");
		});
	}
	/** Current immutable snapshot. */
	getState() {
		return this.state;
	}
	/** Subscribe to state changes. */
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	/** Check the configured release provider. Development builds remain explicit no-ops. */
	async check() {
		if (!this.packaged) return this.state;
		try {
			await this.updater.checkForUpdates();
		} catch (error) {
			this.fail(error, "check");
		}
		return this.state;
	}
	/** Download an update that the preceding check reported. */
	async download() {
		if (!this.packaged) return this.state;
		if (this.state.phase !== "available" && this.state.phase !== "error") return this.state;
		this.publish({
			phase: "downloading",
			currentVersion: this.state.currentVersion,
			...this.state.availableVersion === void 0 ? {} : { availableVersion: this.state.availableVersion },
			progress: 0
		});
		try {
			await this.updater.downloadUpdate();
		} catch (error) {
			this.fail(error, "download");
		}
		return this.state;
	}
	/** Restart into the already downloaded update. */
	install() {
		if (this.state.phase !== "ready") throw new Error("desktop update is not ready to install");
		this.updater.quitAndInstall(false, true);
	}
	publish(next) {
		this.state = Object.freeze({ ...next });
		for (const listener of this.listeners) try {
			listener(this.state);
		} catch (error) {
			console.error("desktop update listener failed:", error);
		}
	}
	fail(error, action) {
		console.error(`desktop update ${action} failed:`, error);
		this.publish({
			phase: "error",
			currentVersion: this.state.currentVersion,
			...this.state.availableVersion === void 0 ? {} : { availableVersion: this.state.availableVersion },
			message: friendlyUpdateError(error, action)
		});
	}
};
/** Convert release-provider failures into stable learner-facing Chinese text. */
function friendlyUpdateError(error, action) {
	const message = error instanceof Error ? error.message : String(error);
	if (/Cannot find channel .* update info|\b404 Not Found\b/i.test(message)) return action === "download" ? "更新文件暂时不可用，请稍后再试。" : "更新服务正在准备中，请稍后再试。";
	if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|network|网络/i.test(message)) return action === "download" ? "暂时无法下载更新，请检查网络后重试。" : "暂时无法连接更新服务，请检查网络后重试。";
	return action === "download" ? "下载更新失败，请稍后再试。" : "检查更新失败，请稍后再试。";
}
//#endregion
//#region lib/types/window-lifecycle.js
/** Desktop window and application lifetime independent from Electron imports. */
/** Private command-line signal used by the Windows installer before replacing application files. */
const INSTALLER_QUIT_ARGUMENT = "--dsh-installer-quit";
/**
* Identify an installer-owned request without treating partial argument matches as authority to quit.
* @param commandLine - Arguments supplied to the first or a subsequent Electron instance.
* @returns Whether the exact private installer argument is present.
*/
function isInstallerQuitRequest(commandLine) {
	return commandLine.includes(INSTALLER_QUIT_ARGUMENT);
}
/**
* Create the desktop application lifecycle.
* @param options - Native window access, Host teardown and quit release.
* @returns A lifecycle whose Host outlives ordinary window closes.
*/
function createDesktopLifecycle(options) {
	let quitting = false;
	let pendingQuit;
	let creatingWindow;
	const showWindow = async () => {
		if (quitting) return;
		let window = options.getWindow();
		if (window === void 0 || window.isDestroyed()) {
			creatingWindow ??= options.createWindow().finally(() => {
				creatingWindow = void 0;
			});
			window = await creatingWindow;
		}
		if (!window.isVisible()) window.show();
		window.focus();
	};
	const requestQuit = () => {
		if (pendingQuit !== void 0) return pendingQuit;
		quitting = true;
		pendingQuit = options.disposeHost().catch((error) => {
			options.reportError?.(error);
		}).then(() => {
			options.quit();
		});
		return pendingQuit;
	};
	const reloadHost = async (origin, primaryPage) => {
		if (quitting) return;
		const window = options.getWindow();
		if (window === void 0 || window.isDestroyed()) return;
		await options.loadHost(window, origin, primaryPage);
	};
	return {
		get isQuitting() {
			return quitting;
		},
		get pendingQuit() {
			return pendingQuit;
		},
		onWindowClose(event) {
			if (quitting) return;
			event.preventDefault();
			options.getWindow()?.hide();
		},
		showWindow,
		reloadHost,
		requestQuit
	};
}
//#endregion
//#region lib/types/window-reload-transition.js
/** Keep the last rendered Desktop frame visible while the replacement Host page loads. */
/**
* Navigate while retaining the previous pixels until the replacement renderer paints.
* @param options - Visual hold, authoritative navigation, paint wait, and diagnostic operations.
* @returns When navigation completes and the held frame has been released.
*/
async function reloadWithHeldFrame(options) {
	let held;
	try {
		held = await options.holdCurrentFrame();
	} catch (error) {
		options.reportTransitionFailure?.(error);
	}
	try {
		await options.navigate();
		try {
			await options.waitForPaint();
		} catch (error) {
			options.reportTransitionFailure?.(error);
		}
	} finally {
		try {
			held?.release();
		} catch (error) {
			options.reportTransitionFailure?.(error);
		}
	}
}
//#endregion
//#region lib/types/preset-square/bundled-catalog.js
/** Read-only catalog and deterministic archives shipped with the Desktop app. */
const ARCHIVE_MTIME = /* @__PURE__ */ new Date("2026-08-17T00:00:00.000Z");
const PUBLISHER = "赋范官方";
const SOURCE_DSH_VERSION = "0.1.0-rc.7";
const DEFINITIONS = [
	{
		id: "fufan-case-01-ai-webapp",
		slug: "fufan-ai-webapp",
		presetId: "ai-product-developer",
		title: "AI WebApp",
		description: "1 套 Agent Preset + 3 个 Skills，覆盖需求澄清、规格整理与 TDD 的 Web 产品开发流程。",
		visualVariant: 0,
		createdAt: "2026-08-17T06:01:00.000Z"
	},
	{
		id: "fufan-case-02-ppt-office",
		slug: "fufan-ppt-office",
		presetId: "dsh-motion-deck-studio",
		title: "PPT Office",
		description: "1 套 Agent Preset + 1 个 Skill，把大纲生成并验收为 8 页可交互动效演示。",
		visualVariant: 1,
		createdAt: "2026-08-17T06:02:00.000Z"
	},
	{
		id: "fufan-case-03-video-generation",
		slug: "fufan-video-generation",
		presetId: "product-video-director",
		title: "视频生成",
		description: "1 套 Agent Preset + 1 个 Skill，从调研、分镜到 HyperFrames MP4；运行需 FFmpeg。",
		visualVariant: 2,
		createdAt: "2026-08-17T06:03:00.000Z"
	},
	{
		id: "fufan-case-04-content-factory",
		slug: "fufan-content-factory",
		presetId: "ai-content-image-studio",
		title: "内容工厂",
		description: "1 套 Agent Preset + 1 个 Skill + 1 个图像生成 Plugin；生图需本机已登录 Codex CLI。",
		visualVariant: 3,
		createdAt: "2026-08-17T06:04:00.000Z"
	},
	{
		id: "fufan-case-05-ai-report",
		slug: "fufan-ai-report",
		presetId: "ai-report-analyst",
		title: "AI 报表",
		description: "1 套 Agent Preset + 1 个 Skill，把本地 Excel 生成可验收的离线交互报告。",
		visualVariant: 4,
		createdAt: "2026-08-17T06:05:00.000Z"
	},
	{
		id: "fufan-case-06-feishu-digital-employee",
		slug: "fufan-feishu-digital-employee",
		presetId: "feishu-digital-employee",
		title: "飞书数字员工",
		description: "1 套 Agent Preset + 1 个 Skill，并接入飞书 MCP 与时间解析 MCP；使用前需配置飞书应用凭证。",
		visualVariant: 5,
		createdAt: "2026-08-17T06:06:00.000Z"
	}
];
async function readTree(root, directory = root) {
	const files = {};
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Bundled Preset contains a symbolic link: ${entry.name}`);
		if (entry.isDirectory()) {
			Object.assign(files, await readTree(root, path));
			continue;
		}
		if (!entry.isFile()) throw new Error(`Bundled Preset contains an unsupported entry: ${entry.name}`);
		files[relative(root, path).split(sep).join("/")] = await readFile(path);
	}
	return files;
}
/** Filesystem-backed bundled catalog used in development and packaged resources. */
var ResourcePresetSquareCatalog = class {
	root;
	materialized;
	/** @param root - Directory containing one resource tree per bundled slug. */
	constructor(root) {
		this.root = root;
	}
	async list() {
		return (await this.load()).map((entry) => entry.item);
	}
	async detail(slug) {
		return (await this.load()).find((entry) => entry.item.slug === slug)?.item;
	}
	async archive(slug) {
		return (await this.load()).find((entry) => entry.item.slug === slug)?.archive;
	}
	load() {
		this.materialized ??= Promise.all(DEFINITIONS.map(async (definition) => {
			const files = await readTree(join(this.root, definition.slug));
			if (files["manifest.json"] === void 0 || files["preset/agent.cordis.yml"] === void 0) throw new Error(`Bundled Preset ${definition.slug} is incomplete`);
			const archive = zipSync(files, {
				level: 9,
				mtime: ARCHIVE_MTIME
			});
			const digest = createHash("sha256").update(archive).digest("hex");
			const downloadUrl = `https://www.dshdesktop.com/preset/api/v1/presets/${definition.slug}/download`;
			return {
				archive,
				item: decodePresetSquareItem({
					...definition,
					source: "fufan-official",
					publisher: { username: PUBLISHER },
					artifact: {
						downloadUrl,
						sha256: digest,
						sizeBytes: archive.length,
						formatVersion: 1,
						sourceDshVersion: SOURCE_DSH_VERSION
					},
					detailUrl: `https://www.dshdesktop.com/preset/p/${definition.slug}`,
					downloadCount: 0
				})
			};
		}));
		return this.materialized;
	}
};
/** Empty bundled catalog used by tests that exercise only the community client. */
const EMPTY_PRESET_SQUARE_CATALOG = {
	list: () => Promise.resolve([]),
	detail: () => Promise.resolve(void 0),
	archive: () => Promise.resolve(void 0)
};
//#endregion
//#region lib/types/preset-square/client.js
/** Fixed-origin Preset Square reader and integrity-checked Host importer. */
const PRESET_SQUARE_ORIGIN = "https://www.dshdesktop.com";
const PRESET_SQUARE_ALLOWED_ORIGINS = new Set([PRESET_SQUARE_ORIGIN, "https://dshdesktop.com"]);
const PRESET_SQUARE_ROOT = `${PRESET_SQUARE_ORIGIN}/preset/`;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 1e4;
function assertSquareUrl(url) {
	if (url.protocol !== "https:" || !PRESET_SQUARE_ALLOWED_ORIGINS.has(url.origin) || !url.pathname.startsWith("/preset/")) throw new Error("Preset Square request left the fixed HTTPS origin");
}
function responseLength(response) {
	const raw = response.headers.get("content-length");
	if (raw === null) return void 0;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("Preset Square returned an invalid Content-Length");
	return value;
}
function responseUrl(response) {
	if (response.url.length === 0) return void 0;
	const url = new URL(response.url);
	assertSquareUrl(url);
	return url;
}
function matchesSearch(item, query) {
	const needle = query.trim().toLocaleLowerCase();
	if (needle.length === 0) return true;
	return [
		item.title,
		item.description,
		item.presetId,
		item.publisher.username
	].some((value) => value.toLocaleLowerCase().includes(needle));
}
/** Desktop-owned Preset Square operations; no renderer value supplies package authority. */
var PresetSquareClient = class {
	fetcher;
	now;
	hostOrigin;
	bundled;
	constructor(fetcher = fetch, now = Date.now, hostOrigin, bundled = EMPTY_PRESET_SQUARE_CATALOG) {
		this.fetcher = fetcher;
		this.now = now;
		this.hostOrigin = hostOrigin;
		this.bundled = bundled;
	}
	async list(value) {
		const query = decodePresetSquareListQuery(value);
		const url = new URL("api/v1/presets", PRESET_SQUARE_ROOT);
		url.searchParams.set("sort", query.sort);
		const bundled = [...await this.bundled.list()];
		if (query.sort === "newest") bundled.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
		const community = (await this.readJson(url).then(decodePresetSquareListResponse).catch((error) => {
			if (bundled.length === 0) throw error;
		}))?.items.map((item) => ({
			...item,
			source: "community"
		})) ?? [];
		const items = [...bundled, ...community];
		return decodePresetSquareListResult({
			items: items.filter((item) => matchesSearch(item, query.query)),
			total: items.length,
			sort: query.sort,
			fetchedAt: new Date(this.now()).toISOString()
		});
	}
	async detail(value) {
		const query = decodePresetSquareDetailQuery(value);
		const bundled = await this.bundled.detail(query.slug);
		if (bundled !== void 0) return decodePresetSquareDetailResult({
			item: bundled,
			fetchedAt: new Date(this.now()).toISOString()
		});
		const url = new URL(`api/v1/presets/${encodeURIComponent(query.slug)}`, PRESET_SQUARE_ROOT);
		const response = await this.fetchResponse(url);
		if (response.status === 404) return decodePresetSquareDetailResult({
			item: null,
			fetchedAt: new Date(this.now()).toISOString()
		});
		const item = {
			...decodePresetSquareItem(await this.readJsonResponse(response, url)),
			source: "community"
		};
		if (item.slug !== query.slug) throw new Error("Preset Square detail returned a different slug");
		return decodePresetSquareDetailResult({
			item,
			fetchedAt: new Date(this.now()).toISOString()
		});
	}
	async previewInstall(value) {
		const request = decodePresetInstallPreviewRequest(value);
		const item = await this.requireItem(request.slug);
		const archive = await this.download(item);
		const host = await this.importIntoHost(archive, request.targetId, false);
		if (host.sourcePresetId !== item.presetId) throw new Error("Preset package manifest does not match the published Preset id");
		const { installed: _installed, ...preview } = host;
		return decodePresetInstallPreviewResult({
			...preview,
			slug: item.slug,
			title: item.title
		});
	}
	async install(value) {
		const request = decodePresetInstallRequest(value);
		const item = await this.requireItem(request.slug);
		const archive = await this.download(item);
		const host = await this.importIntoHost(archive, request.targetId, true);
		if (host.sourcePresetId !== item.presetId || !host.installed) throw new Error("Preset package installation did not match the published Preset");
		return decodePresetInstallResult({
			...host,
			slug: item.slug,
			title: item.title,
			installed: true
		});
	}
	async requireItem(slug) {
		const result = await this.detail({ slug });
		if (result.item === null) throw new Error("Preset Square entry no longer exists");
		return result.item;
	}
	async download(item) {
		if (item.source === "fufan-official") {
			const archive = await this.bundled.archive(item.slug);
			if (archive === void 0) throw new Error("Bundled Preset package is unavailable");
			this.assertArtifact(archive, item);
			return archive;
		}
		const url = new URL(item.artifact.downloadUrl);
		assertSquareUrl(url);
		const response = await this.fetchResponse(url);
		if (!response.ok) throw new Error(`Preset download returned HTTP ${String(response.status)}`);
		responseUrl(response);
		const declared = responseLength(response);
		if (declared !== void 0 && declared !== item.artifact.sizeBytes) throw new Error("Preset download size does not match published metadata");
		if (item.artifact.sizeBytes > MAX_ARCHIVE_BYTES) throw new Error("Preset package is larger than 16 MB");
		const bytes = new Uint8Array(await response.arrayBuffer());
		this.assertArtifact(bytes, item);
		return bytes;
	}
	assertArtifact(bytes, item) {
		if (bytes.length !== item.artifact.sizeBytes || bytes.length > MAX_ARCHIVE_BYTES) throw new Error("Preset download size does not match published metadata");
		if (createHash("sha256").update(bytes).digest("hex") !== item.artifact.sha256) throw new Error("Preset package SHA-256 does not match published metadata");
	}
	async importIntoHost(data, targetId, install) {
		const origin = this.hostOrigin();
		if (origin === void 0) throw new Error("Desktop Host is unavailable");
		const url = new URL("/api/agent-preset.import", origin);
		if (targetId !== null) url.searchParams.set("targetId", targetId);
		if (install) url.searchParams.set("install", "1");
		const response = await this.fetcher(url, {
			method: "POST",
			redirect: "error",
			headers: {
				"content-type": "application/vnd.dsh.preset+zip",
				"content-length": String(data.length)
			},
			body: Buffer.from(data)
		});
		const body = await this.readBoundedJson(response, MAX_METADATA_BYTES);
		if (!response.ok || typeof body !== "object" || body === null || Array.isArray(body) || body["ok"] !== true) {
			const message = typeof body === "object" && body !== null && !Array.isArray(body) && typeof body["error"] === "string" ? body["error"] : `Preset import returned HTTP ${String(response.status)}`;
			throw new Error(message);
		}
		const source = body;
		const preview = decodePresetInstallPreviewResult({
			targetId: source["targetId"],
			sourcePresetId: source["sourcePresetId"],
			name: source["name"],
			description: source["description"],
			sourceDshVersion: source["sourceDshVersion"],
			fileCount: source["fileCount"],
			warnings: source["warnings"],
			conflict: source["conflict"],
			slug: "host-preview",
			title: "Host preview"
		});
		return {
			targetId: preview.targetId,
			sourcePresetId: preview.sourcePresetId,
			name: preview.name,
			description: preview.description,
			sourceDshVersion: preview.sourceDshVersion,
			fileCount: preview.fileCount,
			warnings: preview.warnings,
			conflict: preview.conflict,
			installed: source["installed"] === true
		};
	}
	async fetchResponse(url) {
		assertSquareUrl(url);
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, REQUEST_TIMEOUT_MS);
		try {
			return await this.fetcher(url, {
				redirect: "error",
				signal: controller.signal
			});
		} finally {
			clearTimeout(timeout);
		}
	}
	async readJson(url) {
		const response = await this.fetchResponse(url);
		return await this.readJsonResponse(response, url);
	}
	async readJsonResponse(response, requested) {
		if (!response.ok) throw new Error(`Preset Square returned HTTP ${String(response.status)}`);
		const final = responseUrl(response);
		if (final !== void 0 && final.href !== requested.href) throw new Error("Preset Square response was redirected");
		return await this.readBoundedJson(response, MAX_METADATA_BYTES);
	}
	async readBoundedJson(response, maxBytes) {
		const declared = responseLength(response);
		if (declared !== void 0 && declared > maxBytes) throw new Error("Preset Square response is too large");
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.length > maxBytes) throw new Error("Preset Square response is too large");
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new Error("Preset Square returned invalid JSON");
		}
	}
};
//#endregion
//#region lib/types/preset-square/runtime-controller.js
/** Desktop-owned detection and confirmed installation for bundled Preset runtimes. */
const VIDEO_ID = "product-video-director";
const HYPERFRAMES_VERSION = "0.7.109";
const PLAYWRIGHT_VERSION = "1.61.1";
const ECHARTS_VERSION = "6.1.0";
const OPENPYXL_VERSION = "3.1.5";
const FFMPEG_INSTALLER_VERSION = "1.1.0";
const FFPROBE_INSTALLER_VERSION = "2.1.2";
const PROCESS_TIMEOUT_MS = 10 * 6e4;
const TRUSTED_BUILD_PACKAGES = [
	"@ffmpeg-installer/darwin-arm64",
	"@ffmpeg-installer/win32-x64",
	"@ffprobe-installer/darwin-arm64",
	"@ffprobe-installer/win32-x64",
	"@google/genai",
	"esbuild",
	"onnxruntime-node",
	"protobufjs"
];
function boundedAppend(current, chunk) {
	return `${current}${chunk}`.slice(-32768);
}
const nativeRuntimeProcess = { run(request) {
	return new Promise((resolveResult, reject) => {
		const child = spawn(request.command, [...request.args], {
			cwd: request.cwd,
			env: { ...request.env },
			shell: false,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		let stdout = "";
		let stderr = "";
		let failure;
		child.stdout.on("data", (chunk) => {
			stdout = boundedAppend(stdout, chunk.toString());
		});
		child.stderr.on("data", (chunk) => {
			stderr = boundedAppend(stderr, chunk.toString());
		});
		child.once("error", (error) => {
			failure ??= error;
		});
		const timeout = setTimeout(() => {
			failure ??= /* @__PURE__ */ new Error("Preset runtime process timed out");
			child.kill("SIGTERM");
		}, request.timeoutMs ?? PROCESS_TIMEOUT_MS);
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (failure !== void 0) {
				reject(failure);
				return;
			}
			resolveResult({
				code,
				stdout,
				stderr
			});
		});
	});
} };
/** Resolve the deterministic Desktop-managed runtime tree below the Harness home. */
function presetRuntimePaths(homeDirectory) {
	const root = join(homeDirectory, "preset-runtime");
	return {
		root,
		packages: join(root, "packages"),
		bin: join(root, "bin"),
		browsers: join(root, "playwright-browsers"),
		store: join(root, "pnpm-store")
	};
}
function uniquePathEntries(entries) {
	return [...new Set(entries.flatMap((value) => value?.split(delimiter) ?? []).filter(Boolean))].join(delimiter);
}
/** Build the Host environment that makes confirmed managed tools visible to model shell calls. */
function withPresetRuntimeEnvironment(environment, homeDirectory, platform = process.platform) {
	const paths = presetRuntimePaths(homeDirectory);
	const extra = platform === "darwin" ? [
		join(homeDirectory, ".local/bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin"
	] : [];
	return {
		...environment,
		PATH: uniquePathEntries([
			paths.bin,
			environment.PATH,
			...extra
		]),
		NODE_PATH: uniquePathEntries([join(paths.packages, "node_modules"), environment.NODE_PATH]),
		PLAYWRIGHT_BROWSERS_PATH: paths.browsers
	};
}
function quotePosix(value) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
function quoteCmd(value) {
	return `"${value.replaceAll("\"", "\"\"")}"`;
}
async function writeCommandWrapper(paths, platform, name, command, args, electronRunAsNode = false) {
	await writeFileAtomic(join(paths.bin, platform === "win32" ? `${name}.cmd` : name), platform === "win32" ? `@echo off\r\n${electronRunAsNode ? "set \"ELECTRON_RUN_AS_NODE=1\"\r\n" : ""}${quoteCmd(command)}${args.map((value) => ` ${quoteCmd(value)}`).join("")} %*\r\n` : `#!/bin/sh\n${electronRunAsNode ? "export ELECTRON_RUN_AS_NODE='1'\n" : ""}exec ${quotePosix(command)}${args.map((value) => ` ${quotePosix(value)}`).join("")} "$@"\n`, {
		mode: 448,
		dirMode: 448
	});
}
function readPackageVersion(paths, packageName) {
	const manifest = join(paths.packages, "node_modules", ...packageName.split("/"), "package.json");
	if (!existsSync(manifest)) return void 0;
	try {
		const value = JSON.parse(readFileSync(manifest, "utf8"));
		return typeof value.version === "string" ? value.version : void 0;
	} catch {
		return;
	}
}
function installedBinaryPath(paths, packageName) {
	if (readPackageVersion(paths, packageName) === void 0) return void 0;
	const binary = createRequire(join(paths.packages, "package.json"))(packageName)?.path;
	if (typeof binary !== "string") throw new Error(`${packageName} did not expose its installed binary`);
	const absolute = resolve(binary);
	const rel = relative(resolve(paths.packages, "node_modules"), absolute);
	if (rel.startsWith("..") || rel === "") throw new Error(`${packageName} resolved outside the managed runtime`);
	if (!existsSync(absolute)) throw new Error(`${packageName} binary is missing`);
	return absolute;
}
function availableInstalledBinary(paths, packageName) {
	try {
		return installedBinaryPath(paths, packageName);
	} catch {
		return;
	}
}
function managedPythonExecutable(paths, platform) {
	return platform === "win32" ? join(paths.root, "python", "Scripts", "python.exe") : join(paths.root, "python", "bin", "python3");
}
function managedEnvironment(options, paths) {
	const platform = options.platform ?? process.platform;
	const source = withPresetRuntimeEnvironment(options.inheritedEnvironment ?? process.env, options.homeDirectory, platform);
	const env = {
		PATH: source.PATH,
		NODE_PATH: source.NODE_PATH,
		PLAYWRIGHT_BROWSERS_PATH: paths.browsers,
		HOME: options.homeDirectory,
		USERPROFILE: options.homeDirectory,
		LANG: "C.UTF-8",
		LC_ALL: "C.UTF-8",
		NO_COLOR: "1"
	};
	for (const key of platform === "win32" ? [
		"SystemRoot",
		"WINDIR",
		"COMSPEC",
		"PATHEXT",
		"TEMP",
		"TMP"
	] : ["TMPDIR"]) if (source[key] !== void 0) env[key] = source[key];
	if (options.electronRunAsNode) env.ELECTRON_RUN_AS_NODE = "1";
	return env;
}
var DesktopPresetRuntimeInstaller = class {
	options;
	paths;
	platform;
	processAdapter;
	env;
	constructor(options) {
		this.options = options;
		this.paths = presetRuntimePaths(options.homeDirectory);
		this.platform = options.platform ?? process.platform;
		this.processAdapter = options.processAdapter ?? nativeRuntimeProcess;
		this.env = managedEnvironment(options, this.paths);
	}
	async prepare() {
		await writeCommandWrapper(this.paths, this.platform, "node", this.options.nodeExecutable, [], this.options.electronRunAsNode);
		const hyperframes = join(this.paths.packages, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
		if (existsSync(hyperframes)) await writeCommandWrapper(this.paths, this.platform, "hyperframes", this.options.nodeExecutable, [hyperframes], this.options.electronRunAsNode);
		const ffmpeg = availableInstalledBinary(this.paths, "@ffmpeg-installer/ffmpeg");
		if (ffmpeg !== void 0) await writeCommandWrapper(this.paths, this.platform, "ffmpeg", ffmpeg, []);
		const ffprobe = availableInstalledBinary(this.paths, "@ffprobe-installer/ffprobe");
		if (ffprobe !== void 0) await writeCommandWrapper(this.paths, this.platform, "ffprobe", ffprobe, []);
		const python = managedPythonExecutable(this.paths, this.platform);
		if (existsSync(python)) {
			await writeCommandWrapper(this.paths, this.platform, "python3", python, []);
			await writeCommandWrapper(this.paths, this.platform, "python", python, []);
		}
	}
	async install(presetId, missing) {
		await this.preparePackageRoot();
		if (presetId === VIDEO_ID) await this.installVideo(missing);
		else await this.installReport(missing);
		await this.prepare();
	}
	async preparePackageRoot() {
		await mkdir(this.paths.packages, {
			recursive: true,
			mode: 448
		});
		const manifest = join(this.paths.packages, "package.json");
		let current = {};
		if (existsSync(manifest)) try {
			const parsed = JSON.parse(readFileSync(manifest, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) current = parsed;
		} catch {}
		delete current["pnpm"];
		await writeFileAtomic(manifest, `${JSON.stringify({
			...current,
			name: "@deepseek-harness/preset-runtime",
			version: "1.0.0",
			private: true
		}, null, 2)}\n`, {
			mode: 384,
			dirMode: 448
		});
	}
	async installVideo(missing) {
		if (missing.some((id) => id === "hyperframes" || id === "ffmpeg" || id === "ffprobe")) await this.installPackages([
			`hyperframes@${HYPERFRAMES_VERSION}`,
			`@ffmpeg-installer/ffmpeg@${FFMPEG_INSTALLER_VERSION}`,
			`@ffprobe-installer/ffprobe@${FFPROBE_INSTALLER_VERSION}`
		]);
	}
	async installReport(missing) {
		if (missing.some((id) => id === "echarts" || id === "playwright" || id === "chromium")) await this.installPackages([`echarts@${ECHARTS_VERSION}`, `playwright@${PLAYWRIGHT_VERSION}`]);
		if (missing.includes("openpyxl")) {
			const python = await this.resolvePython();
			if (python === void 0) throw new Error("Python is required before openpyxl can be installed");
			const managedPython = managedPythonExecutable(this.paths, this.platform);
			if (!existsSync(managedPython)) await this.runRequired(python.command, [
				...python.prefix,
				"-m",
				"venv",
				join(this.paths.root, "python")
			]);
			await this.runRequired(managedPython, [
				"-m",
				"pip",
				"install",
				"--disable-pip-version-check",
				"--no-input",
				`openpyxl==${OPENPYXL_VERSION}`
			]);
		}
		if (missing.includes("chromium")) {
			const cli = join(this.paths.packages, "node_modules", "playwright", "cli.js");
			if (!existsSync(cli)) throw new Error("Playwright CLI is missing after package installation");
			await this.runRequired(this.options.nodeExecutable, [
				cli,
				"install",
				"chromium"
			]);
		}
	}
	async installPackages(specifiers) {
		const result = await this.processAdapter.run({
			command: this.options.nodeExecutable,
			args: [
				this.options.packageManagerEntry,
				"add",
				"--save-exact",
				...TRUSTED_BUILD_PACKAGES.map((packageName) => `--allow-build=${packageName}`),
				"--config.shared-workspace-lockfile=false",
				"--config.manage-package-manager-versions=false",
				"--reporter=append-only",
				"--store-dir",
				this.paths.store,
				"--registry",
				PACKAGE_MANAGER_REGISTRY,
				"--",
				...specifiers
			],
			cwd: this.paths.packages,
			env: this.env
		});
		if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Package installation failed");
	}
	async resolvePython() {
		for (const candidate of this.platform === "win32" ? [{
			command: "py",
			prefix: ["-3"]
		}, {
			command: "python",
			prefix: []
		}] : [{
			command: "python3",
			prefix: []
		}, {
			command: "python",
			prefix: []
		}]) try {
			if ((await this.processAdapter.run({
				command: candidate.command,
				args: [...candidate.prefix, "--version"],
				env: this.env,
				timeoutMs: 1e4
			})).code === 0) return candidate;
		} catch {}
	}
	async runRequired(command, args) {
		const result = await this.processAdapter.run({
			command,
			args,
			env: this.env
		});
		if (result.code !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || "Runtime installation failed");
	}
};
function initialDependencies(presetId) {
	return (presetId === VIDEO_ID ? [
		"node",
		"hyperframes",
		"ffmpeg",
		"ffprobe"
	] : [
		"node",
		"python",
		"openpyxl",
		"echarts",
		"playwright",
		"chromium"
	]).map((id) => ({
		id,
		state: "missing",
		installable: id !== "python",
		version: null
	}));
}
function versionText(output) {
	return output.trim().split(/\r?\n/u)[0]?.slice(0, 120) || null;
}
/** Own one-at-a-time installation and monotonic runtime snapshots for bundled Presets. */
var PresetRuntimeController = class {
	options;
	paths;
	platform;
	processAdapter;
	installer;
	env;
	now;
	snapshots = /* @__PURE__ */ new Map();
	checks = /* @__PURE__ */ new Map();
	activeInstall;
	revision = 0;
	constructor(options) {
		this.options = options;
		this.paths = presetRuntimePaths(options.homeDirectory);
		this.platform = options.platform ?? process.platform;
		this.processAdapter = options.processAdapter ?? nativeRuntimeProcess;
		this.installer = options.installer ?? new DesktopPresetRuntimeInstaller(options);
		this.env = managedEnvironment(options, this.paths);
		this.now = options.now ?? Date.now;
	}
	/** Detect every required dependency without changing package state. */
	check(presetId) {
		const existing = this.checks.get(presetId);
		if (existing !== void 0) return existing;
		if (this.activeInstall?.presetId === presetId && this.snapshots.get(presetId)?.phase === "installing") return Promise.resolve(this.snapshots.get(presetId));
		this.publish(presetId, "checking", this.snapshots.get(presetId)?.dependencies ?? initialDependencies(presetId));
		const operation = this.inspect(presetId).then((dependencies) => {
			return this.publish(presetId, dependencies.every((item) => item.state === "ready") ? "ready" : "missing", dependencies);
		}).finally(() => {
			this.checks.delete(presetId);
		});
		this.checks.set(presetId, operation);
		return operation;
	}
	/** Install the fixed missing dependency set after renderer confirmation, then verify again. */
	install(presetId) {
		if (this.activeInstall?.presetId === presetId) return this.activeInstall.promise;
		if (this.activeInstall !== void 0) return this.activeInstall.promise.then(() => this.install(presetId));
		const operation = this.check(presetId).then(async (checked) => {
			if (checked.phase === "ready" || !checked.canInstall) return checked;
			const missing = checked.dependencies.filter((item) => item.state !== "ready" && item.installable);
			this.publish(presetId, "installing", checked.dependencies.map((item) => missing.some((candidate) => candidate.id === item.id) ? {
				...item,
				state: "installing"
			} : item));
			try {
				await this.installer.install(presetId, missing.map((item) => item.id));
				const dependencies = await this.inspect(presetId);
				return this.publish(presetId, dependencies.every((item) => item.state === "ready") ? "ready" : "missing", dependencies);
			} catch {
				const current = this.snapshots.get(presetId)?.dependencies ?? checked.dependencies;
				return this.publish(presetId, "failed", current.map((item) => item.state === "installing" ? {
					...item,
					state: "failed"
				} : item));
			}
		}).finally(() => {
			if (this.activeInstall?.promise === operation) this.activeInstall = void 0;
		});
		this.activeInstall = {
			presetId,
			promise: operation
		};
		return operation;
	}
	async inspect(presetId) {
		try {
			await this.installer.prepare();
		} catch {}
		return presetId === VIDEO_ID ? await this.inspectVideo() : await this.inspectReport();
	}
	async inspectVideo() {
		const node = await this.probeNode();
		const hyperframesCli = join(this.paths.packages, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
		const hyperframes = readPackageVersion(this.paths, "hyperframes") === HYPERFRAMES_VERSION && existsSync(hyperframesCli) ? HYPERFRAMES_VERSION : void 0;
		const ffmpeg = await this.probe(availableInstalledBinary(this.paths, "@ffmpeg-installer/ffmpeg") ?? "ffmpeg", ["-version"]);
		const ffprobe = await this.probe(availableInstalledBinary(this.paths, "@ffprobe-installer/ffprobe") ?? "ffprobe", ["-version"]);
		return [
			this.dependency("node", node, true),
			this.dependency("hyperframes", hyperframes, true),
			this.dependency("ffmpeg", ffmpeg, true),
			this.dependency("ffprobe", ffprobe, true)
		];
	}
	async inspectReport() {
		const node = await this.probeNode();
		const python = await this.resolvePython();
		const openpyxl = python === void 0 ? void 0 : await this.probe(python.command, [
			...python.prefix,
			"-c",
			"import openpyxl; print(openpyxl.__version__)"
		]);
		const echarts = readPackageVersion(this.paths, "echarts") === ECHARTS_VERSION ? ECHARTS_VERSION : void 0;
		const playwright = readPackageVersion(this.paths, "playwright") === PLAYWRIGHT_VERSION ? PLAYWRIGHT_VERSION : void 0;
		const chromium = this.chromiumVersion();
		return [
			this.dependency("node", node, true),
			this.dependency("python", python?.version, false),
			this.dependency("openpyxl", openpyxl, python !== void 0),
			this.dependency("echarts", echarts, true),
			this.dependency("playwright", playwright, true),
			this.dependency("chromium", chromium, true)
		];
	}
	async probeNode() {
		return await this.probe(this.options.nodeExecutable, ["--version"]);
	}
	async resolvePython() {
		for (const candidate of this.platform === "win32" ? [{
			command: "py",
			prefix: ["-3"]
		}, {
			command: "python",
			prefix: []
		}] : [{
			command: "python3",
			prefix: []
		}, {
			command: "python",
			prefix: []
		}]) {
			const version = await this.probe(candidate.command, [...candidate.prefix, "--version"]);
			if (version !== void 0) return {
				...candidate,
				version
			};
		}
	}
	chromiumVersion() {
		if (readPackageVersion(this.paths, "playwright") !== PLAYWRIGHT_VERSION) return void 0;
		try {
			const executable = (createRequire(join(this.paths.packages, "package.json"))("playwright")?.chromium)?.executablePath?.();
			return typeof executable === "string" && existsSync(executable) ? "installed" : void 0;
		} catch {
			return;
		}
	}
	async probe(command, args) {
		try {
			const result = await this.processAdapter.run({
				command,
				args,
				env: this.env,
				timeoutMs: 15e3
			});
			if (result.code !== 0) return void 0;
			return versionText(result.stdout || result.stderr) ?? void 0;
		} catch {
			return;
		}
	}
	dependency(id, version, installable) {
		return {
			id,
			state: version === void 0 ? "missing" : "ready",
			installable,
			version: version ?? null
		};
	}
	publish(presetId, phase, dependencies) {
		const snapshot = Object.freeze({
			presetId,
			phase,
			dependencies: Object.freeze(dependencies.map((item) => Object.freeze({ ...item }))),
			canInstall: dependencies.some((item) => item.state !== "ready" && item.installable),
			revision: ++this.revision,
			updatedAt: new Date(this.now()).toISOString()
		});
		this.snapshots.set(presetId, snapshot);
		return snapshot;
	}
};
//#endregion
//#region lib/types/main.js
/** Electron application shell for the loopback DeepSeek Harness Web Host. */
const APP_NAME = "DeepSeek Harness";
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 920;
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(DESKTOP_DIR, "../..");
let mainWindow;
let tray;
let host;
let lifecycle;
let bootQuitPromise;
let quitReleased = false;
let updateController;
let pluginOperationController;
let pluginRecoveryController;
let pluginDiagnosticExporter;
let pluginOwnedDataRemover;
let presetRuntimeController;
let pluginRecoveryStartupBlocked = false;
/** Resolve artifacts from the checkout in development and resourcesPath when packaged. */
function hostPaths() {
	if (!app.isPackaged) {
		const packageManager = join(DESKTOP_DIR, "runtime/node_modules/pnpm");
		return {
			nodeExecutable: process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? "node",
			cliEntry: join(REPOSITORY_ROOT, "apps/cli/lib/bin.js"),
			cliManifest: join(REPOSITORY_ROOT, "apps/cli/package.json"),
			hostManifest: join(DESKTOP_DIR, "runtime/package.json"),
			shippedBundleManifests: [
				join(REPOSITORY_ROOT, "packages/bundle/base/package.json"),
				join(REPOSITORY_ROOT, "packages/bundle/web-app/package.json"),
				join(REPOSITORY_ROOT, "packages/examples/ff-llm-wiki-plugin/package.json")
			],
			packageManagerEntry: join(packageManager, "bin/pnpm.cjs"),
			packageManagerManifest: join(packageManager, "package.json"),
			cwd: process.cwd(),
			electronRunAsNode: false
		};
	}
	const hostModules = join(process.resourcesPath, "host/node_modules");
	return {
		nodeExecutable: process.execPath,
		cliEntry: join(hostModules, "@deepseek-ai/dsh/lib/bin.js"),
		cliManifest: join(hostModules, "@deepseek-ai/dsh/package.json"),
		hostManifest: join(process.resourcesPath, "host/package.json"),
		shippedBundleManifests: [
			join(hostModules, "@deepseek-ai/dsh-base/package.json"),
			join(hostModules, "@deepseek-ai/dsh-web-app/package.json"),
			join(hostModules, "@fufan/dsh-plugin-llm-wiki/package.json")
		],
		packageManagerEntry: join(hostModules, "pnpm/bin/pnpm.cjs"),
		packageManagerManifest: join(hostModules, "pnpm/package.json"),
		cwd: app.getPath("home"),
		electronRunAsNode: true
	};
}
const BUILT_IN_APPLICATION_BUNDLES = ["@fufan/dsh-plugin-llm-wiki"];
function assertHostArtifacts(paths) {
	if (paths.nodeExecutable.includes("/") && !existsSync(paths.nodeExecutable)) throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`);
	if (!existsSync(paths.cliEntry)) throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`);
	if (!existsSync(paths.packageManagerEntry)) throw new Error(`desktop package-manager entry is missing: ${paths.packageManagerEntry}`);
	for (const manifest of [
		paths.cliManifest,
		paths.hostManifest,
		paths.packageManagerManifest,
		...paths.shippedBundleManifests
	]) if (!existsSync(manifest)) throw new Error(`desktop Host manifest is missing: ${manifest}`);
}
function currentHostOrigin() {
	return host?.current?.origin;
}
function recoveryPageUrl() {
	return pathToFileURL(app.isPackaged ? join(process.resourcesPath, "desktop-resources/recovery.html") : join(DESKTOP_DIR, "resources/recovery.html")).href;
}
function bundledPresetRoot() {
	return app.isPackaged ? join(process.resourcesPath, "desktop-resources/preset-square/presets") : join(DESKTOP_DIR, "resources/preset-square/presets");
}
function isRecoveryPageUrl(raw) {
	try {
		const actual = new URL(raw);
		const expected = new URL(recoveryPageUrl());
		return actual.protocol === "file:" && actual.pathname === expected.pathname;
	} catch {
		return false;
	}
}
async function loadWindowHost(window, origin, primaryPage) {
	await window.loadURL(desktopRendererUrl({
		origin,
		platform: process.platform,
		...primaryPage === void 0 ? {} : { primaryPage },
		previousUrl: window.webContents.getURL()
	}));
}
async function holdCurrentWindowFrame(window) {
	if (window.isDestroyed()) return void 0;
	const snapshot = await window.webContents.capturePage();
	if (snapshot.isEmpty() || window.isDestroyed()) return void 0;
	const { width, height } = window.getContentBounds();
	const held = new WebContentsView({ webPreferences: {
		contextIsolation: true,
		nodeIntegration: false,
		sandbox: true
	} });
	held.setBounds({
		x: 0,
		y: 0,
		width,
		height
	});
	held.setBackgroundColor("#111318");
	const document = [
		"<!doctype html><meta charset=\"utf-8\">",
		"<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:\">",
		"<style>html,body,img{width:100%;height:100%;margin:0;overflow:hidden}img{display:block}</style>",
		`<img alt="" src="${snapshot.toDataURL()}">`
	].join("");
	try {
		await held.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
		if (window.isDestroyed()) {
			held.webContents.close();
			return;
		}
		window.contentView.addChildView(held);
	} catch (error) {
		if (!held.webContents.isDestroyed()) held.webContents.close();
		throw error;
	}
	return { release() {
		if (!window.isDestroyed()) window.contentView.removeChildView(held);
		if (!held.webContents.isDestroyed()) held.webContents.close();
	} };
}
async function reloadWindowHost(window, origin, primaryPage) {
	await reloadWithHeldFrame({
		holdCurrentFrame: async () => await holdCurrentWindowFrame(window),
		navigate: async () => {
			await loadWindowHost(window, origin, primaryPage);
		},
		waitForPaint: async () => {
			await Promise.race([window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"), new Promise((resolvePaint) => {
				setTimeout(resolvePaint, 250);
			})]);
		},
		reportTransitionFailure: (error) => {
			console.warn("desktop held-frame reload transition failed:", error);
		}
	});
}
function manifestVersion(path) {
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	if (typeof manifest.version !== "string") throw new Error(`${path} has no version`);
	return manifest.version;
}
function manifestDependencyNames(path) {
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	if (typeof manifest.dependencies !== "object" || manifest.dependencies === null || Array.isArray(manifest.dependencies)) throw new Error(`${path} has no dependency map`);
	const dependencies = Object.entries(manifest.dependencies);
	for (const [name, version] of dependencies) if (name === "" || typeof version !== "string") throw new Error(`${path} has an invalid dependency map`);
	return new Set(dependencies.map(([name]) => name));
}
/** Load the app-local tray template, with an empty fallback for incomplete staging. */
function trayImage() {
	const path = (app.isPackaged ? [join(process.resourcesPath, "desktop-resources/trayTemplate.png")] : [join(DESKTOP_DIR, "resources/trayTemplate.png")]).find((candidate) => existsSync(candidate));
	const image = path === void 0 ? nativeImage.createEmpty() : nativeImage.createFromPath(path);
	if (process.platform === "darwin") image.setTemplateImage(true);
	return image;
}
function isExternalUrl(raw) {
	try {
		const url = new URL(raw);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
function hasOrigin(raw, expected) {
	try {
		return new URL(raw).origin === expected;
	} catch {
		return false;
	}
}
/** Install navigation and permission policy before the first renderer loads. */
function hardenSession() {
	const desktopSession = session.defaultSession;
	desktopSession.setPermissionCheckHandler(() => false);
	desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
		callback(false);
	});
}
async function createMainWindow() {
	const origin = currentHostOrigin();
	const recoveryMode = pluginRecoveryStartupBlocked;
	if (!recoveryMode && origin === void 0) throw new Error("desktop Host is not ready");
	const window = new BrowserWindow({
		width: WINDOW_WIDTH,
		height: WINDOW_HEIGHT,
		minWidth: 960,
		minHeight: 640,
		show: false,
		autoHideMenuBar: true,
		frame: process.platform === "win32",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
		...process.platform === "darwin" ? {} : { titleBarOverlay: {
			color: "#00000000",
			symbolColor: "#7f858f",
			height: 44
		} },
		...process.platform === "darwin" ? {
			trafficLightPosition: {
				x: 16,
				y: 18
			},
			vibrancy: "sidebar",
			visualEffectState: "followWindow"
		} : {},
		...process.platform === "win32" ? {
			backgroundMaterial: "acrylic",
			hasShadow: true,
			roundedCorners: true,
			thickFrame: true
		} : {
			transparent: true,
			backgroundColor: "#00000000"
		},
		title: APP_NAME,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			preload: join(DESKTOP_DIR, "lib/preload.cjs")
		}
	});
	mainWindow = window;
	window.on("close", (event) => {
		lifecycle?.onWindowClose(event);
	});
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = void 0;
	});
	window.webContents.on("will-navigate", (event, url) => {
		const currentOrigin = currentHostOrigin();
		if (isRecoveryPageUrl(url) || currentOrigin !== void 0 && hasOrigin(url, currentOrigin)) return;
		event.preventDefault();
		if (isExternalUrl(url)) shell.openExternal(url);
	});
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (isExternalUrl(url)) shell.openExternal(url);
		return { action: "deny" };
	});
	if (recoveryMode) await window.loadURL(recoveryPageUrl());
	else if (origin !== void 0) await loadWindowHost(window, origin);
	if (!lifecycle?.isQuitting) window.show();
	return window;
}
/** Register the closed renderer bridge after Electron app paths are available. */
function registerDesktopBridge() {
	const userDataDirectory = app.getPath("userData");
	const appearance = new AppearanceStorage(userDataDirectory);
	const paths = hostPaths();
	const hostProvidedModules = manifestDependencyNames(paths.hostManifest);
	const catalog = new NpmEcosystemCatalogRepository(new CatalogCache(userDataDirectory, [...hostProvidedModules]), fetch, Date.now, userDataDirectory, hostProvidedModules);
	const presetSquare = new PresetSquareClient(fetch, Date.now, currentHostOrigin, new ResourcePresetSquareCatalog(bundledPresetRoot()));
	presetRuntimeController = new PresetRuntimeController({
		homeDirectory: resolveDshHome(),
		nodeExecutable: paths.nodeExecutable,
		packageManagerEntry: paths.packageManagerEntry,
		electronRunAsNode: paths.electronRunAsNode
	});
	const systemComponents = deriveProtectedSystemComponents(paths.shippedBundleManifests);
	const readFingerprint = (selection, activeOperation) => readProfileCompatibilityFingerprint({
		homeDirectory: resolveDshHome(),
		profileName: "web",
		desktopVersion: app.getVersion(),
		dshVersion: manifestVersion(paths.cliManifest),
		nodeVersion: process.versions.node,
		os: process.platform,
		architecture: process.arch,
		catalogEtag: selection.etag,
		catalogFreshness: selection.freshness,
		candidates: selection.candidates,
		systemComponents,
		activeOperation
	});
	const compatibility = new PluginCompatibilityService(catalog, (selection) => readFingerprint(selection, pluginOperationController?.active ?? false));
	const transactionCompatibility = new PluginCompatibilityService(catalog, (selection) => readFingerprint(selection, false));
	const { autoUpdater } = electronUpdater;
	updateController = new DesktopUpdateController(autoUpdater, app.getVersion(), app.isPackaged);
	updateController.subscribe((state) => {
		for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.updatesState, state);
	});
	ipcMain.handle(DESKTOP_CHANNELS.appearanceGet, () => appearance.read());
	ipcMain.handle(DESKTOP_CHANNELS.appearanceSave, (_event, value) => appearance.save(value));
	ipcMain.handle(DESKTOP_CHANNELS.appearanceReset, () => appearance.reset());
	ipcMain.handle(DESKTOP_CHANNELS.updatesGet, () => updateController?.getState());
	ipcMain.handle(DESKTOP_CHANNELS.updatesCheck, () => updateController?.check());
	ipcMain.handle(DESKTOP_CHANNELS.updatesDownload, () => updateController?.download());
	ipcMain.handle(DESKTOP_CHANNELS.updatesInstall, async () => {
		if (updateController?.getState().phase !== "ready") throw new Error("desktop update is not ready to install");
		await host?.shutdown();
		quitReleased = true;
		tray?.destroy();
		tray = void 0;
		updateController.install();
	});
	const assertDesktopSender = (event) => {
		assertDesktopRequestOwner({
			senderId: event.sender.id,
			senderFrameUrl: event.senderFrame?.url
		}, {
			webContentsId: mainWindow?.webContents.id ?? -1,
			origin: currentHostOrigin()
		});
	};
	ipcMain.handle(DESKTOP_CHANNELS.workspacePickDirectory, async (event) => {
		assertDesktopSender(event);
		const owner = mainWindow;
		if (owner === void 0 || owner.isDestroyed()) throw new Error("Desktop window is unavailable");
		const result = await dialog.showOpenDialog(owner, { properties: ["openDirectory", "createDirectory"] });
		return result.canceled ? null : result.filePaths[0] ?? null;
	});
	const assertRecoverySender = (event) => {
		const url = event.senderFrame?.url ?? "";
		const origin = currentHostOrigin();
		if (event.sender.id !== mainWindow?.webContents.id || !isRecoveryPageUrl(url) && (origin === void 0 || !hasOrigin(url, origin))) throw new Error("plugin recovery request did not originate from the owned Desktop window");
	};
	ipcMain.handle(DESKTOP_CHANNELS.catalogList, (event, value) => {
		assertDesktopSender(event);
		return catalog.list(decodeCatalogListQuery(value));
	});
	ipcMain.handle(DESKTOP_CHANNELS.catalogRefresh, async (event, value) => {
		assertDesktopSender(event);
		const query = decodeCatalogListQuery(value);
		return await catalog.refresh(query);
	});
	ipcMain.handle(DESKTOP_CHANNELS.catalogDetail, (event, value) => {
		assertDesktopSender(event);
		return catalog.detail(decodeCatalogDetailQuery(value));
	});
	ipcMain.handle(DESKTOP_CHANNELS.catalogCheckCompatibility, (event, value) => {
		assertDesktopSender(event);
		return compatibility.check(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquareList, (event, value) => {
		assertDesktopSender(event);
		return presetSquare.list(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquareDetail, (event, value) => {
		assertDesktopSender(event);
		return presetSquare.detail(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquarePreviewInstall, (event, value) => {
		assertDesktopSender(event);
		return presetSquare.previewInstall(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquareInstall, (event, value) => {
		assertDesktopSender(event);
		return presetSquare.install(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquareRuntimeCheck, (event, value) => {
		assertDesktopSender(event);
		const request = decodePresetRuntimeRequest(value);
		if (presetRuntimeController === void 0) throw new Error("Preset runtime controller is unavailable");
		return presetRuntimeController.check(request.presetId);
	});
	ipcMain.handle(DESKTOP_CHANNELS.presetSquareRuntimeInstall, (event, value) => {
		assertDesktopSender(event);
		const request = decodePresetRuntimeRequest(value);
		if (presetRuntimeController === void 0) throw new Error("Preset runtime controller is unavailable");
		return presetRuntimeController.install(request.presetId);
	});
	ipcMain.handle(DESKTOP_CHANNELS.installedPluginsList, async (event) => {
		assertDesktopSender(event);
		const authority = await catalog.installedAuthority();
		const fingerprint = readFingerprint({
			candidate: null,
			candidates: authority.preflights,
			etag: authority.etag,
			freshness: authority.freshness
		}, pluginOperationController?.active ?? false);
		const generation = host?.current;
		const runtimeEvidence = generation === void 0 ? null : await new PluginRuntimeVerifier().readEvidence(generation.origin).catch(() => null);
		return deriveInstalledPluginProjection({
			profileDirectory: join(resolveDshHome(), "profiles", "web"),
			installAnchor: paths.cliManifest,
			fingerprint,
			catalog: authority,
			systemComponents,
			runtimeEvidence,
			operation: pluginOperationController?.getOperation() ?? null
		});
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginOperationGet, (event) => {
		assertDesktopSender(event);
		return pluginOperationController?.getOperation() ?? null;
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginOperationStart, async (event, value) => {
		assertDesktopSender(event);
		if (pluginRecoveryStartupBlocked) throw new Error("plugin recovery must finish before another operation can start");
		const controller = pluginOperationController;
		if (controller === void 0) throw new Error("plugin operation controller is unavailable");
		return typeof value === "object" && value !== null && "action" in value ? await controller.manage(value) : await controller.start(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataGetOffer, async (event) => {
		assertDesktopSender(event);
		const remover = pluginOwnedDataRemover;
		if (remover === void 0) throw new Error("plugin-owned data remover is unavailable");
		return await remover.currentOffer();
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataRemove, async (event, value) => {
		assertDesktopSender(event);
		const remover = pluginOwnedDataRemover;
		if (remover === void 0) throw new Error("plugin-owned data remover is unavailable");
		return await remover.remove(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataRetain, async (event, value) => {
		assertDesktopSender(event);
		const remover = pluginOwnedDataRemover;
		if (remover === void 0) throw new Error("plugin-owned data remover is unavailable");
		return await remover.retain(value);
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginRecoveryGet, (event) => {
		assertRecoverySender(event);
		return pluginRecoveryController?.getSnapshot() ?? null;
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginRecoveryRetry, async (event, value) => {
		assertRecoverySender(event);
		const request = decodePluginRecoveryRetryRequest(value);
		const recovery = pluginRecoveryController;
		if (recovery === void 0) throw new Error("plugin recovery controller is unavailable");
		const result = await recovery.retry(request.operationId);
		if (result?.phase === "rolled-back") {
			pluginRecoveryStartupBlocked = false;
			const window = mainWindow;
			const origin = currentHostOrigin();
			if (window !== void 0 && !window.isDestroyed() && origin !== void 0) await loadWindowHost(window, origin, PLUGIN_CENTER_PAGE_ID);
		}
		return result;
	});
	ipcMain.handle(DESKTOP_CHANNELS.pluginRecoveryExport, async (event, value) => {
		assertRecoverySender(event);
		const request = decodePluginDiagnosticExportRequest(value);
		const exporter = pluginDiagnosticExporter;
		if (exporter === void 0) throw new Error("plugin recovery diagnostics are unavailable");
		return await exporter.export(request.operationId, async (defaultFilename) => {
			const options = {
				title: "导出插件恢复诊断",
				defaultPath: defaultFilename,
				filters: [{
					name: "JSON",
					extensions: ["json"]
				}]
			};
			const result = mainWindow === void 0 ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(mainWindow, options);
			return result.canceled ? null : result.filePath;
		});
	});
	return {
		catalog,
		transactionCompatibility,
		readTransactionFingerprint: (selection) => readFingerprint(selection, false),
		systemComponents,
		paths
	};
}
/** Assemble the trusted install, management, and startup-recovery backend. */
async function initializePluginOperations(backend) {
	const currentHost = host;
	const currentLifecycle = lifecycle;
	if (currentHost === void 0 || currentLifecycle === void 0) throw new Error("plugin operation backend requires the current Host and window lifecycle");
	const dshHome = resolveDshHome();
	const profileDirectory = join(dshHome, "profiles", "web");
	const root = join(app.getPath("userData"), "plugin-center");
	const operationsDirectory = join(root, "operations");
	const journal = new PluginOperationJournal(join(root, "journal"));
	const snapshotStore = new ProfileSnapshotStore(profileDirectory, join(root, "snapshots"));
	const ownedDataAuthorityStore = new PluginOwnedDataAuthorityStore(join(root, "owned-data-authority"));
	const profileLock = new ProfileMutationLock(profileDirectory);
	const runtimeVerifier = new PluginRuntimeVerifier();
	const packageManager = {
		executable: backend.paths.nodeExecutable,
		packageManagerEntry: backend.paths.packageManagerEntry,
		profileDirectory,
		storeDirectory: join(app.getPath("userData"), "plugin-store"),
		homeDirectory: app.getPath("home"),
		electronRunAsNode: backend.paths.electronRunAsNode,
		platform: process.platform
	};
	const recovery = new PluginRecoveryController({
		journal,
		snapshotStore,
		profileLock,
		packageManager,
		host: currentHost,
		runtimeVerifier,
		reloadHost: (origin) => currentLifecycle.reloadHost(origin, PLUGIN_CENTER_PAGE_ID)
	});
	pluginRecoveryController = recovery;
	pluginDiagnosticExporter = new PluginRecoveryDiagnosticExporter(journal);
	pluginOwnedDataRemover = new PluginOwnedDataRemover(join(app.getPath("userData"), "plugin-data"), journal, ownedDataAuthorityStore);
	recovery.subscribe((snapshot) => {
		for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.pluginRecoveryState, snapshot);
	});
	const sharedExecutorOptions = {
		compatibility: backend.transactionCompatibility,
		platform: resolveSupportedPluginPlatform(process.platform, process.arch),
		downloader: new PluginArtifactDownloader(operationsDirectory),
		profileLock,
		snapshotStore,
		ownedDataAuthorityStore,
		packageManager,
		profileDirectory,
		installAnchor: backend.paths.cliManifest,
		host: currentHost,
		reloadHost: (origin) => currentLifecycle.reloadHost(origin, PLUGIN_CENTER_PAGE_ID),
		runtimeVerifier,
		postFingerprint: backend.readTransactionFingerprint
	};
	const installRunner = createTrustedInstallRunner(sharedExecutorOptions);
	const managementRunner = createTrustedManagementRunner(sharedExecutorOptions);
	const controller = new PluginOperationController(journal, (request, controls) => request.action === "install" ? installRunner(request, controls) : managementRunner(request, controls), () => snapshotStore.identity(), async (failureCode) => {
		await recovery.recoverOpen(failureCode);
	});
	const startup = await preparePluginCenterStartup({
		journal,
		recovery,
		startNormalHost: async () => {
			const webProfileBundles = PROFILE_TEMPLATES["web"];
			if (webProfileBundles === void 0) throw new Error("web Profile template is unavailable");
			initProfile(profileDirectory, [...webProfileBundles, ...BUILT_IN_APPLICATION_BUNDLES]);
			reconcileBuiltInApplications(profileDirectory, BUILT_IN_APPLICATION_BUNDLES);
			for (const manifestPath of backend.paths.shippedBundleManifests) {
				const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
				if (manifest.name !== void 0 && BUILT_IN_APPLICATION_BUNDLES.includes(manifest.name)) healProfilesModuleFallback(manifestPath, dshHome);
			}
			const authority = await backend.catalog.installedAuthority();
			const selection = {
				candidate: null,
				candidates: authority.preflights,
				etag: authority.etag,
				freshness: authority.freshness
			};
			const compatibility = await reconcileApplicationUpdateCompatibility({
				profileDirectory,
				fingerprint: backend.readTransactionFingerprint(selection),
				candidates: authority.preflights
			});
			for (const item of compatibility.deactivated) console.warn(`disabled incompatible plugin before Host start: ${item.pluginId}@${item.version}`);
			return await currentHost.start();
		}
	});
	if (startup.recovery?.operationId !== "unreadable-journal") {
		await controller.initialize();
		controller.subscribe((operation) => {
			for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(DESKTOP_CHANNELS.pluginOperationState, operation);
		});
		pluginOperationController = controller;
	}
	return startup;
}
function createTray() {
	tray = new Tray(trayImage());
	tray.setToolTip(APP_NAME);
	tray.setContextMenu(Menu.buildFromTemplate([
		{
			label: "打开主窗口",
			click: () => {
				lifecycle?.showWindow();
			}
		},
		{ type: "separator" },
		{
			label: "退出",
			click: () => {
				requestAppQuit();
			}
		}
	]));
	tray.on("click", () => {
		lifecycle?.showWindow();
	});
}
function releaseAppQuit() {
	quitReleased = true;
	tray?.destroy();
	tray = void 0;
	app.quit();
}
/** Join explicit quit requests even while the Host or window is still starting. */
function requestAppQuit() {
	if (lifecycle !== void 0) return lifecycle.requestQuit();
	bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve()).catch((error) => {
		console.error("desktop shutdown failed:", error);
	}).then(() => {
		releaseAppQuit();
	});
	return bootQuitPromise;
}
async function boot() {
	if (bootQuitPromise !== void 0) return;
	const pluginCenter = registerDesktopBridge();
	const paths = pluginCenter.paths;
	assertHostArtifacts(paths);
	host = createHostSupervisor({
		spawnHost: () => spawnDshWeb({
			...paths,
			env: withPresetRuntimeEnvironment({
				...process.env,
				DSH_DESKTOP: "1"
			}, resolveDshHome())
		}),
		log: (chunk) => process.stderr.write(chunk),
		onUnexpectedExit: ({ code, signal }) => {
			console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`);
			requestAppQuit();
		}
	});
	hardenSession();
	lifecycle = createDesktopLifecycle({
		getWindow: () => mainWindow,
		createWindow: createMainWindow,
		loadHost: async (window, origin, primaryPage) => {
			await reloadWindowHost(window, origin, primaryPage);
		},
		disposeHost: async () => {
			await host?.shutdown();
		},
		quit: releaseAppQuit,
		reportError: (error) => {
			console.error("desktop shutdown failed:", error);
		}
	});
	pluginRecoveryStartupBlocked = (await initializePluginOperations(pluginCenter)).mode === "recovery-failed";
	createTray();
	await lifecycle.showWindow();
	if (app.isPackaged && !pluginRecoveryStartupBlocked) setTimeout(() => {
		updateController?.check();
	}, 5e3);
}
if (!app.requestSingleInstanceLock()) app.quit();
else if (isInstallerQuitRequest(process.argv)) app.quit();
else {
	app.on("second-instance", (_event, commandLine) => {
		if (isInstallerQuitRequest(commandLine)) {
			requestAppQuit();
			return;
		}
		lifecycle?.showWindow();
	});
	app.on("activate", () => {
		lifecycle?.showWindow();
	});
	app.on("window-all-closed", () => {});
	app.on("before-quit", (event) => {
		if (quitReleased) return;
		event.preventDefault();
		requestAppQuit();
	});
	app.whenReady().then(boot).catch(async (error) => {
		console.error("desktop startup failed:", error);
		if (bootQuitPromise === void 0) await dialog.showMessageBox({
			type: "error",
			title: `${APP_NAME} failed to start`,
			message: error instanceof Error ? error.message : String(error)
		});
		await requestAppQuit();
	});
}
//#endregion
export {};
