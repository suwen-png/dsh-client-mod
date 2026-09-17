#!/usr/bin/env node
/**
 * test-cdp-port.mjs —— CDP 端口**单一真相源**闸门（§八 纪律 126 · 第 36 轮）
 *
 * ══════════════════════════════════════════════════════════════════
 * 它守的坑（本轮真机批实测：14 套里 **9 套**因此 INVALID）
 * ──────────────────────────────────────────────────────────────────
 * 9222 被幽灵占用 ⇒ 启动器**顺移**到 9223 并在 9223 拉起 Harness；
 * 而 9 个真机套写死 `const PORT = 9222;` ⇒ 全部报「连不上 CDP 9222 / INVALID」。
 * 现象（"真机环境坏了"）与真因（"读错了端口"）毫无表面关联 —— 这就是纪律 126。
 *
 * 判据刻意做成**存在性 / 与规模无关**（纪律 126 同源教训：不许照着手工计数钉阈值）：
 *   · 扫描面 = `scripts/verify-*.mjs` 中**用到 CDP** 的那些（新写的真机套自动纳入）
 *   · 判据   = 每一个都必须从 `./cdp-port.mjs` 取端口，且不得残留 `const PORT = 9222`
 *
 * ── 校准（不碰文件系统，注入进内存扫描集）─────────────────────────────
 *   PORT_CAL=1  注入一个**硬编码 9222** 的假真机套 ⇒ 必须**精确命中**并判红（CAL_HIT）
 *   PORT_CAL=2  注入一个**合规**的假真机套       ⇒ 必须**不命中**（误报则 CAL_MISS）
 *
 * 退出码：0 全绿 / 1 有红 / 2 环境不可用
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCRIPTS = HERE.replace(/[\\/]+$/, ""); // 本文件就住在 scripts/ 下
const HELPER = "cdp-port.mjs";
const CAL = String(process.env.PORT_CAL || "");

let pass = 0, fail = 0;
const bad = [];
const ok = (id, msg) => { pass++; console.log("  ✅ " + id + " " + msg); };
const no = (id, msg) => { fail++; bad.push(id); console.log("  ❌ " + id + " " + msg); };

console.log("═══════════════════════════════════════════════════════════");
console.log(" test-cdp-port —— CDP 端口单一真相源（纪律 126）");

/* ── 前提：helper 必须在（先证前提再断结果，纪律 23）───────────────── */
const helperPath = join(SCRIPTS, HELPER);
if (!existsSync(helperPath)) {
	console.error(" ❌ CP-0 前提缺失：`scripts/" + HELPER + "` 不存在 ⇒ 后续判据无意义");
	console.log(" IS_PASS: FALSE（INVALID）");
	process.exit(2);
}
ok("CP-0", "前提：`scripts/" + HELPER + "` 存在");

/* ── CP-1..4：解析优先级（`CDP_PORT` 才是启动器真正用的那个）───────── */
const probe = (env) => {
	const r = spawnSync(process.execPath, ["-e",
		'import(' + JSON.stringify(pathToFileURL(helperPath).href) + ').then(m=>console.log(String(m.PORT)))'
	], { encoding: "utf8", env: { ...process.env, ...env } });
	return (r.stdout || "").trim();
};

const p1 = probe({ CDP_PORT: "9333", DSH_CDP_PORT: "9111" });
if (p1 === "9333") ok("CP-1", "`CDP_PORT` 优先于 `DSH_CDP_PORT`（9333 vs 9111 ⇒ " + p1 + "）");
else no("CP-1", "`CDP_PORT` 未优先（得到 " + (p1 || "<空>") + "，期望 9333）");

const p2 = probe({ CDP_PORT: "", DSH_CDP_PORT: "9111" });
if (p2 === "9111") ok("CP-2", "无 `CDP_PORT` 时回落历史别名（⇒ " + p2 + "）");
else no("CP-2", "未回落 `DSH_CDP_PORT`（得到 " + (p2 || "<空>") + "，期望 9111）");

