/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：右下角浮动按钮组（全屏能力的统一入口）
 * 引用：V16 诉求 3（按钮位置审美）· 5（设计图入口按钮）
 * 上游：client-entry.js, components/DirectorPage.js, mount.js
 * 下游：store/layout.js, util/debug.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html【板块 A · D0（右下角浮动按钮组 = 三浮层统一入口）】
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/FloatDock.js — 右下角浮动按钮组（全屏能力的统一入口）
 *
 * ══════════════════════════════════════════════════════════════════
 *  这份文件在整体里的位置（改代码前先看这里）
 * ══════════════════════════════════════════════════════════════════
 *  设计稿   docs/50-信息中心/V16-设计图·需求图·交互逻辑.html
 *   ├─ 板块 A · A1 总监页右下角浮动按钮组（视觉与顺序）
 *   ├─ 板块 C · C1 全局导航图（每个按钮打开什么）
 *   └─ 板块 D · D1 设计图工作室（本组内「设计图」按钮的目标）
 *
 *  需求原文（用户）：
 *    · 「你在右下角做的总监插件部分 的前面放一个思维导图的按钮」      ← 顺序：导图在总监之前
 *    · 「在总监页面单独加一个设计图的插件吧，按钮形式 点击铺满全屏」   ← 设计图入口
 *
 * ══════════════════════════════════════════════════════════════════
 *  按钮顺序（**用户明确要求，勿随意调整**）
 * ══════════════════════════════════════════════════════════════════
 *   [🖌 设计图]  [🧠 思维导图]  [◆ 总监]
 *      ↑ 独立插件    ↑ 在总监之前    ↑ 主体
 *   次序理由：三个都属"打开一个全屏 / 浮层能力"，按**粒度由具体到整体**排：
 *   设计图（一张图）→ 思维导图（一棵血缘树）→ 总监（全部治理能力）。
 *
 * ⚠️ 兼容约束：`LAUNCHER_ID` 沿用旧值（`dsh-director-hierarchy-launcher`）挂在
 *    「总监」按钮上 —— 既有真机脚本按此 id 取入口，改名会**静默失联**。
 */

import * as react from "react";
import { directorLayoutStore } from "../store/layout.js";
import { flowStore, lastFlowIdFor as lastFlowId, hasNewFlowFor as hasNewForDim } from "../logic/flow.js";
import { dshLog } from "../util/debug.js";

const h = react.createElement;

/** 浮动组容器 id（真机脚本锚点） */
export const FLOATDOCK_ID = "dsh-director-floatdock";
/** 🔴 保持旧名：既有真机脚本按此 id 取「总监」入口，改名会静默失联 */
export const LAUNCHER_ID = "dsh-director-hierarchy-launcher";
/** 设计图入口按钮 id */
export const DESIGN_BTN_ID = "dsh-design-studio-launcher";
/** 思维导图入口按钮 id（阶段 3 接分支血缘组件） */
export const MINDMAP_BTN_ID = "dsh-mindmap-launcher";

/** 浮动组横向占位（px）—— 页面右端内容按此留白，见下方 🔴 容器 pointerEvents 注释
 *  实测容器宽 98（最长的一颗是「🧠 思维导图」），加 8px 间隙、再取整 ⇒ 108。
 *  由 components/DirectorPage.js 的 R6 / R8 消费（`paddingRight`）。 */
export const FLOAT_DOCK_RESERVE = 108;

/* 🔴 字体色**不能写死浅色**（2026-09-12 随总监页背景改浅一起暴露的缺陷）——
 *   三颗药丸原先的 `color: "#7fe3e8" / "#9fc2ff" / "#b794f6"` 是**给深色底配的浅色字**。
 *   总监页背景改成宿主玻璃底（浅色）后，真机实测对比度只剩
 *     设计图 1.35:1 ｜ 思维导图 1.63:1 ｜ 总监 2.21:1
 *   （WCAG AA 正文线 4.5:1，大号字 3:1）⇒ 放大截图里字几乎看不见。
 *   ⇒ 字色改用**宿主主文字令牌**：浅色主题自动取深字、暗色主题自动取浅字；
 *     强调色只保留在**边框 + 淡底**上 ⇒ 三颗按钮的身份没丢，且底与字都跟着宿主主题走。
 *   🔴 为什么用 `--dsw-alias-*` 而不是自建的 `--dp-*`：本组件挂在
 *     `dsh-director-dialog-host`（body 级图层）下，**不在 `dp-root` 内** ——
 *     实测 `d.querySelector('[data-testid=d-floatdock]').closest('[data-testid=dp-root]') === null`，
 *     所以读不到 `dp-root` 上桥接出来的 `--dp-*`（会静默落 fallback）。
 *     宿主令牌定义在 `body` 上，可被本图层继承 ⇒ 直接用它才是同源。 */
