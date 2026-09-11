# dsh-director-plugin — 总监驾驶舱插件包

> 26号文 P0 阶段产物（T-PLUG-004）。目标：把内联在 dsh-client-ui-conversation/lib/client.js 里的总监功能迁为独立插件，走 Harness 官方 client 插件通道。
> **施工图**：`docs/01-插件迁移明细清单.md`（v3）— 含 19 个迁移块 + 依赖拓扑 + 风险登记 + 行号导航表。

## 迁移进度

| 批次 | 内容 | 状态 |
|:----:|:-----|:-----|
| 1 | A14 剥离 / A3+D3 日志 / A11 布局 store / A12 主题 store / C1 布局探针 / C2 模型配置 | ✅ **已完成 2026-09-11** |
| 2 | A1 消息 store / A2 记忆 CRUD / **A4 分支创建** / **A5 docs store** / V10 Cookie / IndexedDB 主层 | ✅ **已完成 2026-09-11** |
| 3 | A6 文件通道 / A7~A10 持久化+store | ⬜ 受阻 T5 spike |
| 4 | D1 directorProcess / D2 审核 | ⬜ |
| 5 | E1 DirectorFlow（E2 DirectorView ⛔ 已废弃） | ⬜ |
| 6 | F3+F4 全局 API / F1/F2+G1/G4 宿主注入点改造 / F5 tab 注册 | ⬜ |

**批次 1 关键成果**：宿主 `client.js` **1,479,577 → 564,826 B（-914,751 B / -61.8%）** —— 单行 541KB 的 `DSH_DOCS_INDEX` 内联常量已外置为 `assets/docs-index.json`（含 docs/ 90 篇全文），改由插件运行时加载。

**批次 2 关键成果**：数据层 6 模块落地，4 个宿主直接调用的全局契约（`__dshMemory` / `__dshCreateBranch` / `__dshSwitchMemoryTab` / `__dshShowToast`）全部原样保留；XSS 转义（V9.4-P1）回归防线；R5 持久化 key 兼容性 8 项逐一校验。

## 目录结构

```
dsh-director-plugin/
├── assets/docs-index.json    ← A14 外置资源（915,314 B / 90 篇全文）
├── build/build.mjs           ← 构建脚本（P1 启用）
├── docs/01-插件迁移明细清单.md ← 施工图 + 修改导航图（★ 改代码前先查这里）
├── scripts/
│   ├── strip-a14.py          ← A14 剥离脚本（含 --dry-run）
│   ├── restore-a14.py        ← A14 回滚（含 --check）
│   └── verify-batch1.mjs     ← 迁移验证（批次 1+2，56 项，IS_PASS 判定）
├── src/
│   ├── client-entry.js       ← 浏览器侧入口（installBatch1）
│   ├── index.js              ← 骨架导航表（block ↔ 文件 ↔ 源行号）
│   ├── util/   debug.js · log-collector.js
│   ├── store/  layout.js · theme.js · docs-index-inject.js
│   │            messages.js · memory.js · branch.js · docs.js   ← 批次 2 数据层
│   │            cookie.js（V10 分块）· idb.js（IDB 主层）
│   ├── config/ model.js
│   └── bridge/ spike-fs-probe.js（T5 R3 验证）
└── lib/（构建产物）
```

## 官方通道（勘察结论，详见 docs/50-信息中心/插件加载通道勘察-20260907.md）

1. 本包 package.json 声明 dsh.client（platform/inject/immediately）。
2. host 侧 dsh-client-modules 增量扫描 host Loader entries 中声明 dsh.client 的包（**plugin-set 变更重启生效**）。
3. bundle 由 host webserver 在 /plugins/<id>/client.js 提供；index.html 被注入 window.__DSH_BOOT__。
4. 浏览器端 prefetch → cordis Loader 逐行 create → 全 ACTIVE 后 settled。
5. bundle 内 require 解析范围 = 平台模块表 + boot graph 注入包；跨插件 value import 是构建错误。

## 验证

```bash
node dsh-director-plugin/scripts/verify-batch1.mjs    # 批次 1+2：56 项，退出码 0 = 通过
node --check dsh-director-plugin/src/**/*.js          # 语法校验
python dsh-director-plugin/scripts/restore-a14.py --check   # A14 回滚锚点自检
```

## 安装（spike，T-PLUG-003）

1. 完全退出 Harness（含托盘）。
2. 把本目录复制到 D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh-director-plugin。
3. 启动 Harness → 打开插件中心/设置-插件清单确认出现本包；或 DevTools 检查 window.__DSH_BOOT__.plugins 是否含本包 id。
4. 失败回滚：删除该目录 + 重启（零残留）。

## 开放点

- host 侧包发现（host Loader 从 node_modules 装载插件的字段/清单）——spike 验证。
- dsh.client.inject 包的 require 可达边界——spike 验证。
- **R3**：插件通道下 `window.require`/`global.require`/`electron.remote.require` 可达性（脚本 `src/bridge/spike-fs-probe.js` 已就绪，阻断批次 3）。

## 回滚

删除本包目录即完全退出插件通道；client.js 主补丁不受影响。

**A14 剥离回滚**：从 `snapshots/snapshot-20260908-131412-before-apply/` 取回 `dsh-client-ui-conversation/lib/client.js`（1,479,577 B 原版），或从 `assets/docs-index.json` 反向内联。
