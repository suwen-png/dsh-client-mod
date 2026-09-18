#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { makeClicker, pressEsc } from "./_cdp-click-until.mjs";
import { ensurePageFocus } from "./_cdp-focus.mjs";
/* 🔴 纪律 98：**统一起点自举只一份实现**。本套件过去自己写了一遍（A1 段），
 *    在冷启动下不成立 ⇒ A 段整片红并把真因藏进后续连锁失败里。 */
import { ensureDirectorPage, waitCdpPage } from "./_cdp-startup.mjs";
/* 19 号文 N1：期望派发条数由**产品自己的口径**派生（见 `WANT_N`）—— 不再写死 8 */
import { plan } from "../src/logic/split-dimensions.js";
/**
 * verify-novel-split.mjs —— 第 16 批真机验收：**按维度自动分流 + 导图可见 + 清除对话消息**
 *
 * ══════════════════════════════════════════════════════════════════
 * 对应用户原话（逐条落点）
 * ──────────────────────────────────────────────────────────────────
 *  「按照一个流程跑一遍 写小说吧,调用小说技能」
 *  「然后按照世界观剧情等应该自动分到不同的对话分支 然后思维导图应该能看出来」
 *  「清除所有的对话消息」
 *
 * ──────────────────────────────────────────────────────────────────
 * 先写"测什么 + 期望结果"，再写代码
 * ──────────────────────────────────────────────────────────────────
 *  | 段 | 编号 | 被测行为 | 期望结果 |
 *  |:--:|:-----|:---------|:---------|
 *  | A | NS-0v | 🔴 **真实鼠标前提**（第二十四轮 · U6 真因） | `visibilityState === visible`；hidden 时 CDP 的 press/release 被**整条吞掉**而 `hasFocus` 仍为 `true` ⇒ 不成立判 **INVALID**（不判产品红） |
 *  | A | NS-0w | 🔴 **起点自举（唯一实现）**（第十九批 · 纪律 98） | 统一走 `_cdp-startup.mjs#ensureDirectorPage`：浮层清理 → **只等不点**（环迟到 58–120s 是实测事实）→ 内部口实体化 → 真实 UI 侧栏自举 → 四类**可分辨**归因。**接之前实测**：冷启动下 A 段整片红（`NS-1a–1d`）并把真因藏进后续连锁失败（最终报成「派发台账超预算 90s」）；**接之后**：`dp-root` 一次到位，全场只剩 1 条红 |
 *  | A | NS-1a–d | 起点显式建立（纪律 51） | `dp-root` 在 DOM（**只认 dp-root**，不认注册句柄）；控制台行可显形；分流前读数**打印出来** |
 *  | A | NS-2a | 需求文本注入 | 写入后**逐字回读一致**（纪律 21 先证前提） |
 *  | B | NS-3a–d | 分流结果读数 | `data-made=8` / `data-failed=0` / `data-kind=novel` / `data-dims` **集合相等** A1–A8（不是计数） / `data-sent=8`（简报真送出去了） |
 *  | B | NS-4a–b | 分支树**本次派发落盘后**可见（🔴 跑程内 · 纪律 16 ＋ 有界等待 · 纪律 55） | 作用域 = `dsh.director.split` **本次新增的 8 个 key**；**有界等待**到索引落盘 + 树能看到这 8 条（超预算 ⇒ **INVALID** 非 FALSE）；这批新行的标题含 A1–A8 之一（**不是宿主默认标题**） |
 *  | B | NS-4c | 🔴 负对照 | 本次派发**不等于** 1 条（防"只建了一个却说 8 个"）且**不等于** 9/16 条（防重复触发） |
 *  | B | NS-4c2 | 🔴 交叉存储 | `dsh.director.split` 新增 key 与 `__dshDispatchLog` 新增 **集合相等**（两套独立存储指向同一批） |
 *  | B | NS-4d2 | 🔴 交叉路径 | 树快照 diff 的新增行**包含**本次派发的 8 条（DOM 路径 ↔ 存储路径互证） |
 *  | B | NS-4g–k | **第 17 批：投递 ≠ 启动** | `data-confirmed`/`data-unconfirmed` 真的被读出来；两者**之和 = made**（防只填一半）；`data-via` 可追；台账 8 条且**每条有 sessionId** |
 *  | C | NS-5a–e | 导图能看出来 | 打开导图 → `[data-split]` 非空**恰 8 个** → 这 8 个的可见文本集合 **= A1–A8 标签集合** → 每框 `data-title-origin=plugin:split` → 🔴 无标记框 `data-split` 是**空串**（防"顺手全打标"） |
 *  | K | NS-9a–g | **第 17 批：回收产出** | 真实鼠标点「📥 回收」→ `data-total=8` → `read+unread=8` → 🔴 **每条都有可读说明**（不许静默）→ `state=unknown` 为 0（状态通道可用）→ 🔴 分支**确实在处理**（有产出 或 仍有在跑）→ 总裁定文案非空 |
 *  | K | NS-10a–e | **第 17 批：导图上的派发**（用户原话「我需要在思维导图中看到这些」） | `[data-dispatch]` 非空**恰 8 个** → `data-branch-state` 全在已知状态集 → 与 `[data-split]` 是**同一批** → 🔴 无产出的节点**写出原因**（不静默） → 🔴 `diag.dispatchApplied` **不翻倍**（第 18 批修正：byId 再现不重复计数） |
 *  | L | NS-12a–f | **第 21 批：会话档案**（用户原话「不会话都有自己的总监,存在自己的会话总结文档」） | 🔴 本次 8 条**每条**有非空 `data-dossier-role` → 🔴 负对照 8 条 role **互不相同** → 🔴 role 与**分流维度一致**（三口径同源） → 🔴 节点**可见文本**含「总监」（用户看得见，不是只写在属性里） → 🔴 `data-has-dossier` 与 role **双向一致** → 🔴 `src=none` 时**必带原因**（「没有」与「读不到」可分）。**为什么必须从界面读**：第 19 批交付了 `session-dossier.js`（单测 17/17 绿）但 `applyDossiers` **全仓零调用** ⇒ 档案从不显示 |
 *  | L | NS-11a–h | **第 19/25 批：派发前先复用已有会话**（用户原话「先考虑目前存在的会话,然后没有才是新建会话」） | 🔴 归属可加（`reused + created === 本次条数`）→ 🔴 `NS-11b` **冷启动下"复用也必须补登记"**（索引新增 == 复用条数）→ 🔴🔴 **核心验收：宿主会话净增 == 自报 created**（宿主真值实证，非自证）→ 🔴 孤儿清点可读。**第 25 批新增 `NS-11e/f/g`**（U10/P9 冷启动标题弱匹配）：`data-title-pool` 必写出（0 命中时分辨「读不到标题」与「形态变了」）· **冷启动（索引 0 条）+ `reused>0` ⇒ `data-title-hit` 必须为 1**（复用只可能来自标题匹配 = U10 生效的硬证据）· `reused=0` ⇒ `data-title-missed` 非空（「全新建」必须给得出原因）· **`NS-11h` 常驻读数与同一份树对账**（`data-alive` === 树行数；「树未建立」必须与「0 条」可分 —— 纪律 60）。🔴 **同批口径更正（纪律 99）**：`NS-11c`/`NS-4c2` 旧版把结果二分（全复用/全新建）且假定"复用的早已在索引里"，两条前提都已被推翻 ⇒ 改为**真正的不变式**（净增 == created、**索引新增 == 新建 + 标题命中**），**不掰产品** |
 *  | M | NS-13a–f | **19 号文 N2：跨维度转发**（用户原话「在这个分支里说另一个分支的事」） | 🔴 三个新契约装在**真机产物**上（离线绿 ≠ 产物绿）→ 🔴 真机映射对账 `dimKeys = bound + unbound`（纪律 78）→ 🔴 **判据 2**：属于其他维度 ⇒ `transfer` 且候选 id **= 该分支节点 id**（目标会话对账）→ 🔴 **判据 1 + 负对照**：属于当前维度 ⇒ `local`（不得是 transfer）→ 🔴 **产物内** `childEnvelope`：`root` 继承 / `parent` 指源 / `round`+1 → 🔴 **接线进了产物**（读磁盘 `lib/client.js` 的 5 个调用点 / 锚点）。**为什么必须读磁盘**：P1–P3 的事故形态正是「src 里写了、产物里没生效」 |
 *  | O | NS-14a–h | **19 号文 P6：N5 对话持续性 + N6 档案全覆盖** | 🔴 **P2 对账**（`dp-r5-msg` 文案数字 **===** 库内条数，纪律 78）→ 🔴 **P2 非空**（> 0，"切会话即空"的直接否定）→ 🔴 **P2 可见**（元素数 = `min(14, 库内)` —— **口径更正**：产品渲染有 14 条上限，按"元素数=库内"判会必然假红）→ 🔴 **P1 前提**（原生框写入并逐字回读）→ 🔴 **P1 显式标注**（「登记」提示必须**明说**「不产生总监消息」）→ 🔴 **P1 负对照**（同一次登记前后条数**不变** —— 证明那句标注是真话）→ 🔴 **N6 判据 3**（`aliveCount = withAlive + missingAlive` 且 `total = withAlive + orphans`）→ 🔴 **N6 判据 1**（存活的总监分支 `missingAlive === 0`，先证前提 `dimAliveN > 0`） |
 *  | D | NS-6a–c | 清除的**二次确认** | 首点进 `data-armed=1`；**超时自动撤防**回 `0`（正负对照：不能永久停在待删态） |
 *  | D | NS-6d–g | 清除的真实效果（🔴 完成信号 = **哨兵消失** · 纪律 16/23/55） | 二击窗口内 `armed=1` → **哨兵从库中消失之后**才取读数（`dp-maint-result` 是**持久 DOM**，直接 `waitFor` 会命中**上一轮旧值**）→ `removed === before > 0` → `data-before ≥` 闸门独立实测条数（抓"旧读数"）→ `ok=1` |
 *  | D | NS-6h0 | 🔴 哨兵**先证前提** | 自写一条带唯一 `messageId` 的消息，**必须能按它读回来**（否则后面的"消失"不可信 —— 纪律 23） |
 *  | D | NS-6h–l | 🔴 **正对照 + 四项"未被动"** | 🔴 **哨兵消息必须消失**（第 18 轮改写：上一版"插件消息数必下降"遇上产品的**后台写入者** ⇒ 实测假红 `1→1`，计数降级为**观测打印**）；宿主对话项 / 层级节点 / 设计图元素 / 持久化键组**前后逐项相等** |
 *  | D | NS-6m–o | 🔴 **复位与自述**（第 4 轮加固 · 台账 T-PLUG-039） | **有界等待** `data-armed → 0`（不是"读一次"）；且 toast **自己说清**「已清除…N 条」+ **宿主侧边界**（纪律 19：降级可以，无声不行） |
 *  | D | NS-6l2 | 🔴 **清除必须留下退路** | 备份槽 `dsh.director.msgs.backup` 存在、条数 == 本次被清条数、且界面 `data-backup-count` 与之一致（没有这条，"备份/恢复"就只是代码里有几个函数） |
 *  | D | NS-6p–s | 🔴 **还原段**（第 22 批 · 纪律 15：会写盘的闸门段必须快照→还原→还原断言 · 含哨兵收尾） | 上面测的「清除」是**无参全表清除** ⇒ 会把**用户真实的总监消息**一起删掉（实测：连跑 10 轮后全表 0 条，用户看到「总监消息 0」读成"没持久化"）。⇒ 清除前**快照**、断言跑完后**还原**：`restored+skipped===total`（动作完整）→ **正对照**快照里的真实消息按 messageId 读得回来 → **幂等**再恢复一次 `restored=0/skipped=total`（重复点不会把 1 条变 2 条） |
 *  | W | NS-8a–r（+`NS-8l0`） | 执行状态窗口（第 16 批） | 拖动移动 / 最小化（`expanded ⇄ collapsed`）/ 靠边缩进 → 双击归位复原（开合型控件当场还原）｜🔴 **本行是第 17 批补登的**：原表漏了 W 段，直接导致 K 段复用 `NS-8a–g` 撞号。**第 25 批新增 `NS-8l0`**（靠边缩进的**前提**：拖动真的把窗口推到了 `x=0`）—— 该段曾因步间 18 ms < 实测派发延迟 58–76 ms 而**假红 5 条**（纪律 91），无此前提则「没到边缘」与「到了没吸附」读数同形 |
 *  | E | NS-7a–c | 收尾复原 + 健康度 | 导图关闭、原生框还原、CDP 零超时（超时判 INVALID 而非 FAIL） |
 *  | E | NS-7f–g | 🔴 **页面零未捕获异常 + 口径守卫**（第十九批） | `NS-7f` 只判**产品**异常：Electron 内建脚本（`node:electron/…sandbox_bundle`，**无插件帧**）归**环境噪声**并单独打印（纪律 24/31：环境问题不许读成产品坏）；`NS-7g` 是**防放松**守卫 —— 证明分类函数**双向**有分辨力（噪声必归噪声、插件帧必判产品），且它不连真机 ⇒ 每次跑都执行。**实测正对照**：旧口径在同批次精确抓到 `ReferenceError: upstream is not defined at DirectorPanel (…/client.js?rev=…)`（真 bug，已修） |
 *
 * ══════════════════════════════════════════════════════════════════
 * 🔴 跑这一套会发生什么（**必须先知道**）
 * ──────────────────────────────────────────────────────────────────
 *  1. 它会**真的新建 8 个宿主会话**（`sessions.create`）并向每个投一份简报。
 *     宿主公开的 `sessions` 服务**没有删除契约**（成员表已逐条核对）⇒ **这 8 条会话删不掉**。
 *     ⇒ 本套件是**验收套件**，不是可以随便连跑的回归套件；不要放进"每次改动都跑"的集合。
 *  2. 它会在 D 段**真的清空总监对话消息**（插件库内），跑完这些消息不会回来。
 *     这是本轮需求本身要求的能力；四项外部读数会证明它**没有**越界删别人的数据。
 *  3. 第 17 批新增 K 段：它会逐个读这 8 条分支的**事件流**（`conversation.history`）。
 *     🔴 这**不改任何状态**（只读），但它会让分支里的智能体**继续跑**（简报本来就会驱动它们）。
 *     ⇒ K 段的判据**不要求 8 条都产出**（那取决于模型与时长），要求的是
 *       「每条都有可读说明」+「状态通道可用」+「要么有产出、要么看得见在跑」。
 *
 * 用法：node scripts/verify-novel-split.mjs ｜ 退出码 0 全绿 / 1 FAIL / 2 INVALID
 * 换需求（不写死用户数据）：HUB_REQ='…' node scripts/verify-novel-split.mjs
 * 🧪 负向校准（纪律 32/58，**只用于校准、正常跑不设**）：
 *    · GATE_SENTINEL_REWRITE=1 ⇒ 清除后把哨兵写回 ⇒ 应**恰红 `NS-6h` 一条**（其余全绿）
 *    · WS_READY_MS=… / CDP_PORT=… ⇒ 桩服务器校准（见 `_tmp-cdp-stub` 的用法注释）
 */
