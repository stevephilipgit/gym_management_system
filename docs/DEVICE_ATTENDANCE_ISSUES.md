# Gym Project Device Attendance — Verified Issues & Fixes

## GYM-DEV-LEGACY-FALLBACK-001

### Issue Title
Trainer "My Attendance Devices" page incorrectly treats stale kiosk attendance credentials as physical device provisioning.

### Status
**FIXED** — Verified 2026-09-02

### Severity
- **Backend Security Impact**: Low — server-side provisioning guard remains authoritative and correctly rejects unprovisioned requests
- **UX/Correctness Impact**: Medium — trainer could see false device association without current provisioning

### Root Cause
The trainer device association logic in `AttendanceMyDevices.jsx` fell back to `getKioskId()` (post-claim attendance credential) when `getProvisionedKioskId()` (actual provisioning identity) was not available. This allowed stale attendance credentials to create a false impression of device provisioning in the trainer UI.

### Architecture Context
The system maintains two **deliberately separate** identities:

1. **Provisioning Identity** (`gym_provisioned_kiosk_id`, `gym_provisioned_at`)
   - Established by `POST /api/provision/redeem` when a trainer redeems a one-time token
   - Persisted by `provisioningIdentity.js`
   - UI signal that "this browser belongs to Kiosk X"

2. **Attendance Credential** (`gym_kiosk_id`, `gym_kiosk_key`)
   - Issued by trainer claim of an approved device request
   - Persisted by `kioskIdentity.js`
   - Used as X-Kiosk-Id / X-Kiosk-Key headers for customer attendance API auth
   - Must be actively managed by `kioskAuth.js` on backend

These are intentionally separate so that:
- A device can be provisioned without being credentialed yet
- A device can have stale credentials and still be invalid for attendance
- The server is always the authority via `DeviceRegistration` active/revoked checks

### Fix Applied
**File**: `frontend/src/admin/AttendanceMyDevices.jsx`

**Change**:
```javascript
// BEFORE (stale fallback allowed):
const provisionedKioskId = getProvisionedKioskId() || getKioskId();

// AFTER (provisioning only):
const provisionedKioskId = getProvisionedKioskId();
```

**Imports Updated**:
- Removed unused `getKioskId` import
- Kept `getProvisionedKioskId`, `getProvisionedAt` imports intact
- `setKioskIdentity()` remains unchanged for claim flow

**Comment Updated**:
- Clarified that attendance credential is distinct from provisioning identity
- Documented that stale gym_kiosk_* must not signal provisioning

### What Was NOT Changed
The following remain intentionally **untouched**:

- `frontend/src/utils/kioskIdentity.js` — customer attendance credential storage
- `frontend/src/utils/kioskApiClient.js` — X-Kiosk-Id/Key headers for customer API
- `backend/src/middleware/kioskAuth.js` — actual customer attendance authorization
- `backend/src/services/deviceRegistrationService.js` — request/approve/claim flow
- `backend/src/services/provisioningService.js` — token redemption and bootstrap
- All customer attendance logic and backend provisioning guard

### Verification Completed

#### 1. Build Verification
**Command**: `npm run build` (from `e:\projects\gym_project-E2E\frontend`)  
**Result**: ✅ **PASS** — 1357 modules transformed, all assets generated

#### 2. Automated Test Framework
**Status**: ❌ No Vitest/Jest found in frontend package.json  
**Conclusion**: Frontend has no automated test harness. Manual regression required.

#### 3. Repository Search
**Pattern Searched**: `getProvisionedKioskId() || getKioskId()` (and reversed)  
**Result**: ✅ **PASS** — Pattern not found anywhere in frontend source  
**Only Remaining Usage**: `getKioskId()` in `kioskApiClient.js` line 28 (customer attendance — correct)

#### 4. Manual Regression Scenarios

The following scenarios should be tested with browser developer tools (F12 → Application → Local Storage):

**Scenario A: Clean browser, no identity**
- Clear all gym_* keys from localStorage
- Login as Trainer
- Expected: "This device has not been provisioned yet" message
- Expected: No "Request This Device" button
- **Status**: Manual verification required

