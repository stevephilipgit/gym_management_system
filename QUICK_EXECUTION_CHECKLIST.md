# Quick Execution Checklist for Implementation

## Pre-Implementation Setup (do this first)

### Prerequisites Validation
- [ ] **Git Repo**: Current code is committed to git (for rollback if needed)
- [ ] **Backup**: Full database backup taken and tested
- [ ] **Team**: Assigned 1 backend + 1 frontend developer minimum
- [ ] **Environment**: Development, staging, and production environments available
- [ ] **CI/CD**: Deployment pipeline tested (if automated)

### Environment Setup
```bash
# Backend: Install new packages
cd gym_project_backend
npm install pdfkit node-cron

# Create .env file with:
SHARE_TOKEN_SECRET=your-min-32-char-secret-key-here
DOMAIN=http://localhost:5000  # or your domain

# Frontend: No new packages needed
# All components use existing React
```

---

## PHASE 1: Database (Do First - Lowest Risk)

### Step 1: Prepare Database Migration

**Task**: Review & prepare `addFeatures.sql`

From **CODE_MODIFICATIONS_REFERENCE.md**, copy the entire SQL migration script and save as:
```
gym_project_backend/migrations/addFeatures.sql
```

**Checklist**:
- [ ] File created at correct path
- [ ] SQL syntax valid (test in MySQL client)
- [ ] Contains all 5 feature schemas
- [ ] Backup command included in comments

### Step 2: Test Migration on Development

**Command**:
```bash
# Connect to dev database
mysql -u root -p dev_gym_database < gym_project_backend/migrations/addFeatures.sql

# Verify tables created:
SHOW TABLES LIKE 'diet%';      # Should show: diets, diet_training_type_mapping
SHOW TABLES LIKE 'signed%';    # Should show: signed_pdf_links

# Verify indexes:
SHOW INDEXES FROM members WHERE Column_name = 'phone';
SHOW INDEXES FROM payment_logs WHERE Column_name IN ('transactionDate', 'transactionType');
```

**Result Expected**:
```
✓ 3 new tables created
✓ 3 tables modified (members, payment_logs, and implicit changes)
✓ 5+ new indexes created
✓ No errors in application queries
```

- [ ] All migrations executed successfully
- [ ] All tables visible in MySQL
- [ ] All indexes created
- [ ] No constraint violations
- [ ] Data integrity verified

### Step 3: Validate Constraints in Development

**Test UNIQUE Phone Constraint**:
```javascript
// In Node REPL or script:
const Member = require('./models/Member');

// Try to create duplicate phone - should fail
await Member.create({ 
  firstName: 'Test', 
  lastName: 'User',
  phone: '9876543210'  // Already exists
});
// Expected error: duplicate key error
```

- [ ] Duplicate phone insertion rejected
- [ ] Error handling returns 400 status
- [ ] Existing valid data preserved

### Step 4: Backup Production (If going live this week)

```bash
# SSH into production server
ssh user@prod-server

# Backup command
mysqldump -u admin -p gym_database > /backups/gym_database_pre_features_$(date +%Y%m%d).sql

# Verify backup size (should be several MB minimum)
ls -lh /backups/gym_database_pre_features_*.sql
```

- [ ] Backup created successfully
- [ ] Backup file >5MB (has data)
- [ ] Backup can be restored (test on staging)
- [ ] Backup path documented

---

## PHASE 2: Backend (Core Logic - 2-3 Days)

### Step 5: Create Utility Files

**Create**: `gym_project_backend/utils/phoneFormatter.js`
- [ ] Copy code from **CODE_MODIFICATIONS_REFERENCE.md**
- [ ] Test: `node -e "require('./utils/phoneFormatter').formatPhoneForStorage('9876543210')"`
- [ ] Expected output: `"9876543210"`

**Create**: `gym_project_backend/utils/tokenSigner.js`
- [ ] Copy code from reference document  
- [ ] Test token generation & verification
- [ ] Confirm tokens are 64-char hex strings

**Create**: `gym_project_backend/utils/pdfGenerator.js` (Enhanced version)
- [ ] Copy updated code
- [ ] Test: `npm test` for PDF generation
- [ ] Verify multi-page PDF support

