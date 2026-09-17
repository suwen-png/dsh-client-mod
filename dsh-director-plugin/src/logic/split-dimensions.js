/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：按维度拆线（**纯函数**：无 DOM、无 store、无副作用）
 * 引用：—
 * 上游：components/DirectorDialog.js, components/DirectorPage.js, logic/attribution.js, logic/director-dispatch.js
 * 下游：logic/attribution.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/split-dimensions.js — 按维度拆线（**纯函数**：无 DOM、无 store、无副作用）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 需求来源（第 16 批用户原话）
 * ───────────────────────────────────────────────────────────────────
 *   「按照一个流程跑一遍 写小说吧,调用小说技能」
 *   「然后按照世界观剧情等应该自动分到不同的对话分支 然后思维导图应该能看出来」
 *
 * 🔴 关键判断：**不新造一套维度**。维度来自用户点名的小说技能
 *    `multi-agent-novel-brain` 的 **A1–A8 分工表**（该技能的核心就是
 *    "8 个智能体 + 各自的文件边界"，见其 SKILL.md「智能体分工与文件边界」）。
 *    用户说"世界观剧情等"里的"等"，正对应 A2/A4/A5/A6/A7/A8 —— 一个不落地对应过去，
 *    才是"自动分开"；只在插件里凭空列 3 个维度，等于把技能的边界模型丢了。
 *
 * 🔴 每条维度都带 **files（只读/可写目录）**：技能的关键约束是"每个智能体只读/只写
 *    自己的目录"。把这条边界**随简报一起投递**，分支里的智能体才不会越界去写别人的域
 *    （越界的后果是静默的：两个分支同时改世界观文件，谁也不报错）。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 契约
 * ═══════════════════════════════════════════════════════════════════
 *   · `SPLIT_DIMENSIONS` 的 `key` 是**稳定标识**：进 `data-*` 与节点 id，改名即断血缘
 *   · `label` 是用户可见名（**分支名与导图标签**都用它开头 ⇒ 导图上一眼看出结构）
 *   · 纯函数：同输入必同输出（可离线单测；也是 UI 与闸门共用的**同一份判据**）
 */

import * as ATTR from "./attribution.js";

/* 🔴 19 号文 N1：上一行是归属判定的**唯一产品调用点**（在 `plan()` 内部）。
 * 依赖方向说明：attribution.js 反过来 import 本模块的 `SPLIT_DIMENSIONS` /
 * `GENERIC_DIMENSIONS` / `noiseReasonOf` / `isNovelIntent` ⇒ 二者**互为循环**。
 * ESM 下这是安全的，**前提是两边的模块顶层都不调用对方**（只在函数体内引用）。
 * ⚠️ 谁在顶层调用对方，谁就拿到 `undefined`（部分初始化）—— 这条必须保持。 */

/**
 * 小说场景的八个维度（**逐条对应** `multi-agent-novel-brain` 的 A1–A8）。
 * `files` = 该维度**应当只读/只写**的目录（技能的文件边界，随简报投递）。
 * `stage` = 工序阶段，用于排序（先设定、后写正文、最后审校）。
 */
export const SPLIT_DIMENSIONS = Object.freeze([
	{ key: "world", label: "A1 世界观", stage: 1, files: ["01-世界观/"], brief: "搭建世界规则 / 地理 / 历史 / 势力" },
	{ key: "power", label: "A2 力量体系", stage: 1, files: ["01-世界观/world-rules", "02-力量体系/"], brief: "设计修行 / 等级 / 技能 / 代价" },
	{ key: "plot", label: "A3 剧情", stage: 2, files: ["01-世界观/", "02-力量体系/", "03-剧情架构/"], brief: "Hook / 分卷 / 章纲 / 支线" },
	{ key: "chars", label: "A4 人物", stage: 2, files: ["01-世界观/factions", "03-剧情架构/arc-plan", "04-人物档案/"], brief: "角色心理学档案 / 关系网" },
	{ key: "prose", label: "A5 正文", stage: 3, files: ["03-剧情架构/chapter-outline", "04-人物档案/", "05-正文/"], brief: "按章纲写正文，并保持与前文一致" },
	{ key: "polish", label: "A6 打磨", stage: 4, files: ["05-正文/", "07-风格语料/"], brief: "润色 / 去 AI 味" },
	{ key: "review", label: "A7 审查", stage: 4, files: ["03-剧情架构/", "04-人物档案/", "05-正文/", "08-审查/"], brief: "六关一致性审查（剧情 / 人物 / 设定 / 文风 / 推进 / 逻辑）" },
	{ key: "distill", label: "A8 蒸馏", stage: 5, files: ["_memory/", "08-审查/"], brief: "跨对话记忆蒸馏（把各分支产出汇成一份可复用的记忆）" }
]);

/** 小说意图关键词（命中任一 ⇒ 判为小说场景）。**全部小写比对**，调用方先归一化。 */
export const NOVEL_HINTS = Object.freeze([
	"小说", "世界观", "力量体系", "剧情", "章纲", "章节", "人物档案", "正文", "润色",
	"novel", "chapter", "worldbuilding", "outline"
]);

