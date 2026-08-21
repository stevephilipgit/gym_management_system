# 02 — Frontend Architecture

## Stack (verified from `frontend/package.json`)

| Concern | Choice | Why (evidence) |
|---------|--------|----------------|
| Framework | React 19.2 | `react: ^19.2.0` |
| Bundler | Vite 7.2 | `vite.config.js`; `@vitejs/plugin-react` |
| Compiler | babel-plugin-react-compiler | `vite.config.js` `plugins.react.babel.plugins` |
| Routing | react-router-dom 7 | `App.jsx` |
| Styling | Tailwind 3.4 + 4300-line custom CSS + inline styles | `tailwind.config.cjs`, `index.css`, heavy inline `style={}` in feature pages |
| State | React Context + useState only | `authContext.js`, `AdminLayout.jsx`; no Redux/Zustand |
| HTTP | axios (`utils/apiClient.js`) | base `/api`, `withCredentials`, 401→refresh interceptor |
| Charts | recharts 3.6 | `AdminDashboardHome.jsx` |
| Dates | date-fns, react-datepicker | `package.json`, SettingsPage |
| PDF (client) | jspdf | `admin/utils/invoicePdf.js` |
| Icons | react-icons | everywhere |
| Sanitization | dompurify (declared, UNUSED) | `utils/sanitizeHtml.js` has no importer |
| Linting | ESLint 9 flat config | `eslint.config.js` |

No TypeScript. No test framework for the frontend.

## Entry flow

```
index.html → src/main.jsx
  → initializeTheme() (theme.js)
  → validateEnv() (envCheck.js, warns only)
  → <StrictMode><App/></StrictMode>
    → App.jsx: <BrowserRouter>
      → /  (Home, public)
      → /login (Login, public)
      → /kiosk-attendance (KioskAttendance, public page)
      → /admin/* → <AuthGuard><AdminLayout/></AuthGuard>
          → AuthGuard fetches GET /admin/me once → AdminContext.Provider
          → AdminLayout → AdminSidebar + AdminHeader + <Outlet/>
          → feature page (lazy)
```

All pages except `ErrorBoundary`, `AuthGuard`, `RoleGuard` are `React.lazy`
(`App.jsx:3-30`) under one `<Suspense>`.

## Route guard model

- `AuthGuard` (`admin/components/Authguard.jsx`): calls `GET /admin/me`; `null` →
  "Checking...", `false` → `<Navigate to="/login">`, success → provides admin via
  `AdminContext` and `cloneElement(children, { admin })`.
- `RoleGuard` (`admin/RoleGuard.jsx`): `canAccess(admin?.role, roles)` from
  `authContext.js`; superadmin always passes; missing roles list → all roles.
  Guarded routes in `App.jsx`: `/admin/packages`, `/admin/fields`,
  `/admin/ai-assistant`, `/admin/settings` (all `roles={["superadmin"]}`).
- Sidebar visibility matches the guards: Packages / AI Assistant / Form Fields /
  Settings are superadmin-only (`AdminSidebar.jsx:44,46,47,61`).

**Note:** frontend guards are UX only. The backend is the security boundary
(see [05-authorization.md](05-authorization.md)).

## Current-admin state

- Stored only in React memory (Context + props). Not persisted in localStorage.
- Session is the httpOnly cookie; `apiClient.js` transparently refreshes on 401
  (single-flight `POST /admin/refresh`, queue + retry, else redirect to /login).
- `GET /admin/me` is fetched **four separate times** across the app
  (AuthGuard, AdminMembers, AdminRegister, RegisterForm) instead of being shared.

## API layer quirks

- `AttendanceFrontDesk.jsx:75`, `InactiveReportsPage.jsx:19-22,56-59`, and
  `DietSelector.jsx:23,40` use raw `fetch` with `credentials: "include"`,
  **bypassing the axios 401-refresh interceptor**. After an expired access token
  these pages fail until a page reload re-triggers auth via another component.
- `Home.jsx` and `KioskAttendance.jsx` use the axios client for public calls.

## Styling reality

Three coexisting systems:
1. Tailwind utility classes (`p-6`, `md:hidden`, `dark:bg-gray-900`).
2. A large custom CSS `index.css` with `@layer components` (`.page-shell`,
   `.glass-*`, `.btn-*`, `.sidebar-*`, `.admin-login-*`, `.lp-*`, `.kiosk-*`,
   `.enq-*`) and CSS-variable theming (`:root[data-theme]`, dark default).
3. Heavy inline `style={{}}` objects in SettingsPage, AdminEnquiries,
   AdminRegister, AdminMembers, AttendanceFrontDesk, PunchModal.

## Notable frontend findings

- `AdminRegister.jsx` never renders a gender field; it always submits
  `gender: "Male"` (`AdminRegister.jsx:12,204,272`). Backend will reject a
  female_plus_transgender-scoped admin attempting to register (403), and the
  page silently registers everyone as Male for `all`/`male` scopes.
- `RegisterForm.jsx` (used by AdminUpdate and AdminMembers edit modal) *does*
  scope the gender dropdown from `admin.scope` (`RegisterForm.jsx:197-215`).
- Dead UI: `MembershipCheckSection`, `MemberValidityCheck`,
  `useFormValidation`, `validation.js`, `sanitizeHtml.js`, `soundManager.js`,
  orphan `AdminUpdate.jsx` route.
- Vepery branch exists in Settings/AdminEnquiries but the public enquiry modal
  only offers `BRANCHES = ['Mathur']` (`EnquiryModal.jsx:9`).
