/**
 * scripts/test-requirement22.mjs — 第 40 轮离线闸门：22 号文 **G5 / G6 / G7** 的纯函数口径
 *
 * 守的用户需求（22 号文 §3）：
 *   · **G5**（F3 接收确认）：跨维度转交后，**源 + 目标两侧**各有一行可核对凭证
 *     ——「已转交 → X」「已接收 ← Y」。
 *   · **G6**（N5/F5 对话持续性）：「登记」不写总监消息，这件事**必须在小结里说出来**，
 *     且**不得**因此写库（`engineStats.conversations` 负对照）。
 *   · **G7**（F7 项目把控）：总监有一行**自己算出来的**项目清单读数，
 *     与层级树**双向对账**；零项目时是「未登记项目」而**不是空白**。
 *
 * ── 为什么这三条非有判据不可 ──────────────────────────────────────────
 *   三者的共同失效形态都是「看着有、其实没有」：
 *     · 凭证文案拼错 ⇒ 照样渲染成一行了，用户读不出「这是同一件事」；
 *     · 读数写死数字 ⇒ 界面永远显示得挺好看；
 *     · 零项目渲染空串 ⇒ 与「界面坏了」同形。
 *   故：口径全部收敛进纯函数（`logic/summary-notes.js` / `logic/project-inventory.js`），
 *   在这里用**坏样本**把它钉住（纪律 ⑥ / ⑫）。
 *
 * ── 判据可校准（纪律 ⑥ / ⑫）─────────────────────────────────────────
 *   `CAL-1..5` 各用**一种真实会写出来的坏实现**去撞上面的判据；
 *   撞不红 ⇒ 判据是空的（永远绿）。
 *
 * 用法：node scripts/test-requirement22.mjs      （零依赖，不需要 CDP / 应用）
 */

import {
	HANDOFF_TAG, ACCEPT_TAG, NO_DIRECTOR_MSG_TAG, REGISTER_HINT,
	hhmm, dimPart, transferLine, acceptLine, isRegisterFlow, registerNote, registerBody, registerToast
} from "../src/logic/summary-notes.js";
import { projectInventory, inventoryText, inventoryRows, conversationIdOf, DANGLING } from "../src/logic/project-inventory.js";
import { tallyCheck } from "./_test-tally.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** 剥掉注释（本判据要在"**代码里**有没有第二份字面量"上判，而**注释里保留事故旧写法**是有意为之 ——
 *  不为了判据去改写注释，这正是纪律 135 那条"判据不许逼人删证据"的正解）。 */
