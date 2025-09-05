import Diet from "../models/Diet.js";
import DietMapping from "../models/DietMapping.js";
import logger from "../core/logger.js";

class DietService {
  // CRUD Operations
  async createDiet(name, description) {
    try {
      const diet = new Diet({ name, description });
      return await diet.save();
    } catch (error) {
      logger.error("Diet creation error:", error);
      throw error;
    }
  }

  async getAllDiets() {
    try {
      return await Diet.find({ isActive: true }).sort({ name: 1 });
    } catch (error) {
      logger.error("Diets fetch error:", error);
      throw error;
    }
  }

  async getDietById(dietId) {
    try {
      return await Diet.findById(dietId);
    } catch (error) {
      logger.error("Diet fetch error:", error);
      throw error;
    }
  }

  async updateDiet(dietId, updates) {
    try {
      return await Diet.findByIdAndUpdate(
        dietId,
        { ...updates, updatedAt: new Date() },
        { new: true }
      );
    } catch (error) {
      logger.error("Diet update error:", error);
      throw error;
    }
  }

  async deleteDiet(dietId) {
    try {
      // Soft delete
      return await Diet.findByIdAndUpdate(
        dietId,
        { isActive: false, updatedAt: new Date() },
        { new: true }
      );
    } catch (error) {
      logger.error("Diet delete error:", error);
      throw error;
    }
  }

  // Mapping Operations
  async setDefaultDietForTrainingType(trainingTypeId, dietId) {
    try {
      // Delete existing mapping for this training type
      await DietMapping.deleteMany({ trainingTypeId });

      // Create new mapping if dietId provided
      if (dietId) {
        const mapping = new DietMapping({ trainingTypeId, dietId });
        return await mapping.save();
      }
      return null;
    } catch (error) {
      logger.error("Mapping error:", error);
      throw error;
    }
  }

  async getDefaultDietForTrainingType(trainingTypeId) {
    try {
      const mapping = await DietMapping.findOne({ trainingTypeId }).populate("dietId");
      return mapping?.dietId || null;
    } catch (error) {
      logger.error("Mapping fetch error:", error);
      throw error;
    }
  }

  async getDefaultDietsByTrainingTypes(trainingTypeIds) {
    try {
      const mappings = await DietMapping.find({
        trainingTypeId: { $in: trainingTypeIds },
      }).populate("dietId");

      const dietMap = {};
      mappings.forEach((m) => {
        dietMap[m.trainingTypeId] = m.dietId;
      });
      return dietMap;
    } catch (error) {
      logger.error("Mappings fetch error:", error);
      throw error;
    }
  }
}

export default new DietService();
