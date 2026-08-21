# 13 — Enquiries

## Model (models/Enquiry.js)

```
name, email, phone, preferred_branch (Mathur|Vepery|Any Branch), reason (enum),
message, status (new|contacted|closed|spam), source_page, ip_address, user_agent,
assigned_to, notes,
gender: enum ["Male","Female","Transgender"], default "Male"
```

- Gender is stored with a **default of "Male"**.
- **The public submission form never sends gender** — `EnquiryModal.jsx` has no
  gender field, so every public enquiry is recorded as **Male**. This makes the
  enquiry gender scope effectively classify all enquiries as male unless
  manually edited. **PARTIALLY IMPLEMENTED / data-quality risk.**

## Public submission (POST /api/enquiries)

- No auth. Rate limit: `enquirySubmitLimiter` 5 / 10 min / IP (enquiryRoutes.js:15-25).
- Honeypot field `website` — if filled, fake success returned (enquiryController.js:39-43).
- Server-side validation: name 2-80 chars (letters/spaces only), email format,
  Indian phone `^[6-9]\d{9}$`, branch/reason from enums, message ≤500.
- Persists with IP + user agent.
- Non-blocking: email notification (`sendEnquiryNotification` if
  `enquiry_notify_email` + enabled) and Google Sheets sync (if `sheets_enabled`
  and connector exists).
- Response message from settings `enquiry_success_message`.

## Admin management (adminAuth)

| Endpoint | Behavior |
|----------|----------|
| `GET /enquiries` | List with filters (status, branch, reason, gender, search, dateFrom/dateTo). Gender-scoped. |
| `GET /enquiries/:id` | Single enquiry — scope-checked (403 if out of scope). |
| `PATCH /enquiries/:id/status` | Status update + notes — scope-checked before update. |
| `DELETE /enquiries/:id` | `requireRole("superadmin")` — delete is superadmin-only ✅. |
| `GET /enquiries/export/csv` | CSV export — gender-scoped. |

## Gender classification enforcement

- The scope filter is derived from `req.admin.scope` via
  `scopeResolver.getScopeAllowedGenders(req)` (enquiryController.js:198-212 and
  export path).
- **FIXED (hardening):** the previous `?gender=` query-param **override** was
  removed. A client-supplied gender may now only *narrow* a superadmin (all)
  scope; trainer scopes always use the scope-derived filter — a male trainer
  cannot read female/transgender enquiries by manipulating the query string.
- Per-record checks in `getEnquiryById` / `updateEnquiryStatus` use the same
  centralized helper.
- **Public form now collects gender** (`EnquiryModal.jsx` required field);
  server validates `Male|Female|Transgender` and defaults to `Male` when absent
  (API callers).

## Cron cleanup

`cleanupOldEnquiries` (enquiryController.js:422) runs daily at 02:00 via
server.js:253-261:
- deletes `status:'spam'` older than 30 days, `status:'closed'` older than
  `enquiry_retention_days` (default 90).

## Notes

- Duplicated `if (reason && reason !== 'all')` line at enquiryController.js:214-215
  (harmless but sloppy).
- EnquiryModal frontend `BRANCHES = ['Mathur']` (EnquiryModal.jsx:9) vs backend
  enum allows Vepery — users cannot select Vepery from the public form.
- Enquiry gender defaults to Male for all public submissions (no frontend field).
