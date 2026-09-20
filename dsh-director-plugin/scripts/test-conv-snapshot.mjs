/**
 * scripts/test-conv-snapshot.mjs — 第 40 轮离线闸门：**对话概况快照**的提取与呈现口径（纯函数）
 *
 * 守的用户需求（doc `21` · R21-05）：
 *   「点击文件夹的总监需要在总监 tap 中，显示这个文件夹中**所有对话在做什么（总结）**
 *     ＋ **最后一个我发送的消息和结果**」
 *
 * ── 为什么这条判据非有不可 ────────────────────────────────────────────
 *   取错角色**看不出异常**：照样有文本、照样渲染、不报错。
 *   真机上只会表现为「概况里的东西看着不太对」⇒ 无法归因（纪律 19 同族）。
 *   故：口径写进纯函数（`logic/conv-snapshot.js`），在这里用**坏样本**把它钉住。
 *
 * ── 判据可校准（纪律 ⑥ / ⑫）─────────────────────────────────────────
 *   `CS-17` / `CS-18` 用两种「看起来对但确实错」的实现形状去撞本判据：
 *     · `old1` = 不做角色过滤，取消息数组**末条**当「我发的」
 *     · `old2` = 取**任意**最后一条 assistant 当「结果」（不回看它在不在 user 之后）
 *   两者都必须**能被本判据区分出来**；区分不出来说明判据是空的（永远绿）。
 *
 * 用法：node scripts/test-conv-snapshot.mjs      （零依赖，不需要 CDP / 应用）
 */

import { pickLastExchange, mergeSnapshot, briefLines, SNAPSHOT_TEXT_MAX } from "../src/logic/conv-snapshot.js";
import { tallyCheck } from "./_test-tally.mjs";

let pass = 0, fail = 0;
function t(id, desc, cond, ev) {
	if (cond) { pass += 1; console.log("  ✅ " + id + " " + desc); }
	else { fail += 1; console.log("  ❌ " + id + " " + desc + "\n       " + JSON.stringify(ev)); }
}

const U = (s) => ({ role: "user", text: s });
const A = (s) => ({ role: "assistant", text: s });
const S = (s) => ({ role: "system", text: s });

/* ══════════════════════════════════════════════════════════════════
 * CS · `pickLastExchange` —— 「最后一次我发的 ＋ 它的结果」
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── CS · pickLastExchange ──");

{
	const r = pickLastExchange([U("给主角写人物档案"), A("已写入 A4 人物：……")]);
	t("CS-1", "基本：末条 user + 其后 assistant ⇒ 两者都取到，且 pending=false",
		r.lastUser === "给主角写人物档案" && r.lastResult === "已写入 A4 人物：……" && r.pending === false,
		r);
}

{
	const r = pickLastExchange([U("补充第三章支线")]);
	t("CS-2", "🔴 末条是 user 且**尚无回复** ⇒ lastResult 为空串、pending=true（不许静默回退到上一条回复）",
		r.lastUser === "补充第三章支线" && r.lastResult === "" && r.pending === true, r);
}

{
	/* 🔴 本组最重要的一条：`user, assistant, user` —— 若实现是「取最后一条 assistant」，
	 *    会拿**第一条** assistant 当「最后那条 user 的结果」，而它其实属于**更早**那轮。 */
	const r = pickLastExchange([U("第一轮提问"), A("第一轮的回复"), U("第二轮提问")]);
	t("CS-3", "🔴 **不回退**：user→assistant→user ⇒ 结果为空 + pending（拿上一条回复会让用户把 A 当成 B 的结果）",
		r.lastUser === "第二轮提问" && r.lastResult === "" && r.pending === true, r);
}

{
	const r = pickLastExchange([U("旧问题"), A("旧回复"), U("新问题"), A("新回复")]);
	t("CS-4", "取**最后**一条 user 与其**紧邻之后**的 assistant（不是第一条）",
		r.lastUser === "新问题" && r.lastResult === "新回复", r);
}

{
	const raw = "第一行\n第二行 \"引号\" · 全角（括号） 尾部空格  ";
	const r = pickLastExchange([U(raw), A("ok")]);
	t("CS-5", "保真：原文**逐字**返回（不 trim、不改标点、保留换行）",
		r.lastUser === raw && r.lastUser.indexOf("\n") > 0, { got: r.lastUser, want: raw });
}

