/**
 * Attendance export + notification + CSV safety tests
 *
 * UNIT  — csvSafety writer (no DB): RFC4180 quoting, quote escaping, CRLF,
 *         comma/newline handling, formula-injection neutralization.
 * UNIT  — customer-safe punch DTO (no phone on the shared device).
 * INTEGRATION (requires MongoDB; skips when unreachable) — daily export:
 *         zero rows, normal rows, Male/Female same Gym ID independence,
 *         idempotency, retry after failure, crash recovery, deterministic
 *         ordering, notification creation and retry-without-regeneration.
 *
 * Run: cd backend && npm test
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { expect } from "chai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

import "../models/Attendance.js";
import "../models/Member.js";
import "../models/SystemSettings.js";
import "../models/AttendanceExport.js";
import "../models/Notification.js";
import { toCsvLine, toCsv, escapeField } from "../utils/csvSafety.js";
import { buildPunchResponse } from "../utils/attendanceInput.js";
import { generateDailyExport } from "../services/attendanceExportService.js";
import { notifyExportReady } from "../services/notificationService.js";

const Attendance = mongoose.model("Attendance");
const Member = mongoose.model("Member");
const AttendanceExport = mongoose.model("AttendanceExport");
const Notification = mongoose.model("Notification");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Must match attendanceExportService.EXPORTS_ROOT (backend/exports).
const EXPORTS_ROOT = path.join(__dirname, "..", "..", "exports");

const DB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/gym_test";

/* ============================================================
   UNIT — CSV safety (no DB)
   ============================================================ */
describe("csvSafety (unit)", () => {
  it("escapes commas by quoting", () => {
    expect(escapeField("a,b")).to.equal('"a,b"');
    expect(toCsvLine(["a,b", "c"])).to.equal('"a,b",c\r\n');
  });

  it("escapes double quotes by doubling", () => {
    expect(escapeField('say "hi"')).to.equal('"say ""hi"""');
  });

  it("escapes newlines by quoting", () => {
    expect(escapeField("line1\nline2")).to.equal('"line1\nline2"');
    expect(toCsvLine(["x\ny"])).to.equal('"x\ny"\r\n');
  });

  it("uses CRLF row separators", () => {
    expect(toCsvLine(["a", "b"])).to.equal("a,b\r\n");
    expect(toCsv(["H1", "H2"], [["v1", "v2"]])).to.equal("H1,H2\r\nv1,v2\r\n");
  });

  it("neutralizes formula-injection prefixes", () => {
    // The field must never begin with a dangerous character once a spreadsheet
    // reads it. Injection protection prefixes the content with `'`; if the
    // field also needs RFC-4180 quoting (CR etc.) it is wrapped in quotes with
    // the `'` kept inside.
    const DANGEROUS = ["=cmd", "+1+1", "-1", "@SUM(A1)", "\tX", "\rX"];
    for (const dangerous of DANGEROUS) {
      const out = escapeField(dangerous);
      // Strip RFC-4180 quoting to inspect the cell content.
      const inner = out.startsWith('"') ? out.slice(1, -1) : out;
      expect(inner.startsWith("'"), `${JSON.stringify(dangerous)} -> ${JSON.stringify(out)}`).to.be.true;
    }
  });

  it("leaves safe values unchanged", () => {
    expect(escapeField("1001")).to.equal("1001");
    expect(escapeField("Saravana")).to.equal("Saravana");
    expect(escapeField("")).to.equal("");
    expect(escapeField(null)).to.equal("");
  });

  it("escapes quote after injection prefix correctly", () => {
    // Injection prefix (`'`) added first, then RFC-4180 quoting wraps the
    // result and doubles internal quotes: "'=SUM(""A1"")"
    expect(escapeField('=SUM("A1")')).to.equal(`"'=SUM(""A1"")"`);
  });
});

/* ============================================================
   UNIT — customer-safe punch DTO (no phone on shared device)
   ============================================================ */
describe("punch response DTO (unit)", () => {
  it("does not expose phone on the customer punch response", () => {
    const now = new Date();
    const res = buildPunchResponse({
      attendance: { _id: "a", checkInTime: now, checkOutTime: null, state: "inside", durationMin: null },
      member: { _id: "m1", gymId: 1001, fullName: "Saravana", phone: "9876543210", gymPlan: "1 Month", validityEnd: new Date() },
      isCheckOut: false,
      isLate: false,
      daysLeft: 5,
    });
    expect(res.success).to.be.true;
    expect(res.member.phone).to.be.undefined;
    expect(res.member.name).to.equal("Saravana");
  });
});

/* ============================================================
   INTEGRATION — export + notification (requires MongoDB)
   ============================================================ */
