/**
 * _shot-verify.mjs —— **「截图是不是真的拍到了东西」的唯一判据实现**
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 为什么必须只有一处（纪律 126）
 * ══════════════════════════════════════════════════════════════════
 *  G3 分段条探针（`_r40-seg-shot.mjs`）与 `verify-novel-e2e-human.mjs` 的分步图
 *  **都要**判"非空白"。第 41 轮初版两边各自写了 `bytes > 8192` ——
 *  **同一语义两处阈值**，而且**两处都错**：
 *    阈值与**裁切面积无关** ⇒ 小框（572×80 / 90×22 / 68×30）的真实截图
 *    只有 1.4–7 KB，被一律判红（真机实测 **3 条假红**）。
 *  这正是纪律 126「**阈值不许照手工计数钉**」的又一形态：
 *    8 KB 是从"整屏截图"的直觉里拍出来的数，不是从判据语义里推出来的。
 *
 * ══════════════════════════════════════════════════════════════════
 *  判据（全部**与面积挂钩**，可被坏样本校准 —— 纪律 32）
 * ══════════════════════════════════════════════════════════════════
 *  ① PNG 头 `IHDR` 尺寸 == `clip × scale` ⇒ **拍到了该拍的框**（不是空图 / 1×1）；
 *  ② 字节数 > `max(FLOOR, 像素数 / 64)` ⇒ 纯色 / 全黑 PNG 压缩后远低于此
 *     （实测：572×80 的真实内容 ≈ 6.8 KB；同样尺寸的纯色 ≈ 300 B）；
 *  ③ 「各张互异」由调用方按批判（本模块只判单张 —— 批的语义调用方更清楚）。
 *
 *  ⚠️ 本仓**没有**既有的"像素方差"实现（`shot-dialog-bg.mjs` 只 `clip` 不判空），
 *     故不引第三方解码器：PNG 头 + 压缩后字节数这两条**不需要解码**就够用，
 *     且**能被坏样本校准**（把 clip 设成 1×1 或截空白区 ⇒ ①/② 必红）。
 */

/** PNG 签名（8 字节） */
const PNG_SIG = "89504e470d0a1a0a";
/** 字节下限的绝对地板（防极小框被 `面积/64` 压到 0） */
const FLOOR = 600;

/**
 * 读 PNG 的 IHDR 宽高（偏移 16 / 20，big-endian）—— 不依赖任何解码器。
 * @param {Buffer} buf
 * @returns {{w:number,h:number}|null}
 */
export function pngSize(buf) {
	if (!buf || buf.length < 24) return null;
	if (buf.slice(0, 8).toString("hex") !== PNG_SIG) return null;
	return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/**
 * 判一张截图"是不是真的拍到了东西"。
 * @param {Buffer} buf   PNG 字节
 * @param {{w:number,h:number}} want  期望尺寸（= clip 宽高 × 实际 DPR；**允许 ±1 px 取整容差**）
 * @returns {{ok:boolean, why:string, bytes:number, png:{w,h}|null, minBytes:number}}
 */
export function shotCheck(buf, want) {
	const bytes = buf ? buf.length : 0;
	const png = pngSize(buf);
	const px = Math.max(1, Number(want && want.w) || 0) * Math.max(1, Number(want && want.h) || 0);
	const minBytes = Math.max(FLOOR, Math.round(px / 64));
	if (!png) return { ok: false, why: "不是合法 PNG（签名/长度不符）", bytes: bytes, png: null, minBytes: minBytes };
	/* 🔴 尺寸判据**允许 ±1 px 取整容差**（2026-09-18 整批暴露的**第二层**缺陷）：
	 *    调用方按 `clip × DPR` 算期望值，而 DPR 常是**小数**（本机实测 **1.25**）⇒ 期望值带小数；
	 *    而 PNG 的 IHDR 尺寸必须是**整数**，CDP 对 clip 取 `ceil`（实测 28.75→29 · 357.5→358 ·
	 *    1027.5→1028 · 37.5→38 —— 四张图**全部**如此）。
	 *    ⇒ 凡"**取整方向**"类差异一律 ≤1 px ⇒ 容差 1 既消除假红，又**仍拦得住**真正的问题
	 *    （空图 / 1×1 / 拍错框 —— 那些差异是几倍量级）。
	 *    ⚠️ **不许放大到 2+**：那会开始放过"拍错了小框"，判据就失去意义。 */
	const dw = Math.abs(png.w - Number(want && want.w));
	const dh = Math.abs(png.h - Number(want && want.h));
	if (!(dw <= 1 && dh <= 1)) {
		return { ok: false, why: "尺寸不符：实测 " + png.w + "x" + png.h + "，期望 " + want.w + "x" + want.h + "（容差 ±1 px）", bytes: bytes, png: png, minBytes: minBytes };
	}
	if (bytes <= minBytes) {
		return { ok: false, why: "字节 " + bytes + " ≤ 下限 " + minBytes + "（面积 " + px + " ⇒ 疑纯色 / 全黑）", bytes: bytes, png: png, minBytes: minBytes };
	}
	return { ok: true, why: "ok", bytes: bytes, png: png, minBytes: minBytes };
}
