/**
 * store/branch.js — A4 分支创建与记忆面板交互
 *
 * 迁移源：client.js 5835 ~ 5963（129 行）
 *   区块标记：`// ========== V9: 分支创建与记忆面板交互 ==========`
 *
 * 职责（4 个部分）：
 *   1. `createBranch()`        —— 创建分支对话（点击智能体时调用），写 memoryCore.branches
 *   2. `dshEscapeHTML()`       —— XSS 转义（V9.4-P1 修复，**不可省略**）
 *   3. `switchMemoryTab()`     —— 记忆面板三 Tab 渲染（memory / index / data）
 *   4. `showToast()`           —— 轻量 Toast 提示
 *
 * ═══════════════════════════════════════════════════════════════════
 * 全局契约（**不可改名**，宿主 / 其他模块直接引用）
 * ═══════════════════════════════════════════════════════════════════
 *   window.__dshCreateBranch(agentKey, agentLabel) -> branchInfo | null
 *   window.__dshCurrentBranch                      -> branchInfo（当前激活分支）
 *   window.__dshSwitchMemoryTab(tabIndex)          -> void
 *   window.__dshShowToast(msg)                     -> void（多处调用：branch / 记忆写回等）
 *
 * 自定义事件契约（**不可改名**）：
 *   `dsh-branch-created`  detail = branchInfo —— 通知 DirectorView 追加系统消息
 *
 * 依赖（均为本插件模块，非宿主）：
 *   - `idb.js`    : idbGetMemoryCore / idbSaveMemoryCore / idbListDecisions / idbListRisks
 *   - `memory.js` : MEMORY_DEFAULT_PROJECT_ID（= "default"）
 *
 * 错误处理：与原实现一致 —— createBranch 整体 try-catch，失败 console.error 并返回 null。
 */

import { idbGetMemoryCore, idbSaveMemoryCore, idbListDecisions, idbListRisks } from "./idb.js";
import { MEMORY_DEFAULT_PROJECT_ID } from "./memory.js";

/* ── 硬编码值提取为具名常量（原实现为散落的字面量） ────────────────────── */

/** 分支 ID 前缀（原："branch-" + agentKey + "-" + Date.now()） */
export const BRANCH_ID_PREFIX = "branch-";

/** 分支初始状态 */
export const BRANCH_STATUS_ACTIVE = "active";

/** 分支创建通知事件名（宿主 DirectorView 监听，**不可改名**） */
export const BRANCH_CREATED_EVENT = "dsh-branch-created";

/** 记忆面板容器元素 id（原：document.getElementById("dsh-memory-content")） */
export const MEMORY_CONTENT_EL_ID = "dsh-memory-content";

/** Toast 容器元素 id */
export const TOAST_EL_ID = "dsh-toast";

/** Toast 淡出延时（ms，原硬编码 2500） */
export const TOAST_FADE_MS = 2500;

/** 记忆面板 Tab 顺序（原：["memory", "index", "data"]） */
export const MEMORY_TABS = ["memory", "index", "data"];

/** 记忆面板：最近对话展示条数（原 slice(-3)） */
export const MEMORY_HISTORY_TAIL = 3;

/** 记忆面板：单条对话内容截断长度（原 slice(0, 50)） */
export const MEMORY_HISTORY_SNIPPET = 50;

/** 记忆面板：索引 / 风险列表展示条数（原 slice(0, 8)） */
export const MEMORY_LIST_LIMIT = 8;

/** 记忆面板：风险内容截断长度（原 slice(0, 60)） */
export const MEMORY_RISK_SNIPPET = 60;

/** 记忆面板：加载中 / 空态 / 失败 文案（集中管理，避免散落） */
const TEXT_LOADING = "<div style='color:#999'>加载中...</div>";
const TEXT_EMPTY_MEMORY = "<div style='color:#999'>暂无记忆，发送对话后自动生成</div>";
const TEXT_EMPTY_CORE = "<div style='color:#999'>暂无核心记忆</div>";
const TEXT_EMPTY_DECISIONS = "<div style='color:#999'>暂无决策索引</div>";
const TEXT_EMPTY_RISKS = "<div style='color:#999'>暂无风险/偏差数据</div>";
const TEXT_READ_FAIL = "<div style='color:#d32f2f'>读取失败</div>";

