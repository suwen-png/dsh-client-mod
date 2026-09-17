#!/usr/bin/env node
/**
 * check-stale-build.mjs —— **产物陈旧守卫**：`lib/client.js` 是否比 `src/**` 旧？
 *
 * ── 为什么必须有这条判据（2026-09-16 第十九轮真机踩出来的）────────────
 *   第十九轮把 `DirectorPage.js` 的最后一批改动（5 处 `data-*` 读数）写在了
 *   **最后一次 build 之后**，然后照常装机。装机脚本的复判是
 *   「仓库 `lib/client.js` ↔ 实体包 `lib/client.js` 逐字节一致」——
 *   **两个旧产物之间当然也逐字节一致** ⇒ 报 ✅ 已就绪。
 *   代价：真机闸门 94 条里 5 条假红（`data-reused` 等属性在产物里根本不存在），
 *   而离线套件全绿，问题只在真机暴露。
 *
 * 🔴 一句话：**「逐字节一致」证明的是"装对了"，不证明"是新的"。** 两者都要判。
 *
 * ── 判据（第十九轮 v2：**内容指纹**，不再用 mtime）────────────────────
 *   产物首行是 `/* dsh-build-stamp: <hash> *​/`，hash = `src/**` 按路径排序逐文件哈希。
 *   `checkStale()` 用**当前** src 重算，与产物内指纹**比对**。
 *
 *   🔴 为什么 v1（mtime 序）被换掉：本仓有离线套件会重跑 `gen-source-map` + `build`，
 *      产物与 src 的 mtime 只差约 1 秒、谁新谁旧随机 ⇒ 周期性假阳性。
 *      内容指纹与写盘顺序无关，也不受"保存了但内容没变"影响。
 *   🔴 附带收益：真机可用 `window.__dshBuildStamp` **直接回答"页面加载了哪一版"**
 *      （第十九轮排查属性缺失时没有这个读数，只能靠"猜新符号"）。
 *
 * 🔴 仍有的局限：指纹只覆盖 `src/**`；`build/**` 改动不会让产物变旧。
 *   这是刻意的（否则 bundler 一改，所有历史产物都被判陈旧，守卫很快会被无视）。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node scripts/check-stale-build.mjs            # 检查（exit 1 = 陈旧）
 *   node scripts/check-stale-build.mjs --allow-stale
 *
 * 也可当模块用：`import { checkStale } from "./check-stale-build.mjs"`（装机脚本就是这么用的）
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSrcStamp, readStampIn, listSrcFiles } from "./build-stamp.mjs";

const ARTIFACT = "lib/client.js";

/**
 * @param {string} root 包根目录（`dsh-director-plugin/`）
 * @returns {{stale:boolean, artifactStamp:string|null, srcStamp:string, srcFiles:number, reason:string|null, detail:string}}
 */
export function checkStale(root) {
	const art = join(root, ARTIFACT);
	if (!existsSync(art)) {
		return { stale: true, artifactStamp: null, srcStamp: "", srcFiles: 0, detail: "产物不存在", reason: "产物不存在：" + ARTIFACT + "（先跑 node build/build.mjs）" };
	}
	const srcStamp = computeSrcStamp(root);
	const files = listSrcFiles(root).length;
	const inArt = readStampIn(readFileSync(art, "utf8"));
	if (!inArt) {
		return {
			stale: true, artifactStamp: null, srcStamp: srcStamp, srcFiles: files,
			detail: "产物内没有指纹",
			reason: "产物内**没有指纹**（是打指纹之前的旧产物，或产物被手工改过）⇒ 无法证明它是当前 src 构建出来的"
		};
	}
	const stale = inArt !== srcStamp;
	return {
		stale: stale,
		artifactStamp: inArt,
		srcStamp: srcStamp,
		srcFiles: files,
		detail: stale ? ("产物指纹 " + inArt + " ≠ 当前 src 指纹 " + srcStamp) : "指纹一致",
		reason: stale ? ("产物指纹 " + inArt + " ≠ 当前 src 指纹 " + srcStamp + " ⇒ 产物不是当前 src 构建的") : null
	};
}

/* ── CLI ─────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		console.log("用法：node scripts/check-stale-build.mjs [--allow-stale]");
		process.exit(0);
	}
	const allow = argv.includes("--allow-stale");
	const unknown = argv.filter((a) => a.startsWith("-") && a !== "--allow-stale");
	if (unknown.length) { console.error("用法错：不认识的参数 " + unknown.join(" ") + "（--help 看用法）"); process.exit(2); }

	const root = fileURLToPath(new URL("..", import.meta.url));
	const r = checkStale(root);
	console.log("产物指纹：" + (r.artifactStamp || "(无)"));
	console.log("当前 src 指纹：" + r.srcStamp + "（覆盖 " + r.srcFiles + " 个文件）");
	if (!r.stale) { console.log("IS_PASS: TRUE（产物 = 当前 src 构建出来的）"); process.exit(0); }
	if (allow) { console.log("⚠️ STALE 但 --allow-stale 放行：" + r.reason); console.log("🔴 该轮真机结果请按**可疑**对待（产物可能不含最新改动）"); process.exit(0); }
	console.log("STALE：" + r.reason);
	console.log("IS_PASS: FALSE（先跑 node build/build.mjs；确认要放行才加 --allow-stale）");
	process.exit(1);
}