**Verify All Utils**:
```bash
# Quick syntax check
node -c utils/phoneFormatter.js
node -c utils/tokenSigner.js
node -c utils/pdfGenerator.js
```

- [ ] No syntax errors in any util
- [ ] All three files created
- [ ] Each util independently testable

### Step 6: Create Models

**Create**: `gym_project_backend/models/Diet.js`
- [ ] Copy from reference
- [ ] Verify schema exports correctly
- [ ] Test: `require('./models/Diet')`

**Create**: `gym_project_backend/models/DietMapping.js`
- [ ] Copy from reference
- [ ] Verify foreign keys configured

**Create**: `gym_project_backend/models/SignedPDFLink.js`
- [ ] Copy from reference
- [ ] Verify TTL index configuration

**Update**: `gym_project_backend/models/Member.js`
- [ ] Find the schema definition
- [ ] Add these fields:
  ```javascript
  phone: { type: String, required: true, trim: true, unique: true, match: /^\d{10}$/ },
  dietId: { type: mongoose.Schema.Types.ObjectId, ref: 'Diet', default: null },
  dietIncludedInLastBilling: { type: Boolean, default: false }
  ```

**Update**: `gym_project_backend/models/PaymentLog.js`
- [ ] Add these fields:
  ```javascript
  dietId: { type: mongoose.Schema.Types.ObjectId, ref: 'Diet', default: null },
  dietName: { type: String, default: null }
  ```

- [ ] All 3 new models created
- [ ] 2 existing models modified
- [ ] No syntax errors: `node -c models/Diet.js`

### Step 7: Create Services

**Create**: `gym_project_backend/services/analyticsService.js`
- [ ] Copy from reference
- [ ] Verify all query aggregation pipelines have correct stages
- [ ] Test: Query a date range and verify results structure

**Create**: `gym_project_backend/services/dietService.js`
- [ ] Copy from reference
- [ ] Test CRUD operations
- [ ] Verify default diet mapping logic

**Verify Services**:
```bash
# In Node REPL
const analyticsService = require('./services/analyticsService');
const dietService = require('./services/dietService');

// Test analytics (should not error)
await analyticsService.getAnalyticsMetrics('2026-01-01', '2026-03-03');

// Test diet (should return empty array on fresh DB)
await dietService.getAllDiets();
```

- [ ] Both services load without errors
- [ ] Services return expected data structures
- [ ] Database queries execute successfully

### Step 8: Create Routes

**Create**: `gym_project_backend/routes/analyticsRoutes.js`
- [ ] Copy from reference
- [ ] Verify middleware usage (adminAuth)
- [ ] Verify query parameter handling

**Create**: `gym_project_backend/routes/dietRoutes.js`
- [ ] Copy from reference
- [ ] All CRUD endpoints present
- [ ] All mapping endpoints present

**Create**: `gym_project_backend/routes/invoiceRoutes.js`
- [ ] Copy from reference
- [ ] Verify auth middleware
- [ ] Verify token generation logic

**Create**: `gym_project_backend/routes/publicRoutes.js`
- [ ] Copy from reference
- [ ] Verify NO auth required for public endpoints
- [ ] Verify token download endpoint present

**Update**: `gym_project_backend/server.js`
- [ ] Add route imports:
  ```javascript
  const analyticsRoutes = require('./routes/analyticsRoutes');
  const dietRoutes = require('./routes/dietRoutes');
  const publicRoutes = require('./routes/publicRoutes');
  const invoiceRoutes = require('./routes/invoiceRoutes');
  ```
- [ ] Add route registrations (after existing routes):
  ```javascript
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/diets', dietRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/invoices', invoiceRoutes);
  ```

**Test All Routes**:
```bash
# Start server
npm start

# In another terminal, test each endpoint:
curl http://localhost:5000/api/diets
curl http://localhost:5000/api/public/check-member?phone=9876543210
# ... test each endpoint
```

- [ ] All 4 route files created
- [ ] server.js updated with route registrations
- [ ] Server starts without errors
- [ ] All endpoints respond (with data or appropriate errors)

### Step 9: Backend Testing

**Test Each Feature Endpoint**:

**Feature 1 - Analytics Export**:
- [ ] `GET /api/analytics/metrics` returns data
- [ ] `GET /api/analytics/export-pdf` returns PDF file
- [ ] PDF file is readable and has expected content

