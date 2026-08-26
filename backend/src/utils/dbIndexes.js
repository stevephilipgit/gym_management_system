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
      // Identity: gymId is only unique WITHIN a gender (male "101" and female
      // "101" are distinct). The old global gymId unique index was replaced by
      // this compound unique. Drop the old one via scripts/migrate-member-identity.js.
      { key: { gymId: 1, gender: 1 }, options: { unique: true, name: "idx_members_gym_gender_unique" } },
      { key: { memberCode: 1 }, options: { unique: true, sparse: true, name: "idx_members_memberCode_unique" } },
      { key: { aadhar: 1 }, options: { unique: true, name: "idx_members_aadhar_unique" } },
      { key: { phone: 1 }, options: { unique: true, name: "idx_members_phone_unique" } },
      { key: { paymentStatus: 1, validityEnd: 1 }, options: { name: "idx_members_status_validity" } },
      { key: { status: 1, createdAt: -1 }, options: { name: "idx_members_status_createdAt" } },
      { key: { gender: 1, createdAt: -1 }, options: { name: "idx_members_gender_createdAt" } },
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
    collection: "auditlogs",
    indexes: [
      { key: { userId: 1, timestamp: -1 }, options: { name: "idx_auditlogs_user_time" } },
      { key: { action: 1 }, options: { name: "idx_auditlogs_action" } },
      { key: { timestamp: 1 }, options: { expireAfterSeconds: 90 * 24 * 60 * 60, name: "idx_auditlogs_ttl" } },
    ],
  },
];
