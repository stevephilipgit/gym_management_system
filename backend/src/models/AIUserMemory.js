import mongoose from "mongoose";

const aiUserMemorySchema = new mongoose.Schema(
  {
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    key: {
      type: String,
      required: true,
    },
    value: {
      type: Object,
      required: true,
    },
    source: {
      type: String,
      default: "ai",
      maxlength: 50,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

aiUserMemorySchema.index({ ownerUserId: 1, key: 1 }, { unique: true });
aiUserMemorySchema.index({ ownerUserId: 1, updatedAt: -1 });

export default mongoose.model("AIUserMemory", aiUserMemorySchema);