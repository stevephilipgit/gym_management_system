import AIUserMemory from "../../models/AIUserMemory.js";
import aiConfig from "../../config/aiConfig.js";

/**
 * Retrieve a memory value for an admin. Ownership enforced.
 */
export const getMemory = async (ownerUserId, key) => {
  const entry = await AIUserMemory.findOne({ ownerUserId, key });
  return entry ? entry.value : null;
};

/**
 * Set or update a memory value for an admin. Ownership enforced.
 * Prunes oldest entries after write so AI_MAX_MEMORY_ITEMS stays enforced.
 */
export const setMemory = async (ownerUserId, key, value, source = "ai") => {
  await AIUserMemory.updateOne(
    { ownerUserId, key },
    { ownerUserId, key, value, source, updatedAt: new Date() },
    { upsert: true }
  );
  await pruneMemory(ownerUserId);
};

/**
 * Delete a memory entry. Ownership enforced.
 */
export const deleteMemory = async (ownerUserId, key) => {
  await AIUserMemory.deleteOne({ ownerUserId, key });
};

/**
 * Delete ALL memory for an admin. Ownership enforced.
 */
export const clearAllMemory = async (ownerUserId) => {
  await AIUserMemory.deleteMany({ ownerUserId });
};

/**
 * List all memory entries for an admin, limited to max items.
 */
export const listMemory = async (ownerUserId) => {
  const entries = await AIUserMemory.find({ ownerUserId })
    .sort({ updatedAt: -1 })
    .limit(aiConfig.maxMemoryItems)
    .lean();
  return entries.map((e) => ({ key: e.key, value: e.value, source: e.source }));
};

/**
 * Enforce max memory items per admin by pruning oldest entries.
 */
export const pruneMemory = async (ownerUserId) => {
  const count = await AIUserMemory.countDocuments({ ownerUserId });
  if (count > aiConfig.maxMemoryItems) {
    const excess = await AIUserMemory.find({ ownerUserId })
      .sort({ updatedAt: 1 })
      .limit(count - aiConfig.maxMemoryItems)
      .select("_id")
      .lean();
    const ids = excess.map((e) => e._id);
    await AIUserMemory.deleteMany({ _id: { $in: ids } });
  }
};