/**
 * enquiryController.js
 * Handles public enquiry submission and admin management.
 * DB is the source of truth — email/sheets failures never block success.
 */
import Enquiry from '../models/Enquiry.js';
import logger from '../core/logger.js';
import { sendEnquiryNotification } from '../services/emailService.js';
import systemSettingsService from '../services/systemSettingsService.js';
import * as googleSheetsService from '../services/googleSheetsService.js';

// Sanitize helper — strips html/script tags and collapses whitespace
function sanitize(str = '') {
  return String(str)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// PUBLIC: POST /api/enquiries
// ============================================================
export const submitEnquiry = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      preferred_branch,
      reason,
      message = '',
      source_page = 'home',
      // honeypot field — bots fill this
      website,
    } = req.body;

    // Honeypot check (bots fill hidden field)
    if (website) {
      logger.warn('[Enquiry] Honeypot triggered', { ip: req.ip });
      // Fake success to fool bots
      return res.status(200).json({ success: true, message: 'Enquiry submitted successfully.' });
    }

    // ── Server-side validation ──────────────────────────────
    const errors = [];

    const cleanName = sanitize(name);
    if (!cleanName || cleanName.length < 2 || cleanName.length > 80) {
      errors.push('Name must be 2–80 characters.');
    }
    if (!/^[A-Za-z\s'.,-]+$/.test(cleanName)) {
      errors.push('Name may only contain letters and spaces.');
    }

    const cleanEmail = sanitize(email).toLowerCase();
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      errors.push('If provided, email must be a valid address.');
    }

    const cleanPhone = sanitize(phone).replace(/\s+/g, '');
    if (!cleanPhone || !/^[6-9]\d{9}$/.test(cleanPhone)) {
      errors.push('A valid 10-digit Indian mobile number is required.');
    }

    const validBranches = ['Mathur', 'Vepery', 'Any Branch'];
    const cleanBranch = sanitize(preferred_branch);
    if (!validBranches.includes(cleanBranch)) {
      errors.push('Please select a valid branch.');
    }

    const validReasons = [
      'Membership Plans', 'Weight Loss', 'Weight Gain', 'Personal Training',
      'Transformation', 'Pricing', 'Branch Visit', 'General Question', 'Other',
    ];
    const cleanReason = sanitize(reason);
    if (!validReasons.includes(cleanReason)) {
      errors.push('Please select a valid reason.');
    }

    const cleanMessage = sanitize(message);
    if (cleanMessage && cleanMessage.length > 500) {
      errors.push('Message must be under 500 characters.');
    }

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors[0], errors });
    }

    // ── Save to DB (source of truth) ────────────────────────
    const enquiry = await Enquiry.create({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      preferred_branch: cleanBranch,
      reason: cleanReason,
      message: cleanMessage,
      source_page: sanitize(source_page).substring(0, 100),
      ip_address: (req.ip || '').substring(0, 45),
      user_agent: (req.get('user-agent') || '').substring(0, 500),
      status: 'new',
    });

    logger.info('[Enquiry] New enquiry created', {
      id: enquiry._id,
      name: cleanName,
      phone: cleanPhone,
      branch: cleanBranch,
      reason: cleanReason,
    });

    // ── Email notification (non-blocking) ───────────────────
    try {
      const settings = await systemSettingsService.getSettings();
      const notifyEmail = settings?.enquiry_notify_email;
      const notificationsEnabled = settings?.email_notifications_enabled !== false;
      if (notifyEmail && notificationsEnabled) {
        sendEnquiryNotification(enquiry, notifyEmail).then((sent) => {
          logger.info('[Enquiry] Email notification', { sent, to: notifyEmail });
        });
      }
    } catch (emailErr) {
      logger.error('[Enquiry] Email trigger failed', { error: emailErr.message });
    }

    // ── Google Sheets Integration (non-blocking) ─────────────
    try {
      const settings = await systemSettingsService.getSettings();
      if (settings?.sheets_enabled && settings?.sheets_email) {
        const connector = await googleSheetsService.getConnector(settings.sheets_email);
        if (connector && connector.isConnected && connector.accessToken) {
          const tokens = {
            access_token: connector.accessToken,
            refresh_token: connector.refreshToken,
          };
          const enquiryData = {
            date: new Date(enquiry.createdAt).toLocaleString('en-IN'),
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            branch: cleanBranch,
            reason: cleanReason,
            message: cleanMessage,
          };
          googleSheetsService.addEnquiryEntry(tokens, connector.spreadsheetId, enquiryData).then((res) => {
            logger.info('[Enquiry] Synced to Google Sheets', { rowIndex: res.rowIndex });
          }).catch((err) => {
            logger.error('[Enquiry] Google Sheets sync failed', { error: err.message });
          });
        }
      }
    } catch (sheetErr) {
      logger.error('[Enquiry] Google Sheets trigger failed', { error: sheetErr.message });
    }

    // ── Response ────────────────────────────────────────────
    const settings = await systemSettingsService.getSettings().catch(() => ({}));
    const successMsg = settings?.enquiry_success_message ||
      'Thank you! Our team will reach out to you shortly.';

    return res.status(200).json({
      success: true,
      message: successMsg,
      id: enquiry._id,
    });
  } catch (err) {
    logger.error('[Enquiry] Submit failed', { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
    });
  }
};