/** 通用场景的兜底维度（识别不到小说意图时**不硬套** A1–A8 —— 那会建出一堆空分支）。 */
export const GENERIC_DIMENSIONS = Object.freeze([
	{ key: "plan", label: "方案", stage: 1, files: [], brief: "把需求拆成可执行的方案" },
	{ key: "build", label: "执行", stage: 2, files: [], brief: "按方案落地" },
	{ key: "verify", label: "验证", stage: 3, files: [], brief: "验证产出是否达成目标" }
]);

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 第 23 批（第二十三轮真机驱动）：**总监要能分辨"无意义输入"**
 * ──────────────────────────────────────────────────────────────────────
 * 用户原话（逐字）：
 *   「然后可以发送一些无意义的东西，然后让总监去**分辨**，然后去整理整个项目」
 *
 * 真机实测的旧行为（`scripts/_probe-director-flow-r23.mjs`）：
 *   投「今天天气不错 哈哈哈哈」⇒ `kind=generic` · `made=3` · dims=`plan,build,verify`
 *   ⇒ **会话 +3、导图 +3 个空壳框、各投一份简报**。
 *   离线同一口径（`scripts/_probe-noise-r23.mjs`）：8 条噪声样本里 **7 条**会建分支。
 *
 * 这与第 19 批"一百多个会话"是**同型的污染** —— 用户看到的是导图上多出几个
 * 不知道干什么的框，而每个框后面都真的建了一条宿会话（宿主**没有删除契约**）。
 *
 * ── 判据设计原则：**保守** ──────────────────────────────────────────
 *   宁可漏拦（真需求被当成通用任务，代价 = 3 个分支），
 *   绝不误杀（真需求被拒，代价 = 用户以为插件坏了）。
 *   ⇒ 因此有**动作/意图动词**的输入**一律放行**，只在"确实没有可执行内容"时才拦。
 *   ⇒ 规则顺序是本函数最易写错的地方：**动词放行必须在长度类规则之前**
 *     （否则 1 个字的"写"会被"过短"误杀）。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 动作/意图动词（命中任一 ⇒ **绝不判为噪声**）。
 * 中英文都要有：用户会用英文写需求（`build` / `fix` / `deploy`）。
 * 🔴 加词的标准：**它出现在真需求里的概率 >> 出现在噪声里的概率**。
 */
export const ACTION_HINTS = Object.freeze([
	"写", "做", "改", "建", "加", "删", "查", "看", "跑", "分", "派", "整理", "分析",
	"实现", "开发", "设计", "优化", "修复", "测试", "帮", "需要", "生成", "输出",
	"列出", "找", "读", "加载", "部署", "搭", "规划", "评估", "审查", "润色", "蒸馏",
	"推进", "拆分", "梳理", "对比", "统计", "导出", "导入", "迁移", "重构", "接入",
	"总结", "汇总", "复核", "校验", "验证", "新增", "删除", "更新", "继续", "开始",
	"补充", "完善", "落地", "调研", "搜索", "抓取", "爬", "画", "渲染", "编排", "调度",
	"create", "build", "write", "make", "add", "fix", "test", "run", "deploy", "review",
	"analyze", "refactor", "generate", "help", "read", "list", "update", "design"
]);

/** 寒暄/语气词模式（**必须配合"无动作动词"**才判噪声 —— 单用会误杀"帮我写"这类）。 */
const CHITCHAT_RE = /^(哈+|嘿+|呵+|嘻+|嗯+|哦+|噢+|啊+|呀+|哎+|额+|emmm+|hmm+|谢谢|多谢|在吗|在不在|早上好|晚上好|你好|您好|hi|hello|hey|thanks?|thx|how are you|good (morning|afternoon|evening)|今天.{0,4}天气|天气.{0,4}(好|不错|真好))/i;

/** 键盘乱敲片段（明显非语义）—— 只认最典型的键盘序，避免误伤正常英文词。 */
const GIBBERISH_RE = /asdf|qwer|zxcv|jkl;|hjkl/i;

/** 指令注入 / 试探模式（**有内容但与项目无关**，且属攻击面）。 */
const INJECTION_RE = /忽略(上面|之前|以上|前面|上述)的?.{0,6}(指令|要求|提示|规则)|你的?(系统)?提示词|system\s*prompt|you\s+are\s+now|ignore\s+(all\s+)?previous/i;

