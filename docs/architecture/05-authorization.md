# 05 — Authorization (RBAC + Gender Scope)

## Roles (from `models/Admin.js`)

```
role: enum ["superadmin", "trainer", "finance"], default "trainer"
scope: enum ["all", "male", "female_plus_transgender"], default "all"
```

Role and scope are separate dimensions:
- `role` gates **admin/module** operations (requireRole).
- `scope` gates **member/enquiry/attendance data** by gender.

Both are signed into the access JWT and restored by `adminAuth`
(`req.admin = { id, username, role, scope }`). Scope is **never re-read from
the DB on each request** — a scope change takes effect only at next login/refresh.

## Role matrix (verified against routes)

| Feature | superadmin | trainer | finance | Backend enforced? |
|---------|-----------|---------|---------|-------------------|
| Admin create/update/delete/list/reset | ✅ | ❌ | ❌ | ✅ `requireRole("superadmin")` (adminRoutes.js:43-58) |
| Package create/update/delete | ✅ | ❌ | ❌ | ✅ requireRole (packageRoutes.js:21-27) |
| Package read | ✅ | ✅ | ✅ | ✅ adminAuth |
| Dynamic field create/toggle/delete | ✅ | ❌ | ❌ | ✅ requireRole (fieldRoutes.js:21-27) |
| System settings read/write | ✅ | ❌ | ❌ | ✅ requireRole (systemSettingsRoutes.js:13-21) |
| AI chat/confirm | ✅ | ❌ | ❌ | ✅ requireRole at mount (server.js:155) |
| Google Sheets connectors | ✅ | ❌ | ❌ | ✅ requireRole (connectorsRoutes.js) |
| Enquiry delete | ✅ | ❌ | ❌ | ✅ requireRole("superadmin") (enquiryRoutes.js:45) |
| Member delete | ✅ | ❌ | ❌ | ✅ requireRole("superadmin") (memberRoutes.js:53) |
| Member register/list/get/update/renew | ✅ | ✅ | ✅ | ✅ adminAuth + gender scope |
| Dues list | ✅ | ✅ | ✅ | ✅ adminAuth |
| Attendance (search-punch, punch, punch-manual, history, logs, stats) | ✅ | ✅ | ✅ | ⚠️ adminAuth **only — no requireRole, and gender scope MISSING on search-punch/punch-manual/stats** |
| Reports (inactive, exports) | ✅ | ✅ | ✅ | ⚠️ adminAuth only; attendance/inactive CSV exports have NO gender scope |
| Enquiries read/status | ✅ | ✅ | ✅ | ⚠️ adminAuth; scope overridable by `?gender=` query param |
| Diets create/update/**delete** | ✅ | ✅ | ✅ | ⚠️ **DELETE has NO requireRole** — any role incl. trainer can delete a diet (dietRoutes.js:30) |
| Finance dashboard/metrics | ✅ | ✅ | ✅ | ✅ adminAuth (no gender scope — finance is revenue-wide) |
| Dashboard (home) | ✅ | ✅ | ✅ | ✅ adminAuth |

**Findings (post-hardening):**
1. **Diet DELETE is now superadmin-gated** (`dietRoutes.js:30` → `requireRole("superadmin")`).
2. **Dashboard/analytics/finance routes are now superadmin-only** (`financeRoutes.js`,
   `analyticsRoutes.js`); the frontend index route is RoleGuard-wrapped.
3. **`finance` role**: has `scope: "all"` by default; now also loses the dashboard
   per Phase 12 (product decision flagged in 27-production-hardening.md).
4. Gender scope is now centralized in `core/scopeResolver.js` and enforced on
   **every** attendance/report/enquiry/member access path (search-punch,
   punch-manual, stats/today, CSV exports, member `?search=` all fixed).
5. `createAdmin` now **requires an explicit scope** and rejects `trainer` +
   `scope: "all"` (no more accidental full-access trainers).

## Gender scope model (`core/scopeResolver.js`)

```
SCOPE_RULES = {
  all:                    () => true,
  male:                   (g) => g === "Male",
  female_plus_transgender:(g) => g === "Female" || g === "Transgender",
}
```

Applied at:
- Member module: register (memberController.js:54), getMemberById/getMemberByGymId
  (209/234), update (261), delete (300), renew (460), list filters (166-176,
  325-336, 354-365, 544-555).
- Enquiry module: list/export filters and per-record checks (enquiryController.js).
- Reports: inactive members (reportsController.js:19-30), export members
  (149-160). **NOT** applied to export/attendance or export/inactive.
- Attendance: `punch` (333), `history` (512), `logs` (583-597). **NOT** applied
  to `search-punch`, `punch-manual`, `stats/today`.

## Frontend vs backend enforcement

- Frontend `RoleGuard`/sidebar only hide routes (UX). Backend `requireRole` is
  the real gate for module-level restrictions.
- Frontend `RegisterForm.jsx:197-215` limits the gender dropdown by
  `admin.scope` — cosmetic; backend re-validates on register.
- **Frontend-only restrictions do not exist for gender data** — the backend
  does the filtering (for the paths where it is implemented).

## Privilege escalation / IDOR risks (post-hardening status)

1. ~~Enquiry gender-scope override (`enquiryController.js:206, 376`)~~ **FIXED** — client
   `gender` param may only narrow a superadmin scope; trainer scopes are
   authoritative.
2. ~~Attendance search-punch / punch-manual / stats/today~~ **FIXED** — all now
   enforce `scopeResolver.checkMemberScope` or use scoped counts.
3. ~~Reports export/attendance + export/inactive~~ **FIXED** — gender-scoped via
   `getScopedMemberIds` / `buildGenderFilter`.
4. ~~Diet DELETE unrestricted~~ **FIXED** — now `requireRole("superadmin")`.
5. ~~`getAllMembers ?search=` path~~ **FIXED** — gender filter passed to search.
6. `getInactiveMembers` total count omission — **FIXED**.
7. Admin `updateAdmin`/`deleteAdmin` routes remain superadmin-gated; a
   superadmin can still delete their own account (design choice, no lockout guard).
8. Admin `updateAdmin`/`deleteAdmin` routes are superadmin-gated; authController
   does not independently check that the target is not themselves — a superadmin
   can delete their own account (intended capability, no lockout guard).
