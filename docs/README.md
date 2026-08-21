# Giri Gym — System Documentation

Authoritative, code-verified technical documentation for the Giri Gym management
application. This documentation was produced by reading the actual source code —
not by trusting READMEs, comments, or deployment guides. Where documentation and
implementation disagree, the implementation is reported as the source of truth
and the discrepancy is explicitly flagged.

## Repository

- Location: `E:\projects\gym_project-E2E`
- Active branch: `feature/gender-scope-access-control`
- Backend: `backend/` (Node.js + Express + MongoDB)
- Frontend: `frontend/` (React + Vite)

## Documentation map

| File | Topic |
|------|-------|
| [architecture/00-system-overview.md](architecture/00-system-overview.md) | What the system is, top-level flow, classification legend |
| [architecture/01-repository-structure.md](architecture/01-repository-structure.md) | Complete file/directory inventory |
| [architecture/02-frontend-architecture.md](architecture/02-frontend-architecture.md) | Frontend stack, routing, state, API layer |
| [architecture/03-backend-architecture.md](architecture/03-backend-architecture.md) | Backend stack, startup sequence, middleware pipeline |
| [architecture/04-authentication.md](architecture/04-authentication.md) | Login E2E, JWT, cookies, CAPTCHA, rate limiting |
| [architecture/05-authorization.md](architecture/05-authorization.md) | RBAC roles, route matrix, gender scope |
| [architecture/06-session-management.md](architecture/06-session-management.md) | Cookies, refresh, logout, session isolation |
| [architecture/07-dashboard.md](architecture/07-dashboard.md) | Finance dashboard E2E, polling, charts |
| [architecture/08-members.md](architecture/08-members.md) | Member lifecycle, gym ID / member code system |
| [architecture/09-packages.md](architecture/09-packages.md) | Package CRUD and authorization |
| [architecture/10-diet.md](architecture/10-diet.md) | Diet manager, diet mappings, gender scoping |
| [architecture/11-attendance.md](architecture/11-attendance.md) | Attendance, kiosk, search-punch, scope gaps |
| [architecture/12-reports.md](architecture/12-reports.md) | Reports and CSV exports |
| [architecture/13-enquiries.md](architecture/13-enquiries.md) | Public enquiries, admin management, gender classification |
| [architecture/14-settings.md](architecture/14-settings.md) | SystemSettings model, service, cache, dead settings |
| [architecture/15-ai.md](architecture/15-ai.md) | AI assistant, Gemini, tools, confirmation flow |
| [architecture/16-files-invoices.md](architecture/16-files-invoices.md) | Uploads, PDFs, invoices (dead/broken parts) |
| [architecture/17-database.md](architecture/17-database.md) | Complete database map, collections, indexes |
| [architecture/18-redis-cache.md](architecture/18-redis-cache.md) | Every Redis usage, failure behavior |
| [architecture/19-security.md](architecture/19-security.md) | Security audit with severities and evidence |
| [architecture/20-performance.md](architecture/20-performance.md) | Performance audit with classifications |
| [architecture/21-testing.md](architecture/21-testing.md) | Test inventory and feature coverage map |
| [architecture/22-deployment.md](architecture/22-deployment.md) | Deployment reality vs. documented claims |
| [architecture/23-user-journeys.md](architecture/23-user-journeys.md) | 16 E2E user journeys |
| [architecture/24-feature-matrix.md](architecture/24-feature-matrix.md) | Master feature matrix |
| [architecture/25-stability-plan.md](architecture/25-stability-plan.md) | Prioritized stabilization plan |
| [architecture/26-migration-assessment.md](architecture/26-migration-assessment.md) | Evidence-based migration decision |
| [architecture/27-production-hardening.md](architecture/27-production-hardening.md) | Implementation record for the hardening pass |
| [architecture/28-multi-admin-sessions.md](architecture/28-multi-admin-sessions.md) | Per-session cookies + same-browser tab isolation |

## How to read this documentation

- Every important claim cites the source file and function/route that proves it.
- Items that could not be proven from code are explicitly marked:
  `UNKNOWN — requires clarification`.
- Each feature is classified:
  `IMPLEMENTED | PARTIALLY IMPLEMENTED | BROKEN | DEAD / UNUSED | DUPLICATED | SECURITY RISK | PERFORMANCE RISK`.
- The feature-level status of every module is summarized in
  [architecture/00-system-overview.md](architecture/00-system-overview.md).

## Quick orientation

```
Browser (React SPA)
  → apiClient (axios, withCredentials, 401-refresh)
  → Express server.js
  → helmet / CORS / sanitizer / hpp / auditLogger / rate limit
  → route (adminAuth → requireRole → validation)
  → controller
  → service / repository
  → MongoDB (+ Redis for rate limits & CAPTCHA only)
  → response → React render
```

Full walk-through: [architecture/03-backend-architecture.md](architecture/03-backend-architecture.md)
and [architecture/02-frontend-architecture.md](architecture/02-frontend-architecture.md).