/**
 * V9.4-P1: HTML 转义 —— 记忆面板 innerHTML 拼接的 AI/用户生成内容必须转义，防 XSS 注入。
 * 覆盖 5 个危险字符：& < > " '
 * @param {*} s 任意值（null/undefined 归一为空串）
 * @returns {string} 转义后的安全字符串
 */
export function dshEscapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 创建分支对话（点击智能体时调用）。
 * ① 生成 branchInfo ② 追加到 memoryCore.branches（异步持久化）
 * ③ 设置 window.__dshCurrentBranch ④ 派发 dsh-branch-created 事件 ⑤ Toast 提示
 *
 * @param {string} agentKey   智能体键（用于生成 branchId）
 * @param {string} agentLabel 智能体显示名（用于 Toast / 记忆面板展示）
 * @returns {object|null} branchInfo；失败返回 null
 */
export function createBranch(agentKey, agentLabel) {
  try {
    if (window.__dshV9Log) {
      window.__dshV9Log.log("Branch", "创建分支: agentKey=" + agentKey + " agentLabel=" + agentLabel);
    }
    const branchId = BRANCH_ID_PREFIX + agentKey + "-" + Date.now();
    const branchInfo = {
      branchId: branchId,
      agentKey: agentKey,
      agentLabel: agentLabel,
      createdAt: Date.now(),
      status: BRANCH_STATUS_ACTIVE,
      task: "",
      projectCore: null,
    };
    // 保存分支信息到 memoryCore
    idbGetMemoryCore(MEMORY_DEFAULT_PROJECT_ID).then((core) => {
      const existing = core || { projectId: MEMORY_DEFAULT_PROJECT_ID, branches: [] };
      existing.branches = existing.branches || [];
      existing.branches.push(branchInfo);
      existing.updatedAt = Date.now();
      idbSaveMemoryCore(existing);
    });
    // 设置当前分支上下文
    window.__dshCurrentBranch = branchInfo;
    // 触发自定义事件，通知 DirectorView 添加系统消息
    try {
      const evt = new CustomEvent(BRANCH_CREATED_EVENT, { detail: branchInfo });
      window.dispatchEvent(evt);
    } catch (e) {}
    // 打印日志
    if (typeof window !== "undefined" && window.__dshDebug) {
      window.__dshDebug.log("branch", "创建分支并激活: " + JSON.stringify(branchInfo));
    }
    // 显示提示
    if (window.__dshShowToast) {
      window.__dshShowToast("已创建并激活" + agentLabel + "分支");
    }
    return branchInfo;
  } catch (e) {
    console.error("[DSH-Branch] 创建分支失败:", e);
    return null;
  }
}

/**
 * 记忆面板 Tab 切换与渲染。
 * Tab 顺序：0 = memory（核心记忆） / 1 = index（决策索引） / 2 = data（风险偏差）
 *
 * @param {number} tabIndex 0|1|2，越界回落 "memory"
 */
