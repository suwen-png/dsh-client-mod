# dsh-client-mod 项目记忆（MEMORY.md）

> **项目记忆文件**：记录关键决策、ADR、风险注意事项、踩坑记录索引。AI 操作本项目前必须读取本文件。
> **创建日期**: 2026-08-27
> **项目定位**: DeepSeek Harness 原客户端修改工作区 — 备份-修改-符号链接-复原 全链路 + 总监对话模式

---

## 一、项目基本信息

| 字段 | 值 |
|------|-----|
| 项目名 | dsh-client-mod |
| 项目路径 | D:\hermes-data\dsh-client-mod |
| 项目类型 | Harness客户端修改工作区 |
| 技术栈 | JavaScript / PowerShell / Junction符号链接 / Ollama本地模型 |
| Harness版本 | 0.1.0-rc.5 → 0.1.0-rc.11（2026-09-01确认已升级） |
| 文档版本 | V1.0（2026-08-24初始化）→ V1.1（2026-08-27标准整改） |
| AGENTS.md | ✅ 已创建（2026-08-27） |
| 标准结构 | ✅ 已对齐 |
| 行为逻辑框架 | ✅ V1.2已同步 |
| 保障机制 | ✅ 四层保障已集成 |

---

## 二、关键决策记录（ADR）

### ADR-001：放弃外部bundle注入，直接修改编译产物
- **日期**: 2026-08-24
- **背景**: 最初考虑通过外部bundle注入方式修改Harness客户端，但发现模块解析复杂、注入点不稳定
- **决策**: 直接修改Harness原客户端的编译产物（lib/client.js等），在workspace/中修改，通过Junction符号链接替换原安装目录
- **理由**: 直接修改简单可控、修改位置明确、可一键备份复原
- **影响**: 修改风险较高，必须仔细测试；每次修改需清除缓存重启
- **状态**: ✅ 已执行

### ADR-002：文件级替换而非目录级Junction
- **日期**: 2026-08-24
- **背景**: 最初考虑目录级Junction替换整个包目录，但发现模块解析失败
- **决策**: 通过复制修改后的lib/client.js到原安装目录（文件级替换），避免目录级Junction的模块解析问题
- **理由**: 文件级替换更稳定，不影响模块解析
- **影响**: apply.ps1 需要处理文件复制而非目录链接
- **状态**: ✅ 已执行

### ADR-003：总监对话模式 + 三tab共存
- **日期**: 2026-08-24
- **背景**: 用户需要在Harness中增加总监对话模式，使用本地qwen2:7b模型预处理
- **决策**: 新增总监tab，与对话/轨迹三tab共存，数据完全共享，原功能100%保留
- **理由**: 不破坏原功能，用户可自由切换
- **影响**: 修改涉及主布局、对话页、侧边栏、插槽服务等多个包
- **状态**: ✅ 已执行（经历v1-v8多轮迭代）

### ADR-004：小窗分屏布局
- **日期**: 2026-08-24
- **背景**: 总监模式需要同时查看总监和对话内容
- **决策**: 总监tab左总监主+右对话小窗；对话tab左总监小窗+右对话主；全局单输入框，根据当前tab+焦点决定提交目标
- **理由**: 最大化利用屏幕空间，操作流畅
- **影响**: 布局修改复杂，需处理响应式和焦点管理
- **状态**: ✅ 已执行

### ADR-005：项目标准整改+行为逻辑框架同步
- **日期**: 2026-08-27
- **背景**: 项目缺少AGENTS.md、_memory/MEMORY.md，规范文档版本过旧（V1.0），缺少行为逻辑框架和保障机制
- **决策**: ①创建项目级AGENTS.md ②创建_memory/MEMORY.md ③同步最新规范文档（AI对话执行约束V1.3+行为逻辑审核文档+保障机制）④将四层保障机制集成到项目
- **理由**: 确保AI操作项目时按标准执行，避免违规
- **影响**: 项目规范体系完整，AI执行有保障
- **状态**: ✅ 已执行

### ADR-006：V9总监统治架构——渐进式改造而非全量重写
- **日期**: 2026-08-27
- **背景**: 用户提出宏大架构愿景（每对话一总监/沟通执行分离/分支分派/模型路由/多维度审核），但当前Harness客户端是编译产物，全量重写风险极高
- **决策**: ①采用渐进式改造，在现有总监面板基础上增加智能体区域+记忆面板 ②复用现有dsh-director-db，新增3个store而非新建数据库 ③分支用多对话模拟，流程图样式留待V10+ ④分5阶段实现（V9单项目驾驶舱→V10多项目→V11嵌套子项目→V12半自动路由→V13全自动路由）
- **理由**: 编译产物修改风险高，渐进式改造可快速验证核心体验，出问题可回滚
- **影响**: V9先实现基础能力（记忆体系/智能体区域/记忆面板/分支创建），后续版本逐步完善
- **状态**: ✅ 已执行（V9第一阶段T1/T5/T6/T7完成）

### ADR-007：V9 总监驾驶舱 UI 设计冻结决策（D1-D3）
- **日期**: 2026-09-01
- **背景**: V9 开发前先做完整 UI 设计（用户要求：简图→功能→样式，每部分三轮审核）
- **决策**: ①D1 a-2 固定右栏（废弃 V9.1 草图"对话区下方"，依据 ADR-004 小窗分屏）②D2 技能清单静态打包进 client.js（V10+ 再外部化）③D3 docs/ 读取通道 = apply.ps1 构建时生成 docs-index.json + 内容快照注入（浏览器端无 fs）④布局改纵向堆叠（R4导航在对话上、R6记忆在对话下，均可伸缩折叠，取消左列）⑤插件边界=只覆盖对话面主区，原生侧边栏保留 ⑥配色=Harness 暗色令牌 + 设置面板可调（主色4/记忆色3/密度2，localStorage `dsh-v9-theme`）
- **理由**: 用户三轮审核逐条确认；D3 备选（host Node/本地HTTP）侵入性更大
- **影响**: 开发按 18 号文附录I 10任务4批次执行；R3 新增技能Tab（总监自动/客户点击两路调用）
- **状态**: ✅ 已冻结（方案 V2.0 定稿，docs/20-任务文档/18-总监驾驶舱UI设计方案-简图功能样式三阶段.md）

---

## 三、风险与注意事项

### 3.1 高风险操作

| 操作 | 风险 | 防护措施 |
|------|------|---------|
| 修改 lib/client.js | 编译产物修改风险高，可能导致Harness崩溃 | ①workspace/中修改 ②apply前自动快照 ③仔细测试 ④restore.ps1一键回滚 |
| apply.ps1 应用修改 | 替换原安装目录文件，可能影响Harness运行 | ①自动快照 ②清除缓存 ③完全退出重启 ④出问题立即restore |
| 清除Harness缓存 | 可能清除用户数据（如登录状态） | ①只清除Cache/Code Cache/GPUCache/blob_storage/Network ②不清除Local Storage/Session Storage/IndexedDB |
| 修改总监对话模式 | 涉及多包联动，可能破坏原功能 | ①三tab共存原功能100%保留 ②修改后验证原对话功能正常 ③逐步迭代v1-v8 |

### 3.2 必须遵守的铁律

1. **永远不要直接修改原安装目录** — 只在 workspace/ 中修改
2. **apply 前自动快照** — snapshots/ 中保留每次应用前的工作区状态
3. **original/ 是只读复原源** — 除非重新备份，否则不要修改
4. **修改后必须清除缓存并完全退出 Harness 重启** — client.js?rev= 缓存机制要求
5. **所有操作有日志** — logs/dsh-mod-YYYYMMDD.log

### 3.3 环境依赖

- **Ollama 服务**：总监对话模式使用本地 qwen2:7b 模型，需确保 Ollama 服务运行
- **PowerShell**：所有自动化脚本使用 PowerShell，需在 Windows 环境运行
- **Harness 客户端**：需已安装 Harness 0.1.0-rc.5，config.json 中配置原安装路径
- **Node.js**：部分工具脚本可能需要 Node.js 环境

---

## 四、踩坑记录索引

详细踩坑记录见：`docs/50-信息中心/01-Harness客户端修改-踩坑记录与快速定位索引.md`

