rc="${snapshot.toDataURL()}">`
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
		reloadHost