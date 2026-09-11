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
	// ── 批次 1（零依赖，可先行）────────────────────────────────
	"store/layout.js": { block: "A11", src: "6439 ~ 6483", desc: "布局 store：小窗宽度/折叠/焦点（key=dsh.director.layout）" },
	"store/theme.js": { block: "A12", src: "6484 ~ 6537", desc: "V9-Design D-01 主题变量体系（CSS 令牌）" },
	"util/debug.js": { block: "A3+D3", src: "5799~5834 + 6854~6968", desc: "统一调试日志工具（取 D3 完整版，合并 A3 雏形）" },
	"config/model.js": { block: "C2", src: "6612 ~ 6702", desc: "配置与本地模型（Ollama :11434 / qwen2:7b）" },
	"dev/layout-probe.js": { block: "C1", src: "6542 ~ 6611", desc: "V9-Design 布局探针（AI 可读页面真实布局）" },

	// ── 批次 2（数据层）────────────────────────────────────────
	"store/messages.js": { block: "A1", src: "5495 ~ 5723", desc: "总监消息 store（directorStores + prefix）" },
	"store/branch.js": { block: "A4", src: "5835 ~ 5963", desc: "分支创建 + 记忆面板交互（__dshCreateBranch）" },
	"store/memory.js": { block: "A2", src: "5724 ~ 5798", desc: "V9 记忆体系 CRUD" },
	"store/docs.js": { block: "A5", src: "5966 ~ 6035", desc: "docs store（依赖 A14 剥离完成）" },
	"store/docs-index-inject.js": { block: "A13", src: "6538 ~ 6541", desc: "DSH_DOCS_INDEX 注入壳（window.__dshDocsIndex）" },

	// ── 批次 3（持久化，高风险）────────────────────────────────
	"store/file-adapter.js": { block: "A6", src: "6036 ~ 6214", desc: "🔴 Electron 文件通道三法探测（依赖 T5 spike）" },
	"store/persist.js": { block: "A7+A8", src: "6215 ~ 6326", desc: "loadDirectorStore/saveDirectorStore（key=director-main）" },
	"store/create-store.js": { block: "A9", src: "6327 ~ 6403", desc: "createDirectorStore 工厂" },
	"store/use-store.js": { block: "A10", src: "6404 ~ 6438", desc: "useDirectorStore hook（useSyncExternalStore）" },

	// ── 批次 4（逻辑层）────────────────────────────────────────
	"logic/process.js": { block: "D1", src: "6703 ~ 6816", desc: "🔴 directorProcess 总监消息处理主链路" },
	"logic/review.js": { block: "D2", src: "6817 ~ 6853", desc: "对话返回审核" },

	// ── 批次 5（组件层）────────────────────────────────────────
	"components/DirectorFlow.jsx": { block: "E1", src: "6969 ~ 7082", desc: "🔴 DirectorFlow 小窗组件（a-2/b-2 共用）" },
	// ⛔ components/DirectorView/ —— 已废弃（2026-09-08 随 MOD-B 退坡删除，墓志铭见 8897 行）

	// ── 批次 6（接线与退坡）────────────────────────────────────
	"bridge/globals.js": { block: "F3+F4", src: "11760 ~ 11814", desc: "window.__directorSubmit + __directChatSubmit（同一 if 块）" },
	"bridge/input-router.js": { block: "F1+F2", src: "3543~3583 + 3795~3812", desc: "🔴 宿主输入框分流（宿主留 shim，不可迁移）" },
	"bridge/view-sync.js": { block: "G1+G4", src: "7105~7116 + 9141~9146", desc: "🔴 宿主注入点（__directorCurrentView 写操作，R7）" },
	"bridge/spike-fs-probe.js": { block: "T5", src: "—", desc: "R3 风险验证脚本（本文件已就绪）" },
};

export const SKELETON_VERSION = "v1-20260911";
