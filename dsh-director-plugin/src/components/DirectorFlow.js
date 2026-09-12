/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：E1 小窗总监对话流组件
 * 引用：批次 6
 * 上游：client-entry.js
 * 下游：store/create-store.js, store/use-store.js, util/debug.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/DirectorFlow.js — E1 小窗总监对话流组件
 *
 * 迁移来源：workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js
 *   源区间：**6972 ~ 7085**（含区块头注释；组件体 6973~7084）
 *   迁移方式：**逐字保真**，唯一例外见下方 🔴「迁移期修正」
 *
 * 依赖映射（宿主内联 → 插件模块）
 *   directorStoreFactory ← store/create-store.js（A9）
 *   useDirectorStore     ← store/use-store.js（A10）
 *   dshLog / dshScrollProbe ← util/debug.js（D3）
 *   react / react/jsx-runtime ← **平台模块**（构建期外置为 `require(...)`，不打包；见 ADR-001）
 *
 * 调用方（**本批次不改接线**）
 *   宿主 client.js:7358 —— 小窗（a-2 / b-2）内 `(0, react_jsx_runtime.jsx)(DirectorFlow, {...})`
 *   宿主侧调用点属**批次 6**接线范围；本批次提供插件侧实现与全局契约。
 *
 * 🔴🔴 迁移期修正（唯一偏离「逐字保真」处，务必勿回退）
 *
 *   宿主原代码 7050 行（快照实测）：
 *       `: filteredMessages.map((msg) =>`
 *   而 `filteredMessages` 在**宿主全文件中从未于 `DirectorFlow` 作用域内定义**：
 *     · 快照 `snapshot-20260902-103319` 实测：使用点 = 7047；定义点 = **9161**，
 *       位于 `const filteredMessages = (0, react.useMemo)(...)`，处于**兄弟组件 `DirectorView` 的函数作用域内**；
 *     · `DirectorFlow` 与 `DirectorView` 是同级兄弟函数，**作用域互不可见** ⇒ 该引用**自诞生即为越界引用**；
 *     · 2026-09-08 P2 死代码清理删除 `DirectorView`（墓志铭 client.js:8897）后，**连越界定义也消失**，
 *       该标识符在当前宿主中 **全文件零定义**（`grep -c "filteredMessages"` = 1，仅命中使用点 7050）。
 *   后果：只要组件被渲染且 `state.messages.length > 0`，必然抛 `ReferenceError: filteredMessages is not defined`。
 *
 *   修正：改用 `state.messages`（与本文件 7048 行 `state.messages.length` 的数据源一致）。
 *   语义：`filteredMessages` 的原意是「按当前分支过滤后」的消息列表；分支过滤能力属于
 *        `DirectorView` 的状态体系（`currentBranch` / `switchToBranch`），不在 E1 迁移边界内。
 *        故此处**降级为渲染全部消息** —— 这是最小且语义正确的修复，不越界扩张迁移范围。
 *   ⚠️ 若未来要恢复分支过滤，应作为**独立需求**实现（先定义 `DirectorFlow` 自身的 currentBranch 状态），
 *       **禁止**再把 `DirectorView` 的局部变量直接引用过来。
 *
 * ⚠️ 其他迁移保真要点（勿顺手优化）
 *   - `dfFindScroller` 向上最多 15 层寻找可滚动祖先；`V9.2` 的 `minHeight:0` 样式修复必须保留（否则 flex 链高度塌陷）。
 *   - `V9.4-P1 atBottom 守卫`：用户上翻历史时不抢回底部；但用户自己发消息（`lastMsg.role === "user"`）仍强制滚底。
 *   - 双 `requestAnimationFrame` 嵌套是刻意的（等布局落定后再滚），勿压成单层。
 *   - 滚动监听注册在**真实 scroller**（非 ref 元素）上，`{ passive: true }` 保留。
 */

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import { directorStoreFactory } from "../store/create-store.js";
import { useDirectorStore } from "../store/use-store.js";
import { dshLog, dshScrollProbe } from "../util/debug.js";

/**
 * 小窗总监对话流（紧凑/非紧凑两态）。
 *
 * @param {object} props
 * @param {string} props.sessionId 会话 ID
 * @param {(instruction:string)=>void|null} [props.onConfirmSend] 手动确认发送回调（autoForward 关闭时显示按钮）
 * @param {boolean} [props.compact] 紧凑模式（小窗）
 * @param {Function|null} [props.onContainerClick] 容器点击回调
 * @returns {object} React 元素
 */
