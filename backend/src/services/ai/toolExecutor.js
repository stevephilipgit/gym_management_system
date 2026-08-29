import { TOOL_REGISTRY, isValidTool } from "./toolSchemas.js";
import * as tools from "./tools.js";

const TOOL_FUNCTIONS = Object.keys(TOOL_REGISTRY).reduce((acc, toolName) => {
  if (typeof tools[toolName] === "function") {
    acc[toolName] = tools[toolName];
  }
  return acc;
}, {});

const matchesType = (value, expectedType) => {
  if (expectedType === "array") return Array.isArray(value);
  if (expectedType === "number") return typeof value === "number" || (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)));
  return typeof value === expectedType;
};

/**
 * Execute a whitelisted tool with validated params.
 * @param {string} toolName
 * @param {object} params raw params (may include strings; numbers are coerced)
 * @param {{ scope: string|string[] }} adminContext authenticated admin context (scope enforcement)
 */
export const executeTool = async (toolName, params = {}, adminContext = {}) => {
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
    let value;

    if (hasParam) {
      if (!matchesType(params[paramName], definition.type)) {
        throw new Error(`Invalid param type for ${paramName}`);
      }
      value = definition.type === "number" ? Number(params[paramName]) : params[paramName];
    } else if (Object.prototype.hasOwnProperty.call(definition, "default")) {
      value = definition.default;
    } else if (definition.required) {
      throw new Error(`Missing required param: ${paramName}`);
    }

    if (value !== undefined) {
      if (typeof definition.min === "number" && value < definition.min) {
        throw new Error(`Param ${paramName} must be >= ${definition.min}`);
      }
      if (typeof definition.max === "number" && value > definition.max) {
        throw new Error(`Param ${paramName} must be <= ${definition.max}`);
      }
      validatedArgs.push(value);
    }
  }

  // Normalize scope: superadmin "all" and headless/system jobs (no admin
  // context) see everything; an explicit gender list is honored. Never trusts
  // the model for scope — only the authenticated admin context.
  const scope = adminContext?.scope;
  const normalizedScope =
    Array.isArray(scope) && scope.length > 0 ? scope : "all";

  return toolFn({ scope: normalizedScope }, ...validatedArgs);
};

export default executeTool;