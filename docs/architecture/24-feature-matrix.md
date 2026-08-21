# 24 — Feature Matrix

Legend: Auth = adminAuth / public / superadmin; Scope = gender scope applied?
(✅ yes / ❌ no / ⚠️ partial / n/a not applicable)

| Feature | Frontend | Route | Backend endpoint | Controller | Service | Model | Auth | Scope | DB | Ext dep | Tests | Status | Risk |
|---------|----------|-------|------------------|------------|---------|-------|------|-------|----|---------|-------|--------|------|
| Login | `pages/Login.jsx` | /login | POST /api/admin/login | authController.login | captchaService | Admin | public + CAPTCHA | n/a | admins | Redis | loginSchema unit | IMPLEMENTED | LOW |
| Logout | AdminSidebar | — | POST /api/admin/logout | authController.logout | — | Admin | adminAuth | n/a | auditlogs | — | none | IMPLEMENTED | LOW |
| Session refresh | `utils/apiClient.js` | — | POST /api/admin/refresh | authController.refreshToken | — | Admin | public (cookie) | n/a | admins | — | none | IMPLEMENTED | MEDIUM |
| Dashboard | AdminDashboardHome | /admin | GET /finance/summary/today, /finance/income, /finance/analytics/* | paymentController | summaryService | DailySummary, FinanceLog, Member, PaymentLog | adminAuth | n/a (finance-wide) | indexed | — | none | IMPLEMENTED | MEDIUM (polling) |
| Members list | AdminMembers | /admin/members | GET /api/members | memberController.getAllMembers | memberRepository | Member | adminAuth | ✅ (⚠️ ?search= bypass) | members | — | none | IMPLEMENTED | MEDIUM |
| Register member | AdminRegister/RegisterForm | /admin/register | POST /api/members/register | memberController.registerMember | memberRepository + atomicCounter | Member | adminAuth | ✅ | members + financelogs + paymentlogs + dailysummaries + counters | — | none | IMPLEMENTED (UI gender bug) | MEDIUM |
| Member detail | AdminMembers/AdminUpdate | — | GET /api/members/:gymId | memberController.getMemberById | memberRepository | Member | adminAuth | ✅ | members | — | none | IMPLEMENTED | LOW |
| Update member | AdminMembers/AdminUpdate | /admin/update | PUT /api/members/:gymId | memberController.updateMember | memberRepository | Member | adminAuth | ✅ | members | — | none | IMPLEMENTED | LOW |
| Delete member | AdminMembers | — | DELETE /api/members/:gymId | memberController.deleteMember | memberRepository | Member | superadmin | ✅ | members | — | none | IMPLEMENTED | LOW |
| Renew member | AdminMembers | — | PUT /api/members/renew/:gymId | memberController.renewMember | memberRepository + summaryService | Member, FinanceLog, PaymentLog | adminAuth | ✅ | members + logs + summaries | — | none | IMPLEMENTED | MEDIUM |
| Dues | AdminDues | /admin/due | GET /api/members/due/list | memberController.getExpiringMembers | memberRepository | Member | adminAuth | ✅ | members | — | none | IMPLEMENTED | LOW |
| Packages CRUD | AdminManagePackages | /admin/packages | GET/POST/PUT/DELETE /api/packages | packageController | packageRepository | Package | reads adminAuth, writes superadmin | n/a | packages | — | none | IMPLEMENTED | LOW |
| Diet CRUD | AdminDietManager | /admin/diet-manager | GET/POST/PUT/DELETE /api/diets | dietController | (dietService unused) | Diet | adminAuth (DELETE not role-gated) | ❌ n/a | diets | — | none | PARTIALLY IMPLEMENTED | MEDIUM |
| Attendance punch | KioskAttendance | /kiosk-attendance | POST /api/attendance/search-punch | attendanceController.searchPunch | attendanceService | Attendance, Member | adminAuth | ❌ | attendance + members | Redis(sets/captcha no) | attendance.test service-level | PARTIALLY IMPLEMENTED | **HIGH** |
| Attendance punch (API) | (none) | — | POST /api/attendance/punch | attendanceController.markAttendance | attendanceService | Attendance, Member | adminAuth | ✅ | attendance | Google Sheets | attendance.test | IMPLEMENTED | LOW |
| Attendance punch-manual | (none) | — | POST /api/attendance/punch-manual | attendanceController.handleLatePunchManual | attendanceService | Attendance, Member | adminAuth | ❌ | attendance | — | none | PARTIALLY IMPLEMENTED | **HIGH** |
| Attendance history | (none) | — | GET /api/attendance/history/:memberId | attendanceController.getAttendanceHistory | attendanceService | Attendance, Member | adminAuth | ✅ | attendance | — | none | IMPLEMENTED | LOW |
| Attendance stats today | (none) | — | GET /api/attendance/stats/today | attendanceController.getTodayStats | attendanceService | Attendance | adminAuth | ❌ | attendance | — | none | PARTIALLY IMPLEMENTED | MEDIUM |
| Attendance logs | AttendanceFrontDesk | /admin/attendance-front-desk | GET /api/attendance/logs | attendanceController.searchAttendanceLogs | attendanceService | Attendance, Member | adminAuth | ✅ | attendance + members | — | none | IMPLEMENTED | LOW |
| Reports inactive | InactiveReportsPage | /admin/inactivity-reports | GET /api/reports/inactive | reportsController.getInactiveMembers | — | Member | adminAuth | ✅ (total count ❌) | members | — | none | PARTIALLY IMPLEMENTED | MEDIUM |
| Reports CSV | InactiveReportsPage | — | GET /api/reports/export/* | reportsController | — | Attendance, Member | adminAuth | ⚠️ attendance & inactive exports ❌ | attendance + members | — | none | PARTIALLY IMPLEMENTED | **HIGH** |
| Enquiries public | Home + EnquiryModal | / | POST /api/enquiries | enquiryController.submitEnquiry | emailService + googleSheetsService | Enquiry | public + rate limit | gender defaults Male | enquiries | SMTP, Google Sheets | none | IMPLEMENTED | MEDIUM |
| Enquiries admin | AdminEnquiries | /admin/enquiries | GET/PATCH/DELETE /api/enquiries... | enquiryController | — | Enquiry | adminAuth; DELETE superadmin | ⚠️ ?gender override | enquiries | — | none | PARTIALLY IMPLEMENTED | **HIGH** |
| Settings | SettingsPage | /admin/settings | GET/PUT /api/settings | systemSettingsController | systemSettingsService | SystemSettings | superadmin | n/a | systemsettings | — | none | IMPLEMENTED | LOW |
| AI assistant | AiAssistant | /admin/ai-assistant | POST /api/ai/chat, /confirm | (route inline) | chatService, agentRunner, aiClient | Member (read) | superadmin | ❌ (tools query all) | members | Gemini | none | IMPLEMENTED | MEDIUM |
| Uploads | AdminRegister/AdminMembers | — | POST /api/members/register (multer) | memberController | — | — | adminAuth | n/a | disk | — | none | IMPLEMENTED | LOW |
| Invoices (frontend) | AdminRegister/AdminMembers | — | (jsPDF client-side) | — | — | — | n/a | n/a | — | jsPDF | none | IMPLEMENTED | LOW |
| Google Sheets | SettingsPage → GoogleSheetsConnector | — | GET/POST /api/connectors/google-sheets/* | googleSheetsConnectorController | googleSheetsService + attendanceSyncService | GoogleSheetsConnector | superadmin | n/a | connectors | Google Sheets API | none | PARTIALLY IMPLEMENTED (OAuth stubbed) | LOW |
| Health | (n/a) | — | GET /api/health, /api/health/info | healthController | — | — | public | n/a | — | Redis | none | IMPLEMENTED | LOW |
| Public homepage | Home | / | GET /api/public/packages, /api/public/check-member | packageController, memberController | — | Package, Member | public | n/a | packages + members | — | none | IMPLEMENTED | LOW |
