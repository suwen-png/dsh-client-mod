filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到旧的文件存储检测逻辑，替换为新的
old_start = '// V9.3: 文件存储检测（最可靠的持久化方式，直接写JSON文件）'
old_end = 'function safeDirectorKey(sessionId) {'

start_idx = content.find(old_start)
end_idx = content.find(old_end)

if start_idx >= 0 and end_idx >= 0 and end_idx > start_idx:
    new_code = '''// V10: 文件存储检测（最可靠的持久化方式，直接写JSON文件）
		let directorFs = null;
		let directorPath = null;
		let directorStoreFile = null;
		try {
			// V10: 更可靠地检测Electron Node.js环境
			let nodeRequire = null;
			// 方式1: window.require (Electron nodeIntegration)
			if (typeof window !== "undefined" && typeof window.require === "function") {
				try { const test = window.require("fs"); if (test && test.readFileSync) { nodeRequire = window.require; } } catch (e) {}
			}
			// 方式2: global.require (Electron)
			if (!nodeRequire && typeof global !== "undefined" && typeof global.require === "function") {
				try { const test = global.require("fs"); if (test && test.readFileSync) { nodeRequire = global.require; } } catch (e) {}
			}
			// 方式3: electron.remote.require
			if (!nodeRequire && typeof process !== "undefined" && process.versions && process.versions.electron && typeof window !== "undefined" && typeof window.require === "function") {
				try {
					const electron = window.require("electron");
					if (electron && electron.remote && typeof electron.remote.require === "function") {
						nodeRequire = electron.remote.require;
					}
				} catch (e) {}
			}
			if (nodeRequire) {
				directorFs = nodeRequire("fs");
				directorPath = nodeRequire("path");
				const appData = (typeof process !== "undefined" && process.env) ? (process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || ".") : ".";
				const dir = directorPath.join(appData, "dsh-director");
				if (!directorFs.existsSync(dir)) directorFs.mkdirSync(dir, { recursive: true });
				directorStoreFile = directorPath.join(dir, "director-store.json");
				// 验证写入
				try {
					directorFs.writeFileSync(directorStoreFile, "{}", "utf-8");
					const verify = directorFs.readFileSync(directorStoreFile, "utf-8");
					if (verify === "{}") {
						if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.log("persist", "V10 file storage available (verified): " + directorStoreFile);
					} else {
						if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "V10 file storage verify failed: " + directorStoreFile);
						directorFs = null;
					}
				} catch (e) {
					if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "V10 file storage write test failed: " + e.message);
					directorFs = null;
				}
			} else {
				if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "V10 file storage: nodeRequire not available, isElectron=" + (typeof process !== "undefined" && process.versions && !!process.versions.electron) + ", fallback to localStorage/IndexedDB");
			}
		} catch (e) {
			if (typeof window !== "undefined" && window.__dshDebug) window.__dshDebug.warn("persist", "V10 file storage init failed: " + e.message + ", fallback to localStorage/IndexedDB");
			directorFs = null;
		}
		'''
    content = content[:start_idx] + new_code + content[end_idx:]
    print('文件存储检测逻辑修改成功')
else:
    print('修改失败: 未找到目标字符串')
    print('start_idx:', start_idx, 'end_idx:', end_idx)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