function stripComments(src) {
	return String(src)
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

let pass = 0, fail = 0;
function t(id, desc, cond, ev) {
	if (cond) { pass += 1; console.log("  ✅ " + id + " " + desc); }
	else { fail += 1; console.log("  ❌ " + id + " " + desc + "\n       " + JSON.stringify(ev)); }
}

/* 固定时刻（本地 09:05 / 14:30 / 00:00）—— 判据不许建在「当前时间」上
 *（纪律 107：构建面内不许有随跑程变化的输入） */
const AT = new Date(2026, 0, 2, 9, 5, 0, 0).getTime();
const AT2 = new Date(2026, 0, 2, 14, 30, 0, 0).getTime();
const AT0 = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();

/* 层级树样板构造器 */
const gnode = (children) => ({ id: "__global__", name: "全局", level: "global", childNodes: children || [] });
const proj = (id, name, children) => ({ id, name, level: "project", childNodes: children || [] });
const sess = (id, name, convId) => ({
	id, name, level: "session",
	conversations: convId ? [{ conversationId: convId }] : [],
	childNodes: []
});
/** 造一条「登记」产生的流转 */
const regFlow = (at, note) => ({ flowId: "f-reg", at, trail: [{ dim: "director", at, note: note || "R8 登记" }] });
/** 造一条普通流转 */
const plainFlow = (at, note) => ({ flowId: "f-plain", at, trail: [{ dim: "mindmap", at, note: note || "在导图发起" }] });

/* ══════════════════════════════════════════════════════════════════
 * SN · summary-notes —— G5 的两行 / G6 的那一行
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── SN · summary-notes（G5 / G6）──");

{
	t("SN-1", "transferLine 逐字：已转交 → 目标名（维度 X）（HH:MM）",
		transferLine({ toName: "A3 剧情", dimKey: "plot", at: AT }) === "已转交 → A3 剧情（维度 plot）（09:05）",
		transferLine({ toName: "A3 剧情", dimKey: "plot", at: AT }));
}

{
	t("SN-2", "acceptLine 逐字：已接收 ← 来源名（维度 X）（HH:MM）—— 与源侧**方向相反**，不许复用同一句",
		acceptLine({ fromName: "A1 世界观", dimKey: "world", at: AT2 }) === "已接收 ← A1 世界观（维度 world）（14:30）",
		acceptLine({ fromName: "A1 世界观", dimKey: "world", at: AT2 }));
}

{
	t("SN-3", "🔴 名字为空 ⇒ **中性占位**（目标分支 / 来源分支），**不拿 id 或标题顶替**（读不到就说读不到）",
		transferLine({ toName: "   ", dimKey: "", at: AT }).indexOf("目标分支") > 0
		&& acceptLine({ fromName: null, at: AT }).indexOf("来源分支") > 0
		&& transferLine({ toName: "", at: AT }).indexOf("undefined") < 0,
		{ tr: transferLine({ toName: "   ", at: AT }), ac: acceptLine({ fromName: null, at: AT }) });
}

{
	t("SN-4", "🔴 无维度 key ⇒ **不出现半截话**「（维度 ）」；有 key 时 dimPart 才给括号",
		transferLine({ toName: "X", dimKey: "", at: AT }).indexOf("（维度 ）") < 0
		&& dimPart("") === "" && dimPart(null) === "" && dimPart("plot") === "（维度 plot）",
		{ line: transferLine({ toName: "X", at: AT }), dp: dimPart("") });
}

{
	t("SN-5", "hhmm **补零**（09:05 / 14:30 / 00:00）—— 用 getHours/getMinutes，不用 toLocaleTimeString（后者随 locale 变 ⇒ 判据假红）",
		hhmm(AT) === "09:05" && hhmm(AT2) === "14:30" && hhmm(AT0) === "00:00",
		{ a: hhmm(AT), b: hhmm(AT2), c: hhmm(AT0) });
}

{
	/* 🔴 两行必须**可分辨**：方向 + 名字都要不同。若实现写成同一个模板（最常见的坏写法），
	 *    用户切到目标分支看到的仍是「已转交 →」，根本分不清自己是源还是目标。 */
	const tr = transferLine({ toName: "B2", dimKey: "d", at: AT });
	const ac = acceptLine({ fromName: "A1", dimKey: "d", at: AT });
	t("SN-6", "🔴 源/目标两行**必须不同**：各以自己那侧的 tag 开头，且互不含对方的 tag",
		tr !== ac && tr.indexOf(HANDOFF_TAG) === 0 && ac.indexOf(ACCEPT_TAG) === 0
		&& tr.indexOf(ACCEPT_TAG) < 0 && ac.indexOf(HANDOFF_TAG) < 0,
		{ tr, ac });
}

{
	t("SN-7", "registerNote · **无**「登记」流转 ⇒ 空串（不许无脑常显 —— 那会让这句提示变噪声）",
		registerNote([], []) === "" && registerNote(null, null) === ""
		&& registerNote([plainFlow(AT)], []) === "",
		{ empty: registerNote([], []), plain: registerNote([plainFlow(AT)], []) });
}

{
	const note = registerNote([regFlow(AT)], []);
	t("SN-8", "🔴 有「登记」且其后**无**总监消息 ⇒ 出现该行，且含「本动作不写总监消息」与可执行的替代路径",
		note.indexOf(NO_DIRECTOR_MSG_TAG) === 0 && note.indexOf("执行") > 0, note);
}

{
	/* 负对照：登记**之后**已经有总监消息 ⇒ 该说的已经说了，不许赖着（否则这句会变成永久噪声） */
	t("SN-9", "🔴 负对照：登记之后已有更新的总监消息 ⇒ **不显示**；且比较用的是「最后活动」（足迹更新也算）",
		registerNote([regFlow(AT)], [{ messageId: "m1", at: AT + 1000 }]) === ""
		&& registerNote([regFlow(AT)], [{ messageId: "m1", at: AT - 1000 }]) !== "",
		{ after: registerNote([regFlow(AT)], [{ messageId: "m1", at: AT + 1000 }]),
			before: registerNote([regFlow(AT)], [{ messageId: "m1", at: AT - 1000 }]) });
}

