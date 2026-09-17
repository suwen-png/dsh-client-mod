#!/usr/bin/env node
/**
 * build-stamp.mjs —— 产物**内容指纹**（源文件集 → 短哈希）
 *
 * ── 为什么不是 mtime 判据（2026-09-16 第十九轮实测）──────────────────
 *   第一版守卫用 `mtime(lib/client.js) >= max(mtime(src/**))`。实测发现本仓有
 *   **离线套件会重跑 `gen-source-map` + `build`** ⇒ 产物与 src 的 mtime 只差 1 秒、
 *   谁新谁旧随机 ⇒ mtime 判据**周期性假阳性**。
 *   换个思路：**内容决定指纹**，与写盘顺序无关，也不受"保存了但没改"影响。
 *
 * ── 判据 ──────────────────────────────────────────────────────────
 *   stamp = sha1( 按路径排序的 [相对路径 + 0x00 + 文件字节 + 0x00] ... ).slice(0,16)
 *   · `build/build.mjs` 把它写进产物的第一行注释，并挂 `window.__dshBuildStamp`
 *   · `scripts/check-stale-build.mjs` 用**当前** src 重算，与产物内指纹比对
 *
 * 🔴 同时解决第二个问题：**"页面到底加载了哪一版产物"过去无法判断**。
 *    第十九轮排查 `data-reused` 属性缺失时，只能靠"有没有某个新符号"猜；
 *    有了指纹，`Page.reload` 前后各读一次 `window.__dshBuildStamp` 即可**直接对上**。
 *
 * 🔴 覆盖范围：`src/**` 全部文件（含 `key-files.js` 这类生成物）。
 *    `build/**` 不在内 —— bundler 自身的改动应当由"重跑一次 build"体现，
 *    而不是让所有产物都变旧（那会让守卫天天报陈旧、很快被人无视）。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** 列出 `src/**` 下的全部文件（相对 `src` 的路径，正斜杠，已排序） */
export function listSrcFiles(root) {
	const dir = join(root, "src");
	const out = [];
	if (!existsSync(dir)) return out;
	const walk = (d) => {
		let kids = [];
		try { kids = readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
		for (const k of kids) {
			const p = join(d, k.name);
			if (k.isDirectory()) { walk(p); continue; }
			out.push(relative(dir, p).split("\\").join("/"));
		}
	};
	walk(dir);
	out.sort();
	return out;
}

/** @param {string} root 包根目录（`dsh-director-plugin/`）@returns {string} 16 位十六进制 */
export function computeSrcStamp(root) {
	const dir = join(root, "src");
	const h = createHash("sha1");
	for (const rel of listSrcFiles(root)) {
		h.update(rel);
		h.update("\u0000");
		h.update(readFileSync(join(dir, rel)));
		h.update("\u0000");
	}
	return h.digest("hex").slice(0, 16);
}

/** 从产物文本里取指纹（取不到 ⇒ null） */
export function readStampIn(text) {
	const m = /dsh-build-stamp:\s*([0-9a-f]{6,40})/.exec(String(text || ""));
	return m ? m[1] : null;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const root = fileURLToPath(new URL("..", import.meta.url));
	console.log(computeSrcStamp(root));
}