// ============================================================
// ADMIN: GET /api/enquiries
// ============================================================
export const getEnquiries = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      status,
      branch,
      reason,
      gender,
      search,
      dateFrom,
      dateTo,
    } = req.query;

    const filter = {};

    if (status && status !== 'all') filter.status = status;
    if (branch && branch !== 'all') filter.preferred_branch = branch;

    // Apply gender scope filter based on admin role/scope
    if (req.admin && req.admin.scope) {
      const allowedGenders = {
        all: ["Male", "Female", "Transgender"],
        male: ["Male"],
        female_plus_transgender: ["Female", "Transgender"],
      }[req.admin.scope] || [];

      // If gender query param provided, use it (override scope filter)
      if (gender) {
        filter.gender = gender;
      } else if (allowedGenders.length > 0) {
        // Apply scope-based gender filter
        filter.gender = { $in: allowedGenders };
      }
    }

    if (reason && reason !== 'all') filter.reason = reason;
    if (reason && reason !== 'all') filter.reason = reason;

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { phone: regex }, { email: regex }];
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [enquiries, total] = await Promise.all([
      Enquiry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Enquiry.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      enquiries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    logger.error('[Enquiry] getEnquiries failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiries.' });
  }
};

// ============================================================
// ADMIN: GET /api/enquiries/:id
// ============================================================
export const getEnquiryById = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ success: false, message: 'Enquiry not found.' });

    // Verify admin scope against enquiry gender
    if (req.admin && req.admin.scope) {
      const allowedGenders = {
        all: ["Male", "Female", "Transgender"],
        male: ["Male"],
        female_plus_transgender: ["Female", "Transgender"],
      }[req.admin.scope] || [];
      if (!allowedGenders.includes(enquiry.gender)) {
        return res.status(403).json({ success: false, message: 'Access denied: insufficient scope for this enquiry' });
      }
    }

    return res.json({ success: true, enquiry });
  } catch (err) {
    logger.error('[Enquiry] getEnquiryById failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiry.' });
  }
};

// ============================================================
// ADMIN: PATCH /api/enquiries/:id/status
// ============================================================
export const updateEnquiryStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['new', 'contacted', 'closed', 'spam'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    // Verify admin scope against enquiry gender BEFORE update
    const enquiry = await Enquiry.findById(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ success: false, message: 'Enquiry not found.' });

    if (req.admin && req.admin.scope) {
      const allowedGenders = {
        all: ["Male", "Female", "Transgender"],
        male: ["Male"],
        female_plus_transgender: ["Female", "Transgender"],
      }[req.admin.scope] || [];
      if (!allowedGenders.includes(enquiry.gender)) {
        return res.status(403).json({ success: false, message: 'Access denied: insufficient scope for this enquiry' });
      }
    }

    const updateData = { status };
    if (notes !== undefined) updateData.notes = String(notes).substring(0, 1000);

    const updatedEnquiry = await Enquiry.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).lean();

    if (!updatedEnquiry) return res.status(404).json({ success: false, message: 'Enquiry not found.' });

    logger.info('[Enquiry] Status updated', {
      id: updatedEnquiry._id,
      status,
      adminId: req.admin?.id,
    });

    return res.json({ success: true, enquiry: updatedEnquiry });
  } catch (err) {
    logger.error('[Enquiry] updateEnquiryStatus failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to update status.' });
  }
};

