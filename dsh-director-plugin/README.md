# dsh-director-plugin — 总监驾驶舱插件包

> 26号文 P0 阶段产物（T-PLUG-004）。目标：把内联在 dsh-client-ui-conversation/lib/client.js 里的总监功能迁为独立插件，走 Harness 官方 client 插件通道。
> **施工图**：`docs/01-插件迁移明细清单.md`（v3）— 含 19 个迁移块 + 依赖拓扑 + 风险登记 + 行号导航表。

## 迁移进度

| 批次 | 内容 | 状态 |
|:----:|:-----|:-----|
| 1 | A14 剥离 / A3+D3 日志 / A11 布局 store / A12 主题 store / C1 布局探针 / C2 模型配置 | ✅ **已完成 2026-09-11** |
| 2 | A1 消息 store / A2 记忆 CRUD / **A4 分支创建** / **A5 docs store** / V10 Cookie / IndexedDB 主层 | ✅ **已完成 2026-09-11** |
| 3 | A6 文件通道 / **A7+A8 持久化读写** / **A9 createDirectorStore** / **A10 useDirectorStore** | ✅ **已完成 2026-09-11** |
| 4 | **D1 directorProcess** / **D2 审核（保留不调用）** | ✅ **已完成 2026-09-11** |
| 5 | **E1 DirectorFlow**（E2 DirectorView ⛔ 已废弃） | ✅ **已完成 2026-09-11** |
| 6 | F3 接线（改 1 行）/ F1+F2+F4+G1+G4 零改动 / F5 ⛔ 已由 MOD-B 退坡 | 🔴 **方案就绪，待授权**（须改宿主 `workspace/` `client.js`，`.gitignore` 排除） |

**✅ 已真机装载**（2026-09-11）：插件已被 Harness 实际加载并运行 —— `__DSH_BOOT__` 42 entries 含本包，**27 项全局契约全挂载**，`__dshDocsIndex` **docCount=90**（A14 外置资源回填成功）。详见 `docs/01-插件迁移明细清单.md` §八。

**八层验证（批次 9 全绿 · 合计 523 项）**：源码级 **96/96** ｜ bundle 级 **63/63** ｜ 安装链路级 **60/60** ｜ 三层结构 **65/65** ｜ 自动同步 **66/66** ｜ 总监逻辑 **92/92** ｜ 数据安全 **42/42** ｜ 真机契约 **39/39**。另有 **真机逐交互点击验证 66/66**（`scripts/cdp-click.mjs`，22 小节覆盖全部 30 个可交互元素，每项「点击 → 回读实际状态 → 比对预期」）。产物 `lib/client.js` **279,841 B / 32 模块**，React 零打包。

**批次 9 关键成果（2026-09-12 · `T-PLUG-005-B9`）**：见下「批次 8 关键成果」——文档内沿用简称「批次 8」。
> 📌 **编号说明**：本批次正式编号为 **`T-PLUG-005-B9`**，与 `T-PLUG-005-B8`（自动同步 + 覆盖度自检，提交 `815d4d7`）**是两个不同批次**；产物名 `verify-batch8.mjs` / `cdp-click.mjs` 为历史既成命名，保留不改。

**T-PLUG-009 数据兼容与边界安全（2026-09-12）**：新增 `scripts/verify-data-safe.mjs`（**42/42**）。证明宿主机 `dsh-director-db` v3 六 store 条数**零增零减**、版本/store 集合未变、宿主数据源分毫未动、插件与宿主**双向读取互不可见**（动态反证）。🔴 顺带修掉一个「**约定失效即静默**」缺陷：层级节点过滤原用 `n.level` **真值判断**，一条带任意 `level` 字段的宿主记忆记录即可混入总监树（实测泄露 2 条、树节点虚增 2，**不报错**）→ 收紧为 **schema 白名单** `isHierarchyNode`，附改前/改后反证。含 1 项开放观察 `F-DATA-01`。详见 [`docs/07-数据兼容与边界安全验证.md`](./docs/07-数据兼容与边界安全验证.md)。

