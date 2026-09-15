/**
 * `_cdp-focus.mjs` — 真实鼠标 e2e 的**页面焦点前提**（唯一真相源）
 *
 * ## 现象（实测，2026-09-14 · 批次 6-A）
 * 同一实例连跑 `verify-v20.mjs`：`V-A3`（**纯 hover**）恒绿，而 `V-B2..B5`（真拖）、
 * `V-E6/E7`（真点）**时红时绿** —— 一次运行内"所有 press/release 类交互一起失效"，
 * 而 mouseMoved 类照常。读数形态是「拖动没反应 / 点击无反馈」，
 * 看起来像**产品坏了**，实际只是环境状态不同。
 *
 * ## 原因
 * CDP 的 `Input.dispatchMouseEvent` 在**页面未被判定为 focused** 时：
 *   - `mouseMoved` 照常送达（hover 链路正常）；
 *   - `mousePressed/Released` 会被**当成"激活窗口"的那一下**吞掉
 *     ⇒ 真拖、真点、双击**整体失效**。
 * 这是项目已记录坑「Windows 遮挡检测让输入派发 ~15ms→~4.6s」的**同族**问题：
 * 两者都在**赌窗口/焦点状态**。
 *
 * 注意：`--disable-features=CalculateNativeWinOcclusion` 只解决**遮挡降速**，
 * **不解决焦点**——实测该参数已生效（WMI 读到进程命令行），红仍然复现。
 *
 * ## 对策（不赌环境，显式建立 + 断言 — 纪律 23 / 29）
 *   ① `Page.bringToFront`：把目标窗口提到前台；
 *   ② `Emulation.setFocusEmulationEnabled(true)`：让页面**恒定**被视为 focused，
 *      与 OS 前台窗口无关 ⇒ 输入派发确定可达（这是决定性的一条）。
 *
 * 返回 `{ hasFocus, broughtToFront, focusEmulated, reasons }` ——
 * **降级原因必须外露**（纪律 19：降级可以，无声不行）。
 */

export async function ensurePageFocus({ send, ev, log }) {
	const say = typeof log === "function" ? log : () => { };
	const reasons = [];
	let broughtToFront = false;
	let focusEmulated = false;

	try {
		await send("Page.enable");
		await send("Page.bringToFront");
		broughtToFront = true;
	} catch (e) {
		reasons.push("Page.bringToFront 失败：" + String((e && e.message) || e));
	}

	try {
		await send("Emulation.setFocusEmulationEnabled", { enabled: true });
		focusEmulated = true;
	} catch (e) {
		reasons.push("Emulation.setFocusEmulationEnabled 失败：" + String((e && e.message) || e));
	}

	/* 自证：读回 `document.hasFocus()`。开启焦点仿真后它应为 true；
	 * 若仍为 false，说明页面上有别的元素抢焦点或该 CDP 方法未生效 ⇒ 必须被看到。 */
	let hasFocus = null;
	try {
		const r = await ev("document.hasFocus()");
		hasFocus = r === true;
	} catch (e) {
		reasons.push("读 document.hasFocus() 失败：" + String((e && e.message) || e));
	}
	if (hasFocus === false) reasons.push("document.hasFocus() 仍为 false ⇒ press/release 可能被吞");

	/* 可观测：降级/异常一律打印，便于下一次有人区分「防护生效」与「防护写错但看不出」。 */
	if (reasons.length) say("      [焦点前提] 降级：" + reasons.join(" ｜ "));
	return { hasFocus, broughtToFront, focusEmulated, reasons };
}

/**
 * 给 `verify-v20.mjs` 这类闸门用的**断言包装**：把焦点前提写成一条可判分的检查。
 * 判据 = `hasFocus === true`（这是"press/release 可达"的**必要条件**；
 * 不成立时后续所有鼠标断言都可能以"产品坏了"的形态炸掉，所以必须先判它）。
 */
export async function focusAssertion({ send, ev, log }) {
	const r = await ensurePageFocus({ send, ev, log });
	return { ...r, ok: r.hasFocus === true };
}
