# dsh-director-plugin — 总监驾驶舱插件包

> ## ★ 当前基线（V16 · 2026-09-12 落死）
>
> **项目现状的唯一权威描述在** → [`docs/00-统筹入口/10-当前基线-落死锚点-V16.md`](../docs/00-统筹入口/10-当前基线-落死锚点-V16.md)
>
> 动手前先跑这一条，确认你读到的不是过期的"现状"：
>
> ```bash
> cd dsh-director-plugin && node scripts/baseline-check.mjs
> # IS_PASS: TRUE（漂移=0） ⇒ 文档即事实，可放心照读
> # IS_PASS: FALSE        ⇒ 代码已漂移，先看清单再决定对齐哪边
> ```
>
> | 项 | 值 |
> |:---|:---|
> | 产物 | `lib/client.js` · **964,872 B** · 58 模块 · 绑定对账 **474 = 474**（185 条 import）· React 外置零打包 · `inject = ["slots","sessions"]` |
> | 源码 | `src/**` **60 个 js · 16,838 行**，**每个文件带 `@map` 映射头** |
> | 映射索引 | [`docs/12-源码映射索引.md`](./docs/12-源码映射索引.md)（生成器 `scripts/gen-source-map.mjs`，60 文件） |
> | 设计稿 | [`docs/50-信息中心/V16-设计图·需求图·交互逻辑.html`](../docs/50-信息中心/V16-设计图·需求图·交互逻辑.html)（A 高保真 / B 需求图 / C 交互逻辑 / **D 设计图工作室** / **E 保存·版本·窗口安全区** / **F 思维导图元素库 18 条总账** / **G 单框控件·拖动·右侧对话·四维流转·质感与个性化**） |
> | 本轮新增 | **批次 15** —— 总监侧输入经**五步处理真正投递到原生对话**（`data-deliver-mode` 四态 · 三通道 `host-send`/`direct`/`open-then-send` · 宿主侧第三方送达凭据 `__directChatProbe`）· **分支链路聚焦**（默认只看本分支 / 「含上一层」/ 向下游下钻）· **导图总览弹窗**（左已完成 / 右待完成 · 分文件夹 · 可点选 · 可发修正）· **右下角两颗按钮「点不中」根因修复**（提示位改常驻等高槽，消除 23px 布局漂移）· 文案与命名整治 · **闸门纠错 5 处 + 导图零跳过** · **批次 12** —— 总监页背景采用原软件的背景（六令牌桥接宿主 `--dsw-alias-*`，与原生页签**同源同值** + 正负对照）· **批次 11** —— 单框展开/折叠与可拖动 · 点框右侧展开对话（首块＝「现在在做的事」）· 四处共用的**个性化设定**面板 · **四维流转** |
> | 基线闸门 | 静态 `TRUE`（阻塞 0 / 提示 16） · CDP 模板 `TRUE` · **平台桩唯一性 `lint-platform-stub` 9/9** · bundle 桩执行 **97/97** · 设计图纯函数 **49/49** · 版本层 **63/63** · 思维导图纯函数 **91/91** · 个性化+四维流转 **87/87** · 分支聚焦 **26/26** · 统筹编排 **33/33** · 设计稿卫生 **49/49** · 数据安全 **42/42** · 批次 1 **98/98** · 批次 6 **66/66** · 批次 7 **66/66** · 批次 8 **93/93** · **弹窗离线 `verify-dialog` 268/268** · 反证 `prove-dup-gate` 红/绿双证 · 构建 **964,872 B / 58 模块 · 474 = 474** · 指纹 `漂移=0` |
> | 真机 | `verify-flow.mjs` **68/68 ×3 · 零跳过**（五组原话 + 总监页背景 + 浮动入口三件套 F8–F11 + **G 段真流转**）· `verify-mindmap.mjs` **100/100 ×3 · 零跳过**（本轮由 81/0/5 提升）· `verify-design-studio.mjs` **90/90 ×3（载荷逐字一致）** · `verify-register-gate.mjs` **5/5 ×3** |
>
> 完整命令手册见锚点文档 §二。**不要再新开版本号** —— 基线演进就地更新锚点文档 + `baseline-check.mjs --write` 重新封存。

---

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