**批次 8 关键成果（2026-09-12）**：把「总监」从**数据结构**补成**真的在按文档干活** —— 新增 `logic/duties.js`（§3.1 五项职责 + prompt）、`store/duty-config.js`（§3.2 三级继承/覆盖/向上提交）、`logic/director-run.js`（§1.2 五步执行 + 自动转发 + 自动审核）、`components/DirectorWorkbench.js`（执行逻辑面板 + 对话流）。真机逐交互验证 **66/66**，并修掉 5 个只有真机才暴露的缺陷（含「面板空白」「发送无反应」两个阻断级）。详见 [`docs/06-总监逻辑完善：方案选型与缺失清单.md`](./docs/06-总监逻辑完善：方案选型与缺失清单.md) §七。

**批次 7 关键成果（2026-09-12）**：落实「每一个对话都有一个总监 · 每一个文件夹都有总监 · 最上层全局总管负责」。新增 `logic/discover.js`（数据源发现）+ `logic/sync.js`（幂等自动同步 + 覆盖度自检）+ `util/bus.js`（变更通知）。真机实测：**会话 8/8 · 文件夹 2/2 · 全局 1/1 = 100% 覆盖**。详见 `docs/05-自动同步与覆盖度自检.md`。

## 批次 7：多层级总监结构（对话级 / 文件夹级 / 全局级）

需求依据 **03号文 §1.3 三层总监体系 + §3.2 继承制 + §4.3 降级**，**17号文 §2.1 MemoryNode / §2.3 继承 / §1A.13 分层汇总**。
三方案五维评分选型 → **方案 C（层级树 + 主内容区，42/50）**，详见 [`docs/04-多层级总监结构设计与方案选型.md`](./docs/04-多层级总监结构设计与方案选型.md)。

| 模块 | 职责 |
|:--|:--|
| `src/store/hierarchy.js` | 三层节点 CRUD（global/project/session）+ 继承解析 + 面包屑。统一复用 `memoryCore`（**不新增 IDB store、不升 DB 版本**——宿主与插件共享 `dsh-director-db` v3） |
| `src/logic/summarize.js` | 分层总结 + 分梯度调用：**G0 规则抽取 → G1 本地模型 → G2 上层汇总**；Ollama 不可用按 §4.3 回落 G0 |
| `src/components/DirectorHierarchy.js` | 左「三级层级树」+ 右「meta/总结/子级摘要/操作」双栏 |
| `src/mount.js` | 挂载：**宿主 slot 优先 + 浮层兜底**（兜底零宿主依赖，必定可见） |

**真机实测**：三层 6 节点建成落盘（global1/project2/session3）；`summarizeTree` 处理 6 节点，Ollama 未启 → 全降级 G0；右下角「总监层级」入口**已可见**（闭环此前「插件没了」的根因：宿主 2026-09-07 退坡删除总监视图注册，而插件侧从未注册入口）。
**验证**：`node scripts/verify-batch6.mjs` → **65/65 通过**。产物 **207,590 B / 25 模块**（平台外置含 `react-dom/client`，React 仍零打包）。

**批次 1 关键成果**：宿主 `client.js` **1,479,577 → 564,826 B（-914,751 B / -61.8%）** —— 单行 541KB 的 `DSH_DOCS_INDEX` 内联常量已外置为 `assets/docs-index.json`（含 docs/ 90 篇全文），改由插件运行时加载。

**批次 2 关键成果**：数据层 6 模块落地，4 个宿主直接调用的全局契约（`__dshMemory` / `__dshCreateBranch` / `__dshSwitchMemoryTab` / `__dshShowToast`）全部原样保留；XSS 转义（V9.4-P1）回归防线；R5 持久化 key 兼容性 8 项逐一校验。

**批次 3 关键成果**：持久化层 5 模块落地，**不端口宿主死代码**（T5 实测 legacy 三法全不可达）—— 改建 **FSA + OPFS + IndexedDB 三通道**；`useDirectorStore` 成为**插件首个平台模块消费者**，触发打包器「平台外置」能力扩展（产物内 `require("react")`，React 源码零打包，规避 ADR-001 双实例崩溃）。

