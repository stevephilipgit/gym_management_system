import mongoose from "mongoose";

const chatSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      index: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Atomic message counter for deterministic ordering.
    messageSeq: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

chatSessionSchema.index({ ownerUserId: 1, status: 1, lastActivityAt: -1 });
chatSessionSchema.index({ ownerUserId: 1, sessionId: 1 });

export default mongoose.model("ChatSession", chatSessionSchema);