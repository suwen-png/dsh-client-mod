# dsh-director-plugin — 总监驾驶舱插件包（P0 骨架）

> 26号文 P0 阶段产物（T-PLUG-004）。目标：把内联在 dsh-client-ui-conversation/lib/client.js 里的总监功能迁为独立插件，走 Harness 官方 client 插件通道。

## 官方通道（勘察结论，详见 docs/50-信息中心/插件加载通道勘察-20260907.md）

1. 本包 package.json 声明 dsh.client（platform/inject/immediately）。
2. host 侧 dsh-client-modules 增量扫描 host Loader entries 中声明 dsh.client 的包（**plugin-set 变更重启生效**）。
3. bundle 由 host webserver 在 /plugins/<id>/client.js 提供；index.html 被注入 window.__DSH_BOOT__。
4. 浏览器端 prefetch → cordis Loader 逐行 create → 全 ACTIVE 后 settled。
5. bundle 内 require 解析范围 = 平台模块表 + boot graph 注入包；跨插件 value import 是构建错误。

## 安装（spike，T-PLUG-003）

1. 完全退出 Harness（含托盘）。
2. 把本目录复制到 D:\软件安装\DeepSeek-Harness-Desktop\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh-director-plugin。
3. 启动 Harness → 打开插件中心/设置-插件清单确认出现本包；或 DevTools 检查 window.__DSH_BOOT__.plugins 是否含本包 id。
4. 失败回滚：删除该目录 + 重启（零残留）。

## 开放点（P0 未完全确认）

- host 侧包发现（host Loader 从 node_modules 装载插件的字段/清单）——spike 验证。
- dsh.client.inject 包的 require 可达边界——spike 验证。

## 回滚

删除本包目录即完全退出插件通道；client.js 主补丁不受影响。
