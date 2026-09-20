#!/usr/bin/env node
/* test-shot-verify.mjs —— `_shot-verify.mjs#shotCheck` 的**常驻校准**（纪律 32/108：改了判据必须能红能绿）。
 *
 * 🔴 命名说明：原先叫 `_shotcal.mjs`（下划线 = 内部模块），但本仓 `listSuites()` 只认
 *    `lint-|verify-|test-|prove-` 前缀且排除 `_` 开头 ⇒ **永远不会被离线批跑到**，
 *    "常驻校准"就成了摆设。改名 `test-` 前缀 ⇒ 进离线批（`scripts/**` 在 `INPUT_DIRS` 里，
 *    改 `scripts/**` 即触发）—— **能自动跑到的校准才叫常驻**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要
 * ══════════════════════════════════════════════════════════════════
 *  `shotCheck` 是**所有截图判据的唯一实现**（调用方 `verify-novel-e2e-human.mjs` /
 *  `_r40-seg-shot.mjs`）。它的**取整容差**与**面积挂钩的字节下限**一旦被改错，
 *  症状是「**全线假绿**」（放过拍错框 / 空图 —— 比假红更坏）或「全线假红」。
 *  ⇒ 纪律 32/108 要求：动了判据就必须配**能红能绿**的校准。
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 样本**自造**，不读真机产物（第四十一轮批次 D 续改造）
 * ══════════════════════════════════════════════════════════════════
 *  初版拿 `logs/acceptance19/01-before-dispatch.png`（真机验收截图）当真值。**两个问题**：
 *    ① **寿命不安全**（纪律 137 家族）—— 该目录是 `clean-logs` 的目标，清一次就 exit 2；
 *    ② **口径混淆** —— 本工具要校准的是**判据函数**，不是"真机截图拍得对不对"
 *       （那是 `verify-novel-e2e-human` 自己的事，两件事混在一起会让失败无法归因）。
 *  ⇒ 改为**就地自造**最小 PNG：真值由本文件构造 ⇒ 零外部依赖、可重复、永不过期。
 *    自造用的是**真 PNG 容器**（IHDR/IDAT/IEND + CRC32 + zlib），不是伪造头 ——
 *    否则校准就变成"拿假样本验假判据"（纪律 23：先证前提，再断结果）。
 *
 * 退出码：0 = 校准通过 · 1 = **判据行为与期望不符**（真缺陷，要改 `_shot-verify.mjs`）
 *        · 2 = **校准自身前提不成立**（自造样本回读不符 —— 与"判据坏"在**退出码层面**分开，纪律 128）
 * 用法：node scripts/test-shot-verify.mjs
 */
import zlib from "node:zlib";
import { pngSize, shotCheck } from "./_shot-verify.mjs";

/* ── 最小 PNG 编码器（8bit / truecolor RGB / 滤镜 None）—— 只为造校准样本 ────── */
const CRC_TABLE = (() => {
	const t = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		t[n] = c;
	}
	return t;
})();
const crc32 = (buf) => {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
};
/** @param {(x:number,y:number)=>number[]} fill 像素取值（长度 3） */
const makePng = (w, h, fill) => {
	const stride = 1 + w * 3;
	const raw = Buffer.alloc(h * stride);
	for (let y = 0; y < h; y++) {
		raw[y * stride] = 0;                                  // 滤镜 None
		for (let x = 0; x < w; x++) {
			const o = y * stride + 1 + x * 3;
			const p = fill(x, y);
			raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2];
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;                                              // bit depth
	ihdr[9] = 2;                                              // color type = RGB
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0))
	]);
};

/* 样本尺寸：够小（保持快）又够大（`minBytes = max(600, px/64)` 由面积项主导时才有意义）。
 * 320×48 = 15,360 px ⇒ minBytes = 600（地板项）；噪声内容 deflate 几乎不压缩 ⇒ ~46 KB。 */
