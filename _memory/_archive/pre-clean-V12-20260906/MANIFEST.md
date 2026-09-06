# Pre-Clean-V12 MANIFEST（整改 V1.2 清理前清单）

**生成时间**: 2026-09-06 22:30
**整改版本**: V1.2（任务 T-V12-001 ~ T-V12-005）
**目的**: 删除前归档清单，防止误删后无法追踪
**保留策略**: 不复制文件本体，只生成清单+关键摘要
**用户授权**: 2026-09-06 22:30 「除了 git 其他都同意 去处理吧」

---

## T-V12-001: scripts/_archived-20260831/（28 文件, 0.09 MB）

### 文件清单

- `fix_b2.py`
- `fix_both.py`
- `fix_console_log.py`
- `fix_cookie_key.py`
- `fix_cookie_persist.py`
- `fix_cookie_persist2.py`
- `fix_css_load.py`
- `fix_css_v2.py`
- `fix_css_v3.py`
- `fix_css_v4.py`
- `fix_css_v5.py`
- `fix_debug_init.py`
- `fix_focus.py`
- `fix_global_click.py`
- `fix_log_file.py`
- `fix_log_file2.py`
- `fix_log_file3.py`
- `fix_log_file4.py`
- `fix_persist.py`
- `fix_persist_log.py`
- `fix_session_key.py`
- `fix_session_key2.py`
- `fix_session_key3.py`
- `modify_v10.py`
- `modify_v10_2.py`
- `modify_v10_3.py`
- `modify_v10_4.py`
- `test-cookie.js`

### 决策依据

- 一次性 fix 脚本，已被 V10 V3 整改后的稳定版本取代
- 内容已入仓于 git history（commit `9a732ca` 已 add scripts/_archived-20260831/）
- 删除不损信息：git history + 整改报告可追溯

---

## T-V12-002: scripts/ 一次性探针（49 文件, ~140 KB）

### 文件清单

#### activate-harness 系列（4）
- `activate-and-shot.py`
- `activate-harness.py`
- `activate-harness2.py`
- `activate-harness3.py`

#### check-* 系列（8）
- `check-content2.py`
- `check-dv.py`
- `check-foreground.py`
- `check-tabbar-text.py`
- `check-v10-content.py`
- `check-v10-visible.py`
- `check-window.py`
- `check-zindex.py`

#### 操作/截图探针（27）
- `auto-dev.py`
- `console-check.py`
- `ctypes-click.py`
- `find-port.py`
- `force-show.py`
- `kill-harness.py`
- `move-window.py`
- `open-devtools.py`
- `pil-screenshot.py`
- `restart-harness.py` *(注意：与 scripts/restart-harness.ps1 重名但不同内容，是一次性脚本)*
- `screenshot.ps1`
- `screenshot_v2.py`
- `shot1.ps1`
- `shot2.ps1`
- `shot3.ps1`
- `shot-console.ps1`
- `shot-content.ps1`
- `shot-content2.ps1`
- `shot-ctypes.ps1`
- `shot-devtools.ps1`
- `shot-dv.ps1`
- `shot-f12.ps1`
- `shot-tabbar.ps1`
- `shot-v10.ps1`
- `shot-zindex.ps1`
- `show-error.py`
- `take-shot.ps1`

#### 索引恢复 + V10 V3 整改辅助（10）
- `extract-dsh-index.py`
- `restore-dsh-index.py`
- `restore-dsh-index2.py`
- `node-check-error.txt`（261KB 错误日志）
- `fix-b-section.py`（V10 已合并 V3）
- `fix-loadconfig.py`（V10 已合并 V3）
- `fix-save-persist.py`（V10 已合并 V3）
- `fix-save-persist2.py`（V10 已合并 V3）
- `gui_test_v2.py`（已被 V3 替代）
- `gui_test_v2_2.py`（已被 V3 替代）
- `deploy.py`（与 deploy.ps1 重复）

### 决策依据

- V10 V3 整改已完成（2026-09-01 测试报告）
- 探针用途已过（V10 V3 验证已完工）
- 索引重建由 `gen-docs-index.ps1` 替代
- 保留：A 类主流程 11 个 + B 类 dsh_docs_index.txt + C 类 full-audit.py/gui_test_v3.py

---

## T-V12-003: backups/dsh-director-backup-*（2 目录, 305.7 MB）

