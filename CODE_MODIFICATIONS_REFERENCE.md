# Code Modification Quick Reference

## Database Migrations Script

**File to create:** `gym_project_backend/migrations/addFeatures.sql`

```sql
-- ============================================
-- FEATURE 5: WhatsApp Sharing
-- ============================================

CREATE TABLE signed_pdf_links (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  paymentLogId BIGINT NOT NULL,
  token VARCHAR(64) UNIQUE NOT NULL,
  expiresAt TIMESTAMP,
  viewCount INT DEFAULT 0,
  createdAtTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  lastAccessedAt DATETIME NULL,
  revokedAt DATETIME NULL,
  FOREIGN KEY (paymentLogId) REFERENCES payment_logs(id) ON DELETE CASCADE,
  INDEX idx_token (token),
  INDEX idx_expiresAt (expiresAt),
  INDEX idx_paymentLogId (paymentLogId)
);

ALTER TABLE payment_logs ADD COLUMN dietId BIGINT NULL;
ALTER TABLE payment_logs ADD COLUMN dietName VARCHAR(255);

-- ============================================
-- FEATURE 2: Diet Management
-- ============================================

CREATE TABLE diets (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL UNIQUE,
  description LONGTEXT,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_diets_name ON (name)
);

CREATE TABLE diet_training_type_mapping (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  trainingTypeId BIGINT NOT NULL,
  dietId BIGINT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trainingTypeId) REFERENCES training_types(id) ON DELETE CASCADE,
  FOREIGN KEY (dietId) REFERENCES diets(id) ON DELETE CASCADE,
  UNIQUE KEY unique_mapping (trainingTypeId, dietId)
);

ALTER TABLE members 
  ADD COLUMN dietId BIGINT NULL,
  ADD COLUMN dietIncludedInLastBilling BOOLEAN DEFAULT FALSE,
  ADD FOREIGN KEY (dietId) REFERENCES diets(id) ON DELETE SET NULL;

-- ============================================
-- FEATURE 4: Unique Phone Constraint
-- ============================================

-- First, handle duplicates in existing data
-- Review and manually merge/delete duplicates:
-- SELECT phone, COUNT(*) cnt FROM members GROUP BY phone HAVING cnt > 1;

ALTER TABLE members 
  ADD CONSTRAINT unique_phone UNIQUE (phone),
  ADD INDEX idx_phone_validity (phone, renewalDate);

-- ============================================
-- FEATURE 1: Analytics (No schema changes)
-- ============================================

-- Ensure indexes exist for performance:
CREATE INDEX IF NOT EXISTS idx_paymentlog_date_type 
  ON payment_logs(transactionDate, transactionType, status);
CREATE INDEX IF NOT EXISTS idx_dailysummary_date 
  ON daily_summary(date);

-- ============================================
-- FEATURE 3: Check Membership (No schema changes)
-- ============================================

-- Already indexed via Feature 4
```

---

## File-by-File Modifications

### Backend: New Service Files

#### 1. **Create: `gym_project_backend/services/analyticsService.js`**

```javascript
const PaymentLog = require('../models/PaymentLog');
const DailySummary = require('../models/DailySummary');
const Package = require('../models/Package');

class AnalyticsService {
  /**
   * Get aggregated analytics metrics for a date range
   * Reusable by both Dashboard API and PDF export
   */
  async getAnalyticsMetrics(startDate, endDate) {
    const filters = {
      transactionDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      },
      status: 'completed'
    };

    // Total Revenue & Transactions
    const totalStats = await PaymentLog.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalTransactions: { $sum: 1 }
        }
      }
    ]);

    // Revenue by Transaction Type
    const revenueByType = await PaymentLog.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$transactionType', // 'new_joining', 'renewal'
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Revenue by Package/Plan
    const revenueByPlan = await PaymentLog.aggregate([
      { $match: filters },
      {
        $lookup: {
          from: 'packages',
          localField: 'packageId',
          foreignField: '_id',
          as: 'package'
        }
      },
      { $unwind: '$package' },
      {
        $group: {
          _id: '$package.name',
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Revenue by Training Type
    const revenueByTrainingType = await PaymentLog.aggregate([
      { $match: filters },
      {
        $lookup: {
          from: 'members',
          localField: 'memberId',
          foreignField: '_id',
          as: 'member'
        }
      },
      { $unwind: '$member' },
      {
        $group: {
          _id: '$member.trainingType',
          amount: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Parse results
    const [total] = totalStats;
    const newJoinRevenue = revenueByType.find(r => r._id === 'new_joining') || {};
    const renewalRevenue = revenueByType.find(r => r._id === 'renewal') || {};

    return {
      period: {
        startDate: startDate,
        endDate: endDate
      },
      totalRevenue: total?.totalRevenue || 0,
      totalTransactions: total?.totalTransactions || 0,
      newJoiningRevenue: newJoinRevenue.amount || 0,
      renewalRevenue: renewalRevenue.amount || 0,
      incomeByPlan: revenueByPlan.map(r => ({
        planName: r._id,
        amount: r.amount,
        count: r.count
      })),
      incomeByTrainingType: revenueByTrainingType.map(r => ({
        trainingType: r._id,
        amount: r.amount,
        count: r.count
      }))
    };
  }
}

module.exports = new AnalyticsService();
```

