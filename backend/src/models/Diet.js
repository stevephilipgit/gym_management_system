import mongoose from "mongoose";

const dietSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for queries (name has unique:true which creates index automatically)
dietSchema.index({ isActive: 1 });

export default mongoose.model("Diet", dietSchema);
