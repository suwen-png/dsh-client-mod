#!/usr/bin/env node
/**
 * clean-session-ui-state.mjs —— 会话残留的**第四落点**清理（localStorage）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要它（第 21 批新增，回答"清了却还在"）
 * ──────────────────────────────────────────────────────────────────
 * `clean-sessions.mjs` 清的是**盘上三处**（磁盘 sessions / workspace.json / projcache）。
 * 但会话还有**第四落点**：`localStorage` 里按会话 id 存的状态 ——
 *   · `dsh.conversation.chat.<sessionId>`   宿主侧的输入草稿等（**宿主写、宿主读**）
 *   · `dsh.sessions.current`                 "上次看的是哪条"
 *   · `dsh.director.split` 的 `items`        插件侧分流索引（每会话一条）
 *   · `dsh.director.dossier` 的 `items`      插件侧会话档案（每会话一条）
 * ⇒ 会话删了，这些键**不会自己消失** ⇒ 下一轮"按索引复用"时命中**孤儿**，
 *   表现为"清空了却还认得旧会话"（同名坑见 `stale-artifact-guard` §7）。
 *
 * 🔴 安全边界（**绝不整体 clear**）：
 *   只删**按会话 id 精确命中且该 id 已不在存活集**的项；
 *   `dsh.director.design` / `personalize` / `layout` 等**非会话键一律不碰**。
 *
 * 🔴 判据与产品**同一口径**：存活集 = 宿主快照 − 归档集
 *   （`__dshBranchTree.archivedSessionIds()`；`null` ⇒ **不清理**，宁可不删也不误删）。
 *
 * 用法：node scripts/clean-session-ui-state.mjs            # dry-run（只列候选）
 *       node scripts/clean-session-ui-state.mjs --apply    # 真删
 * 退出码：0 成功 / 1 有失败 / 2 用法错
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CDP_EVAL = resolve(HERE, "cdp-eval.mjs");

const argv = process.argv.slice(2);
const apply = argv.indexOf("--apply") >= 0;
const known = ["--apply", "--verbose"];
for (const a of argv) {
	if (a.startsWith("--") && known.indexOf(a) < 0) {
		console.log("未知参数：" + a + "（可用：--apply / --verbose）");
		process.exit(2);
	}
}

/** 浏览器侧表达式：先算存活集，再逐键判定（dry-run 时只列不动） */
function expr(doApply) {
	return "(async function(){"
		+ "var b=window.__dshBranchTree;if(!b)return JSON.stringify({ok:false,reason:'no __dshBranchTree（插件未装载）'});"
		+ "var arch=null;try{arch=await b.archivedSessionIds()}catch(e){arch=null}"
		+ "if(!Array.isArray(arch))return JSON.stringify({ok:false,reason:'归档集读不到 ⇒ 按纪律不清理'});"
		+ "var archSet={};for(var i=0;i<arch.length;i++)archSet[String(arch[i])]=1;"
		+ "var c=window.__cordis_ctx__;var s=c&&c.get('sessions');var snap=null;"
		/* 🔴 快照在 `sessions.list`（服务自己的一级成员），**不在** `sessions.manager.list`。
		 *    写错路径会被 try/catch 吞成 `snap=null` ⇒ `live` 空 ⇒ **把活会话也判成死的**
		 *    （实测踩过：`liveN=0` 而真值是 1 ——「数出 0 ≠ 没有」，纪律 60）。 */
		+ "try{snap=s.list.getSnapshot()}catch(e){snap=null}"
		+ "if(!snap){try{snap=s.manager.list.getSnapshot()}catch(e2){snap=null}}"
		+ "if(!snap)return JSON.stringify({ok:false,reason:'会话快照读不到（sessions.list.getSnapshot）⇒ 按纪律不清理'});"
		+ "var ids=(snap.ids)||[];var live={};"
		+ "for(var j=0;j<ids.length;j++){if(!archSet[String(ids[j])])live[String(ids[j])]=1;}"
		+ "var liveN=Object.keys(live).length;"
		+ "var kill=[];var kept=0;"
		+ "function isLive(id){return !!live[String(id)]}"
		/* ① 宿主会话残留键（按会话 id 精确匹配，别的键一律不碰） */
		+ "var all=[];for(var q=0;q<localStorage.length;q++)all.push(localStorage.key(q));"
		+ "for(var t=0;t<all.length;t++){var k=all[t];"
		+ "var m=/^dsh\\.conversation\\.chat\\.(.+)$/.exec(k);"
		+ "if(m){if(isLive(m[1]))kept++;else kill.push({key:k,why:'会话已不在存活集'});}}"
		/* ② dsh.sessions.current 指向死会话 ⇒ 删 */
		+ "var cur=localStorage.getItem('dsh.sessions.current');"
		+ "if(cur){var cid=null;try{cid=String(JSON.parse(cur).sessionId||'')}catch(e){cid=String(cur)}"
		+ "if(cid&&!isLive(cid))kill.push({key:'dsh.sessions.current',why:'指向已不在存活集的会话 '+cid.slice(0,20)});}"
		/* ③ 插件侧两个索引的孤儿条目 */
		+ "var IDX=['dsh.director.split','dsh.director.dossier'];"
		+ "for(var x=0;x<IDX.length;x++){var kn=IDX[x];var raw=localStorage.getItem(kn);if(!raw)continue;"
		+ "var obj=null;try{obj=JSON.parse(raw)}catch(e){continue}"
		+ "var items=obj&&obj.items?obj.items:null;if(!items)continue;"
		+ "var orph=[];var ks=Object.keys(items);"
		+ "for(var y=0;y<ks.length;y++){if(!isLive(ks[y]))orph.push(ks[y]);}"
		+ "if(orph.length)kill.push({key:kn,why:'孤儿条目 '+orph.length+' 条（共 '+ks.length+'）',orphans:orph});}"
		/* 只报判定结果；--apply 才真正写 */
		+ (doApply
			? "for(var z=0;z<kill.length;z++){var e=kill[z];"
				+ "if(e.orphans){var raw2=localStorage.getItem(e.key);var o2=null;try{o2=JSON.parse(raw2)}catch(q){o2=null}"
				+ "if(o2&&o2.items){for(var w=0;w<e.orphans.length;w++)delete o2.items[e.orphans[w]];"
				+ "localStorage.setItem(e.key,JSON.stringify(o2));}}"
				+ "else localStorage.removeItem(e.key);}"
			: "")
		+ "return JSON.stringify({ok:true,apply:" + (doApply ? "true" : "false")
		+ ",archivedN:arch.length,liveN:liveN,removedN:kill.length,removed:kill.slice(0,40),keptChat:kept});"
		+ "})()";
}

