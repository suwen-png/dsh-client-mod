# T-V12-008 · GitHub 远程仓库新建 + 授权 + 推送（本地为准）

> **文档编号**: 20-任务文档/32 ｜ **创建**: 2026-09-11 15:45 ｜ **修订**: 2026-09-11 15:30（用户决策回写）｜ **标准**: execution-standards V3.9.0
> **任务**: T-V12-008（03-待完成任务清单 · P1 · 🔴 高风险）
> **用户指令原文要点**: 新建 GitHub 远程仓库 → 完成授权 → 推送到 GitHub；**全程以本地数据为准，不要从远程恢复或拉取任何历史数据**（远程长时间未同步，本地才是最新正确版本）；先确认授权凭据可用，再新建仓库并关联本地仓库完成同步。

---

## 〇、用户决策回写（2026-09-11 15:30 · 四条指示，方案定稿依据）

| # | 用户决策 | 对本方案的约束变更 |
|:-:|:---------|:-------------------|
| 1 | **仓库可公开，无权限限制** | 步骤 3 可见性由「默认建议 `--private`」**改为 `--public`**；PAT scope 由 `repo` 降为 **`public_repo` 即可** |
| 2 | **远程历史数据直接废弃**，不再处理、不参与同步 | 步骤 4 主路径改为 **`--force-with-lease` 覆盖**；`git ls-remote origin` 发现远程有旧 commit 时**不再回问**，直接以本地为准强推 |
| 3 | **VPN 暂不开启**，本次仅记录处理要求、**暂不实施** | 全任务状态由「CP3 阻塞」→ **「已登记待实施（用户明示暂缓）」**；不催办、不重试、不检测出网 |
| 4 | **优先处理其他部分**，同步相关不着急 | 本任务**退出当前执行队列**，仅作为待办登记保留；AI 转做其他可闭环项 |

---

## 一、需求理解

| 类型 | 内容 |
|:-----|:-----|
| **显性需求** | ① 确认 GitHub 授权凭据可用 → ② 新建远程仓库 → ③ 关联本地仓库 → ④ 推送本地数据到远程 |
| **隐性需求** | ⑤ **单向 push，绝不 pull/fetch 远程历史**（避免旧数据污染本地）；⑥ 本地 `main` 分支状态完整入远程；⑦ 推送后需可验证（远程存在全部提交与文件） |
| **约束边界** | 不修改本地历史（不 rebase/reset/amend 既有 commit）；不引入远程任何 ref；不改动 `workspace/` `original/` `snapshots/` 等被忽略目录的策略 |
| **🔴 用户侧前置** | 用户明确"先确认授权凭据可用"——凭据与出网通路属用户侧资源，AI 无法自行生成 |

---

## 二、本地仓库现状（2026-09-11 实测）

| 项 | 值 |
|:---|:---|
| 仓库根 | `D:\hermes-data\dsh-client-mod` |
| HEAD | `0cf87c1` — docs: 03清单 V9D批次1回写 + N-3.2 验证清单重构 |
| 提交总数 | 6（`9a732ca` → `c471f35` → `2d75531` → `fe6e651` → `43b300b` → `0cf87c1`） |
| 分支 | `main`（唯一，无远程跟踪） |
| remote | **无**（`git remote -v` 空） |
| local user | `dsh-client-mod-bot <dsh-mod@local>` |
| 未提交 | **3 改**（`_memory/MEMORY.md`、`05-项目大索引.md`、`06-工作快照.md`、`28-插件化整改执行总清单.md`）+ **6 未跟踪**（07-认知报告、统一方案、P0 实现方案、开发交接包、V11/V12 设计稿） |
| .gitignore 关键项 | 忽略 `original/`、`workspace/`、`snapshots/`、`backups/`、`logs/*.log|*.png|*.bmp|*.json`、`.idea/`、`.workbuddy/` |

> 入仓内容 = 文档 + 脚本 + 配置 + 安装/复原链路；被忽略的是"可重算/体积大"的产物（快照、日志、工作区副本）。这是 V1.2 整改期既定策略，本次不改。

### 2.1 环境与凭据现状

| 项 | 实测 | 判定 |
|:---|:---|:---|
| `gh` CLI | 已安装 v2.97.0（`C:\Program Files\GitHub CLI\gh`） | ✅ 可用 |
| `gh auth status` | **未登录任何 host** | 🔴 需授权 |
| git credential helper | `helper-selector`（selected=`wincred`） | ⚠ 非 `store`；`store` 仅对 https 且需已存凭据 |
| 全局代理 | `http.proxy` / `https.proxy` / `http.https://github.com/.proxy` = `http://127.0.0.1:7897` | 🔴 端口不通 |
| 用户名（全局） | `suwen-png` / `suwen-png@users.noreply.github.com` | 供参考 |

### 2.2 网络取证（阻塞点）

| 探测 | 命令 | 结果 |
|:--|:--|:--|
| 走代理访问 | `git ls-remote https://github.com/suwen-png/dsh-client-mod.git` | `Failed to connect to github.com:443 over proxy 127.0.0.1 after 2118 ms` |
| 代理端口存活 | `curl -x http://127.0.0.1:7897 https://api.github.com` | `Failed to connect ... after 2023 ms`（code 000） |
| 清空代理直连 | `git -c http.proxy= -c https.proxy= clone --depth 1 https://github.com/octocat/Hello-World.git` | 21s 后 `Could not connect to server`（另一轮为 `Recv failure: Connection was reset`） |
| 直连 API | `curl --noproxy '*' https://api.github.com/` | 一次 `code=200`，复测 `code=200 size=0`（写入中断）→ **证据不稳定** |

