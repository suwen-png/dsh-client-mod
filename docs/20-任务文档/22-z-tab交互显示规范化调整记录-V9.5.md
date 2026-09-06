# 22 — z tab 交互/显示规范化调整记录（V9.5）

> 日期：2026-09-01 ｜ 类型：显示规范 + 操控性调整 ｜ 状态：✅ 代码已 apply，待 Harness 重启验证
> 关联：21号文（V9.4 zb2滚动+P1修复）、18号文附录H（配色令牌规范）

---

## 一、需求与范围

对 z（正常对话 tab）的交互与页面显示做规范化 + 操控性调整。**zb2 对话本体保持原生不动**，只调嵌入元素：

| 区块 | 代号 | 内容 |
|:-----|:----:|:-----|
| b1 总监小窗 | za1 | 左侧总监面板（含顶栏/智能体区/记忆面板） |
| b-1 固定顶栏 | — | zb2 上方的蓝色固定条 |
| 焦点框/手柄 | — | 分屏焦点 outline + 拖拽手柄 |

三项调整（用户确认范围 A+B+C 全量）：
- **A 配色令牌化**：硬编码浅色 → Harness 暗色令牌 + `var(--dsh-ac)` 主色，与 18号文附录H 一致，设置面板改色联动生效
- **B 显示清理**：移除版本徽标 pill、顶栏硬编码项目名等调试/版本残留
- **C 操控性强化**：拖拽手柄热区扩大 + hover 高亮；按钮点击区 + title 提示

---

## 二、改动清单（A：配色令牌化，14 处）

