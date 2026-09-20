# DSH Client Mod — DeepSeek Harness 总监驾驶舱插件

> 版本：V16 落死基线 ｜ 最近更新：2026-09-20 ｜ Harness 版本：0.1.0-rc.11
> 定位：基于 [DeepSeek Harness](https://github.com/) 官方 **cordis client 插件通道** 构建的「总监驾驶舱」——把多分支对话、思维导图、设计图工作室、嵌套总监调度整合到一个插件里。
> 仓库：<https://github.com/suwen-png/dsh-client-mod>（公开）

## 这是什么

一个跑在 DeepSeek Harness 里的独立插件 `dsh-director-plugin/`。它不改宿主编译产物，走官方插件 `inject` 通道（`slots` + `sessions`），在宿主界面上叠加：

- **总监页**（三页签：总监 / 对话 / 轨迹）——理解你的需求、按职能分流到不同分支对话
- **思维导图**——按项目 → 分支两级分组，支持拖拽、血缘、作用域过滤、层级折叠
- **设计图工作室**——需求图 / 交互逻辑 / 思维导图元素库的可视化编排
- **总监弹窗**——左总监面板 + 右原生对话分屏，支持固定作用域（`dialogPinned`）

核心思路：你只跟一个外层对话说话，由总监做需求理解、上下文整理、模型/技能/角色选择，再把活分到对应的分支对话里去执行，最后汇总反馈。

## 核心能力

| 能力 | 现状 |
|:--|:--|
| 需求分流 | A1–A8 八维分线（世界观 / 剧情 / 人物 / 力量体系 / 正文 …）+ 噪声分辨 |
| 会话复用 | 冷启动后优先复用已有会话，不重复建；真机「复用 8 · 新建 0 · 净增 0」 |
| 会话档案 | 每个会话自带总监角色与总结（`session-dossier`） |
| 思维导图 | 项目分组 / 分支 / 父居中 / 全节点可拖拽 / 血缘 / 作用域∩血缘纯函数 |
| 设计图工作室 | 需求图、交互逻辑、思维导图 18 元素库，逐交互 94/94 跑绿 |
| 调度编排 | roles / dag / delegate / task-state / checkpoint / policy 纯函数内核 |
| 测试闸门 | 离线 60+ 套全绿，真机 `verify-flow` 80/80、`verify-mindmap` 123/123、`verify-v22` 62/62 |

## 目录结构

```
dsh-client-mod/
├── dsh-director-plugin/          # ★ 主交付物（官方插件）
│   ├── src/                      # 源码（logic / store / components）
│   ├── lib/client.js             # 构建产物（~2.1 MB，内容指纹 fa8be859d8223488）
│   ├── build/                   # 构建脚本
│   ├── scripts/                  # 闸门 / 自举 / 探针脚本（Node .mjs）
│   ├── docs/                    # 插件内文档
│   └── INSTALL.md               # 插件安装说明
├── docs/
│   ├── 00-统筹入口/              # ★ 所有需求/方案/审计文档从这里进
│   ├── 10-架构设计/
│   ├── 20-业务文档/
│   ├── 30-开发日志/
│   ├── 40-测试台账/
│   └── 50-信息中心/
├── AGENTS.md                     # 项目执行约束（134 条纪律，AI 改动前必读）
└── README.md
```

> 历史上的 `original/` `workspace/` `patches/` `snapshots/` 是早期「直接改宿主产物」路线的残留，已退坡；当前主管道只走 `dsh-director-plugin/`。

## 快速上手

```powershell
# 1. 安装插件（详见 dsh-director-plugin/INSTALL.md）
cd dsh-director-plugin
node scripts/plugin-install.mjs --apply

# 2. 重启 Harness（或用 reload-client.mjs 热更）
node scripts/reload-client.mjs

# 3. 跑基线校验
node scripts/baseline-check.mjs
# 期望输出：IS_PASS: TRUE（漂移=0）
```

## 文档入口

| 用途 | 路径 |
|:--|:--|
| **现状基线**（唯一权威） | `docs/00-统筹入口/10-当前基线-落死锚点-V16.md` |
| **整体方案**（总监网络 + 外层单对话） | `docs/00-统筹入口/23-总监网络与外层单对话架构方案-20260920.md` |
| 需求符合性总审计 | `docs/00-统筹入口/22-需求符合性总审计与实施总方案-20260918.md` |
| 总监枢纽闭环 | `docs/00-统筹入口/13-总监枢纽闭环-需求与实施文档-20260916.md` |
| 导图维度分区与拖拽 | `docs/00-统筹入口/20-导图项目维度分区与全节点可拖-需求与实施规格-20260918.md` |
| 总监作用域与导图联动 | `docs/00-统筹入口/21-总监文件夹作用域与导图联动-需求与实施规格-20260918.md` |
| 项目执行约束 | `AGENTS.md` |

## 开发约定

- 构建→装机 7 步：闸门 → `gen-source-map` → `build.mjs` → `check-stale-build` → `plugin-install --apply` → 重启 / reload → 真机验证
- 测试范围 = 受影响面 ∪ 新增/修改面，不做无条件全量
- 同一语义只允许一处实现（纪律 126）
- 退出码：0 通过 / 1 FAIL / 2 INVALID

## License

个人项目，暂未指定开源协议。
