# Gym Management System - Feature Implementation Guide

---

## FEATURE 1: Export Analytics as PDF

### Overview
Export currently filtered analytics data as PDF without duplicating calculation logic.

### Database Changes
**None** - Leverage existing `DailySummary` and transaction tables.

### Backend API Design

#### Endpoint: `GET /api/analytics/export-pdf`
```
Query Parameters:
- startDate (optional): YYYY-MM-DD
- endDate (optional): YYYY-MM-DD
- format: 'pdf' (reserved for future 'csv', 'excel')

Response:
- Content-Type: application/pdf
- Content-Disposition: attachment; filename="analytics_YYYY-MM-DD.pdf"
```

### Query Reuse Strategy

**Current flow assumption:**
- Dashboard likely queries `DailySummary` and `PaymentLog` to calculate metrics
- Extract these queries into a reusable service function: `calculateAnalyticsMetrics(startDate, endDate)`

**Proposed Service Layer** (`services/analyticsService.js`):
```javascript
// Consolidate all analytics queries
async getAnalyticsMetrics(startDate, endDate) {
  // Returns: {
  //   totalRevenue,
  //   newJoiningRevenue,
  //   renewalRevenue,
  //   totalTransactions,
  //   incomeByPlan: [{plan, amount, count}],
  //   incomeByTrainingType: [{type, amount, count}]
  // }
}

// Both Dashboard (frontend) and PDF export use same function
```

**Index Optimization:**
- Ensure `PaymentLog` has composite index: `(transactionDate, transactionType, status)`
- Ensure `DailySummary` has index: `(date)`

### PDF Generation Flow

**Library:** `pdfkit` or `node-pdf` (lightweight, no external dependencies)

**Implementation in Backend Route** (`routes/analyticsRoutes.js`):
```
1. Receive startDate, endDate from query params
2. Call analyticsService.getAnalyticsMetrics(startDate, endDate)
3. Pass metrics to PDF generator function
4. Set response headers (PDF mime type)
5. Pipe PDF stream to response
```

**PDF Structure:**
- Header: Company name, "Analytics Report"
- Date range: "Generated: [date], Period: [startDate] to [endDate]"
- Summary Section:
  - Total Revenue: ₹XX,XXX
  - New Joining Revenue: ₹XX,XXX
  - Renewal Revenue: ₹XX,XXX
  - Total Transactions: XXX
- Breakdown Tables:
  - Income by Plan (table: Plan Name | Count | Revenue)
  - Income by Training Type (table: Type | Count | Revenue)
- Footer: Generated timestamp

### Download Handling

**Frontend Implementation** (`AdminDashboardHome.jsx` or analytics component):
```javascript
// Button onClick handler
const exportAnalyticsPDF = async (filters) => {
  const params = new URLSearchParams({
    startDate: filters.startDate || '',
    endDate: filters.endDate || ''
  });
  
  const response = await fetch(`/api/analytics/export-pdf?${params}`);
  const blob = await response.blob();
  
  // Trigger browser download
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `analytics_${new Date().toISOString().split('T')[0]}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
```

### Implementation Checklist
- [ ] Create `analyticsService.js` with `getAnalyticsMetrics(start, end)`
- [ ] Update Dashboard to use `analyticsService` (eliminate duplicate queries)
- [ ] Create `generateAnalyticsPDF(metrics, dateRange)` utility
- [ ] Add `GET /api/analytics/export-pdf` route
- [ ] Add "Export as PDF" button to analytics dashboard
- [ ] Test with various date ranges
- [ ] Add indexes to `PaymentLog` and `DailySummary`

---

## FEATURE 2: Diet Management Module

### Database Schema Changes

#### New Tables

**`diets` table** (replace if exists):
```sql
CREATE TABLE diets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE,
  description LONGTEXT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deletedAt TIMESTAMP NULL
);

