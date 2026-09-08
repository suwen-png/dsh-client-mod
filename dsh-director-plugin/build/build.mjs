/**
 * P1 构建脚本（P0 阶段不启用）：esbuild 打包 src/client-entry.js → lib/client.js。
 * 约束：
 *  - external = PLATFORM_MODULES（react/react/jsx-runtime/react-dom/react-dom/client/
 *    @deepseek-ai/cordis/@deepseek-ai/dsh-client-ui-slots/@deepseek-ai/dsh-client-web-react/
 *    @deepseek-ai/dsh-client-ui-primitives/@deepseek-ai/dsh-client-ui-attachment/
 *    @deepseek-ai/dsh-client-schema-form）+ dsh.client.inject 的包
 *  - 产物形态：window.__ModuleLoader__.load({ id, factory: (require) => {...} })
 *    （id 与 factory 包装的精确形态以 spike 实测 + conversation bundle 对照为准）
 *  - 严禁把 React 打进产物（双实例 = 崩溃源，ADR-001 风险的插件版）
 * 使用：npm i -D esbuild 后 node build/build.mjs
 */
console.log('[dsh-director-plugin] P0 阶段：lib/client.js 为手写 spike bundle；本脚本在 P1 启用。');