{
	const reg = regFlow(AT);
	reg.trail = [{ dim: "director", at: AT, note: "R8 登记" }, { dim: "chat", at: AT2, note: "送到了" }];
	t("SN-10", "isRegisterFlow 只认**第一跳**的 note（用「任一跳含登记」会把别人转来的条目也算成登记）",
		isRegisterFlow(reg) === true && isRegisterFlow(plainFlow(AT)) === false && isRegisterFlow(null) === false,
		{ reg: isRegisterFlow(reg), plain: isRegisterFlow(plainFlow(AT)) });
}

/* ══════════════════════════════════════════════════════════════════
 * PI · project-inventory —— G7 的项目清单读数
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── PI · project-inventory（G7）──");

{
	const inv = projectInventory(gnode([]));
	t("PI-1", "🔴 只有全局根 ⇒ registered=0 **且** 文案 = 「未登记项目」（**不是空串、不是 undefined**）",
		inv.registered === 0 && inventoryText(inv) === "未登记项目" && inventoryText(null) === "未登记项目", inv);
}

{
	const tree = gnode([
		proj("p1", "虚海", [sess("s1", "A1", "c1"), sess("s2", "A2", "c2")]),
		proj("p2", "sea-tycoon", [sess("s3", "B1", "c3")])
	]);
	const inv = projectInventory(tree, { archivedIds: [] });
	t("PI-2", "常规：2 项目 / 3 对话，逐行 = 名称 · N 对话",
		inv.registered === 2 && inv.sessions === 3 && inv.dangling === 0
		&& inventoryRows(inv).join(",") === "虚海 · 2 对话,sea-tycoon · 1 对话", inv);
}

{
	/* 🔴 J5 的**双向对账**：读数必须等于「数框」数出来的那个量 —— 全局根的 project 级**直接**子节点数。
	 *    任何「多算一层 / 少算一层」的实现都会在这里不等（见 CAL-1）。 */
	const tree = gnode([
		proj("p1", "A", [sess("s1", "a", "c1")]),
		proj("p2", "B", [sess("s2", "b", "c2"), sess("s3", "c", "c3")])
	]);
	const direct = tree.childNodes.filter((n) => n.level === "project").length;
	t("PI-3", "🔴 双向对账：读数 === 树的直接 project 级子节点数（不是 >0，是**逐值相等**）",
		projectInventory(tree, { archivedIds: [] }).registered === direct && direct === 2, { direct });
}

{
	const tree = gnode([proj("p1", "A", [sess("s1", "无会话绑定", "")])]);
	const inv = projectInventory(tree, { archivedIds: [] });
	t("PI-4", "悬空①：会话节点**没有** conversationId ⇒ 计入 dangling 且原因 = no-conversation",
		inv.dangling === 1 && inv.danglingRows[0].why === DANGLING.NO_CONVERSATION, inv.danglingRows);
}

{
	const tree = gnode([proj("p1", "A", [sess("s1", "已归档", "c-old"), sess("s2", "正常", "c-new")])]);
	const inv = projectInventory(tree, { archivedIds: ["c-old"] });
	t("PI-5", "悬空②：会话已归档（id 在 archivedIds 里）⇒ 悬空；未归档的**不算**（不许把全部会话当悬空）",
		inv.dangling === 1 && inv.danglingRows[0].why === DANGLING.ARCHIVED && inv.danglingRows[0].id === "s1", inv.danglingRows);
}

{
	const tree = gnode([proj("p1", "A", [sess("s1", "甲", "c1")])]);
	const inv = projectInventory(tree);
	t("PI-6", "🔴 归档面**未知**时不猜：未传 archivedIds ⇒ archivedKnown=false ⇒ 只有 no-conversation 计入悬空",
		inv.archivedKnown === false && inv.dangling === 0, inv);
}

{
	const tree = gnode([proj("p1", "空项目", []), proj("p2", "有内容", [sess("s1", "x", "c1")])]);
	const inv = projectInventory(tree, { archivedIds: [] });
	t("PI-7", "空项目单独计数（「登记了没内容」与「没登记」是两件事，要能分开）",
		inv.registered === 2 && inv.emptyProjects === 1 && inv.sessions === 1, inv);
}

{
	const tree = gnode([sess("s0", "游离会话", "c0"), proj("p1", "A", [sess("s1", "x", "c1")])]);
	const inv = projectInventory(tree, { archivedIds: [] });
	t("PI-8", "全局根下**直挂**的游离会话也计入对话总数（少算比多算更难发现）",
		inv.registered === 1 && inv.sessions === 2, inv);
}