export function DirectorFlow({ sessionId, onConfirmSend = null, compact = false, onContainerClick = null }) {
	const store = directorStoreFactory(sessionId);
	const state = useDirectorStore(store);
	const messagesEndRef = (0, react.useRef)(null);
	const atBottomRef = (0, react.useRef)(true);
	const dfFindScroller = (fromEl) => {
		let el = fromEl;
		let depth = 0;
		while (el && depth < 15) {
			const style = window.getComputedStyle(el);
			const overflowY = style.overflowY;
			if (el.scrollHeight > el.clientHeight + 1 && (overflowY === "auto" || overflowY === "scroll")) {
				return el;
			}
			el = el.parentElement;
			depth++;
		}
		return fromEl;
	};
	const dfScrollToBottom = (el) => {
		if (!el) return;
		const scroller = dfFindScroller(el);
		scroller.scrollTop = scroller.scrollHeight;
		atBottomRef.current = true;
		dshLog("a2-DirectorFlow", "dfScrollToBottom: scroller found, scrollTop=" + scroller.scrollTop + " scrollHeight=" + scroller.scrollHeight + " clientHeight=" + scroller.clientHeight);
		dshScrollProbe("a2-DirectorFlow", scroller);
	};
	// 初始挂载 + 消息/状态变化时自动滚到底部
	(0, react.useLayoutEffect)(() => {
		const el = messagesEndRef.current;
		if (!el) return;
		// V9.4-P1: atBottom 守卫 —— 用户上翻历史时不抢回底部；用户自己发消息仍强制滚底
		const lastMsg = state.messages[state.messages.length - 1];
		if (!atBottomRef.current && lastMsg?.role !== "user") return;
		dshLog("a2", "DirectorFlow layout effect: msgs=" + state.messages.length + " status=" + state.status + " → force scroll bottom");
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (messagesEndRef.current) {
					dfScrollToBottom(messagesEndRef.current);
				}
			});
		});
	}, [state.messages.length, state.status, state.messages]);
	// 滚动事件：更新 atBottom 状态（监听真正的滚动容器）
	(0, react.useEffect)(() => {
		const fromEl = messagesEndRef.current;
		if (!fromEl) return;
		const scroller = dfFindScroller(fromEl);
		dshLog("a2-DirectorFlow", "onScroll: bound to scroller, scrollTop=" + scroller.scrollTop + " scrollHeight=" + scroller.scrollHeight + " clientHeight=" + scroller.clientHeight);
		const onScroll = () => {
			atBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 25;
			dshScrollProbe("a2-DirectorFlow", scroller);
		};
		scroller.addEventListener("scroll", onScroll, { passive: true });
		return () => scroller.removeEventListener("scroll", onScroll);
	}, []);
	// 初始挂载：加载持久化数据 + 滚到底部
	(0, react.useEffect)(() => {
		if (store && typeof store.hydrate === "function") {
			dshLog("a2", "DirectorFlow mount: hydrate store for sessionId=" + sessionId);
			store.hydrate();
		}
		const el = messagesEndRef.current;
		if (el) {
			dshLog("a2", "DirectorFlow mount: scroll to bottom");
			requestAnimationFrame(() => dfScrollToBottom(el));
		}
	}, []);
	return (0, react_jsx_runtime.jsx)("div", {
		ref: messagesEndRef,
		onClick: onContainerClick || undefined,
		// V9.2: 增加minHeight:0，flex column布局中子元素必须min-height:0才能正确收缩并触发overflow滚动
		style: { flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" },
		children: (0, react_jsx_runtime.jsx)("div", {
			style: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: compact ? 8 : 12, padding: compact ? 8 : 16, paddingBottom: compact ? 16 : 24 },
			children: state.messages.length === 0
				? (0, react_jsx_runtime.jsx)("div", { style: { color: "#595959", fontSize: compact ? 11 : 13, textAlign: "center", marginTop: 40 }, children: "总监对话流为空，输入消息开始" })
			// 🔴 迁移期修正：宿主原式为 `filteredMessages.map`（越界引用，见文件头论证）→ 改用 state.messages
			: state.messages.map((msg) =>
				(0, react_jsx_runtime.jsxs)("div", {
					key: msg.id,
					style: {
						alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
						maxWidth: compact ? "90%" : "80%",
						padding: compact ? "6px 10px" : "8px 12px",
						borderRadius: 8,
						background: msg.role === "user" ? "#e3f2fd" : msg.role === "system" ? "#fff3cd" : "#f5f5f5",
						fontSize: compact ? 12 : 13,
						lineHeight: 1.5,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word"
					},
					children: [
						msg.role === "assistant" && msg.parsed && (0, react_jsx_runtime.jsxs)("div", {
							style: { marginBottom: 8, padding: "6px 8px", background: "#fff", borderRadius: 4, border: "1px solid #eee", fontSize: compact ? 10 : 11 },
							children: [
								(0, react_jsx_runtime.jsx)("div", { children: `整理后指令: ${msg.parsed.instruction}` }),
								msg.parsed.model && (0, react_jsx_runtime.jsx)("div", { children: `模型建议: ${msg.parsed.model}` }),
								msg.parsed.branch && (0, react_jsx_runtime.jsx)("div", { children: `分支建议: ${msg.parsed.branch}` })
							]
						}),
						(0, react_jsx_runtime.jsx)("div", { children: msg.content }),
						msg.role === "assistant" && msg.parsed && !state.config.autoForward && onConfirmSend && (0, react_jsx_runtime.jsx)("button", {
							onClick: () => onConfirmSend(msg.parsed.instruction),
							style: { marginTop: 8, padding: "4px 12px", fontSize: compact ? 11 : 12, background: "#1976d2", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" },
							children: "确认发送"
						})
					]
				})
			)
		})
	});
}
