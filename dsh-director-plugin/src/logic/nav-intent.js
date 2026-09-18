/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：侧栏点击的**导航意图判定**（纯函数）
 * 引用：—
 * 上游：bridge/nav-hook.js
 * 下游：（无）
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * logic/nav-intent.js — 侧栏点击的**导航意图判定**（纯函数）
 *
 * ── 为什么单独一个文件，而不是留在 `bridge/nav-hook.js` ────────────────
 *   `bridge/*` 是**带副作用**的一层（挂事件、读 DOM、碰 store）。判据留在那里，
 *   就只能在真机上验（要起应用、要真实鼠标）。而这条判据恰恰**最容易写错**
 *   （用户报的"点了没反应 / 该缩不缩"，历史上都是这一族）。
 *   ⇒ 提到 `logic/`（本项目纯函数层）：离线可跑、可植入缺陷校准，
 *     真机套件与离线闸门**用同一份实现**（不是"两套判据各测一半"）。
 *
 * ── 第 38 轮需求出处 ───────────────────────────────────────────────
 *   用户原话：「点击文件夹跳出总监；**非固定**情况下再点击**对话**总监缩回，
 *              点击文件夹，按照点击的文件夹**刷新**总监」（需求 11）
 *            「总监跳出来之后，我**再点击左侧的对话，这个总监页面不会变化**」（需求 10）
 */

/** 意图取值（冻结，UI 与闸门都不许另写字面量） */
export const NAV_INTENT = Object.freeze({
	/** 固定态：**什么都不做**（作用域逐字不变，也不缩回） */
	HOLD: "hold",
	/** 点对话：缩回（`dialogCollapsed=true`，**作用域保留** —— 不是关闭） */
	COLLAPSE: "collapse",
	/** 点文件夹 / 项目：换作用域 + 展开 + 解除缩回 */
	REFRESH: "refresh",
	/** 弹窗本来就没开：什么都不做（**绝不误开** —— 保持既有"三级匹配、宁可不弹"的克制） */
	NONE: "none"
});

/** 会话级节点名（与 `store/hierarchy.js#LEVEL.SESSION` 同值；对拍见 `test-scope-tree.mjs`） */
const LEVEL_SESSION = "session";

/**
 * 判定"点一下侧栏会怎样"
 *
 * 四态表（**穷尽**，不存在"没覆盖到"的组合）：
 * | pinned | hasMatch | level     | 结果                 |
 * |:------:|:--------:|:----------|:---------------------|
 * | true   | 任意     | 任意      | `hold`               |
 * | false  | 是       | session   | `collapse`           |
 * | false  | 是       | 非 session| `refresh`            |
 * | false  | 否       | —         | 弹窗开着 ⇒ `collapse`；否则 `none` |
 *
 * 🔴 为什么"无命中"也要缩回：用户原话是「点击**其他对话**的时候总监自动缩回」——
 *    "其他对话"未必都在层级树里（新建的、未同步的都可能不在）。若只在命中时缩回，
 *    用户会看到"有时缩有时不缩"，而且**无法预测**（他会以为坏了）。
 *    点在侧栏空隙也缩回属**可接受**：语义都是"离开了当前上下文"。
 *    ⚠️ 反向代价已评估：**不会误开**总监 —— 缩回是"关闭方向"，
 *       最坏结果只是多收一次（用户点一下文件夹即可回来）。
 *
 * @param {{pinned?:boolean, hasMatch?:boolean, level?:string, dialogOpen?:boolean}} o
 * @returns {"hold"|"collapse"|"refresh"|"none"}
 */
export function navIntent(o = {}) {
	if (Boolean(o.pinned)) return NAV_INTENT.HOLD;
	if (o.hasMatch) {
		return String(o.level || "") === LEVEL_SESSION ? NAV_INTENT.COLLAPSE : NAV_INTENT.REFRESH;
	}
	return o.dialogOpen ? NAV_INTENT.COLLAPSE : NAV_INTENT.NONE;
}

/** 供离线闸门做"同值对拍"（零依赖：不 import store，靠断言守一致性） */
export const __LEVEL_SESSION_FOR_TEST = LEVEL_SESSION;
