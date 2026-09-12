#!/usr/bin/env node
/**
 * verify-design-html.mjs —— 设计稿 HTML 卫生五项校验 + 自检校准
 *
 * 用法:
 *   node scripts/verify-design-html.mjs <file.html>      # 校验
 *   node scripts/verify-design-html.mjs --selftest       # 正负对照自检
 *
 * 五项判据（前四项来自 V13/V15 已确立的设计稿卫生标准）:
 *   1. LF 无 CRLF
 *   2. 零反引号（模板字符串/引用反引号会截断，且与 HTML 无关）
 *   3. 字号底线 >= 10.5px
 *   4. 标签平衡（剥离 <style> 与 <code> 引用后计数）
 *   5. class 消费方 -> 定义方 对账（新增：防"死样式/裸样式"）
 *
 * 判据污染防护（V15.1 踩坑）: 校验前必须剥离 <code>...</code>，
 * 否则审核表里引用的旧代码文本会污染判据、造成假阳性/假阴性。
 */
import fs from "node:fs";

const MIN_FONT = 10.5;
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "col",
  "area", "base", "wbr", "embed", "track", "param"]);

/** 剥离会被当作"证据文本"而非"真实结构"的区块 */
export function strip(s) {
  return s
    .replace(/<style>[\s\S]*?<\/style>/gi, "")
    .replace(/<code>[\s\S]*?<\/code>/gi, "");
}

export function check(raw, opts = {}) {
  const s = raw.toString("utf8");
  const res = [];
  const add = (name, ok, detail, flags = {}) => res.push({ name, ok, detail, info: !!flags.info });

  // 1 LF 无 CRLF
  const cr = (raw.toString("latin1").match(/\r/g) || []).length;
  add("LF 无 CRLF", cr === 0, `CR(0x0D) = ${cr}`);

  // 2 零反引号
  const bq = (s.match(/`/g) || []).length;
  add("零反引号", bq === 0, `${bq} 个`);

  // 3 字号底线
  const sizes = [...s.matchAll(/font-size\s*:\s*([\d.]+)px/gi)].map((m) => Number(m[1]));
  const bad = sizes.filter((v) => v < MIN_FONT);
  add(`字号 >= ${MIN_FONT}px`, bad.length === 0,
    `样本 ${sizes.length} 个 · min = ${sizes.length ? Math.min(...sizes) : "n/a"} · 违规 ${bad.length} 处${bad.length ? " [" + [...new Set(bad)].join(",") + "]" : ""}`);

  // 4 标签平衡
  const body = strip(s);
  const stack = [];
  const errs = [];
  for (const m of body.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    const closing = m[0][1] === "/";
    const selfClose = /\/\s*>$/.test(m[0]);
    if (VOID.has(tag) || selfClose) continue;
    if (!closing) stack.push(tag);
    else {
      const top = stack.pop();
      if (top !== tag) errs.push(`期望 </${top}> 实得 </${tag}>`);
    }
  }
  add("标签平衡", errs.length === 0 && stack.length === 0,
    `未闭合 ${stack.length}${stack.length ? " [" + stack.slice(0, 6).join(",") + "]" : ""} · 错配 ${errs.length}${errs.length ? " " + errs.slice(0, 2).join(" | ") : ""}`);

  // 5 class 对账
  const css = (s.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [, ""])[1];
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const used = new Set(
    [...body.matchAll(/class\s*=\s*"([^"]*)"/gi)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter(Boolean)
  );
  const undef = [...used].filter((c) => !defined.has(c));
  const unused = [...defined].filter((c) => !used.has(c));
  add("class 全部有定义", undef.length === 0,
    undef.length ? `无定义: ${undef.join(" ")}` : `消费 ${used.size} 个 · 全部命中`);
  if (opts.reportUnused) add("class 全部被消费", unused.length === 0,
    `未消费 ${unused.length} 个${unused.length ? ": " + unused.join(" ") : ""}（组件变体库允许留用，仅提示）`,
    { info: true });

  return res;
}

function run(file, opts) {
  const raw = fs.readFileSync(file);
  const res = check(raw, opts);
  console.log(`文件: ${file}`);
  console.log(`大小: ${raw.length} B`);
  console.log("-".repeat(72));
  for (const r of res) {
    const tag = r.info ? "INFO" : r.ok ? "PASS" : "FAIL";
    console.log(`${tag}  ${r.name.padEnd(22)} ${r.detail}`);
  }
  const hard = res.filter((r) => !r.info);
  const fails = hard.filter((r) => !r.ok).length;
  console.log("-".repeat(72));
  console.log(`IS_PASS: ${fails === 0 ? "TRUE" : "FALSE"}  (硬判据 ${hard.length - fails}/${hard.length}${res.length !== hard.length ? ` · 提示 ${res.length - hard.length} 项不计入` : ""})`);
  return fails === 0;
}

function selftest() {
  console.log("== 自检 · 正负对照（规则 F：新闸门必须校准）==");
  const good = `<div class="a"><span>ok</span><br></div><style>.a{font-size:12px;color:#fff}</style>`;
  const badFont = `<div class="a"><span>x</span></div><style>.a{font-size:9px}</style>`;
  const badTag = `<div class="a"><span>x</div><style>.a{font-size:12px}</style>`;
  const badClass = `<div class="zzz"><span>x</span></div><style>.a{font-size:12px}</style>`;
  const badCRLF = Buffer.from(`<div class="a"><span>x</span></div><style>.a{font-size:12px}</style>\r\n`, "utf8");
  const badBacktick = "`";
  const pollutionOk = `<div class="a"><code><div class="ghost"></code><span>x</span></div><style>.a{font-size:12px}</style>`;

  const cases = [
    ["好样本（全绿）", Buffer.from(good, "utf8"), true],
    ["坏样本 字号 9px", Buffer.from(badFont, "utf8"), false],
    ["坏样本 标签未闭合", Buffer.from(badTag, "utf8"), false],
    ["坏样本 class 无定义", Buffer.from(badClass, "utf8"), false],
    ["坏样本 含 CRLF", badCRLF, false],
    ["坏样本 含反引号", Buffer.from(good + badBacktick, "utf8"), false],
    ["好样本 · code 内引用不污染判据", Buffer.from(pollutionOk, "utf8"), true],
  ];
  let ok = 0;
  for (const [name, buf, expect] of cases) {
    const pass = check(buf).every((r) => r.ok);
    const hit = pass === expect;
    ok += hit ? 1 : 0;
    console.log(`${hit ? "PASS" : "FAIL"}  ${name.padEnd(36)} 期望=${expect ? "绿" : "红"} 实得=${pass ? "绿" : "红"}`);
  }
  console.log("-".repeat(72));
  console.log(`自检: ${ok}/${cases.length} ${ok === cases.length ? "✅ 判据已校准" : "❌ 判据失真"}`);
  process.exit(ok === cases.length ? 0 : 1);
}

const args = process.argv.slice(2);
if (args[0] === "--selftest") selftest();
else if (!args[0]) { console.error("用法: node scripts/verify-design-html.mjs <file.html> | --selftest"); process.exit(2); }
else process.exit(run(args[0], { reportUnused: args.includes("--unused") }) ? 0 : 1);
