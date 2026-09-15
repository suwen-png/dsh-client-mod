#!/usr/bin/env node
/**
 * _src-scan.mjs — 源码扫描的**共享底座**（唯一真相源）
 *
 * 由来（2026-09-14）：`stripComments` 在仓库里已被**各写各的**抄了 3 份
 *   （`test-personalize.mjs:336` · `verify-batch7.mjs:65` · `verify-v19.mjs:350`）。
 *   纪律 21「测试桩只能有一份，重复即漂移」在**工具函数**上同样成立 ——
 *   三份实现只要有一份语义不同，"同一个判据"就会得出不同结论。
 *
 *   本模块是**新写入者的家**：新脚本一律 `import { stripComments, walkSrc } from "./_src-scan.mjs"`。
 *   既有 3 份**本轮不动**（它们所在的闸门都是绿的，改写有误伤风险）
 *   ⇒ 台账记「待迁移」，不在这里偷偷换实现。
 *
 * 零依赖 · 纯函数 · 可离线单测。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 插件包根目录（scripts/ 的上一级） */
export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_DIR = join(PLUGIN_ROOT, "src");

/**
 * 去掉行注释与块注释（**保留换行**，方便报行号）。
 *
 * 纪律 28：扫源码做**负断言**前必须先 stripComments ——
 * 否则"注释里提到过这个词"会被当成"代码里还在用"，
 * 于是**修好了却报红**、或者**没修却报绿**（口径污染）。
 *
 * @param {string} src
 * @returns {string}
 */
export function stripComments(src) {
	const s = String(src == null ? "" : src);
	let out = "";
	let i = 0;
	const n = s.length;
	let mode = 0; // 0 代码 / 1 行注释 / 2 块注释 / 3 单引号 / 4 双引号 / 5 反引号
	while (i < n) {
		const c = s[i];
		const d = i + 1 < n ? s[i + 1] : "";
		if (mode === 0) {
			if (c === "/" && d === "/") { mode = 1; i += 2; continue; }
			if (c === "/" && d === "*") { mode = 2; i += 2; continue; }
			if (c === "'") { mode = 3; out += c; i++; continue; }
			if (c === '"') { mode = 4; out += c; i++; continue; }
			if (c === "`") { mode = 5; out += c; i++; continue; }
			out += c; i++; continue;
		}
		if (mode === 1) { if (c === "\n") { mode = 0; out += c; } i++; continue; }
		if (mode === 2) { if (c === "*" && d === "/") { mode = 0; i += 2; continue; } if (c === "\n") out += c; i++; continue; }
		/* 字符串内：只认转义，别的原样留 */
		if (mode === 3 || mode === 4 || mode === 5) {
			if (c === "\\") { out += c + d; i += 2; continue; }
			const close = mode === 3 ? "'" : mode === 4 ? '"' : "`";
			if (c === close) mode = 0;
			out += c; i++; continue;
		}
	}
	return out;
}

/**
 * 递归列出 `src/**` 下所有 `.js`（相对 PLUGIN_ROOT 的 POSIX 路径）。
 * @returns {string[]}
 */
export function walkSrc(dir) {
	const base = dir || SRC_DIR;
	const out = [];
	const rec = (d) => {
		let ents = [];
		try { ents = readdirSync(d); } catch (e) { return; }
		for (const name of ents) {
			const full = join(d, name);
			let st = null;
			try { st = statSync(full); } catch (e) { continue; }
			if (st.isDirectory()) { rec(full); continue; }
			if (name.endsWith(".js")) out.push(full.replace(/\\/g, "/"));
		}
	};
	rec(base);
	out.sort();
	return out;
}

/** 读文件（失败回空串，脚本不因单个文件读不到而崩） */
export function readSrc(abs) {
	try { return readFileSync(abs, "utf8"); } catch (e) { return ""; }
}

/** 相对插件根的短路径（报错好看） */
export function rel(abs) {
	try { return abs.replace(PLUGIN_ROOT.replace(/\\/g, "/") + "/", ""); } catch (e) { return abs; }
}
