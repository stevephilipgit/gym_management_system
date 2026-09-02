import systemSettingsService from '../services/systemSettingsService.js';
import logger from '../core/logger.js';
import { auditActions } from '../utils/auditLog.js';

/**
 * System Settings Controller
 */

const ALLOWED_FIELDS = [
  // Attendance
  'oneVisitPerDay', 'duplicatePunchSeconds', 'latePunchThreshold',
  'openingTime', 'closingTime', 'blockExpiredMembers', 'expiredGraceDays', 'soundEnabled',
  // Business Info
  'gym_name', 'gym_tagline', 'support_phone', 'whatsapp_number', 'public_email', 'footer_text',
  // Enquiry Settings
  'enquiry_notify_email', 'enquiry_success_message', 'enquiry_auto_reply_enabled',
  'enquiry_auto_reply_subject', 'enquiry_retention_days',
  // Branch: Mathur
  'branch_mathur_name', 'branch_mathur_address', 'branch_mathur_phone',
  'branch_mathur_map_url', 'branch_mathur_image_url',
  // Branch: Vepery
  'branch_vepery_name', 'branch_vepery_address', 'branch_vepery_phone',
  'branch_vepery_map_url', 'branch_vepery_image_url',
  // Social
  'social_instagram', 'social_facebook', 'social_youtube', 'social_google_reviews',
  // Integrations
  'sheets_enabled', 'sheets_email', 'sheets_default_name', 'email_notifications_enabled',
  // Export
  'export_retention_days',
];

// GET /api/settings
export const getSettings = async (req, res) => {
  try {
    const settings = await systemSettingsService.getSettings();
    res.json({ success: true, settings });
  } catch (error) {
    logger.error('Error fetching settings', { error });
    res.status(500).json({ success: false, message: 'Failed to fetch settings' });
  }
};

// PUT /api/settings
export const updateSettings = async (req, res) => {
  try {
    const adminId = req.admin?.id || null;
    const updates = req.body;

    // Whitelist filter
    const validUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS.includes(key)) {
        validUpdates[key] = value;
      }
    }

    const settings = await systemSettingsService.updateSettings(validUpdates, adminId);

    await auditActions.settingsUpdated(req, validUpdates);

    res.json({ success: true, message: 'Settings updated successfully', settings });
  } catch (error) {
    logger.error('Error updating settings', { error });
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
};