**九层验证（合计 536 项，离线全绿）**：源码级 **96/96** ｜ bundle 级 **63/63** ｜ 安装链路级 **60/60** ｜ 三层结构 **65/65** ｜ 自动同步 **66/66** ｜ 总监逻辑 **92/92** ｜ 数据安全 **42/42** ｜ **干净目录部署 52/52** ｜ 真机契约 **39/39**。另有 **真机逐交互点击验证 66/66**（`scripts/cdp-click.mjs`，22 小节覆盖全部 30 个可交互元素，每项「点击 → 回读实际状态 → 比对预期」）。产物 `lib/client.js` **279,841 B / 32 模块**，React 零打包。

**T-PLUG-008 插件部署单元（2026-09-12）**：新增 `scripts/plugin-install.mjs`（verify / `--apply` / `--uninstall` / `--purge`，默认**零写入**、**幂等**、写后**逐文件回读校验**、卸载**外科式**只删本插件 entry）与 `INSTALL.md`（安装权威说明）。**并新增 `scripts/verify-install-clean.mjs`（52/52）**：在临时沙箱里模拟「双机部署」全生命周期（干净 `--apply` → 幂等 → verify → uninstall → 从已卸载态再 apply → `--purge` → 真实环境零触碰反证）。
> 🔴 该测试**捕获了一个真实缺陷**：`PAYLOAD_FILES` 原先**漏了 `package.json`** —— 本机「一切正常」只因它早先被手工拷入（环境残留掩盖缺件）。而 host Loader **靠 `package.json` 发现本包**，缺件会让干净机器上「目录存在但插件永不被装载且不报错」。**此缺陷在单机幂等测试中必然漏检**（反证实测：移除后该测试 8 项转红，而安装器**自身的 `IS_PASS` 仍为 TRUE** ⇒ 安装器对自己的缺件是盲的）。
> 另随本轮修掉**同族缺陷 3 处**：`scripts/deploy.ps1`（退役为硬失败垫片）、`clear-cache.ps1`、`restart-harness.ps1` 均在清缓存列表里含 `Network` —— 那是 Chromium 的 **cookie 存储**，内含 `dsh_director_*` 持久化 cookie（R5 冻结契约），删除即**总监状态丢失**。详见 [`docs/07-数据兼容与边界安全验证.md`](./docs/07-数据兼容与边界安全验证.md)。