**批次 4 关键成果**：逻辑层 2 模块落地（D1 113 行 / D2 36 行），**逐字保真**保留 V9.4-P1 并发锁、5 步链路与 300ms 转发延迟。**D2 为宿主有意保留的死代码**（三重证据见 `logic/review.js` 文件头）→ 迁移方式为「**只挂契约、不接线**」，并新增机器可读判据 `directorReviewWired === false` + 零调用点反证，使「有意不接线」与「迁移遗漏」可区分。D1/D2 均在**真机 realm 内实际调用成功**。

**批次 5 关键成果**：组件层 E1 `DirectorFlow` 落地（114 行），采用**命名空间导入**（`react` + `react/jsx-runtime`）使宿主代码体可逐字保留，二者均为平台模块 → 构建期外置为 `require(...)`，**React 源码零打包**（ADR-001）。🔴🔴 **同时发现并修复一处宿主缺陷**：`DirectorFlow` 引用的 `filteredMessages` 属**跨函数作用域越界引用**（定义在兄弟组件 `DirectorView` 内部，**自诞生即坏**；2026-09-08 P2 清理删除 `DirectorView` 后沦为完全未定义 ⇒ 必然 `ReferenceError`）→ 插件侧修正为 `state.messages`，并建立**四层防回退反证**（含真机 `toString()` 检查实际函数体）。详见清单 §一点五 E 区专节。

## 目录结构

```
dsh-director-plugin/
├── assets/docs-index.json    ← A14 外置资源（915,314 B / 90 篇全文）
├── build/build.mjs           ← 零依赖打包器（ESM → __ModuleLoader__ bundle）
├── cordis.patch.yml          ← host entry insert 补丁（官方契约同形）
├── docs/01-插件迁移明细清单.md ← 施工图 + 修改导航图（★ 改代码前先查这里）
├── docs/02-G区宿主注入点清单.md ← T6 交付（G 区锚点全量登记）
├── docs/03-批次6接线与退坡方案.md ← T11 交付（F 区重定级 + 精确改动清单 + 风险评估）
├── scripts/
│   ├── strip-a14.py          ← A14 剥离脚本（含 --dry-run）
│   ├── restore-a14.py        ← A14 回滚（含 --check）
│   ├── verify-batch1.mjs     ← 源码级验证（批次 1+2+3+4+5 锚点，96 项）
│   ├── verify-bundle.mjs     ← bundle 端到端（__ModuleLoader__ 桩执行，63 项）
│   ├── verify-install.mjs    ← ★ 安装链路离线验证（官方 loadProfile/ClientModuleRegistry，60 项）
│   ├── cdp-verify.mjs        ← ★ 真机运行时核查（CDP，39 项）
│   ├── cdp-eval.mjs          ← ★ 渲染进程任意表达式求值（调试）
│   └── run-r3-spike.mjs      ← ★ T5 文件通道可达性探测
├── src/
│   ├── client-entry.js       ← 浏览器侧入口（installBatch1）
│   ├── index.js              ← 骨架导航表（block ↔ 文件 ↔ 源行号）
│   ├── util/   debug.js · log-collector.js
│   ├── store/  layout.js · theme.js · docs-index-inject.js
│   │            messages.js · memory.js · branch.js · docs.js   ← 批次 2 数据层
│   │            cookie.js（V10 分块）· idb.js（IDB 主层）
│   ├── config/ model.js
│   └── bridge/ spike-fs-probe.js（T5 R3 验证）
├── lib/index.js              ← host face（cordis 插件，no-op 留痕）
└── lib/client.js             ← 构建产物（__ModuleLoader__.load 包裹）
```

## 官方通道（勘察结论，详见 docs/50-信息中心/插件加载通道勘察-20260907.md）

1. 本包 package.json 声明 dsh.client（platform/inject/immediately）。
2. host 侧 dsh-client-modules 增量扫描 host Loader entries 中声明 dsh.client 的包（**plugin-set 变更重启生效**）。
3. bundle 由 host webserver 在 /plugins/<id>/client.js 提供；index.html 被注入 window.__DSH_BOOT__。
4. 浏览器端 prefetch → cordis Loader 逐行 create → 全 ACTIVE 后 settled。
5. bundle 内 require 解析范围 = 平台模块表 + boot graph 注入包；跨插件 value import 是构建错误。

## 验证（四层，逐层加硬）

