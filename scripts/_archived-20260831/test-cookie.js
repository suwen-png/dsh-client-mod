// 模拟document.cookie
let cookieStore = "";
global.document = {
    get cookie() { return cookieStore; },
    set cookie(val) {
        // 解析cookie设置
        const parts = val.split(";");
        const cookiePart = parts[0].trim();
        const eqIdx = cookiePart.indexOf("=");
        if (eqIdx === -1) return;
        const name = cookiePart.substring(0, eqIdx);
        const value = cookiePart.substring(eqIdx + 1);
        
        // 检查是否是删除（expires在过去）
        let isDelete = false;
        for (const p of parts) {
            if (p.trim().toLowerCase().startsWith("expires=")) {
                const expStr = p.trim().substring(8);
                const expDate = new Date(expStr);
                if (expDate < new Date()) isDelete = true;
            }
        }
        
        // 更新cookieStore
        const cookies = cookieStore ? cookieStore.split("; ") : [];
        const newCookies = [];
        for (const c of cookies) {
            if (c && !c.startsWith(name + "=")) {
                newCookies.push(c);
            }
        }
        if (!isDelete) {
            newCookies.push(name + "=" + value);
        }
        cookieStore = newCookies.join("; ");
    }
};

// 复制cookie函数
function dshCookieSet(name, value, days) {
    try {
        const expires = new Date(Date.now() + (days || 3650) * 86400000).toUTCString();
        document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/";
        return true;
    } catch (e) { return false; }
}
function dshCookieGet(name) {
    try {
        const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\/+^])/g, "\\$1") + "=([^;]*)"));
        return match ? decodeURIComponent(match[1]) : null;
    } catch (e) { return null; }
}
function dshCookieSave(key, data) {
    try {
        const json = JSON.stringify(data);
        const chunkSize = 3000;
        const chunks = [];
        for (let i = 0; i < json.length; i += chunkSize) {
            chunks.push(json.substring(i, i + chunkSize));
        }
        for (let i = 0; i < 100; i++) {
            const old = dshCookieGet(key + "_" + i);
            if (old === null) break;
            dshCookieSet(key + "_" + i, "", -1);
        }
        dshCookieSet(key + "_meta", JSON.stringify({ chunks: chunks.length, len: json.length }), 3650);
        for (let i = 0; i < chunks.length; i++) {
            dshCookieSet(key + "_" + i, chunks[i], 3650);
        }
        return true;
    } catch (e) {
        console.error("cookie save failed:", e.message);
        return false;
    }
}
function dshCookieLoad(key) {
    try {
        const metaStr = dshCookieGet(key + "_meta");
        if (!metaStr) return null;
        const meta = JSON.parse(metaStr);
        if (!meta.chunks || meta.chunks <= 0) return null;
        let json = "";
        for (let i = 0; i < meta.chunks; i++) {
            const chunk = dshCookieGet(key + "_" + i);
            if (chunk === null) return null;
            json += chunk;
        }
        if (json.length !== meta.len) {
            console.error("length mismatch: expected=" + meta.len + " actual=" + json.length);
            return null;
        }
        return JSON.parse(json);
    } catch (e) {
        console.error("cookie load failed:", e.message);
        return null;
    }
}

// 测试
console.log("=== Cookie存储测试 ===");

// 测试1: 简单数据
const testData1 = { messages: [{ role: "user", content: "测试消息1" }, { role: "assistant", content: "回复1" }], config: { autoForward: true } };
console.log("\n测试1: 简单数据");
console.log("原始数据:", JSON.stringify(testData1).length, "bytes");
const save1 = dshCookieSave("test_key", testData1);
console.log("保存结果:", save1);
const load1 = dshCookieLoad("test_key");
console.log("加载结果:", JSON.stringify(load1) === JSON.stringify(testData1) ? "PASS" : "FAIL");
console.log("加载数据:", JSON.stringify(load1));

// 测试2: 大数据（超过3KB）
console.log("\n测试2: 大数据（超过3KB）");
const bigMessages = [];
for (let i = 0; i < 50; i++) {
    bigMessages.push({ role: i % 2 === 0 ? "user" : "assistant", content: "这是第" + i + "条消息，内容比较长，用来测试分块存储是否正常工作。" + "x".repeat(100) });
}
const testData2 = { messages: bigMessages, config: { autoForward: true } };
console.log("原始数据:", JSON.stringify(testData2).length, "bytes,", bigMessages.length, "条消息");
const save2 = dshCookieSave("test_big", testData2);
console.log("保存结果:", save2);
const load2 = dshCookieLoad("test_big");
console.log("加载结果:", JSON.stringify(load2) === JSON.stringify(testData2) ? "PASS" : "FAIL");
console.log("加载消息数:", load2 ? load2.messages.length : 0);

// 测试3: 覆盖保存
console.log("\n测试3: 覆盖保存");
const testData3 = { messages: [{ role: "user", content: "新消息" }], config: {} };
dshCookieSave("test_key", testData3);
const load3 = dshCookieLoad("test_key");
console.log("覆盖后加载:", JSON.stringify(load3) === JSON.stringify(testData3) ? "PASS" : "FAIL");

console.log("\n=== 测试完成 ===");