文件：`workspace/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（后同）

新增令牌定义（D-01 主题注入处，~9200）：

| 令牌 | 用途 | 亮色 fallback |
|:-----|:-----|:-------------|
| `--dsh-bg1` | 区块底色（智能体区/记忆面板/折叠条） | #f5f5f5 |
| `--dsh-bg2` | 次级底色 | #fafafa |
| `--border` | 边框/分隔线 | #ccc |

替换映射（原硬编码 → 令牌）：

| 原值 | 替换为 | 出现位置 |
|:-----|:-------|:---------|
| `linear-gradient(135deg,#1565c0,#1976d2)` | `backgroundColor:var(--dsh-ac)` + `backgroundImage:linear-gradient(135deg,rgba(0,0,0,0.18),rgba(0,0,0,0))` | b1 顶栏、b-1 顶栏（2 处） |
| `#e8f5e9`（浅绿） | `var(--dsh-bg1, #e8f5e9)` | 折叠展开条、b-1 下条（2 处） |
| `#f5f5f5` / `#fafafa` | `var(--dsh-bg1)` / `var(--dsh-bg2)` | 智能体区、记忆面板（2 处） |
| `#e3f2fd`（浅蓝） | `var(--dsh-ac-soft, #e3f2fd)` | 记忆 header（1 处） |
| `#ccc` / `#ddd` / `#eee` | `var(--border, …)` | 全部边框/手柄（8 处） |
| `#1565c0` | `var(--dsh-ac, #1565c0)` | 记忆标题色（1 处） |
| `#666` / `#888` / `#333` | `var(--dsw-alias-label-secondary, …)` / `var(--dsw-alias-label-primary, …)` | 文字色（6 处，Harness 原生令牌） |
| 智能体 chip `background:"#fff"` | `background:"transparent"` | 5 个 chip（暗色下白底刺眼） |

> 保留 fallback 是规范做法：令牌缺失时降级到原浅色，保证任何状态下不裸奔。
> 智能体 chip 的角色色（#1976d2/#388e3c/#f57c00/#7b1fa2/#d32f2f）为语义色，保留不动。

## 三、改动清单（B：显示清理，1 处）

| 位置 | 原状 | 改为 |
|:-----|:-----|:-----|
| b1 顶栏（~7241-7242） | `总监 · dsh-client-mod` 硬编码项目名 + `V9 · 驾驶舱` 版本徽标 pill | 左：纯「总监」；右：动态项目名（`localStorage.getItem("dsh.director.currentProject")`，读不到则空），带 title 悬浮全文 + ellipsis 截断 |

> a1 主区（9221）与记忆文本（9053）中的「驾驶舱」为 V9 主界面合法标识，不动。

## 四、改动清单（C：操控性强化，4 处）

| # | 位置 | 原状 | 改为 |
|:-:|:-----|:-----|:-----|
| 1 | 分屏拖拽手柄（~7310） | `width:5`，无提示无反馈 | 热区 5→9px（`width:9` + `boxShadow:inset 5px 0 0 0` 保持 5px 视觉细线）；hover 变主色（onMouseEnter/Leave 切 boxShadow，沿用 9232 先例）；title「拖拽调整总监面板宽度」 |
| 2 | 折叠态展开按钮（~7233） | `width:22`，无 title | `width:26` + title「展开总监面板」 |
| 3 | 折叠按钮「—」（~7248） | 无 title，点击区仅字符 | title「折叠总监面板」+ `padding:4px 8px` + 文字色令牌化 |
| 4 | 记忆面板 header（~7286） | 无 title | 动态 title：折叠时「悬停展开，点击锁定记忆面板」/ 展开时「点击解锁并收起记忆面板」 |

---

## 五、验证与证据

### 5.1 自动化验证（已过）

| 项 | 命令 | 结果 |
|:---|:-----|:-----|
| 语法 | `node --check client.js` | ✅ SYNTAX_OK（两批次均过） |
| 标记自证 | `grep -c "V9.5"` | ✅ 4（令牌化注释+手柄+展开按钮+记忆header） |
| 残留检查 | `sed -n '7196,7340p' \| grep 硬编码浅色` | ✅ 命中行全部为 `var(--token, #fallback)` 规范形态 |
| 反证 | `grep "V9 · 驾驶舱"` | ✅ 0 命中（版本徽标已移除） |
| diff | `diff.ps1` | ✅ 仅 client.js 单文件改动 |
| apply | `apply.ps1` | ✅ 两批成功（快照 `snapshot-20260901-153741` / `154732`） |

### 5.2 人工验证清单（Harness 重启后逐项过）

| # | 验证项 | 预期 |
|:-:|:-------|:-----|
| 1 | z tab b1 小窗 + b-1 顶栏显示 | 配色跟随当前主题（暗色主题下不再刺眼浅色） |
| 2 | 设置面板改主色 | b1 顶栏/b-1 顶栏/焦点框/记忆标题/手柄 hover 实时联动 |
| 3 | b1 顶栏 | 无「V9 · 驾驶舱」徽标；左侧「总监」，右侧项目名（有 currentProject 时） |
| 4 | 拖拽手柄 | 热区明显好按；hover 变主色；拖拽调宽正常 |
| 5 | 折叠/展开 | 按钮悬停有 title 提示；折叠展开功能正常 |
| 6 | 记忆面板 | header 悬停有动态 title；锁定/解锁正常 |
| 7 | 回归 | zb2 滚动（V9.4）、发送目标分发、a1 tab 显示不受影响 |

### 5.3 未做项声明

- ⚠ 【未做自动视觉验证】visual-ai 服务（8000）不可用，按规范降级人工确认（同 21号文）

---

## 六、回滚

```
cd D:\hermes-data\dsh-client-mod\scripts
.\restore.ps1   # 或应用快照 snapshot-20260901-154732-before-apply
```
另有人工备份：`backups/client.js.bak-20260901-zb2`（V9.4 前状态）。

---

## 七、经验沉淀（Edit 工具 Unicode 转义坑）

修改编译产物时，文件内 `children: "\u2014"` / `"\u25B6"` 是**字面 6 字符**（反斜杠+u+码点）。
Edit 工具会把 old_string 里的 `\u2014` 转义序列**解析成实际字符**，导致永远匹配失败。
**解法**：old_string 选取不含该字符的唯一子串（如 `fontSize: 14 }` 前半段），或改用 sed 按行处理。
已记入 `_memory/MEMORY.md` 踩坑表。
