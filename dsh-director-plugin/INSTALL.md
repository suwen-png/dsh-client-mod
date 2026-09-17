# 安装与部署 — dsh-director-plugin

> **T-PLUG-008 交付物** ｜ 单一真相源：本文是**安装/卸载/验证**的唯一权威说明，`README.md` 只留指针。
> 适用对象：Harness 官方 **client 插件通道**（cordis）。原理勘察见 [`../docs/50-信息中心/插件加载通道勘察-20260907.md`](../docs/50-信息中心/插件加载通道勘察-20260907.md)。

---

## 一、TL;DR（一条命令）

```bash
cd dsh-director-plugin

node build/build.mjs                    # ① 构建（源码改动后必做）
node scripts/plugin-install.mjs --apply # ② 安装（幂等）
node scripts/plugin-install.mjs         # ③ 自检（应输出「✅ 已完整就绪」）
# ④ 重启 Harness（见 §四）
node scripts/cdp-verify.mjs             # ⑤ 真机核查（应 39/39）
```

**默认零写入**：不带 `--apply` / `--uninstall` 时只读检查，任何路径都不改。

---

## 二、三处安装点（缺一不可）

插件必须同时落在三处，少任何一处都**不报错但功能不生效**：

| # | 路径 | 是什么 | 少了会怎样 |
|:-:|:-----|:-------|:-----------|
| ① | `<Harness>/resources/host/node_modules/@deepseek-ai/dsh-director-plugin/` | **实体包**（`package.json` + host face `lib/index.js` + client bundle `lib/client.js` + `assets/` + `cordis.patch.yml`） | 插件根本不存在 |
| ② | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-director-plugin` | **目录 junction** → ①（供 profile 侧 `createRequire(ctx.baseUrl)` 解析） | host 启动时报依赖解析失败 |
| ③ | `~/.dsh/profiles/web/cordis.patch.yml` | **用户补丁层**，`insert` 一个 entry `deepseek-ai.director` 把 host face 挂进 loader 树 | host face 从未被 create，client bundle 也就不会被请求 |

**③ 是共享文件** —— 可能已被其他插件/手工内容占用。卸载时只做**外科式移除**本插件那一个 entry，其余原样保留。

### 加载链路（为什么是这三处）

```
package.json 声明 dsh.client
   → host Loader 装载 entry ③
   → dsh-client-modules 增量扫描 host Loader entries 中声明 dsh.client 的包
   → GET /plugins/<id>/client.js  （由 host webserver serve ① 的 lib/client.js）
   → tapIndex 注入 window.__DSH_BOOT__
   → bundle factory 在 __ModuleLoader__.load({ id, factory(require) }) 内执行