CREATE INDEX idx_diets_name ON diets(name);
```

**`diet_training_type_mapping` table** (optional, for default assignments):
```sql
CREATE TABLE diet_training_type_mapping (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trainingTypeId BIGINT NOT NULL,
  dietId BIGINT NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trainingTypeId) REFERENCES training_types(id) ON DELETE CASCADE,
  FOREIGN KEY (dietId) REFERENCES diets(id) ON DELETE CASCADE,
  UNIQUE KEY unique_mapping (trainingTypeId, dietId)
);
```

**Modify `members` table:**
```sql
ALTER TABLE members ADD COLUMN dietId BIGINT NULL;
ALTER TABLE members ADD COLUMN dietIncludedInLastBilling BOOLEAN DEFAULT FALSE;
ALTER TABLE members ADD FOREIGN KEY (dietId) REFERENCES diets(id) ON DELETE SET NULL;
```

**Modify `payment_logs` table:**
```sql
ALTER TABLE payment_logs ADD COLUMN dietId BIGINT NULL;
ALTER TABLE payment_logs ADD COLUMN dietName VARCHAR(255);
ALTER TABLE payment_logs ADD FOREIGN KEY (dietId) REFERENCES diets(id) ON DELETE SET NULL;
```

### Backend API Design

#### Diet Management Routes (`routes/dietRoutes.js`)

```
POST   /api/diets                 - Create diet
GET    /api/diets                 - List all diets (with soft delete filter)
PUT    /api/diets/:id             - Edit diet
DELETE /api/diets/:id             - Soft delete diet

GET    /api/diets/mapping/:trainingType - Get default diet for training type
POST   /api/diets/mapping         - Create mapping
DELETE /api/diets/mapping/:id     - Delete mapping
```

### Diet Model (`models/Diet.js`)

```javascript
const DietSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  deletedAt: { type: Date, default: null }
});

DietSchema.query.active = function() {
  return this.where({ deletedAt: null });
};
```

### Mapping Logic: Training Type → Default Diet

**Service** (`services/dietService.js`):
```javascript
async getDefaultDietForTrainingType(trainingTypeId) {
  // Query: diet_training_type_mapping WHERE trainingTypeId = ?
  // If exists, return diet details
  // If not, return null (allow manual selection)
}

async assignDietToMember(memberId, dietId) {
  // Update members.dietId
  // Set dietIncludedInLastBilling = false (until renewal/registration)
}
```

### Billing Integration Flow

**During Registration / Renewal:**

1. **Billing Page Frontend** (`AdminRegister.jsx` or billing step):
   - After plan selection, add checkbox: "Include Diet Plan?"
   - If checked:
     - Query `GET /api/diets/mapping/{trainingType}` for default diet
     - Display dropdown with all diets (`GET /api/diets`)
     - Allow override selection
     - Store selected diet in state

2. **Submit Billing** (`POST /api/members/register` or `/api/members/renew`):
   - Include `dietId` in request payload
   - Backend: Save to `members.dietId` and `payment_logs.dietId`

3. **Invoice PDF Generation** (`services/invoiceService.js`):
   - Query payment log + diet details
   - If `payment_logs.dietId` exists:
     - Add page 2: Diet Plan details
     - Include diet name, description

### Clean Architecture Approach

```
services/
  ├── dietService.js              (CRUD + mapping logic)
  ├── billingService.js           (updated: diet inclusion)
  └── pdfInvoiceService.js        (updated: multi-page PDF)

routes/
  ├── dietRoutes.js               (new: diet endpoints)
  ├── memberRoutes.js             (modified: billing include diet)
  └── packageRoutes.js            (unchanged)

models/
  ├── Diet.js                     (new)
  └── Member.js                   (modified: add dietId)
```

### PDF Invoice Structure (Multi-page)

**Use `pdfkit` page breaks:**
```javascript
// Page 1: Invoice (existing)
// Generate invoice details

// Page 2: Diet Plan (if dietId exists)
pdf.addPage();
pdf.fontSize(14).text('Diet Plan');
pdf.fontSize(10).text(`Plan: ${diet.name}`);
pdf.text(`Description:\n${diet.description}`);
```

### Implementation Checklist
- [ ] Create `diets` and `diet_training_type_mapping` tables
- [ ] Modify `members` and `payment_logs` schema
- [ ] Create `Diet.js` model
- [ ] Create `dietService.js` with CRUD and mapping functions
- [ ] Create `dietRoutes.js` with middleware auth
- [ ] Add Diet Manager sidebar in `AdminLayout.jsx`
- [ ] Create Diet management UI components (list, create, edit, delete)
- [ ] Update billing page: add diet checkbox + dropdown
- [ ] Modify invoice PDF generation: add diet page
- [ ] Update `POST /api/members/register` and `POST /api/members/renew` to accept dietId
- [ ] Test registration/renewal flow with diet inclusion

---

## FEATURE 3: Check Membership Validity by Phone

### Overview
Public endpoint to check member status by phone (no authentication required).

### Database Changes
**None** - Add index to optimize query.

**Add Index:**
```sql
CREATE UNIQUE INDEX idx_members_phone ON members(phone);
```

### Backend API Design

#### Endpoint: `GET /api/public/check-member`

```
Query Parameters:
- phone: string (required) - 10 digit Indian phone number

