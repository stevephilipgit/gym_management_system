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
 * Resolve the scope for a tool call.
 *
 * SECURITY: a missing principal is DENIED. There is no implicit "all".
 *   - User principal (type="user"): scope comes from the authenticated admin.
 *   - System principal (type="system"): must explicitly carry scope "all".
 *
 * @param {object|null} principal
 * @returns {"all"|string[]}
 */
const resolveScope = (principal) => {
  if (!principal || typeof principal !== "object") {
    throw new Error("Tool execution requires an explicit principal");
  }

  if (principal.type === "system") {
    // Internal/system caller — must explicitly declare its scope.
    const scope = principal.systemScope || principal.scope;
    if (Array.isArray(scope) && scope.length > 0) return scope;
    if (scope === "all") return "all";
    throw new Error("System principal must declare an explicit scope");
  }

  if (principal.type === "user") {
    const scope = principal.scope;
    if (Array.isArray(scope) && scope.length > 0) return scope;
    if (scope === "all") return "all";
    throw new Error("User principal missing a valid scope");
  }

  throw new Error("Unknown principal type");
};

/**
 * Execute a whitelisted tool with validated params.
 * @param {string} toolName
 * @param {object} params raw params (may include strings; numbers are coerced)
 * @param {object|null} principal explicit caller identity — REQUIRED
 */
export const executeTool = async (toolName, params = {}, principal = null) => {
  if (!isValidTool(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const toolFn = TOOL_FUNCTIONS[toolName];
  if (typeof toolFn !== "function") {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const paramDefinitions = TOOL_REGISTRY[toolName].params || {};
  const collectAsObject = TOOL_REGISTRY[toolName].collectAs === "object";
  const collected = {};
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
      if (Array.isArray(definition.enum) && !definition.enum.includes(value)) {
        throw new Error(
          `Param ${paramName} must be one of: ${definition.enum.join(", ")}`
        );
      }
      if (collectAsObject) {
        collected[paramName] = value;
      } else {
        validatedArgs.push(value);
      }
    }
  }

  const scope = resolveScope(principal);
  if (collectAsObject) {
    return toolFn({ scope }, collected);
  }
  return toolFn({ scope }, ...validatedArgs);
};

export default executeTool;