/**
 * `_cdp-focus.mjs` — 真实鼠标 e2e 的**页面焦点前提**（唯一真相源）
 *
 * ## 现象（实测，2026-09-14 · 批次 6-A）
 * 同一实例连跑 `verify-v20.mjs`：`V-A3`（**纯 hover**）恒绿，而 `V-B2..B5`（真拖）、
 * `V-E6/E7`（真点）**时红时绿** —— 一次运行内"所有 press/release 类交互一起失效"，
 * 而 mouseMoved 类照常。读数形态是「拖动没反应 / 点击无反馈」，
 * 看起来像**产品坏了**，实际只是环境状态不同。
 *
 * ## 原因（2026-09-17 第二十四轮**修正**：不是 focus，是 visibility）
 * CDP 的 `Input.dispatchMouseEvent` 在 `document.visibilityState !== "visible"` 时：
 *   - `mouseMoved` 照常送达（hover 链路正常）；
 *   - `mousePressed/Released` 会被**当成"激活窗口"的那一下**吞掉
 *     ⇒ 真拖、真点、双击**整体失效**。
 *
 * 🔴 **关键修正**：`document.hasFocus()` 在窗口 hidden 时**仍然是 `true`** ——
 *    它是个骗人的代理指标。第二十四轮实测对照（同页面同坐标，只差一次 bringToFront）：
 *      hidden  ⇒ 送达 `["pointermove","pointermove"]`（press/release/click 全丢）
 *      visible ⇒ 送达 `["pointermove","pointerdown","mousedown","pointermove",
 *                       "pointerup","click"]`
 *    ⇒ **判据只认 `visibilityState`**，`hasFocus` 降级为观测项。
 *
 * 这是项目已记录坑「Windows 遮挡检测让输入派发 ~15ms→~4.6s」的**同族**问题：
 * 两者都在**赌窗口/可见性状态**。
 *
 * 注意：`--disable-features=CalculateNativeWinOcclusion` 只解决**遮挡降速**，
 * **不解决可见性**——实测该参数已生效（WMI 读到进程命令行），红仍然复现。
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

	/* 🧪 负向校准钩子（纪律 32：**新检查必须植入目标缺陷校准**，正常跑不设）
	 *    `DSH_FOCUS_CALIBRATE=hidden` ⇒ 跳过一切建立动作、直接回报 hidden，
	 *    模拟"窗口不可见且无法恢复"。此时闸门应：
	 *      · 可见性前提断言**恰红一条**；
	 *      · 结论判 **INVALID**（exit 2），**不是**判产品红。
	 *    若设了这个变量套件仍然全绿 ⇒ 说明这条检查是恒绿的摆设（纪律 23）。 */
	if (process.env.DSH_FOCUS_CALIBRATE === "hidden") {
		reasons.push("[校准] DSH_FOCUS_CALIBRATE=hidden ⇒ 已跳过建立动作，模拟窗口不可见");
		say("      [焦点前提] 降级：" + reasons.join(" ｜ "));
		return { hasFocus: true, visibility: "hidden", visible: false,
			broughtToFront: false, focusEmulated: false, reasons };
	}

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

	/* ─────────────────────────────────────────────────────────────────────
	 * 🔴 自证：**真正的门槛是 `visibilityState`，不是 `hasFocus`**（第二十四轮实测推翻）
	 *
	 * 现象：同一实例上，真机套件里**每一处**真实鼠标都"点了没后果"，
	 *       `elementFromPoint` 明确命中自己、坐标在视口内、零 CDP 超时、零页面异常
	 *       ⇒ 上一轮据此判为「Electron 静默丢事件（U6）」，并给 30 处点击加了
	 *       `el.click()` 兜底。兜底确实让套件变绿，但也**把真因盖住了**。
	 *
	 * 实测对照（同一页面、同一坐标、只差一次 bringToFront）：
	 *   visibilityState="hidden"  ⇒ 送达 ["pointermove","pointermove"]
	 *                                —— pointerdown/mousedown/pointerup/click **全丢**
	 *   visibilityState="visible" ⇒ 送达 ["pointermove","pointerdown","mousedown",
	 *                                     "pointermove","pointerup","click"]（完整）
	 *
	 * 🔴 最坑的一点：**两次 `document.hasFocus()` 都是 `true`**。
	 *    也就是说 `hasFocus` 是个**会骗人的代理指标** —— 它恒真，
	 *    于是"用 hasFocus 做前提"的检查永远不会红，而输入**从来没真正送达过**。
	 *    ⇒ 判据改认 `visibilityState === "visible"`；`hasFocus` 只作**观测**保留。
	 *
	 * 为什么窗口会是 hidden：Electron 窗口被遮挡 / 最小化 / 停在后台，
	 *    CDP 仍能连、`Runtime.evaluate` 照常执行 ⇒ 一切都"看起来正常"，
	 *    **只有 press 类输入静默消失**。这正是纪律 18 说的「跳过比红更危险」的同族：
	 *    「**降级执行比报错更危险**」。
	 * ───────────────────────────────────────────────────────────────────── */
	const readVis = async () => {
		try {
			const r = await ev("document.visibilityState");
			return typeof r === "string" ? r : "__unread";
		} catch (e) {
			reasons.push("读 document.visibilityState 失败：" + String((e && e.message) || e));
			return "__unread";
		}
	};
	let visibility = await readVis();
	/* 窗口还原是异步的：bringToFront 之后可能要一拍才变 visible ⇒ 有界重读（纪律 55）。 */
	for (let i = 0; i < 12 && visibility !== "visible"; i++) {
		await new Promise((r) => setTimeout(r, 250));
		visibility = await readVis();
		/* 重提一次前台：只等不重试会把「一次没提到前台」读成「环境不支持」 */
		if (visibility !== "visible" && i === 3) {
			try { await send("Page.bringToFront"); } catch (e) { /* 已记过 reasons */ }
		}
	}
	if (visibility !== "visible") {
		reasons.push("visibilityState 仍为 " + JSON.stringify(visibility)
			+ " ⇒ press/release 会被吞；真实鼠标断言在此环境下**不可信**（应判 INVALID，不是判产品红）");
	}

	/* 观测项：`hasFocus` 恒真的特性已被实测记录，保留它只为对照，不作判据。 */
	let hasFocus = null;
	try {
		const r = await ev("document.hasFocus()");
		hasFocus = r === true;
	} catch (e) {
		reasons.push("读 document.hasFocus() 失败：" + String((e && e.message) || e));
	}

	/* 可观测：降级/异常一律打印，便于下一次有人区分「防护生效」与「防护写错但看不出」。 */
	if (reasons.length) say("      [焦点前提] 降级：" + reasons.join(" ｜ "));
	return { hasFocus, visibility, visible: visibility === "visible", broughtToFront, focusEmulated, reasons };
}

/**
 * 给闸门用的**断言包装**：把焦点前提写成一条可判分的检查。
 *
 * 🔴 判据（第二十四轮修订）：`visibility === "visible"`，**不再**用 `hasFocus`。
 *    理由见 `ensurePageFocus` 内的实测对照 —— `hasFocus` 在窗口 hidden 时**仍为 true**，
 *    拿它当判据等于"永远绿"，于是一切真实鼠标断言都在**降级态**下跑完却无人知晓。
 *    不成立时后续所有鼠标断言都会以「产品坏了」的形态炸掉 ⇒ 必须先判它，且**判 INVALID**。
 */
export async function focusAssertion({ send, ev, log }) {
	const r = await ensurePageFocus({ send, ev, log });
	return { ...r, ok: r.visible === true };
}