**Feature 2 - Diet Management**:
- [ ] `GET /api/diets` returns diet list
- [ ] `POST /api/diets` creates diet (admin only)
- [ ] `PUT /api/diets/:id` updates diet
- [ ] `DELETE /api/diets/:id` deletes diet
- [ ] `GET /api/diets/mapping/:trainingType` returns default diet

**Feature 3 - Membership Check**:
- [ ] `GET /api/public/check-member?phone=VALID` returns member
- [ ] `GET /api/public/check-member?phone=INVALID` returns 404
- [ ] Works WITHOUT auth token

**Feature 4 - Unique Phone**:
- [ ] Second member with same phone rejected with 400
- [ ] Error message contains "DUPLICATE_PHONE"

**Feature 5 - Share Links**:
- [ ] `POST /api/invoices/:id/generate-share-link` creates link
- [ ] `GET /api/public/invoices/share/:token` returns PDF
- [ ] `GET /api/public/invoices/share/:expired-token` returns 403

- [ ] All endpoints responding correctly
- [ ] All auth middleware working
- [ ] All error messages appropriate
- [ ] Backend ready for frontend integration

---

## PHASE 3: Frontend (UI Components - 2-3 Days)

### Step 10: Create New Components

**Create**: `giri-gym/src/components/MembershipCheckSection.jsx`
- [ ] Copy from reference document
- [ ] Verify styling inline or in CSS module
- [ ] No build errors: `npm run build`

**Create**: `giri-gym/src/components/InvoiceActions.jsx`
- [ ] Copy from reference
- [ ] Test buttons render without errors
- [ ] Verify WhatsApp link generation

**Create**: `giri-gym/src/components/DietSelector.jsx`
- [ ] Copy from reference
- [ ] Verify dropdown fetches diets from API
- [ ] Test with real diet data

**Create**: `giri-gym/src/admin/AdminDietManager.jsx`
- [ ] Copy from reference
- [ ] Verify form submission works
- [ ] Test CRUD operations through UI

**Verify Components**:
```bash
# Start dev server
npm run dev

# Check browser console for errors
# All components should load without React errors
```

- [ ] All 4 components created
- [ ] No console errors when components render
- [ ] Components accept expected props

### Step 11: Integrate Components into Pages

**Update**: `giri-gym/src/pages/Home.jsx`
- [ ] Add import: `import { MembershipCheckSection } from '../components/MembershipCheckSection';`
- [ ] Add to render: `<MembershipCheckSection />`
- [ ] Test membership lookup in browser

**Update**: `giri-gym/src/admin/AdminLayout.jsx`
- [ ] Add Diet Manager sidebar link (e.g., admin menu navigation)
- [ ] Test link navigation works
- [ ] Verify Diet Manager loads

**Update**: `giri-gym/src/admin/AdminRegister.jsx`
- [ ] Find where plan selection happens
- [ ] Add after plan selection:
  ```jsx
  <label>
    <input type="checkbox" {...} /> Include Diet Plan
  </label>
  {includeDiet && <DietSelector {...} />}
  ```
- [ ] Update form submission to include dietId
- [ ] Test registration with diet selected

**Update**: `giri-gym/src/admin/AdminDashboardHome.jsx`
- [ ] Find analytics display section  
- [ ] Add "Export as PDF" button
- [ ] Add handler to download PDF
- [ ] Test export with various date ranges

**Test Integrations**:
```bash
# Navigate to each page in browser
# Test feature 1: Dashboard export button
# Test feature 2: Admin diet manager CRUD
# Test feature 3: Home page membership check
# Test feature 5: Post-registration invoice actions
```

- [ ] All components integrated
- [ ] No console errors
- [ ] User flows work end-to-end
- [ ] UI matches existing design

### Step 12: Frontend Testing

**Manual Testing Scenarios**:

**Registration Flow with Diet**:
1. [ ] Click Admin → Register Member
2. [ ] Fill form + Select Plan
3. [ ] Check "Include Diet Plan"
4. [ ] Select diet from dropdown
5. [ ] Submit → Verify diet saved
6. [ ] See invoice + "Send via WhatsApp" button

**Membership Check**:
1. [ ] Go to Home
2. [ ] Scroll to "Check Membership Validity"
3. [ ] Enter valid member phone
4. [ ] Click "Check Status"
5. [ ] Verify result shows gymId, name, plan, validity date, status

