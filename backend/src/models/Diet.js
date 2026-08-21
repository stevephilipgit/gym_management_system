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
    // Gender scope: "All" diets are visible to every trainer scope.
    // "Male" diets are visible to male-scope trainers (and superadmin).
    // "Female"/"Transgender" diets are visible to female_plus_transgender
    // scope (and superadmin). Scope is enforced server-side in dietController.
    gender: {
      type: String,
      enum: ["All", "Male", "Female", "Transgender"],
      default: "All",
      index: true,
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