### 已知踩坑点（摘要）

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 修改后不生效 | client.js?rev= 缓存机制 | 清除 Cache/Code Cache/GPUCache/blob_storage/Network，完全退出重启 |
| 目录级Junction模块解析失败 | Junction链接导致模块路径解析异常 | 改用文件级复制替换 |
| 总监tab空白 | 布局渲染顺序问题 | 见 docs/20-任务文档/07-总监页面空白问题诊断文档.md |
| 对话滚动定位异常 | 消息排列位置和滚动逻辑 | 见 docs/20-任务文档/13-对话滚动定位与a2消息发送修复方案-v5.md |
| 小窗布局响应式异常 | flex布局和justify-content配置 | 见 docs/30-开发链路/消息排列位置-justify-flex-end草图.html |
| apply.ps1/restore.ps1 末尾调用 status.ps1 失败 | 用了 `.\status.ps1` 相对路径，从项目根目录运行时当前目录不是 scripts/ | 改为 `& (Join-Path $PSScriptRoot "status.ps1")`（2026-09-01修复） |
| zb2（对话 tab 正常对话主窗口）无法滚动 | V9.1 内联钉死 viewArea 高度 + 分屏外壳 overflow:hidden 双重破坏原版 scrollBody 统一滚动机制（消息列 .f7fkwa_scroll 自身 overflow:visible 不滚） | V9.4 zb2 自足滚动：scrollerOf 前置识别 data-chat-local-scroll + zb2 链补 minHeight:0/overflowY:auto（2026-09-01修复，见 20-任务文档/21 号文）；经验：改编译产物布局时滚动容器链必须全链检查 minHeight:0 |
| 手动备份文件放在包 lib/ 目录会被 apply.ps1 当新增文件部署 | apply 复制逻辑包含新增文件 | 手动备份统一放 `backups/` 目录（2026-09-01 起） |
| PowerShell脚本报语法错误（Unexpected token '}'） | 脚本是UTF-8无BOM编码，含中文，Windows PowerShell 5.1按GBK解读导致乱码，乱码中含引号/括号破坏语法解析 | 所有.ps1文件加UTF-8 BOM（2026-09-01修复，全量11个脚本已处理） |
| Harness启动失败：credentials.yaml 版本字段/refs字段必须是字符串 | Harness从rc.5升级到rc.11后，.credentials.yaml格式从旧版（version+refs包装层）改为纯key:value mapping，旧格式不兼容 | 改为 `DEEPSEEK_API_KEY: sk-...` 纯mapping格式，备份旧文件为.credentials.yaml.bak（2026-09-01修复） |
| z tab b1小窗/b-1顶栏硬编码浅色（暗色主题下刺眼、改色不联动） | V9 时期内联样式直写 #e8f5e9/#1565c0/#ccc 等 14 处 | V9.5 令牌化：新增 --dsh-bg1/--dsh-bg2/--border 三令牌 + 复用 --dsh-ac/dsw-alias-label-*，全部改 `var(--token, #fallback)` 形态（fallback 保留防裸奔）；智能体 chip 白底改 transparent（2026-09-01修复，见 22 号文） |
| Edit 工具匹配编译产物中含 `\u2014`/`\u25B6` 等转义字面量的行失败 | 文件里是字面 6 字符（反斜杠+u+码点），Edit 工具会把 old_string 里的转义序列解析成实际字符，永远匹配不上 | old_string 选取不含该字符的唯一子串（如 `fontSize: 14 }` 前半段），或改用 sed 按行处理（2026-09-01 沉淀） |

---

## 五、项目状态快照（2026-09-06 · 整改 V1.2 后）

### 5.1 整体进度

| 模块 | 状态 | 说明 |
|------|:----:|------|
| 基础框架（备份/修改/应用/复原） | ✅ 完成 | 脚本齐全；2026-09-01 修复 apply.ps1/restore.ps1 相对路径 bug |
| 总监对话模式 | ✅ 完成 | 经历 v1-v8 多轮迭代，三tab 共存，小窗分屏布局 |
| V9.4 zb2 滚动+P1 修复 | ✅ 完成 | 2026-09-06 整改 V1.2 中验证（46/46 测试通过） |
| V9 总监驾驶舱 | ✅ 完成 | D1-D3 设计冻结（ADR-007），18号文 V2.0 定稿 |
| V10 总监控制台 V3 | ✅ 完成 | 2026-09-06 三轮审核修复 6 个真实缺陷（B1-B6），lib/client.js V0.2.0 |
| V10 全量交互测试 | ✅ 完成 | Playwright CDP，46/46 通过，见 V10 V3 测试报告 |
| 本地模型集成 | ✅ 完成 | qwen2:7b 预处理，自动转发到原对话系统 |
| 项目规范体系 | ✅ 完成 | AGENTS.md+MEMORY.md+规范文档 V1.3+行为逻辑 V1.2+保障机制 V1.1 |
| 整改 V1.2（本次） | 🔄 进行中 | 文档/配置/版本同步+git 初始化+脚本审核报告 |
| 测试与质量门禁 | ✅ 完成 | V10 V3 测试报告 + 测试总清单 + 风险登记册 + 改进项清单 |

### 5.2 文档统计

| 类别 | 数量 | 说明 |
|------|:----:|------|
| 00-统筹入口 | 12 份 | 核心文档 + AI 规范文档 |
| 10-架构设计 | 7 份 | 架构说明 + 6 个管理规范 |
| 20-任务文档 | 27 份 | 开发文档 + 诊断 + 方案 + 审核 + 整改 |
| 30-开发链路 | 13 份 | 修改记录 + 复原手册 + V10 详细设计 + 设计图 HTML |
| 40-测试质量 | 8 份 | 总清单 + 风险登记 + 改进项 + 健康度 + 2 份 V10 测试报告 |
| 50-信息中心 | 8 份 | 踩坑 + 代码索引 + V10 设计图（HTML） |
| **合计** | **75 份 markdown + 9 份 HTML** | |

### 5.3 整改 V1.2 关键产出

| 输出 | 路径/内容 | 状态 |
|:-----|----------|:----:|
| config.json 版本同步 | `0.1.0-rc.5` → `0.1.0-rc.11` | ✅ |
| README.md 版本同步 | V1.0 → V1.1 + Harness rc.5 → rc.11 | ✅ |
| INDEX.md 同步 | 反映 V10 V3 完工 + 75 份 + 46/46 测试 | ✅ |
| MEMORY.md 快照补全 | §五 加 2026-09-06 标记 + V10 V3 完工 + 整改 V1.2 段 | ✅ |
| git 仓库初始化 | `.git/` + `.gitignore` + 首次 commit | ✅（见 §九） |
| 脚本审核报告 | `docs/40-测试质量/12-scripts探针审核-20260906.md` | ✅ |
| 整改总览文档 | `docs/20-任务文档/23-dsh-整改总览-V1.2-20260906.md` | ✅ |
| 待用户确认的清理候选 | scripts/_archived-20260831 + 一次性探针 + backups 临时文件 | 🟡 等待 |

---

## 六、违规记录

| 日期 | 违规内容 | 纠正措施 |
|------|---------|---------|
| 2026-08-27 | 项目缺少AGENTS.md和MEMORY.md，AI操作时未加载项目级约束 | 创建AGENTS.md和MEMORY.md，后续必须先加载必读集合再执行 |

---

## 七、后续优化方向

1. **补充自动化测试**：为总监对话模式、小窗布局、消息发送等核心功能补充自动化测试
2. **完善CI-CD流程**：建立修改→测试→应用的自动化流水线
3. **增加版本管理**：为每次重要修改打标签，便于追溯和回滚
4. **优化apply.ps1**：增加预检查（Harness是否运行、磁盘空间、文件完整性）
5. **建立用户数据备份机制**：apply前自动备份用户数据（Local Storage/IndexedDB），防止清除缓存时误删

---

*本文件创建: 2026-08-27（项目标准整改+行为逻辑框架同步+保障机制集成）*
*本文件最后更新: 2026-09-06（整改 V1.2：状态快照+V10 V3 完工标记+§九 整改 V1.2 段）*

---

## 八、V10总监控制台 V3 全量整改与测试（2026-09-06）

### 关键教训（必须复用）
1. **组件外函数禁止引用组件内闭包样式**：DModalEditor 在组件外却用了组件内 styles，一点新建就 ReferenceError 白屏、连锁卸载整树。共享样式必须抽到模块级（FORM_STYLES）。
2. **判断死代码必须递归分析 import**：BranchPanel 看似 V10 主路径无引用，实则被旧后备路径 DirectorChat 级联引用；误删即编译失败，已从 sourcemap(sourcesContent) 恢复。结论：director 目录无安全可删冗余。
3. **跨组件状态同源**：侧边栏入口与主覆盖层都要监听同一个 toggle 事件，不能各自维护 active，否则 X 关闭后入口再点打不开。
4. **字段回退**：默认数据用 label、文件/localStorage 数据可能用 name，展示与提示一律 name||label 双回退，避免 undefined。
5. **Electron 不用 window.prompt/confirm**：统一自定义弹窗（命名/确认），风格一致且不会被拦截。

