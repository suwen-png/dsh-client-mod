# dsh-director 插件开发环境文档

> 🔴 **本文件整体已过时（`T-DOC-001 B4` 收口 · 2026-09-18 · 加横幅、不回改）**
> 本文描述的是**旧插件工程形态**：根目录 `D:\hermes-data\dsh-director`（**该目录不存在**）、
> `src/client/components/director/*.tsx`（TS 源码 + esbuild）。
> **现行工程形态完全不同**：根 = **`D:\hermes-data\dsh-client-mod\dsh-director-plugin\`**，
> 源码 = **`src/**`（JS，自研 `h()`，非 JSX/TS）**，产物 = **`lib/client.js`（单文件 bundle）**，
> 构建 = `build/build.mjs`，装机 = `plugin-install.mjs --apply`。
> ⇒ 🔴 **不要按本文的目录结构或构建方式操作**；现行全链见仓库根 **`AGENTS.md`** 与锚点 §四。
> 本文仅作**历史环境考古**保留（当时的 junction / esbuild / 热更手法有一条演进线索）。

**创建时间**: 2026-09-06
**适用项目**: dsh-client-mod / dsh-director
**文档版本**: V1.0

---

## 一、项目架构

### 1.1 目录结构

```
dsh-director/                    # 插件开发目录
├── src/
│   ├── index.ts                 # 服务端入口（webServer路由）
│   └── client/
│       └── components/director/
│           ├── DirectorPanel.tsx    # 总监面板（三栏布局后备）
│           └── V10Director.tsx     # V10总监控制台（48.2KB，主组件）
├── lib/
│   ├── index.js                 # 编译后的服务端代码
│   ├── client.js                # 编译后的客户端代码（274.8KB）
│   └── *.map                    # Source Map
├── build.mjs                    # 构建脚本（esbuild）
├── package.json                 # 插件配置
├── dsh.plugin.json              # 插件元数据
└── cordis.patch.yml             # Cordis补丁配置
```

### 1.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 18 + TypeScript | 组件化开发 |
| 构建 | esbuild | 快速打包，支持TSX |
| 服务端 | Cordis | Harness插件框架 |
| 状态管理 | React useState | 本地状态，localStorage持久化 |
| 样式 | 内联样式 | 紫色渐变主题，无CSS框架依赖 |

---

## 二、环境配置

### 2.1 关键配置文件

#### credentials.yaml（极易出错！）

**路径**: `C:\Users\15142\.dsh\.credentials.yaml`

**⚠️ 重要：所有字段必须是字符串类型！**

```yaml
# ✅ 正确格式
version: "1"
refs: '{"DEEPSEEK_API_KEY":"sk-xxx"}'

# ❌ 错误格式（会导致Harness启动失败）
version: 1          # 数字，必须加引号
refs:               # 对象，必须转为JSON字符串
  DEEPSEEK_API_KEY: sk-xxx
```

**错误表现**: Harness启动时弹出"desktop Host exited before readiness"错误，提示"the value for version/refs must be a string"

**修复方法**: 用文本编辑器打开，确保所有值都用引号括起来，refs转为JSON字符串。

#### package.json（插件配置）

**路径**: `C:\Users\15142\.dsh\profiles\web\package.json`

```json
{
  "dependencies": {
    "dsh-director": "link:D:/hermes-data/dsh-director"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-director"],
      "disabledBundles": []
    }
  }
}
```

### 2.2 插件inject配置（极易出错！）

**⚠️ 重要：只能inject web profile存在的服务！**

```typescript
// ✅ 正确：只inject存在的webServer服务
export const inject = ['webServer']

// ❌ 错误：inject不存在的sessions服务，会导致Harness启动失败
export const inject = ['webServer', 'sessions']
```

**错误表现**: Harness启动后进程立即退出，无错误提示（静默失败）

**修复方法**: 检查`src/index.ts`中的inject数组，只保留web profile存在的服务。

---

## 三、开发流程

> 🔴 **本章已过时（2026-09-12 · T-PLUG-008 起）** —— 权威说明改见 [`dsh-director-plugin/INSTALL.md`](../../dsh-director-plugin/INSTALL.md)。
> 差异点：① 源码是 `dsh-director-plugin/src/**/*.js`（**不是** `.ts/.tsx`）；② 构建是 `node dsh-director-plugin/build/build.mjs`（**不是**根目录 `build.mjs`）；
> ③ 部署是 `node dsh-director-plugin/scripts/plugin-install.mjs --apply`（`deploy.ps1` **已退役**）；④ 缓存清除**不含 `Network`**。
> 以下原文保留作历史参考。

### 3.1 标准开发流程

```
1. 修改源代码（dsh-director-plugin/src/ 下的 .js 文件）
2. 编译：node dsh-director-plugin/build/build.mjs
3. 部署：node dsh-director-plugin/scripts/plugin-install.mjs --apply
4. 测试：重启 Harness（插件集变更只在 boot 生效），验证功能
5. 自动化测试：node dsh-director-plugin/scripts/cdp-verify.mjs（真机 39 项）+ cdp-click.mjs（逐交互 66 项）
```

### 3.2 插件部署单元（取代原一键部署脚本）

**路径**: `dsh-director-plugin/scripts/plugin-install.mjs`

**功能**: 三处安装点（实体包 / profile junction / 用户补丁层 entry）一把梭；**默认零写入**、**幂等**、写后**逐文件回读校验**

**取代关系**: `scripts/deploy.ps1` 已于 2026-09-12 **退役**为硬失败垫片（原实现指向废弃路径 `D:\hermes-data\dsh-director`，且清缓存列表含 `Network` —— 那是 **cookie 存储**，删它 = 总监状态丢失）。

```bash
node dsh-director-plugin/scripts/plugin-install.mjs            # 只检查（零写入）
node dsh-director-plugin/scripts/plugin-install.mjs --apply    # 安装（幂等）
node dsh-director-plugin/scripts/plugin-install.mjs --uninstall
node dsh-director-plugin/scripts/verify-install-clean.mjs      # 干净目录验收（52 项）
```

> 📖 完整说明（三处安装点为何缺一不可 / 启动陷阱 / 故障排查 / 回滚）：[`dsh-director-plugin/INSTALL.md`](../../dsh-director-plugin/INSTALL.md)

### 3.3 缓存清除（必须！）

Harness使用Electron的缓存机制，修改代码后必须清除缓存才能生效：

**缓存目录**: `%APPDATA%\@deepseek-ai\dsh-desktop\`

需要清除的子目录：
- Cache
- Code Cache
- GPUCache
- blob_storage
- DawnGraphiteCache
- DawnWebGPUCache

> 🔴 **不得清除 `Network`**（2026-09-12 更正）：它是 Chromium 的 **cookie/网络状态存储**，内含 `dsh_director_*` 持久化 cookie（**R5 冻结契约**）⇒ 删它会导致**总监状态丢失**。
> 同理**不得**清 `IndexedDB` / `Local Storage`。

---

## 四、GUI测试规范

### 4.1 测试方案选择（优先级从高到低）

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **Playwright CDP** | Electron应用GUI测试 | ✅ 精准定位 ✅ 稳定可靠 ✅ 支持断言 | 需要调试端口 |
| computer_use_tool | 桌面应用操作 | 可视化操作 | ❌ 本环境无法截取Harness窗口 ❌ 输入注入失败 |
| PyAutoGUI | 简单桌面自动化 | 轻量 | ❌ Python 3.14不兼容 ❌ DPI缩放问题 |
| 鼠标坐标点击 | 无其他方案时 | 直接 | ❌ DPI缩放125%导致坐标偏移 ❌ 不稳定 |

**⚠️ 重要：本项目必须使用Playwright CDP进行GUI测试，禁止使用鼠标坐标点击！**

### 4.2 Playwright CDP测试流程

```bash
# 1. 用调试端口启动Harness
"DeepSeek Harness.exe" --remote-debugging-port=9222