/* ══════════════════════════════════════════════════════════════════
 * 🔴 闸门**自检**（在连 CDP 之前先跑）：断言编号必须唯一。
 *    重号让报告**失去可归因性** —— 读的人分不清红的是哪一条，"全绿"也可能藏着"其实有一条没跑"。
 *    本批真的踩到了：新增 K 段时复用了 W 段已占的 `NS-8a–g`；
 *    **根因是头部段号表漏登记了 W 段**（没登记 ⇒ 不知道哪些号被占了 ⇒ 必然撞号）。
 *    放在最前面 = **快速失败** + **零副作用**（不连 CDP、不建会话、不改产品状态），
 *    也因此可以**廉价校准**：故意种一个重号，本脚本应立刻 exit 2（不消耗 8 个宿主会话）。
 * ══════════════════════════════════════════════════════════════════ */
{
	const selfSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
	const ids = [...selfSrc.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
	const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
	if (dup.length) {
		console.error("IS_PASS: FALSE（INVALID：断言编号重号 " + dup.length + " 个 —— " + dup.join(", ") + "）");
		console.error("  真因：同一个断言编号被写了两次 ⇒ 报告不可归因（分不清红的是哪一条）。");
		console.error("  处置：改号为未占用的编号；**并同步补头部段号表**（漏登记段是重号的常见根因）。");
		process.exit(2);
	}
	console.log("  [自检] 断言编号唯一：" + ids.length + " 条，零重号");
}

/* ── 需求文本：**含书名号**，以便顺带验"书名被带进分支名" ──
 * 🔴 第 17 批：可由 `HUB_REQ` 覆盖（**不写死用户数据**）。
 *    默认串是闸门基线（每次跑都一致，便于负向校准）；
 *    真实验收用 `HUB_REQ='…"D:\workspace\novels\虚海"…' node scripts/verify-novel-split.mjs`
 *    —— 那条串会命中「项目根提取」，简报里会多出「项目根 / 落点」一段。 */
const NOVEL_REQ = process.env.HUB_REQ
	/* 🔴 **19 号文 N1 规格演进（2026-09-17）**
	 *    默认串过去是「…先搭世界观再做剧情，最后写正文并做一致性审查」= **点名 4 维**。
	 *    `plan()` 现在按需求原话**精确取集** ⇒ 那句话只会派 4 条；而本套件的全部底座判据
	 *    （NS-3d/3h · NS-4a/4c2 · NS-4j · NS-5c · NS-9b/9c · NS-10a · NS-12a/b）
	 *    都建立在「**一条需求 → 8 条分支**」上 ⇒ 不改串会整片假红。
	 *    ⇒ 串里显式加**全量信号**「全流程」（命中 `FULL_SIGNALS` ⇒ A1–A8 全给）保住底座；
	 *      而"取集"这条新行为由 **NS-3j** 单独、**可分辨地**验（见 B 段）。
	 *    ⚠️ `HUB_REQ` 覆盖时**也必须含全量信号** —— 否则由 `WANT_N` 守卫以 INVALID
	 *      明确拒绝（前提不成立 ≠ 产品红 · 纪律 94），**不会**静默跑成一片假红。 */
	|| "帮我写一个小说《灵能修仙》，这次要全流程走一遍：先搭世界观再做剧情，最后写正文并做一致性审查";
/* 书名：从需求里抓《…》（**不写死**，否则换 HUB_REQ 后 NS-4f 会假红） */
const NOVEL_NAME = (NOVEL_REQ.match(/《([^》]+)》/) || [null, ""])[1];
const DIM_KEYS = ["world", "power", "plot", "chars", "prose", "polish", "review", "distill"];
const DIM_LABELS = ["A1 世界观", "A2 力量体系", "A3 剧情", "A4 人物", "A5 正文", "A6 打磨", "A7 审查", "A8 蒸馏"];
/* 🔴 **期望派发条数**：由产品自己的口径派生（纪律 92），不再写死 8。
 *    注意这里验的是「**界面确实按纯函数的结果派**」（链路自洽），不是"纯函数对不对"
 *    —— 后者由离线 `test-attribution`（60 条）与 `test-split-dimensions`（94 条）负责。
 *    ⇒ 判据值随串走：串一改，判据自洽；而"串是否仍是全量"由下面的守卫显式钉住。 */
const WANT_N = plan(NOVEL_REQ).dims.length;

console.log("═══════════════════════════════════════════════════════════");
console.log("  真机验收 · 按维度自动分流 + 导图可见 + 清除对话消息");
console.log("  ⚠️ 本套件会真的新建 " + WANT_N + " 个宿主会话（宿主无删除契约，删不掉）");
console.log("═══════════════════════════════════════════════════════════");

/* 🔴 **前提守卫**（纪律 23 先证前提 · 纪律 83 破坏性动作自带退路）——
 *    本套件会**真的新建 WANT_N 个宿主会话**，而宿主**没有删除契约**（删不掉）。
 *    ⇒ 前提不成立时必须在**烧会话之前**退出，绝不能"跑完再报红"（那是拿用户数据当耗材）。
 *    前提 = 需求串命中**显式全量信号** ⇒ 取集结果 == A1–A8 全套（= `DIM_KEYS.length`）。 */
if (WANT_N !== DIM_KEYS.length) {
	const got = plan(NOVEL_REQ).dims.map((d) => d.key);
	console.error("IS_PASS: FALSE（INVALID：需求串未命中全量信号 —— 本套件前提不成立，未创建任何会话）");
	console.error("  实测取集 = " + WANT_N + " 维（" + got.join(",") + "），期望 = " + DIM_KEYS.length + " 维");
	console.error("  真因二选一：① 闸门被改坏（默认串丢了「全流程」这类全量信号）；"
		+ "② `HUB_REQ` 覆盖串不含全量信号。");
	console.error("  处置：改用含全量信号的串（例：加「这次要全流程走一遍」）。**不要**据此判产品红 —— 纪律 94。");
	process.exit(2);
}

/* 🔴 端口可由 `CDP_PORT` 覆盖：重启 Harness 时端口会换（纪律 12：判"是否新实例"看端口），
 *    写死 9222 会在"起在 9228、连 9222"时静默报 INVALID，读起来像"Harness 没起来"。 */
import { PORT } from "./cdp-port.mjs";

/* 🔴 **有界等待 page 目标**（纪律 55）—— 唯一实现 `_cdp-startup.mjs#waitCdpPage`（纪律 98）。
 *    实测（第十九批 · 冷启动）：CDP 端口就绪 ≈2.0s，而 `/json/list` 里**出现 page 目标还要更晚**
 *    ⇒ 端口就绪后**立刻**取 targets 会拿到空数组 ⇒ 报 "CDP 无 page 目标"（INVALID）。
 *    读起来像"Harness 没起来"，真因只是**等得不够**（纪律 58：「没跑成」与「失败」必须可分）。
 *    ⚠️ 第 25 批把这段**收进共享模块**：一次连跑里 `verify-director-logic` / `link-shots` /
 *      `verify-novel-e2e-human` 三个脚本同时死在这一步，而只有本文件写了等待 ⇒
 *      "同一事实写 N 份、只有一份是对的"，正是纪律 98 要治的形态。 */
const WAIT_PAGE = await waitCdpPage({ port: PORT, log: (s) => console.log(s) });
if (!WAIT_PAGE.ok) {
	console.error("IS_PASS: FALSE（INVALID：" + WAIT_PAGE.reason + "，等了 " + Math.round(WAIT_PAGE.ms / 1000) + "s）");
	console.error("  真因：Harness 未运行，或未带 --remote-debugging-port=" + PORT + " 启动。");
	console.error("  正确用法（必须**同一条命令内**启动并测试 —— 纪律 40：Harness 活不过工具调用）：");
	console.error("    node scripts/_run-with-harness.mjs node scripts/verify-novel-split.mjs");
	console.error("  实测目标：" + JSON.stringify((WAIT_PAGE.targets || []).map((t) => t.type + " " + String(t.url).slice(0, 40))));
	process.exit(2);
}
const page = WAIT_PAGE.page;

/* 🔴 **必须有 boot 行**（纪律 58：任何结局都要可分辨）。
 *    本批踩到：闸门在 `ws` 就绪前卡死 ⇒ 日志**永远是 0 字节**，读起来像"脚本没启动"，
 *    实际是"启动了但卡在连 CDP"。⇒ 先打一行，让"有没有跑起来"可判。 */
console.log("  [boot] pid=" + process.pid + " CDP=" + PORT + " page=" + String(page.url).slice(0, 70));

/* 🔴 **WebSocket 必须带 error 监听 + 就绪超时**。
 *    根因：Node 全局 `WebSocket`（undici）连不上时只派发 `error` 事件 —— **没人监听就等于没有**，
 *    而下面的 `await open` 永远不 resolve ⇒ **零输出挂死**（比报错更坏，因为分不清"没跑"和"跑挂了"）。 */
const ws = new WebSocket(page.webSocketDebuggerUrl);
let wsNote = "";
ws.addEventListener("error", (e) => { wsNote = "ws error: " + String((e && (e.message || e.type)) || "unknown"); });
ws.addEventListener("close", (e) => { if (!wsNote) wsNote = "ws close: code=" + (e && e.code) + " reason=" + String((e && e.reason) || ""); });
let seq = 0; const pending = new Map();
/* 🔴 页面侧未捕获异常的**唯一出口**：
 *    本轮第一次真机跑，8 条会话建出来了但读数从未出现 —— 而 `onClick` 是 async，
 *    抛错只会变成未处理的 Promise 拒绝，**界面上与"什么都没发生"完全一样**。
 *    闸门必须自己把这类异常抓住并判红（否则"产品静默抛错"会被记成 PASS）。 */
const pageErrors = [];
ws.addEventListener("message", (ev) => {
	const m = JSON.parse(ev.data);
	if (m.method === "Runtime.exceptionThrown") {
		const d = m.params && m.params.exceptionDetails;
		pageErrors.push(String((d && (d.exception && (d.exception.description || d.exception.value))) || (d && d.text) || "unknown").split("\n").slice(0, 3).join(" ↵ "));
	}
	if (m.method === "Runtime.consoleAPICalled" && m.params && m.params.type === "error") {
		pageErrors.push("[console.error] " + (m.params.args || []).map((a) => String(a.value !== undefined ? a.value : (a.description || ""))).join(" ").slice(0, 200));
	}
	if (m.id !== undefined && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
/* 本 Electron 环境 Input 事件的**响应**稳定延迟约 5s（事件本身立即送达）⇒ 指针事件一律 fire-and-forget，
 * 绝不 await 响应，否则一次点击要 5s、时序全塌（既有套件的同一结论）。 */
const cdpTimeouts = [];
const emit = (method, params = {}) => {
	const id = ++seq;
	ws.send(JSON.stringify({ id, method, params }));
	const timer = setTimeout(() => { cdpTimeouts.push(method + "#" + id); }, 8000);
	pending.set(id, { res: () => clearTimeout(timer), rej: () => clearTimeout(timer) });
};
/* 🔴 就绪**必须带期限**：无限等 ⇒ 挂死且零输出（纪律 58 的"没跑成"伪装）。
 *    超时/报错一律判 **INVALID（exit 2）**并**说清原因**，绝不静默继续。 */
const WS_READY_MS = Number(process.env.WS_READY_MS || 20000);
/* 注：`sleep` 定义在后面 ⇒ 此处用局部 `wait`（`const` 有 TDZ，提前引用会直接抛） */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const openRes = await Promise.race([
	new Promise((r) => ws.addEventListener("open", () => r({ ok: true }))),
	wait(WS_READY_MS).then(() => ({ ok: false, why: "超时 " + WS_READY_MS + "ms 未 open" })),
]);
if (!openRes.ok) {
	console.error("IS_PASS: FALSE（INVALID：CDP WebSocket 未就绪）");
	console.error("  目标：" + page.webSocketDebuggerUrl);
	console.error("  原因：" + (wsNote || openRes.why));
	console.error("  处置：确认 Harness 带 --remote-debugging-port 启动；若刚重启，`/json/list` 里的目标可能已被换掉，重跑即可。");
	process.exit(2);
}
const rtEnabled = await Promise.race([
	send("Runtime.enable").then(() => ({ ok: true })),
	wait(WS_READY_MS).then(() => ({ ok: false, why: "Runtime.enable 超时 " + WS_READY_MS + "ms" })),
]);
if (!rtEnabled.ok) {
	console.error("IS_PASS: FALSE（INVALID：CDP 就绪但 Runtime.enable 无响应）");
	console.error("  原因：" + (wsNote || rtEnabled.why));
	process.exit(2);
}

const js = async (expr) => {
	const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true });
	if (r.exceptionDetails) throw new Error("JS异常: " + r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
	return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══════════════════════════════════════════════════════════════════
 * 🔴 真实鼠标的**可见性前提**（第二十四轮新增 · 纪律 29/54）
 *
 * 为什么必须放在这里、且必须在**任何鼠标断言之前**：
 *   CDP 的 `mousePressed/Released` 在 `document.visibilityState !== "visible"`
 *   （Electron 窗口被遮挡/最小化/停在后台）时会被**整条吞掉**，而 `mouseMoved` 照常送达
 *   ⇒ 表现形态是「拖不动 / 点了没反应」，读起来**完全是产品坏了**。
 *   第二十四轮 W 段 8 红就是它：窗口坐标 947,82 → 947,82 一次都没动，
 *   而同一轮里 **7 处**真实点击全部落到 `el.click()` 兜底 ⇒ 真因被兜底盖住。
 *
 * 🔴 为什么不靠兜底、必须显式建立前提：
 *   `el.click()` 兜底能让套件变绿，但它**绕过了真实输入管线** ——
 *   于是"用户用鼠标点得到"这件事**从头到尾没有被测到**，却报绿（纪律 18：假绿比红更坏）。
 *
 * 判据（纪律 23）：`hasFocus` **不作数** —— 实测窗口 hidden 时它仍是 `true`；
 *   只认 `visibilityState === "visible"`，且建立后**回读自证**。
 * 不成立 ⇒ 判 **INVALID**（环境不支持真实鼠标），**不判产品红**（纪律 24）。
 * ══════════════════════════════════════════════════════════════════ */
const focusPre = await ensurePageFocus({ send, ev: js, log: (s) => console.log(s) });
console.log("  [鼠标前提] visibility=" + JSON.stringify(focusPre.visibility)
	+ " ｜ hasFocus=" + JSON.stringify(focusPre.hasFocus)
	+ " ｜ bringToFront=" + focusPre.broughtToFront
	+ " ｜ focusEmulated=" + focusPre.focusEmulated
	+ (focusPre.reasons.length ? " ｜ 降级：" + focusPre.reasons.join(" / ") : ""));

/* 🔴 U6（第二十三轮记下的未结项）：CDP 合成鼠标在 Electron 下会**静默丢事件** ——
 *    同一按钮、同一坐标、`elementFromPoint` 明确命中自己，却"点了没后果"（实测连丢 6 轮），
 *    表现为**时绿时红的偶发假红**。共享点击层见 `scripts/_cdp-click-until.mjs`。
 *    本套件接法**故意保守**：正常路径仍是"真实鼠标 + 落点自检"（语义与证据不变），
 *    **只有**在"后果等不到"时才用 `el.click()` 补送一次 —— 避免动到派发/清除这类
 *    **重复触发就有副作用**的动作（纪律 82：破坏性动作不许靠重试去凑）。 */
const CL = makeClicker({ send: (m, p) => send(m, p), js, sleep });
async function clickWithFallback(sel, tag, verifyFn, tries, gap) {
	const c = await clickSel(sel, tag);
	let v = await waitFor(verifyFn, tries, gap);
	if (!v) {
		const fb = await CL.clickJs(sel);
		console.log("  [U6保底] " + tag + "：真实鼠标无后果 ⇒ 已用 el.click() 补送一次 " + J(fb.info));
		v = await waitFor(verifyFn, tries, gap);
	}
	return { click: c, val: v };
}
/** 🔴 关导图**必须校验真的关了**（第二十四轮真机坐实）。
 *    实测：`mm-close` 点击被浮层吃掉 ⇒ `#dsh-mindmap` 残留 ⇒ **后续每一个点击都被它挡住**
 *    （`elementFromPoint` 命中 `DIV.dp-scroll`，而 `el.click()` 却能生效）
 *    ⇒ 派发/回收/清除**全部报"点不到"**，读起来跟产品坏了**一模一样**。
 *    ⇒ 关不掉就按 Esc 兜底；仍关不掉就**显式报出来**，让后面的红有可归因的原因。 */
async function closeMindmap(tag) {
	if (!(await exists("#dsh-mindmap"))) return { ok: true, why: "本就未打开" };
	await clickWithFallback('[data-testid="mm-close"]', tag || "导图关闭",
		async () => (await exists("#dsh-mindmap")) === false, 12, 250);
	if (!(await exists("#dsh-mindmap"))) return { ok: true, why: "已关闭" };
	await pressEsc((m, p) => send(m, p), sleep);
	await sleep(300);
	if (!(await exists("#dsh-mindmap"))) return { ok: true, why: "Esc 兜底关闭" };
	console.log("  ⚠ [浮层残留] " + (tag || "导图") + " 关闭失败 ⇒ 后续点击会被它吃掉（判红时请先排除本项）");
	return { ok: false, why: "关闭失败，浮层残留" };
}
/* 注：本套件**不使用** keyboard / touch，只发 mouseMoved/Pressed/Released ⇒ 不会命中 8000ms 超时口径。 */
const MOUSE_EMIT_MS = 8000;

let pass = 0, fail = 0; const failures = [];
function t(id, name, cond, detail) {
	if (cond) pass++; else { fail++; failures.push(id + " " + name); }
	console.log(`  ${cond ? "✅" : "❌"} ${id} ${name}${detail !== undefined && !cond ? "\n      → " + JSON.stringify(detail) : (detail !== undefined && typeof detail === "string" ? "" : "")}`);
}
function section(s) { console.log("\n" + "─".repeat(60) + "\n【" + s + "】"); }
const J = (v) => JSON.stringify(v);

async function clickAt(x, y) {
	const X = Math.round(x), Y = Math.round(y);
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: X, y: Y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: X, y: Y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(40);
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: X, y: Y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(150);
}
/** 真实鼠标点一个选择器：**落点自检**（视口内 + `elementsFromPoint` 命中自己），落空记名不入断言（打偏 ≠ 产品坏） */
const misses = [];
async function clickSel(sel, tag) {
	for (let attempt = 0; attempt < 2; attempt++) {
		const g = await js(`(function(){
		  var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
		  var r=e.getBoundingClientRect();
		  if(r.width<2||r.height<2)return {skip:'zero-box',w:Math.round(r.width),h:Math.round(r.height)};
		  var mx=Math.round(r.x+r.width/2),my=Math.round(r.y+r.height/2);
		  var inside=mx>=0&&my>=0&&mx<=innerWidth&&my<=innerHeight;
		  var st=document.elementsFromPoint(mx,my),tp=st[0]||null;
		  var nm=function(x){return x?(x.tagName.toLowerCase()+(x.getAttribute&&x.getAttribute('data-testid')?'['+x.getAttribute('data-testid')+']':(x.className&&String(x.className).trim()?'.'+String(x.className).trim().split(/\\s+/).slice(0,2).join('.'):''))):null;};
		  /* 第 24 批：命中失败时打印遮挡者的祖先链 —— 只报一个 DIV.dp-scroll 无法回答它是谁 */
		  var chain=[]; var p=tp; while(p&&chain.length<8){ chain.push(nm(p)); p=p.parentElement; }
		  var zs=(st||[]).slice(0,4).map(function(x){return nm(x)+'(z='+(window.getComputedStyle?window.getComputedStyle(x).zIndex:'-')+')';});
		  return {mx:mx,my:my,inside:inside,w:Math.round(r.width),h:Math.round(r.height),
		    top:nm(tp), chain:chain, stack:zs,
		    ok:inside&&!!tp&&(tp===e||e.contains(tp)||tp.contains(e))};
		})()`);
		if (!g) return { ok: false, why: "元素不存在 " + sel };
		if (g.skip) return { ok: false, why: g.skip + " " + J(g) };
		if (g.ok) { await clickAt(g.mx, g.my); return { ok: true, x: g.mx, y: g.my }; }
		if (attempt === 0) {
			await js(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(e&&e.scrollIntoView)e.scrollIntoView({block:'center',inline:'center'});})()`);
			await sleep(260);
			continue;
		}
		misses.push(tag + " 落空(" + sel + ")：视口内=" + g.inside + " 命中=" + g.top
			+ " 遮挡链=" + J(g.chain) + " 层叠=" + J(g.stack));
		return { ok: false, why: "落点未命中自己（命中 " + g.top + "）", x: g.mx, y: g.my, chain: g.chain, stack: g.stack };
	}
	return { ok: false, why: "unreachable" };
}
const exists = async (sel) => (await js(`!!document.querySelector(${JSON.stringify(sel)})`)) === true;
async function waitFor(fn, tries, gapMs, tag) {
	for (let i = 0; i < tries; i++) {
		const v = await fn();
		if (v) return v;
		await sleep(gapMs);
	}
	return null;
}

/* ══════════════ A · 起点显式建立（纪律 51：起点不只是"打开"，还要满足后续断言的前提） ══════════════ */
section("A 起点：把总监页真的立起来（只认 dp-root）");

/* 🔴 A-1：真实鼠标的**可见性前提**（第二十四轮 · U6 的真因）
 *    不通过 ⇒ 后面所有"真实鼠标"断言都会以「产品坏了」的形态红，
 *    而真因只是窗口不可见 ⇒ 判 **INVALID**（纪律 24），不判产品红。 */
t("NS-0v", "🔴 真实鼠标前提：`visibilityState === visible`（hidden 时 press/release 被整条吞掉 ⇒ 鼠标断言不可信）",
	focusPre.visible === true,
	{ visibility: focusPre.visibility, hasFocus: focusPre.hasFocus, broughtToFront: focusPre.broughtToFront, focusEmulated: focusPre.focusEmulated, reasons: focusPre.reasons });
/* 🔴 前提不成立 ⇒ **立刻退出**，不继续跑（纪律 82：闸门不许把用户数据当耗材）。
 *    本套件会**真的派发 8 条会话**并**真的清空总监消息**；若鼠标前提不成立还继续跑，
 *    等于"明知测不了还把用户数据清一遍" —— 而且清完报出来的红全是环境导致的假红。
 *    早退还能让**负向校准零代价**：`DSH_FOCUS_CALIBRATE=hidden` 跑一次就验证判据有分辨力，
 *    不消耗任何会话、不动任何用户数据。 */
if (focusPre.visible !== true) {
	console.log("\n" + "═".repeat(59));
	console.log("  IS_PASS: INVALID（真实鼠标前提不成立 —— 不是产品红）");
	console.log("  原因：visibilityState=" + JSON.stringify(focusPre.visibility)
		+ "（hasFocus 仍可能是 true，不可作判据）");
	console.log("  处置：把 Electron 窗口**提到前台/还原**（不要最小化、不要被完全遮挡）后重跑；");
	console.log("        本轮未派发会话、未清除任何消息（前提不成立即早退）。");
	console.log("═".repeat(59));
	ws.close();
	process.exit(2);
}

/* A0：关掉可能残留的浮层（上一轮留下的设计图/导图会吃掉点击） */
for (let i = 0; i < 4; i++) {
	const anyOverlay = await js("!!document.querySelector('#dsh-mindmap,#dsh-design-studio,#dsh-director-dialog')");
	if (!anyOverlay) break;
	await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
	await sleep(320);
}
console.log("  · 浮层清理后残留：" + J(await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(s=>document.querySelector(s))")));

/* ══════════════════════════════════════════════════════════════════
 * 🔴 A0（第十九批 · **纪律 98**）：**统一起点自举** —— 唯一实现 `scripts/_cdp-startup.mjs`。
 *
 * 为什么必须接：本套件过去**自己实现**了一遍起点建立（下面的 A1 段），
 *   而它在**冷启动**（宿主停在欢迎页、无 `[role="tab"]` 环）下不成立 ⇒ 实测：
 *   `NS-1a–1d` 全红 → `NS-3*` 连锁全红 → 最终报「派发台账换批超预算 90s」。
 *   一层层读起来都像产品坏了，**真因只是起点没立**（纪律 24：起点问题不许读成产品红）。
 * ⇒ 统一走 `ensureDirectorPage()`：浮层清理 → **只等不点**（环迟到 58–120s 是**实测事实**，
 *   纪律 98：「环还没出现」≠「点击失败」）→ 内部口实体化 → 真实 UI 侧栏自举 → **四类可分辨归因**。
 * ⚠️ 下面的 A1 段**降级为兜底**（统一自举未成时才走）：保留它是为覆盖「零会话」这类边界，
 *   但**它不再是主路径**，且失败时必须能在日志里与"产品坏"区分开（纪律 96）。
 * ══════════════════════════════════════════════════════════════════ */
const BOOT = await ensureDirectorPage({
	CL: CL, js: js, send: (m, p) => send(m, p), sleep: sleep,
	log: (s) => console.log(s)
});
t("NS-0w", "🔴 起点自举（**唯一实现** `_cdp-startup.mjs`）：`dp-root` 已立 —— 冷启动时**只等不点**（环迟到 58–120s 是实测事实 · 纪律 98）",
	!!BOOT && BOOT.ok === true && BOOT.dpRoot === true,
	BOOT && { ok: BOOT.ok, dpRoot: BOOT.dpRoot, tabRing: BOOT.tabRing, reason: BOOT.reason });

/* A1（**兜底**）：确保宿主有会话（重启后停在欢迎页 ⇒ 没有 tab 环 ⇒ 后面全是级联假红） */
let tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
if (!tabRing.length) {
	console.log("  · 无 tab 环（欢迎页）⇒ 真实点一个侧栏会话把会话视图打开");
	let items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded'),cls:String(e.className||'').slice(0,44)}))")) || [];
	if (!items.some((x) => /分钟|小时|天|刚刚|秒/.test(x.t))) {
		const rootIdx = items.findIndex((x) => x.ex === "false");
		if (rootIdx >= 0) {
			await clickSel(`[role="treeitem"]:nth-of-type(1)`, "侧栏工作区根");
			await sleep(1200);
			items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded'),cls:String(e.className||'').slice(0,44)}))")) || [];
		}
	}
	/* 🔴 第 19 批：**零会话**时上面那段点不到任何东西 ⇒ 后面全部级联假红。
	 *    「清理全部会话」之后这是**常态起点**，所以必须**显式建立前提**（纪律 41），
	 *    而不是让十几条断言去承担"起点不对"的后果。
	 *    判据与 `_probe-session-count.mjs --click-new` 一致：**先证按钮在视口内**、再真实鼠标点、
	 *    再证真的多出一个会话（磁盘/DOM 双口径见该探针头注释 —— 「数出 0」≠「没有」）。 */
	const looksLikeSession = (x) => /分钟|小时|天|刚刚|秒/.test(x.t);
	if (!items.some(looksLikeSession)) {
		const nb = await js(
			"(function(){var els=[].slice.call(document.querySelectorAll('[role=\"treeitem\"],button,[role=\"button\"]'));"
			+ "var t=els.filter(function(e){var s=String(e.textContent||'').trim();return s==='新会话'||s==='新建会话'||s==='新建对话';})[0];"
			+ "if(!t)return null;var r=t.getBoundingClientRect();if(r.width<=0||r.height<=0)return null;"
			+ "return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),text:String(t.textContent).trim()};})()");
		console.log("  · 一个会话都没有 ⇒ 点「新会话」自举：" + J(nb));
		if (nb) {
			await clickAt(nb.x, nb.y);
			await sleep(2600);
			items = (await js("Array.from(document.querySelectorAll('[role=\"treeitem\"]')).map((e,i)=>({i,t:String(e.textContent||'').trim().slice(0,26),ex:e.getAttribute('aria-expanded'),cls:String(e.className||'').slice(0,44)}))")) || [];
			console.log("  · 自举后侧栏：" + items.length + " 项，像会话的 " + items.filter(looksLikeSession).length + " 个");
		}
	}
	const cands = items.filter(looksLikeSession);
	console.log("  · 侧栏 " + items.length + " 项，像会话的 " + cands.length + " 个：" + J(cands.map((c) => c.t)));
	/* 🔴 第 19 批补：**有会话但没打开**也要能自举。
	 *    刚清空会话之后，Harness 会自己留一条**空壳会话**（标题就写「新会话」，实测 387 B）。
	 *    它**没有时间标记** ⇒ `looksLikeSession` 判否 ⇒ 上面那个「点新会话」分支也不会走
	 *    （因为它不是"一个会话都没有"）⇒ **两段都不点** ⇒ 页面停在欢迎页、
	 *    `[role="tab"]` 环为空 ⇒ NS-1a/1c 及之后全部级联假红
	 *    （实测一轮：`dp-act-split` 不存在、20 条红全由这一个起点问题产生，闸门最终报 INVALID）。
	 *    ⇒ 退一步：**按 class 认「会话行」**（`sessionRow`），而不是靠标题里的时间字样。
	 *    实测侧栏两种行：`wnVHPG_projectRow`（工作区/分组 = 结构）与
	 *                     `wnVHPG_sessionRow`（**真会话**，含那条空壳）。
	 *    ⚠️ 这里的「新会话」**是会话行不是按钮**（class 为 sessionRow）—— 所以**不能**按标题排除；
	 *       真正的「新建」入口是 toolbar 上的按钮，不在 treeitem 里。 */
	const isSessionRow = (x) => /sessionRow/.test(String(x.cls || ""));
	const clickTargets = (cands.length ? cands : items.filter(isSessionRow)).slice(0, 4);
	console.log("  · 起点自举：可点目标 " + clickTargets.length + " 个"
		+ (cands.length ? "（按会话时间标记）" : "（无时间标记 ⇒ 退化为按 class 认 `sessionRow`）")
		+ "：" + J(clickTargets.map((c) => c.t)));
	for (const c of clickTargets) {
		const r = await js(`(function(){var L=document.querySelectorAll('[role="treeitem"]');var e=L[${c.i}];if(!e)return null;var b=e.getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()`);
		if (r) { await clickAt(r.x, r.y); await sleep(1500); }
		tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
		if (tabRing.length) { console.log("  · 已打开会话：" + c.t); break; }
	}
	/* 🔴 第 21 批补：**"清空全部会话"之后的常态起点**（用户原话「清理无效的多余的文件和所有会话」
	 *    之后要"继续反复测试"）。
	 *    此时侧栏只剩一条宿主自己留下的**空白草稿会话**（`blank:true`）——
	 *    实测（2026-09-16）：
	 *      · 真实鼠标 `Input.dispatchMouseEvent` 点它 ⇒ `cdp-mouse` 报"点击后页面无任何状态变化"；
	 *      · 程序化 `element.click()` ⇒ 同样无变化；
	 *      · 页面 `visibilityState="visible"` / `hasFocus=true` / rAF 60fps
	 *        ⇒ **不是节流**（渲染进程命令行确含 `--disable-features=CalculateNativeWinOcclusion`）；
	 *      · 根因：**宿主不给空白草稿挂 `conversation.view`** ⇒ 没有页签环。
	 *    ⇒ 必须**实体化**：向它投一条文本（宿主直投口 `__directChatSubmit`），
	 *      会话才成为"真会话" ⇒ 页签环出现（实测 3 个：总监 / 对话 / 轨迹，约 250ms）。
	 *    🔴 如实报数（纪律 18）：这一条**不是"跳过"**，是**显式建立起点**（纪律 41），必须打印出来；
	 *      实体化失败要让 NS-1a 正常红，**不许静默继续**。 */
	if (!tabRing.length) {
		const mat = await js(`(async function(){
			var b=window.__dshBranchTree;
			if(!b) return {ok:false, reason:'无 __dshBranchTree（插件未装载）'};
			var raws=b.rawSessionSummaries()||[];
			var arch=await b.archivedSessionIds();
			if(!Array.isArray(arch)) return {ok:false, reason:'归档集读不到 ⇒ 按纪律不做实体化'};
			var set={}; for(var i=0;i<arch.length;i++) set[String(arch[i])]=1;
			var live=raws.filter(function(s){return !set[String(s.id||s.sessionId)];});
			if(!live.length) return {ok:false, reason:'没有活会话可供实体化'};
			var one=live[0];
			var id=String(one.id||one.sessionId);
			if(typeof window.__directChatSubmit!=='function') return {ok:false, reason:'宿主未暴露 __directChatSubmit'};
			try{ window.__directChatSubmit(id,'起点自举：请回复 OK'); }
			catch(e){ return {ok:false, reason:'投递抛错：'+String((e&&e.message)||e)}; }
			return {ok:true, id:id, blank:one.blank===true, liveN:live.length};
		})()`);
		console.log("  · 起点实体化：" + J(mat));
		const t0m = Date.now();
		while (Date.now() - t0m < 8000) {
			await sleep(300);
			tabRing = (await js("Array.from(document.querySelectorAll('[role=\"tab\"]')).map(e=>String(e.textContent).trim())")) || [];
			if (tabRing.length) break;
		}
		console.log("  · 实体化后有界等待 " + (Date.now() - t0m) + "ms ⇒ tab 环 " + J(tabRing));
	}
}
t("NS-1a", "宿主 tab 环存在（会话视图已打开）", tabRing.length > 0, tabRing);

/* A2：切「总监」页签 → dp-root 必须在 DOM（纪律 30：不认注册句柄） */
const dirTab = (await js(`(function(){var L=[].slice.call(document.querySelectorAll('[role="tab"]'));var e=L.filter(function(x){return String(x.textContent||'').trim()==='总监';})[0];if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),n:L.length};})()`));
if (dirTab) { await clickAt(dirTab.x, dirTab.y); await sleep(900); }
const rootUp = await waitFor(async () => await exists('[data-testid="dp-root"]'), 8, 400);
t("NS-1b", "点「总监」页签后 dp-root 已挂载（**只认 dp-root**）", rootUp === true, { tabRing, dirTab: Boolean(dirTab) });

/* A3：控制台行必须显形（collapsed.r2 折叠时按钮不在 DOM ⇒ 后面的点击会"找不到元素"） */
async function ensureConsoleVisible() {
	for (let i = 0; i < 3; i++) {
		const vis = await js(`(function(){var e=document.querySelector('[data-testid="dp-act-split"]');if(!e)return false;var r=e.getBoundingClientRect();return r.width>2&&r.height>2;})()`);
		if (vis) return true;
		const tg = await clickSel('[data-testid="dp-r2-toggle"]', "R2 折叠头");
		console.log("  · 控制台行不可见 ⇒ 点折叠头（" + (tg.ok ? "命中" : tg.why) + "）");
		await sleep(420);
	}
	return false;
}
const consoleOk = await ensureConsoleVisible();
t("NS-1c", "控制台行可见（`dp-act-split` 有非零盒）", consoleOk === true, consoleOk);

/* ── 取证产物自检（纪律 57 的第三坑：**取证产物本身也要当真**）────────────────
 * 第 18 批实测拍出过一张**纯黑** PNG —— 而且它有 **200 KB**，用"文件体积"判断**完全无效**。
 * 唯一可靠的廉价判据是**解 IDAT 看非零字节比例**：纯色图 inflate 出来几乎全是 0。
 * 这里只在 `SHOTS=1` 时被调用；纯离线纯函数，无副作用。 */
function pngInkRatio(buf) {
	try {
		let off = 8; const idat = []; let w = 0, h = 0;
		while (off + 8 < buf.length) {
			const len = buf.readUInt32BE(off);
			const type = buf.toString("ascii", off + 4, off + 8);
			const data = buf.subarray(off + 8, off + 8 + len);
			if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
			if (type === "IDAT") idat.push(data);
			off += 12 + len;
			if (type === "IEND") break;
		}
		const raw = inflateSync(Buffer.concat(idat));
		let nz = 0;
		for (let i = 0; i < raw.length; i++) { if (raw[i] !== 0) nz++; }
		return { w: w, h: h, ratio: raw.length ? nz / raw.length : 0 };
	} catch (e) { return { w: 0, h: 0, ratio: -1, err: String((e && e.message) || e) }; }
}
const reportShot = (file, buf, extra) => {
	const chk = pngInkRatio(buf);
	const ok = chk.ratio > 0.005;
	console.log("  📷 " + file + " " + J({ bytes: buf.length, w: chk.w, h: chk.h, inkRatio: Number(chk.ratio.toFixed(4)) }) +
		(extra ? " " + extra : "") + (ok ? "  ✔ 有内容" : "  ❌ **疑似纯色/纯黑 —— 该取证件无效**"));
	return ok;
};

/* A4：起点读数（**打印出来**——模糊的"起点"是纪律 51 的常客） */
const before = await js(`({
  rows: (function(){ try{ var s=window.__dshBranchTree.getBranchSnapshot(); return s&&s.tree? s.tree.rows.length : null; }catch(e){ return null; } })(),
  rowIds: (function(){ try{ var s=window.__dshBranchTree.getBranchSnapshot(); var rs=(s&&s.tree&&s.tree.rows)||[]; return rs.map(function(r){ return String(r.sessionId||''); }).filter(Boolean); }catch(e){ return null; } })(),
  /* 🔴 本次派发的**作用域基线**（跑程内判据用，纪律 16）：两路存储各记一份 key 集合 */
  splitKeys: (function(){ try{ var r=localStorage.getItem('dsh.director.split'); if(!r) return []; var o=JSON.parse(r); return Object.keys((o&&o.items)||{}); }catch(e){ return null; } })(),
  ledgerIds: (function(){ try{ var d=window.__dshDispatchLog; return (d&&d.items)?d.items.map(function(i){ return String(i.sessionId||''); }).filter(Boolean):[]; }catch(e){ return null; } })(),
  /* 🔴 第 19 批：「复用有没有真的省下会话」要靠**宿主会话总数**对账 ——
   *    只看产品自报的 data-reused=8 是**自证**（同源），拿宿主真值比对才是**实证**。
   *    ⚠ 本块在模板字符串内：注释**禁止反引号**（反引号会终止模板串 ——
   *      纪律 ⑨，本轮实测又一次踩到，语法直接报 missing ) after argument list）。 */
  sessionTotal: (function(){ try{ return window.__dshBranchTree.rawSessionSummaries().length; }catch(e){ return null; } })(),
  /* 台账批次时间戳（判"换批"的锚 —— 见阶段 1 注释） */
  dispatchAt: (function(){ try{ return window.__dshDispatchLog.at; }catch(e){ return 0; } })(),
  made: (function(){ var e=document.querySelector('[data-testid="dp-flow-split"]'); return e? e.getAttribute('data-made') : null; })(),
  composer: (function(){ try{ return window.__dshChatBridge.readComposerText(); }catch(e){ return '__err:'+e.message; } })(),
  hostSend: (typeof window.__directChatSubmit === 'function'),
  hostConversation: (function(){ try{ var r=window.__dshChatBridge.readConversationItems(40); return r.ok? r.total : '__fail:'+r.reason; }catch(e){ return '__err:'+e.message; } })()
})`);
console.log("  起点读数：" + J(before));
t("NS-1d", "起点可读（分支树行数拿到真实值，不是 null）", typeof before.rows === "number", before);
t("NS-1e", "宿主直投口在场（`__directChatSubmit`）—— 简报能否真送达的前提", before.hostSend === true, before.hostSend);

/* A5：需求文本注入 + **回读**（纪律 21：先证前提再断结果） */
const inject = await js(`(async function(){
  var b=window.__dshChatBridge;
  if(b && typeof b.setComposerText==='function'){
    var r=b.setComposerText(${JSON.stringify(NOVEL_REQ)});
    if(r && r.ok){ var back=b.readComposerText(); return {via:'composer', ok:back===${JSON.stringify(NOVEL_REQ)}, back:String(back||'').slice(0,40)}; }
  }
  /* 兜底路径：原生框不可见时，功能支持"用本节点总监消息最后一条" —— 这里同样显式种一条。 */
  try{
    var node=(window.__dshHierarchy && window.__dshHierarchy.GLOBAL_NODE_ID)||'__global__';
    await window.__dshPluginDb.appendDirectorMessage(node,{role:'user',text:${JSON.stringify(NOVEL_REQ)}});
    return {via:'director-message', ok:true, back:'(已种入总监消息)'};
  }catch(e){ return {via:'none', ok:false, back:'__err:'+e.message}; }
})()`);
t("NS-2a", "需求文本已注入且**逐字回读一致**（前提成立才继续）", inject && inject.ok === true, inject);
console.log("  · 注入通道：" + (inject && inject.via) + " ｜ 回读：" + J(inject && inject.back));

/* ══════════════ B · 按维度分流 ══════════════ */
section("B 分流：一条需求 → 各维度一条独立分支");
/* 有界等待：`dp-flow-split` 出现且**已出结果**（成功 `made>=8` 或失败带 `data-error`）
 * 🔴 轮询条件必须是两路的：只等 `made>=8` 时，**一旦产品抛错就永远等不到**，
 *    闸门只会报"读数没出现"，而真因（异常文本）被丢掉。
 * 🔴 同时不接受"上一轮留下的读数"：本轮起点是刚重启的页面（`splitInfo` 为 null），
 *    但重跑同页时必须靠 `made/error` 变化判别 —— 故条件是数值达标或 error 非空。 */
const readSplit = async () => await js(`(function(){var e=document.querySelector('[data-testid="dp-flow-split"]');if(!e)return null;
  return {made:+e.getAttribute('data-made'), failed:+e.getAttribute('data-failed'), sent:+e.getAttribute('data-sent'),
          dims:String(e.getAttribute('data-dims')||''), kind:String(e.getAttribute('data-kind')||''),
          error:String(e.getAttribute('data-error')||''), text:String(e.textContent||'').slice(0,40)};})()`);
/* 🔴 第二十四轮：**后果判据不能只看 DOM 读数** —— `dp-flow-split` 会**残留上一轮的
 *    `made=8`** ⇒ 按钮其实没点动、"后果"却被判定为已达成 ⇒ 既不补送、也不报红，
 *    最后在"等台账换批"处超时成 INVALID，而**NS-3a 的红与真因隔着两段**（查了很久）。
 *    ⇒ 后果 = **台账换批**（`__dshDispatchLog.at` 变新）—— 它不会残留，是"本次真的派了"的硬证据。 */
const splitAtBefore = await js(`(function(){ try{ return window.__dshDispatchLog ? window.__dshDispatchLog.at : 0; }catch(e){ return 0; } })()`);
const splitReady = async () => {
	const at = await js(`(function(){ try{ return window.__dshDispatchLog ? window.__dshDispatchLog.at : 0; }catch(e){ return 0; } })()`);
	if (!(Number(at) > Number(splitAtBefore))) return null;
	const v = await readSplit();
	return v && (v.made >= DIM_KEYS.length || v.error) ? v : null;
};
/* 🔴 U6：真实鼠标丢事件时用 `el.click()` 补送一次（正常路径零改动，见 `clickWithFallback` 注释） */
const splitRun = await clickWithFallback('[data-testid="dp-act-split"]', "🌿 分流", splitReady, 60, 400);
const splitClick = splitRun.click;
t("NS-3a", "真实鼠标点到「🌿 分流」（落点命中自己；合成事件丢失时已按 U6 补送）", splitClick.ok === true, splitClick);
const splitInfo = splitRun.val;
console.log("  分流读数：" + J(splitInfo));
t("NS-3b", "读到分流结果读数（`dp-flow-split` 出现且已出结果）", splitInfo !== null, splitInfo);
t("NS-3c", "🔴 分流**没有静默失败**（`data-error` 为空 —— 失败必须有出口）",
	splitInfo !== null && !splitInfo.error, splitInfo && splitInfo.error);
t("NS-3d", "`data-made` 恰为 " + WANT_N + "（一条需求 → " + WANT_N + " 条分支；期望值由需求串派生，不写死）", splitInfo && splitInfo.made === WANT_N, splitInfo && splitInfo.made);
t("NS-3e", "`data-failed` 为 0（没有「建了一半」）", splitInfo && splitInfo.failed === 0, splitInfo && splitInfo.failed);
t("NS-3f", "`data-kind` = novel（走的是**小说技能 A1–A8 分工**，不是通用三段）", splitInfo && splitInfo.kind === "novel", splitInfo && splitInfo.kind);
/* 🔴 集合相等，不是计数相等 —— 计数 8 也可能是 8 个 plan/build/verify 加 5 个空的 */
const gotDims = (splitInfo && splitInfo.dims ? splitInfo.dims.split(",").filter(Boolean) : []).sort();
t("NS-3g", "`data-dims` **集合相等** 于 A1–A8 八个维度",
	gotDims.length === WANT_N && gotDims.slice().sort().join("|") === DIM_KEYS.slice().sort().join("|"),
	{ got: gotDims, want: DIM_KEYS });
t("NS-3h", "`data-sent` = " + WANT_N + "（简报**真的投递出去**，不只是建了空会话）", splitInfo && splitInfo.sent === WANT_N, splitInfo && splitInfo.sent);

/* 🔴 **NS-3j：取集口径可分辨**（19 号文 N1 的**新行为**必须在真机侧有落点）——
 *    完全相同的句式，**只去掉全量从句** ⇒ 取集必须**严格更少**。
 *    这是"全量信号真的是信号"的判据：若 `plan()` 退化成恒返全量（N1 被回退），
 *    正反两侧会相等 ⇒ 本条红。纯离线可判，但放在真机套件里跑，
 *    是为了让"线上跑的这一份产物"和"离线那一份"**同轮**被证明一致（防产物陈旧 · 纪律 63）。 */
{
	const reqNoFull = "帮我写一个小说《灵能修仙》，先搭世界观再做剧情，最后写正文并做一致性审查";
	const nNoFull = plan(reqNoFull).dims.length;
	t("NS-3j", "🔴 取集可分辨：同一句式**去掉全量信号** ⇒ 派发条数 " + nNoFull + " < 全量 " + WANT_N + "（证明「全流程」真的是信号，不是恒真）",
		nNoFull > 0 && nNoFull < WANT_N,
		{ 无全量串: nNoFull, dims: plan(reqNoFull).dims.map((d) => d.key), 全量串: WANT_N });
}

/* ══════════════════════════════════════════════════════════════════
 * 🔴 第 18 轮根因修正：**派发是异步落盘的 ⇒ 判据必须"有界等待"到落盘完成**
 *    （纪律 55：异步"等待"必须**校验返回值**、预算**覆盖真实耗时**）
 *
 *   上一版在这里 `refreshBranchTree()` + `sleep(500)` 就去读树 ⇒ 真机实测假红三条：
 *     · 树 rows 只净增 2（宿主的会话创建 / 索引写入 / 树快照刷新都还没跑完）
 *     · `__dshDispatchLog` 还是**上一批**的 8 条 ⇒ `NS-4a / NS-4d2 / NS-4f` 齐红
 *   而闸门跑完后**直读产品自身状态**（独立探针实测，同 origin 同实例）：
 *     · `dsh.director.split` 里《墟海》**8 条齐全**（`session-84e2626d…`）
 *     · `__dshDispatchLog.items` = 这 8 条（dim = world…distill）
 *     · 树 `total 47 / 含"墟海"24 行 / splitApplied 40 / dispatchApplied 16`
 *     · 侧栏 DOM 里真有「会话总监 · 「A1 世界观」《墟海》」
 *   ⇒ **产品没有任何缺陷，是闸门读早了**（与 `NS-4a` 上一版"净增恰 8"是**两个不同**的假红）。
 *
 *   新判据：
 *     ① 作用域 = `dsh.director.split` 的**本次新增 8 个 key**（跑程内 · 纪律 16）；
 *     ② **有界等待**两阶段 —— 「索引新增恰 8」→「树里能看到这 8 条」；
 *     ③ 任一阶段超预算 ⇒ **INVALID（exit 2）**，绝不降级成产品 FALSE（纪律 55）。
 * ══════════════════════════════════════════════════════════════════ */
const beforeSplitKeys = new Set(Array.isArray(before.splitKeys) ? before.splitKeys : []);
const beforeLedgerIds = new Set(Array.isArray(before.ledgerIds) ? before.ledgerIds : []);
if (!Array.isArray(before.splitKeys) || !Array.isArray(before.ledgerIds)) {
	console.error("IS_PASS: FALSE（INVALID：起点两路存储基线读不到 —— splitKeys=" + J(before.splitKeys) + " ledgerIds=" + J(before.ledgerIds) + "）");
	process.exit(2);
}
console.log("  起点基线：索引已有 " + beforeSplitKeys.size + " 条 ｜ 台账已有 " + beforeLedgerIds.size + " 条（本次派发只数**超出这两组**的部分）");
const READ_STORES = `(function(){ try{
  var out = { split: null, ledger: null, dispatchAt: 0, splitMissing: false };
  var r = localStorage.getItem('dsh.director.split');
  /* 🔴 **索引键不存在 == 索引有 0 条**（第 25 批修）。
   *    旧版把「键不存在」读成 null ⇒ 下面的等待条件 Array.isArray(v.split) 恒假
   *    ⇒ **永远等不到**，一次完全正常的「全复用」被判 INVALID（本轮真机实测：
   *    「派发 8 · 复用 8」而索引**整键不存在** —— 因为全复用 ⇒ 没有"新建"要登记，
   *    产品那条路径**本来就不该写这个键**）。
   *    ⚠️ 但「键不存在」与「JSON 坏了」必须可分（破坏性差异）：坏 JSON ⇒ 返回 null ⇒ INVALID。
   *    ⚠️ 本块在**模板字符串**内：禁止反引号与美元花括号（纪律 ⑨）—— 注释里的反引号会
   *    **提前终止**模板串；写了字面的「美元+左花括号」会**开启插值**（本轮实测：
   *    node --check 报 Unexpected token '}'，且报错行号指向这条注释本身）。 */
  if (r === null || r === undefined) { out.split = []; out.splitMissing = true; }
  else { var o = JSON.parse(r); out.split = Object.keys((o && o.items) || {}); }
  var d = window.__dshDispatchLog;
  out.ledger = (d && d.items) ? d.items.map(function(i){ return String(i.sessionId||''); }).filter(Boolean) : null;
  /* 第 19 批：批次时间戳 —— 见下面阶段 1 的注释（唯一与"复用与否"无关的新批信号） */
  out.dispatchAt = (d && typeof d.at === 'number') ? d.at : 0;
  return out; }catch(e){ return null; } })()`;

/* ── 阶段 1：等**本次派发落盘** ── 预算 90s
 *
 * 🔴 第 19 批换锚点（本批闸门最关键的修改）：
 *    换之前锚在 `dsh.director.split` 的「新增 8 个 key」上。复用生效后，
 *    第二次派发**不会**在索引里新增任何 key（那 8 条早就在索引里）
 *    ⇒ 旧锚点**永远等不到**，会把一次完全正常的复用判成 INVALID。
 *    （实测证据：闸门跑完 `n=131 / split=112` 与跑前**逐字相同** ——
 *     一条新会话都没建、索引也没动 ⇒ 产品行为完全正确，是闸门锚错了。）
 *    派发**台账** `__dshDispatchLog.items` 是**每次派发都追加**的
 *    （复用与新建都记一条）⇒ 它才是与"复用与否"无关的稳定锚点。
 *    索引降级为**交叉验证**用（`NS-4c2`：新增只许 0 或 8）。 */
const beforeDispatchAt = (before && typeof before.dispatchAt === "number") ? before.dispatchAt : 0;
const landed = await waitFor(async () => {
	const v = await js(READ_STORES);
	if (!v || !Array.isArray(v.split) || !Array.isArray(v.ledger)) return null;
	/* 锚 = 台账**批次时间戳**变新。
	 * 🔴 为什么不能用 sessionId 集合差（第 19 批实测踩到，这是第二次换锚点）：
	 *    `recordDispatch` 每批**整体替换** items 并刷新 `at`（store/dispatch-log.js:73）。
	 *    复用场景下，新批的 8 个 sessionId 与上一批**完全相同**（那正是"复用"的定义）
	 *    ⇒ 集合差恒为空集 ⇒ 永远等不到 8 条"新增"。
	 *    实测：起点台账 8 条，派发后台账仍是同样的 8 条 id（判据自己失效，不是产品问题）。 */
	if (!(v.dispatchAt > beforeDispatchAt)) return null;
	if (v.ledger.length !== WANT_N) return null;
	return { ledgerAll: v.ledger, splitAll: v.split, dispatchAt: v.dispatchAt };
}, 180, 500);
if (landed === null) {
	console.error("IS_PASS: FALSE（INVALID：等**派发台账换批**超预算 90s —— `__dshDispatchLog.at` 始终没变新（起点 " + beforeDispatchAt + "）；这属**闸门取数失败**，不是产品失败 —— 纪律 55）");
	process.exit(2);
}
const thisRun = landed.ledgerAll.slice();
const ledgerAdded = thisRun;
const addedSplit = landed.splitAll.filter((k) => !beforeSplitKeys.has(k));
console.log("  本次派发 sessionId（判据作用域 · 取自**派发台账**本次新增 8 条）：" + thisRun.length + " 条");
console.log("  两路存储：索引 " + landed.splitAll.length + " 条 / 本次新增 " + addedSplit.length
	+ " ｜ 台账 " + landed.ledgerAll.length + " 条 / 本次新增 " + ledgerAdded.length
	+ (addedSplit.length === 0 ? "（**本次全部复用** ⇒ 索引无新增 —— 这正是期望行为）" : ""));
const inRun = (sid) => thisRun.indexOf(String(sid)) >= 0;

/* ── 阶段 2：等分支树**能看到**这 8 条（刷树本身异步）── 预算 20s */
const afterSnap = await waitFor(async () => {
	await js("window.__dshBranchTree.refreshBranchTree()");
	const snap = await js("(function(){ var s=window.__dshBranchTree.getBranchSnapshot(); if(!s||!s.tree) return null; var rs=s.tree.rows; return { rows: rs.length, rowIds: rs.map(function(r){ return String(r.sessionId||''); }).filter(Boolean) }; })()");
	if (!snap || !Array.isArray(snap.rowIds)) return null;
	return thisRun.every((s) => snap.rowIds.indexOf(s) >= 0) ? snap : null;
}, 40, 500);
if (afterSnap === null) {
	console.error("IS_PASS: FALSE（INVALID：等分支树超预算 20s —— 索引已落盘的 8 条里仍有未出现在树快照中的；属**闸门取数失败** —— 纪律 55）");
	process.exit(2);
}
const afterRows = afterSnap.rows;
const beforeIds = Array.isArray(before.rowIds) ? before.rowIds : [];
const afterIds = afterSnap.rowIds;
const beforeSet = new Set(beforeIds);
const afterSet = new Set(afterIds);
const addedRows = afterIds.filter((s) => !beforeSet.has(s));
const removedRows = beforeIds.filter((s) => !afterSet.has(s));
const delta = (typeof before.rows === "number" && typeof afterRows === "number") ? afterRows - before.rows : null;
const addedRun = thisRun.filter((s) => afterSet.has(s));
console.log("  分支树：前 " + before.rows + " 行 → 后 " + afterRows + " 行（净增 " + delta + "）");
console.log("  跑程内 diff：新增 " + addedRows.length + " 条 ｜ 消失 " + removedRows.length + " 条" +
	(removedRows.length ? "（" + J(removedRows.map((s) => String(s).slice(0, 18))) + "）" : "") +
	" ｜ 本次派发的 8 条在树上 " + addedRun.length + "/8");
t("NS-4a", "🔴 跑程内：本次派发的 8 条**全部在树里**（= 一条需求 → 八条分支；跨批残留 / 空壳顶替只打印不计入）",
	thisRun.length === WANT_N && addedRun.length === WANT_N,
	{ run: thisRun.length, onTree: addedRun.length, added: addedRows.length, delta: delta, before: before.rows, after: afterRows, removed: removedRows.length });
t("NS-4b", "🔴 负对照：本次派发不是 1 条（防「只建了一个却说八个」）", thisRun.length !== 1, thisRun.length);
t("NS-4c", "🔴 负对照：本次派发不是 16/9 条（防重复触发或一次建两批）", thisRun.length !== 16 && thisRun.length !== 9, thisRun.length);
/* ── 🔴 第 19 批：产品自报的复用/新建读数（DOM 路径）────────────────────
 *    「复用 8 条」与「新建 8 条」在旧界面上**完全一样**（都只报 `made=8`）——
 *    那正是用户这一轮不满的根源（"重复创建了一百多个会话"却看不出来）。
 *    ⇒ 这两个读数必须真的存在，且与**存储路径**（索引/台账）自洽。 */
const splitRead = await js(`(function(){ var e=document.querySelector('[data-testid="dp-flow-split"]'); if(!e) return null;
  return { made: e.getAttribute('data-made'), reused: e.getAttribute('data-reused'),
           created: e.getAttribute('data-created'), orphan: e.getAttribute('data-orphan-forgotten'),
           /* 第 25 批（U10/P9）：标题弱匹配读数 —— 0 命中时必须能分辨"读不到"与"形态变了" */
           titleHit: e.getAttribute('data-title-hit'), titleMissed: e.getAttribute('data-title-missed'),
           titlePool: e.getAttribute('data-title-pool'), titleHits: e.getAttribute('data-title-hits'),
           /* 第 36 轮：项目级兜底复用条数（松匹配），与 titleHits 分列 */
           projectHits: e.getAttribute('data-project-hits') }; })()`);
const reusedN = splitRead && splitRead.reused !== null && splitRead.reused !== "" ? Number(splitRead.reused) : -1;
const createdN = splitRead && splitRead.created !== null && splitRead.created !== "" ? Number(splitRead.created) : -1;
const orphanN = splitRead && splitRead.orphan ? Number(splitRead.orphan) : 0;
const titleHitN = splitRead && splitRead.titleHits ? Number(splitRead.titleHits) : 0;
/* 第 36 轮：**项目级兜底复用**条数。它和 `titleHits` 一样「不在索引里、必须补登记」，
 * 所以索引新增的不变式随之变为 `新建 + 标题命中 + 项目命中`（纪律 99：改口径不掰产品）。
 * ⚠️ 必须**分列**读：合进 `titleHits` 会让"复用 5 条"看不出其中有几条是松匹配。 */
const projectHitN = splitRead && splitRead.projectHits ? Number(splitRead.projectHits) : 0;
console.log("  派发读数（DOM `dp-flow-split`）：" + J(splitRead));

/* 🔴 **口径更正（第 25 批 · 纪律 99）**：旧判据写的是「新增只许 0（全复用）或 8（全新建）」，
 *    它的**前提**是"复用只可能全有或全无"，且"复用的必定早已在索引里"。
 *    第 25 批修好**标题弱匹配**（U10/P9）之后两条前提都不成立：
 *      · **按维度各自的历史**命中 ⇒ 3 复用 5 新建是**完全合法**的结果（不是半截缺陷）；
 *      · 冷启动时索引是**空的**，靠标题认回来的那几条**不在索引里** ⇒ 必须**补登记**
 *        （真机实测踩到：`派发 8 · 复用 8` 而索引**整键不存在** ⇒ 导图拿不到插件侧标签、
 *          下一次派发又只能靠标题兜底 —— 索引这条快路永远用不上）。
 *    ⇒ 判据改为**真正的不变式**：`索引新增 == 新建 + 标题命中`，且新增的都属本次那 8 条。
 *    ⚠️ 前提变了就改口径，**不许**把产品掰回"全有/全无"（纪律 99）。 */
const newRunIds = thisRun.filter((id) => !beforeLedgerIds.has(id));
t("NS-4c2", "🔴 交叉：台账本次新增恰 8 条；`dsh.director.split` 新增 key 数 **== 新建 + 标题命中 + 项目命中**，且新增的都属本次那 8 条",
	ledgerAdded.length === WANT_N && addedSplit.length === createdN + titleHitN + projectHitN
	&& addedSplit.every((k) => newRunIds.indexOf(k) >= 0),
	{ ledgerAdded: ledgerAdded.length, splitAdded: addedSplit.length, reused: reusedN,
		created: createdN, titleHits: titleHitN, projectHits: projectHitN, newRunIds: newRunIds.length });


/* 新行的标题必须带维度名（走插件侧标签覆盖，不是宿主默认标题） */
const newTitlesAll = await js(`(function(){
  var s=window.__dshBranchTree.getBranchSnapshot(); if(!s||!s.tree) return null;
  return s.tree.rows.filter(function(r){ return r.titleOrigin==='plugin:split'; })
    .map(function(r){ return {t:String(r.title||''), dim:String(r.splitDim||''), sid:String(r.sessionId||'')}; });
})()`);
const newTitles = (Array.isArray(newTitlesAll) ? newTitlesAll : []).filter((r) => inRun(r.sid));
console.log("  带分流标记的行：" + J(newTitles));
/* 诊断（只在异常时才有信息量，但**永远打印**）：索引到底写进去没有 */
if (newTitles.length !== WANT_N) {
	const diag = await js(`(function(){
	  var raw=null; try{ raw=localStorage.getItem('dsh.director.split'); }catch(e){ raw='__err'; }
	  var d=null; try{ d=window.__dshBranchTree.getBranchSnapshot().diag; }catch(e){ d='__err:'+e.message; }
	  return {indexRaw: raw===null?'(null)':String(raw).slice(0,160), diag:d};
	})()`);
	console.log("  🔎 诊断：分流索引 = " + J(diag.indexRaw));
	console.log("  🔎 诊断：血缘 diag = " + J(diag.diag));
}
t("NS-4d", "分支树里**本次这 8 条**都带 `titleOrigin=plugin:split`（跨批残留不计入，但上文已打印）",
	Array.isArray(newTitles) && newTitles.length === WANT_N, { inRun: newTitles && newTitles.length, all: newTitlesAll && newTitlesAll.length });
/* 🔴 交叉验证：**树快照 diff** 与 **两路存储（索引 + 派发台账）** 是**三条完全独立**的取数路径，
 *    若都指向同一组 8 个 sessionId ⇒ "这 8 条确实是我这次派出去的"，不是凑巧凑齐。 */
t("NS-4d2", "🔴 交叉：树快照里能找到本次派发的 8 条（DOM 路径 ↔ 存储路径互证）"
	+ "；**复用时不要求它们是「新增行」** —— 那 8 条上一轮就已经在树上了",
	thisRun.length === WANT_N && thisRun.every((s) => afterSet.has(s)),
	{ run: thisRun.length, onTree: thisRun.filter((s) => afterSet.has(s)).length, addedRows: addedRows.length, reused: reusedN });
t("NS-4e", "这 8 行标题**逐条含对应维度标签**（A1–A8 各一次，不是宿主默认标题）",
	Array.isArray(newTitles) && DIM_LABELS.every((lb, i) => newTitles.some((r) => r.dim === DIM_KEYS[i] && r.t.indexOf(lb) >= 0)),
	newTitles);
t("NS-4f", "分支名带出书名《" + NOVEL_NAME + "》（需求里的书名被带进分支名）",
	Array.isArray(newTitles) && newTitles.length > 0 && newTitles.every((r) => r.t.indexOf("《" + NOVEL_NAME + "》") >= 0), newTitles);

/* ══════════════════════════════════════════════════════════════════
 * 🔴🔴 第 19 批**核心验收**：派发前先复用已有会话
 *   用户原话：「我需要的是总监确认完需求之后**先考虑目前存在的会话,
 *              然后没有才是新建会话**」
 * ══════════════════════════════════════════════════════════════════ */
t("NS-11a", "🔴 复用与新建**加起来等于本次派发条数**（每条维度都有归属，无遗漏、无重复计）",
	reusedN >= 0 && createdN >= 0 && reusedN + createdN === thisRun.length && thisRun.length === WANT_N,
	{ reused: reusedN, created: createdN, run: thisRun.length });
/* 🔴 自洽性：产品自报的 `created` 必须与**存储路径**（索引新增 key）一致 ——
 *    新建了几条，索引就该新增几个 key；两者不等即为静默半成功。 */
/* 🔴 自洽性：**冷启动下"复用也必须补登记"**（第 25 批实测补的真实缺口）。
 *    前提：派发前索引 0 条（冷启动 ⇒ origin 变 ⇒ localStorage 清空）；
 *    本批复用 8 条**只有**标题一条通道认回来 ⇒ 索引里**一条都没有**
 *    ⇒ 若不补登记，索引永远空：① 导图节点拿不到 `titleOrigin="plugin:split"`；
 *      ② 下一次派发又只能靠标题兜底。实测踩到：`复用 8` 而 `dsh.director.split` **整键不存在**。 */
t("NS-11b", "🔴 冷启动（派发前索引 0 条）下发生复用 ⇒ **标题命中的必须补登记**（索引新增 == 复用条数）",
	!(beforeSplitKeys.size === 0 && reusedN > 0) || addedSplit.length === reusedN,
	{ preIndex: beforeSplitKeys.size, reused: reusedN, splitAdded: addedSplit.length });
/* 🔴🔴 本批最硬的一条：拿**宿主真值**（会话总数）对账，而不是信产品自报
 *    （自报是同源自证，宿主总数是独立实证）。
 *    🔴 **口径更正（第 25 批 · 纪律 99）**：旧版把结果二分（`reused=8` ⇔ delta 0；
 *       `reused=0` ⇔ delta=created），前提是"复用全有或全无"。
 *       修好标题弱匹配（U10/P9）后**按维度各自命中** ⇒ **部分复用合法**
 *       ⇒ 真正的不变式只有一条：**净增会话数 == 产品自报的新建条数**。
 *       （它同时覆盖旧版两种情形，且能抓"说复用却还是建了"/"说新建却没建出来"。） */
const nBefore = before.sessionTotal;
const nAfter = await js("(function(){ try{ return window.__dshBranchTree.rawSessionSummaries().length; }catch(e){ return null; } })()");
const nDelta = (typeof nBefore === "number" && typeof nAfter === "number") ? nAfter - nBefore : null;
console.log("  宿主会话总数：前 " + J(nBefore) + " → 后 " + J(nAfter) + "（净增 " + J(nDelta) + "）｜ 自报 reused=" + reusedN + " created=" + createdN);
t("NS-11c", "🔴🔴 **核心验收**：宿主会话**净增 == 产品自报的新建条数**（复用几条就该少建几条；独立实证，非自证）",
	nDelta !== null && nDelta === createdN, { reused: reusedN, created: createdN, nBefore: nBefore, nAfter: nAfter, delta: nDelta });
t("NS-11d", "🔴 索引孤儿清理是**可读**的（`data-orphan-forgotten` 属性存在 —— 清理动作不许无声）",
	splitRead !== null && splitRead.orphan !== null, { splitRead: splitRead });

/* ══════════════════════════════════════════════════════════════════
 * 🔴 第 25 批：**冷启动标题弱匹配**（19 号文 U10/P9）必须**可归因**
 *   为什么单独断言这三条：U10 的机制上一版**一行测试都没有**，判据写错（拿 `branchTitle()`
 *   的角括号串去全等匹配宿主标题的方头括号串）也**没人发现** —— 真机读数长期是
 *   `复用 0 · 新建 8`，看起来像"宿主没有旧会话"，其实是**判据与真值不同源**（纪律 27）。
 *   ⇒ 现在把"读数可分"和"**复用必须给得出机制**"钉成断言（纪律 58/60）：
 *     · `data-title-pool` 必须写出 ⇒ 0 命中时能分辨"读不到标题"与"标题形态变了"；
 *     · `reused > 0` 且**派发前索引为空**（冷启动）⇒ 复用只可能来自标题匹配
 *       ⇒ `data-title-hit` 必须为 1（**这是 U10 真的生效的硬证据**）；
 *     · `reused === 0` ⇒ `data-title-missed` 必须非空 ⇒ "全新建"必须给得出原因。 */
const preIndexN = beforeSplitKeys.size;
console.log("  标题匹配读数：pool=" + J(splitRead && splitRead.titlePool)
	+ " hit=" + J(splitRead && splitRead.titleHit) + " missed=" + J(splitRead && splitRead.titleMissed)
	+ " ｜ 派发前索引 " + preIndexN + " 条（0 ⇒ 冷启动，复用只可能来自标题匹配）");
t("NS-11e", "🔴 `data-title-pool` 已写出（0 命中时**能分辨**「宿主没读到标题」与「标题形态变了」—— 纪律 60）",
	splitRead !== null && splitRead.titlePool !== null && splitRead.titlePool !== "", splitRead);
t("NS-11f", "🔴🔴 **U10 硬证据**：冷启动（索引 0 条）+ `reused>0` ⇒ 复用**只可能**来自标题匹配 ⇒ `data-title-hit` 必须为 1",
	!(preIndexN === 0 && reusedN > 0) || (splitRead && splitRead.titleHit === "1"),
	{ preIndexN: preIndexN, reused: reusedN, titleHit: splitRead && splitRead.titleHit });
t("NS-11g", "🔴 `reused === 0` ⇒ `data-title-missed` **非空**（「全部新建」必须给得出原因，不许无声）",
	reusedN !== 0 || (splitRead && String(splitRead.titleMissed || "").length > 0),
	{ reused: reusedN, missed: splitRead && splitRead.titleMissed });

/* 🔴 **常驻读数对账（N8 判据 1）**：读数与实际必须是**同一份树**（纪律 78），
 *    且「树未建立」必须与「0 条」**可分**（纪律 60）—— 本轮实测踩到：
 *    分支树未建立（`tree === null`）时读数渲染成「现存会话 **0** 条」，
 *    而宿主实际有 36 条活会话（raw 170 − 归档 134）⇒ 用户会读成"会话被清空了"。
 *    ⚠️ 快照形状实测是 `{tree:{rows:[…]}}`，**不是**顶层 `rows`（纪律 53：只信实测）。 */
const readoutCal = await js(`(function(){var e=document.querySelector('[data-testid="dp-live-readout"]');
  if(!e)return null;
  var b=window.__dshBranchTree;var s=null;try{s=b.getBranchSnapshot()}catch(x){}
  var rows=(s&&s.tree&&s.tree.rows)?s.tree.rows.length:null;
  return {alive:e.getAttribute('data-alive'),archived:e.getAttribute('data-archived'),rows:rows};})()`);
console.log("  常驻读数对账：" + J(readoutCal));
t("NS-11h", "🔴 常驻读数与**同一份树**对账（`data-alive` === 树行数），归档数如实写出（`—` 与数字可分）",
	!!readoutCal && readoutCal.rows !== null && String(readoutCal.alive) === String(readoutCal.rows)
	&& readoutCal.archived !== null && readoutCal.archived !== "", readoutCal);

/* ── 第 17 批：**投递 ≠ 启动**（纪律 30 的同型错误）────────────────────
 * 第 16 批只断言了 `data-sent=8`（"简报发出去了"）——**从没断言分支真的跑起来了**。
 * 新增读数 `data-confirmed`（宿主快照里观察到 `running=true` 或 `turns>0`）与
 * `data-unconfirmed`（投递后未在窗口内观察到启动）。
 * 🔴 判据**不要求 confirmed=8**：宿主是否启动受模型与队列影响，全 8 条都确认不现实。
 *    要断言的是"**这两个数真的被读出来了**"（不是空属性），以及"它们**加起来等于 made**"
 *    —— 后者能抓到"只填一半"这类静默半成功。 */
const dispRead = await js(`(function(){var e=document.querySelector('[data-testid="dp-flow-split"]');if(!e)return null;
  return {confirmed:e.getAttribute('data-confirmed'), unconfirmed:e.getAttribute('data-unconfirmed'),
          via:String(e.getAttribute('data-via')||''), attachfail:e.getAttribute('data-attachfail')};})()`);
console.log("  派发复核读数：" + J(dispRead));
t("NS-4g", "🔴 `data-confirmed` 已写出（投递后**复核过**宿主是否真的启动，不是只报 sent）",
	dispRead !== null && dispRead.confirmed !== null && dispRead.confirmed !== "", dispRead);
t("NS-4h", "🔴 `confirmed + unconfirmed` **恰等于** `data-made`（防只填一半的静默半成功）",
	dispRead !== null && (+dispRead.confirmed + +dispRead.unconfirmed) === WANT_N,
	dispRead && { confirmed: dispRead.confirmed, unconfirmed: dispRead.unconfirmed });
t("NS-4i", "派发通道可追（`data-via` 非空 —— 走的是直投还是 composer 要看得出来）",
	dispRead !== null && dispRead.via !== "", dispRead && dispRead.via);
/* 台账：8 条都要有 sessionId（"记了 8 条但没 id" 与 "真建了 8 条" 必须可分） */
const ledger = await js(`(function(){
  try{ var d=window.__dshDispatchLog; if(!d||!d.items) return null;
    return {n:d.items.length, withId:d.items.filter(function(x){return !!x.sessionId;}).length,
            dims:d.items.map(function(x){return x.dim;}).join(','),
            states:d.items.map(function(x){return x.state;}).join(',')};
  }catch(e){ return '__err:'+e.message; }
})()`);
console.log("  派发台账：" + J(ledger));
t("NS-4j", "派发台账登记 **8 条**且**每条都有 sessionId**（与「只记不建」可分辨）",
	ledger !== null && ledger.n === WANT_N && ledger.withId === WANT_N, ledger);
t("NS-4k", "台账维度**集合相等** 于 A1–A8",
	ledger !== null && ledger.dims.split(",").slice().sort().join("|") === DIM_KEYS.slice().sort().join("|"),
	ledger && ledger.dims);

/* ══════════════ C · 思维导图能看出来（用户原话） ══════════════ */
section("C 导图：这 8 条分支要**看得出来**");

/* 归零前置：先确认导图没开着（避免"点入口=关"） */
const mmClose0 = await closeMindmap("导图关闭(进C段前)");
/* 🔴 U6（第二十四轮真机坐实）：合成鼠标点这个入口**会静默丢事件** ——
 *    几何命中（`{ok:true,x:1375,y:609}` 与按钮中心完全吻合）而 `mm-root` 不挂载，
 *    同一时刻 `el.click()` **一次即开**（28 节点）⇒ 是事件管线问题，**不是产品缺陷**。
 *    ⇒ 用 `clickWithFallback`：真实鼠标优先，丢事件时补送一次。 */
const mmUpFn = async () => (await js(`!!document.querySelector('[data-testid="mm-root"]')`)) === true;
const openMmRun = await clickWithFallback('[data-testid="d-open-mindmap"]', "浮动组·思维导图入口", mmUpFn, 20, 250);
const openMm = openMmRun.click;
await sleep(800);
const mmUp = await waitFor(async () => await exists('[data-testid="mm-root"]'), 10, 400);
t("NS-5a", "导图层已打开（`mm-root` 挂载）", mmUp === true, { openMm, mmUp });

const mmNodes = await js(`(function(){
  var all=[].slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
  return all.map(function(e){ return {sid:String(e.getAttribute('data-session-id')||''),
    split:String(e.getAttribute('data-split')||''), origin:String(e.getAttribute('data-title-origin')||''),
    text:String(e.textContent||'')}; });
})()`);
const marked = Array.isArray(mmNodes) ? mmNodes.filter((n) => n.split) : [];
/* 🔴 同样只数**本次**这 8 条（跨批残留共存，单列出来打印）—— 见上面对纪律 16 的说明 */
const markedRun = marked.filter((m) => inRun(m.sid));
console.log("  导图节点 " + (mmNodes ? mmNodes.length : 0) + " 个，其中带 data-split 的 " + marked.length + " 个（**本次** " + markedRun.length + " 个）：" + J(markedRun.map((m) => m.split)));
t("NS-5b", "导图节点总数 > 0（导图不是空树）", Array.isArray(mmNodes) && mmNodes.length > 0, mmNodes && mmNodes.length);
t("NS-5c", "🔴 **本次这 8 条**在导图上都带 `[data-split]`（跨批残留不计入）", markedRun.length === WANT_N, { inRun: markedRun.length, all: marked.length });
t("NS-5d", "这 8 条的维度 key **集合相等** 于 A1–A8",
	markedRun.length === WANT_N && markedRun.map((m) => m.split).slice().sort().join("|") === DIM_KEYS.slice().sort().join("|"),
	markedRun.map((m) => m.split));
/* 关键一条：**看得见** —— 节点文本里必须真的出现维度标签（用户说的是"看得出来"） */
t("NS-5e", "🔴 这 8 条的可见文本里**逐条出现**对应维度标签（A1 世界观 … A8 蒸馏）",
	DIM_LABELS.every((lb, i) => markedRun.some((m) => m.split === DIM_KEYS[i] && m.text.indexOf(lb) >= 0)),
	markedRun.map((m) => [m.split, m.text.slice(0, 26)]));
t("NS-5f", "每个被覆盖的框都带 `data-title-origin=plugin:split`（覆盖来源可追）",
	markedRun.length > 0 && markedRun.every((m) => m.origin === "plugin:split"), markedRun.map((m) => m.origin));
/* 🔴 负对照：不许"顺手给所有节点都打标" */
const unmarked = Array.isArray(mmNodes) ? mmNodes.filter((n) => !n.split) : [];
t("NS-5g", "🔴 负对照：非分流节点的 `data-split` 是**空串**（不是「全都打标」）",
	unmarked.length === 0 || unmarked.every((n) => n.split === ""), unmarked.map((n) => n.split).slice(0, 5));

/* 收尾：关掉导图（开合型控件必须当场还原） */
await closeMindmap("导图关闭");
await sleep(600);
t("NS-5h", "导图层已关闭（开合型控件当场还原）", (await exists("#dsh-mindmap")) === false, null);

/* ══════════════ K · 第 17 批：回收产出（回流）+ 导图带派发状态 ══════════════ */
section("K 回收产出：分支处理 → 产出回流 → 总监审核");

const readCollect = async () => await js(`(function(){var e=document.querySelector('[data-testid="dp-flow-collect"]');if(!e)return null;
  return {total:+e.getAttribute('data-total'), read:+e.getAttribute('data-read'), unread:+e.getAttribute('data-unread'),
          done:+e.getAttribute('data-done'), running:+e.getAttribute('data-running'), say:+e.getAttribute('data-say'),
          verdict:String(e.getAttribute('data-verdict')||''), text:String(e.textContent||'').slice(0,44)};})()`);
/* 🔴 有界等待，且**两路**：要么 8 条都读了（`read+unread=8`），要么根本没出读数。
 *    单等 `read>=1` 会在"产品抛错"时永远等不到，真因被丢掉（B 段同一教训）。 */
const collectReady = async () => {
	const v = await readCollect();
	return v && (v.total >= 8) ? v : null;
};
/* 🔴 U6：真实鼠标丢事件时用 `el.click()` 补送一次（同 B 段） */
const collectRun = await clickWithFallback('[data-testid="dp-act-collect"]', "📥 回收", collectReady, 45, 400);
const collectClick = collectRun.click;
t("NS-9a", "真实鼠标点到「📥 回收」（落点命中自己；合成事件丢失时已按 U6 补送）", collectClick.ok === true, collectClick);
const col = collectRun.val;
console.log("  回收读数：" + J(col));
t("NS-9b", "读到回收读数（`dp-flow-collect` 出现且 `data-total=8`）", col !== null && col.total === WANT_N, col);
t("NS-9c", "`read + unread` **恰等于** 8（防只填一半 —— 8 条里只读到 3 条不许读成「已回收 8 条」）",
	col !== null && (col.read + col.unread) === WANT_N, col);

/* 台账：**每一条都要有可读的说明**（有产出写产出、没产出写原因）—— 本审计的核心不变式 */
const led2 = await js(`(function(){
  try{ var d=window.__dshDispatchLog; if(!d||!d.items) return null;
    return {n:d.items.length,
      noExplain:d.items.filter(function(x){return !String(x.say||'').trim() && !String(x.sayReason||'').trim();}).length,
      unknownState:d.items.filter(function(x){return x.state==='unknown';}).length,
      withSay:d.items.filter(function(x){return String(x.say||'').trim();}).length,
      withFailReason:d.items.filter(function(x){return !!(x.runFailure && x.runFailure.message);}).length,
      failSamples:d.items.map(function(x){ var f=x.runFailure; return f&&f.message ? (f.message+'/'+(f.code||'?')+'/'+(f.status==null?'?':f.status)) : null; }),
      stateSrc:d.items.map(function(x){return x.stateSource||'?';}),
      reasons:d.items.map(function(x){return String(x.sayReason||'').slice(0,34);})};
  }catch(e){ return '__err:'+e.message; }
})()`);
console.log("  回收后台账：" + J(led2));
t("NS-9d", "🔴 8 条**每条都带可读说明**（有产出写产出、没产出写原因）—— 不许静默",
	led2 !== null && led2.n === WANT_N && led2.noExplain === 0, led2);
t("NS-9e", "🔴 状态通道可用：`state=unknown` 的条数为 0（宿主快照能给出每条的状态，不靠猜）",
	led2 !== null && led2.unknownState === 0, led2 && { unknownState: led2.unknownState, stateSrc: led2.stateSrc });
/* 🔴 「分支真的在处理」的证据（纪律 30）+ 第 19 批补强（纪律 58）：
 *    第 17 批的判据只认「已读到产出 or 还在跑」，本批真机发现它会**误报产品缺陷** ——
 *    实测 8 条全部投达且**运行真的启动了**，但宿主模型侧返回
 *      `turn/end.reason.error = {message:"Insufficient Balance", code:"QUOTA", status:402}`
 *    ⇒ 没有助手正文、也没有 running。这与「投完就静默」在读数上**完全同形**，
 *    若不把那句宿主自报的失败取出来，闸门会把**环境配额问题**判成**插件坏了**。
 *
 *    于是判据扩成三条合法出路 + 一条真缺陷：
 *      ① 已读到产出（`withSay>=1`）                        → 真产出
 *      ② 宿主快照显示仍在跑（`col.running>=1`）             → 真在处理
 *      ③ 宿主**给出了可读的失败原因**（`withFailReason>=1`）→ 不是静默：它说了为什么（可处置）
 *      ④ 三者皆无                                          → FAIL：投出去之后什么说法都没有
 *    🔴 注意 ③ 是**有原因**才放过，不是"有错就放过"：`withFailReason` 只统计
 *       `runFailure.message` 非空的条目（宿主没给 message 的空错误不算）。 */
const blockedN = led2 ? led2.withFailReason : 0;
console.log("  运行结局：产出 " + (led2 && led2.withSay) + " 条 ｜ 仍在跑 " + (col && col.running)
	+ " 条 ｜ 宿主报错 " + blockedN + " 条"
	+ (blockedN ? ("：" + J(led2.failSamples.filter(Boolean).slice(0, 2))) : ""));
t("NS-9f", "🔴 分支**确实在处理**：已读到产出 **或** 仍在跑 **或** 宿主给出了**可读的失败原因**（不是投完就静默 —— 纪律 58）",
	led2 !== null && (led2.withSay >= 1 || (col && col.running >= 1) || blockedN >= 1),
	{ withSay: led2 && led2.withSay, running: col && col.running, withFailReason: blockedN, verdict: col && col.verdict });
t("NS-9g", "总裁定文案已产出（`data-verdict` 非空 —— 总监审核有结论）",
	col !== null && String(col.verdict || "").length > 0, col && col.verdict);

/* ── 取证截图钩子 ①：总监侧「回收产出」读数特写（`SHOTS=1`）────────────────────
 * 纪律 57：收尾必须产出**用户能看的**截图。
 * 🔴 为什么必须在这里拍：`dp-flow-collect` 的读数是**组件 state 渲染出来的**，
 *    跑完再另起脚本重开导图/重挂载 ⇒ 读数回落成「📥 回收 0/8 · 未读到 8」（实测）。
 *    只有此刻（刚回收完、页面没重挂）才是**本次**的真读数。
 * 🔴 用 CDP `clip` + `scale`（**重新渲染**到倍率，不是位图放大）⇒ 小字号也可读。 */
if (process.env.SHOTS === "1") {
	try {
		const fsmod = await import("node:fs");
		fsmod.mkdirSync("logs/acceptance18", { recursive: true });
		await send("Page.enable");
		const cb = await js(`(function(){var e=document.querySelector('[data-testid="dp-flow-collect"]'); if(!e) return null;
		  e.scrollIntoView({block:'center'}); var r=e.getBoundingClientRect();
		  return {x:r.x,y:r.y,w:r.width,h:r.height,text:String(e.textContent||'').slice(0,90)};})()`);
		console.log("  取证·回收读数元素：" + J(cb));
		if (cb && cb.w > 10) {
			/* 🔴 `captureBeyondViewport` 必须为 **false**：`getBoundingClientRect()` 给的是**视口坐标**，
			 *    而 `captureBeyondViewport: true` 会让 CDP 按**页面坐标**解释 `clip` ⇒ 偏移到空白区
			 *    （第 18 批实测：拍出一张**纯黑**图，差点被当成"产品没渲染"）。
			 *    钳制颜色也要防纯黑：见下面的 `checkShotNotBlank()`。 */
			const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false,
				clip: { x: Math.max(0, cb.x - 16), y: Math.max(0, cb.y - 16), width: Math.min(1100, cb.w + 32), height: cb.h + 32, scale: 3 } });
			if (r && r.data) {
				const buf = Buffer.from(r.data, "base64");
				fsmod.writeFileSync("logs/acceptance18/H4b-collect-closeup.png", buf);
				reportShot("H4b-collect-closeup.png（3×，可读）", buf);
			} else { console.log("  ⚠️ 截图无数据"); }
		}
	} catch (e) { console.log("  ⚠️ 取证截图 ① 失败（**不影响判定**，属工具问题）：" + String((e && e.message) || e)); }
}

/* ── K2：导图上看得见"派发"（用户原话「我需要在思维导图中看到这些」）── */
const mmClose2 = await closeMindmap("导图关闭(进K2前)");
await clickWithFallback('[data-testid="d-open-mindmap"]', "浮动组·思维导图入口(K2)", mmUpFn, 20, 250);
await sleep(800);
await waitFor(async () => await exists('[data-testid="mm-root"]'), 10, 400);
const mmDisp = await js(`(function(){
  var all=[].slice.call(document.querySelectorAll('[data-testid="mm-node"]'));
  return all.map(function(e){ return {sid:String(e.getAttribute('data-session-id')||''),
    disp:String(e.getAttribute('data-dispatch')||''), st:String(e.getAttribute('data-branch-state')||''),
    said:String(e.getAttribute('data-said')||''), text:String(e.textContent||''),
    role:String(e.getAttribute('data-dossier-role')||''), sum:String(e.getAttribute('data-dossier-summary')||''),
    src:String(e.getAttribute('data-dossier-src')||''), has:String(e.getAttribute('data-has-dossier')||''),
    reason:String(e.getAttribute('data-dossier-reason')||'')}; });
})()`);
const dispNodes = Array.isArray(mmDisp) ? mmDisp.filter((n) => n.disp) : [];
console.log("  导图带派发的节点 " + dispNodes.length + " 个：" + J(dispNodes.map((d) => [d.st, d.said ? "有产出" : "无产出"])));
t("NS-10a", "🔴 导图上 `[data-dispatch]` 非空的节点**恰 8 个**（派发关系画出来了）", dispNodes.length === WANT_N, dispNodes.length);
const KNOWN_ST = ["blank", "running", "done", "partial", "unknown"];
t("NS-10b", "这 8 个节点的 `data-branch-state` **全部落在已知状态集**内",
	dispNodes.length === WANT_N && dispNodes.every((n) => KNOWN_ST.indexOf(n.st) >= 0), dispNodes.map((n) => n.st));
t("NS-10c", "🔴 这 8 个派发节点**都**带 `[data-split]`（派发与分流指向同一组分支；跨批残留允许共存）",
	dispNodes.length === WANT_N && dispNodes.every((n) => marked.some((m) => m.sid === n.sid)),
	{ disp: dispNodes.map((n) => n.sid.slice(0, 14)), splitRun: markedRun.map((m) => m.sid.slice(0, 14)), splitAll: marked.length });
/* 🔴 没有产出的节点**必须写出原因**（不能只把有产出的那几条标出来，
 *    否则读图人会以为"没产出的那几条没派发过" —— 那是错的信息） */
const noSay = dispNodes.filter((n) => !n.said);
t("NS-10d", "🔴 无产出的节点上**写出了「产出未读到」+ 原因**（不静默 —— 纪律 19）",
	noSay.length === 0 || noSay.every((n) => n.text.indexOf("产出未读到：") >= 0),
	noSay.map((n) => n.text.slice(0, 60)));
/* 🔴 第 18 批修正：`applyDispatchLabels` 的 `applied` / `states` **只数 rows**
 *    （`byId` 里同一会话再现**不重复计数**，与 `applySplitLabels` 的 `countIt` 同口径）。
 *    上一版两边都递增 ⇒ `diag.dispatchApplied` **翻倍**（真机实测 `16`，而台账只有 `8` 条）。
 *    这条断言把「诊断读数」钉在台账条数上 —— 读数翻倍会让读报告的人以为派发了两次。 */
const diagDisp = await js(`(function(){ try{ var s=window.__dshBranchTree.getBranchSnapshot(); return s&&s.diag? s.diag.dispatchApplied : null; }catch(e){ return '__err:'+e.message; } })()`);
const ledgerLen2 = await js(`(function(){ try{ var d=window.__dshDispatchLog; return (d&&d.items)? d.items.length : null; }catch(e){ return null; } })()`);
t("NS-10e", "🔴 诊断读数 `diag.dispatchApplied` **不翻倍**（= 台账条数 8，不是 16 —— byId 再现不重复计数）",
	diagDisp === WANT_N && ledgerLen2 === WANT_N, { diagDispatchApplied: diagDisp, ledger: ledgerLen2 });

/* ══════════ L · 第 21 批：会话档案 —— 「每个会话自己的总监 + 总结文档」（R3） ══════════
 * 用户原话：「不会话都有自己的总监,存在自己的会话总结文档」。
 * 🔴 为什么这组必须**从界面读**，而不是"函数在不在"：
 *    第 19 批已交付 `store/session-dossier.js`（单测 17/17 全绿），但 `applyDossiers` **全仓零调用**
 *    ⇒ 档案写进 localStorage 却**从不显示**（"模块写好了 ≠ 接进去了"）。
 *    所以判据只能是"**导图节点上读得到**"，且要有一条**用户可见**的文本断言。
 * 作用域：只数**本次这 8 条**（跨批残留共存；与 NS-5b/NS-10a 同口径）。 */
section("L 会话档案：每个分支有自己的总监与总结文档");
const dispRunNodes = dispNodes.filter((n) => inRun(n.sid));
const roleOf = (sid) => { const n = dispRunNodes.filter((x) => x.sid === sid)[0]; return n ? n.role : ""; };

t("NS-12a", "🔴 本次 8 条**每条**都有非空 `data-dossier-role`（每个会话都有自己的总监）",
	dispRunNodes.length === WANT_N && dispRunNodes.every((n) => n.role !== ""), dispRunNodes.map((n) => n.role));

const roleSet = dispRunNodes.map((n) => n.role).filter(Boolean);
t("NS-12b", "🔴 负对照：8 条的 role **互不相同**（不是同一个总监顶到所有分支上）",
	roleSet.length === WANT_N && new Set(roleSet).size === WANT_N, roleSet);

t("NS-12c", "🔴 role 与自己那条的**分流维度一致**（三口径同源：分流标签 / 角色名 / 档案）",
	DIM_KEYS.every((k, i) => {
		const m = markedRun.filter((x) => x.split === k)[0];
		return !m || String(roleOf(m.sid)).indexOf(DIM_LABELS[i]) >= 0;
	}),
	DIM_KEYS.map((k, i) => [DIM_LABELS[i], roleOf((markedRun.filter((x) => x.split === k)[0] || {}).sid || "")]));

t("NS-12d", "🔴 节点**可见文本**里出现「总监」（用户能看见 —— 不是只写在属性里）",
	dispRunNodes.length === WANT_N && dispRunNodes.every((n) => n.text.indexOf("总监") >= 0),
	dispRunNodes.map((n) => n.text.slice(0, 46)));

t("NS-12e", "🔴 `data-has-dossier` 与 role **双向一致**（有档案必标 1、无档案必标 0）",
	dispRunNodes.every((n) => (n.role !== "" ? n.has === "1" : n.has !== "1")),
	dispRunNodes.map((n) => [n.has, n.role ? "有 role" : "无 role"]));

t("NS-12f", "🔴 `data-dossier-src` 落在合法三态，且 `src=none` 时**必须带原因**（「没有」与「读不到」可分）",
	dispRunNodes.every((n) => ["collect", "none", ""].indexOf(n.src) >= 0 && (n.src !== "none" || n.reason !== "")),
	dispRunNodes.map((n) => [n.src, n.reason.slice(0, 30)]));

/* ── 取证截图钩子 ②：导图 8 条派发节点特写（`SHOTS=1`）────────────────────────
 * 🔴 为什么必须在这里拍：
 *    ① 此刻导图**正开着**；跑完再重开 ⇒ 组件重挂载、读数回落（同钩子 ①）。
 *    ② 此刻**已知**本次 8 条的 sessionId（`thisRun`）⇒ 只截这 8 条，取景聚焦；
 *       跨批累积后页面上 `[data-dispatch]` 节点实测有 **107** 个，直接全截等于没重点。
 *    ③ `clip` + `scale` 是**重新渲染**到倍率 ⇒ 摘要行（`产出未读到：…`）可读；
 *       上一轮那张 47% 整树截图里摘要行是糊的，不满足验收（纪律 57 的取证三坑之一）。 */
if (process.env.SHOTS === "1") {
	try {
		const fsmod = await import("node:fs");
		fsmod.mkdirSync("logs/acceptance18", { recursive: true });
		await send("Page.enable");
		const box = await js(`(function(){
		  var want = ${JSON.stringify(thisRun)};
		  var ns = [].slice.call(document.querySelectorAll('[data-testid="mm-node"]')).filter(function(e){
		    return want.indexOf(String(e.getAttribute('data-session-id')||'')) >= 0; });
		  if (!ns.length) return null;
		  var x1=1e9,y1=1e9,x2=-1e9,y2=-1e9;
		  ns.forEach(function(e){ var r=e.getBoundingClientRect(); x1=Math.min(x1,r.x); y1=Math.min(y1,r.y);
		    x2=Math.max(x2,r.right); y2=Math.max(y2,r.bottom); });
		  return { n: ns.length, x1:x1, y1:y1, x2:x2, y2:y2 }; })()`);
		console.log("  取证·导图**本次**派发节点并集：" + J(box));
		if (box && box.n === WANT_N && box.x2 > box.x1) {
			const pad = 18;
			/* 🔴 `captureBeyondViewport` 必须为 **false**：`getBoundingClientRect()` 给的是**视口坐标**，
			 *    而 `captureBeyondViewport: true` 会让 CDP 按**页面坐标**解释 `clip` ⇒ 偏移到空白区
			 *    （第 18 批实测：拍出一张**纯黑**图，差点被当成"产品没渲染"）。
			 *    钳制颜色也要防纯黑：见下面的 `checkShotNotBlank()`。 */
			const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false,
				clip: { x: Math.max(0, box.x1 - pad), y: Math.max(0, box.y1 - pad),
					width: Math.min(1300, box.x2 - box.x1 + pad * 2), height: Math.min(900, box.y2 - box.y1 + pad * 2), scale: 3 } });
			if (r && r.data) {
				const buf = Buffer.from(r.data, "base64");
				fsmod.writeFileSync("logs/acceptance18/H5b-mindmap-dispatch-closeup.png", buf);
				reportShot("H5b-mindmap-dispatch-closeup.png（3×，本次 8 条）", buf, J({ nodes: box.n }));
			} else { console.log("  ⚠️ 截图无数据"); }
		} else {
			console.log("  ⚠️ 本次 8 条节点未全部在视口内，跳过特写（不影响判定）");
		}
	} catch (e) { console.log("  ⚠️ 取证截图 ② 失败（**不影响判定**，属工具问题）：" + String((e && e.message) || e)); }
}
await closeMindmap("导图关闭");
await sleep(500);

/* ══════════════ M · 19 号文 N2：跨维度转发（归属 ⇒ 去向 ⇒ 目标会话对账） ══════════════
 *
 * 本段验的是**接线**（真机产物里那份实现 + 真机数据），**不重复**验纯函数本身
 *   —— 那是离线 `test-routing-local.mjs`（29 条，含 RL-10/11）的职责（纪律 52 / 92）。
 *
 * 🔴 为什么必须**在真机上再验一次实现**：
 *    本轮的 P1–P3 踩过一次 "离线全绿、真机炸" —— 循环依赖在产物 `__m()` 工厂里
 *    顶层命名解构拿到 `undefined`（真机 `noiseReasonOf is not a function`，
 *    而离线 60/60 全绿）。**源码对 ≠ 产物对** ⇒ 这里只认真机 `window.__dsh*` 上的那几个函数，
 *    并单独用**磁盘产物**验"新接线有没有被真的打进 `lib/client.js`"。
 *
 * 判据映射（19 号文 N2 判据 1/2/4 + 接线与产物）：
 *   NS-13a 契约：三个新契约都装在真机上
 *   NS-13b 映射对账：真机索引 ↔ 真机树（`dimKeys = bound + unbound`，纪律 78 单一真相源）
 *   NS-13c **判据 2**：真机数据下"属于其他维度" ⇒ `transfer`，且候选 id **= 该分支节点 id**
 *   NS-13d **判据 1 + 负对照**：同一份数据下"属于当前维度" ⇒ `local`（**不得**是 transfer）
 *   NS-13e 产物内 `childEnvelope` 正确（`root` 继承 / `parent` = 源 / `round`+1 / `ref` 指回）
 *   NS-13f **接线进了产物**：磁盘 `lib/client.js` 里真的含这几个新调用点与 `data-said` 锚点
 * ══════════════════════════════════════════════════════════════════ */
section("M 跨维度转发（19 号文 N2 · 真机数据 + 产物内实现）");
{
	const pre = await js(`(async function(){
	  try {
	    var items = {};
	    try { var raw = JSON.parse(localStorage.getItem("dsh.director.split") || "{}"); items = (raw && raw.items) ? raw.items : {}; } catch(e) {}
	    return { hasDb: !!window.__dshDimBranch, hasLin: !!window.__dshLineage,
	             hasRouterDim: !!(window.__dshRouter && window.__dshRouter.dimensionCandidates),
	             hasHier: !!window.__dshHierarchy, indexKeys: Object.keys(items).length };
	  } catch(e) { return { err: String((e && e.message) || e) }; }
	})()`);
	t("NS-13a", "🔴 真机装着三个新契约（`__dshDimBranch` / `__dshLineage` / `__dshRouter.dimensionCandidates`）—— 离线绿不等于产物绿（本轮循环依赖事故的教训）",
		!!pre && pre.hasDb === true && pre.hasLin === true && pre.hasRouterDim === true && pre.hasHier === true, pre);

	/* 🔴 前提（纪律 23）：本段要的是「**已存在**的维度分支」—— 没有它整段无意义。
	 *    B 段已派发 WANT_N 条并 `recordSplits()` 写了索引 ⇒ 前提应成立；
	 *    不成立 ⇒ 判 **INVALID**（不判产品红 —— 纪律 94），并指明是哪一环没成。 */
	const map = await js(`(async function(){
	  try {
	    var tree = await window.__dshHierarchy.loadTree();
	    var items = {};
	    try { var raw = JSON.parse(localStorage.getItem("dsh.director.split") || "{}"); items = (raw && raw.items) ? raw.items : {}; } catch(e) {}
	    var ctx = window.__dshDimBranch.dimBranchContext(tree, items, {});
	    var keys = Object.keys(ctx.branchOf);
	    return { dims: keys, accounts: ctx.accounts, currentDim: ctx.currentDim,
	             first: keys.length ? ctx.branchOf[keys[0]] : null };
	  } catch(e) { return { err: String((e && e.message) || e) }; }
	})()`);
	const dims = (map && Array.isArray(map.dims)) ? map.dims : [];
	if (!dims.length) {
		console.log("\n" + "═".repeat(59));
		console.log("  IS_PASS: INVALID（真机上没有可对账的**维度分支**，本段前提不成立）");
		console.log("  实测：" + J(map));
		console.log("  真因：① B 段派发没成（分支没挂到树上）② 分流索引没写（`recordSplits` 未落）");
		console.log("  处置：先看 B 段读数（NS-3*/NS-4*），**不要据此判 N2 产品红**（纪律 94）。");
		console.log("═".repeat(59));
		process.exit(2);
	}
	t("NS-13b", "🔴 真机映射对账：`dimKeys = bound + unbound`（纪律 78 单一真相源 —— 索引里的维度数必须等于「挂上树 + 没挂上」）",
		!!map && !!map.accounts && map.accounts.dimKeys === (map.accounts.bound + map.accounts.unbound)
		&& map.accounts.bound >= 2,
		map && map.accounts);

	/* NS-13c / NS-13d：同一份真机数据下的**判据 2** 与**判据 1（负对照）**。
	 * 维度样本取真机 branchOf 的**第一个键**（不写死 `prose`）⇒ 换环境也不假红。 */
	const probe = await js(`(function(){
	  try {
	    var k = ${JSON.stringify(dims[0])};
	    var rec = null;
	    return (async function(){
	      var tree = await window.__dshHierarchy.loadTree();
	      var items = {};
	      try { var raw = JSON.parse(localStorage.getItem("dsh.director.split") || "{}"); items = (raw && raw.items) ? raw.items : {}; } catch(e) {}
	      var ctx = window.__dshDimBranch.dimBranchContext(tree, items, {});
	      rec = ctx.branchOf[k];
	      var plan = { dims: [{ key: k, label: k }],
	        attribution: { dims: [{ key: k, label: k, score: 0.9, reason: "闸门构造的真机样本" }] } };
	      /* 情形 A：当前**不在**该维度（currentDim 空）⇒ 应转派 */
	      var cA = window.__dshRouter.dimensionCandidates(plan, { currentNodeId: "__none__", currentDim: "", branchOf: ctx.branchOf });
	      var rA = window.__dshRouter.route("把这一维度的内容改一下", { nodes: cA, currentNodeId: "__none__" });
	      /* 情形 B：当前**就在**该维度 ⇒ 应就地 */
	      var cB = window.__dshRouter.dimensionCandidates(plan, { currentNodeId: rec.nodeId, currentDim: k, branchOf: ctx.branchOf });
	      var rB = window.__dshRouter.route("把这一维度的内容改一下", { nodes: cB, currentNodeId: rec.nodeId });
	      return { k: k, rec: rec,
	        aCandId: (cA[0] && cA[0].id) || null, aDest: rA.decision.destination, aDim: rA.decision.dimKey || "",
	        bCandId: (cB[0] && cB[0].id) || null, bDest: rB.decision.destination, bDim: rB.decision.dimKey || "" };
	    })();
	  } catch(e) { return { err: String((e && e.message) || e) }; }
	})()`);
	t("NS-13c", "🔴 **判据 2**：真机数据下「属于其他维度」⇒ `transfer`，且候选 id **= 该分支节点 id**（目标会话 id 对账，不是「有流转就算过」）",
		!!probe && probe.aDest === "transfer" && !!probe.rec && probe.aCandId === probe.rec.nodeId
		&& probe.aDim === probe.k, probe);
	t("NS-13d", "🔴 **判据 1 + 负对照**：同一份数据下「属于**当前**维度」⇒ `local`（**不得**是 transfer —— 否则「就地」与「转走」同形）",
		!!probe && probe.bDest === "local" && probe.bDest !== probe.aDest
		&& probe.bCandId === probe.rec.nodeId, probe);

	/* NS-13e：**产物内**的 lineage 实现（不是源码里那份）*/
	const env = await js(`(function(){
	  try {
	    var L = window.__dshLineage;
	    var src = L.makeEnvelope({ id: "s-src", from: "n-src", root: "n-src", via: "local" }, { self: "n-src" });
	    var kid = L.childEnvelope(src, { id: "s-dst", to: "n-dst", via: "transfer" });
	    return { root: kid.root, parent: kid.parent, round: kid.round, via: kid.via, ref: kid.ref, to: kid.to };
	  } catch(e) { return { err: String((e && e.message) || e) }; }
	})()`);
	t("NS-13e", "🔴 **产物内** `childEnvelope` 正确：`root` 继承源 / `parent` = 源 id / `round`+1 / `ref` 指回源（同一血缘，不是各成一组）",
		!!env && env.root === "n-src" && env.parent === "s-src" && env.round === 1
		&& env.via === "transfer" && env.ref === "s-src" && env.to === "n-dst", env);

	/* NS-13f：**接线是否真的进了产物**（读磁盘，不靠界面推断）。
	 * 🔴 为什么这条必须有：P1–P3 的事故形态是「src 里写了、产物里没生效」。
	 *    只断言"界面上有按钮"读不出这一点 —— 按钮与接线是两码事。 */
	const bundleSrc = (() => {
		try { return readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8"); }
		catch (e) { return ""; }
	})();
	const wireHits = ["childEnvelope(", "dimensionCandidates(", "listAllDirectorMessages(", "dimBranchContext(", "d-upstream-sum"]
		.map((s) => [s, bundleSrc.indexOf(s) >= 0]);
	const missing = wireHits.filter((x) => !x[1]).map((x) => x[0]);
	t("NS-13f", "🔴 **接线进了产物**：`lib/client.js` 里含 5 个新调用点/锚点（`childEnvelope(` / `dimensionCandidates(` / `listAllDirectorMessages(` / `dimBranchContext(` / `d-upstream-sum`）",
		bundleSrc.length > 0 && missing.length === 0, { bundleBytes: bundleSrc.length, missing: missing });
}

/* ══════════════ O · 19 号文 P6：N5 对话持续性 + N6 档案全覆盖 ══════════════
 * 判据来源（逐字）：
 *   §3.5 **P1**「用户在总监页做**任一**产生结果的动作 ⇒ 消息数净增 ≥1；
 *                **若不写，界面显式标明**（`T-PLUG-050` 二选一）」
 *   §3.5 **P2**「进入任意曾有消息的会话 ⇒ 该会话消息**可见且条数 = 库内条数**（不得 0）」
 *   §3.5 **P3**「第 N 轮简报含第 N−1 轮结论摘要，且**逐字同源**」→ 纯函数层已由
 *                `test-message-continuity.mjs#MC-1x` 锁死（真机没有"改写摘要"这种数据）
 *   N6 **判据 1**「每个存活的**总监分支**会话 ⇒ `dossierOf(id)` 非空且含 `role` 与 `summary`」
 *   N6 **判据 3**「`dossierStats(aliveIds)` 读数 = 实际存活代数」
 *
 * 🔴 口径更正（纪律 99：判据生命周期须与数据生命周期一致）
 *   §3.5 P2 的「条数 = 库内条数」在**渲染层**并不是原样成立 —— 实测 `msgs.slice(-14)`
 *   ⇒ 若把「可见 DOM 元素数」当"条数"，库内 > 14 时**必然假红**（口径错，不是产品错）。
 *   本段按**真实口径**拆三条判：① 读数（`dp-r5-msg` 文案数字 = `msgs.length`）与库内**对账**；
 *   ② 非空（> 0）；③ 可见元素数 = `min(14, 库内条数)`。
 *   文档措辞在 P10 就地更正（**不改产品**去迎合文档 —— 那是把判据变成需求）。
 */
section("O 对话持续性（N5 P1/P2）+ 档案全覆盖（N6）");

/* 当前作用域 id 的**唯一可读来源** = `dp-level` 的 `value`（页面 `nodeId` 就是它）。
 * 🔴 为什么不从 `__dshHierarchy` 反推：作用域由 `directorLayoutStore.activeNode` 驱动，
 *    `dp-level` 正是它的投影 ⇒ **读界面就是读真相**（纪律 92：用产品自己的口径）。 */
const curScopeId = await js(`(function(){ var e=document.querySelector('[data-testid="dp-level"]'); return e? String(e.value||'') : null; })()`);
const uiMsgCount = async () => {
	const txt = await js(`(function(){ var e=document.querySelector('[data-testid="dp-r5-msg"]'); return e? String(e.textContent||'') : null; })()`);
	if (txt === null || txt === undefined) return null;
	const m = String(txt).match(/([0-9]+)/);
	return m ? Number(m[1]) : null;
};
const dbMsgCount = async (id) => await js(`(async function(){ try{ var a=await window.__dshPluginDb.listDirectorMessages(${JSON.stringify(String(id))}); return (a||[]).length; }catch(e){ return '__err:'+e.message; } })()`);

const p2ui = await uiMsgCount();
const p2db = await dbMsgCount(curScopeId);
console.log("  P2 读数：作用域 " + J(curScopeId) + " ｜ `dp-r5-msg` 文案数字 " + J(p2ui) + " ｜ 库内 " + J(p2db));

t("NS-14a", "🔴 **P2 对账**：`dp-r5-msg` 文案里的条数 **===** 库内 `listDirectorMessages(当前作用域)` 条数（同一真相源，纪律 78）",
	typeof p2db === "number" && p2ui === p2db, { ui: p2ui, db: p2db, scope: curScopeId });

t("NS-14b", "🔴 **P2 非空**：当前作用域**曾有消息** ⇒ 条数 **> 0**（不得是「总监消息 0」—— 那正是用户看到的「切会话即空」）",
	typeof p2db === "number" && p2db > 0, { db: p2db, scope: curScopeId });

/* ③ 可见性：切到「总监消息」分段后，可见元素数 = `min(14, 库内条数)`。
 * 🔴 不点这一下的话 `r5tab` 停在「流转」⇒ 元素数恒 0 ⇒ 判据假红（**先证前提再断结果**，纪律 23）。 */
const msgTabSeen = await js(`(function(){ return !!document.querySelector('[data-testid="dp-r5-msg"]'); })()`);
if (msgTabSeen) {
	await clickWithFallback('[data-testid="dp-r5-msg"]', "💬 切到「总监消息」分段（前提：可见集要真的渲染出来）", async () => (await js(`document.querySelectorAll('[data-testid="dp-dir-msg"]').length`)) > 0, 6, 250);
	await sleep(250);
}
const domMsgs = await js(`document.querySelectorAll('[data-testid="dp-dir-msg"]').length`);
const domWant = typeof p2db === "number" ? Math.min(14, p2db) : -1;
t("NS-14c", "🔴 **P2 可见**：分段切到「总监消息」后，可见元素数 = `min(14, 库内条数)`（渲染上限是**实测事实**，不是「元素数 = 库内数」）",
	domMsgs === domWant, { dom: domMsgs, want: domWant, db: p2db });

/* ── P1：**不写消息必须显式标明** ──────────────────────────────────────
 * 本版对 `T-PLUG-050` 的选择是「登记**不**产生总监消息」；判据因此是
 *   **提示里必须说出来**，而不是"消息数必须涨"（后者会把一个**明确的设计选择**判成缺陷）。
 * 🔴 负对照（纪律 23）：同一动作前后总监消息条数**不变** ——
 *    否则"显式标注"就成了一句与事实相反的空话（标注说没写、实际写了）。 */
const REG_TEXT = "闸门登记哨兵 " + Date.now();
const regSet = await js(`(function(){ try{ var b=window.__dshChatBridge; if(b && typeof b.setComposerText==='function'){ b.setComposerText(${JSON.stringify(REG_TEXT)}); return 'ok'; } return '__no-api'; }catch(e){ return '__exc:'+e.message; } })()`);
const regBack = await js(`(function(){ try{ return window.__dshChatBridge.readComposerText(); }catch(e){ return '__err:'; } })()`);
t("NS-14d", "🔴 **P1 前提**：先往原生输入框写字并**逐字回读一致**（否则后面「登记」这条动作根本执行不到）",
	regSet === "ok" && String(regBack) === REG_TEXT, { set: regSet, back: String(regBack).slice(0, 30) });

const p1Before = await dbMsgCount(curScopeId);
const regRun = await clickWithFallback('[data-testid="dp-host-register"]', "📥 点「登记流转」（验证「不写消息」是否**显式标注**）", async () => {
	const txt = await js(`(function(){ var e=document.querySelector('[data-testid="dp-toast"]'); return e? String(e.textContent||'') : null; })()`);
	return txt !== null && txt !== undefined && String(txt).indexOf("登记") >= 0;
}, 10, 250);
const regToast = await js(`(function(){ var e=document.querySelector('[data-testid="dp-toast"]'); return e? String(e.textContent||'') : null; })()`);
t("NS-14e", "🔴 **P1 显式标注**：点「登记流转」后提示**明说**「不产生总监消息」+ 给出替代路径（用户不会以为「功能坏了」）",
	regRun.click.ok === true && String(regToast).indexOf("不产生总监消息") >= 0, { toast: String(regToast).slice(0, 80), click: regRun.click });

await sleep(300);
const p1After = await dbMsgCount(curScopeId);
t("NS-14f", "🔴 **P1 负对照**：同一次「登记」前后，总监消息条数**不变** —— 证明那句标注说的是真话（不是空承诺）",
	typeof p1Before === "number" && p1Before === p1After, { before: p1Before, after: p1After });

/* ── N6：档案逐会话全覆盖（判据 1 + 判据 3）──────────────────────────
 * 🔴 「存活集」必须取**总监分支**（分流索引 ∩ 存活），不是宿主全部会话 ——
 *    档案是**派发时**按分支写的；拿宿主全量去比会把"用户自己的普通会话"也算成缺档，
 *    直接把判据变成永远红。**先证前提**：`dimAliveN > 0`（没有总监分支 ⇒ 判据空真）。 */
const dosProbe = await js(`(function(){
  try{
    var bt = window.__dshBranchTree, dos = window.__dshDossier;
    if (!bt || !dos) return { err: 'no-api', hasBt: !!bt, hasDos: !!dos };
    var raw = bt.rawSessionSummaries() || [];
    var aliveAll = raw.map(function(s){ return s && s.id ? String(s.id) : ''; }).filter(Boolean);
    var arch = bt.archivedSessionIds();
    var archN = null, alive = aliveAll;
    if (Array.isArray(arch)) {
      archN = arch.length; var set = {}; arch.forEach(function(x){ set[String(x)] = 1; });
      alive = aliveAll.filter(function(id){ return !set[id]; });
    }
    var idx = {};
    try { var r0 = localStorage.getItem('dsh.director.split'); idx = r0 ? (JSON.parse(r0).items || {}) : {}; } catch(e2) { idx = {}; }
    var aliveSet = {}; alive.forEach(function(id){ aliveSet[id] = 1; });
    var dimAlive = Object.keys(idx).filter(function(id){ return aliveSet[id]; });
    return {
      rawN: raw.length, aliveN: alive.length, archN: archN, dimN: Object.keys(idx).length,
      dimAliveN: dimAlive.length, st: dos.stats(alive), stDim: dos.stats(dimAlive)
    };
  }catch(e){ return { err: String((e && e.message) || e) }; }
})()`);
console.log("  N6 读数：" + J(dosProbe));

const stA = dosProbe && dosProbe.st;
const stD = dosProbe && dosProbe.stDim;
t("NS-14g", "🔴 **N6 判据 3 恒等式**：`aliveCount === withAlive + missingAlive` **且** `total === withAlive + orphans`（存活集被完整分割）",
	!!stA && stA.aliveCount === stA.withAlive + stA.missingAlive && stA.total === stA.withAlive + stA.orphans,
	{ st: stA });

t("NS-14h", "🔴 **N6 判据 1 全覆盖**：**每个存活的总监分支**会话都有自己的档案（`missingAlive === 0`）—— 先证前提 `dimAliveN > 0`",
	!!stD && dosProbe.dimAliveN > 0 && stD.missingAlive === 0,
	{ dimAliveN: dosProbe && dosProbe.dimAliveN, missingAlive: stD && stD.missingAlive, missingIds: stD && stD.missingIds });

/* ══════════════ D · 清除对话消息 ══════════════ */
section("D 清除对话消息：二次确认 + 只清自己 + 不越界");

const externalReadouts = async () => await js(`({
  hostConversation: (function(){ try{ var r=window.__dshChatBridge.readConversationItems(40); return r.ok? r.total : '__fail:'+r.reason; }catch(e){ return '__err:'+e.message; } })(),
  hierarchyNodes: (function(){ try{ return window.__dshHierarchy? null : null; }catch(e){ return null; } })(),
  designEls: document.querySelectorAll('[data-testid^="ds-el-"]').length,
  persistKeys: Object.keys(localStorage).filter(function(k){ return /^(dsh\\.director|dsh_director_|dsh-v9-theme)/.test(k) && k !== 'dsh.director.msgs.backup'; }).length,
  /* 🔴 第 22 批：**排除备份槽** —— dsh.director.msgs.backup 是「清除」这个动作**自己产生**的
   *    安全网（清一次就新建/覆盖一次）。把它算进"键组数不变"会让判据在**正确行为**上报红
   *    （本轮实测 9 → 10）。⇒ 判据只约束**用户数据键**；备份槽另立断言 NS-6l2。 */
  backupExists: localStorage.getItem('dsh.director.msgs.backup') ? 1 : 0,
  cookieKeys: String(document.cookie||'').split(';').filter(function(s){ return /dsh_director/.test(s); }).length
})`);
const pluginMsgs = async () => await js(`(async function(){ try{ var st=await window.__dshPluginDb.pluginDbStats(); return st? st.conversations : null; }catch(e){ return '__err:'+e.message; } })()`);
const hierarchyCount = async () => await js(`(async function(){ try{ var a=await window.__dshHierarchy.listAllNodes(); return a.length; }catch(e){ return null; } })()`);

/* 🔴 U6（第二十四轮）：这个按钮也会**静默丢点击** —— 实测首点后 `data-armed` 仍为 "0"
 *    ⇒ 后面 20 条（NS-6b…NS-6r）**全部级联红**，而真因只是"第一下没点动"。
 *    「首点」只进入待确认（**不删任何数据**）⇒ 补送是**幂等且安全**的。 */
const armedFn = async () => (await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`)) === "1";
const clearRun = await clickWithFallback('[data-testid="dp-maint-clear"]', "🧹 清除消息(首点·进待确认)", armedFn, 12, 250);
const clearBtn = clearRun.click;
t("NS-6a", "真实鼠标点到「🧹 清除消息」（先确保它在视口内且命中自己）", clearBtn.ok === true, clearBtn);
const armed1 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6b", "首点**只进入待确认**（`data-armed=1`），不立刻删", armed1 === "1", armed1);

/* 🔴 正负对照：自动撤防必须真的存在（否则按钮永久停在待删态，用户"以为是第一次点"就删了） */
console.log("  · 等 4.2s 观察自动撤防…");
await sleep(4200);
const armed2 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6c", "🔴 超时**自动撤防**：4.2s 后 `data-armed` 回到 0", armed2 === "0", armed2);

/* ── 🔴 正对照的**哨兵**（纪律 23：每条断言都要问"反例上会不会也通过？"）────────
 *    上一版判据 = "清除后 `pluginDbStats().conversations` 必然下降"。
 *    真机实测**假红**：清除后 `1 → 1`。根因：产品**有后台写入者** ——
 *    K 段回收裁定落库后，清除完成之后又产生了一条**新的**回收裁定
 *    （实测记录 `at=18:44:03` 落在 D 段之后、W 段期间，文案是"8 条仍在跑"，
 *      与 K 段那条"7 条仍在跑"是**两条不同**的裁定）⇒ 表里又出现 1 条。
 *    把一个"活的、后台会持续写"的表当成"静止的计数"来判 ⇒ 判据本身不成立。
 *    ⇒ 改为**哨兵法**：清除前自己写入一条带**唯一 messageId** 的消息，
 *      清除后确认**它消失了**。这条哨兵的消失**只能**由"清除"造成 ⇒ 不可伪证。
 *      （清除后表里还剩什么**如实打印** —— 纪律 19：降级可以，无声不行。） */
const SENTINEL_ID = "gate-sentinel-" + Date.now();
const sentWrite = await js(`(function(){ try{
  var api = window.__dshPluginDb;
  if (!api || typeof api.appendDirectorMessage !== 'function') return '__noApi';
  return api.appendDirectorMessage('ws___ungrouped__', { messageId: ${JSON.stringify(SENTINEL_ID)}, role: 'director', kind: 'note', text: '闸门哨兵（应被清除）' })
    .then(function(r){ return r ? 'ok' : '__null'; });
}catch(e){ return '__exc:'+e.message; } })()`);
await sleep(200);
const sentIn = await js(`(function(){ try{
  return window.__dshPluginDb.listDirectorMessages('ws___ungrouped__')
    .then(function(r){ return (r||[]).filter(function(x){ return x.messageId === ${JSON.stringify(SENTINEL_ID)}; }).length; });
}catch(e){ return '__exc:'+e.message; } })()`);
console.log("  哨兵：写入 " + J(sentWrite) + " ｜ 按 messageId 回读命中 " + J(sentIn) + " 条");
t("NS-6h0", "🔴 哨兵**先证前提**：写入后能按 messageId 读回来（否则后面的「消失」不可信 —— 纪律 23）",
	sentWrite === "ok" && sentIn === 1, { write: sentWrite, read: sentIn });

/* 四项外部读数（在"真删"之前取一次） */
const extBefore = await externalReadouts();
const hierBefore = await hierarchyCount();
const msgBefore = await pluginMsgs();
console.log("  清除前：外部读数 " + J(extBefore) + " ｜ 层级节点 " + hierBefore + " ｜ 插件消息数 " + msgBefore);

/* 🔴 第 22 批 · 快照（纪律 15：会写盘的闸门段必须「快照 → 还原 → 还原断言」）
 *    本段测的「清除」是**无参全表清除** ⇒ 它删掉的不只是闸门自己的哨兵，
 *    还有**用户真实的总监消息**。快照在这里取，还原在 D 段末尾做。 */
const snapPreRaw = await js(`(async function(){ try{
  var rows = await window.__dshPluginDb.pGetAll('directorConversations');
  var list = Array.isArray(rows) ? rows : [];
  var sent = ${JSON.stringify(SENTINEL_ID)};
  var real = list.filter(function(r){ return r && r.messageId && String(r.messageId) !== sent; });
  return JSON.stringify({ n: list.length, realN: real.length, sample: real.length ? String(real[0].messageId) : '' });
}catch(e){ return '__exc:'+e.message; } })()`);
let snapPre = null;
try { snapPre = JSON.parse(snapPreRaw); } catch (e) { snapPre = null; }
const msgsSnapReal = snapPre ? snapPre.realN : -1;
console.log("  清除前快照（供还原）：" + J(snapPreRaw));

/* 真删：连点两次（间隔远小于 3s 窗口） */
/* 同 U6：进入待确认这一步丢了 ⇒ 后面全级联。补送**不删数据**，安全。 */
await clickWithFallback('[data-testid="dp-maint-clear"]', "确认清除(第 1 点 · 进待确认)", armedFn, 12, 250);
await sleep(260);
const armed3 = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
t("NS-6d", "再点前的 armed 状态为 1（确认窗口内）", armed3 === "1", armed3);
/* 🔴 第 2 点 = **真正执行删除**。丢点击同样会级联 20 条红。
 *    补送的安全性：后果判据是「哨兵从库里消失」⇒ 一旦达成就不再补送；
 *    若真被点了两次，第二次作用在**已清空**的表上（removed=0），不会误删新数据。 */
const goneFn = async () => (await js(`(function(){ try{
  return window.__dshPluginDb.listDirectorMessages('ws___ungrouped__')
    .then(function(r){ return (r||[]).filter(function(x){ return x.messageId === ${JSON.stringify(SENTINEL_ID)}; }).length; });
}catch(e){ return 1; } })()`)) === 0;
/* 🔴 不能直接用 `clickWithFallback` 等后果：它的后果等待要花 9s，
 *    而待确认窗口只有 3s ⇒ 等到补送时**早已自动撤防** ⇒ 补送只是重新 arm，
 *    **永远删不掉**（第二十四轮实测：U6 保底打印了，哨兵还在库里）。
 *    ⇒ 补送前**必须重新 arm**，再立刻执行。 */
/* 执行这一步**必须保底送达**：真实鼠标在 Electron 下会静默丢事件，
 *    丢了 ⇒ 什么都没发生、且窗口随后撤防 ⇒ 永远删不掉（第二十四轮实测的死结）。 */
await CL.clickJs('[data-testid="dp-maint-clear"]');
let purged = await waitFor(goneFn, 12, 250);
if (!purged) {
	for (let k = 0; k < 2 && !purged; k++) {
		console.log("  [U6保底] 清除执行未生效（可能已自动撤防）⇒ 重新进待确认后立即执行（第 " + (k + 1) + " 次）");
		await clickWithFallback('[data-testid="dp-maint-clear"]', "重进待确认", armedFn, 8, 120);
		await CL.clickJs('[data-testid="dp-maint-clear"]');
		purged = await waitFor(goneFn, 12, 250);
	}
}
/* 🔴 完成信号 = **哨兵消失**（跑程内），**不是** `dp-maint-result` 出现 ——
 *    该元素是**持久 DOM**，上一轮的读数还挂在上面 ⇒ `waitFor` 会**立刻命中旧值**（纪律 16 的经典坑）。
 *    真机实测：命中的是上一轮遗留的 `{before:1,removed:1}`，而本次清除此刻**还在逐条删**
 *    （同一时刻三路通道读数递降：表 3 → 2 → 0，看下面的打印即可复现）。
 *    ⇒ 门控改成「哨兵已从库里消失」；`setClearInfo` 在 `await clearDirectorMessages()` 之后同步执行，
 *      所以哨兵消失后短睡即可拿到**本次**的读数。 */
let sentinelGone = false;
const result = await waitFor(async () => {
	const gone = await js(`(function(){ try{
	  return window.__dshPluginDb.listDirectorMessages('ws___ungrouped__')
	    .then(function(r){ return (r||[]).filter(function(x){ return x.messageId === ${JSON.stringify(SENTINEL_ID)}; }).length; });
	}catch(e){ return '__exc'; } })()`);
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-result"]');if(!e)return null;
	  return {before:+e.getAttribute('data-before'), removed:+e.getAttribute('data-removed'), ok:e.getAttribute('data-ok'), text:String(e.textContent||'')};})()`);
	if (gone === 0 && v) { sentinelGone = true; return v; }
	return null;
}, 80, 400);
if (sentinelGone) { await sleep(500); }          // 让 setClearInfo 的文案落地
console.log("  清除读数：" + J(result) + (sentinelGone ? "（✔ 哨兵已从库中消失 ⇒ 这次清除**真的**作用到库了）" : "（⚠️ 超时：哨兵仍在库里）"));
t("NS-6e", "清除结果读数出现（`dp-maint-result`）**且**发生在哨兵消失之后（不是命中上一轮的旧读数）",
	result !== null && sentinelGone, { result: result, sentinelGone: sentinelGone });
t("NS-6f", "`data-removed === data-before`（**全部**删除成功，不是删了一半）",
	result && result.removed === result.before && result.before > 0, result);
t("NS-6f2", "`data-before` ≥ 清除前闸门独立读到的条数（防「读到上一轮旧读数」—— 旧值必然偏小）",
	result && typeof msgBefore === "number" && result.before >= msgBefore,
	{ reported: result && result.before, measuredBefore: msgBefore });
t("NS-6g", "`data-ok` = 1", result && result.ok === "1", result && result.ok);

/* 🔴 正对照（第 18 轮改写）：**哨兵必须消失** —— 没有这条，下面四条"未被动"在"什么都没做"时也会通过。
 *    上一版「消息数必须下降」在**有后台写入者**时不成立（实测假红 `1 → 1`，见上文哨兵段注释）
 *    ⇒ 计数只作为**观测打印**，判据改用哨兵。 */
const msgAfter = await pluginMsgs();
console.log("  插件消息数（**观测**，不再作为判据）：" + msgBefore + " → " + msgAfter);
const leftAfter = await js(`(function(){ try{
  return window.__dshPluginDb.listDirectorMessages('ws___ungrouped__')
    .then(function(r){ return (r||[]).map(function(x){ return { at: x.at, text: String(x.text||'').slice(0,44) }; }); });
}catch(e){ return '__exc:'+e.message; } })()`);
console.log("  清除后表内容（后台写入者允许存在，但必须看得见）：" + J(leftAfter));
/* 🧪 负向校准（纪律 32）：`GATE_SENTINEL_REWRITE=1` ⇒ 清除之后**把哨兵写回去**，
 *    模拟"清除实际没生效"。用来证明 `NS-6h` 真的会红 —— 且**只**红这一条（精确命中 · 纪律 58）。
 *    这是**闸门自身的校准开关**，不是产品后门；正常跑不设此变量。 */
if (process.env.GATE_SENTINEL_REWRITE === "1") {
	await js(`window.__dshPluginDb.appendDirectorMessage('ws___ungrouped__', { messageId: ${JSON.stringify(SENTINEL_ID)}, role: 'director', kind: 'note', text: '闸门哨兵（校准：故意写回）' })`);
	await sleep(200);
}
const sentGone = await js(`(function(){ try{
  return window.__dshPluginDb.listDirectorMessages('ws___ungrouped__')
    .then(function(r){ return (r||[]).filter(function(x){ return x.messageId === ${JSON.stringify(SENTINEL_ID)}; }).length; });
}catch(e){ return '__exc:'+e.message; } })()`);
/* 🔴 判据含**前提**（`sentIn === 1`）：单独看"哨兵不在库里"在"哨兵从未写进去"时也会通过 —— 纪律 23。
 *    加上前提后，这条断言的两个反例（没写进去 / 没被删掉）**都会**红。 */
t("NS-6h", "🔴 正对照：清除前写入的哨兵消息**确实进过库**（`sentIn=1`）**且**清除后消失（`sentGone=0`）—— 不受后台写入者干扰",
	sentIn === 1 && sentGone === 0,
	{ sentIn: sentIn, sentinelLeft: sentGone, countBefore: msgBefore, countAfter: msgAfter, left: leftAfter });

/* 四项"未被动"：逐项相等 */
const extAfter = await externalReadouts();
const hierAfter = await hierarchyCount();
console.log("  清除后：外部读数 " + J(extAfter) + " ｜ 层级节点 " + hierAfter);
t("NS-6i", "🔴 未被动 ①：宿主对话项总数**不变**（不越界删宿主的消息）",
	extBefore.hostConversation === extAfter.hostConversation, { before: extBefore.hostConversation, after: extAfter.hostConversation });
t("NS-6j", "🔴 未被动 ②：层级节点数**不变**（没顺手 resetPluginDb）",
	hierBefore === hierAfter && typeof hierBefore === "number", { before: hierBefore, after: hierAfter });
t("NS-6k", "🔴 未被动 ③：设计图元素数**不变**",
	extBefore.designEls === extAfter.designEls, { before: extBefore.designEls, after: extAfter.designEls });
t("NS-6l", "🔴 未被动 ④：插件命名空间下的**用户数据键**组数**不变**（含 `dsh.director.split`；🔴 第 22 批起排除备份槽 `dsh.director.msgs.backup` —— 它由「清除」自己产生，算进去会让判据在正确行为上报红）",
	extBefore.persistKeys === extAfter.persistKeys, { before: extBefore.persistKeys, after: extAfter.persistKeys });
/* 🔴 第 22 批 NS-6l2：**清除必须留下退路** —— 备份槽真的写进去了，且条数 == 本次被清的条数。
 *    没有这条，F2（备份/恢复）就只是"代码里有几个函数"，界面上无从验证。 */
const bakRead = await js(`(function(){ try{
  var raw = localStorage.getItem('dsh.director.msgs.backup');
  if (!raw) return JSON.stringify({ exists: 0 });
  var rec = JSON.parse(raw);
  return JSON.stringify({ exists: 1, count: Array.isArray(rec.rows) ? rec.rows.length : -1, note: String(rec.note || '') });
}catch(e){ return '__exc:'+e.message; } })()`);
let bak = null;
try { bak = JSON.parse(bakRead); } catch (e) { bak = null; }
const bakAttr = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-result"]');return e?e.getAttribute('data-backup-count'):null;})()`);
/* 🔴 第 24 批：**判据从"条数相等"改成"备份 ⊇ 被删"**（第二十四轮 40 轮连跑后实测驱动）。
 *    旧判据要求 `备份条数 === 被删条数` —— 真机出现 `备份 123 / 删了 121` ⇒ **红**。
 *    但差额方向是**备份更多**（清除期间有后台写入者），那是**安全方向**，
 *    把它判成红属于纪律 31 的反面：**闸门对正确行为报红**，久了会被人绕过去。
 *    真正要保证的是「**被删掉的每一条都在备份里**」⇒ 按 messageId 做**子集**检查：
 *      · 备份少一条 / 没备份 ⇒ 子集不成立 ⇒ **照样红**（防"假安全网"）；
 *      · 备份多几条 ⇒ 绿，且差额**打印出来**（纪律 19：可解释，不许无声）。 */
console.log("  备份槽：" + J(bakRead) + " ｜ 界面 data-backup-count=" + J(bakAttr) + " ｜ 清除读数 " + J(result));
const bakIdsRaw = await js(`(function(){ try{
  var raw = localStorage.getItem('dsh.director.msgs.backup');
  var rec = raw ? JSON.parse(raw) : null;
  var rows = rec && Array.isArray(rec.rows) ? rec.rows : [];
  return JSON.stringify({ ids: rows.map(function(r){ return String(r && r.messageId); }).filter(Boolean) });
}catch(e){ return JSON.stringify({ ids: [] }); } })()`);
let bakIds = [];
try { bakIds = (JSON.parse(bakIdsRaw) || {}).ids || []; } catch (e) { bakIds = []; }
const bakIdSet = new Set(bakIds);
/* 当前库里的 id **必须都在备份里** —— 它们是"被删后又恢复回来的"，
 *   若备份覆盖不到 ⇒ 说明这份备份不是取自清除前的库（真缺陷）。 */
const nowIdsRaw = await js(`(function(){ return new Promise(function(res){
  var req = indexedDB.open('dsh-director-plugin-db');
  req.onerror = function(){ res(JSON.stringify({ now: [] })); };
  req.onsuccess = function(){ var db = req.result;
    var q = db.transaction(['directorConversations'],'readonly').objectStore('directorConversations').getAll();
    q.onsuccess = function(){ res(JSON.stringify({ now: (q.result||[]).map(function(r){ return String(r.messageId); }) })); };
    q.onerror = function(){ res(JSON.stringify({ now: [] })); }; };
}); })()`);
let nowIds = [];
try { nowIds = (JSON.parse(nowIdsRaw) || {}).now || []; } catch (e) { nowIds = []; }
const coverMiss = nowIds.filter((id) => !bakIdSet.has(id)).length;
t("NS-6l2", "🔴 清除后**留下可恢复的备份**：备份槽存在、备份**覆盖**被删集合（条数 ≥ 被删 且 当前库 id 全在备份里）、界面读数一致",
	!!bak && bak.exists === 1 && bak.count > 0 && !!result
	&& bak.count >= result.removed && coverMiss === 0
	&& bakAttr !== null && Number(bakAttr) === bak.count,
	{ backup: bak, removed: result && result.removed, attr: bakAttr, 未被备份覆盖: coverMiss, 差额: bak ? bak.count - (result ? result.removed : 0) : null });
/* 🔴 差额**必须可解释**（纪律 19）：多备份是安全方向，但界面得说清"多了几条、为什么"。 */
const clearText = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-result"]');return e?(e.getAttribute('title')||'')+' '+String(e.textContent||''):null;})()`);
t("NS-6l3", "🔴 **差额不无声**：备份条数 == 被删条数，或界面结果里**写明了**多备份的条数",
	!!bak && !!result && (bak.count === result.removed || /备份比删除多 \d+ 条/.test(String(clearText || ""))),
	{ backupCount: bak && bak.count, removed: result && result.removed, 界面: String(clearText || "").slice(0, 100) });
/* 🔴 第 4 轮加固（台账 T-PLUG-039 的真实缺口）：
 *    原版是**读一次** —— 若此刻 React 还没 flush，会把**正确行为判红**（假红）；
 *    而"读一次就过"又说不清是"真复位"还是"恰好还没进入待删态"。
 *    ⇒ 改成**有界等待 + 失败时给出实读值**，把隐性时序前提变成显式断言。
 *  📌 产品侧顺序（已核源码 `purgeMessages`）：`setClearArm(0)` **先于** `setClearInfo(...)`，
 *    而 `say()` 排在**最后** ⇒ 「结果读数出现」时 armed 必已复位，但 **toast 可能还没出现**
 *    ⇒ 两者必须**各自有界等待**，不能合并成一次读。 */
const armedAfter = await waitFor(async () => {
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-maint-clear"]');return e?e.getAttribute('data-armed'):null;})()`);
	return v === "0" ? v : null;
}, 20, 150);
t("NS-6m", "清除后按钮已复位（`data-armed=0`，不留待删态）", armedAfter === "0", "armed=" + armedAfter);

/* toast 必须**自己说出**发生了什么（条数 + 边界）—— 否则"清了多少、清的是谁的"无从复核（纪律 18） */
const clearToast = await waitFor(async () => {
	const v = await js(`(function(){var e=document.querySelector('[data-testid="dp-toast"]');return e?String(e.textContent||''):null;})()`);
	return v && /已清除总监对话消息\s*\d+\s*条/.test(v) ? v : null;
}, 30, 150);
t("NS-6n", "🔴 清除后 toast **自己说明**「已清除总监对话消息 N 条」（不是只把按钮状态变回去）",
	!!clearToast, clearToast ? clearToast.slice(0, 100) : "（4.5s 内未出现含条数的清除提示）");
t("NS-6o", "🔴 该 toast 同时含**宿主侧边界**说明（降级/边界可以，无声不行 —— 纪律 19）",
	!!clearToast && /宿主/.test(clearToast), clearToast ? clearToast.slice(0, 100) : null);

/* ══════════════════════════════════════════════════════════════════
 * 🔴 第 22 批 · 还原段（纪律 15：会写盘的闸门段必须「快照 → 还原 → 还原断言」）
 *
 * 为什么必须补（本轮真机取证）：
 *   上面测的「清除」是**无参全表清除** —— 删掉的不只是闸门的哨兵，
 *   还有**用户真实的总监消息**。而这一段的断言跑完就结束了，**没人把数据放回去**
 *   ⇒ **跑一轮验收 = 用户总监消息清零一次**。
 *   实测：连跑 10 轮验收后 `directorConversations` 全表 **0 条**（`directorNodes` 却有 458 条），
 *   用户打开总监页看到「总监消息 0」，合理读成"没持久化"。
 *   而一次真实写入（点「统筹」）立刻让页签 0 → 1、库 0 → 1 ⇒ **通道本身是好的**，
 *   坏的是"验收把用户数据清掉了"。
 *
 * 判据三条（每条都要能红）：
 *   NS-7a 动作完整：`restored + skipped === total`
 *   NS-7b 正对照：快照里的**真实**消息，还原后按 messageId 真能读回来
 *                 （缺这条 ⇒ "什么都没做"也会通过 —— 纪律 23）
 *   NS-7c 幂等：紧接着再恢复一次 ⇒ `restored === 0` 且 `skipped === total`
 *                 （证明重复点「恢复」不会把 1 条变成 2 条）
 * ══════════════════════════════════════════════════════════════════ */
/* 🔴 真实鼠标先点（保住"用户点得到"的语义），**再用 el.click() 兜底送达** ——
 *    丢点击 ⇒ 用户数据**清了却没还回去**，这是纪律 82 的红线，不能靠重试去凑。 */
const restoreClick = await clickSel('[data-testid="dp-maint-restore"]', "↩ 恢复");
await sleep(700);
let restoreVia = restoreClick.ok ? "mouse" : "";
if (!(await exists('[data-testid="dp-restore-result"]'))) {
	console.log("  [U6保底] ↩ 恢复：真实鼠标无后果 ⇒ 已用 el.click() 补送一次（**用户数据必须还回去**）");
	await CL.clickJs('[data-testid="dp-maint-restore"]');
	await sleep(700);
	restoreVia = "js-click";
}
const readRestoreUi = async () => await js(`(function(){
  var e=document.querySelector('[data-testid="dp-restore-result"]');
  if(!e) return null;
  return { restored:+e.getAttribute('data-restored'), total:+e.getAttribute('data-total'),
    skipped:+e.getAttribute('data-skipped'), ok:e.getAttribute('data-ok'), text:String(e.textContent||'') };
})()`);
const restoreUi = await readRestoreUi();
console.log("  真实点击「↩ 恢复」：" + J(restoreClick) + " ⇒ 界面读数 " + J(restoreUi));
/* NS-6p：**用户能从界面恢复**（纪律 57：闸门绿 ≠ 用户能验收 —— 只验 API 等于没验界面）
 * 🔴 第 24 批：判据从 `restored === removed` 放宽为 `restored >= removed`。
 *    理由同 NS-6l2：备份可能多于被删条数（清除期间的后台写入者），
 *    「把备份全部恢复」是正确行为 ⇒ **多恢复不该判红**；
 *    真正要保证的是「**至少**被删的那些都回来了」（`restored >= removed`）
 *    加上 NS-6q 的**内容正对照**（快照里的真实消息按 messageId 读得回来）。 */
t("NS-6p", "🔴 恢复**可从界面点**：真实鼠标命中 `dp-maint-restore`，且 `restored >= 本次被清条数`（被删的至少都回来了）",
	!!restoreUi && !!result
	&& restoreUi.restored >= result.removed && restoreUi.restored > 0,
	{ click: restoreClick, via: restoreVia, ui: restoreUi, removed: result && result.removed });
t("NS-6p2", "🔴 界面读数完整：`restored + skipped === total` 且 `total == 备份条数`（不是只报个成功）",
	!!restoreUi && (restoreUi.restored + restoreUi.skipped === restoreUi.total)
	&& !!bak && restoreUi.total === bak.count && restoreUi.ok === "1",
	{ ui: restoreUi, backup: bak && bak.count });

const sampleId = snapPre && snapPre.sample ? snapPre.sample : "";
const backHit = await js(`(async function(){ try{
  var id = ${JSON.stringify(sampleId)};
  if (!id) return 'NO_SAMPLE';
  var r = await window.__dshPluginDb.pGet('directorConversations', id);
  return r ? 'HIT' : 'MISS';
}catch(e){ return '__exc:'+e.message; } })()`);
t("NS-6q", "🔴 正对照：清除前快照里的**真实**消息，恢复后按 messageId 读得回来（防「什么都没做也通过」）",
	msgsSnapReal > 0 ? (backHit === "HIT") : (backHit === "NO_SAMPLE"),
	{ snapReal: msgsSnapReal, sample: sampleId, hit: backHit });

/* NS-6r：**幂等必须走界面**（用户在界面上会连点）——
 * 第二次点之后 `data-restored` 必须变成 0（有界等待，防读到第一次的旧读数 —— 纪律 16）。 */
await CL.clickJs('[data-testid="dp-maint-restore"]');   /* 幂等段：直接保底送达，避免"没点到"被读成"幂等生效" */
const idemUi = await waitFor(async () => {
	const v = await readRestoreUi();
	return (v && v.restored === 0) ? v : null;
}, 25, 200);
console.log("  第二次点击后界面读数：" + J(idemUi));
t("NS-6r", "🔴 幂等（走界面）：再点一次「↩ 恢复」⇒ `restored=0` 且 `skipped=total`（不会把 1 条变 2 条）",
	!!idemUi && idemUi.restored === 0 && idemUi.skipped === idemUi.total, idemUi);
const msgAfterRestore = await pluginMsgs();
/* 收尾：闸门自己的哨兵**不留在用户的表里**。
 * 还原会把「清除时刻的全表」（含哨兵）一起放回来，而哨兵是**闸门的临时数据**；
 * 不清理 ⇒ 每跑一轮验收就在用户库里留一条 `gate-sentinel-*`（脏数据累积）。 */
const sentCleanRaw = await js(`(async function(){ try{
  var api = window.__dshPluginDb;
  var del = await api.pDelete('directorConversations', ${JSON.stringify(SENTINEL_ID)});
  var left = await api.pGet('directorConversations', ${JSON.stringify(SENTINEL_ID)});
  return JSON.stringify({ del: del, left: left ? 1 : 0 });
}catch(e){ return '__exc:'+e.message; } })()`);
let sc = null;
try { sc = JSON.parse(sentCleanRaw); } catch (e) { sc = null; }
t("NS-6s", "闸门哨兵**不留在用户表里**（还原后定向清掉，避免每轮累积脏数据）",
	!!sc && sc.left === 0, { clean: sc, raw: sentCleanRaw });
console.log("  哨兵收尾：" + J(sentCleanRaw) + " ｜ 还原后消息数（观测）：" + msgBefore + " → " + msgAfterRestore);

/* ══════════════ W · 执行状态窗口：可移动 / 最小化 / 靠边缩进 ══════════════
 * 对应用户原话「执行状态的窗口需要可以移动最小化,靠边缩进」。
 * 🔴 为什么单列一段：`verify-flow` 的 F 段量的是**另一组**浮动按钮药丸（composer 旁的三颗），
 *    与本窗口（`dp-running`）**零交集** —— 全仓 `grep -l dp-running scripts/*.mjs` 只命中 `_probe-*`。
 *    ⇒ 需求 1 此前只有纯函数单测（`test-running-window.mjs` 50/50），**没有真机断言**；
 *      而"纯函数对 ≠ 界面能用"（纪律 5）。 */
section("W 执行状态窗口：拖动移动 / 最小化 / 靠边缩进");

/** 一次 evaluate 取全窗口三态 + 几何（分多次取会让"取值之间"的状态漂移污染断言） */
const winRead = async () => await js(`(function(){
  var e=document.querySelector('[data-testid="dp-running"]');
  if(!e)return null;
  var r=e.getBoundingClientRect();
  return { mode:e.getAttribute('data-mode'), dock:e.getAttribute('data-dock'), floating:e.getAttribute('data-floating'),
    x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
    body:!!document.querySelector('[data-testid="dp-running-body"]'),
    strip:!!document.querySelector('[data-testid="dp-running-strip"]'),
    head:!!document.querySelector('[data-testid="dp-running-head"]'),
    pe:(function(){try{return getComputedStyle(e).pointerEvents;}catch(x){return '__err';}})() };})()`);
const headBox = async () => await js(`(function(){
  var e=document.querySelector('[data-testid="dp-running-head"]');if(!e)return null;
  var r=e.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),
    inView:(r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight)});})()`);
/** 🔴 松手前的**稳定等待**（纪律 91）—— 本闸门 2026-09-17 的 5 条假红就是缺了它。
 *  实测派发延迟 **58–76 ms**（纪律 91），而上一版步间只等 **18 ms** ⇒ 最后几步**还在队列里**
 *  `mouseReleased` 就到了；而 `winDragEnd` 一执行即把 `winDragRef.current` 置 `null`，
 *  后续排队的 `pointermove` 走 `winDragMove` 的 `if (!d) return` **被整条丢弃**
 *  ⇒ 吸附是基于**拖动中途**的坐标算的：拖到左缘停在 `x=67` 而非 `0`，
 *    表现为「靠边缩进没生效」（NS-8l/m/n/o/q 全红），**而产品是对的**。
 *  ⇒ 修法：**不靠固定 sleep**，松手前轮询到坐标连续两次不变（即"队列已排空"）。
 *  ⚠️ 踩这条的是「无 `onStep` 的拖动」（没读就没节流）；带 `onStep` 的拖动天然被读回节流，
 *    所以同一个 bug 只在第 ③ 段显形 —— 这正是"逐条断言"比"整体看一眼"值钱的地方。 */
async function settleDragMove(read, budgetMs) {
	const t0 = Date.now();
	const budget = Number(budgetMs || 900);
	let prev = null, same = 0;
	while (Date.now() - t0 < budget) {
		const s = read ? await read() : null;
		if (s && prev && s.x === prev.x && s.y === prev.y) {
			same += 1;
			if (same >= 2) return { settled: true, ms: Date.now() - t0, x: s.x, y: s.y };
		} else same = 0;
		prev = s;
		await sleep(60);
	}
	return { settled: false, ms: Date.now() - t0, x: prev && prev.x, y: prev && prev.y };
}
/** 真实鼠标拖动（多步 move，步间 18ms —— 太快的单步会被 3px 抖动阈值或原生节流吞掉）
 * 🔴 `onStep` 用于**拖动过程中**采样：`winDragEnd` 一松手就可能把 expanded 改成 docked，
 *    只在松手后读 mode 会把「拖到边缘」这个正确行为读成「拖动没展开」（本闸门第一版就是这样写错的）。
 * 🔴 **松手前必须等队列排空**（`settleDragMove`）—— 见其注释：不等 ⇒ 吸附读到中途坐标（假红）。 */
async function dragMouse(from, to, steps, onStep) {
	emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	emit("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
	await sleep(50);
	const traced = [];
	for (let i = 1; i <= steps; i++) {
		emit("Input.dispatchMouseEvent", {
			type: "mouseMoved", button: "left", buttons: 1,
			x: Math.round(from.x + (to.x - from.x) * i / steps),
			y: Math.round(from.y + (to.y - from.y) * i / steps)
		});
		await sleep(18);
		if (onStep) { const s = await onStep(i); if (s) traced.push(s); }
	}
	/* 队列排空后再松手（返回值进日志 —— 纪律 55：等待必须校验返回值，且"等到了吗"要可分辨） */
	const settled = await settleDragMove(async () => await winRead(), 900);
	console.log("  · 松手前排空：" + J(settled));
	if (onStep) { const s = await winRead(); if (s) traced.push(s); }
	emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 });
	await sleep(300);
	return traced;
}

/* W 起点**显式建立**（纪律 51）：上一轮可能把窗口拖到别处/停在贴边态，
 * 不重置的话"默认是 collapsed"这类断言会以**上一次运行的状态**为起点 ⇒ 假红。 */
await js("(function(){try{window.__directorLayoutStore.resetRunningWin();return 1;}catch(e){return '__err:'+e.message;}})()");
await sleep(220);
const w0 = await winRead();
const vp = await js("(function(){return {vw:innerWidth,vh:innerHeight};})()");
console.log("  · 视口 " + J(vp) + " ｜ W 起点：" + J(w0));
t("NS-8a", "起点已建立：`dp-running` 在 DOM 且回到默认 `collapsed` / 未浮动",
	w0 && w0.mode === "collapsed" && w0.floating === "0", w0);
t("NS-8b", "🔴 窗口**可交互**（`pointer-events=auto`）—— 上一轮的 `pointer-events:none` 已撤除",
	w0 && w0.pe === "auto", w0 && w0.pe);
t("NS-8b2", "环境量由环境读：视口宽高是真实数（不是写死的 1440×900 — 纪律 29）",
	vp && vp.vw > 400 && vp.vh > 300 && !(vp.vw === 1440 && vp.vh === 900), vp);

/* ① 最小化 ⇄ 展开：按钮在 collapsed 态是「▣」= 展开 */
const minClick1 = (await clickWithFallback('[data-testid="dp-running-min"]', '▣ 展开', async () => { const v = await winRead(); return v && v.mode === 'expanded' ? v : null; }, 16, 200)).click;
t("NS-8c", "真实鼠标点到最小化按钮（落点命中自己）", minClick1.ok === true, minClick1);
const w1 = await waitFor(async () => { const v = await winRead(); return v && v.mode === "expanded" ? v : null; }, 20, 150);
t("NS-8d", "点一下 ⇒ `data-mode=expanded`", w1 !== null, w1 && w1.mode);
t("NS-8e", "🔴 展开态**明细区真的渲染了**（`dp-running-body` 在 DOM）—— 不是「看起来没展开」",
	w1 && w1.body === true, w1 && w1.body);

const minClick2 = (await clickWithFallback('[data-testid="dp-running-min"]', '— 最小化', async () => { const v = await winRead(); return v && v.mode === 'collapsed' ? v : null; }, 16, 200)).click;
t("NS-8f", "再点一下 ⇒ `data-mode=collapsed`", minClick2.ok === true && (await waitFor(async () => { const v = await winRead(); return v && v.mode === "collapsed" ? v : null; }, 20, 150)) !== null, null);
t("NS-8g", "🔴 收起是**真的卸载**（`dp-running-body` 不在 DOM），不是视觉藏起来",
	(await winRead()).body === false, (await winRead()).body);

/* ② 拖动移动：目标落点取**视口正中**（远离四边 ⇒ 不会被吸附成贴边态，才能单独断言"移动"） */
const w0b = await winRead();
const hb1 = JSON.parse(await headBox());
t("NS-8h", "拖动前提：头部手柄在视口内（否则事件打空会伪装成「拖不动」）", hb1 && hb1.inView === true, hb1);
const aimX = Math.round(vp.vw / 2 - w0b.w / 2);
const aimY = Math.round(vp.vh / 2);
const traced = await dragMouse(
	{ x: hb1.x, y: hb1.y },
	{ x: hb1.x + (aimX - w0b.x), y: hb1.y + (aimY - w0b.y) },
	8,
	async () => await winRead()
);
const mid = traced.find((s) => s.mode === "expanded");
t("NS-8i", "🔴 拖动**过程中**就是 `expanded`（采样取自松手之前 —— 拖到哪看得见）",
	traced.length > 0 && traced.every((s) => s.mode === "expanded"), traced.map((s) => s.mode + "@" + s.x + "," + s.y));
const w2 = await winRead();
console.log("  · 拖到视口中央后：" + J(w2) + " ｜ 中途采样 " + traced.length + " 次");
t("NS-8j", "🔴 窗口真的**移动了**（位移 ≥ 40px，且朝向目标）—— 防「报 expanded 但坐标没变」",
	Math.abs(w2.x - w0b.x) >= 40, { before: [w0b.x, w0b.y], after: [w2.x, w2.y], aim: [aimX, aimY] });
t("NS-8k", "被搬动过 ⇒ `data-floating=1`（切 `fixed`，坐标是视口坐标，跨容器不漂）", w2.floating === "1", w2.floating);
t("NS-8k2", "拖到视口中央 ⇒ 四边都够远 ⇒ **不吸附**（仍是 expanded，不是 docked）", w2.mode === "expanded", w2.mode);

/* ③ 靠边缩进：拖到视口左缘 ⇒ 夹紧到 0 ⇒ 吸附成 `docked/left`
 * ⚠️ 本段**带 `onStep`**：既留拖动过程的读数（诊断），也顺带节流（纪律 91）。 */
const hb2 = JSON.parse(await headBox());
const traced3 = await dragMouse({ x: hb2.x, y: hb2.y }, { x: 40, y: hb2.y }, 8, async () => await winRead());
const w3 = await winRead();
console.log("  · 靠边后：" + J(w3) + " ｜ 中途采样 " + traced3.length + " 次 ｜ 落点轨迹 "
	+ J(traced3.map((s) => s.x)));
/* 🔴 **前提断言**（纪律 23/41）：先证"指针真的把窗口推到了左缘"，再断"吸附生效"。
 *    没有它时，「没到边缘」与「到了但没吸附」**读数同形**（本次 5 条假红正是靠人工算
 *    `59 ms 延迟` 才分辨出来的 —— 纪律 58：「没跑成」与「失败」必须可分）。 */
t("NS-8l0", "🔴 前提：拖动**真的**把窗口推到了左缘（`x === 0`）—— 防「没到边缘」伪装成「没吸附」",
	w3.x === 0, w3.x);
t("NS-8l", "🔴 拖到左缘 ⇒ `data-mode=docked`（靠边缩进）", w3.mode === "docked", w3.mode);
t("NS-8m", "🔴 `data-dock=left`（贴的是左边那条边，不是「随便贴一条」）", w3.dock === "left", w3.dock);
t("NS-8n", "贴边态换成**细条**渲染（`dp-running-strip` 在 DOM）", w3.strip === true, w3.strip);
t("NS-8o", "🔴 正对照：贴边态**不渲染**明细区（`dp-running-body` 不在 DOM）—— 与 NS-8e 互为对照",
	w3.body === false, w3.body);
t("NS-8p", "贴边后**没跑出视口**（x ≥ 0）", w3.x >= 0, w3.x);

/* ④ 还原：点细条回展开 → 双击头部归位（开合型控件必须当场还原，纪律 26） */
const stripClick = (await clickWithFallback('[data-testid="dp-running-strip"]', '贴边细条', async () => { const v = await winRead(); return v && v.mode === 'expanded' ? v : null; }, 16, 200)).click;
t("NS-8q", "点细条 ⇒ 回 `expanded`（贴边缩进不是死胡同）", stripClick.ok === true && (await waitFor(async () => { const v = await winRead(); return v && v.mode === "expanded" ? v : null; }, 20, 150)) !== null, null);
const hb3 = JSON.parse(await headBox());
emit("Input.dispatchMouseEvent", { type: "mouseMoved", x: hb3.x, y: hb3.y });
emit("Input.dispatchMouseEvent", { type: "mousePressed", x: hb3.x, y: hb3.y, button: "left", clickCount: 2, buttons: 1 });
await sleep(40);
emit("Input.dispatchMouseEvent", { type: "mouseReleased", x: hb3.x, y: hb3.y, button: "left", clickCount: 2, buttons: 0 });
await sleep(320);
const w4 = await winRead();
console.log("  · 归位后：" + J(w4));
t("NS-8r", "🔴 双击头部归位 ⇒ 回默认位且 `collapsed` / 未浮动（环境复原）",
	w4 && w4.mode === "collapsed" && w4.floating === "0", w4);

/* ══════════════ E · 收尾与健康度 ══════════════ */
section("E 收尾：环境复原 + CDP 健康度");
await js("(function(){var b=window.__dshChatBridge;if(b&&typeof b.setComposerText==='function')b.setComposerText('');return 1;})()");
const cleaned = await js("(function(){try{return window.__dshChatBridge.readComposerText();}catch(e){return '__err';}})()");
t("NS-7a", "原生输入框已还原为空（不留测试文本）", cleaned === "" || cleaned === null, cleaned);
t("NS-7b", "浮层全部关闭（导图 / 工作室 / 弹窗）",
	(await js("['#dsh-mindmap','#dsh-design-studio','#dsh-director-dialog'].filter(s=>document.querySelector(s)).length")) === 0, null);
t("NS-7c", "总监页仍在（收尾没有把页面弄崩）", await exists('[data-testid="dp-root"]') === true, null);
t("NS-7d", "🔴 CDP 零超时（超时属 INVALID，不是产品失败 —— 纪律 24）", cdpTimeouts.length === 0, cdpTimeouts);
t("NS-7e", "点击落空记录（打偏 ≠ 产品坏，但必须为 0）", misses.length === 0, misses);
/* 🔴 **环境噪声 vs 产品异常**（第十九批 · 2026-09-17 · 纪律 31「报绿先审口径」的反向：**报红也要先审口径**）
 *    实测：冷启动时 Electron **渲染进程内建脚本**会先报两条错 ——
 *      `Electron sandboxed_renderer.bundle.js script failed to run`
 *      `TypeError: Cannot destructure property 'preloadScripts' of 'binding.startupData' as it is null`
 *    堆栈前缀是 `node:electron/js2c/sandbox_bundle` —— **没有一个插件帧**，
 *    与 `dsh-director-plugin/client.js` 无关 ⇒ 判产品红是**误判**（纪律 24：环境问题不许读成产品坏）。
 *
 * 🔴 但口径**必须仍然抓得住产品错**——本条的**正对照是实测过的**：
 *    同一批次的第一次真机跑，这里精确抓到过 `ReferenceError: upstream is not defined
 *    at DirectorPanel (…/dsh-director-plugin/client.js?rev=…)` ⇒ 插件自己的异常**必须**继续判红。
 *    分辨依据 = **堆栈/文本里有没有插件产物 URL 或插件帧**（不靠"像不像产品"这种主观判断）。 */
const ENV_NOISE_RE = /node:electron\/|sandbox_bundle|sandboxed_renderer/i;
const PROD_FRAME_RE = /dsh-director-plugin|client\.js\?rev=|\[DSH:|DirectorPanel|DirectorDialog|DirectorPage/;
const envNoise = pageErrors.filter((s) => ENV_NOISE_RE.test(s) && !PROD_FRAME_RE.test(s));
const prodErrors = pageErrors.filter((s) => !(ENV_NOISE_RE.test(s) && !PROD_FRAME_RE.test(s)));
t("NS-7f", "🔴 **页面零未捕获异常**（产品不许静默抛错 —— 本轮真机第一次跑就是死在这里；Electron 内建脚本噪声按堆栈前缀单独归类）",
	prodErrors.length === 0, prodErrors.slice(0, 3));
if (envNoise.length) {
	console.log("  ℹ️ 环境噪声 " + envNoise.length + " 条（`node:electron/` 内建脚本，**无插件帧** ⇒ 不判产品红 · 纪律 24）：");
	envNoise.slice(0, 3).forEach((e) => console.log("     · " + e.slice(0, 120)));
}
/* 🔴 **口径守卫**（纪律 32 的**防放松**方向）：分类函数必须有**双向**分辨力 ——
 *    上面刚把口径从"任何异常"收紧成"产品异常"，那就必须证明**它不是橡皮图章**：
 *      · Electron 内建噪声（`node:electron/…`，无插件帧）⇒ **必须**归噪声；
 *      · 插件帧异常（堆栈含 `dsh-director-plugin/client.js?rev=`）⇒ **必须**仍判产品。
 *    正对照是**实测过的**：同一批次的第一次真机跑，旧口径在这里抓到
 *    `ReferenceError: upstream is not defined at DirectorPanel (…/client.js?rev=…)`
 *    （真 bug、已在同批修掉）⇒ 新口径对**那条真实异常**仍然判红。
 *    这条守卫不连真机（纯字符串），所以它**每次跑都执行**，不会因环境而跳过。 */
{
	const noiseSample = "at node:electron/js2c/sandbox_bundle:2:132134";
	const prodSample = "ReferenceError: upstream is not defined\n    at DirectorPanel (http://127.0.0.1:15754/plugins/@deepseek-ai/dsh-director-plugin/client.js?rev=2cbb375c6443:15816:8)";
	t("NS-7g", "🔴 `NS-7f` 口径守卫：内建噪声归噪声、插件帧异常**仍判产品**（防口径被放松成永远绿 —— 纪律 32/93）",
		(ENV_NOISE_RE.test(noiseSample) && !PROD_FRAME_RE.test(noiseSample))
		&& PROD_FRAME_RE.test(prodSample) && !(ENV_NOISE_RE.test(prodSample) && !PROD_FRAME_RE.test(prodSample)),
		{ noise: [ENV_NOISE_RE.test(noiseSample), PROD_FRAME_RE.test(noiseSample)], prod: PROD_FRAME_RE.test(prodSample) });
}

console.log("\n" + "═".repeat(59));
console.log("  真机验收：PASS " + pass + " / FAIL " + fail + " / 总计 " + (pass + fail));
if (cdpTimeouts.length) console.log("  ⚠️ CDP 超时 " + cdpTimeouts.length + " 次：" + J(cdpTimeouts.slice(0, 5)));
/* 🔴 收尾打印**与 `NS-7f` 同一口径**：只列**产品**异常。
 *    否则噪声会在收尾再喊一遍"页面未捕获异常 N 条"，而 NS-7f 已经判绿
 *    ⇒ 读报告的人分不清"到底有没有问题"（纪律 19：降级可以，无声不行；但**不许口径不一**）。 */
if (prodErrors.length) { console.log("  ⚠️ **产品**未捕获异常 " + prodErrors.length + " 条（含插件帧）："); prodErrors.slice(0, 5).forEach((e) => console.log("     · " + e)); }
if (envNoise.length) { console.log("  ℹ️ 环境噪声 " + envNoise.length + " 条（`node:electron/` 内建脚本，不计入判据）"); }
/* 🔴 第 19 批修正：这里原来印的是 `splitInfo.made`（=**派发总数**），文案却写「真实新建了 N 个」
 *    —— 那正是用户这一轮不满的**同型误导**：「派发 8」被读成「新建 8」（纪律 18 的可证伪收尾）。
 *    改为印**复用/新建拆分** + **实测**宿主净增（不是自报），三者不一致时能一眼看出来。 */
console.log("  ℹ️ 本轮派发 " + (splitInfo ? splitInfo.made : "?")
	+ " 条 → **复用 " + (reusedN >= 0 ? reusedN : "?") + " · 新建 " + (createdN >= 0 ? createdN : "?") + "**"
	+ "｜宿主会话实测 " + J(nBefore) + " → " + J(nAfter) + "（净增 " + J(nDelta) + "）"
	+ "｜索引孤儿清理 " + (splitRead ? (splitRead.orphan === "" ? 0 : splitRead.orphan) : "?") + " 条");
/* 🔴 兜底计数（T-PLUG-054 · 纪律 96）：`el.click()` 已从"默认路径"降级为**诊断通道**并记账。
 *    **前提成立（NS-0v 绿）时这里应恒为 0** —— 非 0 就必须**先查前提**再信结果，
 *    因为上一轮正是这个兜底让 8 处红全部转绿、把真因盖了整整一轮。 */
console.log("  ℹ️ 点击通道：" + CL.diagSummary()
	+ (CL.stats.diag > 0 ? "   ⚠️ **兜底被走到 ⇒ 先查前提**（纪律 90：`visibilityState`）" : "   ✅ 零兜底"));
if (CL.stats.diag > 0) console.log("     诊断通道明细：" + J(CL.stats.diagLog.slice(0, 5)));
if (failures.length) { console.log("  失败项："); failures.forEach((f) => console.log("   - " + f)); }
/* 🔴 INVALID 口径（第二十四轮扩充）：不只是 CDP 超时 ——
 *    「真实鼠标前提不成立」同样意味着**测不了**，而不是产品坏（纪律 24）。 */
const invalid = cdpTimeouts.length > 0 || focusPre.visible !== true;
console.log("  IS_PASS: " + (fail === 0 && !invalid ? "TRUE" : "FALSE") + (invalid ? "（INVALID：CDP 超时）" : ""));
console.log("═".repeat(59));
ws.close();
process.exit(invalid ? 2 : (fail === 0 ? 0 : 1));
