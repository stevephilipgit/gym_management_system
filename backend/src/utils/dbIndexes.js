export const collectionIndexes = [
  {
    collection: "admins",
    indexes: [
      { key: { username: 1 }, options: { unique: true, name: "idx_admins_username_unique" } },
      { key: { email: 1 }, options: { unique: true, name: "idx_admins_email_unique" } },
      { key: { role: 1, createdAt: -1 }, options: { name: "idx_admins_role_createdAt" } },
    ],
  },
  {
    collection: "members",
    indexes: [
      // Identity: keypad/serial gymId is unique within (branch, gender).
      // Supersedes the old {gymId,gender} compound (dropped by
      // scripts/migrate-add-branches.js).
      { key: { branchId: 1, gender: 1, gymId: 1 }, options: { unique: true, name: "idx_members_branch_gender_gym_unique" } },
      // Phone is unique PER BRANCH (was globally unique); public/kiosk phone
      // lookups resolve cross-branch ambiguity explicitly.
      { key: { branchId: 1, phone: 1 }, options: { unique: true, name: "idx_members_branch_phone_unique" } },
      { key: { memberCode: 1 }, options: { unique: true, sparse: true, name: "idx_members_memberCode_unique" } },
      { key: { aadhar: 1 }, options: { unique: true, name: "idx_members_aadhar_unique" } },
      { key: { paymentStatus: 1, validityEnd: 1 }, options: { name: "idx_members_status_validity" } },
      { key: { status: 1, createdAt: -1 }, options: { name: "idx_members_status_createdAt" } },
      { key: { branchId: 1, gender: 1, createdAt: -1 }, options: { name: "idx_members_branch_gender_createdAt" } },
    ],
  },
  {
    collection: "dailysummaries",
    indexes: [
      // One summary per branch per day (was: one per day, globally unique).
      { key: { branchId: 1, date: 1 }, options: { unique: true, name: "idx_dailysummary_branch_date_unique" } },
      { key: { date: 1, isCompleted: 1 }, options: { name: "idx_dailysummaries_date_completed" } },
    ],
  },
  {
    collection: "packages",
    indexes: [{ key: { months: 1 }, options: { name: "idx_packages_months" } }],
  },
  {
    collection: "paymentlogs",
    indexes: [
      { key: { gymId: 1, paidAt: -1 }, options: { name: "idx_paymentlogs_gym_paidAt" } },
      { key: { type: 1, paidAt: -1 }, options: { name: "idx_paymentlogs_type_paidAt" } },
    ],
  },
  {
    collection: "financelogs",
    indexes: [
      { key: { gymId: 1, date: -1 }, options: { name: "idx_financelogs_gym_date" } },
      { key: { type: 1, date: -1 }, options: { name: "idx_financelogs_type_date" } },
    ],
  },
  {
    collection: "signedpdflinks",
    indexes: [
      { key: { token: 1 }, options: { unique: true, name: "idx_signedpdflinks_token_unique" } },
      { key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: "idx_signedpdflinks_ttl" } },
    ],
  },
  {
    collection: "kiosks",
    indexes: [
      // One kioskId per branch (the old global kioskId unique index is
      // dropped by scripts/migrate-add-branches.js).
      { key: { branchId: 1, kioskId: 1 }, options: { unique: true, name: "idx_kiosks_branch_kiosk_unique" } },
      { key: { enabled: 1 }, options: { name: "idx_kiosks_enabled" } },
    ],
  },
  {
    collection: "deviceregistrations",
    indexes: [
      // INVARIANT A — one active attendance device per Trainer.
      { key: { trainerId: 1 }, options: { unique: true, partialFilterExpression: { active: true }, name: "idx_devicereg_trainer_active_unique" } },
      // INVARIANT B — one active Trainer owner per browserDeviceId/Kiosk.
      { key: { kioskId: 1 }, options: { unique: true, partialFilterExpression: { active: true }, name: "idx_devicereg_kiosk_active_unique" } },
      // INVARIANT C — O(1) credential lookup for kioskAuth.
      { key: { kioskId: 1, keyFingerprint: 1 }, options: { unique: true, partialFilterExpression: { keyFingerprint: { $type: "string" } }, name: "idx_devicereg_keyfp_unique" } },
      // Query: list registrations by Trainer.
      { key: { trainerId: 1, createdAt: -1 }, options: { name: "idx_devicereg_trainer_created" } },
    ],
  },
  {
    collection: "attendanceexports",
    indexes: [
      // One export per business day + export type (idempotency / multi-instance).
      { key: { attendanceDate: 1, exportType: 1 }, options: { unique: true, name: "idx_attendanceexports_date_type_unique" } },
    ],
  },
  {
    collection: "notifications",
    indexes: [
      { key: { recipientRole: 1, createdAt: -1 }, options: { name: "idx_notifications_role_created" } },
      { key: { read: 1, createdAt: -1 }, options: { name: "idx_notifications_read_created" } },
    ],
  },
  {
    collection: "auditlogs",
    indexes: [
      { key: { userId: 1, timestamp: -1 }, options: { name: "idx_auditlogs_user_time" } },
      { key: { action: 1 }, options: { name: "idx_auditlogs_action" } },
      { key: { timestamp: 1 }, options: { expireAfterSeconds: 90 * 24 * 60 * 60, name: "idx_auditlogs_ttl" } },
    ],
  },
];