#### 2. **Create: `gym_project_backend/services/dietService.js`**

```javascript
const Diet = require('../models/Diet');
const DietMapping = require('../models/DietMapping');

class DietService {
  // CRUD Operations
  async createDiet(name, description) {
    const diet = new Diet({ name, description });
    return await diet.save();
  }

  async getAllDiets() {
    return await Diet.find({ isActive: true }).sort({ name: 1 });
  }

  async getDietById(dietId) {
    return await Diet.findById(dietId);
  }

  async updateDiet(dietId, updates) {
    return await Diet.findByIdAndUpdate(
      dietId,
      { ...updates, updatedAt: new Date() },
      { new: true }
    );
  }

  async deleteDiet(dietId) {
    // Soft delete
    return await Diet.findByIdAndUpdate(
      dietId,
      { isActive: false, updatedAt: new Date() },
      { new: true }
    );
  }

  // Mapping Operations
  async setDefaultDietForTrainingType(trainingTypeId, dietId) {
    // Delete existing mapping for this training type
    await DietMapping.deleteMany({ trainingTypeId });

    // Create new mapping if dietId provided
    if (dietId) {
      const mapping = new DietMapping({ trainingTypeId, dietId });
      return await mapping.save();
    }
    return null;
  }

  async getDefaultDietForTrainingType(trainingTypeId) {
    const mapping = await DietMapping.findOne({ trainingTypeId })
      .populate('dietId');
    return mapping?.dietId || null;
  }

  async getDefaultDietsByTrainingTypes(trainingTypeIds) {
    const mappings = await DietMapping.find({
      trainingTypeId: { $in: trainingTypeIds }
    }).populate('dietId');

    const dietMap = {};
    mappings.forEach(m => {
      dietMap[m.trainingTypeId] = m.dietId;
    });
    return dietMap;
  }
}

module.exports = new DietService();
```

#### 3. **Create: `gym_project_backend/utils/phoneFormatter.js`**

```javascript
/**
 * Format phone number for database storage (10 digits)
 * Example: "+91 98765 43210" -> "9876543210"
 */
function formatPhoneForStorage(phone) {
  if (!phone) throw new Error('Phone number required');

  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');

  // If 12 digits and starts with 91, remove country code
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    return cleaned.substring(2);
  }

  // If 10 digits, return as-is
  if (cleaned.length === 10) {
    return cleaned;
  }

  throw new Error('Invalid phone format. Must be 10 digits or 91 + 10 digits');
}

/**
 * Format phone number for WhatsApp Web URL
 * Returns: 919876543210
 */
function formatPhoneForWhatsApp(phone) {
  const stored = formatPhoneForStorage(phone);
  return `91${stored}`;
}

/**
 * Validate phone format (10 digits)
 */
function validatePhone(phone) {
  return /^\d{10}$/.test(phone.replace(/\D/g, ''));
}

module.exports = {
  formatPhoneForStorage,
  formatPhoneForWhatsApp,
  validatePhone
};
```

#### 4. **Create: `gym_project_backend/utils/tokenSigner.js`**

```javascript
const crypto = require('crypto');

const SHARE_TOKEN_SECRET = process.env.SHARE_TOKEN_SECRET || 'dev-secret-key-change-in-production';

/**
 * Generate cryptographic token for PDF sharing
 * Token includes timestamp and signature
 */
function generateShareToken(paymentLogId, expirationHours = 24) {
  const expiresAt = new Date(Date.now() + expirationHours * 60 * 60 * 1000);
  const expiryTimestamp = expiresAt.getTime();

  // Create data to sign
  const data = `${paymentLogId}:${expiryTimestamp}`;

  // Generate HMAC signature
  const token = crypto
    .createHmac('sha256', SHARE_TOKEN_SECRET)
    .update(data)
    .digest('hex');

  return {
    token,
    expiresAt,
    data // Store for verification
  };
}

/**
 * Verify token and extract payment log ID
 */
function verifyShareToken(token, storedExpiresAt) {
  // Check expiration
  if (new Date() > new Date(storedExpiresAt)) {
    return { valid: false, reason: 'Token expired' };
  }

  // Additional checks can be done against database record
  return { valid: true };
}

module.exports = {
  generateShareToken,
  verifyShareToken
};
```

#### 5. **Create: `gym_project_backend/utils/pdfGenerator.js`** (Enhanced)