export function switchMemoryTab(tabIndex) {
  if (window.__dshV9Log) window.__dshV9Log.log("Tab", "切换记忆Tab: index=" + tabIndex);
  const contentEl = document.getElementById(MEMORY_CONTENT_EL_ID);
  if (!contentEl) {
    if (window.__dshV9Log) window.__dshV9Log.log("Tab", "错误: 找不到" + MEMORY_CONTENT_EL_ID + "元素");
    return;
  }
  const tab = MEMORY_TABS[tabIndex] || MEMORY_TABS[0];
  contentEl.innerHTML = TEXT_LOADING;

  if (tab === "memory") {
    idbGetMemoryCore(MEMORY_DEFAULT_PROJECT_ID)
      .then((core) => {
        if (!core) {
          contentEl.innerHTML = TEXT_EMPTY_MEMORY;
          return;
        }
        let html = "";
        if (core.positioning) html += "<div style='margin-bottom:3px'><b>定位:</b> " + dshEscapeHTML(core.positioning) + "</div>";
        if (core.goal) html += "<div style='margin-bottom:3px'><b>目标:</b> " + dshEscapeHTML(core.goal) + "</div>";
        if (core.currentPhase) html += "<div style='margin-bottom:3px'><b>阶段:</b> " + dshEscapeHTML(core.currentPhase) + "</div>";
        if (core.conversationHistory && core.conversationHistory.length > 0) {
          html += "<div style='margin-top:4px;border-top:1px solid #eee;padding-top:4px'><b>最近对话 (" + core.conversationHistory.length + "条):</b></div>";
          core.conversationHistory.slice(-MEMORY_HISTORY_TAIL).forEach(function (m) {
            html += "<div style='padding:2px 0;font-size:9px;color:#666'>- " + (m.role === "user" ? "我: " : "总监: ") + dshEscapeHTML((m.content || "").slice(0, MEMORY_HISTORY_SNIPPET)) + "</div>";
          });
        }
        if (core.branches && core.branches.length > 0) {
          html += "<div style='margin-top:4px;border-top:1px solid #eee;padding-top:4px'><b>活跃分支:</b></div>";
          core.branches.forEach(function (b) {
            html += "<div style='padding:1px 0;font-size:9px'>- " + dshEscapeHTML(b.agentLabel) + " (" + dshEscapeHTML(b.status) + ")</div>";
          });
        }
        if (!html) html = TEXT_EMPTY_CORE;
        contentEl.innerHTML = html;
      })
      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
  } else if (tab === "index") {
    idbListDecisions(MEMORY_DEFAULT_PROJECT_ID)
      .then(function (list) {
        if (!list || list.length === 0) {
          contentEl.innerHTML = TEXT_EMPTY_DECISIONS;
          return;
        }
        let html = "";
        list.slice(0, MEMORY_LIST_LIMIT).forEach(function (d) {
          html += "<div style='padding:2px 0;border-bottom:1px solid #eee'>";
          html += "<div style='font-weight:600;font-size:9px'>" + dshEscapeHTML(d.title || "未命名") + "</div>";
          html += "<div style='color:#888;font-size:8px'>" + new Date(d.createdAt || Date.now()).toLocaleDateString() + "</div>";
          html += "</div>";
        });
        contentEl.innerHTML = html;
      })
      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
  } else if (tab === "data") {
    idbListRisks(MEMORY_DEFAULT_PROJECT_ID)
      .then(function (list) {
        if (!list || list.length === 0) {
          contentEl.innerHTML = TEXT_EMPTY_RISKS;
          return;
        }
        let html = "";
        list.slice(0, MEMORY_LIST_LIMIT).forEach(function (r) {
          html += "<div style='padding:2px 0;border-bottom:1px solid #eee'>";
          html += "<div style='font-weight:600;color:#d32f2f;font-size:9px'>" + dshEscapeHTML(r.title || "未命名") + "</div>";
          html += "<div style='color:#888;font-size:8px'>" + dshEscapeHTML((r.content || "").slice(0, MEMORY_RISK_SNIPPET)) + "</div>";
          html += "</div>";
        });
        contentEl.innerHTML = html;
      })
      .catch(function () { contentEl.innerHTML = TEXT_READ_FAIL; });
  }
}

/**
 * 轻量 Toast 提示（惰性创建容器，复用同一 DOM 节点）。
 * @param {string} msg 提示文案（textContent 写入，无 XSS 风险）
 */
export function showToast(msg) {
  let toast = document.getElementById(TOAST_EL_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = TOAST_EL_ID;
    toast.style.cssText = "position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:8px 16px;border-radius:4px;font-size:12px;z-index:99999;opacity:0;transition:opacity 0.3s;";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  setTimeout(() => { toast.style.opacity = "0"; }, TOAST_FADE_MS);
}

/**
 * 幂等安装：把 4 个函数挂到 window 全局契约上。
 * 顺序与宿主原实现一致（createBranch → switchMemoryTab → showToast）。
 *
 * @returns {{createBranch:boolean, switchMemoryTab:boolean, showToast:boolean, escapeHTML:boolean}}
 */
export function installBranchApi() {
  const installed = { createBranch: false, switchMemoryTab: false, showToast: false, escapeHTML: false };
  if (typeof window === "undefined") return installed;
  window.__dshCreateBranch = createBranch;
  installed.createBranch = true;
  window.__dshSwitchMemoryTab = switchMemoryTab;
  installed.switchMemoryTab = true;
  window.__dshShowToast = showToast;
  installed.showToast = true;
  // dshEscapeHTML 原实现为模块内闭包（未挂 window）；此处保持同口径，仅以导出形式供本插件复用
  installed.escapeHTML = typeof dshEscapeHTML === "function";
  return installed;
}
