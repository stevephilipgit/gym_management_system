// controllers/dietController.js - Diet management with server-side gender scope
import Diet from "../models/Diet.js";
import logger from "../core/logger.js";
import scopeResolver from "../core/scopeResolver.js";

// The genders a trainer may SEE / CREATE.
//   male:                   All + Male
//   female_plus_transgender: All + Female + Transgender
//   all (superadmin):        everything
const allowedDietGenders = (req) => {
  const allowed = scopeResolver.getScopeAllowedGenders(req);
  if (allowed.length === 0 || allowed.length >= 3) {
    return ["All", "Male", "Female", "Transgender"];
  }
  return ["All", ...allowed];
};

// Default gender for a diet created by a trainer: trainers CANNOT pick "All" —
// their diets belong to their own scope. Superadmin defaults to "All".
const defaultDietGender = (req) => {
  const scope = req.admin?.scope;
  if (scope === "male") return "Male";
  if (scope === "female_plus_transgender") return "Female";
  return "All";
};

export const createDiet = async (req, res) => {
  try {
    const { name, description, gender } = req.body;

    if (!name || name.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Diet name is required (min 3 characters)" });
    }

    // Server-side gender scope. Trainers are LOCKED to their own scope — the
    // client gender value is ignored entirely. Superadmin may choose any
    // gender (default "All").
    const scope = req.admin?.scope;
    let finalGender;
    if (scope === "male" || scope === "female_plus_transgender") {
      finalGender = defaultDietGender(req);
    } else {
      finalGender = ["All", "Male", "Female", "Transgender"].includes(gender) ? gender : "All";
    }

    const diet = new Diet({
      name: name.trim(),
      description: description || "",
      gender: finalGender,
    });

    await diet.save();

    logger.info(`Diet created: ${diet.name} (${finalGender})`);
    return res.status(201).json({ success: true, diet });
  } catch (error) {
    logger.error("Error creating diet", { error });
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Diet name already exists" });
    }
    return res.status(500).json({ success: false, message: "Failed to create diet" });
  }
};

export const getAllDiets = async (req, res) => {
  try {
    // Gender-scoped query: trainers only receive diets for their allowed genders.
    const diets = await Diet.find({
      isActive: true,
      gender: { $in: allowedDietGenders(req) },
    }).sort({ name: 1 });

    return res.json({ success: true, diets });
  } catch (error) {
    logger.error("Error fetching diets", { error });
    return res.status(500).json({ success: false, message: "Failed to fetch diets" });
  }
};

export const getDietById = async (req, res) => {
  try {
    const diet = await Diet.findById(req.params.id);
    if (!diet) {
      return res.status(404).json({ success: false, message: "Diet not found" });
    }
    // Scope check: never return a diet from outside the trainer's scope.
    if (!allowedDietGenders(req).includes(diet.gender)) {
      return res.status(404).json({ success: false, message: "Diet not found" });
    }
    return res.json({ success: true, diet });
  } catch (error) {
    logger.error("Error fetching diet", { error });
    return res.status(500).json({ success: false, message: "Failed to fetch diet" });
  }
};

export const updateDiet = async (req, res) => {
  try {
    const diet = await Diet.findById(req.params.id);
    if (!diet) {
      return res.status(404).json({ success: false, message: "Diet not found" });
    }
    // Scope check on the existing diet
    if (!allowedDietGenders(req).includes(diet.gender)) {
      return res.status(404).json({ success: false, message: "Diet not found" });
    }

    const { name, description, gender, isActive } = req.body;

    // Trainers can never change a diet's gender (locked to their scope).
    const isTrainerScope = req.admin?.scope === "male" || req.admin?.scope === "female_plus_transgender";
    if (isTrainerScope && gender !== undefined) {
      return res.status(403).json({ success: false, message: "Diet gender is locked to your trainer scope" });
    }

    const updates = { updatedAt: new Date() };
    if (name !== undefined) {
      if (String(name).trim().length < 3) {
        return res.status(400).json({ success: false, message: "Diet name must be at least 3 characters" });
      }
      updates.name = String(name).trim();
    }
    if (description !== undefined) updates.description = description;
    if (gender !== undefined) {
      if (["All", "Male", "Female", "Transgender"].includes(gender)) {
        updates.gender = gender;
      } else {
        return res.status(400).json({ success: false, message: "Invalid diet gender" });
      }
    }
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const updated = await Diet.findByIdAndUpdate(req.params.id, updates, { new: true });
    logger.info(`Diet updated: ${updated.name}`);
    return res.json({ success: true, diet: updated });
  } catch (error) {
    logger.error("Error updating diet", { error });
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Diet name already exists" });
    }
    return res.status(500).json({ success: false, message: "Failed to update diet" });
  }
};

export const deleteDiet = async (req, res) => {
  try {
    // Route-level requireRole("superadmin") already gates this endpoint.
    const diet = await Diet.findById(req.params.id);
    if (!diet) {
      return res.status(404).json({ success: false, message: "Diet not found" });
    }
    await Diet.findByIdAndDelete(req.params.id);
    logger.info(`Diet deleted: ${diet.name}`);
    return res.json({ success: true, message: "Diet deleted successfully" });
  } catch (error) {
    logger.error("Error deleting diet", { error });
    return res.status(500).json({ success: false, message: "Failed to delete diet" });
  }
};

export default {
  createDiet,
  getAllDiets,
  getDietById,
  updateDiet,
  deleteDiet,
};
