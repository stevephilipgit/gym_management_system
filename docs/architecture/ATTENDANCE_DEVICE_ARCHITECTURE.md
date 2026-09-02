# Attendance Device Architecture

Status: FINAL · Branch: `attendance-feat` · 2026-09-02

## Overview

There are two distinct attendance-terminal modes. They are separate by design and must not be confused.

### MODE 1 — Trainer Attendance Device

A Trainer activates the browser/device they will use to punch customer attendance.

```
Super Admin                      Trainer
   │ selects a Trainer              │ logs into the physical browser/device they want
   │ generates one-time activation  │
   │ code + QR (no kiosk selection) │ enters code OR scans QR
   │                                │ confirms their own password
   │                                │ CURRENT browser becomes their active device
```

**Server derives everything authoritatively:**
- `trainerId` — from the authenticated session (`req.admin.id`), never from the body
- `scope` — from the Trainer record at generation, frozen on the activation
- `browserDeviceId` — the redeeming browser
- physical device (`Kiosk` = `browserDeviceId`) — created/reused at redemption

**Invariants (DB-enforced):**
- A. One active attendance device per Trainer
- B. One active Trainer owner per browserDeviceId/Kiosk
- C. One credential fingerprint per active Kiosk

### MODE 2 — Super Admin Attendance

A Super Admin does NOT activate themselves. From any logged-in browser they open `/kiosk-attendance`, explicitly choose **Male** or **Female + Transgender** (never "All Genders"), and punch customers.

```
Super Admin
   → /kiosk-attendance
   → choose scope (Male | Female + Transgender)
   → POST /api/attendance/admin-scope        → short-lived scoped token
   → POST /api/attendance/kiosk/admin-punch  (X-Admin-Attendance-Token)
```

Super Admin attendance does **not** create a DeviceRegistration and does **not** use kioskAuth.

## Data Flow

### Activation generation
`POST /api/admin/devices/activate/generate` (Super Admin) → `{ trainerId }`
1. Verify caller is Super Admin (`requireRole("superadmin")`)
2. Load Trainer; verify role + active
3. Derive scope from Trainer (reject `all`)
4. Revoke prior unused activations for this Trainer
5. Generate 6-digit code + QR secret; store bcrypt hashes only
6. Set TTL (default 120s, configurable `ACTIVATION_TTL_SECONDS`)

### Activation redemption
`POST /api/admin/devices/activate` (Trainer) → `{ code|qrSecret, password, browserDeviceId }`
1. Trainer identity from session only
2. Dedicated rate limit (5/min default per IP+Trainer)
3. Verify password (server-side, never logged)
4. Mongo transaction (REQUIRED): consume activation atomically → resolve Kiosk (create/reuse/disabled-reject/scope-reject) → enforce INVARIANT B → deactivate old registration (INVARIANT A) → create new registration → update counters
5. Standalone Mongo (no transactions) → **503 BLOCKED**, never a non-atomic fallback

### Customer punch
`POST /api/attendance/kiosk/punch` via `kioskAuth` (MODE 1 device credential) or `POST /api/attendance/kiosk/admin-punch` via `adminAttendanceAuth` (MODE 2 scope token). Both reuse the same scoped member-resolution + attendance business logic.

## Key Security Properties

- Scope is server-derived, never client-controlled
- Activation bound to a specific Trainer
- Single-use lifecycle (QR and code are two mechanisms for one activation)
- Short-lived TTL, replay-protected, password-confirmed
- One active device per Trainer; one owner per browser
- Disabled Kiosk never auto-enabled; Kiosk scope never silently overwritten
- Super Admin scoped attendance is separate from Trainer device auth
- No "All Genders" punch mode; no JWT→kioskAuth bypass
- Gym ID is not globally unique: Male/Female same ID resolve by scope; Female/Transgender same ID → integrity error (no write)

## Related Docs

- `docs/architecture/DEVICE_LIFECYCLE.md`
- `docs/security/ATTENDANCE_DEVICE_SECURITY.md`
- `docs/testing/ATTENDANCE_DEVICE_TEST_PLAN.md`
- `docs/audits/GIRI_GYM_DEVICE_ATTENDANCE_COMPLETE_ISSUES.md`
