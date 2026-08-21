# 25 — Stability Fix Plan

Priorities: **P0** security/data corruption/blocking, **P1** core correctness,
**P2** performance, **P3** architecture/quality, **P4** cosmetic/refactoring.
Nothing here has been implemented; this is the prioritized plan.

## P0 — Security / data corruption / blocking

| # | Problem | Evidence | Impact | Fix | Risk | Test required |
|---|---------|----------|--------|-----|-----|---------------|
| P0-1 | Attendance `search-punch` unscoped (IDOR) | `attendanceController.js:102-311` | Trainer reads/punches any gender + PII | Add `scopeResolver.checkMemberScope` after member lookup; uniform 403/404; no member data on deny | Low | Route-level tests: male→M ok, male→F/T denied, superadmin→all ok |
| P0-2 | Attendance `punch-manual` unscoped | `attendanceController.js:409-493` | Trainer punches any gender via memberId | Same scope check on mark_entry/mark_exit | Low | API tests |
| P0-3 | Enquiry `?gender=` override bypass | `enquiryController.js:205-211, 375-380` | Cross-gender read/export | Remove client `gender` override; intersect with scope | Low | API tests for each scope + query manipulation |
| P0-4 | Report attendance/inactive CSV unscoped | `reportsController.js:100-142, 208-267` | Cross-gender data export | Add member-gender filter (Member lookup) | Low | API tests |
| P0-5 | Attendance `stats/today` unscoped | `attendanceController.js:542-556` | All-gender counts | Scope counts by allowed genders | Low | API tests |

## P1 — Core correctness

| # | Problem | Evidence | Impact | Fix | Risk | Test |
|---|---------|----------|--------|-----|-----|------|
| P1-1 | `AdminRegister.jsx` hardcodes gender=Male; no gender input | `AdminRegister.jsx:12,204,272` | Can't register female/transgender via UI; female-scope trainer blocked | Add gender field (scope-driven like RegisterForm) | Low | Frontend test/manual |
| P1-2 | Diet DELETE not superadmin-gated | `dietRoutes.js:30` | Trainer/finance can delete diets | Add `requireRole("superadmin")` | Low | Route test |
| P1-3 | Member `?search=` bypasses gender filter | `memberController.js:181` | Cross-gender member list via search | Pass genderFilter into search | Low | API test |
| P1-4 | `gymId` generation not atomic | `memberController.js:34-37` | Rare duplicate gymId under concurrency (unique index rejects second) | Use atomic counter for numeric gymId too, or migrate to memberCode as the search identity | Medium | Concurrency test |
| P1-5 | Enquiry gender defaults to Male; no frontend field | `Enquiry.js:80-84`, `EnquiryModal.jsx` | All public enquiries classified Male | Add gender to public form (or infer/collect) per product decision | Medium | Manual |
| P1-6 | `getInactiveMembers` total count ignores gender filter | `reportsController.js:56-62` | Pagination count wrong | Reuse same filter in count | Low | Unit |
| P1-7 | Update paths do mass assignment (diet, package, field) | `dietController.js:63`, `packageController.js:84`, `fieldController.js:69` | Unauthorized field mutation | Whitelist update fields | Medium | Unit |
| P1-8 | Dashboard `/finance/income` unbounded logs; `/summary/today` unbounded FinanceLog | `paymentController.js:213-216, 230` | Large payloads over time | Limit log list (e.g., 100) or paginate | Low | Manual |

## P2 — Performance

| # | Problem | Evidence | Fix | Risk |
|---|---------|----------|-----|-----|
| P2-1 | Dashboard polls 5 endpoints every 30s forever | `AdminDashboardHome.jsx:180-184` | Pause when tab hidden (document.visibilityState); reduce interval | Low |
| P2-2 | `/admin/me` fetched 4× per page | `Authguard`, `AdminMembers`, `AdminRegister`, `RegisterForm` | Use AdminContext only; remove redundant fetches | Low |
| P2-3 | Raw `fetch` pages bypass 401-refresh interceptor | `AttendanceFrontDesk`, `InactiveReportsPage`, `DietSelector` | Switch to apiClient | Low |
| P2-4 | Age-distribution aggregation scans all members when no range | `paymentController.js:277-304` | Default range to today | Low |
| P2-5 | CSV exports unbounded (enquiries) | `enquiryController.js:393` | Cap rows + stream or paginate | Low |

## P3 — Architecture / code quality

| # | Problem | Evidence | Fix | Risk |
|---|---------|----------|-----|-----|
| P3-1 | DietService unused; controllers mix patterns | `services/dietService.js`, `dietController.js` | Remove dead service or wire it; standardize controller error handling on errorHandler/asyncHandler | Medium |
| P3-2 | Dead controllers/utils (analytics handlers unrouted, uploadBulkData, getLastAttendance, dbIndexes signedpdflinks) | see 01-repository-structure | Delete or wire; run lint to find unused | Low |
| P3-3 | `FIELD_ENCRYPTION_KEY` required but unused | `validateEnv.js:5` | Either implement field encryption or drop the requirement | Medium |
| P3-4 | Enquiry/report/attendance controllers use inconsistent try/catch vs asyncHandler | across controllers | Normalize to asyncHandler + errorHandler | Low |
| P3-5 | Duplicate public validity endpoints | `publicRoutes.js:14`, `memberRoutes.js:25` | Pick one; align dead frontend components | Low |

## P4 — Cosmetic / documentation

| # | Problem | Evidence | Fix |
|---|---------|----------|-----|
| P4-1 | README + DEPLOYMENT_GUIDE contradict code | see 01-repository-structure | Rewrite docs from this audit |
| P4-2 | Duplicated `if (reason...)` line | `enquiryController.js:214-215` | Remove |
| P4-3 | Dead frontend files (MembershipCheckSection, MemberValidityCheck, useFormValidation, validation, sanitizeHtml, soundManager) | 01-repository-structure | Remove or revive |
| P4-4 | Vepery branch not exposed on public enquiry modal | `EnquiryModal.jsx:9` | Align branch lists |

## Recommended sequencing

1. P0-1..P0-5 (attendance + reports + enquiry scope enforcement) — the Part 5
   attendance work.
2. P1-1, P1-2, P1-3 (registration gender UI, diet delete gate, member search
   filter).
3. P2 fixes while touching the same pages.
4. P3 cleanup in a dedicated refactor phase.
5. P4 documentation alignment.
