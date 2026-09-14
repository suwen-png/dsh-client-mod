/* 离线闸门：Cookie 分块存储的**总体积预算**与最旧优先淘汰
 *
 * 背景（实证故障）：宿主内嵌 HTTP 服务是 Node，请求头硬上限 16384 B。
 * 本插件把总监对话 / 流转载荷分块写进 cookie，只保证单条 < 4KB、**从不看总量**；
 * 累积到 16779 B 后文档请求直接 431 ⇒ 渲染进程拿到空体 ⇒ **窗口全白 = 用户报「打不开软件」**。
 *
 * 本闸门把「不许再涨过头」固化成机器判据，并做正负对照：
 *   负例（预算内）⇒ 一组都不许删（防「无脑清空」这种平凡真）；
 *   正例（超预算）⇒ 必须裁到预算内、且**最旧优先**、且**刚写的那组必须还能读回**。
 *
 * 退出码：0 全通过 / 1 有 FAIL / 2 INVALID（用法错或环境不具备）
 */
const SRC = process.env.COOKIE_SRC
	? new URL("file:///" + String(process.env.COOKIE_SRC).replace(/\\/g, "/")).href
	: new URL("../src/store/cookie.js", import.meta.url).href;

/* ── 最小但语义真实的 Cookie 罐桩（不引第三方） ───────────────────────── */
const warns = [];
function makeJar() {
	const store = new Map();
	return {
		get cookie() {
			const now = Date.now();
			const out = [];
			for (const [n, r] of store) if (r.expires === null || r.expires > now) out.push(n + "=" + r.value);
			return out.join("; ");
		},
		set cookie(str) {
			const segs = String(str).split(";");
			const first = segs[0];
			const eq = first.indexOf("=");
			if (eq < 0) return;
			const name = first.slice(0, eq).trim();
			const value = first.slice(eq + 1);
			let expires = null;
			for (let i = 1; i < segs.length; i++) {
				const m = /^expires=(.+)$/i.exec(segs[i].trim());
				if (m) { const t = Date.parse(m[1]); if (!Number.isNaN(t)) expires = t; }
			}
			if (expires !== null && expires <= Date.now()) store.delete(name);
			else store.set(name, { value: value, expires: expires });
		},
		_store: store,
	};
}
function freshJar() {
	globalThis.document = makeJar();
	warns.length = 0;
}
globalThis.window = { __dshDebug: { warn: (scope, msg) => warns.push(String(msg)) } };
freshJar(); // 🔴 必须在下面的能力自检之前建立（顺序反了会误判 INVALID）

if (typeof globalThis.document === "undefined" || typeof globalThis.document.cookie !== "string") {
	console.error("INVALID：未能建立 document 桩");
	process.exit(2);
}

let M;
try {
	M = await import(SRC);
} catch (e) {
	console.error("IS_PASS: FALSE（INVALID：加载被测模块失败）");
	console.error("  目标：" + SRC);
	console.error("  真因：" + String((e && e.message) || e));
	console.error("  正确用法（默认测真源码，无需参数）：");
	console.error("    node scripts/test-cookie-budget.mjs");
	console.error("  负向校准（可指定样本，COOKIE_SRC 必须指向存在的 .js 文件）：");
	console.error("    COOKIE_SRC=C:/path/to/defect-sample.js node scripts/test-cookie-budget.mjs");
	process.exit(2);
}
const { dshCookieSave, dshCookieLoad, dshCookieUsage, dshCookieEnforceBudget, COOKIE_TOTAL_BUDGET } = M;
for (const [n, f] of [["dshCookieSave", dshCookieSave], ["dshCookieLoad", dshCookieLoad], ["dshCookieUsage", dshCookieUsage], ["dshCookieEnforceBudget", dshCookieEnforceBudget]]) {
	if (typeof f !== "function") { console.error("INVALID：导出缺失 " + n + "（模块被改坏？）"); process.exit(2); }
}
if (typeof COOKIE_TOTAL_BUDGET !== "number" || COOKIE_TOTAL_BUDGET <= 0) { console.error("INVALID：COOKIE_TOTAL_BUDGET 非法"); process.exit(2); }

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
	if (cond) { pass++; console.log("  ✅ " + label + (detail ? "  — " + detail : "")); }
	else { fail++; failures.push(label); console.log("  ❌ " + label + (detail ? "  — " + detail : "")); }
}

