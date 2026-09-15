/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：标准模型选择席位（第 6 批需求 8）
 * 引用：—
 * 上游：client-entry.js, components/DirectorPage.js
 * 下游：config/model.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * components/ModelSeat.js — 标准模型选择席位（第 6 批需求 8）
 *
 * ══════════════════════════════════════════════════════════════════
 *  需求原话
 * ══════════════════════════════════════════════════════════════════
 *  「[图8] 把本地模型的配置配到标准的模型选择中」
 *
 * ── 改之前是什么样（"两个地方各管一半"）────────────────────────────
 *   · 云端模型：只是 `logic/director-run.js` 里一张写死的 `TASK_MODEL` 表，
 *     **用户无法选**，只能被动接受"任务类型 → 建议模型"。
 *   · 本地模型：`config.localModel.enabled` 一个**布尔开关** + 一个自由文本
 *     `model: "qwen2:7b"`，与模型选择**互不相干**。
 *   ⇒ 结果是：想用本地模型必须先"打开开关"，想换云端模型**没有入口**；
 *     两者组合起来的状态（开关开着但选了云端）在界面上**表达不出来**。
 *
 * ── 接入点（真机核实，不是猜的）────────────────────────────────────
 *   宿主 `dsh-client-ui-conversation/lib/client.js`：
 *      · :11829 声明 `conversation.input.model`，`kind:"single"`, `scope:"session"`
 *      · :4022 `renderSlot("conversation.input.model", { locked: modelSeatLocked })`
 *        —— 渲染在输入条 **trailing** 区（标准模型选择的位置）
 *   而**宿主自己零注册**（全仓只有"声明"与"渲染"两处，没有 register）
 *   ⇒ 这是一个**空着的官方席位**，就是"标准模型选择"。
 *
 * ── 设计：单一选择 + 派生状态（**不引入第二个开关**）────────────────
 *   配置里新增一个 `model` 字段作为**唯一选择**：
 *     云端：`deepseek-chat` / `deepseek-coder` / `deepseek-reasoner`
 *     本地：`ollama:<模型名>`
 *   `localModel.enabled` **由选择派生**（选到本地 ⇒ true；选到云端 ⇒ false）——
 *   这样既不破坏 `callLocalModel()` 读 `localModel.enabled` 的既有契约，
 *   又消灭了"开关与选择互相矛盾"的状态。
 *   ⚠️ 它是**新增字段**，`dsh.director.config` 里既有键一个都没改名（冻结契约）。
 *
 * ── 状态含义（写清楚，避免"看着像坏了"）──────────────────────────
 *   `probe` = 上一次 Ollama 探测结果（/api/tags）。
 *   本机无 Ollama 时**不是错误**：那是"未安装"，界面如实显示"未探测到本地模型"，
 *   而不是把本地选项藏起来 —— 藏起来会让人以为"这个功能没做"。
 *
 * 纯函数（可离线单测）：`selectedModelOf` / `applyModelChoice` / `modelOptions`
 */

import * as react from "react";
/* `react-dom` 是 **平台冻结模块**（构建期外置为 require，见 build.mjs 的 PLATFORM_MODULES）
 * —— 用于 createPortal。⚠️ 取用要**容错**：若该模块的形态与预期不同（宿主版本差异），
 * 退化为原地渲染而不是抛穿（本模块在宿主插槽渲染路径上，抛一次会整块槽位变
 * `data-slot-error` —— 那正是"注册成功 ≠ 渲染成功"的翻版）。 */
import * as react_dom from "react-dom";
import { loadDirectorConfig, saveDirectorConfig, checkOllamaStatus, OLLAMA_DEFAULT_ENDPOINT, OLLAMA_DEFAULT_MODEL } from "../config/model.js";

const createPortal = (react_dom && typeof react_dom.createPortal === "function") ? react_dom.createPortal : null;

const h = react.createElement;

/** 宿主插槽名（🔴 与宿主 `dsh-client-ui-conversation/lib/client.js:11829` 的声明**逐字一致**，
 *  改名即"slot is not declared"抛错。它是外部契约，不是本插件的内部命名。） */
export const MODEL_SEAT_SLOT = "conversation.input.model";

/** 云端标准模型（顺序即展示顺序；`key` 就是投给模型服务的名字） */
export const CLOUD_MODELS = Object.freeze([
	{ key: "deepseek-chat", label: "DeepSeek Chat", note: "日常对话 / 文本整理（默认）" },
	{ key: "deepseek-coder", label: "DeepSeek Coder", note: "代码开发" },
	{ key: "deepseek-reasoner", label: "DeepSeek Reasoner", note: "系统设计 / 推理" }
]);

