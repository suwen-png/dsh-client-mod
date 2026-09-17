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
# 🔴 不得清 "Network"：Chromium 的 cookie/网络状态存储，内含 dsh_director_* 持久化 cookie
@("Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "blob_storage") | ForEach-Object {
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
**正确方案**：每次应用修改前必须清除缓存（Cache/Code Cache/GPUCache/blob_storage/DawnGraphiteCache/DawnWebGPUCache）
> ⚠️ **2026-09-12 更正**：早期写法含 `Network`，属**缺陷** —— `Network` 是 Chromium 的 cookie/网络状态存储，内含 `dsh_director_*` 持久化 cookie（R5 冻结契约），删它会导致**总监状态丢失**。
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

### 坑9：CDP 真机 e2e 把渲染进程顶死（两种表现，都必须有防线）

**现象 A（静默挂死）**：浏览器进程还回 HTTP（`/json/list` 正常），但 `Runtime.evaluate` **永不返回**；
脚本静默跑了 **8 分 47 秒、一个断言都没输出**，进程内存涨到 **3.1GB**。
**现象 B（超时抛穿、结果全丢）**：`Input.dispatchMouseEvent` 挂满超时后抛错，而派发函数**没有兜底**
⇒ 异常抛穿顶层 `await`、进程终止 ⇒ **已经跑出来的 45 条断言结果全部丢失**，只剩一个堆栈。
**根本原因**：① 任何"等待"没有硬超时 ⇒ **把挂死伪装成正在跑**；② 指针/键盘派发没记账 ⇒ 一次超时吞掉整轮；
③ 拖动用 8 个指针事件**零间隔连发**，比真人"拖"硬得多（第二次挂死正是发生在这条路径上）。
**正确方案**：① CDP 调用一律加硬超时（本项目 `CALL_TIMEOUT = 8000`）；② 所有指针/键盘派发统一记进 `cdpTimeouts`，
**绝不抛穿**，收尾用一条 `E2「零超时」`断言兜底，非零即判 `INVALID`（渲染进程无响应 ≠ 产品失败）并置退出码 2；
③ 拖动步间留 **18ms**；④ 全程日志落盘。**恢复方式**：`MSYS_NO_PATHCONV=1 taskkill /F /IM "DeepSeek Harness.exe"` 后重启。
（来源：实测 2026-09-12 `dsh-director-plugin/scripts/verify-flow.mjs` 第 1 次与第 7 次真机跑；台账 #54）

---

### 坑10：`background` 简写会静默吃掉 `background-image`

**现象**：面板里切了「质感」，主色/字号/密度都生效，**纹理却毫无变化**；
而读 `data-dp-texture`、读内联 `background` 一切正常 —— 属"改了但没渲染"这一类最难查的形态。
**根本原因**：根节点把背景写成 `background: "var(--dp-bg-0, …)"`。`background` **简写会重置 `background-image`**，
而**内联样式优先级高于类规则** ⇒ `.dp-textured { background-image: … }` 这条类规则**永远不会生效**（静默失效）。
**正确方案**：① 需要保留纹理的元素一律改用 **`backgroundColor`（长写）**；② 判据**只能是**
`getComputedStyle(el).backgroundImage !== "none"`，读属性会被骗过；
③ 该判据已固化为真机断言（`verify-flow.mjs` 的 **B8 / D4**）。**降级可以，无声不行。**
（来源：实测 2026-09-12；台账 #49）

---

### 坑11：宿主 `--dsw-alias-*` 令牌**不在 `:root` 上**，写在 `:root` 的 `var()` 会静默失效

**现象**：想让自己插件的底色跟随宿主主题，于是写 `:root{--my-bg:var(--dsw-alias-bg-base)}` ——
**毫无效果，但零报错**，读属性一切正常。
**根本原因**：CSS 自定义属性里的 `var()` 是在**定义它的那个元素上**求值的，不是在"引用它的元素"上求值。
宿主把 `--dsw-alias-*` 定义在 **`body`** 上 —— 实测 `getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base')`
返回**空串**（这不是继承值）。于是桥接在 `html` 上求值失败、**静默**落到 fallback，底色压根没跟随宿主。
**正确方案**：桥接定义必须挂在 **`body` 以内、能继承到宿主令牌的元素**上
（本插件挂在总监页根节点 `[data-testid="dp-root"]`，作用域也因此只限总监页）。
**验证方式**：不能只看"两边当前色值相等"（**抄一份同色值也能相等**）——
要**临时改宿主令牌、看自己的元素是否立刻跟着变**，再恢复；恢复必须"照原样"（见坑13）。
（来源：实测 2026-09-12；台账 #57）

---

### 坑12：CDP 工具**没有硬超时**会伪装成"表达式写错"（空输出 + exit 0）

**现象**：`node scripts/cdp-eval.mjs "1+1"` —— **没有任何输出**，退出码 0。
看起来像"表达式写错了"或"工具没输出"，于是去反复检查探针代码，查了半天是白查。
**根本原因**：渲染进程主线程已经卡死。此时**浏览器进程仍然正常回 HTTP**
（`curl http://127.0.0.1:9222/json/list` 有响应、能列出页面），但 `Runtime.evaluate` **永不返回**。
工具本身没有超时 ⇒ 一直挂着 ⇒ 被外层 shell 的 `timeout` 杀掉 ⇒ 表现成"空输出 + exit 0"。
**正确方案**：① 任何等待都要有**硬超时**，超时要报成一条**可读的失败**（并且别抛穿顶层，见坑9）；
② `cdp-eval.mjs` / `cdp-mouse.mjs` / `cdp-shot.mjs` 三个工具已补 8s 硬超时 + 自检提示行；
③ 恢复方式：`MSYS_NO_PATHCONV=1 taskkill /F /IM "DeepSeek Harness.exe"` 后重启。
**判据**：拿 `1+1` 做探活 —— 它都不回，就是渲染进程死了，与你的表达式无关。
（来源：实测 2026-09-12；台账 #56 同族）

---

### 坑13：动宿主的状态之前**先读原值**，`removeProperty` 一刀切会把宿主改坏

**现象**：为了验证"我的颜色真的连的是宿主变量"，脚本临时改了 `body` 上的 `--dsw-alias-bg-base`，
收尾用 `removeProperty` 恢复 —— 结果**宿主整个界面的毛玻璃背景变成了纯白**
（实测 `after = rgb(255,255,255)`，而 `before = rgba(246,250,255,0.4)`）。
**根本原因**：宿主**自己**在 `body` 的**内联 style** 上设了这个变量。
`removeProperty` 把**宿主自己的内联值**也一并删掉 ⇒ 值回落到 CSS 规则里的
`--dsw-static-neutral-bluish-00`（纯白）。
**正确方案**：① 恢复要"照原样"—— 先读 `el.style.getPropertyValue(k)`，
**原本有内联值就写回原值**，原本没有才 `removeProperty`；
② **"能完全复原"本身要写成断言**（`after === before`），否则"无副作用"只是口头承诺；
③ 万一改坏了，**重载宿主页面**让它自己重设（回读 `inline` 值即可确证那个值确实是宿主设的）。
（来源：实测 2026-09-12；台账 #58）

### 坑14：**开合型**控件被 e2e 点到之后不还原 ⇒ 伪装成"偶发红"

**现象**：`verify-design-studio.mjs` 的 C13「Esc 逐层退」**时绿时红**（r1 绿、r2 r3 红），
且失败时三次 Esc **完全零效果** —— 待确认、选中、工作室一样没动。
**根本原因**：真凶在**同一个脚本的另一段**。C16.2 为了验"按钮不会跑"，会
**逐个真实点击顶栏每个按钮**（只排除了 `ds-close`），而 `ds-personalize`（⚙ 设置）是
**开合按钮** —— 点开之后**没有人关它**。该面板挂在 `window` **捕获**阶段并
`stopPropagation()` 把 Esc 吃掉 ⇒ 之后所有 Esc 都进不到工作室的 handler。
**因果链与三次运行逐条对得上**：r1 的 C13 跑在 C16.2 **之前** ⇒ 绿；同一次运行里
C16.11 随即被这个面板遮挡 ⇒ 红（报告写成"按钮被遮挡"，看着像产品缺陷）；
面板留到运行结束（脚本**不重载页面**）⇒ r2/r3 的 C13 连带红。
**正确方案**：① **关闭逻辑只留一处真相源**（`closeFloatLayers()`：版本面板 / 个性化面板 /
导出兜底面板），别各段各写一遍；② "逐个点击"的循环里，点完**当场还原**，并**单独断言还原成功**
（新增 `C16.2p`）；③ 收尾做**环境复原**并断言（`C17.2`）—— 让每次运行的起点等价。
（来源：实测 2026-09-12；台账 #68 + §八 纪律 32/33）

### 坑15：`data-*` 一个语义标在**两个元素**上 ⇒ "按个数对账"直接错一倍

**现象**：导图折叠段的判据从 `allCollapsed > 0` 收紧成"**精确等于**目标集合"后，
三次**稳定红**：`{"allCollapsed":2,"collapsibleNonRoot":1}` —— 看起来像"产品漏折了一半"。
**根本原因**：`data-collapsed` **同时**打在**节点本体**（`MindMap.js:676`）和
**框内折叠控件**（`:733`）上 ⇒ 直接数 `[data-collapsed="1"]` 会把**每个折叠节点算两次**。
产品没漏折，是**测量口径**错了。
**正确方案**：计数钉死到 `[data-testid="mm-node"][data-collapsed="1"]`。
**凡"按个数对账"的判据，先钉死量的是哪一类元素**（同理适用 `data-on` / `data-enabled` / `data-armed`）。
附带教训：**判据收紧到"精确等于"才有价值** —— 松判据（`> 0`）对口径错误**完全无感**。
（来源：实测 2026-09-12；台账 #72 + §八 纪律 35）

### 坑16：断言"某个东西**没动**"，在底层整体失效时会**照样绿**

**现象**：C13.1 断言「个性化面板吃掉 Esc 之后，待确认**没动**」。
可当 Esc 通道**整体失效**时（见坑14），这条断言**一样通过**。
**根本原因**："没动"有两个截然不同的原因 —— ① 被正确挡住；② 事件根本没进 handler。
原判据**分不出这两者**，属于**空真**（vacuous truth）。
**正确方案**：配一条**正对照**，在同一状态、紧接着先跑一次**已知会成功**的同类操作：
`C13.1n` =「个性化未开时按一次 Esc，待确认**必须**被吃掉」⇒ 证明通道是通的，
C13.1 的"没动"才具有排他性。
（来源：实测 2026-09-12；台账 #70 + §八 纪律 34）

### 坑17：探针**不检查前置状态** ⇒ 把"展开"当成"折叠"来测

**现象**：导图折叠段**偶发红**（r4 红、r5 r6 绿），载荷 `{"before":11,"after":13}` ——
第一次点击之后**节点数反而变多**。
**根本原因**：探针挑节点时**只看"可折叠"（`data-enabled="1"`），不看"当前是不是展开着"**，
挑到一个**已折叠**的节点 ⇒ 那一击其实是"展开"。起点不等价（脚本不重载页面，状态跨运行保留）。
**正确方案**：① 先把折叠状态**归一到全展开**并断言（`C-M8p`）；② 探针只从
`data-collapsed !== "1"` 的节点里挑；③ 加**正负对照** `C-M8q`：人为折一个 ⇒ 必须 >0 ⇒
归一 ⇒ 必须回 0（否则 `C-M8p` 是空真）。
（来源：实测 2026-09-12；台账 #71 + §八 纪律 33）

---

### 坑18：提示位「有内容才渲染」会**顶动整条操作带** ⇒ 用户表现为「按钮点不中」

**现象**：右下角「发送到该对话」「交给总监」两颗按钮，用户反馈「点击不好用」；探针反证按钮本身完全正常（真实点击命中 + 冒泡各 1 次、库 2 → 3 条、提示文案正常）。

**真因**：右下一列是 `column-reverse`，**后置兄弟即视觉底部**；提示位原写成 `toast ? h(div) : null`（没有提示时**不渲染**）⇒ 提示一出现，整条操作带被**顶上去 23px**（实测 `btnY 628 → 605`，提示消失又落回）。人手指离开提示、**还没移到下一颗按钮，它已经不在原位了**。

**正确做法**：提示位改成**常驻等高占位槽**（恒 23px，无提示时留空 ⇒ 看不见，但不占位变化）。

**闸门**：`D5p` —— 出提示前后 R8 条每颗按钮的 y **逐像素不许变**（无提示 `r8Y=629` / 有提示 `r8Y=629`）。

**来源**：实测 2026-09-12（`verify-flow.mjs` D5p / 探针 `.tmp-probe/s2.js` + `s3.js`）。

### 坑19：只挂 `requestAnimationFrame` 的复量，在**窗口被遮挡时会整段不执行**

**现象**：浮层跟随位置在 e2e 里偶发「永远不动」（`before=137.6 → during=137.6`），而同代码在真实前台 700ms 内正常跟随 ⇒ 容易被读成「跟随功能坏了」。

**真因**：**Chromium 在窗口被遮挡 / 不可见时会暂停 `requestAnimationFrame`**，而 e2e 时宿主窗口常在后台。

**正确做法**：复量改**事件驱动** —— `MutationObserver` 对**与目标相关的变更当场复量**（本项目是 composer 相关变更）+ `ResizeObserver` 兜底；闸门要**先自证前提**（「composer 真的挪了」：顶 `690 → 540`）再判跟随值，并允许**重试一次**把重试打进明细。

**来源**：实测 2026-09-12（`verify-flow.mjs` F11）。

### 坑20：**「跳过」比「红」更危险** —— 探针指着不存在的锚点会整段静默失效

**现象**：导图 e2e 长期报「跳过：本机没有可折叠项」，而同一份报告的另一段正在自证产品**确实折了 1 棵子树**。

**真因**（两类）：① 探针选择器写的是**产品里根本没有的 id**（`mm-toggle` vs 真实 `mm-node-toggle`；传裸名还会去匹配同名**标签**）⇒ 恒 0 命中；② **前置状态没归零**（例如聚焦态没退出 ⇒ 可见集只剩祖先链，非根有子节点全被排除）⇒ 探针天然取不到样本，于是「跳过」把缺陷盖过去。

**正确做法**：跳过**必须带可分辨原因**（本项目给 `focusVisibleNode()` 加自诊断 `window.__mmFocusWhy`，打出 `body / nodes / inView / hitSelf`）；**不许用「本机数据如此」这种不可证伪的话收尾**。

**收益**：修掉后导图 **81 / 0 / 5 → 100 / 0 / 0**（多出 19 条真断言）。

**来源**：实测 2026-09-12（`verify-mindmap.mjs` C-M8a-d / C-M8q / C-M14 / C-M15 / C-M16a）。

### 坑21：用**常数坐标**代表「空白处」，滚动后可能正落在节点上（假红）

**现象**：断言「鼠标移开节点 ⇒ 悬浮工具条应消失」，目标点写死 `(18,320)`，偶发红。

**真因**：导图是**可滚动 + 可拖拽**画布。同一颗节点在不同运行里 rect 会漂 —— 实测一次是 `(21,318,98,31)`（x 21..119，`(18,320)` 距它只有 **3px**），滚动画布后变成 `[-10,291,98,31]`，`(18,320)` 就被**压在里面** ⇒ 工具条「没消失」是**完全正确的**（指针真的还在节点上）。

**正确做法**：空白点**按当前几何算**（遍历候选点、排除所有节点与工具条矩形，再用 `elementFromPoint` 复核），并补一条**防平凡真**「移开前工具条确实在」，否则「消失了」可能是从未出现。

**来源**：实测 2026-09-12（探针 `.tmp-probe/m1.mjs`，`blankPoint()`）。

### 坑22：闸门**写死版本号 / 写死历史命中数** ⇒ 下次升级必假红

**现象**（同日三例）：① `verify-batch6.mjs` 版本正则 `[6-9]` 是**单字符类**，产物到 `0.15.0-batch15` 后 minor / batch 都是两位数 ⇒ 假红；② `verify-bundle.mjs` 写死 `/batch15/`；③ `verify-batch1.mjs` 断言「宿主里 `filteredMessages` 命中数 **== 1**」—— 那是「宿主还是坏的」时期的**取证式凭据**，宿主补丁落地后命中数变 0 ⇒ 假红。

**真因**：把**历史现场**当成了**长期判据**。

**正确做法**：版本号解析成 `(major, minor, batch)` 做**序比较**（并与源码唯一真相源交叉校验）；「缺陷已修」的凭据要写成**双向一致性**（两侧都归零 + 都能找到同一处修正），而不是「某处还有 1 个坏点」。

**判据口诀**：**旧断言把「现状变了」读成「功能坏了」= 闸门过期。**

**来源**：实测 2026-09-12（batch1 98/98 · batch6 66/66 · bundle 97/97）。

### 坑23：同作用域重复 `function` 声明**合法且后声明静默覆盖前者**

**现象**：新一轮「真流转」上线后，行为仍是**旧版记录员**的逻辑（新版被顶掉），而**产物语法自检完全看不到**。

**真因**：JS 允许同作用域重复函数声明，**最后一个生效**；打包 / 合并后两个同名函数落到同一作用域。

**正确做法**：构建期加闸门 `lintDuplicateFnDecl`（同作用域同名函数直接失败）；产物侧再做一次回归反证（本项目：`deliver` 声明数必须 == 1）。

**来源**：实测 2026-09-12（`build/build.mjs` + `verify-bundle.mjs`）。

### 坑24：测试基础设施（平台桩）有**两份**就必然漂移 —— 同一个坑一天踩了两次

**现象**：`verify-install.mjs` 第 4 段报 `Class extends value undefined is not a constructor or null`，6 项断言级联失败、整套判 NO，读起来像「插件整个坏了」。

**真因**：产物里有 `class SafeLayer extends react.Component`（单层错误边界）。`verify-bundle.mjs` 与 `verify-install.mjs` **各写了一份**极简 react 桩，两份都缺 `Component` ⇒ `react.Component === undefined` ⇒ factory 立刻抛。2026-09-12 只修了 verify-bundle 一处，verify-install 那份**内联的**照旧漂移 ⇒ **同日第二次踩中**。真机一直正常。

**正确做法**：桩表抽成唯一真相源 `scripts/_platform-modules.mjs`，所有消费者 import 它；新增守护闸门 `scripts/lint-platform-stub.mjs`（断言「零内联 react 桩」+ 桩表 == 官方 `getStaticModules()` 10 项 + 解析钩子互覆盖 + 正负自检）。**原则：测试基础设施也只能有一份，重复即漂移。**

**来源**：实测 2026-09-12 / 09-13（`verify-install.mjs` 32/33 NO → 60/60 YES）。

### 坑25：**闸门自己会过期**，而且过期断言能把整个脚本**打哑**

**现象**：`verify-dialog.mjs` 抛 `TypeError: Cannot read properties of null (reading 'textContent')` 并**崩在 600 行** —— 其后 H10b–H12、I 段、J 段共 100+ 断言**全部丢失**，报告只剩「崩了」。真因：`makeLauncher()` 已退役（批次 13 移交 FloatDock）⇒ `mounted.launcher` 恒为 `null`，而旧断言直接读它的 `.textContent`。

**同批还抓到 7 处**（本批共 8 处）：`verify-install` 内联桩（见坑24）· `cdp-click`「五步已展示」**尺子量错容器** + 「启用项数 = 3」· `cdp-click-dialog` 入口文案 + R5 白名单 + 覆盖审计漏点 · `verify-dialog` 插件库 v1→v2 / 6→7 store / head「单一样式」· `verify-design-doc` 拿 V14.1 尺子量 V16。

**正确做法**：① 断言**不要读可能为 null 的返回值**（先判存在再读，或改契约式断言）；② 版本号 / 数量 / 单字符字符类这类**会随产品演进变化的字面量**一律改成**关系判据**（≥ / 包含 / 语义判据）；③ 每个闸门写明**它服务的目标版本或范围**，跨范围调用直接判 `INVALID`（本项目 exit 2，与 FAIL 的 exit 1 区分）。**先审闸门，再信闸门。**

**来源**：实测 2026-09-13（`verify-dialog` 崩 → 268/268；`verify-design-doc` 对 V16 报 INVALID）。

### 坑26：属性名**语义撞车** —— 一个 `data-dim` 两个含义，一个根因连爆 3 条红

**现象**：`cdp-click-dialog` D7「六维逐维渲染」实测扫到 **10 个**元素（审核六维 + 四维流转徽标），于是「不得减项 / key 与 §1A.9 一致 / 每维有 status」**同时**变红，看起来像「审核模块坏了」，其实六维 summary 完全正确。

**真因**：`data-dim` 被**两个语义**共用 —— 审核维度（`DirectorDialog`）与四维流转徽标（`DirectorPage` / `NodeDetailPanel`）。选择器 `[data-dim]` 天然分不开两者。

**正确做法**：属性名带**语义前缀**（`data-review-dim` / `data-flow-dim`），使选择器唯一定位；凡「宽选择器 + 多语义共存」的组合，先问一句"这个选择器还会命中谁"。

**来源**：实测 2026-09-13（`cdp-click-dialog.mjs` D7）。

### 坑27：判据污染 —— **自检样本写在自己的源码里**（连注释里也算）

**现象**：新建的 `lint-platform-stub.mjs` 首跑就报「命中 lint-platform-stub.mjs」—— 它被**自己的坏样本字面量**命中。改了一次样本、**仍报**，因为**注释里**还留着那个连续形态。

**真因**：静态检查类闸门把"坏形态"当样本写在源码里，样本本身就被扫描器读到。

**正确做法**：样本用**拼接构造**（`'const p = { "' + "re" + 'act": … }'`），或把样本放进独立 fixture 文件；注释里也**不要写出该形态本身**，改用描述性说法。同类：V15.1 的判据污染（审核表里引用的旧代码文本污染卫生判据 ⇒ 校验前先剥离 `<code>`）。

**来源**：实测 2026-09-13（`lint-platform-stub.mjs` L2 连红两次）。

### 坑28：CDP 模板内的注释**禁止反引号** —— 老坑，本轮又踩（第 5 次）

**🔴 变种（2026-09-17 · 第 6 次）：不只是反引号 —— 字面的 `${` 同样致命。**

**现象（变种）**：`node --check` / `lint-syntax.mjs` 报 `SyntaxError: Unexpected token '}'`，
**且报错行号指向那条"提醒别人别在模板串里写反引号"的注释本身**（自我指涉，看着像误报）。
实测出处：`scripts/verify-novel-split.mjs` 第 703 行，注释原文为「禁止反引号与 `${}`」。

**真因（变种）**：该注释位于模板字符串（`const READ_STORES = \`(function(){…})()\`;`）内部。
反引号会**提前终止**模板串；而 **`${` 会在模板串内开启插值** ⇒ 紧跟的 `}` 成为非法 token。
两者是**同一禁用集下的两种语法**，只记"别用反引号"会漏掉这一半。

**正确做法**：① 这类注释**写在模板字符串之外**；② 必须留在模板内时，**禁用集 = 反引号 ∪ `${`**
（写成「美元花括号」「反引号」等中文词，或直接写裸词）；③ 改完必跑
`node scripts/lint-cdp-templates.mjs` + `node scripts/lint-syntax.mjs`；
④ ⚠️ 修这类注释时**不要在新注释里又写出反引号或 `${`** —— 本轮就发生过：修它的时候自己第二次踩
（同一个位置连踩两次 ⇒ 结论：**记住坑不够，得让闸门去拦**，而这两个 lint 确实拦住了）。

**成功判据**：两个 lint 都 `IS_PASS: TRUE`。

**来源**：实测 2026-09-13（`cdp-click-dialog.mjs` D7 / D14 两处）；变种实测 2026-09-17
（`verify-novel-split.mjs` 第 703 行，连爆 `lint-syntax` + `lint-cdp-templates` 两红）。

### 坑29：闸门**持久化写产品状态**却不复原 ⇒ 跨脚本、跨运行污染（本轮最严重）

**现象**：`verify-flow.mjs` 的 `G3b`「助手消息含五步结论」报红，正文却是
`【总监分析】
（全部职责已关闭，原文直转）` —— 读起来像**总监五步坏了**。

**真因**：`cdp-click.mjs` 的 I 段是一条**真实写入链**：
`I4 逐项翻转 5 个职责开关` → `I6 保存本层`（写当时**选中节点**）→ `I7 向上提交`（写**父节点**）→
`I8 恢复继承`**只清会话节点自己那一层**。于是「五项全关」被**永久**写进
`__global__`（全局总管）与 `ws_*`（工作区）两级，**没有任何一步会还原**。
职责配置是**按节点持久化**的（IndexedDB/file），且测试脚本**不重载页面**
⇒ 污染跨脚本、跨运行一直活着，连**用户真实使用总监**也会被它改坏。

**判据**：改职责后 `/globalDuties.enabled` 全 `false` 且 `origin = "global"`（不是 `default`）。

**正确做法**：
1. 段前**快照全树**（`__dshDuties.resolve(id).own`），段后 ①原样写回 ②把"快照里没有、现在却有 own"的节点**清掉** ③**逐节点回读自证**（`I8r`）。
2. 更一般的判据：**凡"点了会写盘/落库"的闸门段，都要有快照 + 还原 + 还原断言**（同 §八 32/33 与 `C17.2 环境复原`）。
3. 复位命令：`window.__dshDuties.clear("__global__")` 后回读 `resolve` 应为全 `true`。

**来源**：实测 2026-09-13（`cdp-click.mjs` 71/71；`I8r` 独立清掉与我手工排查**完全相同的 2 个节点**，23 节点对账 0 不一致 ⇒ 兼顾**反证**）。

### 坑30：在**持久化列表**上用「页面级」判据 ⇒ **假绿与假红双向**发生在同一处

**现象**：同一条断言（读 R5「总监消息」正文）时红时绿；`G3a` 与 `G3b` 甚至出现**一个红一个绿**。

**真因**：R5 的 `dp-r5-body` 是 `msgs.slice(-14)`，而消息 store **按 sessionId 持久化**（脚本不重载页面）⇒
对**整段 innerText** 做正则，问的是「**历史上**出现过这几个字吗」，不是「**本次**这一轮产出对不对」。
于是同一份历史既能**顶替**本轮结果造成假绿（`/1\./` 命中旧消息），
也能**污染**成本轮结论造成假红（`/全部职责已关闭/` 命中上一轮那条降级消息）。
`cdp-click.mjs` 的 `I9b` 更直接：`done: /总监分析/.test(txt)` **立即**为真 ⇒ 轮询提前退出 ⇒
紧接着的 `I9c` 在五步还没算完时就读 `director-steps` ⇒ `lastSteps` 仍为 `null` ⇒ **rows = 0**。

**正确做法**：
1. 判据一律**跑程内**：读**最新一条**（`[data-testid="dp-dir-msg"]` 的最后一条），或要求**增量**（消息行数净增 ≥ 2）。
2. 轮询的 `done` 条件里必须**包含只会由本轮产生**的信号（如「五步过程区恰好 5 行」）。
3. 写断言前问一句：**这个数，上一轮会不会也让它成立？**（与 §八 33「起点是否等价」同源）

**来源**：实测 2026-09-13（`verify-flow` 68/68 · `cdp-click` 71/71）。

### 坑31：用法陷阱（缺 `--import`）必须**自诊断** —— 否则"用错目标"会被读成"产品坏了"

**现象**：`node scripts/verify-dialog.mjs` 崩在 `Cannot find package 'react'`，
栈里**看不出"其实只是少了一个参数"**（本轮有人因此白花时间）。

**真因**：`react` 按 **ADR-001** 是**平台冻结模块**，本仓库**不装 `node_modules`**
⇒ 所有离线脚本必须在解析钩子下运行：`node --import ./scripts/_platform-stub.mjs <脚本>`。

**正确做法**：
1. 把**动态导入**包进 `try/catch`，命中 `Cannot find package 'react'` / `ERR_MODULE_NOT_FOUND` 时
   打印**可直接复制的正确命令**并 `exit 2`（**INVALID**，与断言失败的 `exit 1` 区分）。
2. 顺带钉死退出码约定：**0 = 通过 / 1 = FAIL（目标不合格）/ 2 = INVALID（用错用法或目标）**。
3. 形状相同的还有 `verify-design-doc.mjs` 的**目标版本自检**（喂 V16 就一路 ❌，读起来像"新稿退化"）。

**来源**：实测 2026-09-13（裸跑 `exit 2` + 用法提示；带钩子 `268/268 · exit 0`）。

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
- [ ] 应用修改时清除缓存（Cache/Code Cache/GPUCache/blob_storage/DawnGraphiteCache/DawnWebGPUCache；**不含 Network**）
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