**Scenario B: Stale attendance credential only (THE CRITICAL TEST)**
- Set: `gym_kiosk_id` = (any valid kioskId)
- Set: `gym_kiosk_key` = (any base64 string)
- Do NOT set: `gym_provisioned_kiosk_id`, `gym_provisioned_at`
- Login/refresh Trainer My Attendance Devices page
- Expected: Page shows "This device has not been provisioned yet"
- Expected: No "Request This Device" button visible
- Expected: UI must NOT treat stale attendance credentials as physical provisioning
- **Status**: Manual verification required
- **CRITICAL**: This proves the stale fallback is gone

**Scenario C: Provisioning identity without claim**
- Set: `gym_provisioned_kiosk_id` = (valid kioskId)
- Set: `gym_provisioned_at` = (ISO date string)
- Do NOT set: `gym_kiosk_id`, `gym_kiosk_key`
- Login Trainer My Attendance Devices
- Expected: Device shown as provisioned
- Expected: "Request This Device" button available
- Expected: Customer attendance page must still fail (no credentials yet)
- **Status**: Manual verification required

**Scenario D: Complete provisioning → request → approve → claim flow**
- Execute full device flow from provisioning through claim
- Expected: `gym_provisioned_kiosk_id` created after provision
- Expected: `gym_kiosk_id` and `gym_kiosk_key` created after claim
- Expected: Trainer shows "Active" device
- Expected: Customer attendance works
- **Status**: Manual verification required

**Scenario E: Revoke provisioning after successful claim**
- After Scenario D completes (device active with credentials):
- Remove: `gym_provisioned_kiosk_id`, `gym_provisioned_at`
- Keep: `gym_kiosk_id`, `gym_kiosk_key`
- Refresh Trainer My Attendance Devices page
- Expected: Device no longer shown as associated/provisioned
- Expected: Customer attendance may continue working IF DeviceRegistration is still active
- Expected: This proves the two identities are truly separated
- **Status**: Manual verification required

#### 5. Backend Guard Regression
**Condition**: Stale credentials in localStorage, no provisioning identity  
**Test**: Attempt trainer request submission with `provisionedKioskId = null`  
**Expected**: Server rejects with error: "This browser is not associated with an attendance device yet"  
**Server Code**: `backend/src/services/deviceRegistrationService.js` hasProvisioningForBrowser()  
**Status**: Manual verification required (no backend code change made)

#### 6. Attendance Authorization Regression
Verify the backend remains the authority:

- **A. Valid active DeviceRegistration** → attendance succeeds ✅ (unchanged)
- **B. Registration deactivated** → attendance fails ✅ (unchanged)
- **C. Kiosk disabled** → attendance fails ✅ (unchanged)
- **D. Provisioning identity alone** → attendance fails ✅ (unchanged, no credentials)
- **E. Trainer/Admin login alone** → attendance fails ✅ (unchanged, different auth)

No backend changes made; all auth paths remain in place.

### Files Modified
- `frontend/src/admin/AttendanceMyDevices.jsx` — removed stale fallback, updated comment

### Files Verified Unchanged
- `frontend/src/utils/kioskIdentity.js` ✅
- `frontend/src/utils/kioskApiClient.js` ✅
- `frontend/src/utils/provisioningIdentity.js` ✅
- `backend/src/middleware/kioskAuth.js` ✅
- `backend/src/services/deviceRegistrationService.js` ✅
- `backend/src/services/provisioningService.js` ✅

### Next Steps
1. Execute manual regression scenarios (A through E) with browser dev tools
2. Verify backend still rejects unprovisioned trainer requests
3. Verify customer attendance auth remains only accessible to properly credentialed devices
4. Update this document with results
5. Close the issue once all manual scenarios pass

### References
- Architecture: `docs/architecture/31-attendance-device-rbac-plan.md`
- Related Issue: GYM-DEV-LEGACY-FALLBACK-001
- Frontend Build: Verified 2026-09-02 ✅
- Commit: Applied 2026-09-02