/** 本地模型的前缀 —— 用它把"本地"与"云端"在**一个字符串**里区分开 */
export const LOCAL_PREFIX = "ollama:";

/**
 * 当前选中的模型（**唯一真相源在配置里，不另存一份**）。
 * 读不到的旧配置（无 `model` 字段）⇒ 由 `localModel.enabled` 反推，
 * 保证升级后行为与升级前**逐字一致**。
 * @param {object} cfg
 * @returns {string}
 */
export function selectedModelOf(cfg) {
	const c = cfg || {};
	if (typeof c.model === "string" && c.model.trim()) return c.model.trim();
	const lm = c.localModel || {};
	if (lm.enabled && lm.model) return LOCAL_PREFIX + lm.model;
	return CLOUD_MODELS[0].key;
}

/**
 * 把"选了一个模型"落成新配置（**纯函数**：不改入参、无副作用）。
 *
 * 🔴 关键不变量（闸门要正负对照的两条）：
 *   ① 选本地 ⇒ `localModel.enabled === true` 且 `localModel.model` = 去前缀后的名字；
 *   ② 选云端 ⇒ `localModel.enabled === false`（否则会出现"选了云端却仍走本地"这种
 *      「界面与执行不一致」—— 本项目最忌讳的一类：读数上分不出来）。
 * @param {object} cfg
 * @param {string} key
 * @returns {object} 新配置（不修改入参）
 */
export function applyModelChoice(cfg, key) {
	const c = cfg || {};
	const k = String(key || "").trim();
	const base = { ...c, localModel: { ...(c.localModel || {}) } };
	if (!base.localModel.endpoint) base.localModel.endpoint = OLLAMA_DEFAULT_ENDPOINT;
	if (k.indexOf(LOCAL_PREFIX) === 0) {
		const name = k.slice(LOCAL_PREFIX.length).trim();
		base.model = k;
		base.localModel.enabled = true;
		if (name) base.localModel.model = name;
		return base;
	}
	base.model = k || CLOUD_MODELS[0].key;
	base.localModel.enabled = false;
	return base;
}

/**
 * 候选列表（云端 + 探测到的本地）。
 * @param {string} selected
 * @param {{available:boolean, models:string[]}|null} probe
 * @returns {Array<{key:string,label:string,note:string,kind:string,ok:boolean}>}
 */
export function modelOptions(selected, probe) {
	const out = CLOUD_MODELS.map((m) => ({
		key: m.key, label: m.label, note: m.note, kind: "cloud", ok: true
	}));
	const cur = String(selected || "");
	const lm = cur.indexOf(LOCAL_PREFIX) === 0 ? cur.slice(LOCAL_PREFIX.length) : "";
	/* 当前选中的本地模型**永远在列**（即使探测不到）—— 否则"选中项不在候选里"，
	 * 会让人以为配置丢了。它的可用性由 note 如实说明。 */
	if (lm) out.push({ key: cur, label: lm + "（本地）", note: "当前选中", kind: "local", ok: true });
	const probed = (probe && Array.isArray(probe.models)) ? probe.models : [];
	for (const m of probed) {
		const k = LOCAL_PREFIX + m;
		if (out.some((o) => o.key === k)) continue;
		out.push({ key: k, label: m + "（本地）", note: "Ollama 探测到", kind: "local", ok: true });
	}
	if (!lm && probed.length === 0) {
		/* 🔴 不藏、不编：把"为什么没有本地选项"写成一条**不可选的说明行**。 */
		out.push({
			key: LOCAL_PREFIX + "(none)", label: "未探测到本地模型", note: "Ollama 不可用或未安装", kind: "local", ok: false
		});
	}
	return out;
}

/** 短标签（输入条空间有限） */
export function shortLabelOf(cfg) {
	const k = selectedModelOf(cfg);
	if (k.indexOf(LOCAL_PREFIX) === 0) return "本地 " + k.slice(LOCAL_PREFIX.length);
	const m = CLOUD_MODELS.find((x) => x.key === k);
	return m ? m.label.replace(/^DeepSeek\s+/, "") : k;
}

