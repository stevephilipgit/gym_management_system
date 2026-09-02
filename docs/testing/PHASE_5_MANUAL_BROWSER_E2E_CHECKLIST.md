# Phase 5 — Manual Browser E2E Checklist

**Purpose**: Verify browser-only scenarios that cannot be automated via the
HTTP-stack E2E runner. These require a real browser with Chrome Profiles A, B,
and C.

**Setup**:
- Chrome Profile A: Super Admin (e2e_super / Pass1234!)
- Chrome Profile B: Male Trainer (e2e_male / Pass1234!)
- Chrome Profile C: Female Trainer (e2e_female / Pass1234!)
- Backend running on port 5000 connected to the test database
- Frontend Vite dev server running (port 5173, proxied to 5000)

---

## E2E-013 — Stale Trainer Credentials in Super Admin Browser

**Prerequisite**: Super Admin's browser has stale `gym_kiosk_id` and
`gym_kiosk_key` from a previous Trainer session (e.g., from activating a Trainer
device earlier in the testing session).

| Step | Action | Expected |
|---|---|---|
| 1 | Seed stale kiosk credentials into localStorage: open DevTools → Application → Local Storage → `localhost:5173` → set `gym_kiosk_id` = `test-id`, `gym_kiosk_key` = `test-key` | |
| 2 | Log in as Super Admin (Profile A) | Login succeeds |
| 3 | Navigate to `/kiosk-attendance` | Page loads |
| 4 | Observe the mode | **Super Admin attendance mode** must be shown, NOT the Trainer kiosk-punch form. The stale `gym_kiosk_*` values must NOT cause Trainer kiosk mode to override the Super Admin mode. |
| 5 | Observe scope selection | Must show **Male** and **Female + Transgender** buttons. Must NOT show "All Genders". |
| 6 | Select Male scope | Scope token is obtained; punch UI appears. |
| 7 | Punch a Male member | Attendance recorded correctly. |
| 8 | Select Female + Transgender scope | Scope token is obtained; punch UI appears. |
| 9 | Punch a Female member | Attendance recorded correctly. |
| 10 | After session, verify localStorage | `gym_admin_token_*` cookies exist (httpOnly). `gym_kiosk_id` / `gym_kiosk_key` may still exist but must NOT affect the mode. |

**Result**: `MANUAL VERIFICATION REQUIRED` — execute and record PASS/FAIL.

---

## General Browser-Only Checks

### Sidebar Visibility

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | A (Super Admin) | Log in, observe sidebar | "My Attendance Devices" is NOT visible |
| 2 | A | Navigate directly to `/admin/my-devices` | Redirected to `/admin/members` (or 403) |
| 3 | B (Male Trainer) | Log in, observe sidebar | "My Attendance Devices" is visible |
| 4 | B | Navigate to `/admin/my-devices` | Page loads, shows activation UI |
| 5 | C (Female Trainer) | Log in, observe sidebar | Same as B |

### Super Admin Device Management

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | A | Open Device Management (`/admin/devices`) | Trainers listed |
| 2 | A | Select a Trainer, click "Generate Activation" | Modal shows trainer name + scope, NO kiosk device selector |
| 3 | A | Click "Generate Code" | 6-digit code + QR shown, expiry countdown |
| 4 | A | Copy code and share with trainer | Code is 6 digits |

### Trainer Activation (real browser)

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | B | Open `/admin/my-devices` | "No active device" shown |
| 2 | B | Click "Activate Attendance Device" | Modal shows code entry + password |
| 3 | B | Enter the 6-digit code from the Admin, confirm password | Device becomes active, "This browser is your active attendance device" shown |
| 4 | B | Navigate to `/kiosk-attendance` | Customer punch input works (kiosk credential in localStorage) |

### Device Replacement (real browser)

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | B | Trainer B is active on Browser X | Device active |
| 2 | B | Open a NEW browser/incognito (Device Y), log in as Trainer B | |
| 3 | A | Generate new activation for Trainer B | |
| 4 | B (Device Y) | Enter the new code, confirm password | Device Y becomes active |
| 5 | B (Device X) | Navigate to `/kiosk-attendance` | Punch fails (old credential invalid) |
| 6 | B (Device Y) | Navigate to `/kiosk-attendance` | Punch works (new credential valid) |

### Super Admin Scope Switching (real browser)

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | A | Navigate to `/kiosk-attendance` | Scope selector shown |
| 2 | A | Select Male | Punch 192 → Male member |
| 3 | A | Switch to Female + Transgender | Punch 192 → Female member (same Gym ID, different person) |
| 4 | A | In Female + Transgender mode, punch 444 | Male member rejected/not found |
| 5 | A | Try to select "All Genders" | No such option exists |

### Session Isolation

| Step | Profile | Action | Expected |
|---|---|---|---|
| 1 | A, B | Both logged in simultaneously (different profiles) | Each session is independent |
| 2 | B | Log out | Only Trainer B's session ends; Super Admin A unaffected |

---

**Fill in dates and results after execution.**
Browser verification date: `__________`
All results: `PASS / FAIL / BLOCKED`