```javascript
const PDFDocument = require('pdfkit');

class PDFGenerator {
  /**
   * Generate Analytics PDF
   */
  static generateAnalyticsPDF(metrics, dateRange) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', data => buffers.push(data));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        doc.fontSize(20).text('Analytics Report', { align: 'center' });
        doc.fontSize(10).text(`Period: ${dateRange.startDate} to ${dateRange.endDate}`, 
          { align: 'center' });
        doc.text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
        doc.moveDown();

        // Summary Section
        doc.fontSize(14).text('Summary Metrics');
        doc.fontSize(10);
        this.addMetricRow(doc, 'Total Revenue', `₹${metrics.totalRevenue.toLocaleString()}`);
        this.addMetricRow(doc, 'New Joining Revenue', 
          `₹${metrics.newJoiningRevenue.toLocaleString()}`);
        this.addMetricRow(doc, 'Renewal Revenue', 
          `₹${metrics.renewalRevenue.toLocaleString()}`);
        this.addMetricRow(doc, 'Total Transactions', metrics.totalTransactions);

        doc.moveDown();

        // Income by Plan Table
        doc.fontSize(12).text('Income by Plan');
        this.addTable(doc, ['Plan Name', 'Count', 'Amount'], 
          metrics.incomeByPlan.map(p => [
            p.planName,
            p.count.toString(),
            `₹${p.amount.toLocaleString()}`
          ]));

        doc.moveDown();

        // Income by Training Type Table
        doc.fontSize(12).text('Income by Training Type');
        this.addTable(doc, ['Training Type', 'Count', 'Amount'],
          metrics.incomeByTrainingType.map(t => [
            t.trainingType,
            t.count.toString(),
            `₹${t.amount.toLocaleString()}`
          ]));

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Add two-column metric row
   */
  static addMetricRow(doc, label, value) {
    doc.text(`${label}:`, 100);
    doc.text(value, 300);
    doc.moveDown(0.3);
  }

  /**
   * Add simple table
   */
  static addTable(doc, headers, rows) {
    const colWidth = 150;
    const rowHeight = 20;
    let y = doc.y;

    // Headers
    headers.forEach((header, i) => {
      doc.text(header, 50 + i * colWidth, y, { width: colWidth });
    });

    y += rowHeight;
    rows.forEach(row => {
      row.forEach((cell, i) => {
        doc.text(cell, 50 + i * colWidth, y, { width: colWidth });
      });
      y += rowHeight;
    });

    doc.moveTo(50, y).lineTo(50 + headers.length * colWidth, y).stroke();
  }

  /**
   * Generate Invoice PDF (with optional Diet Plan page)
   */
  static generateInvoicePDF(paymentData, memberData, dietData = null) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument();
        const buffers = [];

        doc.on('data', data => buffers.push(data));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Page 1: Invoice
        this.addInvoicePage(doc, paymentData, memberData);

        // Page 2: Diet Plan (if selected)
        if (dietData) {
          doc.addPage();
          this.addDietPage(doc, dietData);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  static addInvoicePage(doc, paymentData, memberData) {
    doc.fontSize(16).text('GYM INVOICE', { align: 'center' });
    doc.fontSize(10);
    doc.text(`Invoice #: ${paymentData.invoiceId}`);
    doc.text(`Date: ${new Date(paymentData.date).toLocaleDateString()}`);
    doc.moveDown();

    doc.fontSize(11).text('Member Details');
    doc.fontSize(10);
    doc.text(`Name: ${memberData.name}`);
    doc.text(`Gym ID: ${memberData.gymId}`);
    doc.text(`Phone: ${memberData.phone}`);
    doc.moveDown();

    doc.fontSize(11).text('Billing Details');
    doc.fontSize(10);
    doc.text(`Plan: ${paymentData.planName}`);
    doc.text(`Amount: ₹${paymentData.amount}`);
    doc.text(`Valid Till: ${new Date(paymentData.validityEnd).toLocaleDateString()}`);
    doc.moveDown();

    if (paymentData.dietIncluded) {
      doc.text(`✓ Diet Plan Included`);
    }
  }

  static addDietPage(doc, dietData) {
    doc.fontSize(16).text('DIET PLAN', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Plan: ${dietData.name}`);
    doc.moveDown();

    doc.fontSize(10).text(dietData.description, { align: 'left', width: 500 });
    doc.moveDown();

    doc.fontSize(9).text('Follow this diet plan regularly for best results.', 
      { align: 'center', italics: true });
  }
}

module.exports = PDFGenerator;
```

### Backend: New Model Files

#### 6. **Create: `gym_project_backend/models/Diet.js`**

```javascript
const mongoose = require('mongoose');

const dietSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for queries
dietSchema.index({ name: 1 });
dietSchema.index({ isActive: 1 });

module.exports = mongoose.model('Diet', dietSchema);
```

#### 7. **Create: `gym_project_backend/models/DietMapping.js`**

```javascript
const mongoose = require('mongoose');

const dietMappingSchema = new mongoose.Schema({
  trainingTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TrainingType',
    required: true
  },
  dietId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Diet',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Unique constraint: one training type can have one default diet
dietMappingSchema.index({ trainingTypeId: 1 }, { unique: true });

module.exports = mongoose.model('DietMapping', dietMappingSchema);
```

#### 8. **Create: `gym_project_backend/models/SignedPDFLink.js`**

```javascript
const mongoose = require('mongoose');

const signedPDFLinkSchema = new mongoose.Schema({
  paymentLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentLog',
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true // For TTL queries
  },
  viewCount: {
    type: Number,
    default: 0
  },
  lastAccessedAt: {
    type: Date,
    default: null
  },
  revokedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Auto-delete expired documents (TTL index)
signedPDFLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SignedPDFLink', signedPDFLinkSchema);
```

### Backend: New Route Files

#### 9. **Create: `gym_project_backend/routes/analyticsRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const analyticsService = require('../services/analyticsService');
const PDFGenerator = require('../utils/pdfGenerator');

/**
 * GET /api/analytics/metrics
 * Fetch analytics data for dashboard or further processing
 */
router.get('/metrics', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Default to today if not provided
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    const metrics = await analyticsService.getAnalyticsMetrics(start, end);
    res.json(metrics);
  } catch (error) {
    console.error('Analytics metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /api/analytics/export-pdf
 * Export filtered analytics as PDF
 */
router.get('/export-pdf', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, format = 'pdf' } = req.query;

    // Validate format
    if (format !== 'pdf') {
      return res.status(400).json({ error: 'Format not supported' });
    }

    // Default to today
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    // Fetch metrics
    const metrics = await analyticsService.getAnalyticsMetrics(start, end);

    // Generate PDF
    const pdfBuffer = await PDFGenerator.generateAnalyticsPDF(
      metrics,
      { startDate: start, endDate: end }
    );

    // Send as file download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="analytics_${start}_to_${end}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF export error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
```

#### 10. **Create: `gym_project_backend/routes/dietRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const dietService = require('../services/dietService');
const Diet = require('../models/Diet');

/**
 * POST /api/diets
 * Create new diet
 */
router.post('/', adminAuth, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const diet = await dietService.createDiet(name, description);
    res.status(201).json({ success: true, diet });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Diet name already exists' });
    }
    console.error('Diet creation error:', error);
    res.status(500).json({ error: 'Failed to create diet' });
  }
});

/**
 * GET /api/diets
 * List all active diets
 */
router.get('/', async (req, res) => {
  try {
    const diets = await dietService.getAllDiets();
    res.json(diets);
  } catch (error) {
    console.error('Diets fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch diets' });
  }
});