**Analytics Export**:
1. [ ] Go to Admin Dashboard
2. [ ] Select date range (optional)
3. [ ] Click "Export as PDF"
4. [ ] Verify PDF downloads
5. [ ] Open PDF, verify content

**Diet Management**:
1. [ ] Go to Admin → Diet Manager
2. [ ] Create new diet
3. [ ] Edit diet
4. [ ] Delete diet
5. [ ] All operations success

**WhatsApp Sharing**:
1. [ ] Post-renewal, see "Generate WhatsApp Link"
2. [ ] Click button
3. [ ] See shareUrl and whatsappLink
4. [ ] Click "Send via WhatsApp"
5. [ ] WhatsApp opens in new tab with prefilled message

- [ ] All user flows tested
- [ ] No UI breaks
- [ ] All buttons functional
- [ ] Data persists correctly

---

## PHASE 4: Integration & Testing (1-2 Days)

### Step 13: End-to-End Testing

**Database + Backend + Frontend Connected**:

**Test Scenario 1 - New Member with Diet**:
```
1. Admin registers member with phone: 9876543210, diet: "High-Protein"
2. Verify: members table has dietId, phone unique
3. Verify: payment_logs table has dietId, dietName
4. Generate invoice → Verify PDF has 2 pages
5. Check membership lookup → Verify returns correct member
```

- [ ] Database stores all data correctly
- [ ] Invoice PDF generated with diet page
- [ ] All APIs returning correct data

**Test Scenario 2 - WhatsApp & Share Links**:
```
1. Generate share link for invoice
2. Verify token stored in signed_pdf_links
3. Open public URL → Download PDF via token
4. Wait expiration → Verify 403 Forbidden
5. WhatsApp link format correct
```

- [ ] Share tokens generating correctly
- [ ] Expiration working
- [ ] PDF download via public link working
- [ ] WhatsApp URLs formatted correctly

**Test Scenario 3 - Duplicate Phone**:
```
1. Try to register member with existing phone
2. Verify error: "Phone already registered"
3. Database constraint prevents duplicate
```

- [ ] Duplicate phone rejected at app level
- [ ] Duplicate phone rejected at DB level
- [ ] Appropriate error message shown

**Test Scenario 4 - Analytics Export**:
```
1. Perform 5+ transactions
2. Export analytics for date range containing transactions
3. Verify PDF shows correct totals
4. Verify breakdown by plan/training type correct
```

- [ ] Analytics queries accurate
- [ ] PDF contains all expected data
- [ ] Date filtering works

### Step 14: Load & Performance Testing

**Simple Load Test**:
```bash
# Test membership check with 1000 concurrent requests
ab -n 1000 -c 50 http://localhost:5000/api/public/check-member?phone=9876543210

# Expected: <100ms response time, 0% errors
```

**Query Performance**:
- [ ] Membership check completes in <100ms (index on phone)
- [ ] Analytics query completes in <2s (even with large dataset)
- [ ] PDF generation completes in <2s
- [ ] Share link generation completes in <500ms

**Storage & Cleanup**:
- [ ] Cron job deletes expired links daily
- [ ] Verify disk space not growing indefinitely
- [ ] View count tracking works

- [ ] All performance targets met
- [ ] No memory leaks
- [ ] Cron job executing

### Step 15: Security Testing

**Auth & Access Control**:
- [ ] Admin routes require auth token
- [ ] Public routes accessible without token
- [ ] Invalid token rejected with 401

**Token Security**:
- [ ] Share tokens are 64-char hex (HMAC-signed)
- [ ] Token doesn't leak payment log ID
- [ ] Token expires correctly
- [ ] Expired token can't be used

**Data Privacy**:
- [ ] Phone numbers not exposed in URLs
- [ ] PDF links use tokens, not IDs
- [ ] Database can't expose sensitive data via SQL injection (use parameterized queries)

**Phone Constraints**:
- [ ] Duplicate phones rejected
- [ ] Invalid phone formats rejected
- [ ] Phone formatting consistent

- [ ] All security checks passed
- [ ] No data exposure risks
- [ ] Auth working correctly

---

## PHASE 5: Staging & Production (1-2 Days)

### Step 16: Deploy to Staging

