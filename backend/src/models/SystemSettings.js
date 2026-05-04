import mongoose from 'mongoose';

const systemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'gym_rules',
      unique: true,
    },

    // ── ATTENDANCE RULES ────────────────────────────────────
    oneVisitPerDay: { type: Boolean, default: true },
    duplicatePunchSeconds: { type: Number, default: 30 },
    latePunchThreshold: { type: String, default: '21:00' },
    openingTime: { type: String, default: '04:00' },
    closingTime: { type: String, default: '22:00' },
    blockExpiredMembers: { type: Boolean, default: true },
    expiredGraceDays: { type: Number, default: 0 },
    soundEnabled: { type: Boolean, default: true },

    // ── BUSINESS INFO ───────────────────────────────────────
    gym_name: { type: String, default: 'Giri Gym', maxlength: 100 },
    gym_tagline: { type: String, default: 'Premium Fitness Club', maxlength: 200 },
    support_phone: { type: String, default: '+91 93423 93935', maxlength: 20 },
    whatsapp_number: { type: String, default: '919342393935', maxlength: 20 },
    public_email: { type: String, default: 'girigym@gmail.com', maxlength: 120 },
    footer_text: { type: String, default: 'High-performance training with premium coaching standards.', maxlength: 300 },

    // ── ENQUIRY SETTINGS ────────────────────────────────────
    enquiry_notify_email: { type: String, default: '', maxlength: 120 },
    enquiry_success_message: { type: String, default: 'Thank you! Our team will reach out to you shortly.', maxlength: 300 },
    enquiry_auto_reply_enabled: { type: Boolean, default: false },
    enquiry_auto_reply_subject: { type: String, default: 'Thank you for contacting Giri Gym!', maxlength: 200 },
    enquiry_retention_days: { type: Number, default: 90 },

    // ── BRANCH: MATHUR ──────────────────────────────────────
    branch_mathur_name: { type: String, default: 'Giri Gym - Mathur', maxlength: 100 },
    branch_mathur_address: { type: String, default: 'Next to Beloved School, Kamaraj Nagar, Mathur, Chennai, Tamil Nadu 600068', maxlength: 300 },
    branch_mathur_phone: { type: String, default: '+91 93423 93935', maxlength: 20 },
    branch_mathur_map_url: { type: String, default: 'https://www.google.com/maps/search/?api=1&query=Giri+Gym+Mathur+Chennai', maxlength: 500 },
    branch_mathur_image_url: { type: String, default: '', maxlength: 500 },

    // ── BRANCH: VEPERY ──────────────────────────────────────
    branch_vepery_name: { type: String, default: 'Giri Gym - Vepery', maxlength: 100 },
    branch_vepery_address: { type: String, default: 'No 64, Opposite Bentick Girls Higher Secondary School, Jermiah Road, Vepery, Chennai 600007', maxlength: 300 },
    branch_vepery_phone: { type: String, default: '+91 98765 43210', maxlength: 20 },
    branch_vepery_map_url: { type: String, default: 'https://www.google.com/maps/search/?api=1&query=Giri+Gym+Vepery+Chennai', maxlength: 500 },
    branch_vepery_image_url: { type: String, default: '', maxlength: 500 },

    // ── SOCIAL LINKS ────────────────────────────────────────
    social_instagram: { type: String, default: '', maxlength: 300 },
    social_facebook: { type: String, default: '', maxlength: 300 },
    social_youtube: { type: String, default: '', maxlength: 300 },
    social_google_reviews: { type: String, default: '', maxlength: 300 },

    // ── INTEGRATIONS ─────────────────────────────────────────
    sheets_enabled: { type: Boolean, default: false },
    sheets_email: { type: String, default: '', maxlength: 120 },
    sheets_default_name: { type: String, default: 'Giri Gym Enquiries', maxlength: 100 },
    email_notifications_enabled: { type: Boolean, default: true },

    // ── METADATA ─────────────────────────────────────────────
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model('SystemSettings', systemSettingsSchema);
