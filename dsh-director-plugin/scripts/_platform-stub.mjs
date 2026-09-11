/**
 * _platform-stub.mjs — 离线验证用「平台模块桩」解析钩子
 *
 * 为什么需要：
 *   插件 src/ 以 ADR-001 约定把 `react` / `react/jsx-runtime` / `react-dom/client`
 *   声明为**平台冻结模块**，由宿主 factory 的 `require` 提供；本地**不安装** node_modules。
 *   离线验证脚本若要 `import("../src/mount.js")`，Node 会因为解析不到裸模块名而失败。
 *
 * 做法：注册同步 resolve 钩子，把这三个裸标识符重定向到 `_platform-stub-impl.mjs`。
 *   只替换解析目标，**不改动任何源码**，也不在插件目录创建 node_modules
 *   （避免污染安装包 / 影响 verify-install-clean 的 PAYLOAD_FILES 断言）。
 *
 * 用法：node --import ./scripts/_platform-stub.mjs scripts/verify-dialog.mjs
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(join(here, "_platform-stub-impl.mjs")).href;
const PLATFORM = new Set(["react", "react-dom", "react/jsx-runtime", "react-dom/client"]);

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (PLATFORM.has(specifier)) return { url: STUB, shortCircuit: true };
		return nextResolve(specifier, context);
	}
});
