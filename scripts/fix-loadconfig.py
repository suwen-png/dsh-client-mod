import re

path = r'D:\hermes-data\dsh-client-mod\workspace\@deepseek-ai\dsh-client-ui-conversation\lib\client.js'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 用正则匹配loadV10Config函数
pattern = r'const loadV10Config = \(0, react\.useCallback\)\(async function\(\) \{.*?\t\t\t\}, \[\]\);'
match = re.search(pattern, content, re.DOTALL)

if match:
    print(f'匹配成功，函数长度: {len(match.group())}')
    
    new_func = """const loadV10Config = (0, react.useCallback)(async function() {
\t\t\t\ttry {
\t\t\t\t\tvar configDir = "D:/hermes-data/dsh-client-mod/config/";
\t\t\t\t\tvar base = "file:///" + configDir;
\t\t\t\t\tvar result = { loaded: true, agents: null, skills: null, duties: null, overview: null, risks: null, tasks: null, assets: null };
\t\t\t\t\tvar loadText = async function(filename) {
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tvar resp = await fetch(base + filename, { cache: "no-store" });
\t\t\t\t\t\t\tif (resp.ok) return await resp.text();
\t\t\t\t\t\t} catch (e) {}
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\treturn await new Promise(function(resolve, reject) {
\t\t\t\t\t\t\t\tvar xhr = new XMLHttpRequest();
\t\t\t\t\t\t\t\txhr.open("GET", base + filename, true);
\t\t\t\t\t\t\t\txhr.onload = function() { if (xhr.status === 200 || xhr.status === 0) resolve(xhr.responseText); else reject(new Error("status:" + xhr.status)); };
\t\t\t\t\t\t\t\txhr.onerror = function() { reject(new Error("xhr error")); };
\t\t\t\t\t\t\t\txhr.send();
\t\t\t\t\t\t\t});
\t\t\t\t\t\t} catch (e) {}
\t\t\t\t\t\ttry {
\t\t\t\t\t\t\tif (typeof window !== "undefined" && window.require) {
\t\t\t\t\t\t\t\tvar fs = window.require("fs");
\t\t\t\t\t\t\t\tif (fs && fs.readFileSync) return fs.readFileSync(configDir + filename, "utf-8");
\t\t\t\t\t\t\t}
\t\t\t\t\t\t} catch (e) {}
\t\t\t\t\t\treturn null;
\t\t\t\t\t};
\t\t\t\t\tvar files = ["agents.json", "skills.json", "duties.json", "tasks.json", "assets.json"];
\t\t\t\t\tfor (var i = 0; i < files.length; i++) {
\t\t\t\t\t\tvar text = await loadText(files[i]);
\t\t\t\t\t\tif (text) {
\t\t\t\t\t\t\ttry {
\t\t\t\t\t\t\t\tvar json = JSON.parse(text);
\t\t\t\t\t\t\t\tvar key = files[i].replace(".json", "");
\t\t\t\t\t\t\t\tresult[key] = json;
\t\t\t\t\t\t\t} catch (e) {}
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t\tvar ovText = await loadText("project_overview.md");
\t\t\t\t\tif (ovText) result.overview = ovText;
\t\t\t\t\tvar riskText = await loadText("risks.md");
\t\t\t\t\tif (riskText) result.risks = riskText;
\t\t\t\t\tsetV10Data(result);
\t\t\t\t} catch (e) {
\t\t\t\t\tsetV10Data({ loaded: true, agents: null, skills: null, duties: null, overview: null, risks: null, tasks: null, assets: null });
\t\t\t\t}
\t\t\t}, []);"""
    
    content = content[:match.start()] + new_func + content[match.end():]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('loadV10Config 已替换为多通道加载版本')
else:
    print('未匹配到loadV10Config函数')