function run(expression) {
	const r = spawnSync(process.execPath, [CDP_EVAL, expression], { encoding: "utf8", timeout: 60000 });
	if (r.status !== 0) {
		console.log("CDP 调用失败（exit " + r.status + "）：" + String(r.stderr || "").slice(0, 300));
		return null;
	}
	const txt = String(r.stdout || "").trim();
	const line = txt.split("\n").filter((l) => l.trim().startsWith("{")).pop();
	if (!line) { console.log("无法解析输出：" + txt.slice(0, 200)); return null; }
	try { return JSON.parse(line); } catch (e) { console.log("JSON 解析失败：" + line.slice(0, 200)); return null; }
}

console.log("═══ clean-session-ui-state · localStorage 第四落点 ═══");
console.log("  模式：" + (apply ? "APPLY（真删）" : "DRY-RUN（只列候选）"));

const before = run(expr(false));
if (!before || !before.ok) {
	console.log("  ✖ " + ((before && before.reason) || "读取失败"));
	process.exit(1);
}
console.log("  归档集 " + before.archivedN + " 条 · 存活集 " + before.liveN + " 条 · 保留的会话键 " + before.keptChat + " 条");
console.log("  候选清理 " + before.removedN + " 项：");
for (const e of before.removed || []) console.log("    - " + e.key + "  ← " + e.why);

if (!apply) {
	console.log("  （dry-run 结束；加 --apply 才真正写入）");
	process.exit(0);
}
if (!before.removedN) { console.log("  无需清理。"); process.exit(0); }

const applied = run(expr(true));
if (!applied || !applied.ok) {
	console.log("  ✖ 写入失败：" + ((applied && applied.reason) || "表达式异常 ⇒ 见上方输出"));
	process.exit(1);
}
console.log("  已写入：" + applied.removedN + " 项（浏览器侧自报）");

const after = run(expr(false));
if (!after || !after.ok) { console.log("  ✖ 清理后复读失败：" + ((after && after.reason) || "见上方输出")); process.exit(1); }
console.log("  清理后复核：剩余候选 " + after.removedN + " 项（期望 0）");
const ok = after.removedN === 0;
console.log("  IS_PASS: " + (ok ? "TRUE" : "FALSE"));
process.exit(ok ? 0 : 1);
