/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：「先考虑目前存在的会话」（第 19 批 · **纯函数**）
 * 引用：—
 * 上游：logic/director-dispatch.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/director-reuse.js — 「先考虑目前存在的会话」（第 19 批 · **纯函数**）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 它治的是什么（用户原话，逐字）
 * ───────────────────────────────────────────────────────────────────
 *   「现在会话有问题, 重复创建了一百多个会话,
 *     我需要的是总监确认完需求之后**先考虑目前存在的会话,然后没有才是新建会话**」
 *
 * 🔴 根因（源码逐行，不是推测）：
 *   `logic/director-dispatch.js` 第 106 行 `const cs = await createSession({});`
 *   在**维度循环体内**，之前**没有任何"这个维度是不是已经有一条会话了"的判断**。
 *   ⇒ 每派一次 = 无条件建 8 条。真机循环 ~10 次 ≈ 80 条，闸门验收每次再 +8
 *     （闸门自打印：「本轮真实新建了 8 个宿主会话（宿主无删除契约，无法回收）」）
 *   ⇒ 导图上归集出 **123 个框**（实测 `.cluster/read-C-seg.out` 的 C1–C3 三行均为 `框 123`）。
 *
 * ── 🔴 复用生效后，闸门自己也就不再制造会话 ─────────────────────────
 *   闸门 `verify-novel-split.mjs` 走的就是产品派发链。一旦派发带复用，
 *   第二、第三次跑同一部作品同一批维度时**自动接上已有的那 8 条**
 *   ⇒ 会话数**不增**。这是"一个改动封堵两个污染源"。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 匹配算法（为什么是这样，而不是"随便找一条"）
 * ───────────────────────────────────────────────────────────────────
 *   ① 候选集 = `dsh.director.split` 索引条目 **∩** 宿主现存会话（`aliveIds`）
 *      —— 只有"索引里有、宿主里也有"的才可能复用。索引有而宿主没有 = **孤儿**。
 *   ② 分组键 = `(作品名, 维度key)` —— 复用必须"同一部作品的同一个职能维度"。
 *      · 作品名可能为空（用户没给路径）⇒ 空名与空名匹配，**不与他名混**。
 *      · 用 `\0` 分隔而非 `|`：目录名里 `|` 是非法字符但**其他来源的 name 未必**，
 *        用不可见字符可彻底排除"name 含分隔符导致跨组误配"。
 *   ③ 同组多条 ⇒ **取 `at` 最新**。
 *      理由：用户要的是"接着上次干"。最老的那条多半是早期脏数据
 *      （第 18 批真机里模型零输出的 `partial`），接上去等于**接脏**。
 *   ④ 同批次内一个会话**只接一个维度**（`used` 集合）。
 *   ⑤ **`aliveKnown === false` 一律 `create` + `why:"alive-unknown"`** ——
 *      读不到宿主存活集时**不许**假设"都在"（会复用幽灵）也**不许**假设"都没有"
 *      （会静默累积，正是本条需求要治的病）；如实报降级，由上层决定是否提示
 *      （纪律 19：降级可以，无声不行）。
 *
 * ── 纯函数 ──────────────────────────────────────────────────────────
 *   无 DOM、无 store、无时钟（`at` 只读不写）、不改入参。同输入必同输出
 *   ⇒ 可离线单测，也是 UI 与闸门共用的**同一份判据**。
 */

/** 分组分隔符：不可见，避免 name 含 `|` 等字符时跨组误配 */
const SEP = "\u0000";

/**
 * 标题归一化（**弱匹配**的第一步）：去首尾空白、把全角空格与连续空白压成一个半角空格。
 * 🔴 为什么必须归一化：宿主对标题做过展示层处理（有可能压空白、也可能保留原文），
 *    而 `branchTitle()` 里带「」与书名号 ⇒ 只差一个空格的"看起来相等"会**静默漏匹配**
 *    （纪律 27：「看起来相等」≠「同源」）。
 */
function titleKey(t) {
	return String(t == null ? "" : t).replace(/[\u3000\s]+/g, " ").trim();
}

/** 分组键 `作品名 \0 维度key` */
function keyOf(name, dim) {
	return String(name == null ? "" : name) + SEP + String(dim == null ? "" : dim);
}

