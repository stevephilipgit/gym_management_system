import mongoose from "mongoose";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { fileURLToPath } from "url";
import { toCsvLine } from "../utils/csvSafety.js";
import logger from "../core/logger.js";

const Attendance = mongoose.model("Attendance");
const Member = mongoose.model("Member");
const AttendanceExport = mongoose.model("AttendanceExport");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Export storage lives OUTSIDE the statically-served /uploads tree so reports
// are never publicly downloadable. server.js mounts express.static on
// /uploads; this directory is reachable only through the authenticated
// download endpoint. Must be a persistent volume in Docker/VM deployments.
const EXPORTS_ROOT = path.join(__dirname, "..", "..", "exports");
const CHUNK_SIZE = 500;

const CSV_HEADER = [
  "Date",
  "Gym ID",
  "Name",
  "Gender",
  "Member Code",
  "Check-in",
  "Check-out",
  "Duration (min)",
  "Status",
];

function formatDate(d) {
  if (!d) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function formatTime(d) {
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusLabel(state) {
  switch (state) {
    case "inside":
      return "Inside";
    case "completed":
      return "Completed";
    case "auto_closed":
      return "Auto-closed";
    case "late":
      return "Late";
    default:
      return state || "";
  }
}

function buildRow(att, member) {
  const name = member?.fullName || "";
  const gymId = member?.gymId ?? "";
  const gender = member?.gender || "";
  const memberCode = member?.memberCode || "";
  return [
    formatDate(att.date),
    String(gymId),
    name,
    gender,
    memberCode,
    formatTime(att.checkInTime),
    formatTime(att.checkOutTime),
    att.durationMin != null ? String(att.durationMin) : "",
    statusLabel(att.state),
  ];
}

/**
 * Generate the previous day's attendance CSV and persist it.
 * Idempotent: if the export is already `ready`, does nothing.
 * On failure: marks `failed` with reason; cleans temp files.
 */
export async function generateDailyExport(attendanceDate, clock = new Date()) {
  const normalizedDate = new Date(attendanceDate);
  normalizedDate.setHours(0, 0, 0, 0);

  // ── 1. Idempotent claim ──────────────────────────────────────────────────
  let record = await AttendanceExport.findOne({
    attendanceDate: normalizedDate,
    exportType: "daily",
  });

  if (!record) {
    record = await AttendanceExport.create({
      attendanceDate: normalizedDate,
      exportType: "daily",
      status: "generating",
      generatingStartedAt: clock,
    });
  } else {
    if (record.status === "ready") {
      logger.info(`Export already ready for ${formatDate(normalizedDate)}`);
      return record;
    }
    // Crash recovery: a `generating` record older than the safety timeout is
    // reclaimed so the next run retries it. A live run always finishes well
    // within the timeout, so this never steals work from an active generator.
    const STALE_GENERATING_MS = 30 * 60 * 1000;
    if (record.status === "generating" && record.generatingStartedAt) {
      const started = new Date(record.generatingStartedAt).getTime();
      if (clock.getTime() - started > STALE_GENERATING_MS) {
        logger.warn(`Reclaiming stale generating export for ${formatDate(normalizedDate)}`);
        await AttendanceExport.updateOne(
          { _id: record._id },
          { $set: { status: "pending", generatingStartedAt: null } }
        );
        record = await AttendanceExport.findById(record._id);
      }
    }
    const claimed = await AttendanceExport.findOneAndUpdate(
      { _id: record._id, status: { $in: ["pending", "failed"] } },
      { $set: { status: "generating", generatingStartedAt: clock, failedReason: null } },
      { new: true }
    );
    if (!claimed) {
      logger.info(`Export claim lost for ${formatDate(normalizedDate)} — another instance is generating`);
      return record;
    }
    record = claimed;
  }

  // ── 2. Date range ────────────────────────────────────────────────────────
  const dayStart = new Date(normalizedDate);
  const dayEnd = new Date(normalizedDate);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const result = await generateFile(record, dayStart, dayEnd, normalizedDate);
    return result;
  } catch (error) {
    // Clean up any partial temp file before marking failed.
    const fileName = `attendance-${formatDate(normalizedDate)}.csv`;
    await fsp.unlink(path.join(EXPORTS_ROOT, fileName + ".tmp")).catch(() => {});
    await AttendanceExport.updateOne(
      { _id: record._id },
      {
        $set: {
          status: "failed",
          failedReason: error.message,
          generatingStartedAt: null,
        },
      }
    );
    logger.error(`Daily export failed for ${formatDate(normalizedDate)}`, { error: error.message });
    throw error;
  }
}

async function generateFile(record, dayStart, dayEnd, normalizedDate) {
  // ── 3. Ensure exports directory ──────────────────────────────────────────
  await fsp.mkdir(EXPORTS_ROOT, { recursive: true });

  const fileName = `attendance-${formatDate(normalizedDate)}.csv`;
  const tmpPath = path.join(EXPORTS_ROOT, fileName + ".tmp");
  const finalPath = path.join(EXPORTS_ROOT, fileName);

  // ── 4. Stream attendance rows ────────────────────────────────────────────
  const cursor = Attendance.find({
    date: { $gte: dayStart, $lt: dayEnd },
  })
    .select("memberId date checkInTime checkOutTime durationMin state")
    .sort({ date: 1, checkInTime: 1, _id: 1 })
    .cursor();

  let rowCount = 0;
  const writeStream = fs.createWriteStream(tmpPath, { encoding: "utf8" });
  const writeLine = (line) =>
    new Promise((resolve, reject) => {
      writeStream.write(line, (err) => (err ? reject(err) : resolve()));
    });

  writeStream.write(toCsvLine(CSV_HEADER));

  let batch = [];
  for await (const att of cursor) {
    batch.push(att);
    if (batch.length >= CHUNK_SIZE) {
      await flushBatch(batch, writeLine);
      rowCount += batch.length;
      batch = [];
    }
  }
  if (batch.length > 0) {
    await flushBatch(batch, writeLine);
    rowCount += batch.length;
  }

  await new Promise((resolve, reject) => {
    writeStream.on("error", reject);
    writeStream.end(resolve);
  });

  // ── 5. Integrity check ───────────────────────────────────────────────────
  const stat = await fsp.stat(tmpPath).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw new Error("Generated CSV is empty or missing");
  }

  // ── 6. Atomically rename ─────────────────────────────────────────────────
  await fsp.rename(tmpPath, finalPath);

  // ── 7. Mark ready ────────────────────────────────────────────────────────
  record = await AttendanceExport.findOneAndUpdate(
    { _id: record._id },
    {
      $set: {
        status: "ready",
        fileName,
        filePath: finalPath,
        rowCount,
        fileSize: stat.size,
        generatingStartedAt: null,
      },
    },
    { new: true }
  );

  logger.info(`Daily export ready: ${fileName} (${rowCount} rows, ${stat.size} bytes)`);
  return record;
}

async function flushBatch(batch, writeLine) {
  const memberIds = [...new Set(batch.map((a) => String(a.memberId)))];
  const members = memberIds.length > 0
    ? await Member.find({ _id: { $in: memberIds } })
        .select("gymId fullName gender memberCode")
        .lean()
    : [];
  const memberMap = {};
  for (const m of members) {
    memberMap[String(m._id)] = m;
  }

  for (const att of batch) {
    const member = memberMap[String(att.memberId)] || null;
    writeLine(toCsvLine(buildRow(att, member)));
  }
}

/** Export storage root path — used by the download controller to resolve files. */
export { EXPORTS_ROOT, CSV_HEADER };