/* @map:begin —— 由 scripts/gen-source-map.mjs 生成，勿手改（重跑本脚本即可刷新）
 * 职责：A5 总监文档 store（V8）
 * 引用：—
 * 上游：client-entry.js
 * 下游：store/idb.js
 * 设计稿：docs/50-信息中心/V16-设计图·需求图·交互逻辑.html（板块 —）
 * 索引：dsh-director-plugin/docs/12-源码映射索引.md
 * @map:end */
/**
 * store/docs.js — A5 总监文档 store（V8）
 *
 * 迁移源：client.js 5966 ~ 6035（70 行）
 *   区块标记：`// V8: 总监文档 store`
 *
 * 职责：总监文档库的响应式状态容器 —— docs / folders 的 CRUD + 订阅通知 + 首次初始化种子数据。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 状态契约（subscribe 回调收到的 state 形状，**不可改字段名**）
 * ═══════════════════════════════════════════════════════════════════
 *   { docs: Doc[], folders: Folder[], loading: boolean, initialized: boolean }
 *
 * Doc    : { docId, docName, docType, folderId|null, content, tags[], createdAt, updatedAt }
 * Folder : { folderId, folderName, docType, createdAt }
 *
 * 对外 API（**与原实现方法名逐一对应**）：
 *   getState() / subscribe(fn) / init() / createDoc() / updateDoc() / deleteDoc()
 *   createFolder() / getDocsByType() / getDocsByFolder()
 *
 * 依赖（本插件模块）：`idb.js` —— idbListFolders / idbListDocs / idbSaveFolder / idbSaveDoc / idbDeleteDoc
 *
 * ⚠️ 注意（原样保留的行为，勿"顺手优化"）：
 *   1. `init()` 有 `state.initialized` 短路 —— 重复调用不重复加载。
 *   2. 种子数据创建条件为 `folders.length === 0 && docs.length === 0`（同时为空才播种）。
 *   3. 种子文档 `doc-sample-2` 的 docType 为 `"requirement_index"`，**不在 DIRECTOR_DOC_TYPES 中**，
 *      故其 folderId `folder-requirement_index` 指向一个不存在的文件夹 —— 历史遗留，保持原状。
 *   4. `createDoc` / `createFolder` 的 id 使用 `Math.random()` —— 与设计规范「禁用 Math.random」
 *      冲突，但此处**非确定性 RNG 场景**（仅用于 id 去重，不做游戏/仿真逻辑），
 *      为保证与既有持久化数据 id 形态一致，**原样保留**。
 */

import { idbListFolders, idbListDocs, idbSaveFolder, idbSaveDoc, idbDeleteDoc } from "./idb.js";

/* ── 硬编码值提取为具名常量 ────────────────────────────────────────── */

/** 总监文档类型枚举（原：DIRECTOR_DOC_TYPES） */
export const DIRECTOR_DOC_TYPES = [
  { key: "core_memory", label: "核心记忆", color: "#e3f2fd" },
  { key: "project_index", label: "项目索引", color: "#fff3cd" },
  { key: "execution_constraints", label: "执行约束", color: "#d4edda" },
];

/** 文件夹 ID 前缀（原："folder-" + t.key） */
export const FOLDER_ID_PREFIX = "folder-";

/** 文档 ID 前缀（原："doc-" + Date.now() + "-" + rand） */
export const DOC_ID_PREFIX = "doc-";

/** 随机后缀长度（原：Math.random().toString(36).slice(2, 6) → 4 字符） */
export const DOC_ID_RAND_LEN = 4;

/** 文档内容 / 文件夹 / 订阅 等公共默认值 */
const EMPTY_STATE = { docs: [], folders: [], loading: false, initialized: false };

/**
 * 首次初始化种子文档（原实现内联在 init() 中，此处上提为常量便于核对）。
 * @param {number} now 时间戳
 * @returns {Array<object>}
 */