{
	const long = "x".repeat(SNAPSHOT_TEXT_MAX + 50);
	const r = pickLastExchange([U(long), A("ok")]);
	t("CS-6", "超长截断到 SNAPSHOT_TEXT_MAX（200）—— 与 logic/sync.js 的既有上限同源",
		r.lastUser.length === SNAPSHOT_TEXT_MAX, { len: r.lastUser.length });
}

{
	const r1 = pickLastExchange([]);
	const r2 = pickLastExchange(null);
	const r3 = pickLastExchange("not-array");
	t("CS-7", "空数组 / null / 非数组 ⇒ 全空 + count=0（**不写占位文案**）",
		r1.lastUser === "" && r1.lastResult === "" && r1.count === 0 && r1.pending === false
		&& r2.count === 0 && r3.count === 0, { r1, r2, r3 });
}

{
	const r = pickLastExchange([{ role: "User", text: "大小写" }, { role: "ASSISTANT", text: "回" }]);
	t("CS-8", "role **大小写不敏感**（宿主侧两个通道写法历史上并不一致）",
		r.lastUser === "大小写" && r.lastResult === "回", r);
}

{
	const r = pickLastExchange([A("只有助手的话"), S("系统提示")]);
	t("CS-9", "没有 user ⇒ lastUser 为空串 且 **pending=false**（「没有」不等于「在等回复」）",
		r.lastUser === "" && r.lastResult === "" && r.pending === false && r.count === 2, r);
}

{
	const r = pickLastExchange([{ role: "user", text: "text 优先", content: "content 备选" }, { role: "assistant", content: "只用 content" }]);
	t("CS-10", "文本取值 text 优先 / content 备选（两个字段都支持）",
		r.lastUser === "text 优先" && r.lastResult === "只用 content", r);
}