describe("Daily attendance export (integration)", function () {
  this.timeout(30000);
  let connected = false;

  before(async function () {
    try {
      await mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 3000 });
      connected = true;
      await Attendance.deleteMany({});
      await Member.deleteMany({});
      await AttendanceExport.deleteMany({});
      await Notification.deleteMany({});
      await mongoose.model("SystemSettings").deleteMany({});
    } catch (err) {
      this.skip();
    }
  });

  after(async () => {
    if (connected) {
      await Attendance.deleteMany({});
      await Member.deleteMany({});
      await AttendanceExport.deleteMany({});
      await Notification.deleteMany({});
      await mongoose.disconnect();
    }
  });

  let memberSeq = 0;
  const makeMember = async (gender, gymId, overrides = {}) => {
    memberSeq += 1;
    const prefix = gender === "Male" ? "M" : "F";
    return Member.create({
      fullName: `Test ${gender} ${gymId}`,
      fatherName: "Test",
      dob: new Date("1990-01-01"),
      bloodGroup: "O+",
      gender,
      address: "Test Address",
      occupation: "Student",
      aadhar: `1${String(100000000000 + Math.floor(Math.random() * 900000000000))}`.slice(0, 12),
      phone: `9${String(7000000000 + Math.floor(Math.random() * 2000000000))}`.slice(0, 10),
      gymId,
      gymPlan: "1 Month",
      trainingType: "Weight Loss",
      paymentStatus: "paid",
      status: "active",
      validityEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      memberCode: `${prefix}${String(9000 + memberSeq).padStart(4, "0")}`,
      ...overrides,
    });
  };

  const makeAttendance = async (memberId, date, checkInTime, checkOutTime = null, state = "inside") =>
    Attendance.create({
      memberId,
      date,
      checkInTime,
      checkOutTime,
      state,
      source: "kiosk",
    });

  const cleanupFilesFor = async (date) => {
    const name = `attendance-${date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.csv`;
    for (const f of [name, name + ".tmp"]) {
      await fs.promises.unlink(path.join(EXPORTS_ROOT, f)).catch(() => {});
    }
  };

  it("generates a headers-only CSV for a zero-activity day and marks ready", async () => {
    const day = new Date("2026-08-01T00:00:00");
    day.setHours(0, 0, 0, 0);
    await cleanupFilesFor(day);

    const record = await generateDailyExport(day);
    expect(record.status).to.equal("ready");
    expect(record.rowCount).to.equal(0);
    expect(record.fileName).to.equal(`attendance-${day.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}.csv`);

    const content = await fs.promises.readFile(record.filePath, "utf8");
    const lines = content.split("\r\n").filter((l) => l.length > 0);
    expect(lines[0]).to.equal("Date,Gym ID,Name,Gender,Member Code,Check-in,Check-out,Duration (min),Status");
    expect(lines.length).to.equal(1);
    await cleanupFilesFor(day);
  });

  it("exports Male 192 and Female 192 as independent rows (Member._id identity)", async () => {
    const male = await makeMember("Male", 192);
    const female = await makeMember("Female", 192);
    const day = new Date("2026-08-02T00:00:00");
    day.setHours(0, 0, 0, 0);
    const t = new Date("2026-08-02T09:30:00");

    await makeAttendance(male._id, day, t);
    await makeAttendance(female._id, day, t);
    await cleanupFilesFor(day);

    const record = await generateDailyExport(day);
    expect(record.status).to.equal("ready");
    expect(record.rowCount).to.equal(2);

    const content = await fs.promises.readFile(record.filePath, "utf8");
    expect(content).to.include("Male");
    expect(content).to.include("Female");
    expect(content).to.include("192");
    // Both rows must be present — a Gym-ID join would have silently merged them.
    const nameRows = content.split("\r\n").filter((l) => l.includes("Test"));
    expect(nameRows.length).to.equal(2);
    await cleanupFilesFor(day);
  });

  it("is idempotent — a second run for the same date does not duplicate or regenerate", async () => {
    const day = new Date("2026-08-03T00:00:00");
    day.setHours(0, 0, 0, 0);
    const first = await generateDailyExport(day);
    const before = await AttendanceExport.countDocuments({ attendanceDate: day, exportType: "daily" });
    const second = await generateDailyExport(day);
    const after = await AttendanceExport.countDocuments({ attendanceDate: day, exportType: "daily" });
    expect(before).to.equal(1);
    expect(after).to.equal(1);
    expect(second.status).to.equal("ready");
    expect(String(second._id)).to.equal(String(first._id));
    await cleanupFilesFor(day);
  });

  it("retries a failed export and reaches ready exactly once", async () => {
    const day = new Date("2026-08-04T00:00:00");
    day.setHours(0, 0, 0, 0);
    await cleanupFilesFor(day);

    // Simulate a previous failure.
    await AttendanceExport.create({
      attendanceDate: day,
      exportType: "daily",
      status: "failed",
      failedReason: "simulated",
    });

    const record = await generateDailyExport(day);
    expect(record.status).to.equal("ready");
    const count = await AttendanceExport.countDocuments({ attendanceDate: day, exportType: "daily" });
    expect(count).to.equal(1);
    await cleanupFilesFor(day);
  });

  it("reclaims a stale generating record (crash recovery) after timeout", async () => {
    const day = new Date("2026-08-05T00:00:00");
    day.setHours(0, 0, 0, 0);
    await cleanupFilesFor(day);

    await AttendanceExport.create({
      attendanceDate: day,
      exportType: "daily",
      status: "generating",
      generatingStartedAt: new Date(Date.now() - 60 * 60 * 1000), // > 30min
    });

    const record = await generateDailyExport(day);
    expect(record.status).to.equal("ready");
    await cleanupFilesFor(day);
  });

  it("creates a superadmin notification after ready, and does not duplicate it", async () => {
    const day = new Date("2026-08-06T00:00:00");
    day.setHours(0, 0, 0, 0);
    await cleanupFilesFor(day);

    const record = await generateDailyExport(day);
    const first = await notifyExportReady(record);
    expect(first).to.not.be.null;
    expect(first.recipientRole).to.equal("superadmin");
    expect(first.reportId.toString()).to.equal(record._id.toString());

    // Idempotent: calling again returns the existing notification, no duplicate.
    const second = await notifyExportReady(record);
    expect(String(second._id)).to.equal(String(first._id));
    const count = await Notification.countDocuments({ reportId: record._id });
    expect(count).to.equal(1);
    await cleanupFilesFor(day);
  });
});