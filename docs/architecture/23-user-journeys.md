# 23 — User Journeys (E2E, verified)

## 1. Superadmin login
```
Login.jsx → GET /admin/captcha → POST /admin/login (JWT + cookies)
  → AuthGuard GET /admin/me (role=superadmin, scope=all)
  → /admin dashboard (finance)
  → Sidebar: Dashboard, Register, Dues, Members, Packages, Diet, AI, Fields,
    Attendance, Reports, Enquiries, Settings (all visible)
```

## 2. Male trainer login
```
Login → /admin → admin.role=trainer, admin.scope=male
  → Sidebar hides: Packages, AI, Form Fields, Settings
  → GET /members?page=... → gender filter Male only
  → RegisterForm gender dropdown → "Male" only
  → Attendance logs → male attendance only
```
**Note:** a male trainer can still call `GET /api/attendance/search-punch`,
`/punch-manual`, `/stats/today`, `/reports/export/attendance` and obtain
non-male data (see 11-attendance, 19-security C1/C2/H2/H3).

## 3. Female trainer login
```
Same as #2 with scope=female_plus_transgender (Female + Transgender visible).
```
**Note:** the standalone Register page hardcodes gender=Male (AdminRegister.jsx)
so a female trainer cannot register via `/admin/register` (backend rejects Male
registration for scope female_plus_transgender).

## 4. Register male member
```
AdminRegister.jsx → GET /fields/member, GET /packages → POST /members/register
  (FormData, gender always "Male") → backend scope check (male allowed) →
  gymId numeric + memberCode M… via counter → FinanceLog/PaymentLog/summary →
  jsPDF invoice download
```

## 5. Register female member
```
Same endpoint with gender=Female. Only possible from RegisterForm (AdminMembers
edit modal / AdminUpdate) or API — the standalone AdminRegister page cannot
select Female.
```

## 6. Register transgender member
```
Same endpoint gender=Transgender. Only from RegisterForm/API. Superadmin scope
only (male scope rejects T, female scope allows T per product rule).
```

## 7. Update member
```
AdminMembers → GET /members/:gymId (scope check) → PUT /members/:gymId FormData
  (scope check on existing gender before update) → re-fetch
```

## 8. Renew membership
```
AdminMembers renew modal → PUT /members/renew/:gymId (scope check) → new
validity computed → FinanceLog + PaymentLog + summary → jsPDF invoice
```

## 9. View dues
```
AdminDues → GET /members/due/list?days=3650&includeExpired=true&includeDraft=true
  → gender-filtered member list → client-side search/sort/pagination
```

## 10. Punch attendance
```
KioskAttendance.jsx (public page) → POST /attendance/search-punch
  (x-attendance-source: kiosk) → searchPunch (NO gender scope check) →
  check-in/check-out/late/closed/duplicate → PunchModal shows result
```

## 11. Create diet
```
AdminDietManager (any role) → POST /diets (adminAuth) → Diet doc
```
**Note:** no role gate; a trainer can create/update/delete diets.

## 12. Apply diet
```
RegisterForm / AdminMembers → DietSelector (GET /diets, GET /diets/mapping/:trainingType)
  → member.dietId set on register/renew → invoice diet page (jsPDF)
```

## 13. View reports
```
InactiveReportsPage → GET /reports/inactive (scope-filtered list) and
  GET /reports/export/inactive (CSV — NOT scope-filtered)
```

## 14. Submit enquiry (public)
```
Home.jsx → EnquiryModal → POST /api/enquiries (honeypot + rate limit 5/10min) →
  saved with gender default "Male" → email/sheets non-blocking
```

## 15. View enquiry (admin)
```
AdminEnquiries → GET /enquiries (scope filter; ⚠️ ?gender= can override) →
  status PATCH → superadmin DELETE → CSV export (same override issue)
```

## 16. Logout
```
AdminSidebar → POST /admin/logout → cookies cleared → /login
  (JWT remains valid until expiry; no server-side revocation)
```

## Common journey diagrams

### Authentication
```
User → Login.jsx → GET /api/admin/captcha → POST /api/admin/login
  → authController → bcrypt.compare → issueTokens → httpOnly cookies
  → AuthGuard GET /admin/me → AdminContext → AdminLayout → page
```

### Attendance punch
```
Trainer → KioskAttendance → POST /attendance/search-punch
  → adminAuth (JWT cookie) → searchPunch
  → Member.findOne(gymId) → business checks → Attendance.create/update
  → member PII returned → PunchModal
```