/**
 * 🔴 第 36 轮：**项目级归一化**（复用兜底的第三层，也是真正止血的一层）
 *
 * ── 它治的是什么（用户原话 + 实测数据）────────────────────────────────
 *   「对话越加越多了，这个不合理，不应该加那么多会话。」
 *   实测（`_probe-session-census`，只读）：宿主 **26** 条会话、归档 **0** 条
 *   ⇒ **不是脏数据没清，是 26 条全是真建的**；而复用索引 `splitIndexN = 0`。
 *   标题样本：`墟海项目分线推进` / `《墟海》项目分线推进` / `《墟海》多维度创作推进`
 *   / `墟海小说正文写作与多维推进` / `墟海项目多维度推进` —— **同一个项目，因为用户
 *   每次措辞不同，被逐字匹配判成 5 个不同需求 ⇒ 建了 5 条**。
 *
 * ── 为什么前两层救不了 ────────────────────────────────────────────────
 *   ① 索引层：`dsh.director.split` 在 `localStorage`，而 **origin 含端口**、
 *      宿主每次启动端口都变 ⇒ 冷启动后索引**必然为空**（这是环境事实，改不掉）。
 *   ② 标题前缀层：`want = briefTitlePrefix()`（形如 `【A1 世界观】《墟海》`），
 *      而宿主标题是**用户首条消息**的自由文本 ⇒ 不以该前缀开头 ⇒ 恒 0 命中。
 *   ⇒ 两层都 miss 就 `create`，于是每派一次就多 N 条。
 *
 * ── 判据为什么是「归一化后 contains」而不是别的档位 ──────────────────
 *   · 全等  ⇒ 回到第 ② 层的死路（措辞一变就不等）。
 *   · 前缀  ⇒ `墟海项目分线推进` 不以 `墟海` 之外的任何固定前缀开头，同样恒 miss。
 *   · `includes`（未归一化）⇒ 书名号/全角空格/大小写会让 `《墟海》` 匹配不上 `墟海`。
 *   ⇒ 先**归一化**（去《》「」【】()与全部标点空白 → 小写），再 `contains`。
 *   ⚠️ 长度下限 **2**：单字项目名（如「海」）会命中几乎所有标题 ⇒ 误配比新建更糟
 *      （简报投给无关会话；第 25 批已定性"投错维度比多建一条严重"）。
 *
 * 纯函数：无 DOM / 无 store / 无时钟。
 */
function normProject(t) {
	return String(t == null ? "" : t)
		.replace(/[《》「」『』【】\[\]()（）""'']/g, "")
		.replace(/[\u3000\s·、,，.。!！?？:：;；~～\-_/\\|]+/g, "")
		.toLowerCase();
}

/**
 * 第三层的**两道安全闸**（🔴 缺一不可，否则会撞翻既有负对照 RU-T2 / RU-T3）
 *
 * 松匹配天生有"投错对象"的风险，而本项目已定性：**投错维度比多建一条会话糟得多**。
 * 所以兜底**不是**"同项目就随便接"，而是只接**没有相反证据**的会话：
 *
 *  ① **书名边界闸**：会话标题里若出现《X》，则 `X` 必须与本次作品名**相等**。
 *     ⇒ `《灵能修仙传》` 不会被当成 `《灵能修仙》`（保住 RU-T3 —— 那是**另一本书**）。
 *  ② **维度代码闸**：标题里若出现维度代码（`A10` 这类），则必须与本维度一致。
 *     ⇒ `【A10 配角】…` 不会被当成 `A1 世界观`（保住 RU-T2 —— 那是**另一个维度**）。
 *
 * 两条都**只在"标题给了明确证据"时才否决**；标题是自由文本（如 `墟海项目分线推进`）
 * 时不含相反证据 ⇒ 允许按项目名复用。这正是用户要的"同一项目别再建新的"，
 * 同时不牺牲"不许投错"这条更硬的原则。
 */
function bookOf(t) {
	const m = /《([^》]*)》/.exec(String(t == null ? "" : t));
	return m ? normProject(m[1]) : "";
}
function dimCodeOf(t) {
	const m = /(?:^|[^A-Za-z0-9])([Aa]\s?\d{1,2})(?![A-Za-z0-9])/.exec(String(t == null ? "" : t));
	return m ? m[1].replace(/\s+/g, "").toLowerCase() : "";
}