**批次 15 关键成果（2026-09-12 · `T-PLUG-024~028`）**：把总监从「有面板」推到「**真的能调度对话**」，并把「**审核本身**」也审了一遍。
1. 🔴 **核心基础设施**：总监侧输入**经五步处理 → 真正投递到原生对话**。真机证据链逐环可查：`G0` composer 在场 → `G2` 点「执行」落到 `mode=sent`（守「有归因」而非「必须成功」）→ `G2b` 走**首选通道 `host-send`**（不静默降级）→ `G6` **宿主侧第三方凭据** `__directChatProbe.called +1` → `G3` 消息 6 → 8（本条 user + 总监 assistant）→ `G3b` 助手消息含**五步结论** → `G4` **反证**：空输入点「执行」不新增任何消息。
2. **分支链路聚焦**（默认只看本分支 · 「含上一层」· 向下游下钻）+ **导图总览弹窗**（左已完成 / 右待完成 · 按文件夹分组 · 可点选 · 可发修正 · ✕ 无残留），含**分类口径对账**（两列之和 = 条目总数）。
3. 🖱️ **用户原话「两个按钮点击不好用」的真因不是按钮**：提示位原为「有内容才渲染」，而右下一列 `column-reverse`（后置兄弟即视觉底部）⇒ 提示一出现整条操作带被**顶上去 23px**（实测 `btnY 628 → 605`）。修：**常驻等高占位槽** + 闸门 `D5p`（出提示前后每颗按钮 y **逐像素不许变**）。文案与命名一并整治：删除实现细节解释，按钮只留标准动作名、解释下沉 `title`。
4. 🧾 **闸门纠错 5 处 + 导图跳过 5 → 0**：`batch1` 双向一致性（98/98）· `batch6` 版本序比较（66/66）· `bundle` 单调性（97/97）· `batch8` 五步全启用（93/93）· `mindmap` 退出聚焦 + `blankPoint()`（**81/0/5 → 100/0/0**，多出 19 条真断言）。**四套连跑 3 次全绿**：flow 67/67 · mindmap 100/100 · studio 90/90 · gate 5/5。详见 [`docs/13-总监闭环·分支流转·打分审核-需求与设计-V17.md`](./docs/13-总监闭环·分支流转·打分审核-需求与设计-V17.md) §六。

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
├── INSTALL.md                ← ★ 安装/卸载/验证权威说明（T-PLUG-008）
├── docs/01-插件迁移明细清单.md ← 施工图 + 修改导航图（★ 改代码前先查这里）
├── docs/02-G区宿主注入点清单.md ← T6 交付（G 区锚点全量登记）
├── docs/03-批次6接线与退坡方案.md ← T11 交付
├── docs/04~07-*.md           ← 多层级结构选型 / 自动同步 / 总监逻辑 / 数据安全
├── scripts/
│   ├── strip-a14.py · restore-a14.py   ← A14 剥离 / 回滚（含 --dry-run / --check）
│   ├── plugin-install.mjs    ← ★ 插件安装单元（verify/apply/uninstall/purge，默认零写入）
│   ├── verify-batch1.mjs     ← 源码级验证（96 项）
│   ├── verify-bundle.mjs     ← bundle 端到端（__ModuleLoader__ 桩执行，63 项）
│   ├── verify-install.mjs    ← 安装链路离线验证（官方 loadProfile/ClientModuleRegistry，60 项）
│   ├── verify-batch6/7/8.mjs ← 三层结构 65 / 自动同步 66 / 总监逻辑 92
│   ├── verify-data-safe.mjs  ← 数据兼容与边界安全（42 项）
│   ├── verify-install-clean.mjs ← ★ 干净目录部署验收（双机模拟，52 项）
│   ├── cdp-verify.mjs        ← ★ 真机运行时核查（CDP，39 项）
│   ├── cdp-click.mjs         ← ★ 真机逐交互点击验证（71 项 · 含职责配置快照/复原）
│   ├── cdp-eval.mjs          ← ★ 渲染进程任意表达式求值（调试）
│   └── run-r3-spike.mjs      ← ★ T5 文件通道可达性探测
├── src/                      ← 34 个 ESM 源文件
│   ├── client-entry.js       ← 浏览器侧入口（installBatch1）
│   ├── index.js              ← 骨架导航表（block ↔ 文件 ↔ 源行号）
│   ├── mount.js              ← 挂载（宿主 slot 优先 + 浮层兜底）
│   ├── util/                 debug.js · log-collector.js · bus.js（变更通知）
│   ├── store/                layout.js · theme.js · docs-index-inject.js
│   │                         messages.js · memory.js · branch.js · docs.js
│   │                         cookie.js（V10 分块）· idb.js（IDB 主层）
│   │                         create-store.js · use-store.js · persist.js · file-adapter.js
│   │                         hierarchy.js（三层节点）· duty-config.js（职责继承）
│   ├── logic/                process.js · review.js（有意不接线）· discover.js · sync.js
│   │                         summarize.js · duties.js · director-run.js
│   ├── components/           DirectorFlow.js · DirectorHierarchy.js · DirectorWorkbench.js
│   ├── config/model.js  ·  dev/layout-probe.js
│   └── bridge/spike-fs-probe.js（T5 R3 验证）
├── lib/index.js              ← host face（cordis 插件，no-op 留痕）
└── lib/client.js             ← 构建产物（__ModuleLoader__.load 包裹）
```

## 官方通道（勘察结论，详见 docs/50-信息中心/插件加载通道勘察-20260907.md）

1. 本包 package.json 声明 dsh.client（platform/inject/immediately）。
2. host 侧 dsh-client-modules 增量扫描 host Loader entries 中声明 dsh.client 的包（**plugin-set 变更重启生效**）。
3. bundle 由 host webserver 在 /plugins/<id>/client.js 提供；index.html 被注入 window.__DSH_BOOT__。
4. 浏览器端 prefetch → cordis Loader 逐行 create → 全 ACTIVE 后 settled。
5. bundle 内 require 解析范围 = 平台模块表 + boot graph 注入包；跨插件 value import 是构建错误。

## 验证（九层 + 真机逐交互，逐层加硬）

```bash
cd dsh-director-plugin
node scripts/verify-batch1.mjs          # ① 源码级：契约与不变量            96 项
node scripts/verify-bundle.mjs          # ② bundle 级：__ModuleLoader__ 桩执行 63 项
node scripts/verify-install.mjs         # ③ 安装链路：官方 loadProfile 真跑    60 项
node scripts/verify-batch6.mjs          # ④ 三层结构（对话/文件夹/全局）      65 项
node scripts/verify-batch7.mjs          # ⑤ 自动同步 + 覆盖度自检             66 项
node scripts/verify-batch8.mjs          # ⑥ 总监逻辑（职责/继承/五步执行）    92 项
node scripts/verify-data-safe.mjs       # ⑦ 数据兼容与边界安全（隔离反证）    42 项
node scripts/verify-install-clean.mjs   # ⑧ 干净目录部署（双机模拟）          52 项
node scripts/cdp-verify.mjs             # ⑨ 真机：CDP 核查渲染进程            39 项
node scripts/cdp-click.mjs              # ＋ 真机逐交互点击验证               71 项

