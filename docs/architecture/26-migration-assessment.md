# 26 — Migration Assessment

## 1. Can the existing stack support this application?

**Yes.** This is a single-gym (or a few-gym) management system. The data volumes
are small (hundreds to low thousands of members, tens of transactions per day).
Express + MongoDB + React fully cover the feature set. Nothing in the code
indicates a scale or framework ceiling that blocks the current product.

## 2. What is actually causing slowness?

From [20-performance.md](20-performance.md), the top contributors are:

1. **Frontend polling** — the dashboard fires 5 requests every 30 seconds with
   no visibility pause (HIGH).
2. **Redundant auth fetches** — `/admin/me` fetched 4× per admin page (MEDIUM).
3. **Raw `fetch` pages** that bypass the axios 401-refresh interceptor, causing
   visible errors on token expiry (MEDIUM).
4. **Unbounded payloads** — finance log lists and CSV exports return everything
   (MEDIUM).
5. **No client caching** — every navigation re-fetches all data (react-query is
   absent).

None of these require a stack change. They are configuration and code-pattern
issues in the current React + Express setup.

## 3. What can be fixed without migration?

Everything in [25-stability-plan.md](25-stability-plan.md) can be fixed in place:
scope enforcement on attendance/reports/enquiries, registration gender UI,
polling/visibility pausing, single `/admin/me` fetch, switching raw fetches to
apiClient, adding limits/pagination to list endpoints, and cleaning dead code.

## 4. What architectural limitations genuinely exist?

- **Gender-scope enforcement is incomplete** on several endpoints (attendance
  search-punch/punch-manual/stats, report CSV exports, enquiry gender override,
  member search). This is a logic gap, not a framework limitation.
- **Two identifiers** (`gymId` numeric global vs `memberCode` gender-prefixed)
  create ambiguity; attendance search only uses the numeric one.
- **In-memory caches** (settings, AI sessions) are per-process; a PM2 cluster
  would have inconsistent settings and non-shared AI conversations.
- **Stateless JWT with no revocation** means logout/scope changes only apply at
  next login.
- **Mass-assignment risk** on several update endpoints.
- **Dead code and duplicate paths** (two public-validity endpoints, orphan
  controllers, unused services) increase maintenance cost.
- **No CI, no frontend tests, no TypeScript.**

## 5. Would Next.js help?

Only marginally. The public homepage could benefit from SSR/SEO, but the
application is an authenticated admin SPA; SEO applies to the marketing page
only, which is already static content served by Vite. The real problems
(polling, missing cache, incomplete scope logic) are unchanged by Next.js.
**Not justified by evidence.**

## 6. Would NestJS help?

NestJS would impose structure (modules, DI, decorators, class-validator) that
could force consistency on the backend. But the backend already works and the
gaps are logic bugs, not missing structure. Migrating to NestJS is a large
effort with no demonstrated performance or stability gain for this workload.
**Not justified.**

## 7. Would TypeScript migration help?

Moderately. The biggest wins would be catching the mass-assignment and
unexpected-null bugs and making the API contracts (req.admin shape, response
shapes) explicit. But the codebase is small enough that the same discipline can
be achieved with JSDoc + the existing Joi schemas. TypeScript is a **medium-term
optional improvement**, not a required fix.

## 8. Would PostgreSQL help?

No. The data is document-shaped (customFields Object, DailySummary maps,
denormalized memberCode). MongoDB indexes are adequate. No relational integrity
problem exists that would justify the migration cost.

## 9. Would a modular monolith be sufficient?

**Yes — it already is one.** The current app is a modular monolith (routes →
controllers → services/repositories → models). The fix is to make the layering
consistent (remove dead `dietService`, normalize controller error handling,
enforce scope centrally), not to restructure into microservices.

## 10. What would a rewrite cost?

- Full rewrite (e.g., NestJS + TypeScript + new UI): **months of effort, high
  regression risk** for a system that is already 85–90% functional.
- Partial migration (TypeScript incrementally, keep Express/React): medium effort.
- In-place stabilization (the 25-stability-plan): days, low risk, directly
  addresses every known security/perf/correctness issue.

## Final recommendation

**KEEP CURRENT STACK — stabilize in place.**

- Complete the Part 5 attendance/report/enquiry gender-scope enforcement (P0).
- Fix the registration gender UI and diet delete gate (P1).
- Apply the performance fixes (P2).
- Clean dead code and align documentation (P3/P4).
- Optionally introduce TypeScript incrementally later; do not migrate the
  framework.

Rationale: the existing stack fully supports the application; the documented
slowness and security issues are implementation gaps fixable without a rewrite;
a rewrite would cost far more than it would return for a single-tenant gym
system.
