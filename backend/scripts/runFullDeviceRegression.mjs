// scripts/runFullDeviceRegression.mjs - Device regression runner
//
// Boots ONE in-memory MongoDB REPLICA SET, sets MONGO_URI for the whole
// process, then spawns mocha with all current device + kiosk + security
// suites so every suite shares a real mongod that supports transactions.
// Mirrors `npm test` but guarantees a reachable transaction-capable database.
//
// Usage: cd backend && node scripts/runFullDeviceRegression.mjs

import { MongoMemoryServer } from "mongodb-memory-server";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mem = await MongoMemoryServer.create({
  instance: {
    replSet: {
      name: "rs0",
      storageEngine: "wiredTiger",
    },
  },
});
const uri = mem.getUri();
console.log("Shared MongoMemoryServer (replica set):", uri);

const tests = [
  "src/tests/deviceRegistration.test.js",
  "src/tests/deviceLifecycle.test.js",
  "src/tests/directDeviceActivation.test.js",
  "src/tests/kiosk.test.js",
  "src/tests/kioskScopedPunch.test.js",
  "src/tests/securityAndConcurrency.test.js",
  "src/tests/phase4Security.test.js",
  "src/tests/reportsRbac.test.js",
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