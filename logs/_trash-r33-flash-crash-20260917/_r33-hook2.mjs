
import fs from "node:fs";
const LOG = "D:\\hermes-data\\dsh-client-mod\\dsh-director-plugin\\logs\\_r33-rejection2.txt";
const rec = (tag, err) => {
  const body = "[" + tag + "] " + new Date().toISOString() + " pid=" + process.pid + "\n"
    + (err && err.stack ? err.stack : String(err)) + "\n\n";
  try { fs.appendFileSync(LOG, body); } catch {}
};
process.on("unhandledRejection", (e) => rec("REJECTION", e));
process.on("uncaughtException", (e) => rec("EXCEPTION", e));
