import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    messageType: {
      type: String,
      enum: ["text", "data", "reminders", "error"],
      default: "text",
    },
    data: {
      type: Object,
      default: null,
    },
    providerMetadata: {
      type: Object,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

chatMessageSchema.index({ sessionId: 1, createdAt: 1 });
chatMessageSchema.index({ ownerUserId: 1, sessionId: 1, createdAt: 1 });

export default mongoose.model("ChatMessage", chatMessageSchema);