/* ══════════════════════════════════════════════════════════════════
 * MS · `mergeSnapshot` —— 落盘时**不许用空覆盖有**
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── MS · mergeSnapshot ──");

{
	const conv = { conversationId: "s1", title: "T", lastMessage: "总监侧末条", messageCount: 3, lastUser: "我发的", lastResult: "它的结果", snapAt: 111 };
	const out = mergeSnapshot(conv, { lastUser: "", lastResult: "", pending: false, count: 0 }, 222);
	t("MS-1", "🔴 **空快照不覆盖**已有（否则用户会看到内容「间歇消失」且无法归因）",
		out.lastUser === "我发的" && out.lastResult === "它的结果" && out.snapAt === 111, out);
}

{
	const conv = { conversationId: "s1", lastMessage: "总监侧末条", messageCount: 3 };
	const out = mergeSnapshot(conv, { lastUser: "新问题", lastResult: "新回复", pending: false, count: 9 }, 999);
	t("MS-2", "非空快照 ⇒ 覆盖快照字段，且**既有字段一个不动**（lastMessage / messageCount / conversationId）",
		out.lastUser === "新问题" && out.lastResult === "新回复" && out.snapAt === 999
		&& out.lastMessage === "总监侧末条" && out.messageCount === 3 && out.conversationId === "s1", out);
}

{
	const conv = { conversationId: "s1" };
	mergeSnapshot(conv, { lastUser: "x", lastResult: "y", pending: false, count: 1 }, 1);
	t("MS-3", "不可变：**入参未被修改**（返回新对象）",
		Object.keys(conv).length === 1 && conv.lastUser === undefined, conv);
}

{
	const out = mergeSnapshot(null, { lastUser: "只有快照", lastResult: "", pending: true, count: 1 }, 5);
	t("MS-4", "传入 null 的 conv ⇒ 安全构造（不抛）",
		out.lastUser === "只有快照" && out.lastPending === true && out.snapAt === 5, out);
}

/* ══════════════════════════════════════════════════════════════════
 * BL · `briefLines` —— 呈现口径（组件与闸门**同读一份**）
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── BL · briefLines ──");

{
	const ls = briefLines({ summary: "在做 A3 剧情", lastUser: "补充支线", lastResult: "已补", lastMessage: "总监：已派发", flowLine: "流转到 plot" });
	t("BL-1", "顺序与 kind 固定：summary → user → result → director → flow（渲染顺序不许各处自己排）",
		ls.map((x) => x.kind).join(",") === "summary,user,result,director,flow", ls);
	t("BL-2", "文案前缀可分辨（总结 / 最后(我) / 结果 / 总监 / 流转）",
		ls[1].text.indexOf("最后(我)：") === 0 && ls[2].text.indexOf("结果：") === 0 && ls[3].text.indexOf("总监：") === 0,
		ls.map((x) => x.text));
}

{
	const ls = briefLines({ lastUser: "还没回的问题", lastPending: true });
	t("BL-3", "🔴 pending ⇒ **独立一行** kind=pending 且文案含「待回复」—— 不能靠「结果那行是空的」来表达（空行与「没渲染」同形）",
		ls.length === 2 && ls[1].kind === "pending" && ls[1].text.indexOf("待回复") >= 0, ls);
}

{
	const ls = briefLines({});
	t("BL-4", "全空输入 ⇒ **空数组**（不写未指定之类占位）",
		Array.isArray(ls) && ls.length === 0, ls);
}

/* ══════════════════════════════════════════════════════════════════
 * 植入缺陷校准（纪律 ⑥ / ⑫）—— 用**旧/坏实现的真实形状**去撞上面的判据
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── CAL · 植入缺陷校准（撞不红 ⇒ 判据是空的）──");

{
	/* 坏样本 ①：不做角色过滤 —— 取消息数组**末条**当「我发的」
	 * （这正是「只取末条文本」这种最自然写法的形状） */
	const old1 = (items) => {
		if (!Array.isArray(items) || !items.length) return { lastUser: "", lastResult: "" };
		return { lastUser: String(items[items.length - 1].text || ""), lastResult: "" };
	};
	/* 坏样本 ②：取**任意**最后一条 assistant 当结果（不回看它在不在 user 之后） */
	const old2 = (items) => {
		const arr = Array.isArray(items) ? items : [];
		let lu = "";
		for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].role === "user") { lu = String(arr[i].text || ""); break; } }
		let lr = "";
		for (let i = arr.length - 1; i >= 0; i--) { if (arr[i].role === "assistant") { lr = String(arr[i].text || ""); break; } }
		return { lastUser: lu, lastResult: lr };
	};

	const caseA = [U("旧问题"), A("旧回复"), U("新问题")];   // 多层 + 未回复（坏样本 ② 在这里现形）
	const caseB = [U("问"), A("答")];                        // 最常见形态（坏样本 ① 在这里现形）
	const good = pickLastExchange(caseA);
	const bad2 = old2(caseA);

	t("CS-17", "🔴 坏样本 ①（取末条当「我发的」）**必须**被本判据区分 —— 判别输入选「末条是 assistant」的那种（若选末条本就是 user 的输入，两者会**恰好一致** ⇒ 那是**假校准**）",
		(() => {
			const b = old1(caseB), g = pickLastExchange(caseB);
			return b.lastUser === "答" && g.lastUser === "问" && b.lastUser !== g.lastUser;
		})(), { bad1_on_B: old1(caseB), good_on_B: pickLastExchange(caseB) });

	t("CS-18", "🔴 坏样本 ②（取任意最后一条 assistant）**必须**被 CS-3 抓到 —— 它会给出「旧回复」，而正确结果是空串",
		bad2.lastResult === "旧回复" && good.lastResult === "" && bad2.lastResult !== good.lastResult,
		{ bad: bad2, good });

	t("CS-19", "坏样本 ② 在**最常见形态**（末条 user + 紧随其后的 assistant）下与正确实现**一致** ⇒ 证明它不是「怎么都错」，而是**只在多层 / 未回复场景下错** —— 这正是「校准样本必须覆盖那些场景」的理由",
		(() => {
			const b = old2(caseB), g = pickLastExchange(caseB);
			return b.lastUser === g.lastUser && b.lastResult === g.lastResult
				&& bad2.lastResult !== good.lastResult;
		})(), { bad2_on_B: old2(caseB), good_on_B: pickLastExchange(caseB) });
}

console.log("\n═══════════════════════════════════════════════════════════");
const ran = pass + fail;
/* 🔴 下限是**下限**不是精确值：以后新增断言**必须**同步抬高它（不抬 = 把沉默合法化）。 */
const MIN_ASSERTIONS = 19;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-conv-snapshot（纯离线）" });
if (!tally.ok) process.exit(2);
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