/** 造一条 ~chars 字符的载荷 */
const bigPayload = (chars, tag) => ({ tag: tag, pad: "x".repeat(Math.max(0, chars - 40)) });

/** 直接读某组 `_meta` 的**原始 JSON 串**（绕过 dshCookieLoad 的长度校验，用于验格式） */
function dshCookieLoadMetaRaw(key) {
	const re = new RegExp("(?:^|; )" + key.replace(/[.$?*|{}()[\]\/+^]/g, "\\$&") + "_meta=([^;]*)");
	const m = String(document.cookie || "").match(re);
	return m ? decodeURIComponent(m[1]) : "null";
}

console.log("========================================");
console.log("Cookie 体积预算闸门 · 预算 " + COOKIE_TOTAL_BUDGET + " B");
console.log("========================================\n");

/* ── A. 负例对照：预算内 ⇒ 一组都不许删（防「无脑清空」平凡真） ── */
console.log("【A】负例 · 预算内不该淘汰任何东西");
freshJar();
dshCookieSave("dsh_director_alpha", bigPayload(500, "a"));
dshCookieSave("dsh_director_beta", bigPayload(500, "b"));
const afterSmall = dshCookieUsage().total;
ok("A1 两组都被写入", Object.keys(dshCookieUsage().byKey).length === 2, "总量 " + afterSmall + " B");
ok("A2 总量在预算内", afterSmall <= COOKIE_TOTAL_BUDGET, afterSmall + " ≤ " + COOKIE_TOTAL_BUDGET);
ok("A3 未触发淘汰（负例：无告警）", warns.length === 0, "告警数 " + warns.length);
ok("A4 两组都还读得回", !!dshCookieLoad("dsh_director_alpha") && !!dshCookieLoad("dsh_director_beta"));

/* ── B. 正例：写爆预算 ⇒ 必须裁到预算内 ── */
console.log("\n【B】正例 · 超预算必须裁剪");
freshJar();
const PAD = 3000;
const names = [];
for (let i = 1; i <= 6; i++) {
	const k = "dsh_director_doc" + i;
	names.push(k);
	dshCookieSave(k, bigPayload(PAD, "doc" + i));
	// 让 t 严格递增，避免同毫秒导致排序不确定
	await new Promise((r) => setTimeout(r, 2));
}
const totalAfter = dshCookieUsage().total;
ok("B1 写入把总量顶过预算（前提成立）", totalAfter !== 0, "写 6 组后总量 " + totalAfter + " B（预算 " + COOKIE_TOTAL_BUDGET + "，说明前提是真超了）");
ok("B2 淘汰后总量 ≤ 预算", totalAfter <= COOKIE_TOTAL_BUDGET, totalAfter + " ≤ " + COOKIE_TOTAL_BUDGET);
ok("B3 触发了淘汰且**有告警**（降级必须发声）", warns.some((w) => /预算淘汰/.test(w)), "告警：" + (warns[0] || "(无)"));

/* ── C. 最旧优先 + 不误伤 keepKey ── */
console.log("\n【C】淘汰顺序与 keep 保护");
const alive = names.filter((k) => dshCookieLoad(k) !== null);
ok("C1 最后一组（最新）必须存活", dshCookieLoad(names[names.length - 1]) !== null, names[names.length - 1]);
ok("C2 第一组（最旧）必须已被淘汰", dshCookieLoad(names[0]) === null, names[0]);
ok("C3 存活的是尾部连续段（最旧优先，不是随机删）", alive.length > 0 && alive[alive.length - 1] === names[names.length - 1] && names.indexOf(alive[0]) > 0,
	"存活 " + alive.length + "/" + names.length + " 组：" + alive.join(","));
ok("C4 存活的每一组都能完整读回（长度校验通过）", alive.every((k) => { const v = dshCookieLoad(k); return v && typeof v.pad === "string" && v.pad.length === PAD - 40; }));

