/**
 * _platform-modules.mjs — 平台模块桩表的**唯一真相源**
 *
 * 为什么要有这个文件（2026-09-13）：
 *   「在 __ModuleLoader__ 桩里执行 client bundle factory」这件事，`verify-bundle.mjs`
 *   和 `verify-install.mjs` 都要做，于是**各写了一份 react 桩**。
 *   2026-09-12 产物里出现 `class SafeLayer extends react.Component`（单层错误边界），
 *   而 `verify-bundle` 那份桩缺 `Component` ⇒ factory 抛
 *   `Class extends value undefined is not a constructor or null` ⇒ 其后 44 项断言
 *   **全部级联失败**，报告读起来像「插件整个坏了」，真因只是测试桩少了一个基类。
 *   当时只修了 `verify-bundle` 一处（改为 import 共享桩），
 *   `verify-install` 那份**内联的**照旧漂移 ⇒ **同一个坑在同一天踩了第二次**
 *   （见 `logs/` 与本文件 §防复发）。
 *
 * 纪律：**桩这类测试基础设施也只能有一份**。凡需在桩内执行 bundle 的脚本，
 *   一律 `import { platformStub } from "./_platform-modules.mjs"`，不许内联。
 *   守护闸门：`scripts/lint-platform-stub.mjs`（L2 断言"零内联 react 桩"）。
 *
 * 契约来源：`@deepseek-ai/dsh-client-web/lib/index.js:165` 的 `getStaticModules()`（10 项）。
 * 🔴 本文件不参与构建、不随插件分发（package.json 的 files 不含 scripts/）。
 */
import * as reactStub from "./_platform-stub-impl.mjs";

/** 官方 `getStaticModules()` 的 10 项，逐项给出替身。 */
export const platformStub = {
	"react": reactStub,
	"react/jsx-runtime": {
		Fragment: reactStub.Fragment, jsx: reactStub.jsx, jsxs: reactStub.jsxs, jsxDEV: reactStub.jsxDEV
	},
	"react-dom": {},
	"react-dom/client": { createRoot: reactStub.createRoot, hydrateRoot: reactStub.hydrateRoot },
	"@deepseek-ai/cordis": {},
	"@deepseek-ai/dsh-client-ui-slots": {},
	"@deepseek-ai/dsh-client-web-react": {},
	"@deepseek-ai/dsh-client-ui-primitives": {},
	"@deepseek-ai/dsh-client-ui-attachment": {},
	"@deepseek-ai/dsh-client-schema-form": {}
};

export { reactStub };