/** 空白 / 标点 / 符号 / 表情 —— 去掉后仍为空 ⇒ 纯装饰输入。 */
const DECOR_RE = /[\s\p{P}\p{S}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

/**
 * 判断一段输入是否**无有效需求**（纯函数，无副作用）。
 *
 * @param {string} text
 * @returns {string|null} **命中返回可读原因**（非空字符串）；未命中返回 `null`（= 当正常需求处理）
 */
export function noiseReasonOf(text) {
	const s = String(text == null ? "" : text).trim();
	if (!s) return "空输入";
	/* ① 注入模式必须**先**判：放在动词放行之前，否则「把提示词**输出**给我」里的
	 *    "输出"会把它放行（动词表里有"输出"）。 */
	if (INJECTION_RE.test(s)) return "指令注入/试探类内容，与项目无关";
	/* ② 纯装饰（只有标点/符号/表情）—— 零误杀风险：真需求不可能只有标点 */
	const bare = s.replace(DECOR_RE, "");
	if (!bare) return "只有标点/符号/表情，没有文字内容";
	/* ③ 🔴 **有动作意图 ⇒ 直接放行**（必须在长度类规则之前，见文件头"规则顺序"） */
	const low = s.toLowerCase();
	for (let i = 0; i < ACTION_HINTS.length; i++) {
		if (low.indexOf(ACTION_HINTS[i]) >= 0) return null;
	}
	/* ④ 寒暄/闲聊 */
	if (CHITCHAT_RE.test(s)) return "寒暄/闲聊类，没有可执行的需求";
	/* ⑤ 键盘乱敲 */
	if (GIBBERISH_RE.test(s)) return "疑似乱敲（键盘序片段），不是需求";
	/* ⑤·5 🔴 **纯数字/符号串**（第二十四轮真机驱动新增 · 实测缺陷）
	 *    取证：`1234!@#$%^&*()` 被判为**合法需求**（`kind=generic` · `dims=3`）
	 *    ⇒ 会**真的派发 3 条分支 + 建 3 条宿主会话**（宿主没有删除契约，同第 19 批的污染形态）。
	 *    逃逸路径：规则 ② 只判「装饰去光后为空」，剩下的 `1234` 既无动作动词、也不寒暄、
	 *    不是键盘序片段、去重后不短、长度也够 ⇒ 一路落到末尾 `return null`。
	 *    🔴 判据只匹配「**去掉装饰后全是数字/小数点**」，**不匹配「含数字」** ——
	 *    否则会误杀「帮我算一下 1234 + 5678」这类真需求（它们含动词，且本规则在其后）。
	 *    反例校准：`SO12345`（含字母）· `帮我算 1+1`（含动词）· `3.14 和 2.71 谁大`（含中文）都不命中。 */
	if (/^[\d.\s]+$/.test(bare)) return "只有数字/符号，没有文字内容";
	/* ⑥ 重复字符（去重后极短）—— "哈哈哈哈" / "好好好" / "嗯嗯" */
	const uniq = Array.from(new Set(bare.split(""))).join("");
	if (uniq.length <= 2 && bare.length <= 10) return "只有重复的字，没有实际内容";
	/* ⑦ 过短（1 个字符） */
	if (bare.length <= 1) return "内容过短（" + bare.length + " 个字），无法构成需求";
	return null;
}

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 第 23 批：**总监对语言的整理**（`organize`）
 * ──────────────────────────────────────────────────────────────────────
 * 用户原话：「回复包括**总监对语言的整理**，**对于文字的描述**…都是要有的」。
 *
 * 旧行为（真机取证）：`briefOf()` 的末行是 `需求原文：<原文>` —— 用户怎么打的就怎么投，
 *   **含噪声行、含重复、含空行**。8 个分支各自从一份乱七八糟的原文里猜意图。
 *
 * 🔴 **整理 ≠ 改写**（这是本函数最重要的一条纪律）：
 *   只做「按行分类 → 空白归一 → 去重复行 → 结构化」，**一个字都不许替换/增删语义**。
 *   改写需求 = 把用户的话变成 AI 的话，出了偏差**没人能追溯**（原文还在，但已不是判据）。
 *   ⇒ 输出里**必须同时保留 `raw`（原文）与 `clean`（整理后）**，且 `clean` 是 `raw` 的**子串级**重构。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 整理需求文本（纯函数）。
 *
 * @param {string} text 需求原文
 * @returns {{raw:string, clean:string, lines:string[], noiseLines:Array<{text:string,why:string}>,
 *            droppedDup:number, name:string, intent:string, changed:boolean}}
 */
export function organize(text) {
	const raw = String(text == null ? "" : text);
	const rawLines = raw.split(/\r?\n/);
	const lines = [];
	const noiseLines = [];
	const seen = Object.create(null);
	let droppedDup = 0;
	for (let i = 0; i < rawLines.length; i++) {
		/* 空白归一：**只动空白**（含全角空格），不动任何实义字符 */
		const t = rawLines[i].replace(/[ \t\u3000]+/g, " ").trim();
		if (!t) continue;                                   // 空行直接丢（不算噪声，也不计重复）
		const why = noiseReasonOf(t);
		if (why) { noiseLines.push({ text: t, why: why }); continue; }
		if (seen[t]) { droppedDup++; continue; }
		seen[t] = 1;
		lines.push(t);
	}
	const clean = lines.join("\n");
	const name = novelNameOf(text);
	const nr = lines.length ? null : noiseReasonOf(raw.trim() || raw);
	const intent = !lines.length
		? (raw.trim() ? "noise" : "none")
		: (isNovelIntent(clean) ? "novel" : "generic");
	return {
		raw: raw, clean: clean, lines: lines, noiseLines: noiseLines,
		droppedDup: droppedDup, name: name, intent: intent,
		changed: clean !== raw.trim(),
		/* 整段都没内容时把原因也带上（调用方要能"如实说清为什么没整理出东西"） */
		reason: (!lines.length && raw.trim()) ? String(nr || "没整理出可执行要点") : ""
	};
}

/**
 * 把 `organize()` 的结果渲染成**给分支/给用户看的一段话**（纯函数）。
 * 🔴 有噪声被剔除时**必须报数并给出原因**（纪律 19：降级可以，无声不行）——
 *    否则用户看到"总监没理我那句话"，而不知道是**被判成噪声剔掉了**。
 *
 * @param {object} org `organize()` 的返回
 * @param {number} [maxWhy=3] 最多列几条剔除原因（避免长文淹没正文）
 * @returns {string}
 */
export function organizeSummary(org, maxWhy) {
	const o = org || {};
	const n = Number.isFinite(Number(maxWhy)) ? Number(maxWhy) : 3;
	const out = [];
	if (!o.lines || !o.lines.length) {
		return "【需求整理】未整理出可执行要点 —— " + String(o.reason || "内容为空");
	}
	out.push("【需求整理】共 " + o.lines.length + " 条要点：");
	for (let i = 0; i < o.lines.length; i++) out.push("  " + (i + 1) + ". " + o.lines[i]);
	const notes = [];
	if (o.noiseLines && o.noiseLines.length) {
		const whys = [];
		for (let i = 0; i < o.noiseLines.length && i < n; i++) whys.push(o.noiseLines[i].why);
		notes.push("已剔除噪声 " + o.noiseLines.length + " 行（" + whys.join("；") + "）");
	}
	if (o.droppedDup) notes.push("已合并重复 " + o.droppedDup + " 行");
	if (notes.length) out.push("· " + notes.join(" · "));
	return out.join("\n");
}

/* ══════════════════════════════════════════════════════════════════
 * 🔴 19 号文 **N4**：把口语需求整理成「**AI 可执行规格**」
 *    —— 用户第 9 条原话：「去掉多余对人的解释，只要 AI 能看懂」。
 *
 *    `organize()` 产出的是**给人看的要点**（"需求整理 N 条"），下游 AI 还得二次解读。
 *    这里在**同一份去噪结果**上再分一层结构，输出下游可以直接照着做的字段：
 *      goal（要达成什么）/ scope（做什么）/ outOfScope（不做什么）
 *      / acceptance（怎么算做完）/ forbidden（明令禁止）/ refs（要用到的路径）
 *
 *    🔴 两条硬约束（判据要求）：
 *      ① `origin` **逐字保留原文**（整理不得改写语义 —— 与 `organize()` 同一条纪律）；
 *      ② 输出**不含对人类的敬语**（请您/建议您/希望…）—— 那些是给人的客套，
 *         对 AI 是噪声，且会让"这条需求到底要什么"变得模糊。
 *      ③ 没有内容的字段 ⇒ **空数组**，**不写「（未指定）」这类占位**
 *         （占位会挤占下游注意力，且让"没有"与"写了但为空"无法分辨）。
 * ══════════════════════════════════════════════════════════════════ */

/** 规格字段（顺序即渲染顺序；新增一类只加一行，**不改流程**） */
export const SPEC_KEYS = Object.freeze(["goal", "scope", "outOfScope", "acceptance", "forbidden", "refs"]);

/* 归类规则（**顺序即优先级**）：
 *   · 先判「禁止 / 排除」—— 它们是**负向**要求，含"不要/不得"等词，
 *     放在后面会被"验收"类词抢走（"不得低于"同时含"不得"与"低"）；
 *   · `refs` 只认**盘符路径 / 文件扩展名 / 「根在」**，**不认裸斜杠** ——
 *     中文里「世界观/力量体系」这类斜杠分隔极常见，认斜杠会把整句话误判成路径。 */
const SPEC_RULES = Object.freeze([
	{ key: "forbidden", re: /(不要|别写|禁止|不许|不得|避免|严禁|不能写|无需)/ },
	{ key: "outOfScope", re: /(不在范围|不包含|暂不|先不|本期不做|除外|另议|下次再)/ },
	{ key: "acceptance", re: /(验收|必须|要求|要能|通过|检查|一致|达标|核对|至少)/ },
	{ key: "refs", re: /([A-Za-z]:[\\/]|[\w.-]+\.(?:js|mjs|json|md|html|txt|png|wav|csv)\b|根在|项目根)/ },
	{ key: "scope", re: null }
]);

/* 对人类的敬语 —— 只删这些**客套短语本身**，不动任何实义字符。
 * 🔴 不用 `您|你` 单字：那会误伤「你方接口」「第 3 人称」这类实义内容。 */
const POLITE_RE = /(请您|请帮忙|麻烦您|麻烦你|建议您|希望你|希望您|烦请|劳驾|如果方便的话|如果你方便的话)/g;

/** 去掉客套短语（纯字符串处理，**不改语义**） */
function stripPolite(s) {
	return String(s == null ? "" : s)
		.replace(POLITE_RE, "")
		.replace(/^[，,、。；;：:\s]+/, "")
		.trim();
}

/** 按规则表给一行归类；都不中 ⇒ `scope`（兜底，故规则表最后一项 `re: null`） */
function classifySpecLine(line) {
	for (let i = 0; i < SPEC_RULES.length; i++) {
		const r = SPEC_RULES[i];
		if (!r.re) return r.key;
		if (r.re.test(line)) return r.key;
	}
	return "scope";
}

/**
 * 把需求整理成 **AI 可执行规格**（纯函数）。
 *
 * @param {string} text 需求原文（口语/多行/带噪声都行）
 * @param {string} [dim] 可选：归属维度 key（写进 `dim`，便于下游知道这条规格属于哪条线）
 * @returns {{goal:string, scope:string[], outOfScope:string[], acceptance:string[],
 *            forbidden:string[], refs:string[], origin:string, dim:string,
 *            lines:number, noise:number, droppedDup:number, reason:string}}
 */
export function organizeSpec(text, dim) {
	const raw = String(text == null ? "" : text);
	/* 🔴 复用 `organize()` 的去噪/去重（**单一真相源**）—— 不在这里重建一套清洗逻辑，
	 *    否则"什么算噪声"会有两份定义，两边漂移时下游拿到的东西就不一致了。 */
	const org = organize(raw);
	const out = {
		goal: "", scope: [], outOfScope: [], acceptance: [], forbidden: [], refs: [],
		origin: raw, dim: dim ? String(dim) : "",
		lines: 0, noise: (org.noiseLines || []).length, droppedDup: org.droppedDup || 0,
		reason: ""
	};
	const lines = (org.lines || []).map(stripPolite).filter((s) => s !== "");
	for (let i = 0; i < lines.length; i++) {
		out[classifySpecLine(lines[i])].push(lines[i]);
	}
	out.lines = lines.length;
	/* goal = 第一条**正向**要点（"要做什么"）；全被禁止/排除占满时退回首行（不编内容） */
	const positive = [];
	for (let i = 0; i < lines.length; i++) {
		const k = classifySpecLine(lines[i]);
		if (k !== "forbidden" && k !== "outOfScope") positive.push(lines[i]);
	}
	out.goal = positive.length ? positive[0] : (lines.length ? lines[0] : "");
	/* 没内容时**如实说明原因**（纪律 19：降级可以，无声不行）；但**不写占位字段** */
	if (!lines.length) out.reason = org.reason || (raw.trim() ? "没整理出可执行要点" : "内容为空");
	return out;
}

/** 中文书名号提取：《我的小说》 ⇒ "我的小说"；取不到返回空串（**不编名字**） */
export function novelNameOf(text) {
	const s = String(text == null ? "" : text);
	const m = s.match(/《([^》]{1,40})》/);
	return m ? m[1] : "";
}

/** 是否小说意图（纯函数；空文本 ⇒ false，不许"默认当小说"） */
export function isNovelIntent(text, extraHints) {
	const s = String(text == null ? "" : text).toLowerCase();
	if (!s.trim()) return false;
	const hints = Array.isArray(extraHints) && extraHints.length ? extraHints : NOVEL_HINTS;
	return hints.some((k) => s.indexOf(String(k).toLowerCase()) >= 0);
}

/**
 * 分支名（纯函数）：**维度名在前** + 书名（有则带上）。
 * 为什么维度名必须在前：导图里节点按 `label` 排序阅读时，"A1/A2/A3…"这层结构
 * 一眼可见；把书名放前面（"《X》· A1 世界观"）会让八个节点的**共同前缀**占满可视区，
 * 反而看不出结构（这也是本项目"路由面只暴露前 29 字符"那条教训的同型问题）。
 */
export function branchTitle(dim, novelName) {
	const n = String(novelName == null ? "" : novelName).trim();
	return "「" + String(dim && dim.label ? dim.label : "维度") + "」" + (n ? "《" + n + "》" : "");
}

/**
 * 简报标题前缀（纯函数）—— **宿主会话标题的开头**。
 *
 * 🔴 为什么需要它（第 25 批实测 · 19 号文 U10/P9 的**真因**）：
 *   宿主把**首条消息的首行**当会话标题 ⇒ 实测宿主快照 `title` = `【A1 世界观】《灵能修仙》 —— …`，
 *   也就是 `briefOf()` 的 `head` 原样打头。而上一版拿 `branchTitle()` 去做"标题弱匹配"，
 *   它产出的是 `「A1 世界观」《灵能修仙》`（**角括号**）—— 连字形都不同
 *   ⇒ 全等匹配**恒 0 命中**，冷启动每次仍然新建 8 条（`reused:0 / created:8`）。
 *   这正是本项目纪律 27「看起来相等 ≠ 同源」的同型事故：**匹配串与真值串必须同一个来源**。
 *
 *   ⇒ 本函数是 head 与匹配判据的**唯一真相源**：`briefOf()` 用它在最前面拼 head，
 *     `director-reuse.js` 用它做前缀判据 ⇒ 改一处两处同时变（不许各写一份）。
 *   ⇒ 长度也稳定（≈ `【标签】《书名》`，约 20–30 字）⇒ 宿主标题被截断也**截不到前缀部分**。
 *
 * @param {{label?:string}} dim 维度
 * @param {string} novelName 作品名（可为空 ⇒ 只有 `【标签】`）
 * @returns {string} 形如 `【A1 世界观】《灵能修仙》`
 */
export function briefTitlePrefix(dim, novelName) {
	const n = String(novelName == null ? "" : novelName).trim();
	return "【" + String((dim && dim.label) || "") + "】" + (n ? "《" + n + "》" : "");
}

/**
 * 生成分流计划（纯函数）。
 * @param {string} text 需求原文
 * @param {{only?:string[], all?:boolean, max?:number, generic?:boolean}} [opts]
 *   `only` 只要这几条维度（key 数组）；`max` 上限（防一次建太多）；
 *   `generic: true` 强制走通用维度；`generic: false` **严格模式**（未命中小说意图 ⇒ `none`，不兜底）
 * @returns {{kind:"novel"|"generic"|"none"|"noise", dims:Array, name:string, reason:string}}
 */
export function plan(text, opts = {}) {
	const o = opts || {};
	const src = String(text == null ? "" : text).trim();
	const name = novelNameOf(text);
	/* 🔴 空需求 ⇒ **不建任何分支**：不猜、也不给"默认三条"。
	 *    建出来的是**空壳分支**，而且会让导图变脏 —— 用户看到多出 3 个不知道干什么的节点，
	 *    比"什么都没发生"更糟（纪律 19 的反面：宁可如实说"没识别到"，也不无声造垃圾）。 */
	if (!src) return { kind: "none", dims: [], name, reason: "需求文本为空 ⇒ 不自动建分支" };
	const novel = o.generic ? false : isNovelIntent(src);
	/* 🔴 第 23 批：**严格模式**与**噪声**都必须不建分支，差别只在 `kind` 与 `reason` ——
	 *    严格模式是"调用方要求严格"，噪声是"输入本身没有可执行内容"。
	 *    两者若共用 `none`，用户/闸门就分不清「插件没识别到」与「你打的字没内容」。 */
	if (!novel) {
		if (o.generic === false) {
			return { kind: "none", dims: [], name, reason: "既不是小说意图，也未指定通用维度 —— 不自动建分支" };
		}
		/* 🔴 第 23 批新增：**噪声短路**（第二十三轮真机驱动）。
		 *    旧逻辑：未命中小说意图 ⇒ **无条件**走通用兜底 ⇒ 投「今天天气不错 哈哈哈哈」
		 *    会建出 `plan/build/verify` **3 个空壳分支**（真机实测：会话 +3、导图 +3 框、各投 1 份简报）。
		 *    与第 19 批"一百多个会话"同型的污染。⇒ 判为噪声时**一条都不建**，并把原因报出去。 */
		const nr = noiseReasonOf(src);
		if (nr) {
			return {
				kind: "noise", dims: [], name,
				reason: "未识别到可执行需求（" + nr + "）⇒ 不自动建分支（避免建出空壳分支污染导图）"
			};
		}
	}
	const pool = novel ? SPLIT_DIMENSIONS : GENERIC_DIMENSIONS;
	let dims = pool.slice();
	/* ══════════════════════════════════════════════════════════════════
	 * 🔴 19 号文 N1（用户原话）：「补充 A3 剧情第三章支线」⇒ 总监仍按 A1–A8 **全 8 维**建/派。
	 *    旧实现就是本行 `let dims = pool.slice();` —— **`o.only` 未传时恒为全量**，
	 *    全仓没有任何"按内容选维度"的代码 ⇒ 一句话建 8 条宿主会话 + 投 8 份简报。
	 *
	 *    ⚠️ `o.only` **仍然最高优先**（向后兼容）：`plan(x, {only:[...]})` 的既有调用点
	 *       与既有判据（`SD-8a–c`）**一字不改也必须过**。
	 *    ⚠️ 归属判定返回空（如"命中的维度只有当前维度、且判定话题不连续"）⇒ **不建分支**，
	 *       如实把原因报出去；**不兜底建默认三条**（那是空壳污染，见本文件第 23 批注释）。
	 * ══════════════════════════════════════════════════════════════════ */
	let attribution = null;
	if (Array.isArray(o.only) && o.only.length) {
		const want = o.only.map((k) => String(k));
		dims = dims.filter((d) => want.indexOf(d.key) >= 0);
	} else {
		attribution = ATTR.planAttribution(src, o);
		if (!attribution.dims.length) {
			return {
				kind: attribution.kind === "noise" ? "noise" : "none",
				dims: [], name, reason: attribution.reason, attribution: attribution
			};
		}
		const keys = attribution.dims.map((a) => a.key);
		dims = dims.filter((d) => keys.indexOf(d.key) >= 0);
	}
	/* 排序：先按工序阶段（设定 → 剧情/人物 → 正文 → 打磨/审查 → 蒸馏），
	 * 同阶段**按表内原始序**（= A1→A8 的固定次序）。
	 * 🔴 同阶段**不能用 key 字典序**：那会把 A2 力量体系排到 A1 世界观前面
	 *    （"power" < "world"），导图第一眼就读成「没有按工序来」。
	 *    显式用表内下标排序，**不依赖 Array#sort 的稳定性**（少一个隐性前提）。 */
	const order = new Map(pool.map((d, i) => [d.key, i]));
	dims.sort((a, b) => (a.stage - b.stage) || (order.get(a.key) - order.get(b.key)));
	const max = Number.isFinite(Number(o.max)) && Number(o.max) > 0 ? Math.round(Number(o.max)) : 0;
	if (max && dims.length > max) dims = dims.slice(0, max);
	return {
		kind: novel ? "novel" : "generic",
		dims,
		name,
		/* 🔴 `reason` 走归属判定的原话（含命中理由）—— 用户/闸门看到的是**同一条判据**
		 * 的产物，不是另写一句文案（另写必漂移）。`o.only` 路径下 attribution 为 null，
		 * 此时如实说明"是显式指定的"，**不冒充**归属判定的结论。 */
		reason: attribution
			? attribution.reason
			: (novel
				? "显式 `only` 指定维度 ⇒ 按指定过滤（未走归属判定）"
				: "未命中小说意图 ⇒ 按通用三段分线（显式 `only` 指定）"),
		/* 归属判定读数（19 号文 N8 的读数来源之一）—— 显式 `only` 时为 null */
		attribution: attribution
	};
}

/**
 * 每条维度要投递的**简报文本**（纯函数）。
 * 🔴 必须显式带上：① 它的角色名 ② 它能读/能写的目录边界 ③ 不要越界的告诫。
 *    只发一句"你去写世界观"会让分支里的智能体**去改剧情文件**——而且不报错。
 *
 * @param {object} dim 维度定义
 * @param {string} text 需求原文
 * @param {string} novelName 作品名
 * @param {{root?:string, name?:string}|null} [project] **项目根**（第 17 批新增，可选）
 *   🔴 为什么需要它：技能 `multi-agent-novel-brain` 要求的目录是
 *      `01-世界观/ 02-力量体系/ …`，而真实作品常用**扁平命名**（`world.md` / `assets/*.json`）
 *      —— 两者不符时分支会**找不到文件且不报错**（静默空转）。
 *      本参数把"项目在哪"送进去，并明确**以项目自身的清单为准**（而不是照抄技能默认目录）。
 *      传 `null` / 无 `root` ⇒ 这一段**整段不出现**（不写"（未指定）"这类占位）。
 * @param {object} [org] `organize()` 的结果（第 23 批新增，可选）
 *   🔴 给了它 ⇒ 简报里先出「需求整理」（去噪后的要点），**再附原文保真**。
 *      没给 ⇒ 退回旧行为（只有 `需求原文：`）——保证既有调用点零改动也能跑。
 * @param {object} [upstream] 上游血缘约束（19 号文 §3.4 **R3** 落点，可选）
 *   `{ bound?: string }` —— 给了它 ⇒ 本简报的「边界」段**逐字继承**上游，
 *   **下游不得自造边界**（自造的表现与"上游没传"在读数上无法区分 ⇒ 必须先把它送出去）。
 *   没给 ⇒ 退回旧行为（按本维度 `files` 现算）—— 既有调用点零改动可跑。
 * @param {string|{text?:string, at?:number}} [prevSummary] 上一轮结论摘要（19 号文 §3.5 **P3** 落点，可选）
 *   第 7 参。给了且非空 ⇒ 简报开头插入「上一轮结论」段，供本轮**承接**。
 *   🔴 必须**逐字同源**：直接取 `session-dossier` 的 `summary.text`，不二次格式化、不截断改写
 *      —— 否则「这个分支的上下游总监消息是一致的」这条要求会在**跨轮**上失效
 *      （本轮改了措辞 ⇒ 分支看到的"上一轮结论"与档案里的不是同一句话）。
 *   没给 / 空 ⇒ 整段不出现（**不写**"（无历史）"这类占位）。
 *   ⚠️ 只有"复用同一会话"时才有上一轮；新建会话**本就没有历史** ⇒ 传入空串是如实表达。
 */
export function briefOf(dim, text, novelName, project, org, upstream, prevSummary) {
	const name = String(novelName == null ? "" : novelName).trim();
	const label = String((dim && dim.label) || "");
	const head = briefTitlePrefix(dim, name) + " —— " + String((dim && dim.brief) || "");
	const files = Array.isArray(dim && dim.files) ? dim.files : [];
	const boundSelf = files.length
		? "边界：只读/只写 " + files.join("、") + "；**不要**修改未列出的目录（越界改动在两个分支之间是静默冲突）。"
		: "边界：无文件域限制（通用维度）。";
	/* 🔴 R3（19 号文 §3.4）：上游给了约束 ⇒ **逐字**带上，下游不得自造。
	 *    反例（§3.4 点名）：若判据只比 `includes`，前缀相同的两句话会通过 ⇒
	 *    `test-lineage-msg.mjs#LM-3b` 用「逐字且首字符起」+ 负对照锁住这一点。 */
	const upBound = upstream && upstream.bound ? String(upstream.bound).trim() : "";
	const bound = upBound
		? "边界（**继承自上游 · 逐字同源**）：" + upBound
			+ (boundSelf && upBound.indexOf(boundSelf) < 0 && boundSelf !== upBound
				? "\n本维度补充：" + boundSelf : "")
		: boundSelf;
	/* 🔴 用户原话「按照一个流程跑一遍 写小说吧,**调用小说技能**」——
	 *    插件**不能**替分支加载技能（宿主渲染进程里没有 WorkBuddy 的技能注册表），
	 *    能做且必须做的是：**把技能名与角色身份写进简报**，让分支里的智能体自己去加载。
	 *    只发一句"你去写世界观"的后果：分支不会加载技能、也不会读 `_memory/A{N}_MEMORY.md`
	 *    ⇒ 八个分支各自从零开始，技能里的"Token 最小化 / 记忆蒸馏"整套机制全部落空。
	 *    没写这行的表现与"写了但分支没照做"在读数上**无法区分** ⇒ 必须先把它送出去。 */
	const who = (label.match(/^A[1-8]/) || [""])[0];
	const skill = who
		? "技能：加载 multi-agent-novel-brain，担任 " + who + "；启动先读 _BRAIN.md §一路由 + §三状态，再读 _memory/" + who + "_MEMORY.md 与 _memory/CHANGE_LOG.md。"
		: "技能：通用维度，不加载小说技能。";
	/* ══════════════════════════════════════════════════════════════════
	 * 🔴 第 23 批（第二十三轮用户原话）：**总监对项目的把控**
	 *   「对于**整个项目把控**都是要有的」。
	 *
	 *   旧版本只写「落点：先读项目根下的清单文件（…存在即读）确定本维度的实际分区」
	 *   —— 这等于**把"把控项目"整件事推给了分支**：总监自己一个文件都没看，
	 *   8 个分支各自去摸索，而总监对"这个项目现在有什么、到哪一步了"**零认知**。
	 *
	 *   ⚠️ 硬边界（已实测，不可绕）：宿主**只注入 `slots` + `sessions`，没有 fs 服务**
	 *      （`window.require` / `global.require` / `electron.remote.require` 全 `undefined`）
	 *      ⇒ **总监自己读不到项目文件**。能做到、也必须做到的是：
	 *      **把"把控"变成结构化的、必须回报的指令**（读哪几份、提哪些字段、按什么格式回报）。
	 *
	 *   🔴 仍然**不写死任何用户数据**：清单文件名用**通用候选集**，作品名/目录由分支实读得出。
	 * ══════════════════════════════════════════════════════════════════ */
	const proj = (project && project.root)
		? "项目根：" + String(project.root)
			+ "\n【项目把控 · 先做这四步再动手】"
			+ "\n  ① 读清单：项目根下的 project.yaml（首选）/ README.md / _BRAIN.md / AGENTS.md —— **存在即读，读到哪份算哪份**"
			+ "\n  ② 提取并回报：项目名 / 体裁 / 当前状态 / 各分区进度 / 核心创意（一句话）/ 已冻结设定"
			+ "\n  ③ 对分区：以清单里写的**实际目录**为准（不是技能默认目录）；清单没写就列一遍项目根"
			+ "\n  ④ 回报格式：**第一句先写**「项目现状：<名> · <体裁> · <状态> ｜ 我负责的 <维度>：…」，再开始本维度工作"
			+ "\n  ⚠️ 为什么这步不能省：技能默认目录与项目实际不符时，按默认路径取文件会**找不到且不报错**（静默空转），"
			+ "而回报里没有「项目现状」这一句 ⇒ 总监无法判断你到底是**没找到项目**还是**没干活**。"
		: "";
	const srcText = String(text == null ? "" : text).trim();
	/* 🔴 19 号文 §3.5 **P3**：**跨轮上下文** —— 复用同一会话时，本轮简报必须带上
	 *    上一轮的结论摘要（`session-dossier` 的 `summary.text`）。
	 *    没有它 ⇒ 分支每一轮都当"第一轮"做，总监对话的持续性在分支侧**从来不存在**
	 *    （用户原话「总监对话的持续性一直没有看到」正是这一层）。
	 *    ⚠️ **逐字**取用：不 trim 掉内部换行之外的内容、不改写、不截断
	 *    —— P3 判据是「逐字同源」，任何二次格式化都会让它变成另一句话。 */
	const prevText = typeof prevSummary === "string"
		? prevSummary.trim()
		: (prevSummary && prevSummary.text ? String(prevSummary.text).trim() : "");
	const prev = prevText ? "【上一轮结论 · 逐字同源】" + prevText : "";
	/* 🔴 第 23 批：**总监对语言的整理** —— 有整理结果就先出要点，再附原文保真。 */
	let demand = "";
	if (srcText) {
		const hasOrg = org && Array.isArray(org.lines) && org.lines.length;
		demand = (hasOrg ? organizeSummary(org) + "\n" : "") + "需求原文：" + srcText;
	}
	return [head, skill, proj, prev, bound, demand].filter(Boolean).join("\n");
}