Response (200):
{
  found: true,
  gymId: "GYM001",
  name: "John Doe",
  plan: "Premium 3 Months",
  validityEndDate: "2026-04-03",
  status: "active|expired|about_to_expire"
}

Response (404):
{
  found: false,
  message: "Member not found"
}

Response (400):
{
  error: "Invalid phone number format"
}
```

### Backend Implementation

**Route** (`routes/publicRoutes.js` - new file):
```javascript
router.get('/check-member', async (req, res) => {
  const { phone } = req.query;
  
  // Validate phone format (10 digits)
  if (!phone || !/^\d{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone format' });
  }
  
  // Query with index:
  // SELECT members.*, packages.name from members
  // LEFT JOIN packages ON members.packageId = packages.id
  // WHERE members.phone = ? AND members.deletedAt IS NULL
  
  if (!member) return res.status(404).json({ found: false });
  
  // Calculate validity status
  const today = new Date();
  const validityEnd = new Date(member.renewalDate);
  const daysLeft = Math.ceil((validityEnd - today) / (1000 * 60 * 60 * 24));
  
  res.json({
    found: true,
    gymId: member.memberId,
    name: formatName(member.firstName, member.lastName),
    plan: member.package.name,
    validityEndDate: member.renewalDate.toISOString().split('T')[0],
    status: daysLeft > 0 ? (daysLeft <= 7 ? 'about_to_expire' : 'active') : 'expired'
  });
});
```

**Register route in main server:**
```javascript
// server.js
const publicRoutes = require('./routes/publicRoutes');
app.use('/api/public', publicRoutes); // No auth for public routes
```

### Frontend Implementation

**New Homepage Section** (`pages/Home.jsx`):
```jsx
export const MembershipCheckSection = () => {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const checkMembership = async () => {
    if (!/^\d{10}$/.test(phone)) {
      alert('Enter valid 10-digit phone');
      return;
    }
    
    setLoading(true);
    const res = await fetch(`/api/public/check-member?phone=${phone}`);
    const data = await res.json();
    setResult(data);
    setLoading(false);
  };
  
  return (
    <div className="check-membership-section">
      <h3>Check Membership Validity</h3>
      <input 
        type="tel" 
        placeholder="Enter 10-digit phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button onClick={checkMembership} disabled={loading}>
        {loading ? 'Checking...' : 'Check Status'}
      </button>
      
      {result?.found && (
        <div className="result-card">
          <p><strong>Gym ID:</strong> {result.gymId}</p>
          <p><strong>Name:</strong> {result.name}</p>
          <p><strong>Plan:</strong> {result.plan}</p>
          <p><strong>Valid Till:</strong> {result.validityEndDate}</p>
          <p className={`status-${result.status}`}>
            Status: {result.status.toUpperCase()}
          </p>
        </div>
      )}
      
      {result && !result.found && (
        <p className="not-found">No membership found for this number</p>
      )}
    </div>
  );
};
```

### Implementation Checklist
- [ ] Create index on `members.phone`
- [ ] Create `publicRoutes.js` with GET `/check-member`
- [ ] Add phone format validation (10 digits)
- [ ] Register public routes in `server.js` (no auth middleware)
- [ ] Create "Check Membership" section component in Home page
- [ ] Add styling for result display
- [ ] Test with various phone formats and edge cases

---

## FEATURE 4: Unique Phone Constraint

### Overview
Enforce unique phone numbers at database and application level.

### Database Changes

**MySQL Constraint:**
```sql
ALTER TABLE members ADD CONSTRAINT unique_phone UNIQUE (phone);
```

**For existing data (handle duplicates):**
```javascript
// Migration: identify and merge/flag duplicates before constraint
SELECT phone, COUNT(*) as count FROM members 
GROUP BY phone HAVING count > 1;

// Manual review required: decide which to keep or merge
```

### Backend Validation

**In Member Model** (`models/Member.js`):
```javascript
const memberSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    match: /^\d{10}$/
  }
  // ... other fields
});

memberSchema.index({ phone: 1 }, { unique: true });
```

**In Registration/Renewal Route** (`routes/memberRoutes.js`):
```javascript
// Before insert/update:
const existingMember = await Member.findOne({ phone: req.body.phone });

