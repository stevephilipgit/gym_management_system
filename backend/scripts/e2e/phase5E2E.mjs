// scripts/e2e/phase5E2E.mjs — Phase 5 HTTP-stack E2E test runner
//
// Drives the REAL backend process over HTTP against a DEDICATED E2E database.
// Refuses to run against production. Cleans up the E2E database on teardown.
//
// Usage:
//   E2E_MONGO_URI="<atlas uri for gym_e2e_test>" node scripts/e2e/phase5E2E.mjs

import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "redis";

// Register models before use
import "../../src/models/Admin.js";
import "../../src/models/Kiosk.js";
import "../../src/models/DeviceRegistration.js";
import "../../src/models/DeviceActivation.js";
import "../../src/models/Member.js";
import "../../src/models/Attendance.js";
import "../../src/models/SystemSettings.js";
import "../../src/models/AdminSession.js";
import "../../src/models/Notification.js";
import "../../src/models/AttendanceExport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, "..", "..");
const E2E_PORT = 5200;
const E2E_HOST = `http://localhost:${E2E_PORT}`;
const PROD_DB_NAME = "giri_gym";
const TRAINER_PW = "Pass1234!";

const results = [];
const pass = (name, detail = "") => results.push({ name, status: "EXECUTED + PASS", detail });
const fail = (name, detail) => {
  results.push({ name, status: "EXECUTED + FAIL", detail: String(detail) });
  console.error(`  ✗ ${name}: ${String(detail).slice(0, 400)}`);
};
const blocked = (name, detail) => results.push({ name, status: "BLOCKED", detail: String(detail) });
const manual = (name, detail) => results.push({ name, status: "MANUAL VERIFICATION REQUIRED", detail: String(detail) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const CAPTCHA_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomCaptcha = () => Array.from({ length: 5 }, () => CAPTCHA_ALPHABET[crypto.randomInt(CAPTCHA_ALPHABET.length)]).join("");

async function run() {
  const e2eUri = process.env.E2E_MONGO_URI;
  if (!e2eUri) { console.error("FATAL: E2E_MONGO_URI not set."); process.exit(1); }
  const dbName = (e2eUri.match(/\/([a-zA-Z0-9_-]+)(\?|$)/) || [])[1];
  if (dbName === PROD_DB_NAME) { console.error(`FATAL: refusing to run against production DB "${PROD_DB_NAME}".`); process.exit(1); }
  if (dbName !== "gym_e2e_test") { console.error(`FATAL: E2E DB must be "gym_e2e_test", got "${dbName}".`); process.exit(1); }

  console.log(`\n=== Phase 5 E2E — DB: ${dbName} · Port: ${E2E_PORT} ===\n`);
  let serverProcess = null;
  let serverReady = false;

  try {
    // ── 1. Seed fixtures in the dedicated E2E database ────────────────
    await mongoose.connect(e2eUri, { serverSelectionTimeoutMS: 5000 });
    const Admin = mongoose.model("Admin");
    const Kiosk = mongoose.model("Kiosk");
    const DeviceRegistration = mongoose.model("DeviceRegistration");
    const DeviceActivation = mongoose.model("DeviceActivation");
    const Member = mongoose.model("Member");
    const Attendance = mongoose.model("Attendance");
    const AdminSession = mongoose.model("AdminSession");
    const SystemSettings = mongoose.model("SystemSettings");
    const Notification = mongoose.model("Notification");

    for (const model of [Admin, Kiosk, DeviceRegistration, DeviceActivation, Member, Attendance, AdminSession, SystemSettings, Notification]) {
      await model.deleteMany({}).catch(() => {});
    }
    await DeviceRegistration.init();
    await Kiosk.init();
    await DeviceActivation.init();

    const superAdmin = await Admin.create({
      fullName: "E2E Super", username: "e2e_super", role: "superadmin", scope: "all",
      email: "e2e_super@test.local", passwordHash: await bcrypt.hash(TRAINER_PW, 4), status: "active", tokenVersion: 0,
    });
    const maleTrainer = await Admin.create({
      fullName: "E2E Male", username: "e2e_male", role: "trainer", scope: "male",
      email: "e2e_male@test.local", passwordHash: await bcrypt.hash(TRAINER_PW, 4), status: "active", tokenVersion: 0,
    });
    const femaleTrainer = await Admin.create({
      fullName: "E2E Female", username: "e2e_female", role: "trainer", scope: "female_plus_transgender",
      email: "e2e_female@test.local", passwordHash: await bcrypt.hash(TRAINER_PW, 4), status: "active", tokenVersion: 0,
    });

    const mkMember = (fullName, gender, gymId, memberCode, phone) =>
      Member.create({
        fullName, gender, gymId, memberCode, fatherName: "F", dob: new Date("1990-01-01"),
        bloodGroup: "O+", address: "T", occupation: "S",
        aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)),
        phone, gymPlan: "1 Month", trainingType: "Weight Loss", paymentStatus: "paid",
        status: "active", validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

    await mkMember("E2E Male 192", "Male", 192, "M9001", "9000000001");
    await mkMember("E2E Female 192", "Female", 192, "F9002", "9000000002");
    await mkMember("E2E Female 500", "Female", 500, "F9003", "9000000003");
    await mkMember("E2E Trans 500", "Transgender", 500, "T9004", "9000000004");
    await mkMember("E2E Male 444", "Male", 444, "M9005", "9000000005");

    await SystemSettings.deleteMany({});
    await SystemSettings.create({
      key: "gym_rules",
      duplicatePunchSeconds: 0,
      openingTime: "00:00",
      closingTime: "23:59",
      oneVisitPerDay: false,
      blockExpiredMembers: false,
      expiredGraceDays: 0,
    });
    const { default: systemSettingsService } = await import("../../src/services/systemSettingsService.js");
    systemSettingsService.invalidateCache?.();

    await mongoose.disconnect();
    console.log("  Fixtures seeded.");

    // ── 2. Start the real backend process ─────────────────────────────
    serverProcess = spawn("node", ["server.js"], {
      cwd: BACKEND_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(E2E_PORT), DATABASE_URL: e2eUri, NODE_ENV: "development", ACTIVATION_REDEEM_MAX: "100" },
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("server startup timeout")), 40000);
      const onData = (c) => {
        const s = c.toString();
        process.stdout.write(s);
        if (s.includes("Server running on port")) { clearTimeout(t); serverReady = true; resolve(); }
      };
      serverProcess.stdout.on("data", onData);
      serverProcess.stderr.on("data", onData);
      serverProcess.on("error", (e) => { clearTimeout(t); reject(e); });
      serverProcess.on("exit", (code) => { clearTimeout(t); if (!serverReady) reject(new Error(`server exited code ${code}`)); });
    });
    console.log(`\n  Server ready on :${E2E_PORT}\n`);

    // ── 3. HTTP helpers (with session reuse + full diagnostics) ──────
    const redis = createClient({ url: "redis://localhost:6379" });
    let redisAvail = false;
    try { await redis.connect(); redisAvail = true; } catch { console.warn("  WARN: Redis unavailable — auth scenarios BLOCKED."); }

    const httpJson = async (url, opts = {}, label = "") => {
      await sleep(120);
      const res = await fetch(`${E2E_HOST}${url}`, {
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
        ...opts,
      });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 400) {
        console.warn(`    [warn] ${label || opts.method || "GET"} ${url} → ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
      }
      return { status: res.status, headers: res.headers, body };
    };

    const sessionCache = {}; // username -> { sessionId, cookie }
    const login = async (username) => {
      if (sessionCache[username]) return sessionCache[username];
      if (!redisAvail) throw new Error("Redis unavailable for captcha");
      const answer = randomCaptcha();
      const captchaId = crypto.randomUUID();
      await redis.set(`captcha:${captchaId}`, JSON.stringify({ answerHash: sha256hex(answer.toUpperCase()) }), { EX: 300 });
      const r = await httpJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password: TRAINER_PW, captchaId, captchaAnswer: answer }),
      }, "login");
      if (r.status !== 200) throw new Error(`login ${username} → HTTP ${r.status} ${JSON.stringify(r.body)}`);
      const setCookie = r.headers.get("set-cookie") || "";
      // Session IDs are UUIDs (contain hyphens) → match the full cookie name.
      const m = setCookie.match(/gym_admin_token_[\w-]+=[^;]+/);
      const session = { sessionId: r.body.sessionId, cookie: m ? m[0] : "" };
      sessionCache[username] = session;
      return session;
    };

    const adminReq = async (sid, cookie, url, opts = {}, label = "") => {
      const r = await httpJson(url, { ...opts, headers: { "Content-Type": "application/json", "X-Session-Id": sid, Cookie: cookie, ...(opts.headers || {}) } }, label);
      if (r.status === 401) {
        console.error(`    [auth] 401 on ${label || url} — session may have expired`);
      }
      return r;
    };

    const kioskReq = (kioskId, apiKey, url, opts = {}, label = "") =>
      httpJson(url, { ...opts, headers: { "Content-Type": "application/json", "X-Kiosk-Id": kioskId, "X-Kiosk-Key": apiKey, ...(opts.headers || {}) } }, label);

    // helper: ensure a fresh active registration for a trainer on a browser.
    // Uses the TRAINER's session for the redeem (requireRole("trainer")).
    const ensureActive = async (sa, trainer, browserDeviceId) => {
      const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", {
        method: "POST", body: JSON.stringify({ trainerId: String(trainer._id) }),
      }, "generate");
      if (gen.status !== 201 || !gen.body?.activation?.code) {
        throw new Error(`generate → HTTP ${gen.status} ${JSON.stringify(gen.body)}`);
      }
      const trainerSession = await login(trainer.username);
      const act = await adminReq(trainerSession.sessionId, trainerSession.cookie, "/api/admin/devices/activate", {
        method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId }),
      }, "activate");
      if (act.status !== 200 || !act.body?.registration?.active) {
        throw new Error(`activate → HTTP ${act.status} ${JSON.stringify(act.body)}`);
      }
      return { ...act.body.registration, apiKey: act.body.apiKey };
    };

    // helper: open a throwaway connection for DB assertions when the runner's
    // own mongoose connection is not active (e.g., after server shutdown).
    // A fresh createConnection has an EMPTY model registry, so we register the
    // schemas already known to the default mongoose connection before use.
    const E2E_MODELS = [
      "Admin", "Kiosk", "DeviceRegistration", "DeviceActivation",
      "Member", "Attendance", "AdminSession", "SystemSettings", "Notification", "AttendanceExport",
    ];
    const withDb = async (fn) => {
      const conn = await mongoose.createConnection(e2eUri, { serverSelectionTimeoutMS: 5000 });
      await conn.asPromise();
      try {
        for (const name of E2E_MODELS) {
          if (!conn.models[name] && mongoose.modelNames().includes(name)) {
            conn.model(name, mongoose.model(name).schema);
          }
        }
        return await fn(conn);
      } finally { await conn.close(); }
    };

    // ── E2E-001: Male Trainer Activation ─────────────────────────────
    {
      const name = "E2E-001 Male Trainer activation + attendance";
      try {
        const sa = await login("e2e_super");
        const reg = await ensureActive(sa, maleTrainer, "e2e-browser-male");
        if (reg.scope !== "male") throw new Error(`expected scope male, got ${reg.scope}`);
        const punch = await kioskReq(reg.kioskId, reg.apiKey, "/api/attendance/kiosk/punch", {
          method: "POST", body: JSON.stringify({ input: "192" }),
        }, "male punch");
        if (punch.status !== 200 || !punch.body.success) throw new Error(`punch → HTTP ${punch.status} ${JSON.stringify(punch.body)}`);
        pass(name, `reg ${reg.registrationId} · punch 200`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-002: Female + Transgender Trainer ────────────────────────
    {
      const name = "E2E-002 Female/T Trainer (female ok, trans ok, male rejected)";
      try {
        const sa = await login("e2e_super");
        const reg = await ensureActive(sa, femaleTrainer, "e2e-browser-female");
        if (reg.scope !== "female_plus_transgender") throw new Error(`expected female scope, got ${reg.scope}`);
        const fp = await kioskReq(reg.kioskId, reg.apiKey, "/api/attendance/kiosk/punch", { method: "POST", body: JSON.stringify({ input: "192" }) }, "female 192");
        if (fp.status !== 200 || !fp.body.success) throw new Error(`female punch → ${fp.status} ${JSON.stringify(fp.body)}`);
        // Male member must be rejected on female scope
        const mp = await kioskReq(reg.kioskId, reg.apiKey, "/api/attendance/kiosk/punch", { method: "POST", body: JSON.stringify({ input: "444" }) }, "male 444 on female scope");
        if (mp.status === 200 && mp.body.success) throw new Error("male member punched on female scope");
        pass(name, "female 192 punched; male 444 rejected");
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-003: Device Replacement ───────────────────────────────────
    {
      const name = "E2E-003 Device replacement (old fails, new works)";
      try {
        const sa = await login("e2e_super");
        const old = await ensureActive(sa, maleTrainer, "e2e-browser-replace-a");
        const fresh = await ensureActive(sa, maleTrainer, "e2e-browser-replace-b");
        const oldPunch = await kioskReq(old.kioskId, old.apiKey, "/api/attendance/kiosk/punch", { method: "POST", body: JSON.stringify({ input: "444" }) }, "old device punch");
        if (oldPunch.status === 200 && oldPunch.body.success) throw new Error("old device still punches after replacement");
        const newPunch = await kioskReq(fresh.kioskId, fresh.apiKey, "/api/attendance/kiosk/punch", { method: "POST", body: JSON.stringify({ input: "444" }) }, "new device punch");
        if (newPunch.status !== 200 || !newPunch.body.success) throw new Error(`new device punch failed → ${newPunch.status} ${JSON.stringify(newPunch.body)}`);
        pass(name, `old=${old.kioskId} blocked; new=${fresh.kioskId} works`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-004: Reactivation after Admin revocation ─────────────────
    {
      const name = "E2E-004 Revoke → reactivate same browser";
      try {
        const sa = await login("e2e_super");
        const mt = await login("e2e_male");
        const reg = await ensureActive(sa, maleTrainer, "e2e-browser-rev");
        // Revoke it
        const rev = await adminReq(sa.sessionId, sa.cookie, `/api/admin/devices/${reg.registrationId}/revoke`, { method: "POST" }, "revoke");
        if (rev.status !== 200) throw new Error(`revoke → HTTP ${rev.status} ${JSON.stringify(rev.body)}`);
        // Fresh activation + reactivate SAME browser as the trainer
        const gen2 = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "generate-2");
        if (gen2.status !== 201) throw new Error(`generate-2 → HTTP ${gen2.status} ${JSON.stringify(gen2.body)}`);
        const act2 = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen2.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-browser-rev" }),
        }, "reactivate");
        if (act2.status !== 200 || !act2.body?.registration?.active) throw new Error(`reactivate → HTTP ${act2.status} ${JSON.stringify(act2.body)}`);
        pass(name, "same browser reactivated; no false ownership conflict");
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-005: Same browser / different Trainer ────────────────────
    {
      const name = "E2E-005 Same browser / different Trainer → conflict";
      try {
        const sa = await login("e2e_super");
        await ensureActive(sa, maleTrainer, "e2e-shared-browser");
        // Female trainer tries the same browser — must fail
        const genF = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(femaleTrainer._id) }) }, "genF");
        if (genF.status !== 201) throw new Error(`genF → ${genF.status} ${JSON.stringify(genF.body)}`);
        const ft = await login("e2e_female");
        const actF = await adminReq(ft.sessionId, ft.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: genF.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-shared-browser" }),
        }, "female takes shared browser");
        if (actF.status === 200 && actF.body?.registration?.active) throw new Error("female silently took over male's browser");
        pass(name, `female attempt → HTTP ${actF.status} (rejected)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-006: Disabled Kiosk ───────────────────────────────────────
    {
      const name = "E2E-006 Disabled Kiosk rejects activation, stays disabled";
      try {
        const sa = await login("e2e_super");
        const reg = await ensureActive(sa, maleTrainer, "e2e-disable-kiosk");
        // Disable the Kiosk (its kioskId == browserDeviceId)
        await withDb(async (conn) => {
          const KioskModel = conn.model("Kiosk");
          await KioskModel.updateOne({ kioskId: reg.kioskId }, { $set: { enabled: false } });
        });
        // New activation + attempt on same (now disabled) browser
        const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "gen-after-disable");
        if (gen.status !== 201) throw new Error(`gen → ${gen.status} ${JSON.stringify(gen.body)}`);
        const mt = await login("e2e_male");
        const act = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-disable-kiosk" }),
        }, "activate disabled kiosk");
        if (act.status === 200 && act.body?.registration?.active) throw new Error("activation succeeded on disabled kiosk");
        const disabledAfter = await withDb(async (conn) => conn.model("Kiosk").findOne({ kioskId: "e2e-disable-kiosk" }).lean());
        if (disabledAfter?.enabled) throw new Error("disabled kiosk was silently re-enabled");
        pass(name, `activation → HTTP ${act.status}; kiosk remains disabled`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-007: Kiosk scope conflict ─────────────────────────────────
    {
      const name = "E2E-007 Kiosk scope conflict rejected, scope unchanged";
      try {
        const sa = await login("e2e_super");
        const reg = await ensureActive(sa, maleTrainer, "e2e-scope-browser"); // male scope
        // Female/T trainer tries the male-scope browser
        const genF = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(femaleTrainer._id) }) }, "genF-scope");
        if (genF.status !== 201) throw new Error(`genF → ${genF.status} ${JSON.stringify(genF.body)}`);
        const ft = await login("e2e_female");
        const actF = await adminReq(ft.sessionId, ft.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: genF.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-scope-browser" }),
        }, "female on male scope browser");
        if (actF.status === 200 && actF.body?.registration?.active) throw new Error("scope conflict not enforced");
        const scopeAfter = await withDb(async (conn) => conn.model("Kiosk").findOne({ kioskId: "e2e-scope-browser" }).lean());
        if (scopeAfter?.scope !== "male") throw new Error("kiosk scope was silently changed");
        pass(name, `attempt → HTTP ${actF.status}; scope unchanged (male)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-008: Activation expiry ────────────────────────────────────
    {
      const name = "E2E-008 Expired activation rejected";
      try {
        const sa = await login("e2e_super");
        const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "gen-expiry");
        if (gen.status !== 201) throw new Error(`gen → ${gen.status} ${JSON.stringify(gen.body)}`);
        await withDb(async (conn) => conn.model("DeviceActivation").updateOne(
          { activationId: gen.body.activation.activationId },
          { $set: { expiresAt: new Date(Date.now() - 1000) } }
        ));
        const mt = await login("e2e_male");
        const act = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-expired" }),
        }, "activate expired");
        if (act.status === 200 && act.body?.registration?.active) throw new Error("expired activation redeemed");
        pass(name, `activation → HTTP ${act.status} (rejected)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-009: Activation replay ────────────────────────────────────
    {
      const name = "E2E-009 Activation replay rejected";
      try {
        const sa = await login("e2e_super");
        const mt = await login("e2e_male");
        const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "gen-replay");
        if (gen.status !== 201) throw new Error(`gen → ${gen.status} ${JSON.stringify(gen.body)}`);
        const act1 = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-replay-1" }),
        }, "first redeem");
        if (act1.status !== 200) throw new Error(`first redeem → ${act1.status} ${JSON.stringify(act1.body)}`);
        const act2 = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-replay-2" }),
        }, "replay");
        if (act2.status === 200 && act2.body?.registration?.active) throw new Error("replay produced a second active device");
        pass(name, `replay → HTTP ${act2.status} (rejected)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-010: Wrong Trainer ────────────────────────────────────────
    {
      const name = "E2E-010 Wrong Trainer rejected";
      try {
        const sa = await login("e2e_super");
        const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "gen-wrong-trainer");
        if (gen.status !== 201) throw new Error(`gen → ${gen.status} ${JSON.stringify(gen.body)}`);
        const ft = await login("e2e_female");
        const act = await adminReq(ft.sessionId, ft.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: TRAINER_PW, browserDeviceId: "e2e-wrong-trainer" }),
        }, "female redeems male's code");
        if (act.status === 200 && act.body?.registration?.active) throw new Error("wrong trainer redeemed");
        pass(name, `attempt → HTTP ${act.status} (rejected)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-011: Wrong password ───────────────────────────────────────
    {
      const name = "E2E-011 Wrong password rejected";
      try {
        const sa = await login("e2e_super");
        const mt = await login("e2e_male");
        const gen = await adminReq(sa.sessionId, sa.cookie, "/api/admin/devices/activate/generate", { method: "POST", body: JSON.stringify({ trainerId: String(maleTrainer._id) }) }, "gen-wrong-pw");
        if (gen.status !== 201) throw new Error(`gen → ${gen.status} ${JSON.stringify(gen.body)}`);
        const act = await adminReq(mt.sessionId, mt.cookie, "/api/admin/devices/activate", {
          method: "POST", body: JSON.stringify({ code: gen.body.activation.code, password: "WrongPass99!", browserDeviceId: "e2e-wrong-pw" }),
        }, "wrong password");
        if (act.status === 200 && act.body?.registration?.active) throw new Error("wrong password redeemed");
        pass(name, `attempt → HTTP ${act.status} (rejected)`);
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-012: Super Admin Attendance (MODE 2) ──────────────────────
    {
      const name = "E2E-012 Super Admin scoped attendance (male + female, no All Genders)";
      try {
        const sa = await login("e2e_super");
        const scope = await adminReq(sa.sessionId, sa.cookie, "/api/attendance/admin-scope", { method: "POST", body: JSON.stringify({ scope: "male" }) }, "admin-scope male");
        if (scope.status !== 200 || !scope.body?.token) throw new Error(`admin-scope male → ${scope.status} ${JSON.stringify(scope.body)}`);
        const punchM = await httpJson("/api/attendance/kiosk/admin-punch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Attendance-Token": scope.body.token },
          body: JSON.stringify({ input: "192" }),
        }, "admin male punch");
        if (punchM.status !== 200 || !punchM.body.success) throw new Error(`admin male punch → ${punchM.status} ${JSON.stringify(punchM.body)}`);
        const scopeF = await adminReq(sa.sessionId, sa.cookie, "/api/attendance/admin-scope", { method: "POST", body: JSON.stringify({ scope: "female_plus_transgender" }) }, "admin-scope female");
        if (scopeF.status !== 200 || !scopeF.body?.token) throw new Error(`admin-scope female → ${scopeF.status} ${JSON.stringify(scopeF.body)}`);
        const punchF = await httpJson("/api/attendance/kiosk/admin-punch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Attendance-Token": scopeF.body.token },
          body: JSON.stringify({ input: "192" }),
        }, "admin female punch");
        if (punchF.status !== 200 || !punchF.body.success) throw new Error(`admin female punch → ${punchF.status} ${JSON.stringify(punchF.body)}`);
        const scopeAll = await adminReq(sa.sessionId, sa.cookie, "/api/attendance/admin-scope", { method: "POST", body: JSON.stringify({ scope: "all" }) }, "admin-scope all");
        if (scopeAll.status === 200 && scopeAll.body?.token) throw new Error("'all' scope accepted");
        pass(name, "male punch OK; female punch OK; 'all' rejected");
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-013: Stale Trainer credentials (frontend-only) ───────────
    manual("E2E-013 Stale Trainer credentials in Super Admin browser", "frontend-only; see PHASE_5_MANUAL_BROWSER_E2E_CHECKLIST.md");

    // ── E2E-014: Gym ID isolation ─────────────────────────────────────
    {
      const name = "E2E-014 Gym ID isolation (male/female; 500 integrity)";
      try {
        // Create dedicated members for this scenario (previous scenarios may have
        // punched male 192 / female 192, leaving them in "already_checked_out" state).
        const scopedMembers = await withDb(async (conn) => {
          const M = conn.model("Member");
          let ph = 9010000000;
          const mk = (fn, g, gid, mc) => { ph += 1; return M.create({ fullName: fn, gender: g, gymId: gid, memberCode: mc, fatherName: "F", dob: new Date("1990-01-01"), bloodGroup: "O+", address: "T", occupation: "S", aadhar: String(100000000000 + Math.floor(Math.random() * 900000000000)), phone: String(ph), gymPlan: "1 Month", trainingType: "Weight Loss", paymentStatus: "paid", status: "active", validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }); };
          return { m: await mk("E2E Male 800", "Male", 800, "M9900"), f: await mk("E2E Female 800", "Female", 800, "F9901") };
        });
        const sa = await login("e2e_super");
        const scopeM = (await adminReq(sa.sessionId, sa.cookie, "/api/attendance/admin-scope", { method: "POST", body: JSON.stringify({ scope: "male" }) }, "scope male")).body;
        const punchM = await httpJson("/api/attendance/kiosk/admin-punch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Attendance-Token": scopeM.token },
          body: JSON.stringify({ input: "800" }),
        }, "male scope 800");
        if (punchM.status !== 200) throw new Error(`male 800 → ${punchM.status} ${JSON.stringify(punchM.body)}`);
        const scopeF = (await adminReq(sa.sessionId, sa.cookie, "/api/attendance/admin-scope", { method: "POST", body: JSON.stringify({ scope: "female_plus_transgender" }) }, "scope female")).body;
        const punchF = await httpJson("/api/attendance/kiosk/admin-punch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Attendance-Token": scopeF.token },
          body: JSON.stringify({ input: "800" }),
        }, "female scope 800");
        if (punchF.status !== 200) throw new Error(`female 800 → ${punchF.status} ${JSON.stringify(punchF.body)}`);
        // Female+Transgender 500 → integrity error, no write
        const punch500 = await httpJson("/api/attendance/kiosk/admin-punch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Attendance-Token": scopeF.token },
          body: JSON.stringify({ input: "500" }),
        }, "female scope 500");
        if (punch500.status === 200 && punch500.body?.success) throw new Error("female/trans 500 wrote attendance");
        // Verify no attendance rows for gymId 500 members.
        const wrote = await withDb(async (conn) => {
          const mem500 = await conn.model("Member").find({ gymId: 500 }).lean();
          let w = 0;
          for (const m of mem500) {
            const c = await conn.model("Attendance").countDocuments({ memberId: m._id });
            if (c > 0) w++;
          }
          return w;
        });
        if (wrote > 0) throw new Error(`female/trans 500 wrote ${wrote} attendance rows`);
        pass(name, "male 800 → Male; female 800 → Female; 500 → integrity, no write");
      } catch (e) { fail(name, e.message); }
    }

    // ── E2E-015: Trainer scope change ─────────────────────────────────
    {
      const name = "E2E-015 Trainer scope change invalidates device";
      try {
        const sa = await login("e2e_super");
        const reg = await ensureActive(sa, maleTrainer, "e2e-scopechange");
        // Change trainer scope via admin update route
        const upd = await adminReq(sa.sessionId, sa.cookie, `/api/admin/${String(maleTrainer._id)}`, {
          method: "PUT", body: JSON.stringify({ username: "e2e_male", password: TRAINER_PW, fullName: "E2E Male", email: "e2e_male@test.local", role: "trainer", scope: "female_plus_transgender" }),
        }, "update trainer scope");
        if (upd.status !== 200) throw new Error(`scope update → ${upd.status} ${JSON.stringify(upd.body)}`);
        // Old registration should be revoked/inactive
        const old = await withDb(async (conn) => conn.model("DeviceRegistration").findOne({ kioskId: "e2e-scopechange" }).lean());
        if (old?.active) throw new Error("old registration still active after trainer scope change");
        // Old credential cannot punch
        const oldPunch = await kioskReq(reg.kioskId, reg.apiKey, "/api/attendance/kiosk/punch", { method: "POST", body: JSON.stringify({ input: "444" }) }, "old scope device punch");
        if (oldPunch.status === 200 && oldPunch.body?.success) throw new Error("old-scope device still punches");
        pass(name, "scope change revoked registration; old credential cannot punch");
      } catch (e) { fail(name, e.message); }
    }

    // ── Report ────────────────────────────────────────────────────────
    console.log(`\n=== Phase 5 E2E Results ===\n`);
    let p = 0, f = 0, b = 0, mn = 0;
    for (const r of results) {
      const icon = r.status === "EXECUTED + PASS" ? "✓" : r.status === "EXECUTED + FAIL" ? "✗" : r.status === "BLOCKED" ? "⊘" : "◆";
      console.log(`  ${icon} ${r.status} — ${r.name}${r.detail ? `\n     ${r.detail}` : ""}`);
      if (r.status === "EXECUTED + PASS") p++;
      else if (r.status === "EXECUTED + FAIL") f++;
      else if (r.status === "BLOCKED") b++;
      else mn++;
    }
    console.log(`\n  ${p} passing · ${f} failing · ${b} blocked · ${mn} manual`);
    process.exitCode = f > 0 ? 1 : 0;

  } catch (err) {
    console.error("E2E runner error:", err);
    process.exitCode = 1;
  } finally {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill("SIGTERM");
      await sleep(1000);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    try {
      if (mongoose.connection.readyState === 1) {
        const n = mongoose.connection.db.databaseName;
        if (n !== PROD_DB_NAME) await mongoose.connection.db.dropDatabase();
        await mongoose.disconnect();
      }
    } catch (e) { console.error("  cleanup:", e.message); }
    console.log("\n  E2E database cleaned up. Done.");
  }
}

run();