import systemSettingsService from '../services/systemSettingsService.js';
import logger from '../core/logger.js';
import auditLog from '../utils/auditLog.js';

/**
 * System Settings Controller
 */

// GET /api/settings
export const getSettings = async (req, res) => {
  try {
    const settings = await systemSettingsService.getSettings();
    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    logger.error('Error fetching settings', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
    });
  }
};

// PUT /api/settings
export const updateSettings = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const updates = req.body;

    // Validate all fields
    const allowedFields = [
      'oneVisitPerDay',
      'duplicatePunchSeconds',
      'latePunchThreshold',
      'openingTime',
      'closingTime',
      'blockExpiredMembers',
      'expiredGraceDays',
      'soundEnabled',
    ];

    const validUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        validUpdates[key] = value;
      }
    }

    const settings = await systemSettingsService.updateSettings(
      validUpdates,
      adminId
    );

    await auditLog.settingsUpdated(req, validUpdates);

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings,
    });
  } catch (error) {
    logger.error('Error updating settings', { error });
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
    });
  }
};
