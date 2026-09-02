// scripts/runFullDeviceRegression.mjs - Phase C regression runner
//
// Boots ONE in-memory MongoDB, sets MONGO_URI for the whole process, then
// spawns mocha with all device + provisioning suites so every suite shares a
// real mongod. Mirrors `npm test` but guarantees a reachable database.
//
// Usage: cd backend && node scripts/runFullDeviceRegression.mjs

import { MongoMemoryServer } from "mongodb-memory-server";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mem = await MongoMemoryServer.create();
const uri = mem.getUri();
console.log("Shared MongoMemoryServer:", uri);

const tests = [
  "src/tests/provisioning.test.js",
  "src/tests/provisioningApi.test.js",
  "src/tests/provisioningGuard.test.js",
  "src/tests/deviceLifecycle.test.js",
  "src/tests/deviceRequestApi.test.js",
  "src/tests/deviceRequestClaim.test.js",
  "src/tests/deviceRequest.test.js",
  "src/tests/kiosk.test.js",
  "src/tests/kioskScopedPunch.test.js",
  "src/tests/securityAndConcurrency.test.js",
];

const env = { ...process.env, MONGO_URI: uri };
const mochaBin = path.join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "mocha.cmd" : "mocha");
const result = spawnSync(mochaBin, ["--timeout", "120000", ...tests], {
  env,
  stdio: "inherit",
  cwd: path.join(__dirname, ".."),
});

await mem.stop();
process.exit(result.status ?? 1);
