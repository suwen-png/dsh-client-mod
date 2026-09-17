
import fs from "node:fs";
const LOG = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\_r33-rejection.txt";
process.on("unhandledRejection", (err) => {
  const body = "=== unhandledRejection @ " + new Date().toISOString() + " pid=" + process.pid + " ===\n"
    + (err && err.stack ? err.stack : String(err)) + "\n";
  try { fs.appendFileSync(LOG, body); } catch {}
  // 不阻止默认行为，让 failLoud 照常 exit(1)
});
