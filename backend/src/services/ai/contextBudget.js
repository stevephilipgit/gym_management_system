/**
 * Deterministic context-budget enforcement.
 *
 * The provider input is bounded by a configured character budget
 * (AI_MAX_CONTEXT_LENGTH). This module implements an approximate,
 * deterministic truncation strategy WITHOUT a tokenizer:
 *
 *   - Tokens ≈ characters / 4 is a common rough heuristic; we deliberately
 *     budget by raw characters, which is deterministic, dependency-free and
 *     conservative enough for a small gym dataset. Documented approximation.
 *
 * Priority (highest → lowest):
 *   1. current user message  — never truncated
 *   2. system instructions   — always kept
 *   3. required context/memory — kept as a small structured block
 *   4. recent conversation   — kept newest-first
 *   5. older conversation    — dropped first
 *
 * We never split a message in the middle: dropping whole oldest messages
 * avoids producing malformed structured input to the provider.
 */

/**
 * Fit conversation history under a character budget.
 *
 * @param {object} params
 * @param {string} params.systemPrompt      fixed system instructions (kept)
 * @param {string} params.memoryBlock       small memory/preference text (kept)
 * @param {string} params.currentMessage    current user message (never truncated)
 * @param {Array<{role:string, parts:Array<{text:string}>}>} params.history
 *        conversation history, oldest→newest
 * @param {number} params.budgetChars       AI_MAX_CONTEXT_LENGTH
 * @returns {{ history: Array, droppedCount: number, truncated: boolean,
 *             usedChars: number, budgetChars: number }}
 */
export const fitHistoryToBudget = ({
  systemPrompt = "",
  memoryBlock = "",
  currentMessage = "",
  history = [],
  budgetChars = 10000,
}) => {
  const fixedChars =
    String(systemPrompt).length + String(memoryBlock).length + String(currentMessage).length;

  const availableForHistory = Math.max(0, budgetChars - fixedChars);

  // Iterate newest→oldest, greedily keeping messages while the cumulative
  // length fits. Messages are never split mid-string.
  const kept = [];
  let usedHistoryChars = 0;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const text = message.parts?.map((part) => part.text || "").join(" ") || "";
    const messageChars = text.length + 8; // small overhead per message
    if (usedHistoryChars + messageChars > availableForHistory) break;
    kept.push(message);
    usedHistoryChars += messageChars;
  }

  // Reverse back to oldest→newest for the provider.
  kept.reverse();

  const truncated = kept.length < history.length;
  const droppedCount = history.length - kept.length;
  const usedChars = fixedChars + usedHistoryChars;

  return { history: kept, droppedCount, truncated, usedChars, budgetChars };
};

/**
 * Convert a memory block into a compact text for the budget calculation.
 * Deterministic JSON for object values.
 */
export const serializeMemoryBlock = (memory = []) =>
  memory
    .map((entry) => {
      const value =
        typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
      return `  - ${entry.key}: ${value}`;
    })
    .join("\n");