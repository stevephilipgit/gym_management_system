// To enable: set REMINDER_JOB_CONFIG.enabled = true
// To schedule: add to crontab → 0 9 * * * node jobs/reminderAgent.js
// This job ONLY prepares data — it never sends messages automatically

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { executeTool } from "../services/ai/toolExecutor.js";
import { prepareRemindersWithMessages } from "../services/ai/reminderService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REMINDER_JOB_CONFIG = {
  enabled: false,
  daysAhead: 3,
  maxMembers: 20,
  logPath: "./logs/reminderAgent.log",
};

const logLine = (level, message) => {
  const fullPath = path.resolve(__dirname, "../../", REMINDER_JOB_CONFIG.logPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.appendFileSync(fullPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
};

export const runReminderJob = async () => {
  if (!REMINDER_JOB_CONFIG.enabled) {
    logLine("INFO", "Job disabled");
    return null;
  }

  logLine("INFO", "Reminder job started");
  const result = await executeTool("getExpiringMembers", { days: REMINDER_JOB_CONFIG.daysAhead });

  if (!result.members?.length) {
    logLine("INFO", "No expiring members found");
    return result;
  }

  const prepared = await prepareRemindersWithMessages(
    result.members.slice(0, REMINDER_JOB_CONFIG.maxMembers)
  );

  prepared.reminders.forEach((reminder) => {
    logLine(
      "INFO",
      `Prepared reminder for ${reminder.name} (${reminder.phone}) - ${String(reminder.message).slice(0, 40)}`
    );
  });

  logLine(
    "INFO",
    JSON.stringify({
      runAt: new Date().toISOString(),
      membersFound: result.count,
      remindersPreared: prepared.count,
      status: "completed",
    })
  );

  return prepared;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReminderJob().catch((error) => {
    logLine("ERROR", error.message);
    process.exitCode = 1;
  });
}