**Commands**:
```bash
# 1. Connect to staging server
ssh user@staging-server

# 2. Pull latest code
cd /var/www/gym-app
git pull origin main

# 3. Install npm packages
cd gym_project_backend
npm install

# 4. Run migrations (DO THIS CAREFULLY)
mysql -u staging_user -p staging_db < migrations/addFeatures.sql

# 5. Restart backend
systemctl restart gym-backend

# 6. Test all endpoints
curl http://staging.yourdomain.com/api/diets
curl http://staging.yourdomain.com/api/public/check-member?phone=9876543210

# 7. Check error logs
tail -f /var/log/gym-backend.log
```

- [ ] Code deployed to staging
- [ ] Database migrations successful
- [ ] All endpoints responding
- [ ] No errors in logs

### Step 17: Staging Acceptance Testing

**Admin Tests**:
- [ ] Create, edit, delete diet
- [ ] Export analytics PDF
- [ ] Register member with diet
- [ ] Generate WhatsApp share link

**Public Tests**:
- [ ] Check membership validity
- [ ] Download invoice via share link

**Data Integrity Tests**:
- [ ] Sample data persisted correctly
- [ ] Unique phone constraint enforced
- [ ] All relationships intact (foreign keys)

- [ ] All features working in staging
- [ ] No data corruption
- [ ] Performance acceptable
- [ ] Ready for production

### Step 18: Production Deployment

**Pre-Deployment Checklist**:
- [ ] Production database backup verified & tested
- [ ] Deployment steps documented
- [ ] Team ready to monitor
- [ ] Rollback plan in place
- [ ] Support team notified

**Deployment Steps**:
```bash
# SSH into production
ssh user@prod-server

# Backup current database
mysqldump -u prod_user -p prod_db > /backups/pre_features_$(date +%Y%m%d_%H%M%S).sql

# Deploy code
cd /var/www/gym-app
git pull origin main
cd gym_project_backend
npm install

# Run migrations (CRITICAL STEP)
mysql -u prod_user -p prod_db < migrations/addFeatures.sql

# Restart services
systemctl restart gym-backend

# Verify deployment
curl https://yourdomain.com/api/diets
tail -f /var/log/gym-backend.log
```

- [ ] Database backup successful
- [ ] Code deployed
- [ ] Migrations executed
- [ ] Service restarted
- [ ] Health checks pass

### Step 19: Post-Deployment Monitoring (72 hours)

**Hour 1 - Immediate Verification**:
- [ ] All endpoints responding
- [ ] Admin can log in
- [ ] Analytics export works
- [ ] Membership check works
- [ ] No critical errors in logs

**Hours 2-24 - Monitoring**:
- [ ] Monitor error logs for issues
- [ ] Check API response times
- [ ] Verify cron jobs running
- [ ] Monitor database performance
- [ ] Address any support tickets

**Days 2-3 - Stability Check**:
- [ ] No ongoing errors
- [ ] Performance stable
- [ ] User feedback positive
- [ ] Data integrity verified
- [ ] Can confirm successful launch

- [ ] Deployment stable
- [ ] No rollback needed
- [ ] Team confident in production
- [ ] System ready for daily use

---

## Final Verification Checklist (Before Going Live)

### Features Complete
- [ ] Feature 1: Analytics PDF export functional
- [ ] Feature 2: Diet management module complete
- [ ] Feature 3: Membership check by phone working
- [ ] Feature 4: Unique phone constraint enforced
- [ ] Feature 5: WhatsApp share links generating

### Database
- [ ] All 5 new tables exist
- [ ] All 5+ indexes created
- [ ] Phone unique constraint enforced
- [ ] Data integrity verified
- [ ] Backup tested & working

### APIs
- [ ] All 4 new routes operational
- [ ] Auth middleware working
- [ ] Public endpoints accessible
- [ ] Error handling appropriate
- [ ] Response formats consistent

### Frontend
- [ ] All 4 new components rendering
- [ ] Integration points updated
- [ ] User flows working end-to-end
- [ ] UI consistent with existing design
- [ ] No console errors

### Testing
- [ ] Unit tests passing
- [ ] Integration tests passing
- [ ] Smoke tests passing
- [ ] Performance targets met
- [ ] Security checks passed

