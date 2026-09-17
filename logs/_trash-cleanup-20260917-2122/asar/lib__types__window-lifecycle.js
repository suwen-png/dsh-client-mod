/** Desktop window and application lifetime independent from Electron imports. */
/** Private command-line signal used by the Windows installer before replacing application files. */
export const INSTALLER_QUIT_ARGUMENT = '--dsh-installer-quit';
/**
 * Identify an installer-owned request without treating partial argument matches as authority to quit.
 * @param commandLine - Arguments supplied to the first or a subsequent Electron instance.
 * @returns Whether the exact private installer argument is present.
 */
export function isInstallerQuitRequest(commandLine) {
    return commandLine.includes(INSTALLER_QUIT_ARGUMENT);
}
/**
 * Create the desktop application lifecycle.
 * @param options - Native window access, Host teardown and quit release.
 * @returns A lifecycle whose Host outlives ordinary window closes.
 */
export function createDesktopLifecycle(options) {
    let quitting = false;
    let pendingQuit;
    let creatingWindow;
    const showWindow = async () => {
        if (quitting)
            return;
        let window = options.getWindow();
        if (window === undefined || window.isDestroyed()) {
            creatingWindow ??= options.createWindow().finally(() => { creatingWindow = undefined; });
            window = await creatingWindow;
        }
        if (!window.isVisible())
            window.show();
        window.focus();
    };
    const requestQuit = () => {
        if (pendingQuit !== undefined)
            return pendingQuit;
        quitting = true;
        pendingQuit = options.disposeHost().catch((error) => {
            options.reportError?.(error);
        }).then(() => {
            options.quit();
        });
        return pendingQuit;
    };
    const reloadHost = async (origin, primaryPage) => {
        if (quitting)
            return;
        const window = options.getWindow();
        if (window === undefined || window.isDestroyed())
            return;
        await options.loadHost(window, origin, primaryPage);
    };
    return {
        get isQuitting() { return quitting; },
        get pendingQuit() { return pendingQuit; },
        onWindowClose(event) {
            if (quitting)
                return;
            event.preventDefault();
            options.getWindow()?.hide();
        },
        showWindow,
        reloadHost,
        requestQuit,
    };
}
//# sourceMappingURL=window-lifecycle.js.map