if (existingMember && existingMember._id.toString() !== req.body.memberId) {
  return res.status(400).json({
    error: 'Phone number already registered',
    code: 'DUPLICATE_PHONE'
  });
}

// Proceed with save
```

**Error Response:**
```json
{
  "error": "Phone number already registered",
  "code": "DUPLICATE_PHONE",
  "existingMemberId": "GYM001"
}
```

### Frontend Error Handling

**Registration/Renewal Form** (`AdminRegister.jsx`):
```javascript
try {
  const response = await fetch('/api/members/register', {
    method: 'POST',
    body: JSON.stringify(formData)
  });
  
  if (response.status === 400) {
    const error = await response.json();
    if (error.code === 'DUPLICATE_PHONE') {
      setError(`Phone already registered (ID: ${error.existingMemberId})`);
    }
  }
} catch (err) {
  // handle
}
```

### Implementation Checklist
- [ ] Check existing data for duplicate phones (manual review)
- [ ] Add UNIQUE constraint to `members.phone` in MySQL
- [ ] Add unique index to `Member` mongoose schema
- [ ] Add phone validation before insert/update
- [ ] Return clear error code for duplicate phones
- [ ] Update frontend form to display duplicate phone error
- [ ] Test registration with duplicate phone

---

## FEATURE 5: Safe WhatsApp Web Sharing (No API/Automation)

### Overview
Generate secure, shareable PDF links + open WhatsApp Web with prefilled message.

### Database Changes

**Add table for generated links** (`signed_pdf_links`):
```sql
CREATE TABLE signed_pdf_links (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paymentLogId BIGINT NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL,
  fileHash VARCHAR(64),
  expiresAt TIMESTAMP,
  viewCount INT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (paymentLogId) REFERENCES payment_logs(id) ON DELETE CASCADE,
  INDEX idx_token (token),
  INDEX idx_expiresAt (expiresAt)
);
```

**Modify `payment_logs` table:**
```sql
ALTER TABLE payment_logs ADD COLUMN publicShareUrl VARCHAR(512);
ALTER TABLE payment_logs ADD COLUMN shareTokenExpiresAt TIMESTAMP;
```

### Backend API Design

#### Endpoint 1: Generate Secure PDF Link
```
POST /api/invoices/:paymentLogId/generate-share-link

Request Body:
{
  expirationHours: 24 (optional, default)
}

Response:
{
  success: true,
  shareUrl: "https://yourdomain.com/api/public/invoices/share/abc123def456...",
  expiresAt: "2026-03-04T10:30:00Z",
  whatsappLink: "https://wa.me/919876543210?text=Hello%20John..."
}
```

#### Endpoint 2: Retrieve Shared PDF
```
GET /api/public/invoices/share/:token

Response: PDF file (if token valid and not expired)
Response: 403 Forbidden (if expired)
Response: 404 Not Found (if invalid token)
```

### URL Signing Strategy

**Use cryptographic tokens** (not database IDs):
```javascript
const crypto = require('crypto');

// Generate token
const generateShareToken = (paymentLogId, expirationHours = 24) => {
  const expiry = Date.now() + (expirationHours * 60 * 60 * 1000);
  const data = `${paymentLogId}:${expiry}`;
  
  const token = crypto
    .createHmac('sha256', process.env.SHARE_TOKEN_SECRET)
    .update(data)
    .digest('hex');
  
  return { token, expiresAt: new Date(expiry) };
};

// Verify token
const verifyShareToken = (token, paymentLogId) => {
  const record = await SignedPDFLink.findOne({ token });
  
  if (!record) return { valid: false, reason: 'Invalid token' };
  if (new Date() > record.expiresAt) return { valid: false, reason: 'Expired' };
  if (record.paymentLogId !== paymentLogId) return { valid: false, reason: 'Mismatch' };
  
  return { valid: true };
};
```

### Backend Implementation

**Route: Generate Share Link** (`routes/invoiceRoutes.js`):
```javascript
router.post('/invoices/:paymentLogId/generate-share-link', requireAuth, async (req, res) => {
  const { paymentLogId } = req.params;
  const { expirationHours = 24 } = req.body;
  
  // Verify payment log exists and belongs to logged-in admin
  const payment = await PaymentLog.findById(paymentLogId).populate('memberId');
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  
  // Generate token
  const { token, expiresAt } = generateShareToken(paymentLogId, expirationHours);
  
  // Store in database
  await SignedPDFLink.create({
    paymentLogId,
    token,
    expiresAt
  });
  
  // Build WhatsApp URL
  const shareUrl = `${process.env.DOMAIN}/api/public/invoices/share/${token}`;
  const memberName = formatName(payment.memberId.firstName, payment.memberId.lastName);
  const message = `Hello ${memberName}, your gym invoice is ready. Download here: ${shareUrl}`;
  const whatsappLink = buildWhatsAppLink(payment.memberId.phone, message);
  
  res.json({
    success: true,
    shareUrl,
    expiresAt,
    whatsappLink
  });
});