### 测试方法固化
- GUI 测试统一 Playwright CDP（--remote-debugging-port=9222 + connectOverCDP + el.click()/fill/真实键盘），禁用鼠标坐标/PyAutoGUI（本环境已多次失败）。
- 每轮 page.reload 干净起步；元素选择器限定 .dsh-dir-app 范围，避免选到宿主页面同名 input/祖先元素。
- 每个可点元素必须断言"点击后正确状态"，不许只截图。脚本：dsh-director/test-v10-cdp-v3.mjs，当前 46/46。
- 控制台 ERR_CONNECTION_REFUSED(11434) = Ollama 未启动的设计内降级，非缺陷。

### 交付
- 测试报告：docs/40-测试质量/V10总监控制台V3-全量交互测试报告.md
- 三轮审核修复 6 个真实缺陷(B1-B6)，产物 lib/client.js V0.2.0。

---

## 九、整改 V1.2 完整记录（2026-09-06）

### 9.1 整改触发与目标
- **触发**：用户指令「初始化 加载主记忆 按照项目文档对当前项目实际开发情况进行优化整改」
- **依据**：AGENTS.md §一必读集合 + D:\workspace\AGENTS.md 全局约束 + 项目大索引 + 当前项目状态审计
- **方法论**：执行统一标准规范 V2.0.0 L3 12 步链路 + AI 自审 + 自动执行
- **范围**：文档同步 + 配置同步 + 脚本规范化审核 + git 初始化

### 9.2 已落地的低风险整改（10 项 AI 自动执行）