/**
 * GET /api/diets/:id
 * Get single diet
 */
router.get('/:id', async (req, res) => {
  try {
    const diet = await dietService.getDietById(req.params.id);
    if (!diet) return res.status(404).json({ error: 'Diet not found' });
    res.json(diet);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch diet' });
  }
});

/**
 * PUT /api/diets/:id
 * Update diet
 */
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { name, description } = req.body;
    const diet = await dietService.updateDiet(req.params.id, {
      name,
      description
    });

    if (!diet) return res.status(404).json({ error: 'Diet not found' });
    res.json({ success: true, diet });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Diet name already exists' });
    }
    console.error('Diet update error:', error);
    res.status(500).json({ error: 'Failed to update diet' });
  }
});

/**
 * DELETE /api/diets/:id
 * Soft delete diet
 */
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const diet = await dietService.deleteDiet(req.params.id);
    if (!diet) return res.status(404).json({ error: 'Diet not found' });
    res.json({ success: true, message: 'Diet deleted' });
  } catch (error) {
    console.error('Diet delete error:', error);
    res.status(500).json({ error: 'Failed to delete diet' });
  }
});

/**
 * GET /api/diets/mapping/:trainingTypeId
 * Get default diet for training type
 */
router.get('/mapping/:trainingTypeId', async (req, res) => {
  try {
    const diet = await dietService.getDefaultDietForTrainingType(
      req.params.trainingTypeId
    );
    res.json({ diet: diet || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch mapping' });
  }
});

/**
 * POST /api/diets/mapping
 * Create training type to diet mapping
 */
router.post('/mapping', adminAuth, async (req, res) => {
  try {
    const { trainingTypeId, dietId } = req.body;

    if (!trainingTypeId) {
      return res.status(400).json({ error: 'trainingTypeId required' });
    }

    const mapping = await dietService.setDefaultDietForTrainingType(
      trainingTypeId,
      dietId
    );
    res.json({ success: true, mapping });
  } catch (error) {
    console.error('Mapping error:', error);
    res.status(500).json({ error: 'Failed to create mapping' });
  }
});

module.exports = router;
```

#### 11. **Create: `gym_project_backend/routes/publicRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const SignedPDFLink = require('../models/SignedPDFLink');
const PaymentLog = require('../models/PaymentLog');
const { validatePhone, formatPhoneForStorage } = require('../utils/phoneFormatter');
const PDFGenerator = require('../utils/pdfGenerator');

/**
 * GET /api/public/check-member
 * Check membership validity by phone (public endpoint)
 */
router.get('/check-member', async (req, res) => {
  try {
    const { phone } = req.query;

    if (!phone || !validatePhone(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    const storedPhone = formatPhoneForStorage(phone);

    // Query member with active status
    const member = await Member.findOne({
      phone: storedPhone,
      deletedAt: { $eq: null }
    }).populate('packageId');

    if (!member) {
      return res.status(404).json({ found: false });
    }

    // Determine status
    const today = new Date();
    const validityEnd = new Date(member.renewalDate);
    const daysLeft = Math.ceil((validityEnd - today) / (1000 * 60 * 60 * 24));

    let status;
    if (daysLeft > 7) {
      status = 'active';
    } else if (daysLeft > 0) {
      status = 'about_to_expire';
    } else {
      status = 'expired';
    }

    res.json({
      found: true,
      gymId: member.memberId || member._id.toString(),
      name: `${member.firstName} ${member.lastName}`,
      plan: member.packageId?.name || 'Unknown',
      validityEndDate: validityEnd.toISOString().split('T')[0],
      status,
      daysLeft
    });
  } catch (error) {
    console.error('Check member error:', error);
    res.status(500).json({ error: 'Failed to check membership' });
  }
});

/**
 * GET /api/public/invoices/share/:token
 * Download invoice PDF via share token
 */
router.get('/invoices/share/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Find share link
    const linkRecord = await SignedPDFLink.findOne({ token })
      .populate('paymentLogId');

    if (!linkRecord) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    // Check expiration
    if (new Date() > linkRecord.expiresAt) {
      return res.status(403).json({ error: 'Link has expired' });
    }

    // Check revocation
    if (linkRecord.revokedAt) {
      return res.status(403).json({ error: 'Link has been revoked' });
    }

    // Update access stats
    await SignedPDFLink.updateOne(
      { _id: linkRecord._id },
      {
        $inc: { viewCount: 1 },
        lastAccessedAt: new Date()
      }
    );

    // Generate and serve PDF
    const paymentLog = linkRecord.paymentLogId;
    const member = await Member.findById(paymentLog.memberId);

    const pdfBuffer = await PDFGenerator.generateInvoicePDF(
      {
        invoiceId: paymentLog._id.toString(),
        date: paymentLog.transactionDate,
        planName: paymentLog.packageName,
        amount: paymentLog.amount,
        validityEnd: paymentLog.renewalDate,
        dietIncluded: paymentLog.dietId ? true : false
      },
      {
        name: `${member.firstName} ${member.lastName}`,
        gymId: member.memberId,
        phone: member.phone
      },
      paymentLog.dietId ? { name: paymentLog.dietName } : null
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice_${token.substring(0, 8)}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error('PDF serve error:', error);
    res.status(500).json({ error: 'Failed to retrieve invoice' });
  }
});

module.exports = router;
```

#### 12. **Create: `gym_project_backend/routes/invoiceRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const PaymentLog = require('../models/PaymentLog');
const Member = require('../models/Member');
const SignedPDFLink = require('../models/SignedPDFLink');
const { generateShareToken } = require('../utils/tokenSigner');
const { formatPhoneForWhatsApp } = require('../utils/phoneFormatter');

/**
 * POST /api/invoices/:paymentLogId/generate-share-link
 * Generate secure WhatsApp share link for invoice
 */
router.post('/:paymentLogId/generate-share-link', adminAuth, async (req, res) => {
  try {
    const { paymentLogId } = req.params;
    const { expirationHours = 24 } = req.body;

    // Validate expiration hours
    if (expirationHours < 1 || expirationHours > 72) {
      return res.status(400).json({ error: 'Expiration must be 1-72 hours' });
    }

    // Find payment log
    const paymentLog = await PaymentLog.findById(paymentLogId)
      .populate('memberId');

    if (!paymentLog) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const member = paymentLog.memberId;

    // Generate token
    const { token, expiresAt } = generateShareToken(paymentLogId, expirationHours);

    // Store in database
    await SignedPDFLink.create({
      paymentLogId,
      token,
      expiresAt
    });

    // Build share URL
    const domain = process.env.DOMAIN || 'http://localhost:5000';
    const shareUrl = `${domain}/api/public/invoices/share/${token}`;

    // Build WhatsApp message
    const memberName = member.firstName || 'Member';
    const message = `Hello ${memberName}, your gym invoice is ready. Download here: ${shareUrl}`;
    const formattedPhone = formatPhoneForWhatsApp(member.phone);

    // Build WhatsApp Web link
    const encodedMessage = encodeURIComponent(message);
    const whatsappLink = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;

    res.json({
      success: true,
      shareUrl,
      expiresAt,
      whatsappLink,
      message
    });
  } catch (error) {
    console.error('Generate share link error:', error);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

/**
 * GET /api/invoices/:paymentLogId/download
 * Direct download (authenticated)
 */
router.get('/:paymentLogId/download', adminAuth, async (req, res) => {
  try {
    const paymentLog = await PaymentLog.findById(req.params.paymentLogId)
      .populate('memberId');

    if (!paymentLog) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Generate and serve PDF
    const PDFGenerator = require('../utils/pdfGenerator');
    const pdfBuffer = await PDFGenerator.generateInvoicePDF(
      {
        invoiceId: paymentLog._id.toString(),
        date: paymentLog.transactionDate,
        planName: paymentLog.packageName,
        amount: paymentLog.amount,
        validityEnd: paymentLog.renewalDate,
        dietIncluded: paymentLog.dietId ? true : false
      },
      {
        name: `${paymentLog.memberId.firstName} ${paymentLog.memberId.lastName}`,
        gymId: paymentLog.memberId.memberId,
        phone: paymentLog.memberId.phone
      },
      paymentLog.dietId ? { name: paymentLog.dietName } : null
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice_${req.params.paymentLogId}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Invoice download error:', error);
    res.status(500).json({ error: 'Failed to download invoice' });
  }
});

module.exports = router;
```

### Backend: Server Integration

#### 13. **Modify: `gym_project_backend/server.js`**

Add these new routes after existing route definitions:

```javascript
// Add with other route imports
const analyticsRoutes = require('./routes/analyticsRoutes');
const dietRoutes = require('./routes/dietRoutes');
const publicRoutes = require('./routes/publicRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');

// Add with other middleware (after existing routes)
app.use('/api/analytics', analyticsRoutes);
app.use('/api/diets', dietRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/public', publicRoutes);
```

### Backend: Model Modifications

#### 14. **Modify: `gym_project_backend/models/Member.js`**

Add these fields to the schema:

```javascript
// Add to memberSchema fields:
phone: {
  type: String,
  required: true,
  trim: true,
  unique: true,
  index: true,
  match: /^\d{10}$/
},

dietId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Diet',
  default: null
},

dietIncludedInLastBilling: {
  type: Boolean,
  default: false
}
```

#### 15. **Modify: `gym_project_backend/models/PaymentLog.js`**

Add these fields to the schema:

```javascript
// Add to paymentLogSchema fields:
dietId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Diet',
  default: null
},

dietName: {
  type: String,
  default: null
}
```

---

## Frontend: New Components

#### 16. **Create: `giri-gym/src/components/InvoiceActions.jsx`**

```jsx
import { useState } from 'react';

export const InvoiceActions = ({ paymentLogId, memberPhone, memberName }) => {
  const [shareLink, setShareLink] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateShareLink = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${paymentLogId}/generate-share-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationHours: 24 })
      });
      const data = await res.json();
      setShareLink(data);
    } catch (error) {
      alert('Failed to generate link');
    }
    setLoading(false);
  };

  const downloadPDF = async () => {
    try {
      const res = await fetch(`/api/invoices/${paymentLogId}/download`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice_${paymentLogId}.pdf`;
      a.click();
    } catch (error) {
      alert('Failed to download');
    }
  };

  const openWhatsApp = () => {
    if (!shareLink) return;
    window.open(shareLink.whatsappLink, '_blank');
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ddd' }}>
      <h4>Invoice Actions</h4>

      <button 
        onClick={downloadPDF}
        style={{
          padding: '8px 16px',
          margin: '5px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '4px'
        }}
      >
        📥 Download Invoice
      </button>

      <button 
        onClick={generateShareLink} 
        disabled={loading || shareLink}
        style={{
          padding: '8px 16px',
          margin: '5px',
          backgroundColor: shareLink ? '#ccc' : '#28a745',
          color: 'white',
          border: 'none',
          cursor: shareLink ? 'not-allowed' : 'pointer',
          borderRadius: '4px'
        }}
      >
        {loading ? '⏳ Generating...' : '🔗 Generate WhatsApp Link'}
      </button>

      {shareLink && (
        <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f0f0f0' }}>
          <button 
            onClick={openWhatsApp}
            style={{
              padding: '8px 16px',
              margin: '5px',
              backgroundColor: '#25d366',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            💬 Send via WhatsApp
          </button>

          <button 
            onClick={copyLink}
            style={{
              padding: '8px 16px',
              margin: '5px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {copied ? '✓ Copied!' : '📋 Copy Link'}
          </button>

          <p style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
            ⏰ Link expires: {new Date(shareLink.expiresAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
};
```

#### 17. **Create: `giri-gym/src/components/MembershipCheckSection.jsx`**

```jsx
import { useState } from 'react';

export const MembershipCheckSection = () => {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checkMembership = async () => {
    setError('');
    setResult(null);

    if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
      setError('Enter valid 10-digit phone number');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/public/check-member?phone=${phone}`);
      const data = await res.json();
      setResult(data);
      if (!data.found) {
        setError('No membership found');
      }
    } catch (err) {
      setError('Failed to check membership');
    }
    setLoading(false);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'green';
      case 'about_to_expire': return 'orange';
      case 'expired': return 'red';
      default: return 'gray';
    }
  };

  return (
    <div style={{
      maxWidth: '500px',
      margin: '40px auto',
      padding: '30px',
      border: '2px solid #ddd',
      borderRadius: '8px',
      backgroundColor: '#f9f9f9'
    }}>
      <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>
        Check Membership Validity
      </h2>

      <div style={{ marginBottom: '15px' }}>
        <input 
          type="tel" 
          placeholder="Enter 10-digit phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && checkMembership()}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '1px solid #ddd',
            boxSizing: 'border-box'
          }}
        />
      </div>

      <button 
        onClick={checkMembership} 
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: loading ? '#ccc' : '#007bff',
          color: 'white',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: 'bold'
        }}
      >
        {loading ? 'Checking...' : 'Check Status'}
      </button>

      {error && (
        <p style={{ color: 'red', textAlign: 'center', marginTop: '15px' }}>
          {error}
        </p>
      )}

      {result?.found && (
        <div style={{
          marginTop: '20px',
          padding: '15px',
          backgroundColor: 'white',
          borderRadius: '4px',
          border: '1px solid #ddd'
        }}>
          <p><strong>Gym ID:</strong> {result.gymId}</p>
          <p><strong>Member Name:</strong> {result.name}</p>
          <p><strong>Plan:</strong> {result.plan}</p>
          <p><strong>Valid Till:</strong> {result.validityEndDate}</p>
          <p>
            <strong>Status:</strong> 
            <span style={{
              marginLeft: '10px',
              padding: '4px 8px',
              backgroundColor: getStatusColor(result.status),
              color: 'white',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}>
              {result.status.toUpperCase()}
            </span>
          </p>
          {result.daysLeft && (
            <p style={{ fontSize: '12px', color: '#666' }}>
              Days remaining: {result.daysLeft}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
```

#### 18. **Create: `giri-gym/src/components/DietSelector.jsx`**

```jsx
import { useState, useEffect } from 'react';

export const DietSelector = ({ trainingType, onDietSelect, initialDietId }) => {
  const [diets, setDiets] = useState([]);
  const [defaultDietId, setDefaultDietId] = useState(null);
  const [selectedDietId, setSelectedDietId] = useState(initialDietId);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchDiets();
  }, [trainingType]);

  const fetchDiets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/diets');
      const data = await res.json();
      setDiets(data);

      // Get default diet for training type
      if (trainingType) {
        const mapRes = await fetch(`/api/diets/mapping/${trainingType}`);
        const mapData = await mapRes.json();
        if (mapData.diet) {
          setDefaultDietId(mapData.diet._id);
          setSelectedDietId(initialDietId || mapData.diet._id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch diets:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    onDietSelect(selectedDietId);
  }, [selectedDietId]);

  return (
    <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f9f9f9' }}>
      <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>
        Select Diet Plan:
      </label>
      <select
        value={selectedDietId || ''}
        onChange={(e) => setSelectedDietId(e.target.value || null)}
        disabled={loading}
        style={{
          width: '100%',
          padding: '8px',
          borderRadius: '4px',
          border: '1px solid #ddd',
          cursor: 'pointer'
        }}
      >
        <option value="">-- No Diet Plan --</option>
        {diets.map(diet => (
          <option key={diet._id} value={diet._id}>
            {diet.name}
            {defaultDietId === diet._id ? ' (Default)' : ''}
          </option>
        ))}
      </select>
      {selectedDietId && (
        <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          Selected diet will be included in invoice
        </p>
      )}
    </div>
  );
};
```

#### 19. **Create: `giri-gym/src/admin/AdminDietManager.jsx`**

```jsx
import { useState, useEffect } from 'react';

export const AdminDietManager = () => {
  const [diets, setDiets] = useState([]);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDiets();
  }, []);

  const fetchDiets = async () => {
    try {
      const res = await fetch('/api/diets');
      const data = await res.json();
      setDiets(data);
    } catch (error) {
      setError('Failed to fetch diets');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const url = editingId 
        ? `/api/diets/${editingId}`
        : '/api/diets';
      
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        return;
      }

      setFormData({ name: '', description: '' });
      setEditingId(null);
      fetchDiets();
    } catch (error) {
      setError('Operation failed');
    }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this diet?')) return;

    try {
      const res = await fetch(`/api/diets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchDiets();
      }
    } catch (error) {
      setError('Delete failed');
    }
  };

  const handleEdit = (diet) => {
    setFormData({ name: diet.name, description: diet.description });
    setEditingId(diet._id);
  };

  const handleCancel = () => {
    setFormData({ name: '', description: '' });
    setEditingId(null);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Diet Manager</h2>

      {error && <div style={{ color: 'red', marginBottom: '15px' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{
        marginBottom: '30px',
        padding: '15px',
        border: '1px solid #ddd',
        borderRadius: '4px'
      }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Diet Name:
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
            Description:
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows="4"
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '8px 16px',
              marginRight: '10px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '4px'
            }}
          >
            {editingId ? 'Update' : 'Create'} Diet
          </button>

          {editingId && (
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '8px 16px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
                borderRadius: '4px'
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div>
        <h3>Diets</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0' }}>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                Name
              </th>
              <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                Description
              </th>
              <th style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #ddd' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {diets.map(diet => (
              <tr key={diet._id}>
                <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>
                  {diet.name}
                </td>
                <td style={{ padding: '10px', borderBottom: '1px solid #ddd' }}>
                  {diet.description?.substring(0, 50)}...
                </td>
                <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #ddd' }}>
                  <button
                    onClick={() => handleEdit(diet)}
                    style={{
                      padding: '4px 8px',
                      marginRight: '5px',
                      backgroundColor: '#ffc107',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '3px'
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(diet._id)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#dc3545',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: '3px'
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

---

## Frontend: Component Integration Points

#### 20. **Modify: `giri-gym/src/pages/Home.jsx`**

Add this import and component call:

```jsx
import { MembershipCheckSection } from '../components/MembershipCheckSection';

// Inside the render/return:
<MembershipCheckSection />
```

#### 21. **Modify: `giri-gym/src/admin/AdminLayout.jsx`**

Add Diet Manager to sidebar:

```jsx
// In the sidebar menu:
<li>
  <Link to="/admin/diet-manager">
    🍽️ Diet Manager
  </Link>
</li>
```

#### 22. **Modify: `giri-gym/src/admin/AdminRegister.jsx`**

Add these imports and fields:

```jsx
import { DietSelector } from '../components/DietSelector';
import { InvoiceActions } from '../components/InvoiceActions';

// In the form, after plan selection:
<div>
  <label style={{ display: 'flex', alignItems: 'center', marginTop: '15px' }}>
    <input
      type="checkbox"
      checked={formData.includeDiet || false}
      onChange={(e) => setFormData({
        ...formData,
        includeDiet: e.target.checked
      })}
    />
    <span style={{ marginLeft: '8px' }}>Include Diet Plan</span>
  </label>

  {formData.includeDiet && (
    <DietSelector
      trainingType={formData.trainingType}
      onDietSelect={(dietId) => setFormData({ ...formData, dietId })}
    />
  )}
</div>

// After successful billing submission, show:
{successPaymentLogId && (
  <InvoiceActions
    paymentLogId={successPaymentLogId}
    memberPhone={formData.phone}
    memberName={formData.firstName}
  />
)}
```

#### 23. **Modify: `giri-gym/src/admin/AdminDashboardHome.jsx`**

Add export button to analytics section:

```jsx
// In the analytics display section:
<button
  onClick={exportAnalyticsPDF}
  style={{
    padding: '10px 20px',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '4px',
    marginTop: '15px'
  }}
>
  📥 Export as PDF
</button>

{/* Handler function */}
const exportAnalyticsPDF = async () => {
  const params = new URLSearchParams({
    startDate: filters.startDate || '',
    endDate: filters.endDate || ''
  });

  try {
    const response = await fetch(`/api/analytics/export-pdf?${params}`);
    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics_${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    alert('Failed to export PDF');
  }
};
```

---

## Environment Variables

#### 24. **Add to `.env` file:**

```bash
# PDF Sharing
SHARE_TOKEN_SECRET=your-super-secret-key-change-in-production-min-32-chars
DOMAIN=http://localhost:5000

# Or for production:
# DOMAIN=https://yourgym.com
```

---

## Package Dependencies

Add to `gym_project_backend/package.json`:

```json
{
  "dependencies": {
    "pdfkit": "^0.13.0",
    "node-cron": "^3.0.2"
  }
}
```

Install:
```bash
npm install pdfkit node-cron
```

---

## Testing Checklist

- [ ] **Feature 1**: Export analytics for various date ranges, verify PDF content
- [ ] **Feature 2**: Create, edit, list diets; test mapping and registration with diet
- [ ] **Feature 3**: Check membership with valid/invalid phone; test status codes
- [ ] **Feature 4**: Attempt duplicate phone registration; verify error response
- [ ] **Feature 5**: Generate share link, verify token expiration; test WhatsApp redirect

---

## Deployment Checklist

- [ ] All migrations run (database schema changes)
- [ ] Environment variables configured
- [ ] npm packages installed
- [ ] Auth middleware correctly protecting admin routes
- [ ] Public routes accessible without auth
- [ ] Error logging enabled
- [ ] HTTPS enforced for production
- [ ] Database indexes created for performance

