// scripts/bootMongo.mjs - Boot one in-memory MongoDB REPLICA SET and print its URI.
// Usage: node scripts/bootMongo.mjs <outfile>
// The DeviceRegistration lifecycle uses mongoose transactions, so mongod MUST
// run as a single-node replica set (replSet: "rs0"). We append the
// replicaSet/directConnection params because getUri() alone omits them and the
// driver needs them to discover the RS members for transaction support.

import { MongoMemoryServer } from "mongodb-memory-server";
import { writeFileSync } from "node:fs";

const outfile = process.argv[2];
const mem = await MongoMemoryServer.create({
  instance: {
    replSet: {
      name: "rs0",
      storageEngine: "wiredTiger",
    },
  },
});
const base = mem.getUri().replace(/\/$/, "");
const uri = `${base}/?replicaSet=rs0&directConnection=true`;
writeFileSync(outfile, uri, "utf8");
console.log("BOOTED", uri);
process.on("SIGTERM", async () => { await mem.stop(); process.exit(0); });
process.on("SIGINT", async () => { await mem.stop(); process.exit(0); });
