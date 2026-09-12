/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：src/ 骨架的目录索引（导航用）
 * 引用：批次 1 · 批次 2
 * 上游：（无：插件入口层）
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * index.js — src/ 骨架的目录索引（导航用）
 *
 * 本文件不参与构建，仅供人工/AI 快速定位「哪块代码在哪个文件」。
 * **权威定义在 `docs/01-插件迁移明细清单.md`**，本文件与清单冲突时以清单为准。
 *
 * 基准：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *        11,998 行 / 1,479,577 B / mtime 2026-09-08 13:14:11
 */

export const SRC_MAP = {
	// ── 批次 1（零依赖）✅ 已完成迁移 2026-09-11 ────────────────
	"store/layout.js": { block: "A11", src: "6439 ~ 6483", status: "✅", desc: "布局 store：小窗宽度/折叠/焦点（key=dsh.director.layout）" },
	"store/theme.js": { block: "A12", src: "6484 ~ 6537", status: "✅", desc: "V9-Design D-01 主题变量体系（CSS 令牌）" },
	"util/debug.js": { block: "D3", src: "6857 ~ 6971", status: "✅", desc: "统一调试日志工具（含滚动探针/dumpState/导出）" },
	"util/log-collector.js": { block: "A3", src: "5799 ~ 5834", status: "✅", desc: "专用 Log 收集器（window.__dshV9Log）" },
	"config/model.js": { block: "C2", src: "6615 ~ 6705", status: "✅", desc: "配置与本地模型（Ollama :11434 / qwen2:7b）" },
	"store/docs-index-inject.js": { block: "A13+A14", src: "6538 ~ 6544 + 剥离", status: "✅", desc: "文档索引运行时加载（替代 541KB 内联常量）" },
	"dev/layout-probe.js": { block: "C1", src: "6545 ~ 6614", status: "✅", desc: "V9-Design 布局探针（AI 可读页面真实布局）" },

	// ── 批次 2（数据层）✅ 已完成迁移 2026-09-11 ────────────────
	"store/messages.js": { block: "A1", src: "5495 ~ 5723", status: "✅", desc: "总监消息 store（directorStores + prefix）" },
	"store/memory.js": { block: "A2", src: "5724 ~ 5798", status: "✅", desc: "V9 记忆体系 CRUD（window.__dshMemory）" },
	"store/branch.js": { block: "A4", src: "5835 ~ 5963", status: "✅", desc: "分支创建 + 记忆面板交互（4 契约 + dshEscapeHTML 防 XSS）" },
	"store/docs.js": { block: "A5", src: "5966 ~ 6035", status: "✅", desc: "docs store（DIRECTOR_DOC_TYPES + 种子数据 + 订阅）" },
	"store/cookie.js": { block: "V10", src: "（宿主内散落）", status: "✅", desc: "Cookie 分块存储（3KB/块 + _meta 校验，降级兜底）" },
	"store/idb.js": { block: "V9", src: "（宿主内散落）", status: "✅", desc: "IndexedDB 持久化主层（dsh-director-db v3 / 6 store）" },

	// ── 批次 3（持久化，高风险）⬜ ──────────────────────────────
	"store/file-adapter.js": { block: "A6", src: "6036 ~ 6214", status: "⬜", desc: "🔴 Electron 文件通道三法探测（依赖 T5 spike）" },
	"store/persist.js": { block: "A7+A8", src: "6215 ~ 6326", status: "⬜", desc: "loadDirectorStore/saveDirectorStore（key=director-main）" },
	"store/create-store.js": { block: "A9", src: "6327 ~ 6403", status: "⬜", desc: "createDirectorStore 工厂" },
	"store/use-store.js": { block: "A10", src: "6404 ~ 6438", status: "⬜", desc: "useDirectorStore hook（useSyncExternalStore）" },

	// ── 批次 4（逻辑层）⬜ ──────────────────────────────────────
	"logic/process.js": { block: "D1", src: "6706 ~ 6819", status: "⬜", desc: "🔴 directorProcess 总监消息处理主链路" },
	"logic/review.js": { block: "D2", src: "6820 ~ 6856", status: "⬜", desc: "对话返回审核" },

	// ── 批次 5（组件层）⬜ ──────────────────────────────────────
	"components/DirectorFlow.jsx": { block: "E1", src: "6972 ~ 7085", status: "⬜", desc: "🔴 DirectorFlow 小窗组件（a-2/b-2 共用）" },
	// ⛔ components/DirectorView/ —— 已废弃（2026-09-08 随 MOD-B 退坡删除，墓志铭 client.js:8900）

	// ── 批次 6（接线与退坡）⬜ ──────────────────────────────────
	"bridge/globals.js": { block: "F3+F4", src: "11763 ~ 11817", status: "⬜", desc: "window.__directorSubmit + __directChatSubmit（同一 if 块）" },
	"bridge/input-router.js": { block: "F1+F2", src: "3543~3583 + 3795~3812", status: "⬜", desc: "🔴 宿主输入框分流（宿主留 shim，不可迁移）" },
	"bridge/view-sync.js": { block: "G1+G4", src: "7108~7119 + 9144~9149", status: "⬜", desc: "🔴 宿主注入点（__directorCurrentView 写操作，R7）" },
};

export const SKELETON_VERSION = "v3-20260911-batch2closed";
