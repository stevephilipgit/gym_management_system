# 09 — Packages

## Model (models/Package.js)

```
name: String (required), months: Number (required),
priceWeightLoss, priceWeightGain, priceTransformation: Number (required)
```

No `trainingType` field — pricing is per training type via three price columns.
The repository method `findByTrainingType` (`packageRepository.js:57-59`) queries
`{ trainingType }` against a schema that has no such field → returns nothing.
**DEAD / BUG** (no route calls it; `packageController.getByTrainingType` exists
but is not routed).

## Endpoints (routes/packageRoutes.js)

| Method | Path | Auth | Controller |
|--------|------|------|------------|
| GET | / | adminAuth | getAllPackages |
| POST | / | adminAuth + requireRole(superadmin) | createPackage |
| PUT | /:id | adminAuth + requireRole(superadmin) | updatePackage |
| DELETE | /:id | adminAuth + requireRole(superadmin) | deletePackage |

**Delete authorization:** ✅ superadmin-only, satisfying the global rule
"ONLY SUPERADMIN can access DELETE routes."

## Validation (schemas/packageSchema.js)

- create/update: name 1-100, months integer 1-24, prices ≥ 0.

## Frontend

- `AdminManagePackages.jsx` (superadmin RoleGuard + sidebar hidden for others):
  GET /packages (L42), PUT /packages/:id (L75), POST /packages (L78),
  DELETE /packages/:id (L110).
- `AdminRegister.jsx:68`, `AdminMembers.jsx:68` read `/packages` to render the
  plan dropdown; `Home.jsx:174` reads the public `/public/packages` endpoint
  (packageController.getAllPackages is reused for the public route — public
  visibility of package pricing is intended).

## Notes

- Public `GET /public/packages` exposes package names/prices to the homepage —
  by design (marketing).
- No package→member referential checks on delete; deleting a package in use only
  breaks future selection, existing members keep their stored plan name.