// Build WhatsApp Web link
const buildWhatsAppLink = (phone, message) => {
  const formattedPhone = phone.startsWith('91') ? phone : `91${phone}`;
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
};
```

**Route: Retrieve Shared PDF** (`routes/publicRoutes.js`):
```javascript
router.get('/invoices/share/:token', async (req, res) => {
  const { token } = req.params;
  
  // Find link record
  const linkRecord = await SignedPDFLink.findOne({ token })
    .populate('paymentLogId');
  
  if (!linkRecord) return res.status(404).json({ error: 'Invalid link' });
  if (new Date() > linkRecord.expiresAt) return res.status(403).json({ error: 'Link expired' });
  
  // Log access
  await SignedPDFLink.updateOne({ _id: linkRecord._id }, { 
    $inc: { viewCount: 1 },
    lastAccessedAt: new Date()
  });
  
  // Generate and return PDF
  const pdfBuffer = await generateInvoicePDF(linkRecord.paymentLogId);
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice_${token.substring(0, 8)}.pdf"`);
  res.send(pdfBuffer);
});
```

### Frontend Implementation

**Invoice Download Section** (`components/InvoiceActions.jsx` - new):
```jsx
export const InvoiceActions = ({ paymentLogId, memberPhone, memberName }) => {
  const [shareLink, setShareLink] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const generateShareLink = async () => {
    setLoading(true);
    const res = await fetch(`/api/invoices/${paymentLogId}/generate-share-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expirationHours: 24 })
    });
    const data = await res.json();
    setShareLink(data);
    setLoading(false);
  };
  
  const downloadPDF = async () => {
    const res = await fetch(`/api/invoices/${paymentLogId}/download`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice_${paymentLogId}.pdf`;
    a.click();
  };
  
  const openWhatsApp = () => {
    if (!shareLink) return;
    window.open(shareLink.whatsappLink, '_blank');
  };
  
  return (
    <div className="invoice-actions">
      <button onClick={downloadPDF}>📥 Download Invoice</button>
      
      <button onClick={generateShareLink} disabled={loading || shareLink}>
        {loading ? 'Generating...' : '🔗 Generate WhatsApp Link'}
      </button>
      
      {shareLink && (
        <>
          <button onClick={openWhatsApp}>
            💬 Send via WhatsApp
          </button>
          <p className="expiry-text">Link expires: {shareLink.expiresAt}</p>
        </>
      )}
    </div>
  );
};
```

**Integration in Billing/Renewal Page:**
```jsx
// After successful payment/renewal
<InvoiceActions 
  paymentLogId={paymentLog._id}
  memberPhone={member.phone}
  memberName={member.firstName}
/>
```

### Phone Formatting Logic

**Utility** (`utils/phoneFormatter.js`):
```javascript
export const formatPhoneForWhatsApp = (phone) => {
  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, '');
  
  // If 10 digits, prepend country code
  if (cleaned.length === 10) {
    cleaned = `91${cleaned}`;
  }
  
  // Validate
  if (cleaned.length !== 12 || !cleaned.startsWith('91')) {
    throw new Error('Invalid phone format');
  }
  
  // Remove "91" for storage (store as 10 digits)
  return cleaned.substring(2);
};

// Usage in member model:
Member.phone = formatPhoneForWhatsApp(req.body.phone);
```

### Security Requirements

**Token Validation:**
- [ ] Tokens are cryptographically signed (HMAC-SHA256)
- [ ] Tokens include expiration timestamp
- [ ] Tokens are stored in database (allow revocation)
- [ ] Tokens don't expose payment log IDs

**Expiration Handling:**
- [ ] Default: 24 hours
- [ ] Admin can customize per-link (1-72 hours)
- [ ] Cron job to clean expired links (daily)

**Logging & Audit:**
```javascript
// In SignedPDFLink schema:
{
  paymentLogId: ObjectId,
  token: String,
  expiresAt: Date,
  createdByAdminId: ObjectId,
  viewCount: Number,
  lastAccessedAt: Date,
  revokedAt: Date
}