const SW = 320, SH = 48;
/** 确定性伪随机（**禁用 `Math.random`** —— 校准必须可重复，纪律：deterministic RNG） */
const hash = (i) => (Math.imul(i ^ 0x9e3779b9, 2654435761) >>> 24) & 0xff;
const GOOD = makePng(SW, SH, (x, y) => { const i = y * SW + x; return [hash(i), hash(i * 3 + 1), hash(i * 7 + 5)]; });
const FLAT = makePng(SW, SH, () => [255, 255, 255]);
const NOT_PNG = Buffer.from("this is definitely not a png file at all", "latin1");

/* ── ① 前提自检（纪律 23：先证前提，再断结果）──────────────────────────────
 * 🔴 如果自造样本本身就错了（尺寸回读不符），下面的"判据红/绿"全是无意义的读数 ——
 *    必须与"判据坏"在**退出码层面**分开（exit 2 vs exit 1）。 */
const gs = pngSize(GOOD), fs = pngSize(FLAT);
const preOk = !!gs && !!fs && gs.w === SW && gs.h === SH && fs.w === SW && fs.h === SH
	&& !pngSize(NOT_PNG) && GOOD.length > 600 && FLAT.length <= 600;
console.log("样本（自造 · 不读真机产物）：");
console.log("  有内容 " + GOOD.length + " B ｜ 回读 " + (gs ? gs.w + "x" + gs.h : "null") + "（期望 " + SW + "x" + SH + "）");
console.log("  纯色   " + FLAT.length + " B ｜ 回读 " + (fs ? fs.w + "x" + fs.h : "null") + "（期望 " + SW + "x" + SH + "）");
console.log("  非PNG  pngSize=" + JSON.stringify(pngSize(NOT_PNG)) + "（期望 null）");
if (!preOk) {
	console.log("\nIS_PASS: FALSE（INVALID：**校准自身前提不成立** —— 自造样本回读不符）");
	console.log("  这不代表 `shotCheck` 坏了 —— 是**校准器**坏了 ⇒ 先修本文件。");
	process.exit(2);
}

/* ── ② 用例（期望值全部由真值 `SW/SH` 推导，改尺寸照样成立）────────────────── */
const cases = [
	["好样本（真值 320x48 · 有内容）", GOOD, { w: SW, h: SH }, true, "应绿"],
	["边界样本（高 -1 ⇒ CDP `ceil` 方向）", GOOD, { w: SW, h: SH - 1 }, true, "应绿（±1 容差存在的理由）"],
	["坏① 错框（宽 -5）", GOOD, { w: SW - 5, h: SH }, false, "应红（拍错了框）"],
	["坏② 空图（期望 1x1）", GOOD, { w: 1, h: 1 }, false, "应红（尺寸差几个数量级）"],
	["坏③ 取整差 2（容差**不许**放大到 2+）", GOOD, { w: SW, h: SH - 2 }, false, "应红（否则开始放过拍小框）"],
	["坏④ 纯色同尺寸（字节 ≤ 面积下限）", FLAT, { w: SW, h: SH }, false, "应红（校准字节下限与面积挂钩）"],
	["坏⑤ 非 PNG 字节", NOT_PNG, { w: SW, h: SH }, false, "应红（签名判据）"]
];
let pass = 0;
for (const c of cases) {
	const r = shotCheck(c[1], c[2]);
	const hit = r.ok === c[3];
	if (hit) pass++;
	console.log("  " + (hit ? "✅" : "❌") + " " + c[0] + " ⇒ ok=" + r.ok + "（期望 " + c[3] + "）｜" + c[4]
		+ "｜bytes=" + r.bytes + " minBytes=" + r.minBytes + "｜why=" + r.why);
}
const ok = pass === cases.length;
console.log("\n校准 " + pass + "/" + cases.length + " ｜ IS_PASS: " + (ok ? "TRUE" : "FALSE"));
process.exit(ok ? 0 : 1);