/**
 * 派发前的**复用决策**（纯函数）。
 *
 * @param {Array<{key:string,label?:string}>} dims 本次要派的维度（`plan().dims`）
 * @param {object} ctx
 * @param {Object<string,{dim:string,label:string,name:string,at:number}>} ctx.index
 *        `dsh.director.split` 读出的索引（`readSplitIndex()`）
 * @param {Array<string>} ctx.aliveIds 宿主**现存**会话 id（`rawSessionSummaries().map(s=>s.id)`）
 * @param {string} [ctx.name] 作品名（可空；空名只与空名匹配）
 * @param {boolean} [ctx.aliveKnown=true] 存活集是否**可信**；显式传 `false` ⇒ 全部新建并报降级
 * @param {Array<{sessionId:string,title:string,at?:number}>} [ctx.hostTitles] 宿主会话**现有标题**
 *   （19 号文 **P9 / U10** 落点，可选）
 *   🔴 为什么需要它：分流索引存在 `localStorage`，而 **origin 含端口** ⇒
 *      宿主每次启动端口都变 ⇒ **冷启动后索引必然为空**（`indexN:0 / hostSessions:74`）
 *      ⇒ 首次派发**必然重建全部 N 条**（真机实测 `run01 +8` / `run04 +3`）。
 *      宿主自己的会话列表是**跨启动保留**的，故退一步按**标题**弱匹配。
 * @param {Object<string,string>} [ctx.wantTitles] `{ 维度key: 期望标题 }`（**必与 `branchTitle()` 同源**）
 *   由调用方算好传进来 —— 本模块**不** import `split-dimensions`（避免依赖方向反转），
 *   而"期望标题"必须与真正写进宿主的那一个**是同一个函数产出的**，否则是两份真相。
 *   ⚠️ 没传 / 该维度没有期望标题 ⇒ **不做**标题匹配（保持旧行为），并在 `titleMissed` 里报数。
 * @returns {{
 *   decisions:Array<{dim:string,label:string,action:"reuse"|"create",sessionId:string|null,why:string,at:number}>,
 *   reuse:number, create:number, aliveKnown:boolean, degraded:boolean,
 *   orphans:Array<string>, orphanKeys:Array<string>, surplus:Array<string>,
 *   picked:Object<string,string>
 * }}
 */
