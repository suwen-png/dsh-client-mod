filepath = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 找到文件存储检测的开始和结束
old_start = '// V10: 文件存储检测（最可靠的持久化方式，直接写JSON文件）'
old_end = 'function safeDirectorKey(sessionId) {'

start_idx = content.find(old_start)
end_idx = content.find(old_end)

if start_idx >= 0 and end_idx >= 0 and end_idx > start_idx:
    new_code = '''// V10: 文件存储检测（最可靠的持久化方式，直接写JSON文件）
		// 注意：此处__dshDebug尚未初始化，必须用console.log
		let directorFs = null;
		let directorPath = null;
		let directorStoreFile = null;
		console.log("[DSH:persist] V10 file storage detection start");
		try {
			// 检测环境
			const hasWindow = typeof window !== "undefined";
			const hasProcess = typeof process !== "undefined";
			const isElectron = hasProcess && process.versions && !!process.versions.electron;
			const hasWindowRequire = hasWindow && typeof window.require === "function";
			const hasGlobalRequire = typeof global !== "undefined" && typeof global.require === "function";
			console.log("[DSH:persist] env: hasWindow=" + hasWindow + " hasProcess=" + hasProcess + " isElectron=" + isElectron + " hasWindowRequire=" + hasWindowRequire + " hasGlobalRequire=" + hasGlobalRequire);
			
			let nodeRequire = null;
			// 方式1: window.require (Electron nodeIntegration)
			if (hasWindowRequire) {
				try {
					const test = window.require("fs");
					if (test && test.readFileSync) {
						nodeRequire = window.require;
						console.log("[DSH:persist] method1 window.require success");
					} else {
						console.log("[DSH:persist] method1 window.require returned invalid fs");
					}
				} catch (e) {
					console.log("[DSH:persist] method1 window.require failed: " + e.message);
				}
			}
			// 方式2: global.require (Electron)
			if (!nodeRequire && hasGlobalRequire) {
				try {
					const test = global.require("fs");
					if (test && test.readFileSync) {
						nodeRequire = global.require;
						console.log("[DSH:persist] method2 global.require success");
					} else {
						console.log("[DSH:persist] method2 global.require returned invalid fs");
					}
				} catch (e) {
					console.log("[DSH:persist] method2 global.require failed: " + e.message);
				}
			}
			// 方式3: electron.remote.require
			if (!nodeRequire && isElectron && hasWindowRequire) {
				try {
					const electron = window.require("electron");
					if (electron && electron.remote && typeof electron.remote.require === "function") {
						nodeRequire = electron.remote.require;
						console.log("[DSH:persist] method3 electron.remote.require success");
					} else {
						console.log("[DSH:persist] method3 electron.remote not available");
					}
				} catch (e) {
					console.log("[DSH:persist] method3 electron.remote failed: " + e.message);
				}
			}
			
			if (nodeRequire) {
				directorFs = nodeRequire("fs");
				directorPath = nodeRequire("path");
				const appData = hasProcess && process.env ? (process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || ".") : ".";
				const dir = directorPath.join(appData, "dsh-director");
				if (!directorFs.existsSync(dir)) directorFs.mkdirSync(dir, { recursive: true });
				directorStoreFile = directorPath.join(dir, "director-store.json");
				console.log("[DSH:persist] file path: " + directorStoreFile);
				// 验证写入
				try {
					directorFs.writeFileSync(directorStoreFile, "{}", "utf-8");
					const verify = directorFs.readFileSync(directorStoreFile, "utf-8");
					if (verify === "{}") {
						console.log("[DSH:persist] V10 file storage available (verified): " + directorStoreFile);
					} else {
						console.log("[DSH:persist] V10 file storage verify failed: " + directorStoreFile);
						directorFs = null;
					}
				} catch (e) {
					console.log("[DSH:persist] V10 file storage write test failed: " + e.message);
					directorFs = null;
				}
			} else {
				console.log("[DSH:persist] V10 file storage: nodeRequire not available, isElectron=" + isElectron + ", fallback to localStorage/IndexedDB");
			}
		} catch (e) {
			console.log("[DSH:persist] V10 file storage init failed: " + e.message + ", fallback to localStorage/IndexedDB");
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
