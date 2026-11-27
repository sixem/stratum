// Expand the test file list consistently in Windows and Unix shells.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const tests = readdirSync("tests").filter(name => name.endsWith(".test.mjs"))
  .sort().map(name => `tests/${name}`);
if (!tests.length) throw new Error("No frontend tests found.");
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
