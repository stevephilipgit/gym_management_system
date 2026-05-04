import mongoose from 'mongoose';

const enquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 15,
    },
    preferred_branch: {
      type: String,
      required: true,
      enum: ['Mathur', 'Vepery', 'Any Branch'],
    },
    reason: {
      type: String,
      required: true,
      enum: [
        'Membership Plans',
        'Weight Loss',
        'Weight Gain',
        'Personal Training',
        'Transformation',
        'Pricing',
        'Branch Visit',
        'General Question',
        'Other',
      ],
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'closed', 'spam'],
      default: 'new',
    },
    source_page: {
      type: String,
      default: 'home',
      maxlength: 100,
    },
    ip_address: {
      type: String,
      default: null,
      maxlength: 45,
    },
    user_agent: {
      type: String,
      default: null,
      maxlength: 500,
    },
    assigned_to: {
      type: String,
      default: null,
      maxlength: 100,
    },
    notes: {
      type: String,
      default: null,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

// Indexes for fast admin queries
enquirySchema.index({ status: 1, createdAt: -1 });
enquirySchema.index({ preferred_branch: 1, status: 1 });
enquirySchema.index({ createdAt: -1 });
enquirySchema.index({ email: 1 });
enquirySchema.index({ phone: 1 });

export default mongoose.model('Enquiry', enquirySchema);