{
	t("PI-9", "conversationIdOf：非数组 / 空 / 正常三种入参都不抛；正常时返回字符串（数字 id 也转成串）",
		conversationIdOf(null) === "" && conversationIdOf({}) === ""
		&& conversationIdOf({ conversations: [] }) === ""
		&& conversationIdOf({ conversations: [{ conversationId: 123 }] }) === "123",
		conversationIdOf({ conversations: [{ conversationId: 123 }] }));
}

{
	const tree = gnode([proj("p1", "A", [sess("s1", "x", "c1")]), proj("p2", "B", [])]);
	const inv = projectInventory(tree, { archivedIds: [] });
	const txt = inventoryText(inv);
	t("PI-10", "读数文本含四个量（项目 / 对话 / 悬空 / 空项目）—— 只有项目数是 0 时才退化为「未登记项目」",
		txt.indexOf("已登记项目 2") === 0 && txt.indexOf("对话 1") > 0 && txt.indexOf("悬空 0") > 0 && txt.indexOf("空项目 1") > 0,
		txt);
}

/* ══════════════════════════════════════════════════════════════════
 * CAL · 植入缺陷校准（纪律 ⑥ / ⑫）—— 撞不红 ⇒ 判据是空的
 * ══════════════════════════════════════════════════════════════════ */
console.log("\n── CAL · 植入缺陷校准（撞不红 ⇒ 判据是空的）──");

{
	/* 坏样本 ①（G7）：把读数实现成「遍历整棵树，数所有 project 级节点」——
	 * 这是最自然的写法，但在「项目下再套项目」的树上会**多算**。 */
	const oldCount = (root) => {
		let n = 0;
		const walk = (x) => { if (!x) return; if (x.level === "project") n++; (x.childNodes || []).forEach(walk); };
		walk(root);
		return n;
	};
	const nested = gnode([proj("p1", "外壳", [proj("p1a", "内层项目", [sess("s1", "x", "c1")])])]);
	const good = projectInventory(nested, { archivedIds: [] }).registered;
	t("CAL-1", "🔴 坏样本①（数全树 project 级节点）**必须**被 PI-3 的「直接子节点」口径区分 —— 嵌套树上它给 2、正确是 1",
		oldCount(nested) === 2 && good === 1 && oldCount(nested) !== good,
		{ bad: oldCount(nested), good });
}

{
	/* 坏样本 ②（G7）：零项目时返回空串（没数据就什么都不显示，是最常见的偷懒写法） */
	const oldText = (inv) => (inv && inv.registered ? "已登记项目 " + inv.registered : "");
	t("CAL-2", "🔴 坏样本②（零项目渲染空串）**必须**被 PI-1 区分 —— 空串 ≠「未登记项目」",
		oldText(projectInventory(gnode([]), {})) === "" && inventoryText(projectInventory(gnode([]), {})) === "未登记项目",
		{ bad: oldText(projectInventory(gnode([]), {})), good: inventoryText(projectInventory(gnode([]), {})) });
}

{
	/* 坏样本 ③（G5）：目标侧复用**源侧**的文案构造（直接把 transferLine 拿来当 acceptLine 用） */
	const oldAccept = (o) => transferLine({ toName: o && o.fromName, dimKey: o && o.dimKey, at: o && o.at });
	const ac = { fromName: "A1", dimKey: "world", at: AT };
	t("CAL-3", "🔴 坏样本③（目标侧复用源侧文案）**必须**被 SN-6 区分 —— 复用后两行完全相同、方向也错了",
		oldAccept(ac) === transferLine({ toName: "A1", dimKey: "world", at: AT })
		&& acceptLine(ac) !== oldAccept(ac) && oldAccept(ac).indexOf(ACCEPT_TAG) < 0,
		{ bad: oldAccept(ac), good: acceptLine(ac) });
}

{
	/* 坏样本 ④（G6）：常显常量 —— 反正写死一句就「满足了要有这行」 */
	const oldNote = () => NO_DIRECTOR_MSG_TAG + "（登记为流转）";
	const reg = regFlow(AT);
	t("CAL-4", "🔴 坏样本④（常显常量）**必须**被 SN-7 / SN-9 区分 —— 它在「无登记」与「已有消息」两种场景下都错",
		oldNote() !== "" && registerNote([], []) !== oldNote()
		&& registerNote([reg], [{ messageId: "m1", at: AT + 1 }]) !== oldNote(),
		{ bad: oldNote(), good_none: registerNote([], []), good_after: registerNote([reg], [{ messageId: "m1", at: AT + 1 }]) });
}