# 设计图 / 分支导图（2026-09-12 新增）
node scripts/test-design-logic.mjs      # 设计图纯函数                        49 项
node scripts/test-design-version.mjs    # 版本层纯函数                        63 项
node scripts/test-mindmap-logic.mjs     # 思维导图纯函数（元素库 18 条自证）   69 项
node scripts/verify-design-studio.mjs   # 真机：设计图工作室逐交互            90 项
node scripts/verify-mindmap.mjs         # 真机：分支导图逐交互                100 项
node scripts/baseline-check.mjs         # 基线指纹：64 文件逐字节一致

# 设计稿卫生（在仓库根 D:/hermes-data/dsh-client-mod 下执行）
node scripts/verify-design-html.mjs "docs/50-信息中心/V16-设计图·需求图·交互逻辑.html"

# 辅助
node --check src/index.js                                    # 语法校验（逐文件）
python scripts/restore-a14.py --check                        # A14 回滚锚点自检
```

> 🔴 **两套真机套件必须连跑 3 次**（`verify-design-studio.mjs` / `verify-mindmap.mjs`）——
> 单跑通过只说明「第一次碰巧成立」；两套都出现过「前两次绿、第三次红」。
> 另：`verify-mindmap.mjs` 的断言全部基于**真实几何 + 真实鼠标事件**，脚本内含 `state(tag)`
> 现场勘察行；**失败时先看那一行**（页面当时是否还在），再看功能本身 ——
> 本轮曾出现「4 段全红其实只是导图层被关掉」，若没有这一行就会去改 4 个本来没坏的模块。
> 设计稿卫生五项（LF / 零反引号 / 字号 ≥10.5 / 标签平衡 / class 定义对账）必须 **5/5**。

> ⑧ 为**离线全生命周期**测试（临时沙箱，不触碰真实环境）；⑨ 与 ＋ 需 Harness **带调试端口运行中**（见 [`INSTALL.md`](./INSTALL.md) §四）。

## 构建

```bash
node dsh-director-plugin/build/build.mjs     # src/*.js → lib/client.js（零依赖打包器）
```

打包器把 ESM 源码按拓扑序展平为 `window.__ModuleLoader__.load({ id, factory })` 单文件 bundle；
平台模块（react/cordis/ui-slots 等）不打包，由 `require` 提供。

## 安装（**一条命令**，2026-09-12 起）

> 📖 **权威说明见 [`INSTALL.md`](./INSTALL.md)** —— 三处安装点原理、命令面、启动、验证、故障排查、回滚。
> 本处只留最小指引，避免同一事实两处维护。

```bash
node build/build.mjs                      # ① 源码改动后才需重建
node scripts/plugin-install.mjs --apply   # ② 安装（幂等；默认 verify 零写入）
node scripts/plugin-install.mjs           # ③ 自检 → 「✅ 已完整就绪」
# ④ 重启 Harness（见 INSTALL.md §四，注意 ELECTRON_RUN_AS_NODE 陷阱）
node scripts/cdp-verify.mjs               # ⑤ 真机核查 → 39/39
```

**三处安装点（缺一不可）**：① 实体包 `<Harness>/resources/host/node_modules/@deepseek-ai/dsh-director-plugin/` ｜ ② profile junction `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-director-plugin` ｜ ③ 用户补丁层 `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` entry `deepseek-ai.director`。

**回滚**：`node scripts/plugin-install.mjs --uninstall --purge`（client.js 主补丁不受影响）。

> ⚠️ `scripts/deploy.ps1` 已于 2026-09-12 **退役**（指向废弃旧路径 + 误删 `Network` 缓存）。其能力由 `plugin-install.mjs` 完整取代，且后者默认零写入、幂等、写后回读校验。

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
