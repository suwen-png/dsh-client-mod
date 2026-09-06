---
positioning: "DeepSeek Harness 原客户端修改工作区，实现总监对话模式"
goal: "完成 V10 总监驾驶舱重构，三tab共存，文档索引53篇"
phase: "开发中"
progress: 0
progressManual: false
createdAt: "2026-08-27"
updatedAt: "2026-09-02"
---

# 项目总览

## 详细描述
本项目是 DeepSeek Harness 原客户端的修改工作区，通过备份-修改-符号链接-复原的全链路，
在不修改原安装目录的前提下，为 Harness 增加总监对话模式、三tab共存、文档索引等功能。

## 里程碑
- [x] V7 基础总监对话（2026-08-28）
- [x] V8 文档体系（2026-08-30）
- [x] V9 总监驾驶舱 UI（2026-09-01）
- [ ] V10 布局重构（进行中）
- [ ] V11 智能体体系完善

## 约束
- 永远不直接修改原安装目录
- 所有修改在 workspace/ 中进行，通过 apply.ps1 应用
- 修改后必须清除缓存并完全退出 Harness 重启