| # | 项 | 文件 | 关键变更 | 验证 |
|:-:|---|------|---------|------|
| 1 | config.json 版本同步 | config.json | harness_version 0.1.0-rc.5 → 0.1.0-rc.11 + version 1.1.0 → 1.2.0 + last_modified | grep |
| 2 | config/ 路径一致性核对 | config/*.json | 已有字段无更新需求 | grep 0 mismatch |
| 3 | INDEX.md 内容大幅更新 | INDEX.md | 「最后更新 2026-09-06」+ V10 V3 完工 + 75 份文档 + 整改段 | 章节存在 |
| 4 | README.md 版本号同步 | README.md | V1.0 → V1.1 + Harness rc.5 → rc.11 | grep |
| 5 | MEMORY.md §五 状态快照 | _memory/MEMORY.md | 反映 2026-09-06 + V10 V3 完工 + 整改 V1.2 段 | 内容存在 |
| 6 | git 仓库初始化 | .git/ + .gitignore | 首次 commit，含 gitignore 8 类排除规则 | git log = 1 commit |
| 7 | _memory/_snapshots/_archive 启用 | _memory/_snapshots/_archive/README.md | 建立工作机制文档 | README 存在 |
| 8 | scripts/ 探针审核报告 | docs/40-测试质量/12-scripts探针审核-20260906.md | 60+ 脚本去重候选清单 | 报告存在 |
| 9 | 整改总览文档 | docs/20-任务文档/23-dsh-整改总览-V1.2-20260906.md | 12 项任务执行结果汇总 | 文件存在 |
| 10 | 工作快照 | docs/00-统筹入口/06-工作快照.md | 补全整改 V1.2 章节 | 章节存在 |

### 9.3 清理段执行结果（2026-09-06 22:30-22:39 · 用户授权「除了 git 其他都同意」）

| 编号 | 任务 | 删除前 | 删除后 | 释放 | 状态 |
|:----:|------|:------:|:------:|:----:|:----:|
| T-V12-001 | scripts/_archived-20260831/ | 28 文件 | 0 | 90KB | ✅ |
| T-V12-002 | scripts/ 一次性探针 | 49 文件 | 0 | ~140KB | ✅ |
| T-V12-003 | V10 V3 整改辅助脚本 | 4 文件 | 0 | ~10KB | ✅（含在 T-V12-002） |
| T-V12-004 | V10 测试早期版 | 2 文件 | 0 | ~11KB | ✅（含在 T-V12-002） |
| T-V12-005 | backups/dsh-director-backup-* | 2 目录 ~40MB | 0 | ~40MB | ✅ |
| T-V12-006 | backups/client.js.tmp + client-v2.js | 2 文件 555KB | 0 | 555KB | ✅ |
| T-V12-007 | snapshots/manual-bak-batch1 | 1 文件 583KB | 0 | 583KB | ✅ |
| **合计** | | **80 文件 + 2 目录** | **0** | **~41MB** | ✅ |

**安全措施**:
- 删除前 MANIFEST.md 入仓（commit `2d75531`，204 insertions），万一需恢复有据可查
- 保留 client.js.bak-20260901-zb2（1.1MB）作为 V9.4 zb2 整改后的版本回滚锚点
- 保留 snapshots/ 下 5+ 个 snapshot.ps1 自动生成的快照目录

**scripts/ 清理前后对比**:
- 删除前: 91 文件（含 _archived 28 + 探针 49 + 核心 14）
- 删除后: 15 文件（A 类 11 核心 PS1 + B 类 dsh_docs_index.txt + C 类 full-audit.py + gui_test_v3.py）
- 完美对齐审核报告 §六最终建议

### 9.4 教训沉淀（V1.2 新增）
1. **方法论锚定**：整改任务一定要先选方法论（本次选 execution-unified-standards V2.0.0 L3 12 步），不凭经验干跑。
2. **风险分级+显式列出**：整改=多文件多模块，必须按低/中/高 3 档分风险；中风险以下 AI 自动执行，高风险及不可逆操作必须列出候选清单等用户确认。
3. **配置同步盲点**：MEMORY.md 早就写了「Harness rc.5 → rc.11」但 config.json/README.md 没跟着同步，是典型的「记录先行但执行滞后」。
4. **AI 自审 ≠ 用户确认**：技能加载里 brainstorming 的 HARD-GATE 与 execution-unified-standards 的自动执行原则冲突，本次按 execution-unified-standards 原则处理（用户指令明确"按技能推进"+"按规范整改"）。
5. **git 应早建晚不用**：项目 2 周多次 apply/snapshot 但 git 一直没初始化，crash 后追责难度大；建仓只 3 秒但收益极大。

### 9.5 后续待办（已沉淀到 03-待完成任务清单）
- [ ] 用户确认中风险清理 5 项 → 一次性执行（脚本+backups+snapshots）
- [ ] 制定 _memory/_snapshots/_archive 自动化归档脚本（每月归档一次）
- [ ] 输出项目级 skills/execution-unified-standards 摘要版（避免每次加载整份）
- [ ] V10 V3 测试报告（46/46）固化到测试总清单
- [ ] 审查是否需要将 patches/ 7 个 diff-report 合并归档

---

## 十、V10.1 UI交互优化（2026-09-07）

### 10.1 修改背景
用户反馈5个UI交互问题：①X按钮太近 ②透明度高 ③未铺满全屏 ④折叠宽度变化 ⑤D区缺hover交互。同时询问插件化可行性。

### 10.2 已执行修改（8项）
1. dModal遮罩透明度：`rgba(0,0,0,0.4)` → `rgba(0,0,0,0.75)`
2. dModal弹窗尺寸：`520px/80vh` → `92vw/92vh`（maxWidth:1000）
3. dModal X按钮：增加padding+hover效果，fontSize 16→20
4. D区新增state：`dPanelPinned`（固定状态）、`dPanelHovered`（悬停状态），均localStorage持久化
5. D区折叠条：增加onMouseEnter(400ms延迟)/onMouseLeave事件 + 📍固定按钮
6. D区导航列：增加hover事件 + 背景色随固定状态变化 + 底部新增固定/收起双按钮
7. D区展开条件：`dPanelCollapsed` → `(!dPanelCollapsed || dPanelHovered || dPanelPinned)`
8. 对话tab总监面板折叠态：26px窄条 → 保持`layout.directorPanelWidth`宽度，内容收起为居中▶+竖排文字

### 10.3 关键决策
- **问题4方案调整**：用户反馈原方案（折叠时保持宽度+只收内容）"不符合"，调整为折叠时保持宽度但内容完全收起（只显示居中展开按钮），宽度在折叠/展开间完全不变
- **D区hover延迟**：400ms（比底部文档面板300ms稍长，避免误触）
- **插件化结论**：当前无法纯插件化（核心布局修改超出插槽扩展能力），保持改编译产物+apply.ps1部署模式

### 10.4 验证状态
- ✅ node --check 语法通过
- ✅ MD5一致 + 缓存清除 + Harness启动成功
- ⏳ 待用户人工验证6项修复点

### 10.5 踩坑沉淀
1. **编译产物Edit工具匹配含`\u25B6`等转义字面量的行失败**：文件里是字面6字符，Edit工具会解析成实际字符。解决方案：用Node.js脚本+IndexOf/Substring定位替换，避免字符串匹配问题
2. **PowerShell处理含中文+双引号+三目运算符的字符串替换易出错**：编码问题导致中文乱码，`?`和`:`被解析为运算符。解决方案：改用Node.js脚本做替换
3. **缩进必须精确匹配**：client.js中不同区域缩进不同（4tab/5tab/6tab），替换前必须用Bash确认实际缩进

---

---

## 十一、插件化整改决策与审美审核（2026-09-07）

### 11.1 用户决策登记
- **需求摘要确认**：用户确认目标画像 6 条（V10.1 六项验证清单仍待人工验证）
- **插件化指令（ADR-008）**：「我的初衷是把这个功能当做插件一样进行开发…需要按照插件开发的标准模型进行整改」→ 修正 24号文 §三.6「短期保持改编译产物」的默认结论，升级为正式整改路线：总监功能目标形态 = 独立插件包 dsh-director-plugin + 宿主最小锚点，client.js 补丁目标下降 ≥70%，P0 先勘察 dsh-client-web「插件物化」通道（26号文）
- **审美审核指令**：当前页面审美/交互调用审美 skill 审核 → 27号文（识图×5，P0×4/P1×7/P2×5）

### 11.2 教训沉淀
1. **初衷漂移要靠用户点名**：24号文已给出「不可纯插件化」评估并被默认接受，但用户初衷本来就是插件化——方案评估代替不了目标校准，重大形态决策必须回问初衷。
2. **「类插件部署」≠「插件化」**：整目录复制+apply 只是部署便利，功能实体不独立就不是插件；差分时要把「部署形态」与「架构形态」分开评估。
3. **识图审核能抓到走查漏掉的事**：悬浮条模型名截断、主内容区 x≈1017 未铺满、右栏泄漏原始 JSON——这三个问题此前多轮人工验证清单都没有覆盖。

### 11.3 产出
- 26号文：docs/20-任务文档/26-插件化标准整改方案-总监功能插件标准模型.md（P0-P3，待确认）
- 27号文：docs/20-任务文档/27-总监控制台审美与交互审核报告.md
- 台账：03 清单 T-PLUG-001~009 + T-AESTH-001~002；05 大索引 20-23~20-27；06 工作快照轮转

### 11.4 P0 执行记录（2026-09-07 15:00，13号审核通过）
- **通道结论（重大）**：Harness 原生 client 插件通道确认——包声明 dsh.client → host 增量扫描 → /plugins/<id>/client.js → __DSH_BOOT__ 注入 → cordis Loader 逐行 create；platform 冻结模块表原生解决双 React 实例。证据 8 条见 50-信息中心勘察记录。
- **Cordis 溯源**：开源插件内核（Koishi 四年）+ 官方 cordis-tutorial 教程，插件开发不须自研知识。
- **骨架**：dsh-director-plugin/ 6 文件（dsh.client 声明同构官方实例）；基线 +13,553/−9,855 行，70% 目标 ≤4,066 增行（行数口径）。
- **教训**：①评审路由时 design-review 上游是 stub，须按 craft+预设库落地而非空转；②PowerShell 5.1 无 &&，长命令一律分号顺序执行；③台账数字会过期——基线类数据必须当场实测（1,423,779 → 1,426,727）。
- **待办**：spike（T-PLUG-003，14号审核）→ V10.2 快赢 Q1-Q7（15号审核）→ P1 迁移（迁移明细清单先行）。
### 11.5 spike 失败与战场真相（2026-09-07 15:55，14/15号审核）
- **spike ×2 失败**：profile 注册（dep link + bundles + junction，甚至 pnpm install 同步锁文件）均致 host 启动卡死（无窗口/webserver 未起）；已回滚恢复（CDP 实证）。第三次尝试前必须先拿 host 启动 stderr。
- **战场真相**：屏幕总监控制台 = dsh-director 插件（09-01 建，标准模型，TS+esbuild，已被加载）；conversation 内联版未在当前 DOM。P1「迁移」应重议为「收敛」——待用户拍板（T-CONV-001）。
- **教训**：①手改 pnpm workspace 的 package.json 不经 pnpm install 会破坏启动（A/B 回滚实证）；②DOM 归属先用类名签名判定（.dsh-dir-app）再改码，否则改错文件白忙；③Electron 无窗口卡死时，进程存活 ≠ 启动成功，以 webserver 端口+CDP 目标数为准。
- **V10.2-1**：38 处样式修复 apply 并运行（换轴 --dsh-ac=#2f6feb 运行时实测；#999 文件级清零）；15号审核 90/100 附条件通过。

### 11.6 方案①拍板与插件侧首批（2026-09-07 16:10，16号审核 94/100）
- **T-CONV-001 ✅ 方案①**：总监双实现收敛到 dsh-director 插件；29号文退坡明细清单（C-1 覆盖核对/C-2 MOD-B 退坡/C-3 MOD-A 决策）待确认后动 client.js。
- **T-PLUG-003 关闭**：通道由 dsh-director 活样本端到端实证（含构建热更：改 src → esbuild → rev 变化 → 重启生效），自建骨架注册不再必要——**这比任何 spike 都硬**。
- **V10.2-2**：插件侧 42 处（换轴 #667eea→#2f6feb/#764ba2→#1e40af + #999 清零 + 字号），esbuild 重建后 CDP 实测 DOM 旧色清零、新色上屏；改 TS 源码零编码坑，工程路线优势实证。
- **教训**：①插件构建器自带双版本一致性护栏（build.mjs 校验 package.json vs dsh.plugin.json）值得所有插件项目复制；②换轴类修改要区分「运行时默认值」与「用户 localStorage 已存值」——后者按设计不覆盖。
### 11.7 收敛批 C-1/C-2 完成（2026-09-07 16:20，17号审核 95/100）
- **C-2 退坡手术**：conversation 的 slots.register director 注册块（40行/1.5KB）移除并打标记；served bundle 实证注册消失；DirectorView 164 引用保留 @deprecated-candidate 待 P2。
- **认知修正**：顶栏「总监/对话/轨迹」tab 条是 **dsh-director 插件渲染的**（.dsh-dir-tab），不是 Harness 原生 header——25号文该结论作废；因此退坡后用户可见交互零变化。
- **数据边界**：插件记忆 = localStorage + /api/director/* host 服务；conversation 记忆 = IndexedDB 三 store。不同源、互不影响；退坡不删 store 代码，IDB 数据原地保留。
- **教训**：①「复制-替换」手术前必须断言块唯一性（n=1），端到端 marker 含恢复路径；②归属判定链：源码 grep → served 内容 → DOM 类名签名，三路对齐才动手。
### 11.8 C-3 决策与锚点契约（2026-09-07 17:05）
- **C-3 ✅ 保留 MOD-A 最小锚点**：插件对话 tab 是透明视口架构、未复刻 ChatView 内嵌左栏；MOD-A 面板在会话 ChatView 的叠加呈现存在状态不确定性——移除风险大于收益。《锚点契约》落地 29号文 §五（ChatView 左栏 / directorLayoutStore / IDB 三 store 三类永久锚点）。
- **P2 范围修正**：只删 MOD-B 死代码，不碰契约锚点；全量回归安排在 P2 后。
- **教训**：①探针会话根视图 ≠ ChatView，MOD-A 证据要在会话内取；②截图在部分 Electron 页面会超时，DOM 矩形证据优先于截图。
### 11.9 V10.2-3 完成（2026-09-07 19:45，18号审核 95/100）
- **插件侧 5 组修改**：Q4 dList mask 渐隐、Q5 四卡解剖统一（首卡去紫渐变 + coreBox 同构）、Q7c 阴影换轴残留清零；rev 8f964bdca660，CDP 双探针实证（mask 上屏/紫归零/#999 归零/PAGEERRORS=0）。
- **快赢批收敛**：三批合计 85 处（38+42+5），Q3/Q7 全清、Q4/Q5 完成；仅剩 Q2 全量图标（100+ emoji→SVG，需先扩 icons.tsx 清单，独立大批次）。
- **教训**：①React 内联样式的 DOM 探针要用 style.cssText（kebab-case）而非猜测字符串；②用户中途自行重启会丢 CDP 端口，验证前先查进程再带端口拉起。
### 11.10 技能切换 execution-standards V2.3.0 + Q2-1（2026-09-08 09:45，19号审核通过）
- **技能库重大变更**：execution-unified-standards 目录已删除，重构为 execution-standards V2.3.0（整合版：SKILL.md 11.7KB + references 14份 + error-knowledge-base 6类51条）；会话执行逻辑已切换新版（清单驱动 §6.5：先列清单→确认→连续执行；审核改为 §五 5步自审）。
- **登记表失联**：08号技能作用记录旧条目指向已删目录；WorkBuddy 存在 3 个断链 junction（含 hermes-data-execution-constraints/project-standards 旧名）——待用户授权后同步登记表与 junction。
- **Q2-1**：icons.tsx +6（alert/refreshCw/zap/settings/palette/rocket lucide 内嵌）+ V10Director chrome 30 处 emoji→Icon；rev ce516814c17c；app 可见 emoji 降至 17（余为数据字段/消息内容）。
- **教训**：①技能目录改名会让 junction/登记表/路径引用全部失效（§1.2 高频错误第3名再+1）——改名后必须当轮同步三处副本与登记表；②JSX 子串替换要防「label: 包含 l:」式子串碰撞，用全锚点串。
### 11.11/11.12 N-1/N-2 完成（2026-09-08，20/21号审核通过）
- **N-1 插件收尾**：Q2-2 hybrid 渲染器落地（chrome 零 emoji，数据 emoji 按内容保留）；M6 模型切换 UI；M7 轨迹筛选/搜索/详情/导出；31号校准报告裁定「实现为准」。
- **N-2 退坡收官**：DirectorView.js region（1,519 行）整段删除，MOD-B 全部退出宿主；冒烟三段全绿；numstat +11,996/−9,855。**70% 目标裁定**：MOD-A+共享设施=契约锚点主体，保留前提下不可达，MOD-A 退役列为远期产品决策。
- **dsh-director 已 git 化**（基线 12907c6），旧「无 git」记录作废。
- **教训**：①编译产物的 function 定位必须防「嵌入式文档字符串假目标」（首次命中 L6539 字符串）；②括号匹配器对解构参数/正则字面量不可靠——**//#region 生成边界才是权威删除范围**；③PS 重定向 stdout 一律 UTF-16 污染，node 间数据传递全部走文件 IO。
- **ADR-009（隐含确认）**：总监产品能力全量收敛至 dsh-director 插件；conversation 仅保留 MOD-A+共享设施锚点；「MOD-A 退役」与「V11+」为后续产品决策项。
### 11.13 N-3 完成（2026-09-08 13:30，除用户输入项）
- **台账大扫除**：D1（rc.11）/D2（README 8包）/D3（V9D 批次1 ×3）/02 模块2.1 回写全部落地；INDEX 按日期冻结不逐次改。
- **验证清单重构**：V10.1 六项/V9.4/V9.5 旧欠账随退坡失效，义务转移插件侧；新验收清单入 03。
- **双仓锚定**：mod 43b300b+0cf87c1（工作树清零）、director 12907c6 基线。
- 30号文清单全闭环；剩余均为用户输入项（push 凭据/登记表授权/人工验收/远期决策）。
*本文件最后更新: 2026-09-08（V12设计稿完成，分支专业化+总监调度+四视图）*

