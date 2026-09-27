// tests/utils/branchFixture.js - Shared Branch seeding for test suites.
//
// Every suite that creates any of the nine branch-scoped collections
// (Member, Admin, FinanceLog, PaymentLog, DailySummary, Attendance, Package,
// Enquiry, Kiosk) needs a real Branch document first: branchId is `required`
// on all of them, and flows like gym-id allocation / reconciliation resolve
// the Branch doc itself (code lookup, isActive iteration).
//
// Usage (in a suite's before hook):
//   import { seedTestBranch } from "./utils/branchFixture.js";
//   let branch;
//   before(async () => { branch = await seedTestBranch(); });
//   ... Member.create({ branchId: branch._id, ... })

import Branch from "../../models/Branch.js";

// One canonical branch per code — idempotent across suites within the same
// in-memory database (each suite that needs its own tenant passes a code).
export async function seedTestBranch(overrides = {}) {
  const spec = {
    name: "Test Branch",
    code: "TEST",
    isActive: true,
    ...overrides,
  };
  const existing = await Branch.findOne({ code: spec.code });
  if (existing) return existing;
  return Branch.create(spec);
}

// A second tenant for isolation assertions (branch A vs branch B).
export function seedSecondBranch() {
  return seedTestBranch({ name: "Second Branch", code: "SECOND" });
}
