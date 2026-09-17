/** Electron application shell for the loopback DeepSeek Harness Web Host. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, WebContentsView, } from 'electron';
import electronUpdater from 'electron-updater';
import { healProfilesModuleFallback, initProfile, PROFILE_TEMPLATES, } from '@deepseek-ai/dsh-app-boot';
import { decodeCatalogDetailQuery, decodeCatalogListQuery, decodePluginDiagnosticExportRequest, decodePluginRecoveryRetryRequest, decodePresetRuntimeRequest, } from '@deepseek-ai/dsh-plugin-center-contracts';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { AppearanceStorage } from "./appearance-storage.js";
import { reconcileBuiltInApplications } from "./built-in-applications.js";
import { DESKTOP_CHANNELS } from "./desktop-bridge-contract.js";
import { createHostSupervisor, spawnDshWeb } from "./host-supervisor.js";
import { assertDesktopRequestOwner } from "./plugin-center/bridge-policy.js";
import { CatalogCache } from "./plugin-center/catalog-cache.js";
import { resolveSupportedPluginPlatform } from "./plugin-center/environment.js";
import { NpmEcosystemCatalogRepository } from "./plugin-center/npm-ecosystem-catalog.js";
import { PluginArtifactDownloader } from "./plugin-center/artifact-downloader.js";
import { reconcileApplicationUpdateCompatibility } from "./plugin-center/app-update-compatibility.js";
import { PluginRecoveryDiagnosticExporter } from "./plugin-center/diagnostic-export.js";
import { PluginOperationController } from "./plugin-center/operation-controller.js";
import { PluginOperationJournal, UNREADABLE_PLUGIN_JOURNAL_OPERATION_ID, } from "./plugin-center/operation-journal.js";
import { PluginRecoveryController } from "./plugin-center/recovery-controller.js";
import { ProfileMutationLock } from "./plugin-center/profile-lock.js";
import { ProfileSnapshotStore } from "./plugin-center/profile-snapshot-store.js";
import { PluginCompatibilityService } from "./plugin-center/preflight-service.js";
import { readProfileCompatibilityFingerprint } from "./plugin-center/profile-compatibility.js";
import { deriveInstalledPluginProjection } from "./plugin-center/installed-projection.js";
import { PluginOwnedDataAuthorityStore, PluginOwnedDataRemover, } from "./plugin-center/owned-data.js";
import { PluginRuntimeVerifier } from "./plugin-center/runtime-verifier.js";
import { preparePluginCenterStartup, } from "./plugin-center/startup-recovery.js";
import { deriveProtectedSystemComponents, } from "./plugin-center/system-components.js";
import { createTrustedInstallRunner } from "./plugin-center/trusted-install-executor.js";
import { createTrustedManagementRunner } from "./plugin-center/trusted-management-executor.js";
import { desktopRendererUrl, PLUGIN_CENTER_PAGE_ID } from "./renderer-navigation.js";
import { DesktopUpdateController } from "./update-controller.js";
import { createDesktopLifecycle, isInstallerQuitRequest, } from "./window-lifecycle.js";
import { reloadWithHeldFrame } from "./window-reload-transition.js";
import { PresetSquareClient } from "./preset-square/client.js";
import { ResourcePresetSquareCatalog } from "./preset-square/bundled-catalog.js";
import { PresetRuntimeController, withPresetRuntimeEnvironment, } from "./preset-square/runtime-controller.js";
const APP_NAME = 'DeepSeek Harness';
const WINDOW_WIDTH = 1440;
const WINDOW_HEIGHT = 920;
const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = resolve(DESKTOP_DIR, '../..');
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
        const packageManager = join(DESKTOP_DIR, 'runtime/node_modules/pnpm');
        return {
            nodeExecutable: process.env.DSH_DESKTOP_NODE_EXECUTABLE ?? 'node',
            cliEntry: join(REPOSITORY_ROOT, 'apps/cli/lib/bin.js'),
            cliManifest: join(REPOSITORY_ROOT, 'apps/cli/package.json'),
            hostManifest: join(DESKTOP_DIR, 'runtime/package.json'),
            shippedBundleManifests: [
                join(REPOSITORY_ROOT, 'packages/bundle/base/package.json'),
                join(REPOSITORY_ROOT, 'packages/bundle/web-app/package.json'),
                join(REPOSITORY_ROOT, 'packages/examples/ff-llm-wiki-plugin/package.json'),
            ],
            packageManagerEntry: join(packageManager, 'bin/pnpm.cjs'),
            packageManagerManifest: join(packageManager, 'package.json'),
            cwd: process.cwd(),
            electronRunAsNode: false,
        };
    }
    const hostModules = join(process.resourcesPath, 'host/node_modules');
    return {
        nodeExecutable: process.execPath,
        cliEntry: join(hostModules, '@deepseek-ai/dsh/lib/bin.js'),
        cliManifest: join(hostModules, '@deepseek-ai/dsh/package.json'),
        hostManifest: join(process.resourcesPath, 'host/package.json'),
        shippedBundleManifests: [
            join(hostModules, '@deepseek-ai/dsh-base/package.json'),
            join(hostModules, '@deepseek-ai/dsh-web-app/package.json'),
            join(hostModules, '@fufan/dsh-plugin-llm-wiki/package.json'),
        ],
        packageManagerEntry: join(hostModules, 'pnpm/bin/pnpm.cjs'),
        packageManagerManifest: join(hostModules, 'pnpm/package.json'),
        cwd: app.getPath('home'),
        electronRunAsNode: true,
    };
}
const BUILT_IN_APPLICATION_BUNDLES = ['@fufan/dsh-plugin-llm-wiki'];
function assertHostArtifacts(paths) {
    if (paths.nodeExecutable.includes('/') && !existsSync(paths.nodeExecutable)) {
        throw new Error(`desktop Node runtime is missing: ${paths.nodeExecutable}`);
    }
    if (!existsSync(paths.cliEntry)) {
        throw new Error(`desktop Host entry is missing: ${paths.cliEntry}; run pnpm run build first`);
    }
    if (!existsSync(paths.packageManagerEntry)) {
        throw new Error(`desktop package-manager entry is missing: ${paths.packageManagerEntry}`);
    }
    for (const manifest of [
        paths.cliManifest,
        paths.hostManifest,
        paths.packageManagerManifest,
        ...paths.shippedBundleManifests,
    ]) {
        if (!existsSync(manifest))
            throw new Error(`desktop Host manifest is missing: ${manifest}`);
    }
}
function currentHostOrigin() {
    return host?.current?.origin;
}
function recoveryPageUrl() {
    const path = app.isPackaged
        ? join(process.resourcesPath, 'desktop-resources/recovery.html')
        : join(DESKTOP_DIR, 'resources/recovery.html');
    return pathToFileURL(path).href;
}
function bundledPresetRoot() {
    return app.isPackaged
        ? join(process.resourcesPath, 'desktop-resources/preset-square/presets')
        : join(DESKTOP_DIR, 'resources/preset-square/presets');
}
function isRecoveryPageUrl(raw) {
    try {
        const actual = new URL(raw);
        const expected = new URL(recoveryPageUrl());
        return actual.protocol === 'file:' && actual.pathname === expected.pathname;
    }
    catch {
        return false;
    }
}
async function loadWindowHost(window, origin, primaryPage) {
    await window.loadURL(desktopRendererUrl({
        origin,
        platform: process.platform,
        ...(primaryPage === undefined ? {} : { primaryPage }),
        previousUrl: window.webContents.getURL(),
    }));
}
async function holdCurrentWindowFrame(window) {
    if (window.isDestroyed())
        return undefined;
    const snapshot = await window.webContents.capturePage();
    if (snapshot.isEmpty() || window.isDestroyed())
        return undefined;
    const { width, height } = window.getContentBounds();
    const held = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    held.setBounds({ x: 0, y: 0, width, height });
    held.setBackgroundColor('#111318');
    const document = [
        '<!doctype html><meta charset="utf-8">',
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">',
        '<style>html,body,img{width:100%;height:100%;margin:0;overflow:hidden}img{display:block}</style>',
        `<img alt="" src="${snapshot.toDataURL()}">`,
    ].join('');
    try {
        await held.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
        if (window.isDestroyed()) {
            held.webContents.close();
            return undefined;
        }
        window.contentView.addChildView(held);
    }
    catch (error) {
        if (!held.webContents.isDestroyed())
            held.webContents.close();
        throw error;
    }
    return {
        release() {
            if (!window.isDestroyed())
                window.contentView.removeChildView(held);
            if (!held.webContents.isDestroyed())
                held.webContents.close();
        },
    };
}
async function reloadWindowHost(window, origin, primaryPage) {
    await reloadWithHeldFrame({
        holdCurrentFrame: async () => await holdCurrentWindowFrame(window),
        navigate: async () => { await loadWindowHost(window, origin, primaryPage); },
        waitForPaint: async () => {
            await Promise.race([
                window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'),
                new Promise((resolvePaint) => { setTimeout(resolvePaint, 250); }),
            ]);
        },
        reportTransitionFailure: (error) => { console.warn('desktop held-frame reload transition failed:', error); },
    });
}
function manifestVersion(path) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof manifest.version !== 'string')
        throw new Error(`${path} has no version`);
    return manifest.version;
}
function manifestDependencyNames(path) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof manifest.dependencies !== 'object' || manifest.dependencies === null
        || Array.isArray(manifest.dependencies)) {
        throw new Error(`${path} has no dependency map`);
    }
    const dependencies = Object.entries(manifest.dependencies);
    for (const [name, version] of dependencies) {
        if (name === '' || typeof version !== 'string')
            throw new Error(`${path} has an invalid dependency map`);
    }
    return new Set(dependencies.map(([name]) => name));
}
/** Load the app-local tray template, with an empty fallback for incomplete staging. */
function trayImage() {
    const candidates = app.isPackaged
        ? [join(process.resourcesPath, 'desktop-resources/trayTemplate.png')]
        : [join(DESKTOP_DIR, 'resources/trayTemplate.png')];
    const path = candidates.find(candidate => existsSync(candidate));
    const image = path === undefined ? nativeImage.createEmpty() : nativeImage.createFromPath(path);
    if (process.platform === 'darwin')
        image.setTemplateImage(true);
    return image;
}
function isExternalUrl(raw) {
    try {
        const url = new URL(raw);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
function hasOrigin(raw, expected) {
    try {
        return new URL(raw).origin === expected;
    }
    catch {
        return false;
    }
}
/** Install navigation and permission policy before the first renderer loads. */
function hardenSession() {
    const desktopSession = session.defaultSession;
    desktopSession.setPermissionCheckHandler(() => false);
    desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false); });
}
async function createMainWindow() {
    const origin = currentHostOrigin();
    const recoveryMode = pluginRecoveryStartupBlocked;
    if (!recoveryMode && origin === undefined)
        throw new Error('desktop Host is not ready');
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        minWidth: 960,
        minHeight: 640,
        show: false,
        autoHideMenuBar: true,
        frame: process.platform === 'win32',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
        ...(process.platform === 'darwin' ? {} : {
            titleBarOverlay: {
                color: '#00000000',
                symbolColor: '#7f858f',
                height: 44,
            },
        }),
        ...(process.platform === 'darwin' ? {
            trafficLightPosition: { x: 16, y: 18 },
            vibrancy: 'sidebar',
            visualEffectState: 'followWindow',
        } : {}),
        ...(process.platform === 'win32' ? {
            backgroundMaterial: 'acrylic',
            hasShadow: true,
            roundedCorners: true,
            thickFrame: true,
        } : {
            transparent: true,
            backgroundColor: '#00000000',
        }),
        title: APP_NAME,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            preload: join(DESKTOP_DIR, 'lib/preload.cjs'),
        },
    });
    mainWindow = window;
    window.on('close', (event) => { lifecycle?.onWindowClose(event); });
    window.on('closed', () => {
        if (mainWindow === window)
            mainWindow = undefined;
    });
    window.webContents.on('will-navigate', (event, url) => {
        const currentOrigin = currentHostOrigin();
        if (isRecoveryPageUrl(url) || (currentOrigin !== undefined && hasOrigin(url, currentOrigin)))
            return;
        event.preventDefault();
        if (isExternalUrl(url))
            void shell.openExternal(url);
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (isExternalUrl(url))
            void shell.openExternal(url);
        return { action: 'deny' };
    });
    if (recoveryMode)
        await window.loadURL(recoveryPageUrl());
    else if (origin !== undefined)
        await loadWindowHost(window, origin);
    if (!lifecycle?.isQuitting)
        window.show();
    return window;
}
/** Register the closed renderer bridge after Electron app paths are available. */
function registerDesktopBridge() {
    const userDataDirectory = app.getPath('userData');
    const appearance = new AppearanceStorage(userDataDirectory);
    const paths = hostPaths();
    const hostProvidedModules = manifestDependencyNames(paths.hostManifest);
    const catalog = new NpmEcosystemCatalogRepository(new CatalogCache(userDataDirectory, [...hostProvidedModules]), fetch, Date.now, userDataDirectory, hostProvidedModules);
    const presetSquare = new PresetSquareClient(fetch, Date.now, currentHostOrigin, new ResourcePresetSquareCatalog(bundledPresetRoot()));
    presetRuntimeController = new PresetRuntimeController({
        homeDirectory: resolveDshHome(),
        nodeExecutable: paths.nodeExecutable,
        packageManagerEntry: paths.packageManagerEntry,
        electronRunAsNode: paths.electronRunAsNode,
    });
    const systemComponents = deriveProtectedSystemComponents(paths.shippedBundleManifests);
    const readFingerprint = (selection, activeOperation) => readProfileCompatibilityFingerprint({
        homeDirectory: resolveDshHome(),
        profileName: 'web',
        desktopVersion: app.getVersion(),
        dshVersion: manifestVersion(paths.cliManifest),
        nodeVersion: process.versions.node,
        os: process.platform,
        architecture: process.arch,
        catalogEtag: selection.etag,
        catalogFreshness: selection.freshness,
        candidates: selection.candidates,
        systemComponents,
        activeOperation,
    });
    const compatibility = new PluginCompatibilityService(catalog, selection => readFingerprint(selection, pluginOperationController?.active ?? false));
    const transactionCompatibility = new PluginCompatibilityService(catalog, selection => readFingerprint(selection, false));
    const { autoUpdater } = electronUpdater;
    updateController = new DesktopUpdateController(autoUpdater, app.getVersion(), app.isPackaged);
    updateController.subscribe((state) => {
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed())
                window.webContents.send(DESKTOP_CHANNELS.updatesState, state);
        }
    });
    ipcMain.handle(DESKTOP_CHANNELS.appearanceGet, () => appearance.read());
    ipcMain.handle(DESKTOP_CHANNELS.appearanceSave, (_event, value) => appearance.save(value));
    ipcMain.handle(DESKTOP_CHANNELS.appearanceReset, () => appearance.reset());
    ipcMain.handle(DESKTOP_CHANNELS.updatesGet, () => updateController?.getState());
    ipcMain.handle(DESKTOP_CHANNELS.updatesCheck, () => updateController?.check());
    ipcMain.handle(DESKTOP_CHANNELS.updatesDownload, () => updateController?.download());
    ipcMain.handle(DESKTOP_CHANNELS.updatesInstall, async () => {
        if (updateController?.getState().phase !== 'ready')
            throw new Error('desktop update is not ready to install');
        await host?.shutdown();
        quitReleased = true;
        tray?.destroy();
        tray = undefined;
        updateController.install();
    });
    const assertDesktopSender = (event) => {
        assertDesktopRequestOwner({
            senderId: event.sender.id,
            senderFrameUrl: event.senderFrame?.url,
        }, {
            webContentsId: mainWindow?.webContents.id ?? -1,
            origin: currentHostOrigin(),
        });
    };
    ipcMain.handle(DESKTOP_CHANNELS.workspacePickDirectory, async (event) => {
        assertDesktopSender(event);
        const owner = mainWindow;
        if (owner === undefined || owner.isDestroyed())
            throw new Error('Desktop window is unavailable');
        const result = await dialog.showOpenDialog(owner, {
            properties: ['openDirectory', 'createDirectory'],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    const assertRecoverySender = (event) => {
        const url = event.senderFrame?.url ?? '';
        const origin = currentHostOrigin();
        if (event.sender.id !== mainWindow?.webContents.id
            || (!isRecoveryPageUrl(url) && (origin === undefined || !hasOrigin(url, origin)))) {
            throw new Error('plugin recovery request did not originate from the owned Desktop window');
        }
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
        if (presetRuntimeController === undefined)
            throw new Error('Preset runtime controller is unavailable');
        return presetRuntimeController.check(request.presetId);
    });
    ipcMain.handle(DESKTOP_CHANNELS.presetSquareRuntimeInstall, (event, value) => {
        assertDesktopSender(event);
        const request = decodePresetRuntimeRequest(value);
        if (presetRuntimeController === undefined)
            throw new Error('Preset runtime controller is unavailable');
        return presetRuntimeController.install(request.presetId);
    });
    ipcMain.handle(DESKTOP_CHANNELS.installedPluginsList, async (event) => {
        assertDesktopSender(event);
        const authority = await catalog.installedAuthority();
        const fingerprint = readFingerprint({
            candidate: null,
            candidates: authority.preflights,
            etag: authority.etag,
            freshness: authority.freshness,
        }, pluginOperationController?.active ?? false);
        const generation = host?.current;
        const runtimeEvidence = generation === undefined
            ? null
            : await new PluginRuntimeVerifier().readEvidence(generation.origin).catch(() => null);
        return deriveInstalledPluginProjection({
            profileDirectory: join(resolveDshHome(), 'profiles', 'web'),
            installAnchor: paths.cliManifest,
            fingerprint,
            catalog: authority,
            systemComponents,
            runtimeEvidence,
            operation: pluginOperationController?.getOperation() ?? null,
        });
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginOperationGet, (event) => {
        assertDesktopSender(event);
        return pluginOperationController?.getOperation() ?? null;
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginOperationStart, async (event, value) => {
        assertDesktopSender(event);
        if (pluginRecoveryStartupBlocked)
            throw new Error('plugin recovery must finish before another operation can start');
        const controller = pluginOperationController;
        if (controller === undefined)
            throw new Error('plugin operation controller is unavailable');
        return typeof value === 'object' && value !== null && 'action' in value
            ? await controller.manage(value)
            : await controller.start(value);
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataGetOffer, async (event) => {
        assertDesktopSender(event);
        const remover = pluginOwnedDataRemover;
        if (remover === undefined)
            throw new Error('plugin-owned data remover is unavailable');
        return await remover.currentOffer();
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataRemove, async (event, value) => {
        assertDesktopSender(event);
        const remover = pluginOwnedDataRemover;
        if (remover === undefined)
            throw new Error('plugin-owned data remover is unavailable');
        return await remover.remove(value);
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginOwnedDataRetain, async (event, value) => {
        assertDesktopSender(event);
        const remover = pluginOwnedDataRemover;
        if (remover === undefined)
            throw new Error('plugin-owned data remover is unavailable');
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
        if (recovery === undefined)
            throw new Error('plugin recovery controller is unavailable');
        const result = await recovery.retry(request.operationId);
        if (result?.phase === 'rolled-back') {
            pluginRecoveryStartupBlocked = false;
            const window = mainWindow;
            const origin = currentHostOrigin();
            if (window !== undefined && !window.isDestroyed() && origin !== undefined) {
                await loadWindowHost(window, origin, PLUGIN_CENTER_PAGE_ID);
            }
        }
        return result;
    });
    ipcMain.handle(DESKTOP_CHANNELS.pluginRecoveryExport, async (event, value) => {
        assertRecoverySender(event);
        const request = decodePluginDiagnosticExportRequest(value);
        const exporter = pluginDiagnosticExporter;
        if (exporter === undefined)
            throw new Error('plugin recovery diagnostics are unavailable');
        return await exporter.export(request.operationId, async (defaultFilename) => {
            const options = {
                title: '导出插件恢复诊断',
                defaultPath: defaultFilename,
                filters: [{ name: 'JSON', extensions: ['json'] }],
            };
            const result = mainWindow === undefined
                ? await dialog.showSaveDialog(options)
                : await dialog.showSaveDialog(mainWindow, options);
            return result.canceled ? null : result.filePath;
        });
    });
    return {
        catalog,
        transactionCompatibility,
        readTransactionFingerprint: selection => readFingerprint(selection, false),
        systemComponents,
        paths,
    };
}
/** Assemble the trusted install, management, and startup-recovery backend. */
async function initializePluginOperations(backend) {
    const currentHost = host;
    const currentLifecycle = lifecycle;
    if (currentHost === undefined || currentLifecycle === undefined) {
        throw new Error('plugin operation backend requires the current Host and window lifecycle');
    }
    const dshHome = resolveDshHome();
    const profileDirectory = join(dshHome, 'profiles', 'web');
    const root = join(app.getPath('userData'), 'plugin-center');
    const operationsDirectory = join(root, 'operations');
    const journal = new PluginOperationJournal(join(root, 'journal'));
    const snapshotStore = new ProfileSnapshotStore(profileDirectory, join(root, 'snapshots'));
    const ownedDataAuthorityStore = new PluginOwnedDataAuthorityStore(join(root, 'owned-data-authority'));
    const profileLock = new ProfileMutationLock(profileDirectory);
    const runtimeVerifier = new PluginRuntimeVerifier();
    const packageManager = {
        executable: backend.paths.nodeExecutable,
        packageManagerEntry: backend.paths.packageManagerEntry,
        profileDirectory,
        storeDirectory: join(app.getPath('userData'), 'plugin-store'),
        homeDirectory: app.getPath('home'),
        electronRunAsNode: backend.paths.electronRunAsNode,
        platform: process.platform,
    };
    const recovery = new PluginRecoveryController({
        journal,
        snapshotStore,
        profileLock,
        packageManager,
        host: currentHost,
        runtimeVerifier,
        reloadHost: origin => currentLifecycle.reloadHost(origin, PLUGIN_CENTER_PAGE_ID),
    });
    pluginRecoveryController = recovery;
    pluginDiagnosticExporter = new PluginRecoveryDiagnosticExporter(journal);
    pluginOwnedDataRemover = new PluginOwnedDataRemover(join(app.getPath('userData'), 'plugin-data'), journal, ownedDataAuthorityStore);
    recovery.subscribe((snapshot) => {
        for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed())
                window.webContents.send(DESKTOP_CHANNELS.pluginRecoveryState, snapshot);
        }
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
        postFingerprint: backend.readTransactionFingerprint,
    };
    const installRunner = createTrustedInstallRunner(sharedExecutorOptions);
    const managementRunner = createTrustedManagementRunner(sharedExecutorOptions);
    const controller = new PluginOperationController(journal, (request, controls) => request.action === 'install'
        ? installRunner(request, controls)
        : managementRunner(request, controls), () => snapshotStore.identity(), async (failureCode) => { await recovery.recoverOpen(failureCode); });
    const startup = await preparePluginCenterStartup({
        journal,
        recovery,
        startNormalHost: async () => {
            const webProfileBundles = PROFILE_TEMPLATES['web'];
            if (webProfileBundles === undefined)
                throw new Error('web Profile template is unavailable');
            initProfile(profileDirectory, [...webProfileBundles, ...BUILT_IN_APPLICATION_BUNDLES]);
            reconcileBuiltInApplications(profileDirectory, BUILT_IN_APPLICATION_BUNDLES);
            for (const manifestPath of backend.paths.shippedBundleManifests) {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                if (manifest.name !== undefined && BUILT_IN_APPLICATION_BUNDLES.includes(manifest.name)) {
                    healProfilesModuleFallback(manifestPath, dshHome);
                }
            }
            const authority = await backend.catalog.installedAuthority();
            const selection = {
                candidate: null,
                candidates: authority.preflights,
                etag: authority.etag,
                freshness: authority.freshness,
            };
            const compatibility = await reconcileApplicationUpdateCompatibility({
                profileDirectory,
                fingerprint: backend.readTransactionFingerprint(selection),
                candidates: authority.preflights,
            });
            for (const item of compatibility.deactivated) {
                console.warn(`disabled incompatible plugin before Host start: ${item.pluginId}@${item.version}`);
            }
            return await currentHost.start();
        },
    });
    if (startup.recovery?.operationId !== UNREADABLE_PLUGIN_JOURNAL_OPERATION_ID) {
        await controller.initialize();
        controller.subscribe((operation) => {
            for (const window of BrowserWindow.getAllWindows()) {
                if (!window.isDestroyed())
                    window.webContents.send(DESKTOP_CHANNELS.pluginOperationState, operation);
            }
        });
        pluginOperationController = controller;
    }
    return startup;
}
function createTray() {
    tray = new Tray(trayImage());
    tray.setToolTip(APP_NAME);
    const template = [
        { label: '打开主窗口', click: () => { void lifecycle?.showWindow(); } },
        { type: 'separator' },
        { label: '退出', click: () => { void requestAppQuit(); } },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
    tray.on('click', () => { void lifecycle?.showWindow(); });
}
function releaseAppQuit() {
    quitReleased = true;
    tray?.destroy();
    tray = undefined;
    app.quit();
}
/** Join explicit quit requests even while the Host or window is still starting. */
function requestAppQuit() {
    if (lifecycle !== undefined)
        return lifecycle.requestQuit();
    bootQuitPromise ??= (host?.shutdown() ?? Promise.resolve()).catch((error) => {
        console.error('desktop shutdown failed:', error);
    }).then(() => {
        releaseAppQuit();
    });
    return bootQuitPromise;
}
async function boot() {
    if (bootQuitPromise !== undefined)
        return;
    const pluginCenter = registerDesktopBridge();
    const paths = pluginCenter.paths;
    assertHostArtifacts(paths);
    host = createHostSupervisor({
        spawnHost: () => spawnDshWeb({
            ...paths,
            env: withPresetRuntimeEnvironment({
                ...process.env,
                DSH_DESKTOP: '1',
            }, resolveDshHome()),
        }),
        log: chunk => process.stderr.write(chunk),
        onUnexpectedExit: ({ code, signal }) => {
            console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(signal)})`);
            void requestAppQuit();
        },
    });
    hardenSession();
    lifecycle = createDesktopLifecycle({
        getWindow: () => mainWindow,
        createWindow: createMainWindow,
        loadHost: async (window, origin, primaryPage) => {
            await reloadWindowHost(window, origin, primaryPage);
        },
        disposeHost: async () => { await host?.shutdown(); },
        quit: releaseAppQuit,
        reportError: (error) => { console.error('desktop shutdown failed:', error); },
    });
    const pluginStartup = await initializePluginOperations(pluginCenter);
    pluginRecoveryStartupBlocked = pluginStartup.mode === 'recovery-failed';
    createTray();
    await lifecycle.showWindow();
    if (app.isPackaged && !pluginRecoveryStartupBlocked) {
        setTimeout(() => { void updateController?.check(); }, 5_000);
    }
}
if (!app.requestSingleInstanceLock()) {
    app.quit();
}
else if (isInstallerQuitRequest(process.argv)) {
    app.quit();
}
else {
    app.on('second-instance', (_event, commandLine) => {
        if (isInstallerQuitRequest(commandLine)) {
            void requestAppQuit();
            return;
        }
        void lifecycle?.showWindow();
    });
    app.on('activate', () => { void lifecycle?.showWindow(); });
    app.on('window-all-closed', () => {
        // Tray and Host own application lifetime on every platform.
    });
    app.on('before-quit', (event) => {
        if (quitReleased)
            return;
        event.preventDefault();
        void requestAppQuit();
    });
    app.whenReady().then(boot).catch(async (error) => {
        console.error('desktop startup failed:', error);
        if (bootQuitPromise === undefined) {
            await dialog.showMessageBox({
                type: 'error',
                title: `${APP_NAME} failed to start`,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        await requestAppQuit();
    });
}
//# sourceMappingURL=main.js.map