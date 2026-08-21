# 10 — Diet Manager

## Model (models/Diet.js)

```
name: String (required, unique), description: String, isActive: Boolean (default true)
```

`DietMapping.js`: `{ trainingTypeId: String (unique), dietId: ref Diet }` — one
default diet per training type.

## Endpoints (routes/dietRoutes.js) — no role gating

| Method | Path | Auth | Controller |
|--------|------|------|------------|
| POST | / | adminAuth + Joi | createDiet |
| GET | / | adminAuth | getAllDiets |
| GET | /:id | adminAuth | getDietById |
| PUT | /:id | adminAuth + Joi | updateDiet |
| DELETE | /:id | adminAuth | deleteDiet |

**Security finding:** `DELETE /api/diets/:id` has **no `requireRole`**. Any
trainer or finance admin can delete diets. `AdminDietManager.jsx:61` exposes the
delete button to every role (the route is not RoleGuard-wrapped in App.jsx:65).
This is a **security/authorization gap** (should be superadmin-only like
packages/fields).

## Flow

```
AdminDietManager.jsx
  GET /diets                → dietController.getAllDiets
  POST /diets               → createDiet
  PUT /diets/:id            → updateDiet
  DELETE /diets/:id         → deleteDiet
  GET /diets/mapping/:trainingType   → DietSelector (raw fetch)
Member registration / edit
  GET /diets/:id            → AdminRegister reads the diet for the invoice
  GET /diets/mapping/:trainingType   → DietSelector picks default diet
```

`dietService.js` exists (createDiet, mappings, soft-delete via isActive) but is
**UNUSED** — `dietController.js` operates directly on the `Diet` model.
`dietController.deleteDiet` does a hard `findByIdAndDelete` (not the soft delete
dietService implements).

## Gender scoping

**None.** The diet model, controller, and service have no `gender` concept.
Diets are global. There is no male/female/transgender diet partitioning, and no
gender-based access control on diet endpoints. Member `dietId` is set during
registration/renewal (`memberController.js`). This module was not part of the
gender-scope plan (parts 1–3 applied scope to members/enquiries/reports/
attendance, not diets).

## IDOR risk

Diet endpoints take ObjectIds; any authenticated admin can read/update/delete
any diet by ID (no per-diet authorization). Given diets are global and
non-sensitive this is low-impact, except the missing role gate on DELETE.