### Documentation
- [ ] Architecture documented
- [ ] API endpoints documented
- [ ] Database schema documented
- [ ] Deployment guide written
- [ ] Troubleshooting guide created

### Team Readiness
- [ ] Admin team trained on features
- [ ] Support team briefed
- [ ] Emergency procedures documented
- [ ] On-call person assigned
- [ ] Rollback procedure tested

---

## Quick Reference: What Goes Where

### Backend New Files
```
gym_project_backend/
├── utils/
│   ├── phoneFormatter.js         ← NEW
│   ├── tokenSigner.js            ← NEW
│   └── pdfGenerator.js           ← MODIFIED (enhanced)
├── services/
│   ├── analyticsService.js       ← NEW
│   └── dietService.js            ← NEW
├── models/
│   ├── Diet.js                   ← NEW
│   ├── DietMapping.js            ← NEW
│   ├── SignedPDFLink.js          ← NEW
│   ├── Member.js                 ← MODIFIED (add fields)
│   └── PaymentLog.js             ← MODIFIED (add fields)
├── routes/
│   ├── analyticsRoutes.js        ← NEW
│   ├── dietRoutes.js             ← NEW
│   ├── invoiceRoutes.js          ← NEW
│   ├── publicRoutes.js           ← NEW
│   └── (existing routes)         ← UNCHANGED
├── server.js                     ← MODIFIED (register new routes)
├── migrations/
│   └── addFeatures.sql           ← NEW
└── .env                          ← MODIFIED (add new vars)
```

### Frontend New Files
```
giri-gym/src/
├── components/
│   ├── MembershipCheckSection.jsx ← NEW
│   ├── InvoiceActions.jsx         ← NEW
│   └── DietSelector.jsx           ← NEW
├── admin/
│   ├── AdminDietManager.jsx       ← NEW
│   ├── AdminLayout.jsx            ← MODIFIED (add diet link)
│   ├── AdminRegister.jsx          ← MODIFIED (add diet fields)
│   ├── AdminDashboardHome.jsx     ← MODIFIED (add export button)
│   └── (other admin pages)        ← UNCHANGED
├── pages/
│   └── Home.jsx                   ← MODIFIED (add membership check)
└── (other pages)                  ← UNCHANGED
```

---

## Common Issues & Quick Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| **Phone unique constraint error** | Duplicate data exists | Run cleanup query before enable constraint |
| **PDF export timeout** | Large dataset | Add index on payment_logs(date), increase timeout |
| **WhatsApp link doesn't work** | Phone format wrong | Check formatPhoneForWhatsApp function |
| **Token not found after 24h** | Link expired (working as designed) | Regenerate new share link |
| **Diet not showing in dropdown** | API not fetching | Check /api/diets endpoint, verify diets exist |
| **Export PDF button missing** | Frontend not updated | Check AdminDashboardHome.jsx modifications |
| **Membership check returns 404** | Phone not formatted correctly | User should enter 10 digits, leading zeros ok |
| **Share links not deleting** | Cron job not running | Check: `ps aux | grep cron`, verify NODE_ENV set |

---

## Success Criteria (After 1 Week)

- [ ] All 5 features deployed & working
- [ ] Zero critical bugs in production
- [ ] <1% support tickets about new features  
- [ ] >80% admin adoption of export feature
- [ ] >60% membership check usage
- [ ] >50% diet inclusion in registrations
- [ ] Response times within targets
- [ ] No data loss or corruption
- [ ] Admin team confident using new features
- [ ] Cron job running successfully

---

## Emergency Contact Procedures

**If Critical Issue (data loss, security breach)**:
1. **STOP** - Stop all deploys
2. **NOTIFY** - Contact CTO/Lead immediately
3. **ROLLBACK** - Execute rollback procedure (restore from backup)
4. **INVESTIGATE** - Post-mortem to identify root cause
5. **COMMUNICATE** - Notify stakeholders of status

**Rollback Command** (if needed):
```bash
ssh user@prod-server
systemctl stop gym-backend
mysql -u prod_user -p prod_db < /backups/pre_features_YYYYMMDD_HHMMSS.sql
git reset --hard <previous-commit-hash>
systemctl start gym-backend
```

---

**Document Last Updated**: 2026-03-03  
**Target Go-Live**: 4 weeks from task start  
**Point of Contact**: [Your Team Lead]

