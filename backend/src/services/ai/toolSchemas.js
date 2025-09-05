export const TOOL_REGISTRY = {
  getTotalMembers: {
    name: "getTotalMembers",
    description: "Returns the total count of all registered gym members.",
    params: {},
  },
  getExpiringMembers: {
    name: "getExpiringMembers",
    description: "Returns members whose membership expires within N days.",
    params: {
      days: {
        type: "number",
        required: false,
        default: 7,
      },
    },
  },
  sendReminder: {
    name: "sendReminder",
    description:
      "Prepares reminder data for a list of members. Does NOT send any message. Returns prepared payload only.",
    params: {
      members: {
        type: "array",
        required: true,
        description: "Array of member objects from getExpiringMembers result",
      },
    },
    requiresConfirmation: true,
    isSideEffect: true,
  },
};

export const isValidTool = (name) => Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name);
export const requiresConfirmation = (name) => Boolean(TOOL_REGISTRY[name]?.requiresConfirmation);
export const isSideEffectTool = (name) => Boolean(TOOL_REGISTRY[name]?.isSideEffect);
