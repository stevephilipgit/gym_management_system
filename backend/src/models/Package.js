import mongoose from "mongoose";

const PackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    months: { type: Number, required: true },

    priceWeightLoss: { type: Number, required: true },
    priceWeightGain: { type: Number, required: true },
    priceTransformation: { type: Number, required: true }
  },
  { timestamps: true }
);

export default mongoose.model("Package", PackageSchema);