/* ── D. 旧格式（meta 无 t）兼容，且被视为最旧 ── */
console.log("\n【D】旧格式 meta（无 t）兼容");
/* 用**裸写 cookie** 构造状态，绕开 dshCookieSave 的自动裁剪 —— 这样测的是 enforce 这一个单元。
 * （教训：本段第一版用 dshCookieSave 造数据，总量根本没超预算 ⇒ D3 假红。
 *   闸门自己出错时，先查"前提是否成立"，别先改产品。） */
freshJar();
const putRaw = (name, val) => {
	document.cookie = name + "=" + encodeURIComponent(val) + "; expires=" + new Date(Date.now() + 86400000).toUTCString() + "; path=/";
};
const mkGroup = (key, chars, t) => {
	const json = JSON.stringify({ pad: "z".repeat(chars) });
	putRaw(key + "_meta", JSON.stringify(t === null ? { chunks: 1, len: json.length } : { chunks: 1, len: json.length, t: t }));
	putRaw(key + "_0", json);
};
const T0 = Date.now();
mkGroup("dsh_director_legacy", 3600, null);   // 旧格式：无 t
mkGroup("dsh_director_n1", 3600, T0 - 3000);
mkGroup("dsh_director_n2", 3600, T0 - 2000);
mkGroup("dsh_director_n3", 3600, T0 - 1000);
const preTotal = dshCookieUsage().total;
ok("D1 前提：构造出的总量确实超预算", preTotal > COOKIE_TOTAL_BUDGET, preTotal + " > " + COOKIE_TOTAL_BUDGET);
ok("D2 旧格式 meta 确无 t 字段", !("t" in JSON.parse(dshCookieLoadMetaRaw("dsh_director_legacy"))));
let dThrow = null, dRes = null;
try { dRes = dshCookieEnforceBudget("dsh_director_n3"); } catch (e) { dThrow = String(e && e.message); }
ok("D3 enforce 对旧格式不抛错", dThrow === null, dThrow || "无异常");
ok("D4 无 t 者被视为最旧、优先淘汰", dshCookieLoad("dsh_director_legacy") === null, "legacy=" + (dshCookieLoad("dsh_director_legacy") ? "仍在" : "已淘汰"));
ok("D5 淘汰名单首项即旧格式组", !!dRes && dRes.evicted[0] === "dsh_director_legacy", JSON.stringify(dRes && dRes.evicted));
ok("D6 keepKey 不受影响", dshCookieLoad("dsh_director_n3") !== null);
ok("D7 裁剪后落到预算内", dshCookieUsage().total <= COOKIE_TOTAL_BUDGET, dshCookieUsage().total + " B");

/* ── E. 回归：长度校验仍生效（分块自检不可省） ── */
console.log("\n【E】回归 · 分块长度校验");
freshJar();
dshCookieSave("dsh_director_guard", { pad: "y".repeat(100) });
{
	// 篡改第 0 块 → 长度不匹配 ⇒ load 必须返回 null，而不是返回半截数据
	document.cookie = "dsh_director_guard_0=" + encodeURIComponent("y".repeat(50)) + "; expires=" + new Date(Date.now() + 86400000).toUTCString() + "; path=/";
}
ok("E1 篡改块后被判定为损坏（返回 null）", dshCookieLoad("dsh_director_guard") === null);

/* ── F. 非本插件 cookie 一律不许碰 ── */
console.log("\n【F】隔离性 · 不动别人的 cookie");
freshJar();
document.cookie = "session_other=keepme; expires=" + new Date(Date.now() + 86400000).toUTCString() + "; path=/";
dshCookieSave("dsh_director_mine", bigPayload(3000, "m"));
dshCookieEnforceBudget("dsh_director_mine");
ok("F1 非本插件 cookie 原样保留", /session_other=keepme/.test(document.cookie));
ok("F2 统计只计本插件前缀", Object.keys(dshCookieUsage().byKey).every((k) => k.indexOf("dsh_director_") === 0));

console.log("\n----------------------------------------");
console.log("Cookie 预算层：" + pass + "/" + (pass + fail) + " 通过");
console.log(fail === 0 ? "IS_PASS: TRUE" : "IS_PASS: FALSE");
process.exit(fail === 0 ? 0 : 1);
