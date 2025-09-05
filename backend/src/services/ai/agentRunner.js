import logger from "../../core/logger.js";
import { confirmAndConsume, createPending } from "./pendingActionStore.js";
import { setMemory } from "./conversationStore.js";
import { executeTool } from "./toolExecutor.js";
import { isValidTool, requiresConfirmation } from "./toolSchemas.js";

const runWithTimeout = (toolName, promise, timeoutMs = 8000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Step timed out: ${toolName}`)), timeoutMs);
    }),
  ]);

const executeStep = async (step, previousResult) => {
  if (step.tool === "sendReminder") {
    if (previousResult === null || previousResult === undefined) {
      throw new Error("sendReminder requires member data from a previous step");
    }

    let membersArray = null;
    if (Array.isArray(previousResult?.members)) {
      membersArray = previousResult.members;
    } else if (Array.isArray(previousResult)) {
      membersArray = previousResult;
    } else {
      throw new Error("Previous step did not return a valid member list");
    }

    return runWithTimeout(
      step.tool,
      executeTool(step.tool, {
        members: membersArray,
      })
    );
  }

  return runWithTimeout(step.tool, executeTool(step.tool, step.params || {}));
};

export const runAgent = async (steps, sessionId) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("No steps to execute");
  }

  if (steps.length > 5) {
    throw new Error("Maximum 5 steps per request");
  }

  for (const step of steps) {
    if (!step || typeof step !== "object" || !step.tool) {
      throw new Error("Invalid step format");
    }

    if (!isValidTool(step.tool)) {
      throw new Error(`Unknown tool: ${step.tool}`);
    }
  }

  const confirmationIndex = steps.findIndex((step) => requiresConfirmation(step.tool));

  if (confirmationIndex !== -1) {
    let contextResult = null;

    for (let index = 0; index < confirmationIndex; index += 1) {
      contextResult = await executeStep(steps[index], contextResult);
      if (steps[index].tool === "getExpiringMembers") {
        setMemory(sessionId, "lastMembers", contextResult?.members || []);
      }
    }

    if (!contextResult?.members?.length) {
      return contextResult || { count: 0, members: [] };
    }

    const confirmationStep = steps[confirmationIndex];
    const token = createPending(
      sessionId,
      confirmationStep.tool,
      confirmationStep.params || {},
      contextResult
    );

    return {
      requiresConfirmation: true,
      confirmationToken: token,
      previewData: contextResult,
      toolName: confirmationStep.tool,
      message: "Review the data above and confirm to proceed.",
      expiresInSeconds: 300,
    };
  }

  let previousResult = null;

  for (let index = 0; index < steps.length; index += 1) {
    try {
      previousResult = await executeStep(steps[index], previousResult);
      if (steps[index].tool === "getExpiringMembers") {
        setMemory(sessionId, "lastMembers", previousResult?.members || []);
      }
    } catch (error) {
      logger.error(`[AgentRunner] Step ${index + 1} failed:`, error);
      return {
        completedSteps: index,
        failedAt: index,
        partialData: previousResult,
        error: `Step ${index + 1} failed: ${error.message}`,
      };
    }
  }

  return previousResult;
};

export const executeConfirmed = async (token) => {
  try {
    const entry = confirmAndConsume(token);
    const result = await runWithTimeout(
      entry.toolName,
      executeTool(entry.toolName, {
        members: Array.isArray(entry.context?.members)
          ? entry.context.members
          : Array.isArray(entry.context)
            ? entry.context
            : [],
      })
    );
    setMemory(entry.sessionId, "lastReminders", result.reminders || []);

    return { success: true, data: result };
  } catch (error) {
    if (error.message === "Action expired or not found. Please try again.") {
      return { success: false, message: "Action expired. Please start over." };
    }

    throw error;
  }
};
