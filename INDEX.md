# dsh-client-mod — 项目入口

> **这是什么**：DeepSeek Harness 桌面客户端的**插件化改造工程**。
> 不改宿主安装包（`original/` 只读），以独立插件 `dsh-director-plugin` 向宿主注入「总监」能力
> —— 原生 tab 环、弹窗驾驶舱、多智能体编排、会话血缘与派发回收。
>
> 创建 2026-08-24 ｜ 最后更新 2026-09-17

---

## 一、30 秒上手

```bash
# ① 接手第一步：看代码有没有漂移（唯一入口）
cd dsh-director-plugin && node scripts/baseline-check.mjs
#    必须得到 IS_PASS: TRUE（漂移=0）；FALSE 先 --write 重封，漂移态下不得引用锚点

# ② 索引对不对账（三份自动索引）
node scripts/refresh-index.mjs --check

# ③ 改完代码的闭环（详见 §四 命令链）
node scripts/gen-key-files.mjs && node build/build.mjs && node scripts/plugin-install.mjs --apply
```

> 🔴 **Harness 是 Electron 应用**：`plugin-install --apply` 之后**必须重启**才生效（缓存不重启不刷新）。

---

## 二、仓库地图

```
dsh-client-mod/
├── AGENTS.md               ★ 项目最高约束（纪律全表 + 闸门纠错台账 + 坑索引）
├── INDEX.md                ← 本文件（人的入口）
├── dsh-director-plugin/    ★ 主管道：插件本体（唯一在维护的代码）
│   ├── src/**              源码（全部业务逻辑）
│   ├── build/build.mjs     构建器 → lib/client.js
│   ├── lib/client.js       构建产物（装机用）
│   ├── scripts/**          工具与闸门（构建 / lint / verify / 真机 e2e）
│   ├── docs/**             插件侧设计文档与索引
│   └── assets/             运行时资源（docs-index.json 等）
├── docs/                   项目文档（8 个分类目录）
├── scripts/                根级工具链（PowerShell 为主）+ 索引生成器
├── original/               🔴 原始备份（只读，不可删）
├── workspace/              早期修改工作区（已退坡，保留）
└── snapshots/              🔴 唯一回滚点在 host-b6-20260911-before-patch/
```

---

## 三、去哪看细节（先看这两份，再按需展开）

| 你要什么 | 去哪 |
|:---------|:-----|
| **项目现状的唯一权威描述** | `docs/00-统筹入口/10-当前基线-落死锚点-V16.md` 🔴 |
| **所有索引的导航** | `docs/00-统筹入口/05-项目大索引.md` |
| 全资源零遗漏清单（源码/脚本/文档逐条） | `docs/00-统筹入口/项目全资源确定索引.md`（自动生成） |
| 改代码前必读：踩坑与快速定位 | `docs/50-信息中心/01-Harness客户端修改-踩坑记录与快速定位索引.md` 🔴 |
| 测试该跑哪些（增量判据） | `docs/40-测试质量/22-测试流程与增量测试矩阵-20260917.md` 🔴 |
| 业务不变量（总监/对话架构） | `dsh-director-plugin/docs/10-总监与对话架构总纲.md` 🔴 |
| 待办 / 归档 / **断点恢复** | `docs/00-统筹入口/03-待完成任务清单.md` · `04-…` · `06-工作快照.md` |
| 需求与决策台账 | `02-项目总需求清单.md` · `01-项目共同记忆.md` |

---

## 四、改一处功能的闭环命令链

```bash
# 索引先对账（漂移时人工索引会误导你）
node dsh-director-plugin/scripts/refresh-index.mjs --check

# 改 src/**（界面改动先改设计稿）→ 生成源码映射注入
cd dsh-director-plugin
node scripts/gen-key-files.mjs          # 改 src 必跑；它会改 src/logic/key-files.js
node scripts/gen-source-map.mjs         # 可选：刷新 @map 血缘块（会改 src）
node scripts/refresh-index.mjs --safe   # 重建索引（不碰 src）

# 静态闸门（四把 lint）
node scripts/lint-syntax.mjs && node scripts/lint-undefined-symbols.mjs \
  && node scripts/lint-cdp-templates.mjs && node scripts/lint-platform-stub.mjs

# 测试：先规划、再批量（不要一律全量跑）
node scripts/test-plan.mjs --explain     # 只读：该跑哪些 / 为什么
node scripts/test-plan.mjs --run --record # 离线批：一条命令跑完

# 构建与装机（看对账两行：语法自检 + import 对账 N = N）
node build/build.mjs && node scripts/check-stale-build.mjs
node scripts/plugin-install.mjs --apply
# → 重启 Harness（确认端口号变化）→ 真机套件整批只冷启动一次：
node scripts/run-live.mjs <真机套件…>
```

---

## 五、五条最容易踩的铁律

| # | 铁律 |
|:-:|:-----|
| 1 | **冻结契约只许新增，不可改名**（`ROUTE` / `DESTINATION` 等跨版本契约） |
| 2 | **先证前提再断结果** —— 报红先问"前提成立吗"（页面在不在 / 产物新不新 / 起点建没建） |
| 3 | **跳过比红更危险** —— 判据宁可写宽（假红有人看），不许写窄（假绿没人看） |
| 4 | **清缓存不删 `Network`** —— 它是 cookie 存储，删它等于清掉总监全部状态 |
| 5 | **改 `src/**` 一律 LF**；模板串内**禁反引号与 `${`**（会提前终止 / 开启插值） |

> 完整纪律见 `AGENTS.md`（编号 1–102，跨日志交叉引用，勿重排）。

---

## 六、变更记录

| 日期 | 变更 |
|:----:|:-----|
| 2026-08-24 | 项目创建，基础框架完成（备份 / 初始化 / 应用 / 复原 / 状态 / 差异 / 快照） |
| 2026-09-06 | V10 总监控制台整改完工；git 仓库初始化；`INDEX.md` 建立 |
| 2026-09-11 | 项目认知初始化报告（07 号）；V11/V12 设计稿纳管；台账漂移整改 |
| 2026-09-12 | A14 剥离：改走**插件通道**，不再改宿主安装包；基线锚点机制落地（`baseline-check`） |
| 2026-09-17 | **索引体系重构**：手工索引瘦身为入口（从根上消除"手工清单必然过期"）；新增 `refresh-index` / `verify-index`；全资源索引补 `--check` 并排除自指；测试流程与增量测试矩阵落地（40-22） |

*更细的过程记录见 `docs/00-统筹入口/06-工作快照.md` 与 `.workbuddy/memory/` 下的日志。*
