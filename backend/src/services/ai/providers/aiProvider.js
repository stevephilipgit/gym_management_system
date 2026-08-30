/**
 * AIProvider — minimal adapter interface every AI provider implements.
 *
 * Kept deliberately small and practical: a single `generate` call plus
 * capability metadata. The rest of the subsystem talks only to this shape,
 * so switching providers is a configuration change, never a code change.
 */

export const ProviderErrorCodes = {
  AUTH: "AUTH", // bad/missing API key, config error
  RATE_LIMIT: "RATE_LIMIT", // provider returned 429
  UNAVAILABLE: "UNAVAILABLE", // provider down / transient failure
  TIMEOUT: "TIMEOUT", // request exceeded timeout
  MALFORMED: "MALFORMED", // provider returned an unusable response
  UNKNOWN: "UNKNOWN", // unexpected error
};

export class AIProviderError extends Error {
  constructor(message, code = ProviderErrorCodes.UNKNOWN, retryable = false) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const isRetryableProviderError = (error) =>
  error instanceof AIProviderError && error.retryable;

/**
 * Optional capability metadata a provider may expose.
 * The base interface only requires `generate`; capabilities are forward-looking
 * and never assumed by existing flows.
 *
 * @typedef {object} ProviderCapabilities
 * @property {boolean} [supportsTools]          e.g. native tool/function calling
 * @property {boolean} [supportsStructuredOutput] e.g. JSON-mode / structured output
 * @property {boolean} [supportsStreaming]      e.g. SSE streaming
 */

/**
 * Create a default capability set for a provider.
 * @param {Partial<ProviderCapabilities>} overrides
 * @returns {ProviderCapabilities}
 */
export const createCapabilities = (overrides = {}) => ({
  supportsTools: Boolean(overrides.supportsTools),
  supportsStructuredOutput: Boolean(overrides.supportsStructuredOutput),
  supportsStreaming: Boolean(overrides.supportsStreaming),
});