const S = {
	wrap: { position: "relative", display: "inline-flex", alignItems: "center" },
	btn: {
		display: "inline-flex", alignItems: "center", gap: 4, maxWidth: 190,
		padding: "3px 7px", borderRadius: 6, cursor: "pointer",
		border: "1px solid var(--dsw-alias-border-2, rgba(127,127,127,.32))",
		background: "transparent", color: "inherit",
		font: "inherit", fontSize: 12, lineHeight: "18px",
		whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
	},
	panel: {
		position: "fixed", zIndex: 2147483001, minWidth: 236, maxWidth: 320,
		background: "var(--dsw-alias-bg-elevated, #23262c)", color: "var(--dsw-alias-text-1, #e8eaed)",
		border: "1px solid var(--dsw-alias-border-2, rgba(127,127,127,.32))",
		borderRadius: 8, padding: 5, boxShadow: "0 12px 32px rgba(0,0,0,.42)",
		fontSize: 12, maxHeight: 320, overflowY: "auto"
	},
	group: { padding: "4px 7px 2px", color: "var(--dsw-alias-text-3, #8b9199)", fontSize: 10.5, letterSpacing: ".4px" },
	item: (on, ok) => ({
		display: "flex", gap: 6, alignItems: "baseline", padding: "5px 7px", borderRadius: 5,
		cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.55,
		background: on ? "var(--dsw-alias-bg-2, rgba(127,127,127,.16))" : "transparent"
	}),
	note: { color: "var(--dsw-alias-text-3, #8b9199)", marginLeft: "auto", fontSize: 10.5 },
	foot: {
		marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--dsw-alias-border-2, rgba(127,127,127,.22))",
		color: "var(--dsw-alias-text-3, #8b9199)", fontSize: 10.5, padding: "4px 7px"
	}
};

/**
 * 标准模型选择席位组件。
 * 宿主渲染处传 `{ locked }`（停止生成时为 true）—— 尊重它，锁定时禁用并说明原因。
 */
