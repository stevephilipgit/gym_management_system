import mongoose from "mongoose";

const PackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    months: { type: Number, required: true },

    // Gender scope: "All" packages are visible to every trainer scope.
    // "Male"/"Female"/"Transgender" restrict which trainer scopes can see the
    // package. Writes are superadmin-only; scope is enforced server-side.
    gender: {
      type: String,
      enum: ["All", "Male", "Female", "Transgender"],
      default: "All",
      index: true,
    },

    priceWeightLoss: { type: Number, required: true },
    priceWeightGain: { type: Number, required: true },
    priceTransformation: { type: Number, required: true }
  },
  { timestamps: true }
);

export default mongoose.model("Package", PackageSchema);