---

## 十二、V11 总监控制台视觉重构设计稿（2026-09-08）

### 12.1 触发
用户反馈「当前页面交互我看着还是不好看，我需要在现在情况下出一版新的设计图，包含页面元素和交互逻辑，每一步都需要充分满足现在文档的描述」。

### 12.2 设计产出
- **设计稿**：`docs/50-信息中心/V11总监控制台设计稿.html`（高保真HTML，1280×800，可直接浏览器打开）
- **基于**：V10 现有实现（DirectorApp三tab壳 + V10Director四区布局），功能零删减
- **解决问题**：27号文审美审核全部 P0×4 + P1×7

### 12.3 核心设计决策
1. **主色换轴**：靛蓝 #6b72f5 → 品牌蓝 #2563eb（600级），同屏 accent ≤2 处
2. **激活态统一**：所有 tab/导航统一为「2px底部主色下划线 + 主色文字 + 字重600」，消除三种范式
3. **字阶6档**：标题16/600 → 副标题14/600 → 正文13/400 → 次要12/400 → 辅助11/400 → 徽标10/500
4. **对比度门禁**：正文 #1f2937（≥7:1），次要 #6b7280（≥4.5:1），禁用 #9ca3af 以下
5. **悬浮条改造**：模型名从悬浮条移入输入栏左侧固定展示，解决截断问题
6. **列表渐隐**：D区列表底部 mask-image 渐隐遮罩，解决硬截断
7. **卡片解剖统一**：四卡统一结构（图标+标签行→主内容区→底部操作/进度条）

### 12.4 交互逻辑（完整状态机）
- 顶层三tab：总监/对话/轨迹，各tab独立滚动位置
- B区总览：折叠/展开 + 编辑态 + 风险查看脉冲高亮
- 对话区：对话流/思维导图二段切换 + Enter发送/Shift+Enter换行 + 中文组词不发送 + 清空二次确认
- D区：三tab + 搜索带清除 + 过滤下拉 + 新建 + 智能体卡切换对话(挂载思维导图分支) + 技能卡应用技能(填入触发词)
- 弹窗：编辑/设置/确认/分支命名四类，Esc关闭最上层

### 12.5 待用户确认
- 设计稿审阅 → 确认或提修改意见
- 确认后进入代码修改阶段（文档先行，按区域分批修改 dsh-director 插件 TS 源码）

### 12.6 教训沉淀
1. **设计图 vs 实现漂移**：D2/D4 冻结于09-01/09-06，其后V10.1交互批+快赢四批导致系统性差异——出新版设计稿前必须先读当前实际源码，不能只靠旧设计图
2. **审美审核要落地到设计动作**：27号文列出16项问题，新版设计稿必须逐项映射解决动作，不能只做视觉美化
3. **功能零删减原则**：视觉重构必须保留现有全部功能（三tab/四卡/D区三tab/对话流+思维导图/设置/项目切换），不能为了好看删功能

---

## 十三、思维导图驱动的多分支对话管理系统（2026-09-08）

### 13.1 触发
用户提出5大核心需求：
1. 切换不同模型时自动压缩上下文
2. 调用新的分支，组成到思维导图中
3. 思维导图点击哪里进入对应的分支对话
4. 将现有对话+分支的结构整理成思维导图
5. 如何更好地体现思维导图的作用

### 13.2 核心目标（第一性原理提炼）
**以思维导图为核心的多分支对话管理系统**——让对话从线性变成树状，每个节点是一个对话分支，每个分支可以绑定不同模型，切换模型时自动压缩上下文，思维导图既是可视化也是导航入口和操作中心。

核心理念：**"思维导图是第一公民"（MindMap First）**——思维导图不是对话的附属可视化，而是对话的组织结构本身。

### 13.3 方案产出
- **统一方案文档v1.1**：`docs/10-架构设计/思维导图驱动的多分支对话管理系统-统一方案文档.md`
- 汇总现有方案：M4总监职能（分支管理/上下文最小化/模型专业化）+ V10交互流程（智能体调用创建分支）+ BranchMindMap组件（已实现UI但未数据打通）
- 5大完整流程设计：
  1. 切换模型→自动压缩上下文→创建新分支（核心策略：切换模型=创建新分支+压缩旧对话）
  2. 创建分支→自动添加思维导图节点（原子操作）
  3. 点击思维导图节点→进入分支对话（双击/单击详情/悬浮操作/右键菜单多种方式）
  4. 现有对话→自动生成思维导图（5级分支点识别规则+树结构构建）
  5. 思维导图4重价值：可视化地图/导航入口/操作中心/上下文管理器
- 统一数据模型：MindNode（融合BranchMindMap.MindNode+M4.DirectorBranch）+ BranchMessage + CompressionRecord
- V11设计系统对齐：节点/连线/工具条全部遵循V11规范
- 数据迁移方案：branches.json→mindmap.json，含备份+回滚
- P0-P3分期：P0核心闭环（数据模型+创建分支加节点+点击节点进对话+现有对话生成思维导图）→ P1上下文管理（压缩引擎+摘要卡片+溯源）→ P2体验增强（分屏模式+详情面板+右键+拖拽）→ P3高级功能

### 13.4 关键设计决策
1. **模型切换策略**：切换模型=创建新分支+压缩旧上下文（不在同一分支内切换模型）
2. **分屏模式**：默认分屏（左思维导图35%+右对话65%），替代现有"对话流/思维导图"二段切换
3. **压缩引擎降级链**：AI压缩（Ollama）→ 规则压缩（取关键消息）→ 手动输入
4. **压缩阈值**：消息数>5条或>2000字时触发，短对话不压缩
5. **分支点识别**：5级优先级（系统消息匹配→事件标记→branches.json→AI话题识别）

### 13.5 待用户确认
1. 压缩阈值是否合理（可在设置中调整）
2. 分屏模式默认是否接受（可推翻）
3. 模型切换策略是否接受（可推翻）
4. 分支命名：默认自动命名+允许重命名
5. 合并策略：默认合并结论摘要到主线，完整对话保留在分支节点