export function planReuse(dims, ctx) {
	const o = ctx && typeof ctx === "object" ? ctx : {};
	const list = Array.isArray(dims) ? dims : [];
	const index = o.index && typeof o.index === "object" ? o.index : {};
	/* 默认可信（调用方只在**确认读不到**时显式传 false）——
	 * 默认 false 会让"没传参数"变成静默降级，那是无声失败。 */
	const aliveKnown = o.aliveKnown !== false;
	const aliveArr = Array.isArray(o.aliveIds) ? o.aliveIds : [];
	const alive = new Set();
	for (let i = 0; i < aliveArr.length; i++) {
		if (aliveArr[i] == null || aliveArr[i] === "") continue;
		alive.add(String(aliveArr[i]));
	}
	const name = String(o.name == null ? "" : o.name);
	const wantTitles = o.wantTitles && typeof o.wantTitles === "object" ? o.wantTitles : null;
	/* ── 🔴 U10（P9）：宿主标题池（**前缀**匹配）──────────────────────────
	 * 只在**存活集可信**时构建（读不到存活集时连"谁还在"都不知道，
	 * 按标题匹配等于凭空造会话；纪律 19：此时如实报降级，不猜）。
	 *
	 * 🔴 为什么判据是**前缀**而不是全等（第 25 批实测更正，19 号文 U10/P9 的真因）：
	 *   宿主把**首条消息的首行**当会话标题 ⇒ 宿主标题 = `briefOf()` 的 head 打头
	 *   （实测 `【A1 世界观】《灵能修仙》 —— …`）。上一版拿 `branchTitle()` 去全等比 ——
	 *   它产出 `「A1 世界观」《灵能修仙》`（**角括号**，head 用的是**方头括号**）
	 *   ⇒ 连字形都不同 ⇒ 恒 0 命中。拿"看起来一样"的另一个串当判据，是本项目
	 *   纪律 27 的同型事故，**不是匹配器少写了个 `includes`**。
	 *   `wantTitles[dim]` 现在传 `briefTitlePrefix()` 的产物（与 head **同源**）。
	 *
	 *   · 前缀**自带边界**（不需要另写"边界字符"规则，少一条规则少一处漂移）：
	 *     `【A10 配角】…` 不以 `【A1 世界观】` 开头；`《灵能修仙传》` 不以 `《灵能修仙》` 开头
	 *     —— 两个方向的误配都被收尾的 `】` / `》` 封死。
	 *   · 同前缀多条（同一维度跑过很多轮）⇒ 取 `at` **最新**：重复派发应接着**最近那条**
	 *     线程，回到最老的会把最新上下文丢掉。排序口径与 `groups` 一致（不另立一套）。
	 *   · 命中后可用的**只剩下"未被本批占用"的**——一次派发 8 个维度必须落在 8 条不同会话上。 */
	const titlePool = [];
	if (aliveKnown && wantTitles && Array.isArray(o.hostTitles)) {
		for (let i = 0; i < o.hostTitles.length; i++) {
			const h = o.hostTitles[i];
			if (!h || !h.sessionId) continue;
			const sid = String(h.sessionId);
			if (!alive.has(sid)) continue;
			const tk = titleKey(h.title);
			if (!tk) continue;
			titlePool.push({ sessionId: sid, key: tk, at: Number(h.at) || 0 });
		}
		titlePool.sort((a, b) => b.at - a.at);
	}
	/** 本批次**有几条是靠宿主标题救回来的**（> 0 ⇒ 冷启动兜底真的起作用；读数见返回值） */
	let titleHitAny = false;
	let titleHits = 0;

	/* ── ① 索引条目分桶：存活 ⇒ 按 (name,dim) 入组；不存活 ⇒ 孤儿 ──
	 *
	 * 🔴🔴 `aliveKnown === false` 时**整个分桶都不做** —— 这不是优化，是**防事故**：
	 *    "读不到宿主会话列表"与"宿主里真的没有会话"在数据上**都表现为 alive 为空集**。
	 *    若照常分桶，读不到时会把**索引里每一条存活的会话都判成孤儿**，
	 *    而上游 `director-dispatch.js` 会对孤儿调 `forgetSplits()`
	 *    ⇒ **一次读取失败就清空整份复用索引**，下次派发全部新建，
	 *    反而把"重复创建会话"这个要治的病**放大**。
	 *    （本缺陷由 `scripts/test-director-reuse.mjs` 的 `RU-12` 正负对照抓出 —— 纪律 23：
	 *     每条断言都要问"反例上会不会也通过"，这次是反过来问"降级路径会不会更糟"。） */
	const groups = {};
	const orphans = [];
	const allKeys = {};
	if (aliveKnown) {
		for (const sid of Object.keys(index)) {
			const e = index[sid];
			if (!e || typeof e !== "object") continue;
			const k = keyOf(e.name, e.dim);
			allKeys[k] = true;
			if (!alive.has(String(sid))) { orphans.push(String(sid)); continue; }
			if (!groups[k]) groups[k] = [];
			groups[k].push({ sessionId: String(sid), at: Number(e.at) || 0 });
		}
	}
	/* ── ② 组内按 `at` 降序（最新优先；`at` 缺失时记 0 排最后，顺序稳定）── */
	for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.at - a.at);

	const orphanKeys = [];
	for (let i = 0; i < orphans.length; i++) {
		const e = index[orphans[i]];
		const k = e ? keyOf(e.name, e.dim) : "";
		if (k && orphanKeys.indexOf(k) < 0) orphanKeys.push(k);
	}

	/* ── ③ 逐维度决策 ── */
	const used = new Set();
	const decisions = [];
	const surplus = [];
	const titleMissed = [];
	const picked = {};
	/* 第 36 轮：项目级兜底（第三层）。`projectFallback: false` 可显式关掉（闸门负对照用） */
	const projKey = normProject(name);
	const projFallback = o.projectFallback !== false && projKey.length >= 2;
	let projectHits = 0;
	for (let i = 0; i < list.length; i++) {
		const d = list[i] && typeof list[i] === "object" ? list[i] : {};
		const dim = String(d.key == null ? "" : d.key);
		const label = String(d.label == null ? "" : d.label);
		const k = keyOf(name, dim);
		if (!aliveKnown) {
			decisions.push({ dim, label, action: "create", sessionId: null, why: "alive-unknown", at: 0 });
			continue;
		}
		const cands = groups[k] || [];
		let pick = null;
		for (let j = 0; j < cands.length; j++) {
			if (!used.has(cands[j].sessionId)) { pick = cands[j]; break; }
		}
		if (pick) {
			used.add(pick.sessionId);
			picked[k] = pick.sessionId;
			decisions.push({ dim, label, action: "reuse", sessionId: pick.sessionId, why: "index-hit", at: pick.at });
			/* 同组未被选中的存活条目 = **多余的**（不是删，只报告，供清理入口用） */
			for (let j = 0; j < cands.length; j++) {
				const sid = cands[j].sessionId;
				if (sid !== pick.sessionId && surplus.indexOf(sid) < 0) surplus.push(sid);
			}
		} else {
			/* 原因必须**可分辨**（纪律 18）：
			 *   · `already-used`  —— 同组有存活候选但已被本批次别的维度占了
			 *   · `orphan-only`   —— 索引里**只有**该键的孤儿（宿主已删 ⇒ 索引该清理）
			 *   · `no-match`      —— 索引里根本没有这个 (作品,维度)
			 * 三者对用户的含义完全不同：前两者要清索引，后者是第一次派。
			 * 🔴 19 号文 **U10 / P9**：**只有 `no-match`** 才退一步做标题弱匹配 ——
			 *    前两类是"索引里有、只是用不上"（该清索引），拿标题去补会把它们**糊过去**。
			 *    ⚠️ 判据 = **归一化后前缀**（不是全等，也不是 `includes`）：
			 *      全等 ⇒ 恒 0 命中（宿主标题 = head + 简报正文，见上方 titlePool 注释）；
			 *      `includes` ⇒ `【A1 世界观】` 会命中 `【A10 …】`，且拿正文里的任意片段
			 *      也能命中别的维度 ⇒ **简报投给别的维度**，比多建一条会话糟得多。
			 *      前缀 + 自带边界（`】`/`》`）是这两者之间唯一的正确档位。 */
			let why = cands.length ? "already-used" : (allKeys[k] ? "orphan-only" : "no-match");
			let titlePick = null;
			const want = wantTitles ? titleKey(wantTitles[dim]) : "";
			if (why === "no-match" && want) {
				for (let j = 0; j < titlePool.length; j++) {
					const h = titlePool[j];
					if (used.has(h.sessionId)) continue;
					if (h.key.indexOf(want) === 0) { titlePick = h; break; }
				}
			}
			/* ── 第三层：**项目级归一化兜底**（第 36 轮 · 见 `normProject()` 头注）─────
			 * 只在**前两层都 miss** 时使用（`no-match` 且标题前缀没命中），
			 * 且不覆盖 `already-used` / `orphan-only` —— 那两类该清索引，不该拿项目名糊过去。
			 * 命中判据 = 归一化后 `contains`，长度下限 2（单字会误配，见头注）。
			 * 同会话只接一个维度（`used`），取 `at` 最新（titlePool 已按 at 降序）。 */
			let projectPick = null;
			if (!titlePick && why === "no-match" && projFallback) {
				const wantBook = want ? bookOf(want) : "";
				const wantCode = want ? dimCodeOf(want) : "";
				for (let j = 0; j < titlePool.length; j++) {
					const h = titlePool[j];
					if (used.has(h.sessionId)) continue;
					const hk = normProject(h.key);
					if (!hk || hk.indexOf(projKey) < 0) continue;
					/* 闸①：标题自带书名 ⇒ 必须与本次作品名**相等**（《灵能修仙传》≠《灵能修仙》） */
					const hb = bookOf(h.key);
					if (hb && hb !== projKey) continue;
					if (wantBook && hb && hb !== wantBook) continue;
					/* 闸②：标题自带维度代码 ⇒ 必须与本维度一致（A10 ≠ A1） */
					const hc = dimCodeOf(h.key);
					if (hc && wantCode && hc !== wantCode) continue;
					projectPick = h;
					break;
				}
			}
			if (titlePick) {
				used.add(titlePick.sessionId);
				picked[k] = titlePick.sessionId;
				titleHitAny = true;
				titleHits += 1;
				decisions.push({ dim, label, action: "reuse", sessionId: titlePick.sessionId, why: "title-hit", at: titlePick.at });
			} else if (projectPick) {
				used.add(projectPick.sessionId);
				picked[k] = projectPick.sessionId;
				titleHitAny = true;
				projectHits += 1;
				decisions.push({ dim, label, action: "reuse", sessionId: projectPick.sessionId, why: "project-hit", at: projectPick.at });
			} else {
				if (why === "no-match" && wantTitles) titleMissed.push(dim);
				decisions.push({ dim, label, action: "create", sessionId: null, why, at: 0 });
			}
		}
	}

	let reuse = 0;
	for (let i = 0; i < decisions.length; i++) if (decisions[i].action === "reuse") reuse += 1;
	return {
		decisions,
		reuse,
		create: decisions.length - reuse,
		aliveKnown,
		degraded: !aliveKnown,
		orphans,
		orphanKeys,
		surplus,
		picked,
		/* 🔴 U10 / P9 读数（纪律 19：降级可以，无声不行）——
		 * `titleHit`：本批次**有几条是靠宿主标题救回来的**（> 0 说明冷启动兜底真的起作用了）；
		 * `titleMissed`：索引没命中**且标题也没匹配上**的维度（那才是"确实要新建"）；
		 * `titlePoolN`：参与匹配的宿主标题条数 —— **0 命中时靠它分辨两种含义**
		 *   （"宿主标题形态变了"还是"根本没读到标题"），否则只能靠猜（纪律 60）。 */
		titleHit: titleHitAny,
		/* **靠标题救回来的条数**（不是布尔）—— 上游据此决定"索引要补登记几条"：
		 * 标题命中的那几条**不在索引里**（索引在冷启动时是空的），必须补进索引，
		 * 否则导图拿不到插件侧标签、下次派发还得靠标题兜底（第 25 批实测补的实际缺口）。 */
		titleHits,
		titleMissed,
		titlePoolN: titlePool.length,
		/* 第 36 轮：**靠项目名救回来的条数**（第三层）。与 `titleHits` 分列，
		 * 因为两者的**可信度不同**：title-hit 是同维度精确前缀，project-hit 只是同项目。
		 * 界面/闸门要能分辨"复用得准"与"复用得松"，否则"复用 5 条"可能全是松匹配。 */
		projectHits
	};
}

