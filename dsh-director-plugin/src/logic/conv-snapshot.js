/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「对话概况」快照的**唯一提取实现**（纯函数 · 零 import）
 * 引用：—
 * 上游：bridge/chat-bridge.js, components/DirectorDialog.js, logic/sync.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/conv-snapshot.js — 「对话概况」快照的**唯一提取实现**（纯函数 · 零 import）
 *
 * ── 需求出处（doc `21` · R21-05）─────────────────────────────────────
 *   用户原话：「点击文件夹的总监需要在总监 tap 中，显示这个文件夹中
 *              **所有对话在做什么（总结）** ＋ **最后一个我发送的消息和结果**」
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────
 *   本函数就是那条**判据**（哪条算"我发的"、哪条算"它的结果"）。留在 bridge 层
 *   （带副作用、要读 DOM）就只能上真机验；而"取错角色"这种错**看不出异常**
 *   （照样有文本、照样显示），是最典型的静默缺陷。
 *   ⇒ 提到 `logic/`：离线可跑 + 可植入缺陷校准（与 `nav-intent.js` / `scope-tree.js` 同一理由）。
 *   本模块**零 import** —— 不引入任何 import 环，也不依赖 DOM / 平台。
 *
 * ── 口径（易错点，逐条写死）───────────────────────────────────────────
 *   ① `lastUser`  = 从后往前**第一条** `role === "user"` 的文本
 *   ② `lastResult`= `lastUser` **之后**第一条 `role === "assistant"` 的文本
 *      🔴 若"我发的"之后**还没有回复** ⇒ `lastResult === ""` 且 `pending === true`。
 *         **严禁**回退去取更早的那条回复 —— 那会把"没回"显示成"回了别的"，
 *         而用户无法分辨（纪律 58：算不出与算成 0 必须可分）。
 *   ③ 文本取值 `text ?? content ?? ""`，只做长度截断，**不做任何改写**（保真）
 *   ④ 非数组 / 空数组 ⇒ 全空 + `count: 0`（**不写 "(未指定)" 之类占位**，纪律 N4 同款）
 *   ⑤ `role` **大小写不敏感**（宿主侧两个通道的写法历史上并不一致）
 *   ⑥ `lastUser` 为空串 = 该会话**没有**用户消息（与"有但为空"同形 ⇒ 由 `count` 区分）
 */

/** 单条文本上限（与 `logic/sync.js` 的既有 200 保持一致，避免两处截断长度不同源） */
export const SNAPSHOT_TEXT_MAX = 200;

/** 安全取文本（保真 + 截断） */
function textOf(m) {
	if (!m || typeof m !== "object") return "";
	const v = m.text != null ? m.text : m.content;
	return v == null ? "" : String(v).slice(0, SNAPSHOT_TEXT_MAX);
}

/** 安全取角色（小写） */
function roleOf(m) {
	return String((m && m.role) || "").toLowerCase();
}

/**
 * 从消息数组里取「最后一次我发的 + 它的结果」
 *
 * @param {Array<{role?:string,text?:string,content?:string}>} items
 * @returns {{lastUser:string,lastResult:string,pending:boolean,count:number}}
 */
export function pickLastExchange(items) {
	if (!Array.isArray(items) || !items.length) {
		return { lastUser: "", lastResult: "", pending: false, count: 0 };
	}

	// ① 最后一条 user
	let ui = -1;
	for (let i = items.length - 1; i >= 0; i--) {
		if (roleOf(items[i]) === "user") { ui = i; break; }
	}
	const lastUser = ui >= 0 ? textOf(items[ui]) : "";

	// ② 其后的第一条 assistant（只往**后**找，不回退）
	let lastResult = "";
	if (ui >= 0) {
		for (let i = ui + 1; i < items.length; i++) {
			if (roleOf(items[i]) === "assistant") { lastResult = textOf(items[i]); break; }
		}
	}

	return {
		lastUser,
		lastResult,
		pending: ui >= 0 && !lastResult,
		count: items.length
	};
}

/**
 * 把快照**并入**节点会话对象（不可变：返回新对象，不改入参）
 *
 * 🔴 存在理由：`logic/sync.js` 每次自动同步都会**整体重写** `node.conversations`，
 *    若不显式接住镜像快照，用户点开对话采集到的东西会被下一次同步**静默抹掉**
 *    （表现为"刚点开有内容，过一会儿又变未采集"）。
 *
 * @param {object} conv  现有 `conversations[0]`（可为 null）
 * @param {{lastUser:string,lastResult:string,pending:boolean,count:number}} snap
 * @param {number} [at]  采集时刻（Date.now()）
 * @returns {object} 新 conv（只增字段，不改既有字段名）
 */
export function mergeSnapshot(conv, snap, at) {
	const c = (conv && typeof conv === "object") ? { ...conv } : {};
	const s = snap || { lastUser: "", lastResult: "", pending: false, count: 0 };
	if (!s.lastUser && !s.lastResult) return c;   // 空快照 ⇒ 不覆盖已有（防"用空覆盖有"）
	c.lastUser = s.lastUser;
	c.lastResult = s.lastResult;
	c.lastPending = Boolean(s.pending);
	c.snapAt = Number(at || 0);
	return c;
}

/**
 * 概况行的**呈现口径**（唯一真相源 —— UI 与闸门都读它，防两处判据分叉）
 *
 * @param {{summary?:string,lastUser?:string,lastResult?:string,lastPending?:boolean,lastMessage?:string,flowLine?:string}} it
 * @returns {Array<{kind:string,text:string}>} 按显示顺序
 */
export function briefLines(it) {
	const o = it || {};
	const out = [];
	const push = (kind, text) => { if (text) out.push({ kind, text }); };
	push("summary", o.summary ? "总结：" + o.summary : "");
	push("user", o.lastUser ? "最后(我)：" + o.lastUser : "");
	// 🔴 "待回复"必须有**独立一行**（不能靠"结果那行是空的"来表达 —— 空行与"没渲染"同形）
	if (o.lastUser && o.lastPending) push("pending", "结果：待回复（尚未产出）");
	else push("result", o.lastResult ? "结果：" + o.lastResult : "");
	push("director", o.lastMessage ? "总监：" + o.lastMessage : "");
	push("flow", o.flowLine ? "流转：" + o.flowLine : "");
	return out;
}