# 2. 运行自动化测试
cd D:\hermes-data\dsh-director
node test-v10-cdp.mjs
```

### 4.3 测试脚本关键技巧

#### force点击绕过overlay

Harness原生overlay层（`.OrjXgq_overlayLayer`）会拦截点击事件，必须用force选项：

```javascript
// ❌ 会被overlay拦截
await button.click()

// ✅ 强制点击，绕过overlay
await button.click({ force: true })
```

#### 元素定位优先级

```javascript
// 1. 优先使用文本定位
page.getByText('总监', { exact: true })

// 2. 其次使用CSS选择器
page.locator('.dsh-dir-tab')

// 3. 最后使用nth排除导航栏重复元素
page.getByText('智能体').nth(1)  // D区的智能体tab，排除A区
```

#### 等待策略

```javascript
// ✅ 使用显式等待，禁止固定sleep
await page.getByText('进度').first().waitFor({ timeout: 5000 })

// ❌ 禁止使用固定等待
await page.waitForTimeout(3000)  // 仅用于页面初始加载
```

---

## 五、常见问题排查

### 5.1 Harness启动失败

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 弹出"version must be a string" | credentials.yaml字段类型错误 | 改为字符串格式，见§2.1 |
| 弹出"refs must be a string" | credentials.yaml refs是对象 | 转为JSON字符串，见§2.1 |
| 进程静默退出，无错误 | 插件inject不存在的服务 | 检查inject数组，见§2.2 |
| 显示"插件环境需要恢复" | snapshots损坏 | 删除`plugin-center/snapshots`和`journal` |
| 显示"Plugin environment is corrupted" | 配置文件严重损坏 | 检查credentials.yaml和package.json |

### 5.2 插件不生效

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 修改代码后页面无变化 | 缓存未清除 | `node dsh-director-plugin/scripts/plugin-install.mjs --apply` 后重启；或手工清 `Cache`/`Code Cache`/`GPUCache`（🔴 **不含 `Network`**） |
| 总监tab不显示 | 插件未启用 | 检查package.json的bundles数组 |
| 控制台报错"组件未定义" | 编译失败 | 运行`node build.mjs`检查编译错误 |
| 样式不生效 | 内联样式被覆盖 | 检查CSS优先级，使用!important |

### 5.3 GUI测试失败

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "element intercepts pointer events" | overlay层拦截 | 使用`click({ force: true })` |
| "Timeout exceeded" | 元素不存在或文本不匹配 | 检查元素文本，使用nth排除重复元素 |
| 截图显示桌面壁纸 | computer_use_tool无法截取Harness | 改用Playwright CDP截图 |
| 点击位置偏移 | DPI缩放125% | 改用Playwright CDP，禁止鼠标坐标 |

---

## 六、关键文件索引

| 文件 | 路径 | 说明 |
|------|------|------|
| V10总监控制台组件 | `D:\hermes-data\dsh-director\src\client\components\director\V10Director.tsx` | 48.2KB，813行，主组件 |
| 总监面板后备 | `D:\hermes-data\dsh-director\src\client\components\director\DirectorPanel.tsx` | 5.9KB，三栏布局后备 |
| 服务端入口 | `D:\hermes-data\dsh-director\src\index.ts` | webServer路由注册 |
| 编译产物 | `D:\hermes-data\dsh-director\lib\client.js` | 274.8KB，编译后客户端代码 |
| **插件部署单元** | `D:\hermes-data\dsh-client-mod\dsh-director-plugin\scripts\plugin-install.mjs` | verify（零写入）/ `--apply`（幂等）/ `--uninstall`（外科式） |
| 自动化测试脚本 | `D:\hermes-data\dsh-director\test-v10-cdp.mjs` | 28项Playwright测试 |
| 美化设计图 | `D:\hermes-data\dsh-client-mod\docs\50-信息中心\V10总监控制台-美化设计图V2.0.html` | 高保真原型+50+项交互清单 |
| 整改进展报告 | `D:\hermes-data\dsh-client-mod\docs\20-任务文档\V10整改进展报告-20260906.md` | 进度跟踪 |
| Harness配置 | `C:\Users\15142\.dsh\.credentials.yaml` | ⚠️ 极易出错，所有字段必须字符串 |
| 插件配置 | `C:\Users\15142\.dsh\profiles\web\package.json` | bundles和dependencies配置 |

---

## 七、最佳实践

### 7.1 开发规范

1. **修改源代码，不修改编译产物** — 永远修改 `dsh-director-plugin/src/`，然后运行 `node dsh-director-plugin/build/build.mjs` 编译
2. **使用插件部署单元** — 不要手动复制文件，用 `node dsh-director-plugin/scripts/plugin-install.mjs --apply`（`deploy.ps1` 已退役）
3. **小步提交** — 每完成一个功能点就编译部署测试，避免一次性大量修改
4. **保留后备方案** — DirectorPanel.tsx作为三栏布局后备，V10出问题时可快速回退

### 7.2 测试规范

1. **Playwright CDP优先** — 禁止使用鼠标坐标点击，DPI缩放会导致偏移
2. **force点击绕过overlay** — Harness原生overlay层会拦截点击
3. **显式等待替代sleep** — 使用`waitFor`等待元素，禁止固定`sleep`
4. **测试后截图保存** — 关键步骤截图保存到`logs/playwright-cdp/`

### 7.3 排错规范

1. **先看错误信息** — Harness启动失败时，错误对话框会明确指出原因
2. **检查配置文件** — credentials.yaml和package.json是最常见的出错点
3. **检查插件inject** — 只能inject存在的服务，否则静默失败
4. **清除缓存** — 修改代码后必须清除缓存，否则不生效

---

*文档创建: 2026-09-06*
*基于V10总监控制台开发过程中的经验教训整理*
*下次更新: 发现新问题或新最佳实践时*
