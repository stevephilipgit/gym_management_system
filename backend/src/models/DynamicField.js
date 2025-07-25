// models/DynamicField.js
import mongoose from "mongoose";

const dynamicFieldSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    label: {
      type: String,
      required: true,
      trim: true
    },

    type: {
      type: String,
      enum: ["text", "number", "date", "dropdown"],
      required: true
    },

    required: {
      type: Boolean,
      default: false
    },

    options: {
      type: [String],
      default: [],
      validate: {
        validator: function (v) {
          return this.type !== "dropdown" || (Array.isArray(v) && v.length > 0);
        },
        message: "Dropdown fields must have at least one option"
      }
    },

    isEnabled: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

export default mongoose.model("DynamicField", dynamicFieldSchema);