// ============================================================
// ADMIN: DELETE /api/enquiries/:id
// ============================================================
export const deleteEnquiry = async (req, res) => {
  try {
    // Verify admin scope - only superadmin (scope=all) can delete
    if (req.admin && req.admin.scope !== "all") {
      return res.status(403).json({ success: false, message: 'Access denied: only superadmin can delete enquiries' });
    }

    const enquiry = await Enquiry.findByIdAndDelete(req.params.id).lean();
    if (!enquiry) return res.status(404).json({ success: false, message: 'Enquiry not found.' });

    logger.info('[Enquiry] Deleted', { id: req.params.id, adminId: req.admin?.id });

    return res.json({ success: true, message: 'Enquiry deleted.' });
  } catch (err) {
    logger.error('[Enquiry] deleteEnquiry failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to delete enquiry.' });
  }
};

// ============================================================
// ADMIN: GET /api/enquiries/export/csv
// ============================================================
export const exportEnquiriesCSV = async (req, res) => {
  try {
    const { status, branch, dateFrom, dateTo, gender } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (branch && branch !== 'all') filter.preferred_branch = branch;

    // Apply gender scope filter based on admin role/scope
    if (req.admin && req.admin.scope) {
      const allowedGenders = {
        all: ["Male", "Female", "Transgender"],
        male: ["Male"],
        female_plus_transgender: ["Female", "Transgender"],
      }[req.admin.scope] || [];

      // If gender query param provided, use it (override scope filter)
      if (gender) {
        filter.gender = gender;
      } else if (allowedGenders.length > 0) {
        filter.gender = { $in: allowedGenders };
      }
    }

    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const enquiries = await Enquiry.find(filter).sort({ createdAt: -1 }).lean();

    const header = ['Date', 'Name', 'Email', 'Phone', 'Branch', 'Reason', 'Message', 'Status', 'Notes'];
    const rows = enquiries.map((e) => [
      new Date(e.createdAt).toLocaleString('en-IN'),
      e.name,
      e.email,
      e.phone,
      e.preferred_branch,
      e.reason,
      e.message?.replace(/"/g, '""') || '',
      e.status,
      e.notes?.replace(/"/g, '""') || '',
    ].map((v) => `"${v}"`).join(','));

    const csv = [header.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="enquiries_${Date.now()}.csv"`);
    return res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (err) {
    logger.error('[Enquiry] exportCSV failed', { error: err.message });
    return res.status(500).json({ success: false, message: 'Export failed.' });
  }
};

// ============================================================
// CRON: Cleanup spam/old enquiries
// ============================================================
export const cleanupOldEnquiries = async () => {
  try {
    const settings = await systemSettingsService.getSettings();
    const retentionDays = settings?.enquiry_retention_days || 90;
    const spamRetentionDays = 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    const spamCutoff = new Date();
    spamCutoff.setDate(spamCutoff.getDate() - spamRetentionDays);

    // Delete old spam/closed only
    const result = await Enquiry.deleteMany({
      $or: [
        { status: { $in: ['spam'] }, createdAt: { $lt: spamCutoff } },
        { status: 'closed', createdAt: { $lt: cutoff } },
      ],
    });

    logger.info('[Enquiry] Cleanup job completed', { deleted: result.deletedCount });
    return result.deletedCount;
  } catch (err) {
    logger.error('[Enquiry] Cleanup job failed', { error: err.message });
    return 0;
  }
};
