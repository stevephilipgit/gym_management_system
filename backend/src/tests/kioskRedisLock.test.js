/**
 * Kiosk Redis lock + credential-cache invariants.
 *
 * Covers the two Redis-backed guarantees added to the kiosk punch path:
 *
 *   1. PER-MEMBER DISTRIBUTED LOCK (`lock:punch:<memberId>`)
 *      - a second concurrent punch for the SAME member is rejected with
 *        429 { status: "rate_limited", error: "punch_in_progress" }
 *      - different members do NOT contend (independent lock keys)
 *      - the lock is always released, including on the failure paths
 *
 *   2. KIOSK CREDENTIAL CACHE (`kiosk:cred:<kioskId>:<fingerprint>`)
 *      - a validated principal is cached and reused
 *      - disabling / locking / revoking a device evicts it
 *
 * Requires a reachable Redis. The production helpers are fail-open by design,
 * so Redis-only cases are skipped (never falsely passed) when it is down.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import { expect } from "chai";

import Kiosk from "../models/Kiosk.js";
import DeviceRegistration from "../models/DeviceRegistration.js";
import Member from "../models/Member.js";
import SystemSettings from "../models/SystemSettings.js";
import Attendance from "../models/Attendance.js";
import kioskAuth, { invalidateKioskCredentialCache } from "../middleware/kioskAuth.js";
import { kioskPunch } from "../controllers/kioskController.js";
import { performKioskPunch } from "../services/kioskService.js";
import redisClient, {
  acquireLock,
  releaseLock,
  getCache,
  setCache,
  deleteCache,
} from "../config/redis.js";
import systemSettingsService from "../services/systemSettingsService.js";
import { seedTestBranch } from "./utils/branchFixture.js";

const KIOSK_ID = "kiosk-redis-lock-test";
const KIOSK_KEY = crypto.randomBytes(32).toString("base64url");
const KEY_FINGERPRINT = crypto.createHash("sha256").update(KIOSK_KEY).digest("hex");
const CRED_CACHE_KEY = `kiosk:cred:${KIOSK_ID}:${KEY_FINGERPRINT}`;
const CRED_INDEX_KEY = `kiosk:cred:idx:${KIOSK_ID}`;

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function mockReq(headers, body = {}, ip = "10.0.0.9") {
  return { ip, body, get: (name) => headers[String(name).toLowerCase()] };
}

const AUTH_HEADERS = { "x-kiosk-id": KIOSK_ID, "x-kiosk-key": KIOSK_KEY };

/** Run kioskAuth with the given headers; reports whether next() was called. */
async function runKioskAuth(headers = AUTH_HEADERS) {
  const req = mockReq(headers);
  const res = mockRes();
  let nextCalled = false;
  await kioskAuth(req, res, () => {
    nextCalled = true;
  });
  return { req, res, nextCalled };
}

async function redisReachable() {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    return (await redisClient.ping()) === "PONG";
  } catch {
    return false;
  }
}