const BTN = {
	position: "relative",
	display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 12.5,
	borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap", backdropFilter: "blur(4px)",
	boxShadow: "var(--dsw-shadow-lv1, 0 4px 14px rgba(0,0,0,.32))", fontFamily: "inherit",
	color: "var(--dsw-alias-label-primary, #e8eaed)",
	/* 🔴 药丸自己**吃**点击；容器**不吃**（见容器 style 的 pointerEvents 注释） */
	pointerEvents: "auto"
};
const V = {
	design: { border: "1px solid rgba(57,197,207,.5)", background: "rgba(57,197,207,.16)" },
	mindmap: { border: "1px solid rgba(47,111,235,.5)", background: "rgba(47,111,235,.16)" },
	director: { border: "1px solid rgba(137,87,229,.5)", background: "rgba(137,87,229,.18)" }
};
/* V17 P3 跨界面流转未读点：lastFlowId / hasNewForDim 复用 logic/flow.js 单一真相源，
 * 首次挂载把历史流转全视为已读，浮层打开即已读，关闭期间到达的新流转点亮小红点。 */

/**
 * 浮动按钮组。
 * @param {object} [props]
 * @param {() => void} [props.onOpenDesign] 覆写设计图打开行为（缺省走 layout store）
 * @param {() => void} [props.onOpenMindmap] 覆写导图打开行为（缺省走 layout store）
 */
