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
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  getDefaults() {
    return {
      key: 'gym_rules',
      // Attendance
      oneVisitPerDay: true,
      duplicatePunchSeconds: 30,
      latePunchThreshold: '21:00',
      openingTime: '04:00',
      closingTime: '22:00',
      blockExpiredMembers: true,
      expiredGraceDays: 0,
      soundEnabled: true,
      // Business Info
      gym_name: 'Giri Gym',
      gym_tagline: 'Premium Fitness Club',
      support_phone: '+91 93423 93935',
      whatsapp_number: '919342393935',
      public_email: 'girigym@gmail.com',
      footer_text: 'High-performance training with premium coaching standards.',
      // Enquiry Settings
      enquiry_notify_email: '',
      enquiry_success_message: 'Thank you! Our team will reach out to you shortly.',
      enquiry_auto_reply_enabled: false,
      enquiry_auto_reply_subject: 'Thank you for contacting Giri Gym!',
      enquiry_retention_days: 90,
      // Branch: Mathur
      branch_mathur_name: 'Giri Gym - Mathur',
      branch_mathur_address: 'Next to Beloved School, Kamaraj Nagar, Mathur, Chennai, Tamil Nadu 600068',
      branch_mathur_phone: '+91 93423 93935',
      branch_mathur_map_url: 'https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai',
      branch_mathur_image_url: '',
      // Branch: Vepery
      branch_vepery_name: 'Giri Gym - Vepery',
      branch_vepery_address: 'No 64, Opposite Bentick Girls Higher Secondary School, Jermiah Road, Vepery, Chennai 600007',
      branch_vepery_phone: '+91 98765 43210',
      branch_vepery_map_url: 'https://www.google.com/maps/search/?api=1&query=Giri+Gym+Vepery+Chennai',
      branch_vepery_image_url: '',
      // Social
      social_instagram: '',
      social_facebook: '',
      social_youtube: '',
      social_google_reviews: '',
      // Integrations
      sheets_enabled: false,
      sheets_email: '',
      sheets_default_name: 'Giri Gym Enquiries',
      email_notifications_enabled: true,
    };
  }

  async getSettings() {
    try {
      const now = Date.now();
      if (this.cache && this.cacheTime && now - this.cacheTime < this.cacheTTL) {
        return this.cache;
      }

      let settings = await SystemSettings.findOne({ key: 'gym_rules' });
      if (!settings) {
        settings = await SystemSettings.create(this.getDefaults());
        logger.info('[Settings] Created default gym rules');
      }

      this.cache = settings.toObject();
      this.cacheTime = now;
      return this.cache;
    } catch (error) {
      logger.error('[Settings] Error getting settings', { error });
      // Return defaults as fallback so the app keeps running
      return this.getDefaults();
    }
  }

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

      logger.info('[Settings] Settings updated', { adminId, fields: Object.keys(updates) });
      return settings;
    } catch (error) {
      logger.error('[Settings] Error updating settings', { error });
      throw error;
    }
  }

  invalidateCache() {
    this.cache = null;
    this.cacheTime = null;
  }
}

export default new SystemSettingsService();
