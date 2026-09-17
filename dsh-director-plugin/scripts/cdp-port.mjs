#!/usr/bin/env node
/**
 * cdp-port.mjs —— CDP 端口的**唯一真相源**（§八 纪律 126 的落地）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要单独一个文件（不是"方便"，是踩过坑）
 * ──────────────────────────────────────────────────────────────────
 * 本仓曾有**两个**端口标识符：`CDP_PORT`（启动器真正用的）与 `DSH_CDP_PORT`。
 * 更糟的是：14 个真机套件里有 9 个**根本不读环境变量**，直接 `const PORT = 9222;`
 * ⇒ 一旦 9222 被幽灵占用、启动器**顺移**到 9223，就会出现：
 *
 *      启动器在 9223 拉起 Harness，9 套却去连 9222
 *      ⇒ 全部报「连不上 CDP 9222 / INVALID」
 *      ⇒ 看起来像"真机环境坏了"、"产品起不来"，其实只是**读错了端口**
 *
 * 症状与真因毫无表面关联（纪律 126）。修法不是给 9 个文件各打一个补丁，
 * 而是让**所有真机套从同一个地方取值**。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   import { PORT } from "./cdp-port.mjs";
 *
 * ── 取值顺序（**不可颠倒**）──────────────────────────────────────────
 *   ① `CDP_PORT`      —— 启动器 / `_run-with-harness.mjs` / `run-live.mjs` 用的就是它
 *   ② `DSH_CDP_PORT`  —— 历史别名，仅作兜底（纪律 7：冻结契约只许新增，不可改名）
 *   ③ 9222            —— 缺省
 *
 * ⚠️ 想改端口请设 `CDP_PORT`，不要直接改这里的常量。
 */

export const DEFAULT_CDP_PORT = 9222;

/** 端口别名归一：`CDP_PORT` 优先（`CDP_PORT` 才是启动器真正写的那个） */
export const PORT = Number(
	process.env.CDP_PORT || process.env.DSH_CDP_PORT || DEFAULT_CDP_PORT
);

/** 人类可读的来源说明，用于报错时指认真因（纪律 65：失败原因必须落地） */
export const PORT_SOURCE = process.env.CDP_PORT
	? "CDP_PORT"
	: process.env.DSH_CDP_PORT
		? "DSH_CDP_PORT（历史别名）"
		: "缺省 " + DEFAULT_CDP_PORT;

export default PORT;