export function ModelSeat(props) {
	const locked = Boolean(props && props.locked);
	const [open, setOpen] = react.useState(false);
	const [probe, setProbe] = react.useState(null);
	const [tick, setTick] = react.useState(0);
	const btnRef = react.useRef(null);
	const panelRef = react.useRef(null);
	const [pos, setPos] = react.useState(null);
	const cfg = loadDirectorConfig();
	void tick; // 仅用于强制重渲染
	const selected = selectedModelOf(cfg);
	const opts = modelOptions(selected, probe);

	/** 展开时就地探测一次（不拿旧快照糊弄；与总监页模型菜单同一口径） */
	function toggle() {
		if (locked) return;
		const next = !open;
		setOpen(next);
		if (!next) return;
		reactDomProbe();
	}
	function reactDomProbe() {
		setProbe({ available: false, models: [], reason: "探测中…" });
		try {
			Promise.resolve(checkOllamaStatus(cfg)).then((r) => {
				setProbe(r || { available: false, models: [], reason: "探测无返回" });
			}).catch((e) => setProbe({ available: false, models: [], reason: "探测异常：" + ((e && e.message) || e) }));
		} catch (e) {
			setProbe({ available: false, models: [], reason: "探测异常：" + ((e && e.message) || e) });
		}
	}
	function pick(o) {
		if (!o || !o.ok) return;
		try {
			const next = applyModelChoice(loadDirectorConfig(), o.key);
			saveDirectorConfig(next);
			if (typeof window !== "undefined") window.__directorConfig = next;
		} catch (e) { /* 写配置失败不抛：下一次展开会如实显示"还是旧值" */ }
		setOpen(false);
		setTick((v) => v + 1);
	}

	/* 位置：贴着按钮右对齐、面板底边在按钮上方（composer 在页面底部，往下会出屏）。
	 * 🔴 位置**每次展开现算**（不缓存）—— 视口/输入条高度会变（发现过"位置漂移"）。 */
	react.useEffect(() => {
		if (!open) return undefined;
		const b = btnRef.current;
		if (!b || typeof b.getBoundingClientRect !== "function") return undefined;
		const r = b.getBoundingClientRect();
		const w = 260;
		const left = Math.max(8, Math.min((typeof window !== "undefined" ? window.innerWidth : 1440) - w - 8, r.right - w));
		setPos({ left: left, bottom: Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 900) - r.top + 6) });
		return undefined;
	}, [open]);

	/* 开合型控件：Esc 关闭 + 点外面关闭。
	 * ⚠️ 关闭逻辑**只留这一处**（纪律：开合型控件必须能当场还原，
	 *    不留会吃掉后续 Esc 的捕获相监听）。 */
	react.useEffect(() => {
		if (!open) return undefined;
		function onKey(e) { if (e && e.key === "Escape") setOpen(false); }
		function onDown(e) {
			const t = e && e.target;
			if (panelRef.current && t && panelRef.current.contains(t)) return;
			if (btnRef.current && t && btnRef.current.contains(t)) return;
			setOpen(false);
		}
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", onDown, true);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onDown, true);
		};
	}, [open]);

	const probeNote = !probe ? "未探测"
		: probe.available ? ("Ollama 可用 · " + (probe.models || []).length + " 个模型")
			: ("Ollama 不可用：" + (probe.reason || "未知"));

	const panel = open ? h("div", {
		ref: panelRef, "data-testid": "dp-model-seat-panel",
		style: { ...S.panel, ...(pos ? { left: pos.left, bottom: pos.bottom } : { left: 8, bottom: 8 }) },
		role: "listbox"
	}, [
		h("div", { key: "gc", style: S.group }, "云端模型"),
		...opts.filter((o) => o.kind === "cloud").map((o) => h("div", {
			key: o.key, role: "option", "aria-selected": o.key === selected,
			"data-testid": "dp-model-opt", "data-key": o.key, "data-kind": o.kind,
			style: S.item(o.key === selected, o.ok), onClick: () => pick(o)
		}, [
			h("span", { key: "l" }, o.label),
			h("span", { key: "n", style: S.note }, o.note)
		])),
		h("div", { key: "gl", style: S.group }, "本地模型（Ollama）"),
		...opts.filter((o) => o.kind === "local").map((o) => h("div", {
			key: o.key, role: "option", "aria-selected": o.key === selected,
			"data-testid": "dp-model-opt", "data-key": o.key, "data-kind": o.kind, "data-ok": o.ok ? "1" : "0",
			style: S.item(o.key === selected, o.ok), onClick: () => pick(o)
		}, [
			h("span", { key: "l" }, o.label),
			h("span", { key: "n", style: S.note }, o.note)
		])),
		h("div", { key: "f", style: S.foot }, probeNote + " · 端点 " + ((cfg.localModel && cfg.localModel.endpoint) || OLLAMA_DEFAULT_ENDPOINT)
			+ " · 默认 " + ((cfg.localModel && cfg.localModel.model) || OLLAMA_DEFAULT_MODEL))
	]) : null;

	return h("span", { style: S.wrap, "data-testid": "dp-model-seat" }, [
		h("button", {
			key: "b", ref: btnRef, type: "button",
			"data-testid": "dp-model-seat-btn",
			"data-model": selected,
			"data-locked": locked ? "1" : "0",
			title: locked ? "生成中，模型选择已锁定" : ("标准模型选择（当前：" + selected + "）—— 含本地 Ollama 模型"),
			disabled: locked,
			style: { ...S.btn, opacity: locked ? 0.5 : 1, cursor: locked ? "not-allowed" : "pointer" },
			/* 🔴 stopPropagation：宿主 composer 有自己的 pointerdown 处理（聚焦输入框），
			 * 不拦会在点按钮时把焦点抢走（与注入条同一处理）。 */
			onMouseDown: (e) => { try { e.stopPropagation(); } catch (_) { } },
			onClick: (e) => { try { e.stopPropagation(); } catch (_) { } toggle(); }
		}, [
			h("span", { key: "s", "data-testid": "dp-model-seat-label" }, shortLabelOf(cfg)),
			h("span", { key: "c", style: { opacity: .6 } }, "▾")
		]),
		/* 🔴 用 portal 挂到 body：composer 有 `overflow` 裁剪与 transform 层叠上下文，
		 *    面板若留在原地会被裁掉一部分（"看着像只显示了一半"）。
		 * ⚠️ portal 不可用（宿主版本差异）⇒ 退化为**原地渲染**（样式仍是 fixed，
		 *    在没有 transform 祖先时视觉一致）——降级但不消失。 */
		panel && typeof document !== "undefined" && document.body && createPortal
			? createPortal(panel, document.body)
			: panel
	]);
}

/** 探针/设置面板的调试句柄（CDP 可读；不参与业务） */
export function modelSeatState() {
	try {
		const cfg = loadDirectorConfig();
		return {
			selected: selectedModelOf(cfg),
			localEnabled: Boolean(cfg.localModel && cfg.localModel.enabled),
			localModel: (cfg.localModel && cfg.localModel.model) || "",
			endpoint: (cfg.localModel && cfg.localModel.endpoint) || ""
		};
	} catch (e) { return { selected: "", error: String((e && e.message) || e) }; }
}