// Log each generation and access
```

### PDF Storage Strategy

**Option A: Generate on-demand** (recommended for simplicity):
- No storage needed
- PDF generated when link accessed
- Use backend in-memory buffer

**Option B: Pre-generate & cache** (if PDF generation is slow):
- Generate PDF after invoice created
- Store in `/uploads/invoices/` directory
- Use secure token path

**For both options:**
- Don't expose file paths in URLs
- Use tokens/signatures only

### Cron Job: Clean Expired Links

**Add to `server.js`:**
```javascript
const cron = require('node-cron');

// Run daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  const result = await SignedPDFLink.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  console.log(`Deleted ${result.deletedCount} expired share links`);
});
```

### Implementation Checklist
- [ ] Create `signed_pdf_links` table
- [ ] Modify `payment_logs` schema
- [ ] Create token signing utility
- [ ] Create `POST /api/invoices/:id/generate-share-link` route
- [ ] Create `GET /api/public/invoices/share/:token` route
- [ ] Create `InvoiceActions` component
- [ ] Integrate into Billing/Renewal success page
- [ ] Create phone formatter utility
- [ ] Add cron job for link cleanup
- [ ] Add logging for share link access
- [ ] Test token expiration & revocation
- [ ] Test WhatsApp Web redirect with various messages
- [ ] Security: Verify tokens in different browsers (no leakage)

---

## IMPLEMENTATION PRIORITY & SEQUENCING

### Phase 1: Core Foundation (Week 1)
1. **Feature 4: Unique Phone Constraint** - Dependencies for multiple features
2. **Feature 3: Check Membership by Phone** - Independent, quick
3. **Feature 1: Export Analytics PDF** - Reuse existing queries, no DB changes

### Phase 2: Billing Integration (Week 2)
4. **Feature 2: Diet Management** - Ties into billing flow
5. **Feature 5: WhatsApp Sharing** - Final integration point

### Reusability Across Features
| Service | Used By |
|---------|---------|
| `phoneFormatter.js` | Features 3, 4, 5 |
| `pdfGenerator.js` | Features 1, 2, 5 |
| `analyticsService.js` | Features 1 |
| `dietService.js` | Features 2, 5 |
| Auth middleware | Features 1, 2, 5 |
| Public routes | Features 3, 5 |

---

## PRODUCTION SAFETY CHECKLIST

- [ ] All features use existing auth middleware (adminAuth)
- [ ] Public endpoints (Features 3, 5) have rate limiting
- [ ] Database transactions for multi-step operations (billing + diet)
- [ ] Error logging for failed PDF generations
- [ ] Backup & recovery for shared PDF tokens
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (use parameterized queries/ORM)
- [ ] HTTPS enforcement for share links
- [ ] Environment variables for secrets (SHARE_TOKEN_SECRET, DOMAIN)
- [ ] Database indexes for performance-critical queries
- [ ] Soft delete support for auditable data (Diet, Links)

---

## ARCHITECTURE SUMMARY

```
Backend Structure:
├── services/
│   ├── analyticsService.js         (new)
│   ├── dietService.js              (new)
│   ├── billingService.js           (modify)
│   └── pdfInvoiceService.js        (modify)
├── routes/
│   ├── analyticsRoutes.js          (new)
│   ├── dietRoutes.js               (new)
│   ├── publicRoutes.js             (new)
│   ├── invoiceRoutes.js            (new)
│   └── memberRoutes.js             (modify)
├── models/
│   ├── Diet.js                     (new)
│   └── Member.js                   (modify)
└── utils/
    ├── phoneFormatter.js           (new)
    └── tokenSigner.js              (new)

Frontend Structure:
├── admin/
│   ├── AdminDietManager.jsx        (new)
│   ├── AdminRegister.jsx           (modify: add diet checkbox)
│   └── AdminDashboardHome.jsx      (modify: add export PDF button)
├── pages/
│   └── Home.jsx                    (modify: add membership check)
└── components/
    ├── InvoiceActions.jsx          (new)
    └── DietSelector.jsx            (new)
```

---

## NEXT STEPS

1. Confirm database schema changes with team
2. Identify current analytics query logic (for reuse in Feature 1)
3. Determine phone number format standard in current system
4. Set up environment variables (SHARE_TOKEN_SECRET, DOMAIN, PDF library choice)
5. Create feature branches and assign tasks
6. Start with Phase 1 (features 4, 3, 1)