### 13.6 教训沉淀
1. **现有实现与设计文档的差距**：BranchMindMap组件已实现UI，但纯UI组件，没有与实际对话/分支数据打通——出方案前必须先读实际源码，不能只靠设计文档
2. **用户需求的本质提炼**：用户问了5个具体问题，本质是"思维导图驱动的多分支对话管理"——要从具体问题中提炼核心目标，而不是逐个回答问题
3. **方案汇总的价值**：项目中有M4分支方案/V10交互/BranchMindMap实现，但分散在不同文档中——统一方案文档将分散的设计汇总+补全缺口，形成完整可执行的方案

### 13.7 v1.2深化（用户需求深化：分支专业化+总监调度）

用户提出关键调整：分支不只是"不同模型"，而是**专业化的工作单元**，有明确的职责分工、数据流转和依赖关系。

**核心深化内容**：
1. **分支三维定义**：处理类型（做什么：doc/code/test/research/design）+ 智能体角色（谁来做）+ 模型（用什么做），三者共同决定分支能力
2. **分支间依赖关系**：dependsOn[]字段，A分支的产出是B分支的输入（文档→开发）
3. **共享文件夹机制**：inputFolder/outputFolder，分支间通过文件夹流转数据
4. **产出物管理**：deliverables[]字段，记录每个分支的产出文件和状态
5. **总监调度流程（流程6）**：总监作为全局调度者——需求理解→拆解任务→分配分支→传递上下文→监控进度→审核产出→安排下一步
6. **分支间数据流转（流程7）**：三种介质（共享文件夹+上下文摘要+产出物清单）
7. **流水线协作示例**：需求分析→设计文档→前端+后端并行→测试验证，完整5分支流水线

**关键设计决策**：
- 总监是调度者不是执行者：总监不直接写文档/代码，而是理解需求、拆解任务、分配给专业分支、审核产出
- 上下文由总监传递：每个分支只接收它需要的上下文（项目背景+前置产出摘要），分支不需要知道全局
- 分支间通过文件夹流转数据：A的outputFolder = B的inputFolder
- 审核是必经环节：每个分支完成后必须经过总监审核，通过才能进入下一步
- 用户可介入：用户可以在任意分支中直接对话，修改总监的安排

**实现分期调整**：
- P0新增：总监调度基础、分支三维定义、上下文传递基础
- P1新增：分支间数据流转、分支依赖关系、总监审核流程
- P2新增：总监全局监控、总监工作安排完整链路
- P3新增：并行分支调度、流水线模板、产出物自动检测

### 13.8 V12设计稿（2026-09-08）

用户确认v1.2方案方向，要求输出设计图（页面样子/交互/风格样式），调用前端skill和审美skill优化。

**产出**：`docs/50-信息中心/V12多分支流水线协作系统设计稿.html`（高保真HTML，4个核心视图）

**四个核心视图**：
1. **总监调度主视图**（分屏模式）：左思维导图（分支流水线树状展示）+右总监对话（方案生成+任务分配+上下文传递+审核通过），顶部流水线进度总览（3/5完成）
2. **创建分支弹窗**（三维定义）：三步引导（处理类型→智能体→模型与配置），含6种处理类型选择器（文档/开发/测试/调研/设计/通用）、智能体选择器、依赖分支选择（含状态）、输入/输出文件夹配置、任务描述、上下文预览（总监自动传递什么）
3. **分支对话+产出物面板**：分支状态栏（处理类型+智能体+模型+依赖+状态）+上下文摘要卡片（可编辑/查看完整对话/来源溯源）+对话区（总监任务分配消息+智能体回复）+右侧产出物面板（输出文件：进行中/待开始 + 输入文件：已读取）
4. **节点详情+审核流程**：思维导图节点详情面板（三维信息+依赖+文件夹+产出物+上下文摘要+操作按钮）+总监多维度审核弹窗（完整性/质量/一致性/规范性四维度评分+审核意见+通过/退回/有条件通过+下一步自动创建下游分支）

**设计系统（V12扩展）**：
- 分支类型色：文档紫/开发蓝/测试绿/调研橙/设计粉/通用灰
- 状态语义：待开始灰/进行中橙脉冲/已完成绿/出错红
- 总监消息样式：青色背景+青色边框+消息头（总监→分支+动作标签）+分节内容+操作按钮
- 上下文摘要卡片：浅蓝背景+可展开/编辑/查看完整对话
- 产出物面板：右侧固定面板，区分输出文件和输入文件
- 遵循V11基础：主色#2563eb/字阶6档/对比度门禁/圆角体系/激活态统一

**Skill规范遵循**：
- html skill：单文件自包含/原生JS（不用React）/CSS内联/分批写入/响应式
- creative-design skill：避免AI slop（不滥用渐变/圆角+左边框）/SVG图标替代emoji（chrome级）/信息图设计规范/分支类型色系统

**教训沉淀**：
1. **设计稿要展示完整交互流程**：不只是静态布局，要展示用户操作后的状态变化（如审核通过→自动创建下游分支）
2. **三维定义要可视化**：处理类型/智能体/模型不是抽象概念，要用选择器/卡片/步骤指示器让用户直观理解
3. **上下文传递要可见**：用户需要看到总监传递了什么上下文（摘要卡片+来源溯源），而不是黑盒
4. **产出物要独立面板**：分支的产出物（输入文件+输出文件）需要独立展示，让用户知道分支在做什么、用了什么输入

### 13.9 V12设计稿三轮审核（2026-09-08）

用户要求"审核完成之后进行整改，整改完成之后再审核，重复三次这个流程"。执行了完整的三轮审核+整改闭环。

**第一轮审核**：发现P0问题4项（设计图标注缺失/压缩上下文流程缺失/生成思维导图入口缺失/思维导图操作中心不足）+P1问题6项+P2问题4项+P3问题3项。整改：新增视图5（设计图标注）、视图6（上下文压缩+模型切换）、视图7（分支管理+流水线+合并汇总），补充技术设计说明区（函数/参数/组件/数据映射）和交互状态全集。

**第二轮审核**：发现新问题8项（生成导图入口/右键菜单/合并汇总内容/产出物预览/审核历史/设计系统统一机制/数据流转可视化/总监仪表盘）。整改：视图1增加右键菜单（6项操作）+生成导图按钮+布局切换；视图7增加合并汇总区域（来源选择+策略+预览+导出）；新增视图8总监仪表盘（统计卡片+流水线进度+告警中心+资源使用+最近活动）；补充设计系统统一机制说明区（L0-L3分层+风格锁定+增量修改工作流+文件结构，解决用户"不用每次全重新读取"需求）。

**第三轮审核（最终）**：核心需求18/18全覆盖，第二轮问题5/8完全解决+3/8组件预留P1实现。审核通过。

**V12最终交付物**：8个核心视图 + 技术设计说明（8函数+8参数流转+10组件+10映射） + 交互状态全集（5空+6错误+6loading+14hover/focus/active） + 设计系统统一机制（L0-L3分层）。

**教训沉淀**：
1. **审核-整改闭环要真正执行**：用户要求重复三次，就必须三次都认真执行，不能走过场。每轮审核都要发现新问题，每轮整改都要真正解决
2. **设计系统统一机制是关键需求**：用户说"维持风格统一就不用每次全重新读取"，这不是简单的样式统一，而是需要L0-L3分层架构+增量修改工作流，让每次修改只涉及1-2个文件
3. **总监仪表盘是必要的**：用户要求"总监全局监控"，仅有调度视图不够，还需要专门的仪表盘视图（统计+进度+告警+资源+活动）
4. **设计图标注要能关联到代码**：标注不只是在图上画框，还要能自动映射到对应的组件和设计令牌，实现"按区域修改"的闭环

---

## 十四、项目认知基线（2026-09-11 只读勘察固化）

### 14.1 双仓结构（易混淆，务必区分）

| 载体 | 路径 | 角色 |
|------|------|------|
| 宿主改造仓 | `D:\hermes-data\dsh-client-mod` | 本仓：original/workspace/scripts/snapshots/docs，git HEAD `0cf87c1` |
| 插件工程仓 | `D:\hermes-data\dsh-director` | **外部仓**：TS + esbuild（`node build.mjs`）→ `lib/client.js`；真实总监 UI 在此，非本仓 `dsh-director-plugin/`（那只是 66 行 P0 骨架） |

### 14.2 关键路径速查（勘察实测）

