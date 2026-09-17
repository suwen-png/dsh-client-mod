Directory: app.getPath("home"),
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