```

> 🔴 **client bundle 的发现发生在 host 启动时** —— 新增/删除插件包**必须重启**，HMR 不覆盖插件集变更。

---

## 三、安装器命令面

```bash
node scripts/plugin-install.mjs                      # verify（默认）：只检查，零写入
node scripts/plugin-install.mjs --apply              # 安装（幂等：已就绪则报告 unchanged）
node scripts/plugin-install.mjs --uninstall          # 卸载 ②③，**保留 ①**
node scripts/plugin-install.mjs --uninstall --purge  # 连 ① 一起删（彻底退出插件通道）
node scripts/plugin-install.mjs --harness "<path>"        # 指定 Harness 根目录
node scripts/plugin-install.mjs --profile-root "<path>"   # 指定 profile 根（默认 ~/.dsh）
```

也可用环境变量：`DSH_HARNESS_ROOT` / `DSH_PROFILE_ROOT`。

**三条硬纪律**（脚本内已落实，改动时不得破坏）：

| 纪律 | 含义 |
|:-----|:-----|
| **A. 默认零写入** | 无 `--apply`/`--uninstall` 时不碰任何路径 |
| **B. 幂等** | 已就绪则报 `unchanged`，不重写、不重复插入 entry |
| **C. 绝不删第三方内容** | 卸载只外科式移除本插件 entry；不递归删实体包（除非 `--purge`） |

> **为何是 Node 而非 PowerShell**：本机 PowerShell 通道无输出（工作区既有记录），脚本无法自证；且仓库既有工具链（`build/`、`verify-*`、`cdp-*`）全部是 `node scripts/*.mjs`，并入同一通道避免第二套心智模型。目录 junction 用 `fs.symlinkSync(t, p, "junction")`，**Windows 下免管理员**。

### 🔴 卸载终态为何留一个 `[]`

YAML 里「只有注释」会解析成 **`null`**，而 ③ 的顶层契约是**数组**（文件头注释自述「语法：顶层 YAML 数组」）。`[]` 才是「零个 patch」的正确表达。
且 `--apply` 追加前会**先剔除独立的 `[]` 行** —— 否则会得到 `[]` 紧跟 `- insert:` 的非法 YAML（顶层标量后又出现列表项）。该缺陷由 **uninstall → apply 往返测试实测发现**。

---

## 四、启动（复现验证必需）

🔴 本机 shell 环境带 `ELECTRON_RUN_AS_NODE=1`，会使 Electron 退化为纯 Node 并拒绝 Chromium 开关（报 `bad option: --remote-debugging-port=9222`）。**必须清除**，并以**后台常驻**方式启动：

```bash
cd "D:/软件安装/DeepSeek-Harness-Desktop/DeepSeek Harness"
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS "./DeepSeek Harness.exe" --remote-debugging-port=9222
```

强制结束进程时（Git Bash 下 `taskkill //F` 会报「无效参数」）：

```bash
MSYS_NO_PATHCONV=1 taskkill /F /IM "DeepSeek Harness.exe"
```

清渲染缓存只清这些，**保留 `IndexedDB` / `Local Storage` / `Network`**：

```
%APPDATA%/@deepseek-ai/dsh-desktop/
  ✅ 可清：Cache · Code Cache · GPUCache · DawnGraphiteCache · DawnWebGPUCache
  ⛔ 禁清：IndexedDB · Local Storage · Network      ← 含总监与宿主数据
```

> ⚠️ **历史缺陷（已退役）**：旧 `scripts/deploy.ps1` 的清理列表含 `Network`，属「顺手多删」；且它指向已废弃的旧路径。**不要用它**，见 §六。

---

## 五、验证

### 5.1 干净目录部署验收（双机模拟）

```bash
node scripts/verify-install-clean.mjs        # 46 项，临时沙箱全生命周期，不触碰真实环境
```

在**两个临时沙箱**（伪 Harness 根 + 伪 profile 根）里跑完整生命周期：
`干净 --apply` → `幂等再 apply` → `verify 就绪` → `--uninstall` → `从已卸载态再 apply` → `--uninstall --purge` → **真实用户环境零触碰反证**。

> 🔴 **它捕获了一个真实缺陷**：`PAYLOAD_FILES` 原先**漏了 `package.json`**。本机「一切正常」只因它早先被手工拷入 —— 典型「环境残留掩盖缺件」。而 host Loader **靠 `package.json` 发现本包**，缺件后果双重：① 干净机器上包目录存在但插件**永不被装载且不报错**；② 安装器状态判据就是该文件 ⇒ `hostState` **永远停在 `missing`**，verify 永不通过。
> **该缺陷在单机幂等测试中必然漏检**（实测：移除后本测试 8 项转红，而安装器**自身的** `IS_PASS` **仍为 TRUE** ⇒ 安装器对自己的缺件是盲的）。

### 5.2 分层验证矩阵

| 层 | 命令 | 项数 |
|:--|:-----|:----:|
| 源码级 | `node scripts/verify-batch1.mjs` | 96 |
| bundle 级 | `node scripts/verify-bundle.mjs` | 63 |
| 安装链路级 | `node scripts/verify-install.mjs` | 60 |
| 三层结构 | `node scripts/verify-batch6.mjs` | 65 |
| 自动同步 | `node scripts/verify-batch7.mjs` | 66 |
| 总监逻辑 | `node scripts/verify-batch8.mjs` | 92 |
| 数据安全 | `node scripts/verify-data-safe.mjs` | 42 |
| **干净部署** | `node scripts/verify-install-clean.mjs` | **46** |
| 真机契约 | `node scripts/cdp-verify.mjs` | 39 |
| 真机逐交互 | `node scripts/cdp-click.mjs` | 74 |

---

## 六、故障排查

| 症状 | 根因 | 处置 |
|:-----|:-----|:-----|
| 装了但界面无「总监层级」入口 | ① 实体包缺 `package.json`，或 client bundle 404 | `node scripts/plugin-install.mjs` 看三处状态；缺件先 `--apply` |
| 改代码后行为不变 | 忘了重建 / 没重启 | 重跑 `build/build.mjs` → `--apply` → **重启**（插件集变更只在 boot 生效） |
| `bad option: --remote-debugging-port=9222` | `ELECTRON_RUN_AS_NODE=1` 残留 | 见 §四的 `env -u` |
| `taskkill` 报「无效参数」 | Git Bash 路径转换 | `MSYS_NO_PATHCONV=1 taskkill /F /IM ...` |
| 补丁文件被 YAML 解析成 `null` | 卸载后只剩注释 | 重跑 `--apply`（会自动补 `[]` 语义） |
| 报「② 是实体目录而非链接」 | 历史手工安装残留 | `--apply` **不自动处理**（避免误删用户数据）：人工确认后删目录再重跑 |

> ⚠️ **`scripts/deploy.ps1` 已退役**（2026-09-12）。原缺陷两条：① 指向废弃路径 `D:\hermes-data\dsh-director` 与旧包名 `dsh-director`；② 清缓存列表含 `Network`（误删缓存）。其能力已被 `plugin-install.mjs` 完整取代，且后者默认零写入、幂等、写后回读校验。

---

## 七、开发者改动清单（改完必做）

| 改了什么 | 必须做什么 |
|:---------|:-----------|
| `src/**/*.js` | `node build/build.mjs` → `--apply` → 重启 → `cdp-verify.mjs` |
| `package.json` / `cordis.patch.yml` | `--apply`（会把新内容下发）→ 重启；**若改了 `dsh.client.inject` 需重跑全部分层验证** |
| **新增待安装文件/目录** | 🔴 **同步改 `plugin-install.mjs` 的 `PAYLOAD_FILES` / `PAYLOAD_DIRS`**，并同步 `verify-install-clean.mjs` 的 `EXPECT_FILES` / `EXPECT_DIRS`（两份**刻意独立声明**，就是为了让不一致被测出来） |
| `scripts/*.mjs` | 无需重启；但脚本自身改动应重跑对应验证以证明未回退 |

**回滚**：`node scripts/plugin-install.mjs --uninstall --purge` 即完全退出插件通道（client.js 主补丁不受影响）。

---

*最后更新：2026-09-12 ｜ 关联任务：T-PLUG-008 ｜ 验证：`verify-install-clean.mjs` 46/46*
