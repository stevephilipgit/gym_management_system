import { TOOL_REGISTRY, isValidTool } from "./toolSchemas.js";
import * as tools from "./tools.js";

const TOOL_FUNCTIONS = Object.keys(TOOL_REGISTRY).reduce((acc, toolName) => {
  if (typeof tools[toolName] === "function") {
    acc[toolName] = tools[toolName];
  }
  return acc;
}, {});

const matchesType = (value, expectedType) => {
  if (expectedType === "array") {
    return Array.isArray(value);
  }

  return typeof value === expectedType;
};

export const executeTool = async (toolName, params = {}) => {
  try {
    if (!isValidTool(toolName)) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const toolFn = TOOL_FUNCTIONS[toolName];
    if (typeof toolFn !== "function") {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const paramDefinitions = TOOL_REGISTRY[toolName].params || {};
    const validatedArgs = [];

    for (const [paramName, definition] of Object.entries(paramDefinitions)) {
      const hasParam = Object.prototype.hasOwnProperty.call(params, paramName);

      if (hasParam) {
        if (!matchesType(params[paramName], definition.type)) {
          throw new Error(`Invalid param type for ${paramName}`);
        }
        validatedArgs.push(params[paramName]);
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(definition, "default")) {
        validatedArgs.push(definition.default);
        continue;
      }

      if (definition.required) {
        throw new Error(`Missing required param: ${paramName}`);
      }
    }

    return await toolFn(...validatedArgs);
  } catch (error) {
    throw new Error(`[ToolExecutor] ${error.message}`);
  }
};