/* ══ SN-11..14 + CAL-5（**第 41 轮收口**）：登记提示的**唯一构造点** ══════════
 *  背景：`DirectorPage#registerNative` 的提示原先是一串**内联字面量**，
 *  写着「「登记」**不产生**总监消息」，而同一语义的常量 `NO_DIRECTOR_MSG_TAG`
 *  写的是「本动作**不写**总监消息」⇒ **同一事实两处措辞漂移**（纪律 126）。
 *  要命的是：用户看到的恰恰是那句提示，而闸门断言引用的是常量
 *  ⇒ 不收口就会出现「**判据是绿的、用户看到的是另一句话**」
 *    （纪律 135 的同族，但更进一步 —— 落点在了，**文案却不是同一份**）。 */
{
	const toast = registerToast(12);
	t("SN-11", "🔴 登记提示（toast）与 `registerNote` 的正文**逐字同源**（都含 NO_DIRECTOR_MSG_TAG + REGISTER_HINT），且**只此一种措辞**",
		toast.indexOf(NO_DIRECTOR_MSG_TAG) >= 0 && toast.indexOf(REGISTER_HINT) >= 0
		&& toast.indexOf("12 字符") >= 0 && toast.indexOf("不产生总监消息") < 0,
		toast);
	t("SN-12", "registerToast 对非法入参**不抛**且落到 0（提示不许因计数异常整条消失）",
		registerToast(undefined) === registerToast(0) && registerToast(NaN).indexOf("0 字符") > 0,
		{ u: registerToast(undefined), nan: registerToast(NaN) });
	t("SN-13", "🔴 registerNote 的正文 == registerBody()（两条通道**共用同一份措辞**，不是各写一份）",
		registerBody() === NO_DIRECTOR_MSG_TAG + "（登记为流转）—— " + REGISTER_HINT
		&& registerNote([regFlow(AT)], []).indexOf(registerBody()) === 0,
		{ body: registerBody(), note: registerNote([regFlow(AT)], []) });
}

{
	/* 🔴 **源码级**唯一构造点（纪律 135 的机械检查：`grep` 必须非空，且**唯一**） */
	const dp = stripComments(readFileSync(join(HERE, "..", "src", "components", "DirectorPage.js"), "utf8"));
	const sn = stripComments(readFileSync(join(HERE, "..", "src", "logic", "summary-notes.js"), "utf8"));
	t("SN-14", "🔴 唯一构造点：「已进四维轨迹」/「不产生总监消息」**只能**出现在 summary-notes.js，组件里不许第二处内联",
		dp.indexOf("已进四维轨迹") < 0 && dp.indexOf("不产生总监消息") < 0
		&& sn.indexOf("已进四维轨迹") >= 0 && dp.indexOf("registerToast") >= 0,
		{ dp_has轨迹: dp.indexOf("已进四维轨迹") >= 0, dp_has不产生: dp.indexOf("不产生总监消息") >= 0, dp_调用: dp.indexOf("registerToast") >= 0 });
	/* 坏样本 ⑤：把内联字面量写回组件 —— SN-14 必须抓到（把要验的**同一段文字**造进样本里） */
	t("CAL-5", "🔴 坏样本⑤（组件里写回内联字面量）**必须**被 SN-14 抓到 —— 否则「唯一构造点」永远绿",
		dp.indexOf("已进四维轨迹") < 0
		&& stripComments('say("已登记流转 · " + n + " 字符（已进四维轨迹；「登记」**不产生总监消息**）");').indexOf("已进四维轨迹") >= 0,
		{ 现码命中: dp.indexOf("已进四维轨迹"), 坏样本命中: stripComments('say("已登记流转 · x 字符（已进四维轨迹）");').indexOf("已进四维轨迹") });
}

console.log("\n═══════════════════════════════════════════════════════════");
const ran = pass + fail;
/* 🔴 下限是**下限**不是精确值：以后新增断言**必须**同步抬高它（不抬 = 把沉默合法化）。 */
const MIN_ASSERTIONS = 29;
const tally = tallyCheck(import.meta.url, { fn: "t", ran: ran, min: MIN_ASSERTIONS, label: "test-requirement22（纯离线 · G5/G6/G7）" });
if (!tally.ok) process.exit(2);
console.log("  PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
console.log("═══════════════════════════════════════════════════════════");
process.exit(fail ? 1 : 0);
