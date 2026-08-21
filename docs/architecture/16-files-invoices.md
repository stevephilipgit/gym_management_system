# 16 — Files / Uploads / Invoices

## Uploads

Two multer configurations exist:

1. **`routes/uploadRoutes.js`** — `POST /api/uploads` (adminAuth):
   - Disk storage to `uploads/`, filename `Date.now()-originalname`.
   - Filter: jpg/jpeg/png (extension + mimetype), **2 MB** limit.
   - Errors converted to 400 JSON.
   - **Not used by any frontend page** (frontend uploads via member routes).

2. **`routes/memberRoutes.js`** — inline multer for `/members/register` and
   `/members/:gymId`:
   - Same jpg/jpeg/png filter, **but no file size limit** (default multer limit
     applies; 2 MB is not enforced here).
   - Registration stores `photoUrl = /uploads/<file>`.

**Finding:** the register/update upload path lacks the 2 MB limit present on
`/api/uploads`. Also both write to `uploads/` relative to the backend process
cwd.

## Static serving

`server.js:126` serves `app.use("/uploads", express.static(...))` — uploaded
member photos are publicly readable without authentication (by design for photo
display, but the `uploads` directory at repo root is separate from
`backend/src/uploads`).

## Invoices — backend vs frontend

- **Backend invoice flow was REMOVED** (commit `8cc83d1` "remove dead invoice
  sharing flow"). There is no `invoiceController`, no `/api/invoices/*` route,
  no `SignedPdfLink` model. The DEPLOYMENT_GUIDE still documents invoice
  endpoints that do not exist. **DEAD.**
- **Frontend invoices are ACTIVE** via `admin/utils/invoicePdf.js`
  (`downloadMembershipInvoice`, jsPDF):
  - `AdminRegister.jsx:247` — after registration.
  - `AdminMembers.jsx:304,370` — bill mode and after renewal.
  - Includes diet page when a diet is selected.
  - Issuer name comes from `GET /admin/me` with fallback `"Giri Gym Admin"`.
- `utils/pdfGenerator.js` (backend, pdfkit) generates analytics PDFs
  (`/analytics/export-pdf`) and a `generateInvoicePDF` method that is **unused**
  by any route (the frontend generates invoices with jsPDF instead).

## Access control for generated files

- Analytics PDF: `POST /analytics/export-pdf` — adminAuth only (no role gate;
  any trainer/finance can export the finance PDF).
- CSV exports (`/reports/export/*`, `/enquiries/export/csv`) — adminAuth with the
  scope issues documented in [12-reports.md](12-reports.md) and
  [13-enquiries.md](13-enquiries.md).
- Uploaded photos: public static.

## Path traversal / filenames

- `uploadRoutes.js` filename: `Date.now()-originalname` after replacing spaces.
  `originalname` is client-controlled; a name like `../evil.jpg` would be
  embedded, but multer's `diskStorage` does **not** sanitize directory segments —
  the stored path is a flat filename with no path separator processing, so
  traversal risk is low but originalname is not fully sanitized (letters,
  `..`, slashes are preserved in the filename). Member routes use the same
  pattern (`Date.now() + "-" + originalname.replace(/\s+/g,"_")`).