function buildSampleDocs(now) {
  return [
    {
      docId: "doc-sample-1",
      docName: "总监执行规范",
      docType: "core_memory",
      folderId: "folder-core_memory",
      content: "# 总监执行规范\n\n1. 理解用户意图\n2. 拆解任务步骤\n3. 执行并验证\n4. 归档结果",
      tags: ["规范"],
      createdAt: now,
      updatedAt: now,
    },
    {
      docId: "doc-sample-2",
      docName: "当前项目需求",
      docType: "requirement_index",
      folderId: "folder-requirement_index",
      content: "# 当前项目需求\n\n- 对话滚动定位\n- 总监持久化\n- 本地模型打通",
      tags: ["需求"],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** 生成随机 id 后缀（4 字符 base36） */
function randSuffix() {
  return Math.random().toString(36).slice(2, 2 + DOC_ID_RAND_LEN);
}

/**
 * 创建总监文档 store（工厂函数，原样保留：每次调用产生独立实例）。
 */
export function createDirectorDocsStore() {
  let state = { ...EMPTY_STATE };
  const listeners = /* @__PURE__ */ new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  return {
    getState: () => state,

    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async init() {
      if (state.initialized) return;
      state = { ...state, loading: true };
      notify();

      const [folders, docs] = await Promise.all([idbListFolders(), idbListDocs()]);

      // 首次初始化：创建默认文件夹和示例文档
      if (folders.length === 0 && docs.length === 0) {
        const now = Date.now();
        const defaultFolders = DIRECTOR_DOC_TYPES.map((t) => ({
          folderId: FOLDER_ID_PREFIX + t.key,
          folderName: t.label,
          docType: t.key,
          createdAt: now,
        }));
        for (const f of defaultFolders) await idbSaveFolder(f);

        const sampleDocs = buildSampleDocs(now);
        for (const d of sampleDocs) await idbSaveDoc(d);

        state = { docs: sampleDocs, folders: defaultFolders, loading: false, initialized: true };
      } else {
        state = { docs, folders, loading: false, initialized: true };
      }
      notify();

      if (typeof window !== "undefined" && window.__dshDebug) {
        window.__dshDebug.log("docs", "directorDocsStore initialized: " + folders.length + " folders, " + docs.length + " docs");
      }
    },

    async createDoc(docName, docType, folderId, content) {
      const docId = DOC_ID_PREFIX + Date.now() + "-" + randSuffix();
      const doc = {
        docId,
        docName,
        docType,
        folderId: folderId || null,
        content: content || "",
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await idbSaveDoc(doc);
      state = { ...state, docs: [doc, ...state.docs] };
      notify();
      return doc;
    },

    async updateDoc(docId, patch) {
      const doc = state.docs.find((d) => d.docId === docId);
      if (!doc) return null;
      const updated = { ...doc, ...patch, updatedAt: Date.now() };
      await idbSaveDoc(updated);
      state = { ...state, docs: state.docs.map((d) => (d.docId === docId ? updated : d)) };
      notify();
      return updated;
    },

    async deleteDoc(docId) {
      await idbDeleteDoc(docId);
      state = { ...state, docs: state.docs.filter((d) => d.docId !== docId) };
      notify();
    },

    async createFolder(folderName, docType) {
      const folderId = FOLDER_ID_PREFIX + Date.now() + "-" + randSuffix();
      const folder = { folderId, folderName, docType, createdAt: Date.now() };
      await idbSaveFolder(folder);
      state = { ...state, folders: [...state.folders, folder] };
      notify();
      return folder;
    },

    getDocsByType(docType) {
      return state.docs.filter((d) => d.docType === docType);
    },

    getDocsByFolder(folderId) {
      return state.docs.filter((d) => d.folderId === folderId);
    },
  };
}

/** 单例（原实现：`const directorDocsStore = createDirectorDocsStore();`） */
export const directorDocsStore = createDirectorDocsStore();
