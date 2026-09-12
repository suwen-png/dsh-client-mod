/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：R3 风险验证（T5）
 * 引用：—
 * 上游：（无：插件入口层）
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * spike-fs-probe.js — R3 风险验证（T5）
 *
 * 目的：验证「插件通道（cordis bundle factory 内）」能否访问 Electron 文件通道。
 *
 * 背景（见《插件迁移明细清单》§四 R3 + §一 A6）：
 *   宿主内联实现（client.js 6036~6214）用三法探测 fs：
 *     ① window.require            （client.js :6135）
 *     ② global.require            （client.js :6149）
 *     ③ electron.remote.require   （client.js :6163）
 *   插件 bundle 在 __ModuleLoader__.load({id, factory(require)}) 内执行，
 *   其 `require` 是模块系统注入的**受限 require**，不是 Node 原生 require。
 *   故上述三法在插件沙箱内**可能全部不可达** → 必须实测。
 *
 * 判定：
 *   - 任一可达 → A6 可原样迁移（保留三级降级链）
 *   - 全部不可达 → A6 降级为「纯 IndexedDB/localStorage」，文件通道能力放弃
 *
 * 用法：迁移完成后，在插件 apply() 内调用 runFsProbe()，读 DevTools 控制台输出。
 */

/** 探测单条通道，返回 { name, ok, detail }（不抛异常） */
function probeChannel(name, getter) {
	try {
		const value = getter();
		if (value == null) return { name, ok: false, detail: "值为 " + value };
		return { name, ok: true, detail: "类型 " + typeof value + "，keys=" + Object.keys(value).slice(0, 5).join(",") };
	} catch (e) {
		return { name, ok: false, detail: "抛错: " + (e && e.message ? e.message : String(e)) };
	}
}

/** 三法全测。返回汇总报告对象 */
export function runFsProbe() {
	const g = typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : {});
	const results = [
		probeChannel("window.require", () => (typeof window !== "undefined" ? window.require : undefined)),
		probeChannel("global.require", () => g.global && g.global.require),
		probeChannel("electron.remote.require", () => g.electron && g.electron.remote && g.electron.remote.require),
		probeChannel("process.versions.electron", () => g.process && g.process.versions && g.process.versions.electron),
		probeChannel("__ModuleLoader__ (宿主模块系统)", () => g.__ModuleLoader__),
	];

	// 若任一 require 可达，进一步尝试 module.require("fs")
	let fsProbe = null;
	for (const r of results) {
		if (!r.ok) continue;
		try {
			const req = r.name === "window.require" ? window.require
				: r.name === "global.require" ? g.global.require
				: g.electron.remote.require;
			const fs = req("fs");
			fsProbe = { via: r.name, ok: true, hasWriteFileSync: typeof fs.writeFileSync === "function" };
			break;
		} catch (e) {
			fsProbe = { via: r.name, ok: false, detail: e && e.message };
		}
	}

	const report = {
		probeAt: new Date().toISOString(),
		channels: results,
		fs: fsProbe,
		verdict: results.some((r) => r.ok && r.name !== "__ModuleLoader__ (宿主模块系统)") ? "PARTIAL_OR_FULL" : "ALL_UNREACHABLE",
	};

	const tag = "[R3-spike]";
	const log = typeof console !== "undefined" ? console : { log() {}, warn() {} };
	log.log(tag + " ===== 文件通道可达性探测开始 =====");
	results.forEach((r) => log.log(tag + (r.ok ? " ✅ " : " ❌ ") + r.name + " → " + r.detail));
	log.log(tag + " fs 模块: " + (fsProbe ? JSON.stringify(fsProbe) : "未尝试（无可用 require）"));
	log.log(tag + " 判定: " + report.verdict);
	log.log(tag + " ===== 探测结束 =====");

	return report;
}

export const SPIKE_VERSION = "v1-20260911";
