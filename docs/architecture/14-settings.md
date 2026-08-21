# 14 — Settings

## Model (models/SystemSettings.js)

Singleton via `key: 'gym_rules'` (unique). Defaults in
`services/systemSettingsService.js:16-64`.

Sections:
- **Attendance:** `oneVisitPerDay`, `duplicatePunchSeconds` (30), `latePunchThreshold`
  (21:00), `openingTime` (04:00), `closingTime` (22:00), `blockExpiredMembers`
  (true), `expiredGraceDays` (0), `soundEnabled`.
- **Business info:** `gym_name`, `gym_tagline`, `support_phone`, `whatsapp_number`,
  `public_email`, `footer_text`.
- **Enquiry:** `enquiry_notify_email`, `enquiry_success_message`,
  `enquiry_auto_reply_enabled`, `enquiry_auto_reply_subject`,
  `enquiry_retention_days` (90).
- **Branches:** `branch_mathur_*`, `branch_vepery_*` (name/address/phone/map/image).
- **Social:** `social_instagram`, `social_facebook`, `social_youtube`,
  `social_google_reviews`.
- **Integrations:** `sheets_enabled`, `sheets_email`, `sheets_default_name`,
  `email_notifications_enabled`.
- `updatedBy` (ref Admin).

## Service behavior (services/systemSettingsService.js)

- `getSettings()`: in-memory cache with 5-minute TTL; creates defaults on first
  read; returns defaults on error (never throws).
- `updateSettings(updates, adminId)`: `findOneAndUpdate({key:'gym_rules'},
  {...updates, updatedBy}, {new, upsert})` then invalidates cache.
- `invalidateCache()`.

## Endpoints (routes/systemSettingsRoutes.js)

- `GET /` — `requireRole("superadmin")` → getSettings.
- `PUT /` — `requireRole("superadmin")` → updateSettings.

`updateSettings` whitelists fields (systemSettingsController.js:9-28
`ALLOWED_FIELDS`); anything else is silently dropped.

## Frontend (SettingsPage.jsx — superadmin RoleGuard)

- `GET /settings` (L55), `PUT /settings` (L81).
- Tabs: Attendance / Enquiry / Branch / Social / Google Sheets (integrations).
- Theme control (local storage `giri-gym-theme`), ToggleSwitch, GoogleSheetsConnector.

## Where each setting is actually used

| Setting | Used by |
|---------|---------|
| openingTime / closingTime | `searchPunch` business-hours check; kiosk hardcodes 04:00-22:00 client-side |
| duplicatePunchSeconds | attendanceService.checkDuplicate |
| latePunchThreshold | searchPunch late detection |
| expiredGraceDays / blockExpiredMembers | attendanceService.validateMemberExpiry; searchPunch expiry block |
| oneVisitPerDay | **DEAD** — no code reads it (attendance relies on the unique index + state machine) |
| soundEnabled | **DEAD** — `soundManager.js` is unused; kiosk has no sound wiring |
| enquiry_notify_email / email_notifications_enabled | enquiryController email trigger |
| enquiry_success_message | enquiryController response |
| enquiry_retention_days | cleanupOldEnquiries cron |
| sheets_enabled / sheets_email | enquiryController sheets trigger; `sheets_default_name` **DEAD** |
| branch_*/social_*/gym_*/public_email/footer_text | Public `Home.jsx` uses hardcoded config (Home.jsx:47-74, 262-285), **not** these settings — so these settings are effectively **DEAD** at runtime (frontend does not fetch them). |
| enquiry_auto_reply_enabled / subject | **DEAD** — no auto-reply code exists |

## Cache invalidation

Cache is per-process (in-memory). With multiple Node instances the cache is
stale per instance. Redis is **not** used for settings caching (contradicts
DEPLOYMENT_GUIDE claim).

## Findings

- Half the settings are dead (oneVisitPerDay, soundEnabled, sheets_default_name,
  enquiry_auto_reply_*, branch_*/social_* as displayed on the public site).
- `getSettings` swallowing errors with defaults can mask DB problems.
- The public homepage ignores the DB settings entirely (hardcoded values in
  `Home.jsx`), so editing settings for the public site has no effect.