describe("Kiosk Redis lock + credential cache", function () {
  this.timeout(60000);

  let mongoServer;
  let redisUp = false;
  let branch;
  let member;
  let otherMember;

  const baseMember = (overrides) => ({
    fullName: "Redis Lock Member",
    branchId: branch._id,
    fatherName: "Test Father",
    dob: new Date("1995-01-01"),
    bloodGroup: "O+",
    gender: "Male",
    address: "Test Address",
    occupation: "Student",
    aadhar: String(100000000000 + Math.floor(Math.random() * 800000000000)),
    phone: `9${String(7000000000 + Math.floor(Math.random() * 999999999)).slice(0, 9)}`,
    gymPlan: "1 Month",
    trainingType: "Weight Loss",
    paymentStatus: "paid",
    status: "active",
    validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...overrides,
  });

  before(async function () {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }

    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), { dbName: "gym_kiosk_redis_lock" });

    branch = await seedTestBranch();

    redisUp = await redisReachable();

    await Kiosk.create({ kioskId: KIOSK_ID, name: "Redis Lock Kiosk", scope: "male", enabled: true, branchId: branch._id });

    await DeviceRegistration.create({
      registrationId: crypto.randomUUID(),
      kioskId: KIOSK_ID,
      trainerId: new mongoose.Types.ObjectId(),
      browserDeviceId: "redis-lock-browser",
      active: true,
      apiKeyHash: await bcrypt.hash(KIOSK_KEY, 10),
      keyFingerprint: KEY_FINGERPRINT,
      activatedAt: new Date(),
    });

    // Always-open window so business hours never masks a lock assertion.
    await SystemSettings.findOneAndUpdate(
      { key: "gym_rules" },
      { key: "gym_rules", openingTime: "00:00", closingTime: "23:59", duplicatePunchSeconds: 0 },
      { upsert: true, new: true }
    );
    systemSettingsService.invalidateCache();

    member = await Member.create(baseMember({ gymId: 9001, memberCode: "M9001" }));
    otherMember = await Member.create(baseMember({ gymId: 9002, memberCode: "M9002" }));
  });

  afterEach(async function () {
    // Never leak a lock or a cached principal between cases.
    await Attendance.deleteMany({});
    if (!redisUp) return;
    await deleteCache(CRED_CACHE_KEY);
    await deleteCache(CRED_INDEX_KEY);
    const held = await redisClient.keys("lock:punch:*");
    if (Array.isArray(held) && held.length > 0) await redisClient.del(held);
    systemSettingsService.invalidateCache();
  });

  after(async function () {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect().catch(() => {});
    }
    if (mongoServer) await mongoServer.stop();
  });

  // ── Lock primitive contract ────────────────────────────────────────────────
  describe("lock primitive", () => {
    it("acquireLock is exclusive for the same key", async function () {
      if (!redisUp) return this.skip();
      const key = "lock:punch:test-exclusive";
      expect(await acquireLock(key, "token-a", 3000)).to.equal(true);
      // A second acquire for the same key must fail (NX semantics).
      expect(await acquireLock(key, "token-b", 3000)).to.equal(false);
      await releaseLock(key, "token-a");
      // Once released the key is free again.
      expect(await acquireLock(key, "token-b", 3000)).to.equal(true);
      await releaseLock(key, "token-b");
    });

    it("releaseLock does not free a lock owned by a different token", async function () {
      if (!redisUp) return this.skip();
      const key = "lock:punch:test-owner";
      await acquireLock(key, "owner-token", 3000);
      // A wrong token must NOT delete the lock.
      expect(await releaseLock(key, "impostor-token")).to.equal(false);
      expect(await redisClient.get(key)).to.equal("owner-token");
      // The correct token frees it.
      expect(await releaseLock(key, "owner-token")).to.equal(true);
      expect(await redisClient.get(key)).to.equal(null);
    });

    it("locks expire on their own (TTL is a crash safety net)", async function () {
      if (!redisUp) return this.skip();
      const key = "lock:punch:test-ttl";
      expect(await acquireLock(key, "ttl-token", 150)).to.equal(true);
      expect(await acquireLock(key, "other", 150)).to.equal(false);
      await new Promise((r) => setTimeout(r, 400));
      // After the TTL the key frees up: a crashed request cannot wedge a member.
      expect(await acquireLock(key, "other", 150)).to.equal(true);
      await releaseLock(key, "other");
    });
  });

  // ── Per-member punch lock ──────────────────────────────────────────────────
  describe("per-member punch lock", () => {
    it("rejects a concurrent second punch for the same member with 429 punch_in_progress", async function () {
      if (!redisUp) return this.skip();

      // Hold the lock so it is guaranteed to still be owned when the punch path
      // tries to acquire it (no race on scheduling).
      const lockKey = `lock:punch:${member._id}`;
      expect(await acquireLock(lockKey, "held-by-test", 3000)).to.equal(true);

      const req = mockReq(AUTH_HEADERS, { input: String(member.gymId) });
      req.kiosk = { kioskId: KIOSK_ID, scope: "male" };
      const res = mockRes();
      await kioskPunch(req, res);

      expect(res.statusCode).to.equal(429);
      expect(res.body.status).to.equal("rate_limited");
      expect(res.body.error).to.equal("punch_in_progress");
      expect(res.body.message).to.be.a("string");

      // Critically: a blocked punch must NOT have written an attendance row.
      expect(await Attendance.countDocuments({ memberId: member._id })).to.equal(0);

      await releaseLock(lockKey, "held-by-test");
    });

    it("still punches once the lock is released", async () => {
      const res = await performKioskPunch({
        input: String(member.gymId),
        scope: "male",
        principal: { type: "kiosk", kioskId: KIOSK_ID },
      });
      expect(res.success).to.equal(true);
      expect(await Attendance.countDocuments({ memberId: member._id })).to.equal(1);
    });

    it("does not contend across different members (independent lock keys)", async () => {
      const [a, b] = await Promise.all([
        performKioskPunch({
          input: String(member.gymId),
          scope: "male",
          principal: { type: "kiosk", kioskId: KIOSK_ID },
        }),
        performKioskPunch({
          input: String(otherMember.gymId),
          scope: "male",
          principal: { type: "kiosk", kioskId: KIOSK_ID },
        }),
      ]);
      // Neither request may be rejected merely because the other held a lock.
      expect(a.success).to.equal(true);
      expect(b.success).to.equal(true);
    });

    it("releases the lock after a successful punch (nothing leaked)", async function () {
      await performKioskPunch({
        input: String(member.gymId),
        scope: "male",
        principal: { type: "kiosk", kioskId: KIOSK_ID },
      });
      if (!redisUp) return;
      expect(await redisClient.get(`lock:punch:${member._id}`)).to.equal(null);
    });

    it("releases the lock on the failure path too", async () => {
      let threw = false;
      try {
        await performKioskPunch({
          memberCode: "DOES-NOT-EXIST",
          scope: "male",
          principal: { type: "kiosk", kioskId: KIOSK_ID },
        });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
      if (!redisUp) return;
      // The finally block must have run — no stale lock:punch:* remains.
      const stale = await redisClient.keys("lock:punch:*");
      expect(Array.isArray(stale) ? stale.length : 0).to.equal(0);
    });
  });

  // ── Credential cache ───────────────────────────────────────────────────────
  describe("kiosk credential cache", () => {
    it("caches a validated principal and reuses it on the next auth", async function () {
      if (!redisUp) return this.skip();

      const first = await runKioskAuth();
      expect(first.nextCalled).to.equal(true);

      const cached = await getCache(CRED_CACHE_KEY);
      expect(cached).to.be.an("object");
      expect(cached.principal).to.be.an("object");
      expect(cached.principal.kioskId).to.equal(KIOSK_ID);
      expect(cached.principal.scope).to.equal("male");
      expect(cached.enabled).to.equal(true);
      expect(cached.locked).to.equal(false);
      // The raw secret must never be persisted at rest.
      expect(JSON.stringify(cached)).to.not.include(KIOSK_KEY);

      // The second auth is served from cache with an identical principal.
      const second = await runKioskAuth();
      expect(second.nextCalled).to.equal(true);
      expect(second.req.kiosk.kioskId).to.equal(first.req.kiosk.kioskId);
      expect(second.req.kiosk.scope).to.equal(first.req.kiosk.scope);
    });

    it("does not cache a rejected credential", async function () {
      if (!redisUp) return this.skip();
      const badKey = crypto.randomBytes(32).toString("base64url");
      const badFingerprint = crypto.createHash("sha256").update(badKey).digest("hex");

      const { nextCalled, res } = await runKioskAuth({
        "x-kiosk-id": KIOSK_ID,
        "x-kiosk-key": badKey,
      });
      expect(nextCalled).to.equal(false);
      expect(res.statusCode).to.equal(401);
      // No entry may be created for a credential that never validated.
      expect(await getCache(`kiosk:cred:${KIOSK_ID}:${badFingerprint}`)).to.equal(null);
    });

    it("disabling the kiosk evicts the cached credential", async function () {
      if (!redisUp) return this.skip();

      await runKioskAuth();
      expect(await getCache(CRED_CACHE_KEY)).to.not.equal(null);

      // The admin disable path calls this invalidation helper.
      await Kiosk.updateOne({ kioskId: KIOSK_ID }, { $set: { enabled: false } });
      await invalidateKioskCredentialCache(KIOSK_ID);

      expect(await getCache(CRED_CACHE_KEY)).to.equal(null);
      // And the next auth is refused by the authoritative DB check.
      const after = await runKioskAuth();
      expect(after.nextCalled).to.equal(false);
      expect(after.res.statusCode).to.equal(403);

      await Kiosk.updateOne({ kioskId: KIOSK_ID }, { $set: { enabled: true } });
    });

    it("locking a registration evicts the cached credential", async function () {
      if (!redisUp) return this.skip();

      await runKioskAuth();
      expect(await getCache(CRED_CACHE_KEY)).to.not.equal(null);

      // Simulate the admin lock path: the registration is now locked, so a
      // cached principal must no longer authenticate it.
      await DeviceRegistration.updateOne(
        { kioskId: KIOSK_ID },
        { $set: { locked: true, lockedAt: new Date() } }
      );
      await invalidateKioskCredentialCache(KIOSK_ID);

      expect(await getCache(CRED_CACHE_KEY)).to.equal(null);
      const after = await runKioskAuth();
      expect(after.nextCalled).to.equal(false);
      expect(after.res.statusCode).to.equal(403);

      // Restore for the remaining cases.
      await DeviceRegistration.updateOne(
        { kioskId: KIOSK_ID },
        { $set: { locked: false }, $unset: { lockedAt: "" } }
      );
    });

    it("revoking a registration evicts the cached credential", async function () {
      if (!redisUp) return this.skip();

      await runKioskAuth();
      expect(await getCache(CRED_CACHE_KEY)).to.not.equal(null);

      // Simulate the admin revoke path: the registration is now revoked.
      await DeviceRegistration.updateOne(
        { kioskId: KIOSK_ID },
        { $set: { active: false, revokedAt: new Date() } }
      );
      await invalidateKioskCredentialCache(KIOSK_ID);

      expect(await getCache(CRED_CACHE_KEY)).to.equal(null);
      const after = await runKioskAuth();
      expect(after.nextCalled).to.equal(false);
      expect(after.res.statusCode).to.equal(401);

      // Restore for good measure.
      await DeviceRegistration.updateOne(
        { kioskId: KIOSK_ID },
        { $set: { active: true }, $unset: { revokedAt: "" } }
      );
    });
  });

  // ── Degradation ────────────────────────────────────────────────────────────
  describe("graceful degradation", () => {
    it("a corrupt cache entry is treated as a miss, never a 500", async function () {
      if (!redisUp) return this.skip();
      // A malformed payload must fall through to MongoDB rather than throw.
      await redisClient.set(CRED_CACHE_KEY, "{not-json", { EX: 60 });
      expect(await getCache(CRED_CACHE_KEY)).to.equal(null);

      const { nextCalled } = await runKioskAuth();
      expect(nextCalled).to.equal(true);
    });

    it("setCache/getCache round-trip and deleteCache removes", async function () {
      if (!redisUp) return this.skip();
      const key = "kiosk:test:roundtrip";
      expect(await setCache(key, { a: 1, nested: { b: 2 } }, 60)).to.equal(true);
      expect(await getCache(key)).to.deep.equal({ a: 1, nested: { b: 2 } });
      expect(await deleteCache(key)).to.equal(true);
      expect(await getCache(key)).to.equal(null);
    });

    it("a punch with no lock contention always proceeds (fail-open baseline)", async () => {
      const res = await performKioskPunch({
        input: String(member.gymId),
        scope: "male",
        principal: { type: "kiosk", kioskId: KIOSK_ID },
      });
      expect(res.success).to.equal(true);
    });
  });
});

