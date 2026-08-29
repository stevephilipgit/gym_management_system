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