/**
 * 该维度对应的**总监角色名**（纯函数）—— 「每个会话都有自己的总监」的命名来源。
 *
 * 复用 `SPLIT_DIMENSIONS` 的 `label`（形如 `A1 世界观`）⇒ 角色名 `A1 世界观 总监`。
 * 🔴 不新造一套命名表：维度名与导图标签、简报抬头用的是**同一个** `label`，
 *    三处同源才不会出现"导图叫 A1 世界观、档案叫世界观总监、简报叫 world"的三口径。
 *
 * @param {{key?:string,label?:string}|null} dim
 * @returns {string} 角色名；取不到 label 时退化为通用 `"总监"`（**不编**具体职能名）
 */
export function directorRoleOf(dim) {
	const d = dim && typeof dim === "object" ? dim : {};
	const label = String(d.label == null ? "" : d.label).trim();
	if (!label) return "总监";
	return /总监$/.test(label) ? label : label + " 总监";
}

/**
 * 本轮派发的**一句话摘要**（纯函数，供读数与总监消息流共用同一句）。
 *
 * 🔴 「复用了几条」必须**显式出现**：用户这一轮的全部不满就来自"看不见它在重复建"。
 *    只报 `made=8` 与"复用 6 + 新建 2"在界面上完全不同 —— 后者才让人敢再点一次。
 *
 * @param {{reuse:number,create:number,aliveKnown?:boolean,orphans?:Array,surplus?:Array}} plan
 * @returns {string}
 */
export function reuseSummary(plan) {
	const p = plan && typeof plan === "object" ? plan : {};
	const reuse = Number(p.reuse) || 0;
	const create = Number(p.create) || 0;
	const orphanN = Array.isArray(p.orphans) ? p.orphans.length : 0;
	const surplusN = Array.isArray(p.surplus) ? p.surplus.length : 0;
	const parts = ["复用已有 " + reuse + " 条", "新建 " + create + " 条"];
	/* 第 36 轮：复用的**质量**也要看得见 —— 精确命中 vs 项目级松命中不是一回事 */
	const projN = Number(p.projectHits) || 0;
	if (projN) parts.push("（其中 " + projN + " 条为同项目兜底复用）");
	if (orphanN) parts.push("索引孤儿 " + orphanN + " 条（宿主已无此会话，建议清理索引）");
	if (surplusN) parts.push("同维度多余 " + surplusN + " 条（可选清理）");
	if (p.aliveKnown === false) parts.push("⚠ 读不到宿主会话列表 ⇒ 本次全部新建（降级，未做复用判断）");
	return parts.join(" · ");
}
