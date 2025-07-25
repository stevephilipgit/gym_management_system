import mongoose from "mongoose";

const dietMappingSchema = new mongoose.Schema(
  {
    trainingTypeId: {
      type: String,
      required: true,
    },
    dietId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Diet",
      required: true,
    },
  },
  { timestamps: true }
);

// Unique constraint: one training type can have one default diet
dietMappingSchema.index({ trainingTypeId: 1 }, { unique: true });

export default mongoose.model("DietMapping", dietMappingSchema);