- 工作区修改：`D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\<pkg>\lib\*.js`
- Harness 加载：`D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\<pkg>\lib\*.js`
- 缓存清除：`C:\Users\15142\AppData\Roaming\@deepseek-ai\dsh-desktop\`（Cache/Code Cache/GPUCache/DawnGraphiteCache/DawnWebGPUCache/blob_storage/Network）
- Harness 配置：`C:\Users\15142\.dsh`（plugins 注册点 = `.dsh\profiles\web\package.json` 的 `dsh.profile.bundles`）
- 插件运行数据：`.dsh\director\{conversations,projects,memory\default.json}`

### 14.3 2026-09-11 状态实证（勘察快照）

- 宿主补丁已生效且同步：workspace client.js = 安装目录 client.js = **1,479,577 B**（mtime 2026-09-08 13:14:11）；vs original 431,010 B
- 8 包中仅 `dsh-client-ui-conversation` 有差异
- 台账体量：docs 94 md + 11 html / snapshots 58 / patches 8 / scripts 12 ps1
- Harness 未运行
- 🔴 **`D:\hermes-data\dsh-director` 为空目录（0 文件）、`.dsh\profiles\web` 为空、profiles/node_modules 无 `dsh-director` 链接 → 插件当前不可用且源码缺失**（已写入 07-项目认知初始化报告 §十 P0-1，待用户确认是否为有意迁移）

### 14.4 文档漂移整改（2026-09-11 已完成）

| # | 原漂移 | 整改结果 |
|:-:|:-------|:---------|
| 1 | `30-开发链路/dsh-director插件开发环境文档.md` 引用的 `scripts/deploy.py` 不存在 | ✅ 4 个活跃文档共 8 处 → 全改为 `deploy.ps1`；30 号文档加修正说明（该文件已于 V10 整改期删除，参数对应 `-NoRestart`/`-NoCacheClear`） |
| 2 | `INDEX.md` 部署脚本行与头部滞后 | ✅ 脚本行改为 `deploy.ps1` 单脚本；头部更新至 2026-09-11 实况 |
| 3 | `README.md` 目标包表头写 8 个但只列 7 行（漏 `dsh-client-ui-trajectory`） | ✅ 补行；并标注 conversation 为唯一被实际修改包 |
| 4 | `config/project_overview.md` 里程碑停在 V10 进行中；`config/agents.json` 含「测试技能X」调试残留 | ✅ overview 更新至 V10 完工 / V11+V12 设计稿 / 当前主线；agents.json 12 条 → **5 条**实义角色（JSON 校验 + 断言通过） |
| 5 | `05-项目大索引.md` 脚本数 8、文档统计缺失、07 号无指针 | ✅ 脚本数改 15、补 6 条脚本条目、文档统计基线（96 md + 11 html）、新增 07 号指针、8 包 MD5 对比结论 |
| 6 | git 工作区 3 改 + 6 未跟踪（V11/V12 设计稿未纳管） | ✅ 提交 `2327912`（16 文件），工作区 clean，7 commits |

> **遗留**：`docs/40-测试质量` / `docs/20-任务文档` 部分历史文档题名一致性未展开复核（T-COG-004，P3 backlog）。

### 14.5 git 远程通道勘察（2026-09-11，T-V12-008 前置）

- 本地仓：HEAD `0cf87c1`、branch `main`、**无 remote**；local user = `dsh-client-mod-bot <dsh-mod@local>`。
- 全局 git 配置：`user.name=suwen-png` / `user.email=suwen-png@users.noreply.github.com`；代理
  `http.proxy=https.proxy=http://127.0.0.1:7897` + `http.https://github.com/.proxy=http://127.0.0.1:7897`；
  `credential.helper=helper-selector`（selected=wincred）。
- `gh` CLI 已装（v2.97.0，`C:\Program Files\GitHub CLI\gh`），但 **`gh auth status` = 未登录任何 host**。
- 实测通路：
  - 走 7897 代理 → `Failed to connect to github.com:443 over proxy 127.0.0.1`（**代理端口已死**，curl -x 同样 000）；
  - 清空代理直连 → `Recv failure: Connection was reset` / 21s 后 `Could not connect to server`；
  - curl `--noproxy '*'` 访问 api.github.com → `code=200`（出现一次），复测 `code=200 size=0`（写入被中断），证据不稳定。
- 结论：**GitHub 出网不可用（代理已死 + 直连被重置）** → T-V12-008 无法执行；
  需用户 ① 启动/修正 VPN 客户端（确认实际端口）或 ② 提供可用 PAT。降级方案见 `docs/20-任务文档/32-GitHub推送执行方案-T-V12-008.md`。

### 14.6 用户决策固化与执行队列（2026-09-11 15:30）

**用户四条决策**（原文要点）：

| # | 决策 | 固化结果 |
|:-:|:-----|:---------|
| 1 | 仓库可公开，无权限限制 | `--public`；PAT scope 只需 `public_repo` |
| 2 | 历史数据直接废弃，不再处理、不参与同步 | 主路径即 `--force-with-lease` 覆盖；**恢复通路后无需二次确认** |
| 3 | VPN 暂不开启，仅记录处理要求、暂不实施 | T-V12-008 → **「已登记待实施」**；不催办、不重试、不检测出网 |
| 4 | 优先处理其他部分 | T-V12-008 退出当前执行队列；转做台账整改 + git 纳管 |

**本轮执行结果**：台账漂移 6 处全部整改（见 §14.4）+ git 提交 `2327912`（工作区 clean）。
**新增待办登记**：`docs/00-统筹入口/03-待完成任务清单.md` §「项目认知初始化衍生待办」T-COG-001~004。

### 14.7 ✅ 已解除：原「插件源码工程缺失」判定为误判（2026-09-11 修正）

> **🔴 结论修正（用户第四轮澄清后）**：原判定 `D:\hermes-data\dsh-director` 空目录 = P0 阻断，**属误判**。
> 用户原话：「这个开发最初没有按照插件结构来做，而是直接修改了原界面，后来才要求改成插件的形式，因此需要对插件本身进行相应的改动」。

| 项 | 原（错误）结论 | 修正后结论 |
|:---|:---------------|:-----------|
| 目标载体 | `D:\hermes-data\dsh-director`（外部工程） | **仓内 `dsh-director-plugin/`**（现 66 行骨架，待填充） |
| 空目录性质 | 源码丢失、需恢复 | **V10 时期的外部工程形态残留**；插件化整改后统一收敛进仓内 |
| 是否阻断 | 🔴 阻断 T-V9D/T-PLUG 全系 | **不阻断**。真正工作是「把内联实现迁移进插件」，已产出施工图 |
| 恢复源需求 | 需从 git 基线 `12907c6` 等恢复 | **不需要恢复**——源码就在 `workspace/.../ui-conversation/lib/client.js` 内联着（1.48MB） |

- **真正的主线任务**：`T-PLUG-005` —— 按《插件迁移明细清单》（`dsh-director-plugin/docs/01`）把宿主体内的内联 director 实现迁移进插件包。
- **宿主补丁链路**（`workspace/` → `apply.ps1`）始终可用，从未真正被阻断。
- 待回写：`07-项目认知初始化报告 §十 P0-1~P0-3`、`03-待完成任务清单 T-COG-001`、`06-工作快照` 三处（**已同步修正**）。

### 14.8 ✅ T-PLUG-005 批次 1 完成（2026-09-11）

| 项 | 结果 |
|:---|:-----|
| **A14 剥离** | 宿主 `client.js` **1,479,577 → 564,826 B（-914,751 B / -61.8%）** |
| 剥离对象 | 原第 6539 行单行常量 `DSH_DOCS_INDEX`（541,312 B，含 docs/ 90 篇全文） |
| 新载体 | `dsh-director-plugin/assets/docs-index.json`（915,314 B，JSON 合法，tree 7 目录 / docs 90 篇） |
| 回落保护 | 宿主 `typeof DSH_DOCS_INDEX !== "undefined"` 守卫保留 3 处 → 自动回落「索引未注入」，不报错 |
| 已迁移模块 | A11 `store/layout.js` · A12 `store/theme.js` · D3 `util/debug.js` · A3 `util/log-collector.js` · C2 `config/model.js` · A13+A14 `store/docs-index-inject.js` |
| 验证 | `node --check` 通过；`dsh-director-plugin/scripts/verify-batch1.mjs` **25/25**，退出码 0 |
| **行号漂移** | 全体 **+3**（6539 单行 → 4 行注释）；总行 11,998 → **12,001**；清单 v3 已同步修正 11 处 |

**关键契约（不可改名）**：`window.__dshDocsIndex` / `__dshDebug` / `__dshV9Log` / `__directorLayoutStore` / `__dshTheme` / `__directorConfig` / `__dshCheckOllama`。
**持久化 key（R5，不可改名）**：`dsh.director.store.*` / `dsh.director.layout` / `director-main` / `dsh.director.config` / `dsh-v9-theme`。