**结论**：GitHub 出网当前**不可用**。按 execution-standards §3.4「外网连接失败，判定为用户未开 VPN，提示开启不反复试」→ **不重试，转 CP3 阻塞反馈**。

---

## 三、执行方案（网络与凭据恢复后按序执行）

> 全程遵守「以本地为准」：**只做 `push`，不做 `fetch`/`pull`/`remote set-head` 等任何引入远程 ref 的操作**。

### 步骤 1 · 授权（二选一，推荐 A）

**A. gh CLI 授权（推荐，自动写入凭据）**
```bash
gh auth login --hostname github.com --git-protocol https --web
# 浏览器完成授权后验证：
gh auth status
```
**B. PAT 写入 store（无浏览器时）**
```bash
printf "protocol=https\nhost=github.com\nusername=<你的GitHub用户名>\npassword=<PAT>\n\n" | git credential-store store
git config --local credential.helper store     # 仅本仓，不改全局
git config --local git config --local user.name  "<你的GitHub用户名>"
git config --local user.email "<你的邮箱>"
```
> `PAT` 需含 **`public_repo` scope**（仓库定为公开，见 §〇 决策 1）。
> ⚠ 注意：全局 `credential.https://github.com.provider` **未设置**（其余站点了 `generic` 会触发弹窗）——如需兼容非 gh 场景，显式设 `credential.https://github.com.provider=generic` 或 `basic`。

### 步骤 2 · 提交本次未纳管内容（本地为准的一部分）
```bash
cd /d/hermes-data/dsh-client-mod
git add -A
git commit -m "docs: 项目认知初始化报告 + V11/V12 设计稿 + P0/V12 方案文档纳管"
git log --oneline -1
```

### 步骤 3 · 新建远程仓库并关联
```bash
# 方式 A：gh 一条命令建仓并加 remote（不推送）
gh repo create <repo-name> --public --source=. --remote=origin --description "DeepSeek Harness 原客户端修改工作区"
# 方式 B：先在网页建空仓（⚠ 不要勾选 README/.gitignore/License，避免产生远程提交），再手动关联
git remote add origin https://github.com/<owner>/<repo-name>.git
git remote -v
```
> **仓库可见性：`--public`**（用户 2026-09-11 决策：可公开，无权限限制）。

### 步骤 4 · 单向推送（本地为准）
```bash
git push -u origin main
# 远程若已有旧历史 → 按用户决策「历史数据直接废弃」，直接以本地为准覆盖：
git push -u origin main --force-with-lease
```
> ⚠ 远程侧 `.gitignore` 与被忽略目录（`original/` `workspace/` `snapshots/`）**不入仓**，与本地策略一致。

### 步骤 5 · 推送后校验（3 条，均为可核验证据）
```bash
git ls-remote origin                    # ① 远程 main 的 SHA == 本地 HEAD SHA
git rev-parse HEAD
gh repo view <owner>/<repo> --json defaultBranchRef,url   # ② 默认分支为 main
git log origin/main --oneline | head    # ③ 远程可见 6+1 条提交
```

---

## 四、状态说明（已登记待实施）

| 项 | 内容 |
|:---|:---|
| **状态** | 🟡 **已登记待实施** — 用户 2026-09-11 明示「VPN 暂不开启，本次仅记录处理要求，暂不实施」+「同步相关不着急，优先处理其他部分」 |
| **原因（保留取证）** | ① GitHub 出网不可用（代理 `127.0.0.1:7897` 端口已死；清空代理直连被 reset/超时）；② 无任何 GitHub 授权凭据（`gh auth status` 未登录，credential store 无 github.com 条目） |
| **性质** | 二者均为**用户侧资源**（VPN/网络 + 账号凭据），AI 无法自行生成或代持 |
| **当前动作** | **不催办、不重试、不检测出网**。待用户主动开启 VPN 后，从「附录 A」执行，AI 再从步骤 2 连续执行至步骤 5 校验闭环 |
| **已消除的争议** | 仓库可见性（→ public）、远程历史处置（→ 直接废弃无需回问）均已由用户决策锁定，恢复通路后**无需二次确认**即可一次推完 |

### 附录 A · 需用户执行的两条命令（恢复通路后）

```bash
# A1. 恢复出网（启动/修正 VPN 后凭结果确认——若代理端口不是 7897，请以下一步实测为准）
cd /d/hermes-data/dsh-client-mod
git -c http.proxy= -c https.proxy= ls-remote https://github.com/suwen-png/dsh-client-mod.git   # 期望：不再报 connect 失败

# A2. 授权（按提示在浏览器完成）
gh auth login --hostname github.com --git-protocol https --web
gh auth status
```

> 若 A1 仍失败：说明当前网络环境无法直连 GitHub，需用户开启 VPN 客户端后再试，或提供可用的代理地址（届时 AI 会写入 git 配置项 `http.proxy`/`https.proxy`）。

---

*状态: 【已登记待实施】2026-09-11 15:30 — 用户明示 VPN 暂不开启、优先处理其他部分；本任务挂起，恢复通路后从步骤 2 连续执行至校验闭环*
