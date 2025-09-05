import mongoose from 'mongoose';
import logger from '../core/logger.js';

const SystemSettings = mongoose.model('SystemSettings');

/**
 * System settings management with simple in-memory cache
 */
class SystemSettingsService {
  constructor() {
    this.cache = null;
    this.cacheTime = null;
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  }

  /**
   * Get default settings
   */
  getDefaults() {
    return {
      key: 'gym_rules',
      oneVisitPerDay: true,
      duplicatePunchSeconds: 30,
      latePunchThreshold: '21:00',
      openingTime: '04:00',
      closingTime: '22:00',
      blockExpiredMembers: true,
      expiredGraceDays: 0,
      soundEnabled: true,
    };
  }

  /**
   * Get settings (with simple memory cache)
   */
  async getSettings() {
    try {
      const now = Date.now();

      // Return cached if still valid
      if (this.cache && this.cacheTime && now - this.cacheTime < this.cacheTTL) {
        logger.debug('Returning cached settings');
        return this.cache;
      }

      // Fetch from DB
      let settings = await SystemSettings.findOne({ key: 'gym_rules' });

      // If not exists, create with defaults
      if (!settings) {
        settings = await SystemSettings.create(this.getDefaults());
        logger.info('Created default gym rules');
      }

      // Update cache
      this.cache = settings.toObject();
      this.cacheTime = now;

      return this.cache;
    } catch (error) {
      logger.error('Error getting settings', { error });
      throw error;
    }
  }

  /**
   * Update settings
   */
  async updateSettings(updates, adminId) {
    try {
      const settings = await SystemSettings.findOneAndUpdate(
        { key: 'gym_rules' },
        { ...updates, updatedBy: adminId },
        { new: true, upsert: true }
      );

      // Invalidate cache
      this.cache = null;
      this.cacheTime = null;

      logger.info('Settings updated by admin', { adminId, updates });

      return settings;
    } catch (error) {
      logger.error('Error updating settings', { error });
      throw error;
    }
  }

  /**
   * Invalidate cache manually (useful for testing)
   */
  invalidateCache() {
    this.cache = null;
    this.cacheTime = null;
    logger.debug('Settings cache invalidated');
  }
}

export default new SystemSettingsService();
