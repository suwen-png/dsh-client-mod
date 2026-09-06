# Harness 客户端修改 - 踩坑记录与快速定位索引

> **用途**：固化所有已确认的根本原因、正确路径、修改位置，避免反复读取和踩坑。
> **创建时间**：2026-08-25
> **状态**：持续更新

---

## 一、Harness 架构（必须先理解）

### 1.1 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  前端渲染层（Electron Renderer）                          │
│  - 从 app.asar 加载主框架 index-DyLP6TCW.js (432KB)    │
│  - 通过 window.__ModuleLoader__ 动态加载插件 JS           │
│  - 插件 JS 通过后端 HTTP 提供                              │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTP 请求
┌──────────────────────▼──────────────────────────────────┐
│  后端服务层（Node.js Web Server）                         │
│  - 入口：dsh\lib\bin.js web --host 127.0.0.1 --port 0  │
│  - 提供前端静态资源（dsh-web-frontend\dist）              │
│  - 提供插件 JS（dsh-client-ui-conversation\lib\client.js）│
│  - 插件通过 dsh-host-frontend-static 提供静态资源          │
└──────────────────────┬──────────────────────────────────┘
                       │ require()
┌──────────────────────▼──────────────────────────────────┐
│  插件模块层（node_modules\@deepseek-ai\*）               │
│  - dsh-client-ui-conversation（对话UI，我们修改的文件）    │
│  - dsh-client-ui-trajectory（轨迹UI）                     │
│  - dsh-client-ui-layout（布局）                            │
│  - 等等                                                    │
└─────────────────────────────────────────────────────────┘
```

### 1.2 插件加载机制

**关键事实**：前端打包文件 `index-DyLP6TCW.js` **不包含**插件代码。插件通过以下方式动态加载：

1. 前端主框架定义 `window.__ModuleLoader__`
2. 每个插件的 `lib/client.js` 使用 `window.__ModuleLoader__.load({ id, factory })` 注册
3. 后端通过 HTTP 提供插件 JS 文件
4. 前端按需加载插件

**验证方法**：检查插件 client.js 第一行是否为 `window.__ModuleLoader__.load({`

---

## 二、关键路径（已确认，直接使用）

### 2.1 文件路径

| 用途 | 路径 |
|------|------|
| **工作区修改文件** | `D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js` |
| **Harness 实际加载文件** | `D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js` |
| **原始备份** | `D:\hermes-data\dsh-client-mod\original\@deepseek-ai\dsh-client-ui-conversation\lib\client.js` |
| **前端打包文件（不要改）** | `D:\软件安装\...\dsh-web-frontend\dist\assets\index-DyLP6TCW.js` |
| **Harness 可执行文件** | `D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe` |
| **Harness 用户数据目录** | `C:\Users\15142\AppData\Roaming\@deepseek-ai\dsh-desktop` |
| **Harness 配置目录** | `C:\Users\15142\.dsh` |

### 2.2 应用修改流程（标准操作）

```powershell
# 1. 语法检查
node --check "D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"

# 2. 关闭 Harness
Get-Process | Where-Object { $_.ProcessName -like "*Harness*" } | Stop-Process -Force
Start-Sleep -Seconds 3

# 3. 清除缓存（关键！否则加载旧版本）
$userDataDir = "C:\Users\15142\AppData\Roaming\@deepseek-ai\dsh-desktop"
@("Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "blob_storage", "Network") | ForEach-Object {
    $path = Join-Path $userDataDir $_
    if (Test-Path $path) { Remove-Item $path -Recurse -Force }
}

# 4. 复制文件
$src = "D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
$dst = "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh-client-ui-conversation\lib\client.js"
Copy-Item $src $dst -Force

# 5. 验证 MD5
$srcHash = (Get-FileHash $src -Algorithm MD5).Hash
$dstHash = (Get-FileHash $dst -Algorithm MD5).Hash
Write-Host "MD5一致: $($srcHash -eq $dstHash)"

# 6. 启动 Harness
Start-Process "D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\DeepSeek Harness.exe"
Start-Sleep -Seconds 12
```

### 2.3 验证修改是否生效

```powershell
# 检查 Harness 实际加载文件是否包含修改内容
$dst = "D:\软件安装\...\dsh-client-ui-conversation\lib\client.js"
Select-String -Path $dst -Pattern "关键词" -SimpleMatch | Measure-Object
```

**页面验证**：在总监tab标题栏查看调试标签（gView/focus/direct/directCall/lastSend/persist）

---

## 三、踩坑记录（已确认的根本原因）

### 坑1：目录级 Junction 替换整个包目录

**现象**：Harness 启动即崩溃
**根本原因**：Junction 改变 Node.js 模块解析路径
**正确方案**：文件级替换（只复制修改后的 lib/client.js）

### 坑2：Object.defineProperty 覆盖 shell.submit

**现象**：对话能发但没走总监流程
**根本原因**：shell 可能是冻结对象，defineProperty 静默失败
**正确方案**：直接修改 InputBar 组件 + window 全局函数

### 坑3：mode 参数传 "chat"

**现象**：小窗发不出去、自动中转未生效
**根本原因**：sendSession 的 mode 有效值是 "queue"/"enter"/"accelerated"，"chat" 是无效值，导致静默失败
**正确方案**：mode 传 "queue"

### 坑4：DirectorView 最外层用 height:100%

**现象**：消息在对话框下面（被输入框遮挡）
**根本原因**：height:100% 在父容器无明确高度时不生效，导致 DirectorView 高度超出可视区域
**正确方案**：用 `flex: 1, minHeight: 0`，与 ChatView 一致

### 坑5：Harness 缓存导致修改不生效（最严重，踩了4轮）

**现象**：四轮修改都没有任何效果，用户看不到调试标签
**根本原因**：Harness 的 HTTP 缓存（30MB）一直加载旧版本的插件 JS，即使文件已复制到安装目录
**正确方案**：每次应用修改前必须清除缓存（Cache/Code Cache/GPUCache/blob_storage/Network）
**验证方法**：清除缓存后重启，查看总监tab标题栏是否有调试标签

### 坑6：修改前端打包文件 index-DyLP6TCW.js

**现象**：以为要改打包文件
**根本原因**：前端打包文件不包含插件代码，插件通过 ModuleLoader 动态加载
**正确方案**：只修改插件的 lib/client.js，不要改打包文件

### 坑7：inject 返回值缺少 actions/setView

**现象**：总监tab的 inject 返回值中没有包含 actions/setView，导致 DirectorView 收到的 actions 是 undefined
**根本原因**：setView("director") 永远不执行，currentView 始终是 "chat"
**正确方案**：inject 返回值必须包含 setView 函数

### 坑8：currentView 是静态的

**现象**：tab 切换后 currentView 不更新
**根本原因**：inject 返回的 currentView 只在挂载时读取一次
**正确方案**：用全局变量 window.__directorCurrentView 动态追踪，每次渲染时 useLayoutEffect 确保值正确

---

## 四、快速定位索引（常见修改 → 文件/行号/函数）

### 4.1 对话发送逻辑

| 修改目标 | 文件位置 | 函数/变量 |
|----------|----------|-----------|
| 键盘回车发送 | client.js ~行3542 | InputBar 的 onKeyDown |
| 发送按钮点击 | client.js ~行3717 | InputBar 的发送按钮 onClick |
| 标准对话发送 | client.js 行130 | sendSession(session, text, imageIds, mode) |
| 总监提交函数 | client.js ~行10389 | window.__directorSubmit |
| 直接发对话函数 | client.js ~行10400 | window.__directChatSubmit |
| sendToChat | client.js ~行10577 | sendToChat(text) |

### 4.2 组件定义

| 组件 | 文件位置 | 说明 |
|------|----------|------|
| InputBar | client.js ~行3367 | 输入框组件，props 含 sessionId |
| DirectorView | client.js ~行7368 | 总监tab主组件 |
| ChatView | client.js ~行5960 | 标准对话tab组件（参考布局） |
| ChatNodeSeat | client.js ~行5281 | 消息节点渲染组件 |
| ChatFlow | 新增 | 小窗对话流组件 |
| DirectorFlow | 新增 | 小窗总监流组件 |

### 4.3 Store/状态

| Store | 文件位置 | 说明 |
|-------|----------|------|
| directorLayoutStore | client.js ~行5509 | 布局状态（宽度/折叠/焦点），持久化 localStorage |
| createDirectorStore | client.js ~行5411 | 总监消息store |
| loadDirectorStore | client.js ~行5427 | 从 localStorage 加载 |
| saveDirectorStore | client.js ~行5450 | 保存到 localStorage |
| directorProcess | client.js ~行5579 | 总监处理函数（整理/分类/转发） |
| callLocalModel | client.js ~行5550 | 本地模型调用（Ollama） |

### 4.4 Tab 注册

| Tab | 文件位置 | 说明 |
|-----|----------|------|
| 总监tab注册 | client.js ~行10621 | slots.register({ name: "conversation.view", id: "director" }) |
| 对话tab注册 | client.js ~行10300 | 原始对话tab |
| 轨迹tab注册 | client.js ~行10312 | 原始轨迹tab |

### 4.5 全局变量

| 变量 | 说明 |
|------|------|
| window.__directorCurrentView | 当前tab（"director"/"chat"） |
| window.__directorFocusTarget | 当前焦点目标（"director"/"chat"） |
| window.__directorLayoutStore | 布局store实例 |
| window.__directorSubmit | 总监提交函数 |
| window.__directChatSubmit | 直接发对话函数 |
| window.__directChatProbe | directChatSubmit调用探针 |
| window.__directorConfig | 总监配置 |
| window.__directorPersistState | 持久化状态（saveCount/loadCount/lastError） |
| window.__lastSendTarget | 最近一次发送目标 |

---

## 五、调试标签说明（总监tab标题栏）

| 标签 | 说明 | 正常值 |
|------|------|--------|
| view | DirectorView 内部 view 状态 | director |
| gView | 全局 window.__directorCurrentView | director |
| submit | __directorSubmit 是否存在 | OK/null |
| setView | setView 函数是否存在 | OK/null |
| focus | 当前焦点目标 | director/chat |
| sid | 当前 sessionId | session-xxx |
| dMsg | 总监消息数量 | 数字 |
| useSess | useSession 是否可用 | OK/null |
| useStore | useStore 是否可用 | OK/null |
| direct | __directChatSubmit 是否存在 | OK/null |
| scroll | 滚动探针状态 | 数字 |
| directCall | directChatProbe 调用次数 | 数字 |
| lastSend | 最近一次发送目标 | standard/director/chat-via-director-tab |
| persist | 持久化状态 | saveN/loadN/Nmsg |

---

## 六、标准对话原逻辑（参考，不要改）

### 6.1 发送流程

```
用户输入 → InputBar.onKeyDown / 发送按钮 onClick
  → keyboard.submit(mode) / inputActions.submit()
    → SessionInputShell.submit("queue")
      → conversation.sendSession(session, text, [], "queue")
        → session.prompt(content, mode)
```

### 6.2 布局结构（ChatView，三层结构）

```
最外层 div: flex:1, minHeight:0, display:flex, flexDirection:column
  ├── 消息滚动区: flex:1, overflow-y:auto, display:flex, flexDirection:column
  │   └── 消息列: flex:1, display:flex, flexDirection:column, justifyContent:flex-end, paddingBottom:24px
  │       └── 消息列表
  └── 输入框区域: flex-shrink:0
```

### 6.3 sendSession 签名

```javascript
async sendSession(session, text, imageIds, mode)
// mode 有效值: "queue" / "enter" / "accelerated"
// 内部调用: session.prompt(content, mode)
```

---

## 七、已验证做不通的方向（不要重试）

1. **目录级 Junction 替换整个包目录** → 模块解析失败，Harness 崩溃
2. **Object.defineProperty(shell, "submit", ...)** → shell 可能冻结，静默失败
3. **mode="chat"** → 无效 mode，sendSession 静默失败
4. **单层布局 + justify-content:flex-end** → 消息被输入框遮挡
5. **外部 bundle 注入方案（main.page keyed slot）** → 注册时序导致组件不渲染
6. **小窗仅显示消息文本气泡（无完整交互）** → 用户明确否决
7. **修改前端打包文件 index-DyLP6TCW.js** → 不包含插件代码，改了也没用
8. **不清除缓存直接重启** → 加载旧版本，修改不生效

---

## 八、用户明确接受的方案

1. 文件级替换（非目录级 Junction）
2. 直接修改 InputBar 组件 + window 全局函数
3. 全局单输入框，根据当前 tab + 焦点决定提交目标
4. 小窗分屏布局（总监tab左总监主+右对话小窗；对话tab左总监小窗+右对话主）
5. 小窗可拖拽调宽（180-600px）、可折叠、宽度记忆到 localStorage
6. 总监tab不需要"总监"标题文字（只保留状态指示器）
7. useLayoutEffect + RAF 自动滚动方案
8. 自己审核→整改→重复三次的流程规范
9. 对话发的消息不需要总监审核

---

## 九、修改前检查清单

每次修改前必须确认：

- [ ] 已阅读本文档，了解架构和正确路径
- [ ] 已确认修改的是 `workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js`
- [ ] 已确认修改位置（行号/函数）
- [ ] 已写开发文档并自审通过
- [ ] 修改后运行 `node --check` 语法检查
- [ ] 应用修改时关闭 Harness
- [ ] 应用修改时清除缓存（Cache/Code Cache/GPUCache/blob_storage/Network）
- [ ] 应用修改后验证 MD5 一致
- [ ] 重启 Harness 后查看调试标签确认生效

---

## 十、相关文档索引

| 文档 | 路径 | 说明 |
|------|------|------|
| 总监模式总方案 | `20-任务文档\03-总监对话模式开发文档.md` | 总体设计 |
| 阶段1详细文档 | `20-任务文档\04-阶段1详细开发文档.md` | M1-M5 |
| 阶段2文档 | `20-任务文档\05-阶段2开发文档-修复与小窗.md` | M1-M10 |
| 小窗技术方案 | `20-任务文档\06-小窗真实对话流嵌入-函数级技术方案.md` | 方案v2 |
| 空白问题诊断 | `20-任务文档\07-总监页面空白问题诊断文档.md` | 根因诊断 |
| 问题审核与修复 | `20-任务文档\08-总监对话模式问题审核与修复方案.md` | P1-P6 |
| 开发规范与审核 | `20-任务文档\09-总监对话模式开发规范与审核文档.md` | 规范+25项审核 |
| v2修复文档 | `20-任务文档\10-总监对话模式问题修复开发文档-v2.md` | mode参数+三层布局 |
| v3对比分析 | `20-任务文档\11-标准对话对比分析与修复文档-v3.md` | 原逻辑对比 |
| v4修改位置 | `20-任务文档\12-明确修改位置与方案-v4.md` | P1/P2/P3明确位置 |
| 布局草图v2 | `30-开发链路\总监对话小窗布局草图-v2.html` | 用户确认 |
| 消息排列草图 | `30-开发链路\消息排列位置-justify-flex-end草图.html` | 布局参考 |

---

**文档维护说明**：每次遇到新问题或确认新路径，必须更新本文档。修改代码前必须先阅读本文档。