### 目录 1: backups/dsh-director-backup-20260906-004910/

- **大小**: 36.32 MB
- **文件数**: 8096 个
- **最后修改**: 2026/9/2 23:11:32
- **顶层结构**: docs/ lib/ node_modules/ src/ _memory/ + 顶层文件 build.mjs cordis.patch.yml dsh.plugin.json package-lock.json package.json
- **内容性质**: 完整 Harness 项目源码（含 node_modules + 完整 src + 完整 docs）
- **关键源码**: src/client/components/director/{BranchPanel, DirectorChat, DirectorDoc, DirectorMem, DirectorPan, FileExplorer, MemoryPanel, PlanConfirm, ProjectPanel, ReviewCard, TaskPanel}.tsx + TracePanel.tsx + DirectorApp.tsx + icons.tsx + index.tsx + styles.ts

### 目录 2: backups/dsh-director-src-backup-20260906-004910/

- **大小**: 255.43 MB
- **文件数**: 4697 个
- **最后修改**: 2026/9/2 23:11:32
- **内容性质**: 完整 Harness 项目源码（比目录 1 更早版本或更全，含 node_modules + typescript 全套语言包）

### 决策依据

- V10 V3 整改已完工（2026-09-01）+ dsh 客户端改造方案已冻结
- 两个备份对应早期开发阶段（V10 之前），已被 original/ 取代
- 原始代码始终保留在 `original/`（项目根目录，由 backup.ps1 维护）
- 源码价值可从 `original/` + `workspace/` + git history 中重建
- **风险**: 删除后无法直接 read，需从 `original/` 重建或 git checkout
- **缓解**: 本 MANIFEST.md 记录顶层结构；git 入仓可恢复目录骨架

---

## T-V12-004: backups/client.js.tmp + client-v2.js（2 文件, 555 KB）

| 文件 | 大小 | 修改时间 | 性质 |
|:-----|----:|:--------|:-----|
| `client.js.tmp` | 267 KB | 2026/9/6 0:56:43 | 临时编译产物 |
| `client-v2.js` | 275 KB | 2026/9/6 1:33:20 | V10 中间版本，已被 V0.2.0 取代 |

### 决策依据

- 客户端当前版本（V0.2.0）已在 `workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`
- `client.js.tmp` 是编译中间产物，无持久价值
- `client-v2.js` 是 V10 V3 整改前中间版本，已被 V3 取代
- V0.2.0 之前有 `client.js.bak-20260901-zb2`（1.1MB）保留作为版本回滚锚点

---

## T-V12-005: snapshots/manual-bak-batch1（1 文件, 0.57 MB）

| 文件 | 大小 | 修改时间 | 性质 |
|:-----|----:|:--------|:-----|
| `client.js.bak-batch1` | 583 KB | 2026/9/1 10:07:35 | zb2 整改前早期手动备份 |

### 决策依据

- `snapshot.ps1` 已系统化处理后续快照（snapshots/ 下其他自动快照目录）
- 此手动备份仅 1 个文件 `client.js.bak-batch1`，无其他配套文件
- 内容已被 `original/` 覆盖（original/ 是首次备份的权威源）
- snapshots/ 下其他自动快照保留作为系统化历史

---

## 总览

| 任务 | 文件/目录数 | 大小 | 风险 |
|:----|:----------:|:----:|:----:|
| T-V12-001 | 28 文件 | 0.09 MB | 🟢 |
| T-V12-002 | 49 文件 | ~140 KB | 🟢 |
| T-V12-003 | 2 目录 12793 文件 | 291.75 MB | 🟡（源码备份，需 MANIFEST 留档） |
| T-V12-004 | 2 文件 | 555 KB | 🟢 |
| T-V12-005 | 1 文件 | 0.57 MB | 🟢 |
| **合计** | **80 文件 + 2 目录** | **292.55 MB** | |

---

## 复核路径

- 完整清理前审计: `docs/40-测试质量/12-scripts探针审核-20260906.md`
- 整改总览: `docs/20-任务文档/23-dsh-整改总览-V1.2-20260906.md`
- 本 MANIFEST 入仓: 整改 V1.2 清理结果 commit

---

*本文件由 AI 自动生成 ｜ 删除前必须确认本文件已 git 入仓 ｜ 删除后任何恢复操作基于本 MANIFEST*