const p3 = probe({ CDP_PORT: "", DSH_CDP_PORT: "" });
if (p3 === "9222") ok("CP-3", "都无时回落缺省 9222（⇒ " + p3 + "）");
else no("CP-3", "缺省值不对（得到 " + (p3 || "<空>") + "，期望 9222）");

const p4 = probe({ CDP_PORT: "9223" });
if (p4 === "9223") ok("CP-4", "端口顺移后能正确透传（9223 ⇒ " + p4 + "）");
else no("CP-4", "顺移端口未透传（得到 " + (p4 || "<空>") + "，期望 9223）");

/* ── CP-5/6：扫描面（存在性判据，与规模无关）───────────────────────── */
const isCdpClient = (src) => /\/json\/(list|version|new|protocol)/.test(src) || /127\.0\.0\.1:/.test(src);
const files = readdirSync(SCRIPTS)
	.filter((f) => /^verify-.*\.mjs$/.test(f))
	.map((f) => ({ name: f, src: readFileSync(join(SCRIPTS, f), "utf8") }))
	.filter((x) => isCdpClient(x.src));

let calInject = null;
if (CAL === "1") {
	calInject = {
		name: "_cal-hardcoded-port.mjs",
		src: "const PORT = 9222;\nconst r = await fetch('http://127.0.0.1:' + PORT + '/json/list');\n"
	};
} else if (CAL === "2") {
	calInject = {
		name: "_cal-good-port.mjs",
		src: 'import { PORT } from "./cdp-port.mjs";\nconst r = await fetch("http://127.0.0.1:" + PORT + "/json/list");\n'
	};
}
const scan = calInject ? files.concat([calInject]) : files;

const missing = [];
const hardcoded = [];
for (const f of scan) {
	if (!/from "\.\/cdp-port\.mjs"/.test(f.src)) missing.push(f.name);
	if (/^const PORT = 9222;$/m.test(f.src)) hardcoded.push(f.name);
}

console.log(" 扫描面：" + scan.length + " 个真机套（`verify-*.mjs` 且用到 CDP）"
	+ (CAL ? "（含 1 个校准注入）" : ""));

if (missing.length === 0) ok("CP-5", "全部真机套均从 `cdp-port.mjs` 取端口（" + scan.length + "/" + scan.length + "）");
else no("CP-5", "仍有 " + missing.length + " 个真机套**没有**接单一真相源：" + missing.join(" / "));

if (hardcoded.length === 0) ok("CP-6", "无残留 `const PORT = 9222;` 硬编码");
else no("CP-6", "残留硬编码 " + hardcoded.length + " 处：" + hardcoded.join(" / "));

/* ── 校准（纪律 ⑥：新闸门必正负对照）─────────────────────────────── */
if (calInject) {
	const hitBad = missing.includes(calInject.name) || hardcoded.includes(calInject.name);
	if (CAL === "1") {
		if (hitBad) ok("CP-CAL", "CAL_HIT —— 注入的硬编码 9222 套被判红（判据成立）");
		else no("CP-CAL", "CAL_MISS —— 注入的硬编码 9222 套**没被判红** ⇒ 闸门失效");
	} else {
		if (!hitBad) ok("CP-CAL", "CAL_OK —— 合规套未被误判（无假红）");
		else no("CP-CAL", "CAL_MISS —— 合规套被误判 ⇒ 闸门过严");
	}
}

/* ── 结论 ─────────────────────────────────────────────────────────── */
console.log("───────────────────────────────────────────────────────────");
console.log(" 通过 " + pass + " / 失败 " + fail + "（共 " + (pass + fail) + " 条断言）");
if (fail > 0) {
	console.log(" 红：" + bad.join(" / "));
	console.log(" 修法：把 `const PORT = 9222;` 换成 `import { PORT } from \"./cdp-port.mjs\";`");
	console.log(" IS_PASS: FALSE");
	process.exit(1);
}
console.log(" IS_PASS: TRUE");
process.exit(0);
