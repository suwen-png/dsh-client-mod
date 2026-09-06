# _memory/_archive — 项目记忆归档目录

> 启用日期：2026-09-06（整改 V1.2 任务 #7）

## 工作机制

`_memory/MEMORY.md` 是活跃记忆主文件（90 天内的关键决策），按 `AI规范执行保障机制.md §四` 蒸馏规则：
- 30 天内 → 活跃
- 30-90 天 → 降权（仍保留在 MEMORY.md）
- 90-180 天 → 深度归档（移入本目录）
- 180 天+ → 最小化（保留索引不保留正文）

## 归档动作

| 时机 | 操作 |
|:-----|:-----|
| 每季度末（3/6/9/12 月） | 蒸馏 MEMORY.md → 归档本目录 |
| 重大决策反转时 | 旧版本封存 |
| 用户主动要求归档 | 立即执行 |

## 命名规范

`_memory/_archive/<原文件>-YYYYMMDD-archived-<version>.md`

示例：
- `_memory/_archive/MEMORY-20260906-archived-pre-v1.2.md`
- `_memory/_archive/MEMORY-20261231-archived-2026-Q4.md`

## 检索路径

| 需求 | 去哪 |
|:-----|:-----|
| 当前活跃记忆 | `_memory/MEMORY.md` |
| 跨季度/历史决策 | `_memory/_archive/` |
| 决策溯源 | `_memory/MEMORY.md §二 关键决策记录（ADR）` |
| 风险与踩坑 | `_memory/MEMORY.md §三 §四` |

## 已知问题

- 2026-09-06：目录自 2026-08-24 创建以来一直为空，本次整改首次启用工作流
