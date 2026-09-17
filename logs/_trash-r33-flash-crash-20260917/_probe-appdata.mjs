/** 列出应用数据目录候选（用 .mjs 避免 shell 转义地狱）。用完即删。 */
import fs from "node:fs";
import path from "node:path";

const homes = [
  "C:\\Users\\15142\\AppData\\Local",
  "C:\\Users\\15142\\AppData\\Roaming",
  "C:\\Users\\15142\\.dsh",
];
for (const h of homes) {
  console.log("== " + h);
  let ents = [];
  try { ents = fs.readdirSync(h); } catch { console.log("  (不可读)"); continue; }
  for (const e of ents) {
    if (/deepseek|harness|dsh/i.test(e)) {
      const p = path.join(h, e);
      let stat = null;
      try { stat = fs.statSync(p); } catch {}
      let extra = "";
      if (stat && stat.isDirectory()) {
        try { extra = " [" + fs.readdirSync(p).slice(0, 8).join(", ") + "]"; } catch {}
      }
      console.log("  " + e + extra);
    }
  }
}