export function FloatDock(props = {}) {
	const st = react.useSyncExternalStore(
		(fn) => directorLayoutStore.subscribe(fn),
		() => directorLayoutStore.getState(),
		() => directorLayoutStore.getState()
	);
	/* V17 P3：订阅四维流转，计算每个浮层按钮的未读小红点 */
	const flows = react.useSyncExternalStore(
		(fn) => flowStore.subscribe(fn),
		() => flowStore.getState().flows,
		() => flowStore.getState().flows
	);
	const seenRef = react.useRef(null);
	if (seenRef.current === null) {
		// 首次挂载：历史流转全部视为已读（不为旧数据亮点）
		seenRef.current = { design: lastFlowId(flows, "design"), mindmap: lastFlowId(flows, "mindmap"), director: lastFlowId(flows, "director") };
	}
	const [, bump] = react.useReducer((x) => x + 1, 0);
	// 浮层处于打开态 ⇒ 到达它的流转立即已读（打开期间也持续清）
	react.useEffect(() => {
		const s = seenRef.current; let changed = false;
		if (st.designStudioOpen && s.design !== lastFlowId(flows, "design")) { s.design = lastFlowId(flows, "design"); changed = true; }
		if (st.mindmapOpen && s.mindmap !== lastFlowId(flows, "mindmap")) { s.mindmap = lastFlowId(flows, "mindmap"); changed = true; }
		if (st.dialogOpen && s.director !== lastFlowId(flows, "director")) { s.director = lastFlowId(flows, "director"); changed = true; }
		if (changed) bump();
	}, [st.designStudioOpen, st.mindmapOpen, st.dialogOpen, flows]);
	const unread = {
		design: !st.designStudioOpen && hasNewForDim(flows, "design", seenRef.current.design),
		mindmap: !st.mindmapOpen && hasNewForDim(flows, "mindmap", seenRef.current.mindmap),
		director: !st.dialogOpen && hasNewForDim(flows, "director", seenRef.current.director)
	};
	/** 未读小红点（inline-flex 药丸右上角；testid 供真机断言） */
	const dot = (dim) => unread[dim] ? h("span", {
		key: "unread", "data-testid": "d-unread-" + dim,
		style: { position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: "50%", background: "#f85149", border: "1.5px solid var(--dsw-bg-2,#1c1f24)", boxSizing: "border-box" }
	}) : null;
	/* ── 自适应避让原生输入区（2026-09-12 审美调优）──────────────────
	 * 现象：固定 `bottom:18 / right:18` 时，浮动组与宿主 composer 的「发送」按钮、
	 *       「1 轮 · 1 步」统计文字**重叠**（真机截图可见），既遮挡又难读。
	 * 做法：量出 composer 的顶部，把浮动组**贴在它上方**并留 12px 间距；
	 *       取不到 composer 时回落 18px（不因宿主结构变化而崩）。
	 *       竖排（column）以最小化横向占用，避免横跨输入框。
	 * 为什么不用 `bottom: 50%` 之类固定值：宿主输入区高度会随内容/附件变化，
	 *       固定值迟早再次重叠 —— 量出来才稳。
	 *
	 *  🔴🔴 2026-09-12 真机补漏：**"量一次就存下来"是不够的** —— composer 会**换位置**
	 *   现象：重启后浮动组停在 `bottom:540.8px`（y=172），压在 R2.5 / R2 两行上；
	 *        而当时 composer 顶部=287（正中）⇒ `816-287+12 = 541`，**和存的 540.8 精确吻合**
	 *        ⇒ 不是量错，是**后来 composer 挪了、浮动组没跟着挪**。
	 *   成因（实测取证，别照抄想当然的解释）：
	 *        空会话时宿主把 composer 渲染成**居中的大输入区**（`RWZidW_composerHero`，
	 *        实测 rect [280,287,1154,242]）；会话里有了消息后它**落到底部**
	 *        （实测 rect [280,690,1154,126]）。位置一变，浮动组存的 bottom 就过期了。
	 *        这一变**既没有 `resize` 事件、也不改变根元素盒尺寸** ⇒ 光加 ResizeObserver 也接不到。
	 *   修法第一版：`setInterval(measure, 500)` 轮询。
	 *
	 *  🔴🔴 2026-09-12 第二轮真机补漏：**500ms 固定轮询会"迟一步"** ——
	 *   现象：切会话后**紧接着**断言，浮动组还停在旧几何 `bottom:362px`，
	 *        而当时正确值是 `137.6px`（差 224px；362 恰好对应上一次的 composer 顶 466）。
	 *        肉眼表现就是"按钮位置不对、压住了下面那行的按钮"。
	 *   成因：轮询是**时间驱动**的，几何在两次轮询之间变了 ⇒ 必然存在一整拍的窗口。
	 *   正确做法：**事件优先 + 轮询兜底**（四条触发面，任一触发即 1 帧内重算）：
	 *     ① `MutationObserver`（body 子树，只看 `class` / `style`）—— 直接接住"宿主换 composer 类"
	 *        （`composerHero` → 贴底，就是上面那 224px 的真实成因），这是**全新建模**不是加强轮询；
	 *     ② `ResizeObserver`（盯 composer 自身）—— 接住高度变化（附件 / 多行输入）；
	 *     ③ `scroll`（`capture`，滚动不冒泡 ⇒ 必须 capture）—— 接住位移；
	 *     ④ rAF 节流的兜底复量（约 100ms 一次）—— 上面三条都接不到时仍能收敛。
	 *   为什么用 rAF 而不是继续用 `setInterval`：所有触发面都只是 `mark()` 一个脏位，
	 *   真正的重算在下一帧统一做 ⇒ 突发变更被合并成**每帧最多一次** `getBoundingClientRect()`。
	 *   ⚠️ 不会自激：① 跳过发生在浮动组**内部**的变更（自己改自己的 `bottom` 会进 ① 的回调）；
	 *     ② 值没变时 `setBottomPx` 同值 ⇒ React 直接 bail out ⇒ 不产生新的 DOM 变更。 */
	const [bottomPx, setBottomPx] = react.useState(18);
	react.useEffect(() => {
		/* 量的是 composer 的**外框顶部**（真机实测：`RWZidW_composerSeat` / `_composerStack`，
		 * 会话有消息时两者都落在 y=690，视口 816 ⇒ bottom = 816-690+12 = 138）。
		 * 取不到、或它被藏起来（0×0）时回落 18 —— 不因宿主结构变化而崩。 */
		const measure = () => {
			try {
				const c = document.querySelector('[class*="composer"]');
				if (!c) { setBottomPx(18); return; }
				const r = c.getBoundingClientRect();
				if (r.height < 8 || r.top <= 0) { setBottomPx(18); return; }
				const gap = window.innerHeight - r.top;            // composer 自顶到底的可视高度
				setBottomPx(Math.max(18, Math.min(gap + 12, window.innerHeight - 140)));
			} catch (e) { setBottomPx(18); }
		};

		const RAF_INTERVAL = 100;                              // ④ 兜底轮的节流间隔
		let dirty = true, lastAt = 0, rafId = 0, ro = null, roTarget = null;
		const mark = () => { dirty = true; };
		const isOwn = (el) => Boolean(el && el.nodeType === 1
			&& (el.id === FLOATDOCK_ID || (el.closest && el.closest("#" + FLOATDOCK_ID))));
		/* 把 composer 的 ResizeObserver 挂到**当前**那个元素上（宿主会整个换掉它） */
		const ensureRO = () => {
			const c = document.querySelector('[class*="composer"]');
			if (c && c !== roTarget && typeof ResizeObserver === "function") {
				if (ro) ro.disconnect();
				roTarget = c;
				ro = new ResizeObserver(flush);
				ro.observe(c);
			}
		};
		/* 🔴🔴 2026-09-12 第三轮真机补漏：**复量不能只挂在 rAF 上**。
		 *   现象（verify-flow-r19 F11）：把 composer 上移 150px 后，`expected` 已经变成 287.6，
		 *        而浮动组的 `bottom` 在 1600ms 内**一动没动**（137.6），收敛轮次耗尽判红；
		 *        同一份代码随后单独复跑（探针 s4）却 700ms 内正常跟随到 287.6——**偶发**。
		 *   成因：`requestAnimationFrame` 在**窗口被遮挡/不可见时会被 Chromium 暂停**
		 *        （宿主窗口在后台是常态：跑 e2e 时没人盯着它）。于是"mark 脏位 → 下一帧复量"
		 *        这条链在后台窗口里**可以整段不执行** —— 而当时 DOM 变更（style）明明发生了。
		 *   正确做法：**事件直达**。与 composer 有关的变更（它自己或它的祖先换了 class/style）
		 *        在 MutationObserver 回调里**当场复量**，不等 rAF；rAF 只保留给
		 *        scroll / resize / 兜底（那几类丢一两帧无所谓，下一帧还会来）。
		 *   ⚠️ 不会自激：① 浮动组自己子树里的变更被 `isOwn` 跳过（本组件只改自己的 `bottom`；
		 *      同值 setState 时 React 直接 bail out，根本不产生新变更）；
		 *      ② 其余变更走原来的 `mark()`，量测频率不升反降（只对"与 composer 相关"的变更加急）。 */
		const flush = () => {
			if (!dirty) return;
			dirty = false;
			lastAt = (typeof performance !== "undefined" ? performance.now() : Date.now());
			measure();
			ensureRO();
		};

		const tick = (ts) => {
			rafId = requestAnimationFrame(tick);
			if (!dirty && ts - lastAt < RAF_INTERVAL) return;
			dirty = false; lastAt = ts;
			measure();
			/* ② composer 元素可能被宿主整个换掉 ⇒ 目标变了就重挂 ResizeObserver */
			ensureRO();
		};

		/* ① 宿主换 composer 类 / 改内联样式 —— 这是"位置变了但没事件"的真实成因。
		 *   与 composer 相关的变更**当场复量**（见 flush 注释：后台窗口 rAF 会被暂停）。 */
		const mo = typeof MutationObserver === "function"
			? new MutationObserver((recs) => {
				let touchComposer = false;
				for (const r of recs) {
					if (isOwn(r.target)) continue;
					dirty = true;
					/* 首次进来时 roTarget 还没挂上 ⇒ 也当作"相关"（只多量一次，代价可忽略） */
					if (!roTarget || r.target === roTarget
						|| (r.target.nodeType === 1 && r.target.contains(roTarget))) { touchComposer = true; }
				}
				if (touchComposer) flush();
			})
			: null;
		if (mo) {
			try { mo.observe(document.body, { attributes: true, attributeFilter: ["class", "style"], subtree: true }); }
			catch (e) { /* body 尚未就绪：兜底轮询仍能收敛 */ }
		}

		/* ③ 滚动位移（capture：scroll 不冒泡）＋ 窗口尺寸 */
		const onScroll = () => mark();
		const onResize = () => mark();
		window.addEventListener("scroll", onScroll, { capture: true, passive: true });
		window.addEventListener("resize", onResize);

		measure();
		const raf = requestAnimationFrame(measure);            // 首帧后再量一次（boot 期布局未定）
		rafId = requestAnimationFrame(tick);
		const timers = [300, 1200, 2500].map((ms) => setTimeout(measure, ms)); // 布局稳定后复测
		return () => {
			window.removeEventListener("scroll", onScroll, { capture: true });
			window.removeEventListener("resize", onResize);
			cancelAnimationFrame(raf);
			cancelAnimationFrame(rafId);
			if (ro) ro.disconnect();
			if (mo) mo.disconnect();
			timers.forEach(clearTimeout);
		};
	}, []);
	if (st.floatDockOpen === false) return null;

	const openDesign = props.onOpenDesign || (() => { directorLayoutStore.toggleOverlay("design"); dshLog("design", "浮动入口：toggle 设计图工作室"); });
	const openMindmap = props.onOpenMindmap || (() => { directorLayoutStore.toggleOverlay("mindmap"); dshLog("mindmap", "浮动入口：toggle 分支导图"); });
	const toggleDirector = () => { directorLayoutStore.toggleOverlay("director"); };

	return h("div", {
		id: FLOATDOCK_ID, "data-testid": "d-floatdock",
		// 位置：右下角、**自适应贴在 composer 之上**（见上方 measure 注释）；
		// 竖排减少横向占用；z-index 低于弹窗与工作室，保证全屏层永远在上面
		style: {
			position: "fixed", right: 18, bottom: bottomPx, zIndex: 2147482990,
			display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end",
			/* 🔴 容器必须**透明化点击**（pointer-events:none）——
			 *   容器是 98×103 的盒子，而三颗药丸长度不一（81 / 98 / 63）且竖排有 6px 间隙
			 *   ⇒ 盒子里有大片**看不见的空隙**（药丸之间的缝、短药丸左侧的 35px）。
			 *   默认 `pointer-events:auto` 时这些空隙照样吃掉鼠标事件。
			 *   真机实测（2026-09-12，1442×816）：
			 *     本页自己的「交给总监整理」(dp-send，89×24) 有 **88×19 px 落在容器内**，
			 *     `document.elementFromPoint(1340,670)` 最上层 = `d-floatdock`
			 *     ⇒ 那颗按钮**点不动**（正是用户抱怨过的"所有按钮交互都不好用"那一类）。
			 *     同批被吃掉的还有 dp-r6 / dp-r7 / dp-r8 / dp-r8-note 共 5 处。
			 *   改法：容器 `none` + 药丸自己 `auto`（浮动工具条的标准做法）。 */
			pointerEvents: "none"
		}
	}, [
		h("button", {
			key: "design", id: DESIGN_BTN_ID, type: "button",
			style: { ...BTN, ...V.design, ...(st.designStudioOpen ? { boxShadow: "0 0 0 2px rgba(57,197,207,.6), 0 0 0 5px rgba(57,197,207,.15)" } : {}) },
			"data-testid": "d-open-design", "data-active": st.designStudioOpen ? "1" : "0", title: "打开设计图工作室（铺满全屏 · 可拖拽编辑 · 元素带交互逻辑）",
			onClick: openDesign
		}, [h("span", { key: "i" }, "🖌"), h("span", { key: "t" }, "设计图"), dot("design")]),
		h("button", {
			key: "mindmap", id: MINDMAP_BTN_ID, type: "button",
			style: { ...BTN, ...V.mindmap, ...(st.mindmapOpen ? { boxShadow: "0 0 0 2px rgba(47,111,235,.6), 0 0 0 5px rgba(47,111,235,.15)" } : {}) },
			"data-testid": "d-open-mindmap", "data-active": st.mindmapOpen ? "1" : "0", title: "打开分支导图（血缘树 · 底栏可交总监路由）",
			onClick: openMindmap
		}, [h("span", { key: "i" }, "🧠"), h("span", { key: "t" }, "思维导图"), dot("mindmap")]),
		h("button", {
			key: "director", id: LAUNCHER_ID, type: "button",
			style: { ...BTN, ...V.director, ...(st.dialogOpen ? { boxShadow: "0 0 0 2px rgba(137,87,229,.6), 0 0 0 5px rgba(137,87,229,.15)" } : {}) },
			"aria-label": "打开总监", "data-testid": "d-open-director", "data-active": st.dialogOpen ? "1" : "0", title: "打开总监（弹窗三态）",
			onClick: toggleDirector
		}, [h("span", { key: "i" }, "◆"), h("span", { key: "t" }, "总监"), dot("director")])
	]);
}

export default FloatDock;
