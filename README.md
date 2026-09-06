# DSH Client Mod — DeepSeek Harness 原客户端修改工作区

> 版本：V1.1 ｜ 创建：2026-08-24 ｜ 最后更新：2026-09-06 ｜ Harness 版本：0.1.0-rc.11
> 定位：在 DeepSeek Harness 原客户端编译产物基础上直接修改，通过 Junction 符号链接替换原包，支持一键备份与复原。

## 这是什么

放弃「外部 bundle 注入」路线，直接修改 Harness 原客户端的 `lib/client.js` 等编译产物。修改在 `workspace/` 中进行，通过 Windows Junction 符号链接替换原安装目录中的对应包。出问题时从 `original/` 一键复原。

## 目录结构

```
dsh-client-mod/
├── config.json                  # 配置（原路径、目标包列表、规则）
├── original/@deepseek-ai/      # 原客户端代码备份（只读，复原源）
├── workspace/@deepseek-ai/     # 修改工作区（在此修改，改完 apply）
├── patches/                     # 差异报告与 patch 文件
├── snapshots/                   # 应用前自动快照（可回滚到任意快照）
├── scripts/                     # 自动化脚本
│   ├── dsh-mod-lib.ps1         # 核心函数库
│   ├── backup.ps1               # 备份：原安装目录 → original/
│   ├── init-workspace.ps1       # 初始化：original/ → workspace/
│   ├── apply.ps1                # 应用：workspace/ → Junction 替换原安装目录
│   ├── restore.ps1              # 复原：original/ → 原安装目录（删除 Junction）
│   ├── status.ps1               # 状态检查
│   ├── diff.ps1                 # 差异报告（workspace vs original）
│   └── snapshot.ps1             # 手动快照
├── docs/                        # 文档
│   ├── 00-架构说明.md
│   ├── 01-修改记录模板.md
│   └── 02-复原手册.md
└── logs/                        # 操作日志（按天）
```

## 目标包（7个）

| 包名 | 用途 | 关键文件 |
|------|------|---------|
| dsh-client-ui-layout | 主布局 AppFrame，main.page/conversation/sidebar 渲染 | lib/client.js |
| dsh-client-ui-conversation | 对话页/探索未至之境/模型选择槽 | lib/client.js |
| dsh-client-ui-sidebar | 侧边栏 slot 与新建会话 | lib/client.js |
| dsh-client-ui-slots | 通用插槽服务 register/inject | lib/index.js |
| dsh-client-runtime | __ModuleLoader__/defineStore/inject | lib/client.js |
| dsh-client-web-react | renderSlot/storeOf/keyed 选择 | lib/index.js |
| dsh-client-web | Web 壳/启动 boot 图 | lib/index.js |

## 标准工作流

### 1. 首次搭建（已完成）
```powershell
cd scripts
.\backup.ps1 -Force          # 备份原客户端到 original/
.\init-workspace.ps1 -Force  # 从 original 复制到 workspace/
```

### 2. 日常修改
```powershell
# 在 workspace/@deepseek-ai/<包名>/ 下直接修改 lib/*.js
# 修改完成后：
.\diff.ps1                    # 查看改了哪些文件
.\apply.ps1                   # 应用修改（自动快照 + Junction 替换）
# 完全退出 Harness 后重启生效
```

### 3. 出问题复原
```powershell
.\restore.ps1                 # 一键复原所有包到原始状态
# 或单个包：
.\restore.ps1 -Package dsh-client-ui-layout
```

### 4. 查看状态
```powershell
.\status.ps1                  # 查看所有包的当前状态
```

## 关键铁律

1. **永远不要直接修改原安装目录** — 只在 `workspace/` 中修改
2. **apply 前自动快照** — `snapshots/` 中保留每次应用前的工作区状态
3. **original/ 是只读复原源** — 除非重新备份，否则不要修改
4. **修改后必须完全退出 Harness 重启** — `client.js?rev=` 缓存机制要求
5. **所有操作有日志** — `logs/dsh-mod-YYYYMMDD.log`

## 关联文档

- 开发文档：`D:\workspace\starfield-agent\docs\20-任务文档\12-Starfield主区覆盖与对话模式切换-开发文档.md`
- 总统筹入口：`D:\workspace\starfield-agent\docs\00-导航与入口\00-总统筹入口文档.md`
