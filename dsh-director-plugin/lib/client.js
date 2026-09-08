window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-director-plugin/client",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    // 平台模块表（getStaticModules）提供 react / react/jsx-runtime / react-dom /
    // react-dom/client / @deepseek-ai/cordis / @deepseek-ai/dsh-client-ui-slots /
    // @deepseek-ai/dsh-client-web-react / ui-primitives / ui-attachment / schema-form。
    // dsh.client.inject 声明的包（runtime/locale）由 boot graph 注入，require 可达性以 spike 实测为准。
    var react = require("react");
    var react_jsx_runtime = require("react/jsx-runtime");
    /**
     * P0 spike bundle：最小可验证产物。
     * TODO(T-PLUG-005): 迁移 DirectorView（client.js :8898+）与 stores（:6440+）到 src/。
     * TODO(spike): 通过 slots.register 注册测试视图，验证 dsh.client 通道端到端可用。
     */
    function SpikeView() {
      return (0, react_jsx_runtime.jsx)("div", { style: { padding: 24, fontFamily: "monospace" }, children: "dsh-director-plugin spike bundle loaded" });
    }
    module.exports = { SpikeView };
    return module.exports;
  }
});
