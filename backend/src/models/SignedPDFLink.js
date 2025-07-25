import mongoose from "mongoose";

const signedPDFLinkSchema = new mongoose.Schema(
  {
    paymentLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PaymentLog",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    lastAccessedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Auto-delete expired documents (TTL index)
signedPDFLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("SignedPDFLink", signedPDFLinkSchema);