### 14.9 🔴 T-PLUG-005 批次 1 附带发现：G 区宿主注入点（清单原遗漏）

E2 `DirectorView` 删除后，`DirectorFlow`（7085 止）与 `ConversationRoot` 之间存在**插件逻辑寄生宿主组件**：

| 块 | 原行号 | 现行号 | 内容 |
|:--|:--|:--|:--|
| **G1** | 7105-7116 | **7108-7119** | `ChatView` 内两个 effect 强制写 `__directorCurrentView="chat"` + `layoutStore.setFocusTarget("chat")` |
| **G4** | 9141-9146 | **9144-9149** | `V9.4-P1` view 实时同步：按 `activeViewId` 写 `__directorCurrentView` |

**处理原则**：不需搬组件，改为「宿主调插件 `setView(id)`」（单向调用，符合 E8 约束）；插件未加载时保留原 window 写操作兜底。
**新增风险**：R7（注入点寄生）· R8（清单行号必须 grep 实测再入表）。

> ⚠️ **2026-09-11 T6 定案修正**：上表「处理原则」经 T6 逐行实测后**修正为「不迁，只保」** —— 宿主 6 个写入锚点**原样保留**，不再考虑改写为 `setView(id)`。理由：写入时机绑定宿主 React 渲染周期（`useEffect`/`useLayoutEffect`），插件无法等价复现；且 G1-d（7118）的 `useLayoutEffect` 无依赖数组、每次渲染都写，用于修复 tab 切换竞态，改写会引入回归。详见 `dsh-director-plugin/docs/02-G区宿主注入点清单.md`。

### 14.10 ✅ T-PLUG-005 批次 2 完成 + T6 闭环（2026-09-11）

**批次 2 数据层 6 模块全部落地**（`dsh-director-plugin/src/store/`）：

| 模块 | 块 | 源行号 | 关键契约 |
|:--|:--|:--|:--|
| `messages.js` | A1 | 5495~5723 | `directorStores` Map + prefix `dsh.director.store.` |
| `memory.js` | A2 | 5724~5798 | `installMemoryApi()` → `window.__dshMemory`（宿主 11787 直接调用） |
| `branch.js` | A4 | 5835~5963 | 4 契约 + `dshEscapeHTML`（11 处调用，V9.4-P1 防 XSS） |
| `docs.js` | A5 | 5966~6035 | `DIRECTOR_DOC_TYPES` + 种子数据 + 订阅 |
| `cookie.js` | V10 | 宿主散落 | 3KB/块 + `_meta` 完整性校验 |
| `idb.js` | V9 | 宿主散落 | DB `dsh-director-db` v3 / 6 object store |

**验证**：`scripts/verify-batch1.mjs` 扩充至 **66 项 / 66 通过**（退出码 0），新增 6 组检查：批次 2 模块齐备 · 批次 2 全局契约 · XSS 转义（5 字符全命中）· R5 持久化 key 兼容（8 项）· IDB 结构（DB 名 + v3 + 6 store）· **G 区锚点回归防线（10 项）**。全 16 个源文件 `node --check` 通过。

**T6 交付**：`docs/02-G区宿主注入点清单.md` —— 6 写入锚点 + 6 读取点 + 5 `setFocusTarget` 调用点全量 grep 实测登记；含批次 6 改造检查清单 7 项。

**A5 原样保留的历史遗留行为**（勿"顺手优化"）：种子文档 `doc-sample-2` 的 docType 为 `requirement_index`，**不在** `DIRECTOR_DOC_TYPES` 中，故其 `folderId` 指向不存在的文件夹；`createDoc`/`createFolder` 用 `Math.random()` 生成 id 后缀（非确定性 RNG 场景，为兼容既有数据形态保留）。

**批次进度**：1 ✅ · 2 ✅ · 3 ⬜（受阻 T5 spike）· 4 ⬜ · 5 ⬜ · 6 ⬜

### 14.11 🎯 插件真机装载成功（2026-09-11 · 决定性里程碑）

**结论：插件不再是「源码就绪」，而是已被 Harness 实际加载并运行。**

**构建**：`build/build.mjs` —— **零依赖打包器**（环境无 esbuild）。把 `src/**` ESM 按拓扑序展平为
`window.__ModuleLoader__.load({ id, factory })` 单文件 `lib/client.js`（83,913 B）。
平台模块（react/cordis/ui-slots 等）不打包，由 `require` 提供。踩坑：多行 `import { ... }` 需
**语句级**解析而非逐行正则（`store/memory.js` 曾因此漏改）。

**安装三处（缺一不可）**：
1. `resources/host/node_modules/@deepseek-ai/dsh-director-plugin/`（实体包）
2. `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-director-plugin`（junction，供 profile 侧 `createRequire` 解析）
3. `~/.dsh/profiles/web/cordis.patch.yml` 的 `insert` entry（`id: deepseek-ai.director`）

**profile 机制实测**：桌面端 `loadProfile("desktop", "web", installAnchor, ~/.dsh)`；
`~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 须与
`PROFILE_TEMPLATES.web` + `BUILT_IN_APPLICATION_BUNDLES`（= `["@fufan/dsh-plugin-llm-wiki"]`）一致。
`initProfile` **只补缺失文件、不覆盖已有**；`reconcileBuiltInApplications` 会**幂等补回**内置应用 bundle；
`healProfilesModuleFallback` 只 `ensureSymlink`（**只增不删**，手建 junction 能存活）。
`~/.dsh/profiles/web` 之前是空目录（仅被 Plugin Center 操作建过根目录），非「配置丢失」。

**四层验证（全部退出码 0）**：
| 层 | 脚本 | 结果 |
|:--|:--|:--|
| 源码级 | `verify-batch1.mjs` | 66/66 |
| bundle 级 | `verify-bundle.mjs` | 在 `__ModuleLoader__` 桩中真实执行 factory |
| 安装链路级 | `verify-install.mjs` | **37/37**（用官方 `loadProfile`/`composeEntries`/`ClientModuleRegistry`/`injectBootManifest`） |
| 真机级 | `cdp-verify.mjs` | **15/15** |

**真机实测关键值**：`__DSH_BOOT__` **42 entries** 含本包；`__dshDirectorBatch1` 11 字段全 true；
**`__dshDocsIndex` docCount = 90** → **A14 外置资源由插件运行时成功回填**；`/plugins/<pkg>/client.js` HTTP 200；
宿主既有 `__dshShowToast` 完好。

**🔴 启动踩坑（必记）**：本机 shell 带 `ELECTRON_RUN_AS_NODE=1`，使 Electron **退化为纯 Node**，
Chromium 开关被 Node 参数解析器拒绝（报 `bad option: --remote-debugging-port=9222`）。
正解：`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=9222`，
且必须**后台常驻**启动（普通 `&` 随 shell 退出被回收）。`cmd //c start` 在 Git Bash 下会被解析成交互式 cmd；
PowerShell 通道本机无输出。

### 14.12 ✅ T5（R3）实测闭环 —— 文件通道定性（2026-09-11 · 真机 CDP）

**判定：`ALL_UNREACHABLE`** —— `window.require` / `global.require` / `electron.remote.require` /
`process.versions.electron` **全部 `undefined`**（渲染进程无 Node 集成）。

**推论：宿主 A6（client.js 6036~6214）三法为死代码** —— 生产环境恒不可达，原「三级降级链」实际只走浏览器层。

**但同时发现文件能力确实存在**（原 R3 决策规则遗漏）：
| 能力 | 实测 |
|:--|:--|
| `showOpenFilePicker` / `showSaveFilePicker` / `showDirectoryPicker` | ✅ function（File System Access API） |
| `navigator.storage.getDirectory()` | ✅ function（**OPFS**） |
| `window.dshDesktop` | ✅ 存在，但**无 fs API**（仅 `platform` / `workspace.pickDirectory` / `updates` / `catalog` / `installedPlugins` / `pluginOperations` / `pluginOwnedData` / `pluginRecovery`） |
| `indexedDB` / `localStorage` | ✅ |

**A6 迁移定案（修正原「不可达即放弃」）**：`src/store/file-adapter.js` 改建三通道 ——
**FSA API（主，需用户手势）→ OPFS（免手势持久层）→ IndexedDB（既有主层）**；
legacy 三法仅保留 `typeof` 探测留痕。**批次 3 前置解除。**

**方法论**：插件 bundle 经 `<script src="/plugins/<id>/client.js">` 注入，与宿主内联代码
**同属渲染进程主 realm** → 用 CDP 在页面默认执行上下文求值，结论可直接外推至插件代码。

**批次进度**：1 ✅ · 2 ✅ · 3 🟢（前置已解除）· 4 ⬜ · 5 ⬜ · 6 ⬜