```bash
# ① 源码级：批次 1+2 契约与不变量（66 项）
node dsh-director-plugin/scripts/verify-batch1.mjs

# ② bundle 级：在 __ModuleLoader__ 桩中真实执行 factory
node dsh-director-plugin/scripts/verify-bundle.mjs

# ③ 安装链路级：用官方 loadProfile / ClientModuleRegistry 真跑（37 项）
node dsh-director-plugin/scripts/verify-install.mjs

# ④ 真机级：Harness 运行中经 CDP 核查渲染进程（15 项）
node dsh-director-plugin/scripts/cdp-verify.mjs

# 辅助
node --check dsh-director-plugin/src/**/*.js                 # 语法校验
python dsh-director-plugin/scripts/restore-a14.py --check    # A14 回滚锚点自检
```

## 构建

```bash
node dsh-director-plugin/build/build.mjs     # src/*.js → lib/client.js（零依赖打包器）
```

打包器把 ESM 源码按拓扑序展平为 `window.__ModuleLoader__.load({ id, factory })` 单文件 bundle；
平台模块（react/cordis/ui-slots 等）不打包，由 `require` 提供。

## 安装（**已完成**，2026-09-11）

| 步骤 | 动作 |
|:----:|:-----|
| 1 | 构建：`node build/build.mjs` |
| 2 | 复制 `lib/ assets/ cordis.patch.yml package.json README.md` 到 `resources/host/node_modules/@deepseek-ai/dsh-director-plugin/` |
| 3 | 在 `~/.dsh/profiles/node_modules/@deepseek-ai/` 建 junction 指向步骤 2 的目录（供 profile 侧解析） |
| 4 | 在 `~/.dsh/profiles/web/cordis.patch.yml` 追加 `insert: [{ id: deepseek-ai.director, name: '@deepseek-ai/dsh-director-plugin' }]` |
| 5 | 清渲染缓存（`Cache`/`Code Cache`/`GPUCache`，**保留 cookies/IndexedDB**）→ 完整重启 Harness |
| 6 | 验证：`node scripts/verify-install.mjs` + `node scripts/cdp-verify.mjs` |

### 🔴 带调试端口启动（复现验证必需）

本机 shell 环境带 `ELECTRON_RUN_AS_NODE=1`，会使 Electron 退化为纯 Node 并拒绝 Chromium 开关
（报 `bad option: --remote-debugging-port=9222`）。必须清除：

```bash
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=9222
```

并以**后台常驻**方式启动（普通 `&` 会随 shell 退出被回收）。

## 开发与运行环境标识（判定当前状态用）

```bash
# 插件安装点
ls "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness/resources/host/node_modules/@deepseek-ai/dsh-director-plugin"
# profile 侧解析链
ls "C:/Users/15142/.dsh/profiles/node_modules/@deepseek-ai/" | grep director
# 用户补丁层
cat "C:/Users/15142/.dsh/profiles/web/cordis.patch.yml"
```

> 若本目录的内容有改动，**必须重新执行步骤 1/2/5**（重新构建 + 重新复制 + 重启），
> 否则运行的是旧 bundle。`/plugins/<id>/client.js?rev=<hash>` 的 rev 随内容变化，
> 但 **client bundle 的发现发生在 host 启动时**，新增/删除插件包必须重启。

## 开放点

- ✅ host 侧包发现 —— 已实测（`composeEntries` 133 entries，本包 entry 唯一）。
- ✅ `dsh.client.inject` 的 require 可达边界 —— 已实测（本包不 require 平台模块）。
- ✅ **R3**：插件通道三法可达性 —— **实测 `ALL_UNREACHABLE`**，改建 FSA + OPFS 方案（T5 闭环，见清单 §8.5）。

## 回滚

删除三处安装点即完全退出插件通道：① host `node_modules` 包目录 ② profile 侧 junction ③ profile `cordis.patch.yml` 中的 insert 行。client.js 主补丁不受影响。

**A14 剥离回滚**：从 `snapshots/snapshot-20260908-131412-before-apply/` 取回 `dsh-client-ui-conversation/lib/client.js`（1,479,577 B 原版），或从 `assets/docs-index.json` 反向内联。
